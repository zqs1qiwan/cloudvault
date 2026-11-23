// ─── Accounts API ─────────────────────────────────────────────────────
//
// Everything an operator needs after the first login: list accounts, add one,
// change a name or a role, reset someone's password, remove them. All of it
// requires an admin role; the last admin cannot be removed or demoted, so the
// vault can never end up with nobody able to administer it.

import type { Account, AccountRole, Env } from '../utils/types';
import { error, json } from '../lib/http';
import {
  countAdmins,
  createAccount,
  deleteAccount,
  getAccountById,
  listAccounts,
  toPublic,
  updateAccount,
  verifyCurrentPassword,
} from '../lib/accounts';
import { validatePassword } from '../lib/passwords';
import { SESSION_COOKIE, cookieValue, revokeSessionsForUser } from '../auth';

function forbidden(): Response {
  return error('Administrator role required', 403);
}

export async function handleGetAccount(account: Account): Promise<Response> {
  return json({ account: toPublic(account) });
}

export async function handleListUsers(env: Env, account: Account): Promise<Response> {
  if (account.role !== 'admin') return forbidden();
  return json({ users: (await listAccounts(env)).map(toPublic) });
}

export async function handleCreateUser(request: Request, env: Env, account: Account): Promise<Response> {
  if (account.role !== 'admin') return forbidden();

  let body: { username?: unknown; password?: unknown; role?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  const username = typeof body.username === 'string' ? body.username : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const role: AccountRole = body.role === 'admin' ? 'admin' : 'user';

  try {
    const created = await createAccount(env, { username, password, role });
    return json({ user: toPublic(created) }, 201);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Could not create account', 400);
  }
}

export async function handleUpdateUser(
  request: Request,
  env: Env,
  account: Account,
  id: string,
): Promise<Response> {
  if (account.role !== 'admin') return forbidden();

  const target = await getAccountById(env, id);
  if (!target) return error('Account not found', 404);

  let body: { username?: unknown; role?: unknown; password?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  const wantsDemotion = body.role === 'user' && target.role === 'admin';
  if (wantsDemotion && (await countAdmins(env)) <= 1) {
    return error('The last administrator cannot be demoted', 409);
  }

  const patch: { username?: string; role?: AccountRole; password?: string } = {};
  if (typeof body.username === 'string') patch.username = body.username;
  if (body.role === 'admin' || body.role === 'user') patch.role = body.role;
  if (body.password !== undefined) {
    if (typeof body.password !== 'string') return error('Invalid password', 400);
    try {
      patch.password = validatePassword(body.password);
    } catch (err) {
      return error(err instanceof Error ? err.message : 'Invalid password', 400);
    }
  }

  try {
    const updated = await updateAccount(env, target, {
      ...patch,
      ...(patch.password !== undefined ? { mustChangePassword: true } : {}),
    });
    // A reset password must not leave the old session logged in elsewhere.
    if (patch.password !== undefined) await revokeSessionsForUser(env, updated.id);
    return json({ user: toPublic(updated) });
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Could not update account', 400);
  }
}

export async function handleDeleteUser(env: Env, account: Account, id: string): Promise<Response> {
  if (account.role !== 'admin') return forbidden();
  if (id === account.id) return error('You cannot delete the account you are signed in with', 400);

  const target = await getAccountById(env, id);
  if (!target) return error('Account not found', 404);
  if (target.role === 'admin' && (await countAdmins(env)) <= 1) {
    return error('The last administrator cannot be deleted', 409);
  }

  await revokeSessionsForUser(env, target.id);
  await deleteAccount(env, target);
  return json({ message: 'ok' });
}

/** Self-service password change: proves possession of the current password. */
export async function handleChangePassword(request: Request, env: Env, account: Account): Promise<Response> {
  let body: { currentPassword?: unknown; newPassword?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
  const next = typeof body.newPassword === 'string' ? body.newPassword : '';
  if (!current || !next) return error('Current and new password are required', 400);

  if (!(await verifyCurrentPassword(account, current))) {
    return error('Current password is incorrect', 403);
  }

  let password: string;
  try {
    password = validatePassword(next);
  } catch (err) {
    return error(err instanceof Error ? err.message : 'Invalid password', 400);
  }

  await updateAccount(env, account, { password, mustChangePassword: false });
  // Keep the device performing the change, drop every other one.
  const currentSessionId = cookieValue(request, SESSION_COOKIE) ?? undefined;
  const revoked = await revokeSessionsForUser(env, account.id, currentSessionId);
  return json({ message: 'Password updated', revokedSessions: revoked });
}
