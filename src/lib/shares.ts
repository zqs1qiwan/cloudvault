// ─── Shares ───────────────────────────────────────────────────────────
//
// Sharing is its own small entity, kept in KV and keyed by token. A share
// record points at an object key; nothing about sharing is stored on the
// object, so the object stays immutable and a rename only has to retarget the
// token (see `retargetShares`).

import type { Env, FolderShareLink, ShareRecord } from '../utils/types';
import { KV_PREFIX } from '../utils/types';
import { ROOT, isUnder, normalizeFolder } from './paths';
import type { ShareMap, ShareSummary } from './objects';
import { constantTimeEqual, hashPassword, sha256Hex, verifyPassword } from './passwords';

const LEGACY_PASSWORD_SALT = ':cloudvault-share-salt';

// ─── Password hashing ─────────────────────────────────────────────────
//
// Share passwords use the same PBKDF2 records as account passwords (see
// lib/passwords.ts). Only the legacy SHA-256 scheme is specific to share links:
// it salted with a constant, so it is verified here and upgraded on next use.

export function hashSharePassword(password: string): Promise<string> {
  return hashPassword(password);
}

/** Returns whether the password matches and whether the record should be rehashed. */
export async function verifySharePassword(
  input: string,
  stored: string,
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (stored.startsWith('pbkdf2$')) return verifyPassword(input, stored);
  const legacy = await sha256Hex(input + LEGACY_PASSWORD_SALT);
  return { valid: constantTimeEqual(legacy, stored), needsUpgrade: true };
}

// ─── File shares ──────────────────────────────────────────────────────

function shareKey(token: string): string {
  return KV_PREFIX.SHARE + token;
}

export async function getShare(env: Env, token: string): Promise<ShareRecord | null> {
  const raw = await env.VAULT_KV.get(shareKey(token));
  if (!raw) return null;
  try {
    const record = JSON.parse(raw) as ShareRecord;
    return { ...record, downloads: record.downloads ?? 0 };
  } catch {
    return null;
  }
}

export async function putShare(env: Env, token: string, record: ShareRecord): Promise<void> {
  await env.VAULT_KV.put(shareKey(token), JSON.stringify(record));
}

export async function deleteShare(env: Env, token: string): Promise<void> {
  await env.VAULT_KV.delete(shareKey(token));
}

/** Every share token, keyed by the object key it resolves to. */
export async function listShares(env: Env): Promise<ShareMap> {
  const map: ShareMap = new Map();
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.SHARE, cursor, limit: 1000 });
    const tokens = page.keys.map((entry) => entry.name.slice(KV_PREFIX.SHARE.length));
    const values = await Promise.all(page.keys.map((entry) => env.VAULT_KV.get(entry.name)));
    values.forEach((raw, index) => {
      if (!raw) return;
      let record: ShareRecord;
      try {
        record = JSON.parse(raw) as ShareRecord;
      } catch {
        return;
      }
      if (!record.key) return;
      const summary: ShareSummary = {
        token: tokens[index],
        expiresAt: record.expiresAt ?? null,
        hasPassword: !!record.passwordHash,
        downloads: record.downloads ?? 0,
      };
      map.set(record.key, summary);
    });
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return map;
}

/** Drop every share that points at one of these keys. */
export async function deleteSharesForKeys(env: Env, keys: Set<string>): Promise<void> {
  if (keys.size === 0) return;
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.SHARE, cursor, limit: 1000 });
    const tokens: string[] = [];
    for (const entry of page.keys) {
      const token = entry.name.slice(KV_PREFIX.SHARE.length);
      const raw = await env.VAULT_KV.get(entry.name);
      if (!raw) continue;
      try {
        if (keys.has((JSON.parse(raw) as ShareRecord).key)) tokens.push(token);
      } catch {
        tokens.push(token); // unreadable record: remove it rather than keep a ghost
      }
    }
    await Promise.all(tokens.map((token) => env.VAULT_KV.delete(shareKey(token))));
    if (page.list_complete) break;
    cursor = page.cursor;
  }
}

/** Keep share links alive across a rename or a move; one scan, many rewrites. */
export async function retargetSharesBulk(env: Env, moves: Map<string, string>): Promise<void> {
  if (moves.size === 0) return;
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.SHARE, cursor, limit: 1000 });
    for (const entry of page.keys) {
      const raw = await env.VAULT_KV.get(entry.name);
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as ShareRecord;
        const next = moves.get(record.key);
        if (!next) continue;
        await env.VAULT_KV.put(entry.name, JSON.stringify({ ...record, key: next }));
      } catch {
        // Unreadable records are ignored here; `deleteSharesForKeys` cleans them.
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
}

export async function retargetShares(env: Env, fromKey: string, toKey: string): Promise<void> {
  await retargetSharesBulk(env, new Map([[fromKey, toKey]]));
}

/**
 * Best-effort download counter. It is deliberately off the response path: a
 * losing race costs a +1, never a failed download, and nothing here touches
 * the object or the response headers.
 */
