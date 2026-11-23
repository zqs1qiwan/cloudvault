// ─── Password hashing ─────────────────────────────────────────────────
//
// One implementation for every password in the app: account logins, share
// links and WebDAV credentials all go through this file. Records are self
// describing (`pbkdf2$<iterations>$<salt>$<hash>`), so the work factor can be
// raised later without a migration flag on each caller.

const PBKDF2_ITERATIONS = 60_000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

/** Anything shorter is rejected at the API boundary, not here. */
export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 200;

async function pbkdf2(password: string, saltHex: string, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const salt = Uint8Array.from(saltHex.match(/.{2}/g) ?? [], (byte) => parseInt(byte, 16));
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BITS,
  );
  return hex(new Uint8Array(bits));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function randomSaltHex(): string {
  return hex(crypto.getRandomValues(new Uint8Array(SALT_BYTES)));
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomSaltHex();
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

/** Fixed-length comparison: no early exit, so timing does not leak the prefix. */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

/**
 * Check a password against a stored hash.
 *
 * `needsUpgrade` is true for records written by the previous single-SHA-256
 * scheme (share links predate this file); the caller rehashes on success
 * instead of forcing everyone to re-open their links.
 */
export async function verifyPassword(
  input: string,
  stored: string,
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (stored.startsWith('pbkdf2$')) {
    const [, iterations, salt, expected] = stored.split('$');
    const rounds = Number(iterations);
    if (!salt || !expected || !Number.isInteger(rounds) || rounds <= 0) return { valid: false, needsUpgrade: false };
    const candidate = await pbkdf2(input, salt, rounds);
    return { valid: constantTimeEqual(candidate, expected), needsUpgrade: false };
  }
  // Unknown format: refuse rather than guess. Legacy share hashes are handled
  // by their own verifier, which knows the salt they used.
  return { valid: false, needsUpgrade: false };
}

export function validatePassword(password: string): string {
  const value = password ?? '';
  if (value.length < MIN_PASSWORD_LENGTH) throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  if (value.length > MAX_PASSWORD_LENGTH) throw new Error(`Password must be at most ${MAX_PASSWORD_LENGTH} characters`);
  return value;
}
