import { beforeEach, describe, expect, it } from 'vitest';
import type { Account, Env } from '../src/utils/types';
import { KV_PREFIX } from '../src/utils/types';
import {
  bootstrapAccounts,
  claimFirstAdmin,
  countAdmins,
  createAccount,
  deleteAccount,
  getAccountById,
  getAccountByUsername,
  listAccounts,
  updateAccount,
  verifyBasicAuth,
  verifyLogin,
} from '../src/lib/accounts';
import { createSession, getSessionAccount } from '../src/auth';
import * as users from '../src/api/users';
import { FakeKV, makeEnv } from './helpers/fakes';

let env: Env;
let kv: FakeKV;

beforeEach(() => {
  ({ env, kv } = makeEnv());
});

function accountOf(kvStore: FakeKV, username: string): Account {
  const id = kvStore.store.get(KV_PREFIX.ACCOUNT_LOOKUP + username.toLowerCase());
  if (!id) throw new Error('no account ' + username);
  return JSON.parse(kvStore.store.get(KV_PREFIX.ACCOUNT + id) as string) as Account;
}

describe('account records', () => {
  it('keeps one record and one lookup per account', async () => {
    const created = await createAccount(env, { username: 'alice', password: 'correct-horse' });

    expect(kv.store.size).toBe(2);
    expect(JSON.parse(kv.store.get(KV_PREFIX.ACCOUNT + created.id) as string).role).toBe('user');
    expect(kv.store.get(KV_PREFIX.ACCOUNT_LOOKUP + 'alice')).toBe(created.id);
    expect(await getAccountById(env, created.id)).toMatchObject({ username: 'alice' });
  });

  it('treats usernames case-insensitively and refuses duplicates', async () => {
    await createAccount(env, { username: 'Alice', password: 'correct-horse' });
    await expect(createAccount(env, { username: 'alice', password: 'another-one' })).rejects.toThrow('already taken');
    expect((await getAccountByUsername(env, 'ALICE'))?.username).toBe('Alice');
  });

  it('rejects bad names and short passwords', async () => {
    await expect(createAccount(env, { username: 'ab', password: 'correct-horse' })).rejects.toThrow('Username');
    await expect(createAccount(env, { username: 'a b', password: 'correct-horse' })).rejects.toThrow('Username');
    await expect(createAccount(env, { username: 'carol', password: 'short' })).rejects.toThrow('at least 8');
  });

  it('checks a password without leaking whether the user exists', async () => {
    await createAccount(env, { username: 'dave', password: 'correct-horse' });
    expect(await verifyLogin(env, 'dave', 'correct-horse')).toMatchObject({ username: 'dave' });
    expect(await verifyLogin(env, 'dave', 'wrong')).toBeNull();
    expect(await verifyLogin(env, 'nobody', 'correct-horse')).toBeNull();
  });

  it('moves the lookup when a username changes', async () => {
    const account = await createAccount(env, { username: 'eve', password: 'correct-horse' });
    await updateAccount(env, account, { username: 'eve2' });

    expect(await getAccountByUsername(env, 'eve')).toBeNull();
    expect(await getAccountByUsername(env, 'eve2')).toMatchObject({ username: 'eve2' });
    expect(kv.store.has(KV_PREFIX.ACCOUNT_LOOKUP + 'eve')).toBe(false);
  });

  it('removes both keys on delete, so a stale lookup cannot log anyone in', async () => {
    const account = await createAccount(env, { username: 'frank', password: 'correct-horse' });
    await deleteAccount(env, account);
    expect(kv.store.size).toBe(0);
    expect(await verifyLogin(env, 'frank', 'correct-horse')).toBeNull();
  });

  it('lists accounts in creation order and counts admins', async () => {
    await createAccount(env, { username: 'alpha1', password: 'correct-horse' });
    await createAccount(env, { username: 'bravo1', password: 'correct-horse', role: 'admin' });
    const all = await listAccounts(env);
    expect(all.map((item) => item.username)).toEqual(['alpha1', 'bravo1']);
    expect(await countAdmins(env)).toBe(1);
  });
});

