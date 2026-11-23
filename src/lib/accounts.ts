// ─── Accounts ─────────────────────────────────────────────────────────
//
// The account record is the single source of truth for credentials. Two KV
// keys always move together:
//
//   user:<id>                     the record
//   userlookup:<usernameLower>   → id
//
// The lookup exists so login and uniqueness checks are one `get` instead of a
// scan; every write below updates both, and a failed create rolls back. No
// other place in the app stores a password or a username.

import type { Account, AccountRole, Env, PublicAccount } from '../utils/types';
import { KV_PREFIX, USERNAME_PATTERN } from '../utils/types';
import {
  hashPassword,
  sha256Hex,
  validatePassword,
  verifyPassword,
} from './passwords';

const MAX_USERNAME_LENGTH = 32;
const MIN_USERNAME_LENGTH = 3;
/** Verified DAV credentials are reused for a minute instead of redoing PBKDF2. */
const BASIC_CACHE_MS = 60_000;
const BASIC_CACHE_MAX = 256;

const basicCache = new WeakMap<object, Map<string, number>>();

/**
 * A valid hash that no real password produces. Hashing/verifying against it
 * keeps "user does not exist" as expensive as "wrong password", so the login
 * endpoint is not a username oracle.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  dummyHashPromise ??= hashPassword('cloudvault-timing-equalizer');
  return dummyHashPromise;
}

function accountKey(id: string): string {
  return KV_PREFIX.ACCOUNT + id;
}

function lookupKey(usernameLower: string): string {
  return KV_PREFIX.ACCOUNT_LOOKUP + usernameLower;
}

export function normalizeUsername(raw: string): { username: string; usernameLower: string } {
  const username = (raw ?? '').trim();
  if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
    throw new Error(`Username must be ${MIN_USERNAME_LENGTH}-${MAX_USERNAME_LENGTH} characters`);
  }
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Username may only contain letters, digits, dot, dash and underscore');
  }
  return { username, usernameLower: username.toLowerCase() };
}

export function toPublic(account: Account): PublicAccount {
  return {
    id: account.id,
    username: account.username,
    role: account.role,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt,
    mustChangePassword: account.mustChangePassword,
  };
}

function parseAccount(raw: string | null): Account | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Account;
    if (!parsed.id || !parsed.username || !parsed.passwordHash) return null;
    return {
      ...parsed,
      usernameLower: parsed.usernameLower ?? parsed.username.toLowerCase(),
      lastLoginAt: parsed.lastLoginAt ?? null,
      mustChangePassword: parsed.mustChangePassword ?? false,
    };
  } catch {
    return null;
  }
}

export async function getAccountById(env: Env, id: string): Promise<Account | null> {
  if (!id) return null;
  return parseAccount(await env.VAULT_KV.get(accountKey(id)));
}

export async function getAccountByUsername(env: Env, username: string): Promise<Account | null> {
  let normalized: { usernameLower: string };
  try {
    normalized = normalizeUsername(username);
  } catch {
    return null;
  }
  const id = await env.VAULT_KV.get(lookupKey(normalized.usernameLower));
  if (!id) return null;
  const account = await getAccountById(env, id);
  // A dangling lookup means a create failed halfway; treat it as "no account"
  // rather than logging someone in against a missing record.
  if (!account || account.usernameLower !== normalized.usernameLower) return null;
  return account;
}

export async function listAccounts(env: Env): Promise<Account[]> {
  const accounts: Account[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.ACCOUNT, cursor, limit: 1000 });
    for (const entry of page.keys) {
      const account = parseAccount(await env.VAULT_KV.get(entry.name));
      if (account) accounts.push(account);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return accounts.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function countAccounts(env: Env): Promise<number> {
  // `user:` does not match `userlookup:`, so this is one cheap listing.
  const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.ACCOUNT, limit: 1000 });
  return page.keys.length;
}

export async function hasAccounts(env: Env): Promise<boolean> {
  return (await countAccounts(env)) > 0;
}

export async function countAdmins(env: Env): Promise<number> {
  return (await listAccounts(env)).filter((account) => account.role === 'admin').length;
}

export interface CreateAccountInput {
  username: string;
  password: string;
  role?: AccountRole;
  mustChangePassword?: boolean;
  /** Skip the length policy, for legacy secrets that predate it. */
  allowShortPassword?: boolean;
}

