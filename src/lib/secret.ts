// ─── Instance secret ──────────────────────────────────────────────────
//
// Share-link cookies are signed with an HMAC key. It used to come from a
// deploy-time `SESSION_SECRET`; a key that only ever signs cookies does not
// belong in an operator's secret list, so it is generated on first use and
// kept in KV. An explicitly configured secret still wins, which keeps existing
// deployments' cookies valid.

import type { Env } from '../utils/types';
import { KV_PREFIX } from '../utils/types';

const SECRET_KEY = KV_PREFIX.SETTINGS + 'instance-secret';
const cache = new WeakMap<object, string>();

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function getInstanceSecret(env: Env): Promise<string> {
  if (env.SESSION_SECRET) return env.SESSION_SECRET;
  const cached = cache.get(env);
  if (cached) return cached;

  let value = await env.VAULT_KV.get(SECRET_KEY);
  if (!value) {
    value = randomHex(32);
    await env.VAULT_KV.put(SECRET_KEY, value);
  }
  cache.set(env, value);
  return value;
}