export async function countShareDownload(env: Env, token: string, ctx?: ExecutionContext): Promise<void> {
  const bump = async () => {
    const record = await getShare(env, token);
    if (!record) return;
    await putShare(env, token, { ...record, downloads: (record.downloads ?? 0) + 1 });
  };
  if (ctx) ctx.waitUntil(bump().catch(() => {}));
  else await bump().catch(() => {});
}

/**
 * The single file's share, found by scanning tokens. Used only for one-file
 * operations, where a handfull of reads beats a second index.
 */
export async function findShareForKey(env: Env, key: string): Promise<ShareSummary | null> {
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.SHARE, cursor, limit: 1000 });
    const tokens = page.keys.map((entry) => entry.name.slice(KV_PREFIX.SHARE.length));
    const values = await Promise.all(page.keys.map((entry) => env.VAULT_KV.get(entry.name)));
    const found = values.findIndex((raw) => {
      if (!raw) return false;
      try {
        return (JSON.parse(raw) as ShareRecord).key === key;
      } catch {
        return false;
      }
    });
    if (found >= 0) {
      const record = JSON.parse(values[found] as string) as ShareRecord;
      return {
        token: tokens[found],
        expiresAt: record.expiresAt ?? null,
        hasPassword: !!record.passwordHash,
        downloads: record.downloads ?? 0,
      };
    }
    if (page.list_complete) return null;
    cursor = page.cursor;
  }
}

/**
 * One KV listing call, typed. A local helper because `page.cursor` feeding the
 * next call's `cursor` is enough to send inference into a cycle.
 */
function listKvPage(env: Env, prefix: string, cursor?: string) {
  return env.VAULT_KV.list({ prefix, cursor, limit: 1000 });
}

/**
 * One-time retirement of the KV file/folder index. Rows that still carry a
 * share token are turned into proper share records first, so existing links
 * keep working; everything else is deleted.
 */
