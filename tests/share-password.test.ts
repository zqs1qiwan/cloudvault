import { describe, expect, it } from 'vitest';
import { hashSharePassword, verifySharePassword } from '../src/lib/shares';

describe('share passwords', () => {
  it('hashes with a per-record salt and 60k PBKDF2 rounds', async () => {
    const first = await hashSharePassword('hunter2');
    const second = await hashSharePassword('hunter2');

    expect(first.startsWith('pbkdf2$60000$')).toBe(true);
    expect(first).not.toBe(second); // different salt, same password
    expect((await verifySharePassword('hunter2', first)).valid).toBe(true);
    expect((await verifySharePassword('wrong', first)).valid).toBe(false);
  });

  it('still accepts a legacy single-SHA-256 hash and flags it for upgrade', async () => {
    const legacySalt = ':cloudvault-share-salt';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hunter2' + legacySalt));
    const stored = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');

    expect(await verifySharePassword('hunter2', stored)).toEqual({ valid: true, needsUpgrade: true });
    expect(await verifySharePassword('nope', stored)).toEqual({ valid: false, needsUpgrade: true });
  });

  it('rejects an empty or truncated hash instead of treating it as a match', async () => {
    expect((await verifySharePassword('', '')).valid).toBe(false);
    expect((await verifySharePassword('x', 'pbkdf2$60000$00$')).valid).toBe(false);
  });
});
