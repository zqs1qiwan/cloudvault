// ─── Authentication ───────────────────────────────────────────────────
//
// A session is a KV record that names the account it belongs to. Every
// authenticated request therefore proves two things at once: the session
// exists, and the account behind it still does - deleting a user kills their
// sessions without a separate revocation list.

import type { Account, Env, Session } from './utils/types';
import { KV_PREFIX } from './utils/types';
import { error, json } from './lib/http';
import { checkLimit, clearFailures, clientId, recordFailure } from './lib/ratelimit';
import {
  bootstrapAccounts,
  claimFirstAdmin,
  getAccountById,
  verifyLogin,
} from './lib/accounts';

export const SESSION_COOKIE = 'session';
const SESSION_TTL = 7 * 86400; // seconds

export function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return rest.join('=');
  }
  return null;
}

export async function createSession(env: Env, account: Account): Promise<Session> {
  const session: Session = {
    id: crypto.randomUUID(),
    userId: account.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + SESSION_TTL * 1000).toISOString(),
  };
  await env.VAULT_KV.put(KV_PREFIX.SESSION + session.id, JSON.stringify(session), {
    expirationTtl: SESSION_TTL,
  });
  return session;
}

export interface SessionContext {
  session: Session;
  account: Account;
}

/**
 * Resolve a session id to the account that owns it. Sessions issued before
 * accounts existed carry no `userId`; they are dropped rather than upgraded,
 * because there is no way to know who they belonged to.
 */
export async function getSessionAccount(env: Env, sessionId: string): Promise<SessionContext | null> {
  if (!sessionId) return null;
  const raw = await env.VAULT_KV.get(KV_PREFIX.SESSION + sessionId);
  if (!raw) return null;

  let session: Session;
  try {
    session = JSON.parse(raw) as Session;
  } catch {
    return null;
  }

  const expired = !session.expiresAt || Date.parse(session.expiresAt) <= Date.now();
  if (expired || !session.userId) {
    await env.VAULT_KV.delete(KV_PREFIX.SESSION + sessionId);
    return null;
  }

  const account = await getAccountById(env, session.userId);
  if (!account) {
    await env.VAULT_KV.delete(KV_PREFIX.SESSION + sessionId);
    return null;
  }
  return { session, account };
}

export async function requireUser(request: Request, env: Env): Promise<Account | null> {
  const sessionId = cookieValue(request, SESSION_COOKIE);
  if (!sessionId) return null;
  const context = await getSessionAccount(env, sessionId);
  return context?.account ?? null;
}

export async function requireAdmin(request: Request, env: Env): Promise<Account | null> {
  const account = await requireUser(request, env);
  return account && account.role === 'admin' ? account : null;
}

/** Revoke every session for an account, optionally sparing the caller's own. */
export async function revokeSessionsForUser(env: Env, userId: string, exceptSessionId?: string): Promise<number> {
  let revoked = 0;
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.SESSION, cursor, limit: 1000 });
    const values = await Promise.all(page.keys.map((entry) => env.VAULT_KV.get(entry.name)));
    const doomed: string[] = [];
    for (let i = 0; i < page.keys.length; i++) {
      const name = page.keys[i].name;
      const id = name.slice(KV_PREFIX.SESSION.length);
      if (id === exceptSessionId) continue;
      const raw = values[i];
      if (!raw) continue;
      try {
        const session = JSON.parse(raw) as Session;
        if (session.userId === userId) doomed.push(id);
      } catch {
        // unreadable session records are left for their TTL
      }
    }
    // KV has no batch delete in the Workers types; one call per session is
    // still fine because a person holds only a handful.
    if (doomed.length) {
      await Promise.all(doomed.map((id) => env.VAULT_KV.delete(KV_PREFIX.SESSION + id)));
      revoked += doomed.length;
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return revoked;
}

function sessionCookie(session: Session): string {
  return `${SESSION_COOKIE}=${session.id}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

function expiredCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// ─── Login ────────────────────────────────────────────────────────────

export async function handleLogin(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return error('Invalid request', 400);

  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');

  const guard = await checkLimit(env, 'login', clientId(request));
  if (guard.blocked) {
    return json({ error: `Too many attempts. Try again in ${guard.retryAfter}s.` }, 429);
  }

  // A fresh deployment has nothing to sign in with; say so explicitly instead
  // of answering "invalid password" to credentials nobody has created yet.
  if (!(await bootstrapAccounts(env)).ready) {
    return json({ error: 'This vault has not been set up yet.', setup: true }, 409);
  }

  if (!username || !password) return error('Username and password required', 400);

  const account = await verifyLogin(env, username, password);
  if (!account) {
    await recordFailure(env, 'login', clientId(request));
    // Same wording for "no such user" and "wrong password": the response must
    // not tell an attacker which half of the guess was correct.
    return error('Invalid username or password', 401);
  }

  await clearFailures(env, 'login', clientId(request));
  const session = await createSession(env, account);
  return json(
    { message: 'ok', username: account.username, role: account.role, mustChangePassword: account.mustChangePassword },
    200,
    'no-store',
    { 'Set-Cookie': sessionCookie(session) },
  );
}

// ─── First-run setup ──────────────────────────────────────────────────

/**
 * Creates the first admin and signs it in. Rejected as soon as any account
 * exists, so this endpoint cannot be used to mint a second administrator later.
 */
export async function handleSetup(request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  if (!form) return error('Invalid request', 400);

  const username = String(form.get('username') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const confirm = String(form.get('confirm') ?? '');

  const guard = await checkLimit(env, 'setup', clientId(request));
  if (guard.blocked) {
    await recordFailure(env, 'setup', clientId(request));
    return json({ error: `Too many attempts. Try again in ${guard.retryAfter}s.` }, 429);
  }

  if (password !== confirm) return error('Passwords do not match', 400);

  try {
    const account = await claimFirstAdmin(env, { username, password });
    await clearFailures(env, 'setup', clientId(request));
    const session = await createSession(env, account);
    return json({ message: 'ok' }, 201, 'no-store', { 'Set-Cookie': sessionCookie(session) });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Setup failed';
    if (message === 'Already initialized') {
      return json({ error: 'This vault is already initialized. Sign in instead.', login: true }, 409);
    }
    await recordFailure(env, 'setup', clientId(request));
    return error(message, 400);
  }
}

export async function handleLogout(request: Request, env: Env): Promise<Response> {
  const sessionId = cookieValue(request, SESSION_COOKIE);
  if (sessionId) await env.VAULT_KV.delete(KV_PREFIX.SESSION + sessionId);
  return new Response(null, {
    status: 303,
    headers: { Location: '/login', 'Set-Cookie': expiredCookie() },
  });
}