export async function createAccount(env: Env, input: CreateAccountInput): Promise<Account> {
  const { username, usernameLower } = normalizeUsername(input.username);
  const password = input.allowShortPassword ? input.password : validatePassword(input.password);
  if (!password) throw new Error('Password required');

  if (await getAccountByUsername(env, username)) throw new Error('That username is already taken');

  const now = new Date().toISOString();
  const account: Account = {
    id: crypto.randomUUID(),
    username,
    usernameLower,
    role: input.role === 'admin' ? 'admin' : 'user',
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: null,
    mustChangePassword: input.mustChangePassword ?? false,
  };

  await env.VAULT_KV.put(accountKey(account.id), JSON.stringify(account));
  await env.VAULT_KV.put(lookupKey(usernameLower), account.id);

  // KV writes are not conditional, so two simultaneous creates with the same
  // name can both think they won. Re-read the claim: the loser rolls back
  // instead of leaving a second, unusable record behind.
  const claimed = await env.VAULT_KV.get(lookupKey(usernameLower));
  if (claimed !== account.id) {
    await env.VAULT_KV.delete(accountKey(account.id));
    throw new Error('That username is already taken');
  }

  return account;
}

export interface UpdateAccountInput {
  username?: string;
  role?: AccountRole;
  password?: string;
  mustChangePassword?: boolean;
}

export async function updateAccount(env: Env, account: Account, input: UpdateAccountInput): Promise<Account> {
  const next: Account = { ...account, updatedAt: new Date().toISOString() };

  if (input.username !== undefined) {
    const { username, usernameLower } = normalizeUsername(input.username);
    if (usernameLower !== account.usernameLower) {
      const existing = await getAccountByUsername(env, username);
      if (existing && existing.id !== account.id) throw new Error('That username is already taken');
      // Write the new claim before dropping the old one: a crash in between
      // leaves an extra key that no login can resolve, never a username that
      // is silently unreachable.
      await env.VAULT_KV.put(lookupKey(usernameLower), account.id);
      await env.VAULT_KV.delete(lookupKey(account.usernameLower));
      next.username = username;
      next.usernameLower = usernameLower;
    }
  }

  if (input.role !== undefined) {
    next.role = input.role === 'admin' ? 'admin' : 'user';
  }

  if (input.password !== undefined) {
    next.passwordHash = await hashPassword(validatePassword(input.password));
    next.mustChangePassword = input.mustChangePassword ?? false;
  } else if (input.mustChangePassword !== undefined) {
    next.mustChangePassword = input.mustChangePassword;
  }

  await env.VAULT_KV.put(accountKey(account.id), JSON.stringify(next));
  clearBasicCache(env);
  return next;
}

export async function deleteAccount(env: Env, account: Account): Promise<void> {
  await env.VAULT_KV.delete(lookupKey(account.usernameLower));
  await env.VAULT_KV.delete(accountKey(account.id));
  clearBasicCache(env);
}

/**
 * Check a username/password pair. Returns the account on success.
 *
 * On success a legacy hash is upgraded in place, and `lastLoginAt` is bumped -
 * both writes are fire-and-forget from the caller's point of view.
 */
export async function verifyLogin(env: Env, username: string, password: string): Promise<Account | null> {
  if (!password) return null;
  const account = await getAccountByUsername(env, username);
  if (!account) {
    await verifyPassword(password, await dummyHash());
    return null;
  }

  const result = await verifyPassword(password, account.passwordHash);
  if (!result.valid) return null;

  let next = account;
  if (result.needsUpgrade) {
    next = { ...account, passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() };
  }
  next = { ...next, lastLoginAt: new Date().toISOString() };
  await env.VAULT_KV.put(accountKey(next.id), JSON.stringify(next));
  return next;
}

