// ─── Rate limiting ────────────────────────────────────────────────────
//
// KV is eventually consistent, so this is a throttle rather than a hard
// guarantee: a burst spread across colos can overshoot the limit slightly.
// That is the right trade for a login form - it turns an unlimited guessing
// oracle into a few attempts per window, with no Durable Object to operate.

import type { Env } from '../utils/types';
import { KV_PREFIX } from '../utils/types';

export interface LimitState {
  blocked: boolean;
  retryAfter: number;
}

const LIMITS = {
  login: { max: 5, windowSec: 600 },
  setup: { max: 5, windowSec: 600 },
  /** Basic auth on /dav: sync clients retry, so allow a few more. */
  dav: { max: 20, windowSec: 600 },
  sharePassword: { max: 8, windowSec: 600 },
} as const;

export type LimitScope = keyof typeof LIMITS;

interface Counter {
  count: number;
  startedAt: number;
}

function key(scope: LimitScope, id: string): string {
  return `${KV_PREFIX.RATE_LIMIT}${scope}:${id}`;
}

export function clientId(request: Request): string {
  return request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? 'unknown';
}

async function readCounter(env: Env, name: string): Promise<Counter | null> {
  const raw = await env.VAULT_KV.get(name);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Counter;
    return Number.isFinite(parsed.count) && Number.isFinite(parsed.startedAt) ? parsed : null;
  } catch {
    return null;
  }
}

export async function checkLimit(env: Env, scope: LimitScope, id: string): Promise<LimitState> {
  const { max, windowSec } = LIMITS[scope];
  const counter = await readCounter(env, key(scope, id));
  if (!counter) return { blocked: false, retryAfter: 0 };
  const elapsed = (Date.now() - counter.startedAt) / 1000;
  if (counter.count < max || elapsed >= windowSec) return { blocked: false, retryAfter: 0 };
  return { blocked: true, retryAfter: Math.max(1, Math.ceil(windowSec - elapsed)) };
}

/** Count one failed attempt; the window starts at the first failure. */
export async function recordFailure(env: Env, scope: LimitScope, id: string): Promise<void> {
  const { windowSec } = LIMITS[scope];
  const name = key(scope, id);
  const counter = await readCounter(env, name);
  const elapsed = counter ? (Date.now() - counter.startedAt) / 1000 : Infinity;
  const next: Counter = counter && elapsed < windowSec
    ? { count: counter.count + 1, startedAt: counter.startedAt }
    : { count: 1, startedAt: Date.now() };
  await env.VAULT_KV.put(name, JSON.stringify(next), { expirationTtl: windowSec });
}

export async function clearFailures(env: Env, scope: LimitScope, id: string): Promise<void> {
  await env.VAULT_KV.delete(key(scope, id));
}