describe('first run', () => {
  it('offers setup only while no account exists', async () => {
    expect(await bootstrapAccounts(env)).toEqual({ ready: false, migrated: false });

    const admin = await claimFirstAdmin(env, { username: 'admin', password: 'correct-horse' });
    expect(admin.role).toBe('admin');

    expect(await bootstrapAccounts(env)).toEqual({ ready: true, migrated: false });
    await expect(claimFirstAdmin(env, { username: 'other', password: 'correct-horse' })).rejects.toThrow('Already initialized');
  });

  it('does not report an uninitialized vault when a concurrent bootstrap already wrote root', async () => {
    await createAccount(env, {
      username: 'root',
      password: 'old-secret',
      role: 'admin',
      mustChangePassword: true,
      allowShortPassword: true,
    });

    // Mirror KV's eventual consistency: the first two listings still look empty,
    // which is exactly what a second request in the same instant would see.
    const realList = kv.list.bind(kv);
    let stale = 2;
    kv.list = async (options: { prefix?: string; limit?: number; cursor?: string } = {}) => {
      if ((options.prefix ?? '') === KV_PREFIX.ACCOUNT && stale > 0) {
        stale--;
        return { keys: [], list_complete: true, cursor: '0' };
      }
      return realList(options);
    };

    const result = await bootstrapAccounts({ ...env, ADMIN_PASSWORD: 'old-secret' } as Env);
    expect(result).toEqual({ ready: true, migrated: false });
  });

  it('turns a legacy ADMIN_PASSWORD into a root account once', async () => {
    const legacy = { ...env, ADMIN_PASSWORD: 'old-secret' } as Env;
    const result = await bootstrapAccounts(legacy);

    expect(result).toEqual({ ready: true, migrated: true });
    const root = accountOf(kv, 'root');
    expect(root).toMatchObject({ role: 'admin', mustChangePassword: true });
    expect(await verifyLogin(legacy, 'root', 'old-secret')).not.toBeNull();
    expect(await verifyLogin(legacy, 'root', 'wrong')).toBeNull();
  });
});

describe('sessions', () => {
  it('binds a session to the account and dies with it', async () => {
    const account = await createAccount(env, { username: 'gina', password: 'correct-horse' });
    const session = await createSession(env, account);

    const context = await getSessionAccount(env, session.id);
    expect(context?.account.username).toBe('gina');

    await deleteAccount(env, account);
    expect(await getSessionAccount(env, session.id)).toBeNull();
  });

  it('ignores a session issued before accounts existed', async () => {
    kv.store.set(
      KV_PREFIX.SESSION + 'legacy-session',
      JSON.stringify({ id: 'legacy-session', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 3600_000).toISOString() }),
    );
    expect(await getSessionAccount(env, 'legacy-session')).toBeNull();
  });
});

describe('webdav credentials', () => {
  it('accepts the same username and password as the web login', async () => {
    await createAccount(env, { username: 'hank', password: 'correct-horse' });
    expect(await verifyBasicAuth(env, 'hank', 'correct-horse')).toBe(true);
    expect(await verifyBasicAuth(env, 'hank', 'wrong')).toBe(false);
    expect(await verifyBasicAuth(env, 'nobody', 'correct-horse')).toBe(false);
  });
});

describe('user management API', () => {
  async function jsonRequest(path: string, method: string, body: unknown): Promise<Request> {
    return new Request('https://example.com' + path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('refuses non-admins', async () => {
    const member = await createAccount(env, { username: 'member', password: 'correct-horse' });
    expect((await users.handleListUsers(env, member)).status).toBe(403);
    expect((await users.handleCreateUser(await jsonRequest('/api/users', 'POST', { username: 'x', password: 'correct-horse' }), env, member)).status).toBe(403);
  });

  it('creates, renames, promotes and removes accounts', async () => {
    const admin = await createAccount(env, { username: 'boss', password: 'correct-horse', role: 'admin' });

    const created = await users.handleCreateUser(await jsonRequest('/api/users', 'POST', { username: 'newbie', password: 'correct-horse' }), env, admin);
    expect(created.status).toBe(201);
    const newbie = (await created.json() as { user: { id: string } }).user;

    const renamed = await users.handleUpdateUser(await jsonRequest('/api/users/' + newbie.id, 'PUT', { username: 'newbie2', role: 'admin' }), env, admin, newbie.id);
    expect(renamed.status).toBe(200);
    expect(await countAdmins(env)).toBe(2);

    expect((await users.handleDeleteUser(env, admin, newbie.id)).status).toBe(200);
    expect(await countAdmins(env)).toBe(1);
  });

  it('protects the last administrator and the current session owner', async () => {
    const admin = await createAccount(env, { username: 'solo', password: 'correct-horse', role: 'admin' });

    expect((await users.handleDeleteUser(env, admin, admin.id)).status).toBe(400);
    expect((await users.handleUpdateUser(await jsonRequest('/api/users/' + admin.id, 'PUT', { role: 'user' }), env, admin, admin.id)).status).toBe(409);
  });

  it('resets a password and signs the account out everywhere', async () => {
    const admin = await createAccount(env, { username: 'root2', password: 'correct-horse', role: 'admin' });
    const target = await createAccount(env, { username: 'kid', password: 'correct-horse' });
    const session = await createSession(env, target);

    const res = await users.handleUpdateUser(await jsonRequest('/api/users/' + target.id, 'PUT', { password: 'brand-new-pass' }), env, admin, target.id);
    expect(res.status).toBe(200);

    expect(await getSessionAccount(env, session.id)).toBeNull();
    expect(await verifyLogin(env, 'kid', 'brand-new-pass')).not.toBeNull();
    expect(await verifyLogin(env, 'kid', 'correct-horse')).toBeNull();
  });
});