export async function verifyCurrentPassword(account: Account, password: string): Promise<boolean> {
  return (await verifyPassword(password, account.passwordHash)).valid;
}

// ─── WebDAV Basic auth ────────────────────────────────────────────────
//
// A sync client re-sends Basic credentials on every request. PBKDF2 per request
// would dominate the CPU budget, so a verified pair is remembered for a minute
// in this isolate. The cache key is a digest, never the password itself.

export function clearBasicCache(env: Env): void {
  basicCache.delete(env);
}

export async function verifyBasicAuth(env: Env, username: string, password: string): Promise<boolean> {
  if (!username || !password) return false;
  const cacheKey = await sha256Hex(`${username.toLowerCase()}:${password}`);
  const entries = basicCache.get(env);
  const hit = entries?.get(cacheKey);
  if (hit && hit > Date.now()) return true;

  const account = await verifyLogin(env, username, password);
  if (!account) return false;

  const store = entries ?? new Map<string, number>();
  if (!entries) basicCache.set(env, store);
  if (store.size >= BASIC_CACHE_MAX) store.clear();
  store.set(cacheKey, Date.now() + BASIC_CACHE_MS);
  return true;
}

// ─── Bootstrap ────────────────────────────────────────────────────────

const readyCache = new WeakMap<object, number>();
const READY_CACHE_MS = 60_000;

export interface BootstrapResult {
  /** An account exists (created now or before), so setup is no longer offered. */
  ready: boolean;
  /** A legacy ADMIN_PASSWORD was turned into an account on this call. */
  migrated: boolean;
}

/**
 * Called on the unauthenticated pages only. Two cases:
 *  - fresh deployment: no account, no secret → the UI shows /setup;
 *  - existing deployment: `ADMIN_PASSWORD` was set, so its holder keeps access
 *    as `root` with a one-time "change this password" flag.
 *
 * An operator-set secret always wins over the setup page, so upgrading cannot
 * lock anyone out.
 */
export async function bootstrapAccounts(env: Env): Promise<BootstrapResult> {
  // This runs on every unauthenticated page and every DAV request, so a
  // positive answer is remembered briefly instead of re-listing KV each time.
  const cachedUntil = readyCache.get(env);
  if (cachedUntil && cachedUntil > Date.now()) return { ready: true, migrated: false };

  if (await hasAccounts(env)) {
    readyCache.set(env, Date.now() + READY_CACHE_MS);
    return { ready: true, migrated: false };
  }
  if (!env.ADMIN_PASSWORD) return { ready: false, migrated: false };

  try {
    await createAccount(env, {
      username: 'root',
      password: env.ADMIN_PASSWORD,
      role: 'admin',
      mustChangePassword: true,
      allowShortPassword: true,
    });
    readyCache.set(env, Date.now() + READY_CACHE_MS);
    return { ready: true, migrated: true };
  } catch (err) {
    // A concurrent request may have created it first, or a bad secret (empty)
    // was rejected; either way we report readiness from a fresh check.
    console.error('Account bootstrap failed:', err instanceof Error ? err.message : String(err));
    // KV listings are eventually consistent: right after a concurrent request
    // writes root, hasAccounts() can still report zero and send the user to
    // /setup with a spurious 409. A point read on the lookup key settles it.
    const ready = (await hasAccounts(env)) || (await getAccountByUsername(env, 'root')) !== null;
    if (ready) readyCache.set(env, Date.now() + READY_CACHE_MS);
    return { ready, migrated: false };
  }
}

/**
 * First-run setup is the only path that can create an admin without being one.
 * It is guarded by "no accounts exist", checked before and after the claim so a
 * double-submit cannot produce two independent admins.
 */
export async function claimFirstAdmin(
  env: Env,
  input: { username: string; password: string },
): Promise<Account> {
  if (await hasAccounts(env)) throw new Error('Already initialized');
  const account = await createAccount(env, { ...input, role: 'admin' });
  if ((await countAdmins(env)) > 1) {
    await deleteAccount(env, account);
    throw new Error('Already initialized');
  }
  return account;
}