export async function migrateLegacyIndex(env: Env): Promise<{ removed: number; shares: number }> {
  let removed = 0;
  let converted = 0;

  let cursor: string | undefined;
  for (;;) {
    const page = await listKvPage(env, KV_PREFIX.LEGACY_FILE, cursor);
    for (const entry of page.keys) {
      const raw = await env.VAULT_KV.get(entry.name);
      if (raw) {
        try {
          const row = JSON.parse(raw) as {
            key?: string;
            shareToken?: string;
            sharePassword?: string | null;
            shareExpiresAt?: string | null;
            downloads?: number;
            uploadedAt?: string;
          };
          if (row.shareToken && row.key && !(await getShare(env, row.shareToken))) {
            await putShare(env, row.shareToken, {
              key: row.key,
              createdAt: row.uploadedAt ?? new Date().toISOString(),
              passwordHash: row.sharePassword ?? null,
              expiresAt: row.shareExpiresAt ?? null,
              downloads: row.downloads ?? 0,
            });
            converted++;
          }
        } catch {
          // Unreadable legacy row: nothing to preserve, just drop it.
        }
      }
      await env.VAULT_KV.delete(entry.name);
      removed++;
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }

  cursor = undefined;
  for (;;) {
    const page = await listKvPage(env, KV_PREFIX.LEGACY_FOLDER, cursor);
    for (const entry of page.keys) {
      await env.VAULT_KV.delete(entry.name);
      removed++;
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }

  return { removed, shares: converted };
}

// ─── Folder shares (guest visibility) ─────────────────────────────────

export async function getSharedFolders(env: Env): Promise<Set<string>> {
  return listFolderFlags(env, KV_PREFIX.FOLDER_SHARE);
}

export async function getExcludedFolders(env: Env): Promise<Set<string>> {
  return listFolderFlags(env, KV_PREFIX.FOLDER_SHARE_EXCLUDE);
}

async function listFolderFlags(env: Env, prefix: string): Promise<Set<string>> {
  const folders = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix, cursor, limit: 1000 });
    for (const entry of page.keys) {
      const name = entry.name.slice(prefix.length);
      if (name) folders.add(name);
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return folders;
}

/**
 * The single rule for "is this folder visible to guests": an ancestor (or the
 * folder itself) is shared, and no ancestor is excluded. Both the guest API and
 * the folder-share-link API answer through this, so the two cannot drift apart.
 */
export function isFolderShared(
  folderPath: string,
  sharedFolders: Set<string>,
  excludedFolders?: Set<string>,
): boolean {
  if (!folderPath || folderPath === ROOT) return false;
  const ancestors: string[] = [];
  let current = folderPath;
  while (current) {
    ancestors.push(current);
    const slash = current.lastIndexOf('/');
    if (slash < 0) break;
    current = current.slice(0, slash);
  }
  if (excludedFolders && ancestors.some((folder) => excludedFolders.has(folder))) return false;
  return ancestors.some((folder) => sharedFolders.has(folder));
}

/** True when a folder is excluded, or sits under an excluded folder. */
export function isExcluded(folderPath: string, excludedFolders: Set<string>): boolean {
  if (!folderPath || folderPath === ROOT) return false;
  for (const excluded of excludedFolders) {
    if (isUnder(folderPath, excluded)) return true;
  }
  return false;
}

export async function toggleFolderFlag(
  env: Env,
  prefix: string,
  folder: string,
): Promise<{ enabled: boolean; folder: string }> {
  const normalized = normalizeFolder(folder);
  if (normalized === ROOT) throw new Error('Root cannot be shared');
  const key = prefix + normalized;
  const existing = await env.VAULT_KV.get(key);
  if (existing) {
    await env.VAULT_KV.delete(key);
    return { enabled: false, folder: normalized };
  }
  await env.VAULT_KV.put(key, JSON.stringify({ folder: normalized, at: new Date().toISOString() }));
  return { enabled: true, folder: normalized };
}

/** Every folder-level flag that mentions `folder` or one of its children. */
export async function purgeFolderFlags(env: Env, folder: string): Promise<void> {
  const prefixes = [KV_PREFIX.FOLDER_SHARE, KV_PREFIX.FOLDER_SHARE_EXCLUDE];
  await Promise.all(prefixes.map(async (prefix) => {
    let cursor: string | undefined;
    for (;;) {
      const page = await env.VAULT_KV.list({ prefix, cursor, limit: 1000 });
      const doomed = page.keys
        .map((entry) => entry.name.slice(prefix.length))
        .filter((name) => isUnder(name, folder));
      await Promise.all(doomed.map((name) => env.VAULT_KV.delete(prefix + name)));
      if (page.list_complete) break;
      cursor = page.cursor;
    }
  }));
}

export async function renameFolderFlags(env: Env, from: string, to: string): Promise<void> {
  const prefixes = [KV_PREFIX.FOLDER_SHARE, KV_PREFIX.FOLDER_SHARE_EXCLUDE];
  await Promise.all(prefixes.map(async (prefix) => {
    let cursor: string | undefined;
    for (;;) {
      const page = await env.VAULT_KV.list({ prefix, cursor, limit: 1000 });
      for (const entry of page.keys) {
        const name = entry.name.slice(prefix.length);
        if (!isUnder(name, from)) continue;
        const raw = await env.VAULT_KV.get(entry.name);
        const next = to + name.slice(from.length);
        if (raw) await env.VAULT_KV.put(prefix + next, raw);
        await env.VAULT_KV.delete(entry.name);
      }
      if (page.list_complete) break;
      cursor = page.cursor;
    }
  }));
}

// ─── Folder share links ───────────────────────────────────────────────

function linkKey(token: string): string {
  return KV_PREFIX.FOLDER_SHARE_LINK + token;
}

export async function getFolderLinkByToken(env: Env, token: string): Promise<FolderShareLink | null> {
  const raw = await env.VAULT_KV.get(linkKey(token));
  if (!raw) return null;
  try {
    const link = JSON.parse(raw) as FolderShareLink;
    return link.folder ? link : null;
  } catch {
    return null;
  }
}

/**
 * Folder → link lookup without a reverse index: links are few, so one listing
 * plus one read per link is cheaper than keeping a second key in sync forever.
 */
export async function findFolderLink(
  env: Env,
  folder: string,
): Promise<{ token: string; link: FolderShareLink } | null> {
  const normalized = normalizeFolder(folder);
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.FOLDER_SHARE_LINK, cursor, limit: 1000 });
    for (const entry of page.keys) {
      const token = entry.name.slice(KV_PREFIX.FOLDER_SHARE_LINK.length);
      const raw = await env.VAULT_KV.get(entry.name);
      if (!raw) continue;
      try {
        const link = JSON.parse(raw) as FolderShareLink;
        if (link.folder === normalized) return { token, link };
      } catch {
        // skip corrupt record
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
  return null;
}

export async function putFolderLink(env: Env, token: string, link: FolderShareLink): Promise<void> {
  await env.VAULT_KV.put(linkKey(token), JSON.stringify(link));
}

export async function deleteFolderLink(env: Env, token: string): Promise<void> {
  await env.VAULT_KV.delete(linkKey(token));
}

/** Remove the link for one folder and for every folder beneath it. */
export async function purgeFolderLinks(env: Env, folder: string): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.FOLDER_SHARE_LINK, cursor, limit: 1000 });
    const doomed: string[] = [];
    for (const entry of page.keys) {
      const raw = await env.VAULT_KV.get(entry.name);
      if (!raw) continue;
      try {
        if (isUnder((JSON.parse(raw) as FolderShareLink).folder, folder)) doomed.push(entry.name);
      } catch {
        // leave unreadable records alone
      }
    }
    await Promise.all(doomed.map((name) => env.VAULT_KV.delete(name)));
    if (page.list_complete) break;
    cursor = page.cursor;
  }
}

export async function retargetFolderLinks(env: Env, from: string, to: string): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.FOLDER_SHARE_LINK, cursor, limit: 1000 });
    for (const entry of page.keys) {
      const raw = await env.VAULT_KV.get(entry.name);
      if (!raw) continue;
      try {
        const link = JSON.parse(raw) as FolderShareLink;
        if (!isUnder(link.folder, from)) continue;
        await env.VAULT_KV.put(entry.name, JSON.stringify({ ...link, folder: to + link.folder.slice(from.length) }));
      } catch {
        // skip corrupt record
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }
}
