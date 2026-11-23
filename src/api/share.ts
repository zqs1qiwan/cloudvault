// ─── Sharing (admin side + guest visibility rules) ────────────────────
//
// A share is one KV record pointing at one object key. One file, one token:
// creating a share twice updates the record instead of minting a second link,
// so revoking always revokes all of them.

import type { Env, FileMeta, FolderShareLink, ShareRecord } from '../utils/types';
import { ROOT, isUnder, normalizeFolder } from '../lib/paths';
import { headObject, listDir, metaFromObject, objectExists } from '../lib/objects';
import { json, error } from '../lib/http';
import {
  deleteFolderLink,
  deleteShare,
  findFolderLink,
  findShareForKey,
  getExcludedFolders,
  getFolderLinkByToken,
  getShare,
  getSharedFolders,
  hashSharePassword,
  isExcluded,
  isFolderShared,
  listShares,
  putFolderLink,
  putShare,
  purgeFolderLinks,
  toggleFolderFlag,
} from '../lib/shares';
import { getSettings } from './settings';
import { KV_PREFIX } from '../utils/types';

function newToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function expiresAtFrom(days: unknown): string | null {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return null;
  return new Date(Date.now() + Math.min(value, 3650) * 86400_000).toISOString();
}

function isExpired(expiresAt: string | null): boolean {
  return !!expiresAt && Date.parse(expiresAt) <= Date.now();
}

export function shareIsUsable(record: ShareRecord): boolean {
  return !isExpired(record.expiresAt ?? null);
}

// ─── File shares ──────────────────────────────────────────────────────

export async function handleCreateShare(request: Request, env: Env): Promise<Response> {
  let body: { key?: unknown; password?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  // The object key is the file's identity everywhere else in the API; this
  // endpoint used to take a separately minted `fileId`, which is exactly the
  // second identifier this refactor removed.
  const key = typeof body.key === 'string' ? body.key : '';
  if (!key) return error('Missing key', 400);
  if (!(await objectExists(env, key))) return error('File not found', 404);

  const existing = await findShareForKey(env, key);
  const password = typeof body.password === 'string' && body.password ? body.password : null;
  const expiresAt = expiresAtFrom(body.expiresInDays);

  const token = existing?.token ?? newToken();
  const record: ShareRecord = {
    key,
    createdAt: existing ? (await getShare(env, token))?.createdAt ?? new Date().toISOString() : new Date().toISOString(),
    passwordHash: password ? await hashSharePassword(password) : null,
    expiresAt,
    downloads: existing?.downloads ?? 0,
  };

  await putShare(env, token, record);
  return json({
    token,
    expiresAt,
    hasPassword: !!record.passwordHash,
    downloads: record.downloads,
  });
}

export async function handleRevokeShare(key: string, env: Env): Promise<Response> {
  const share = await findShareForKey(env, key);
  if (!share) return error('Share not found', 404);
  await deleteShare(env, share.token);
  return json({ message: 'Share link revoked' });
}

// ─── Folder visibility ────────────────────────────────────────────────

export async function handleFolderShareToggle(request: Request, env: Env): Promise<Response> {
  return toggle(request, env, KV_PREFIX.FOLDER_SHARE);
}

export async function handleFolderExcludeToggle(request: Request, env: Env): Promise<Response> {
  return toggle(request, env, KV_PREFIX.FOLDER_SHARE_EXCLUDE);
}

async function toggle(request: Request, env: Env, prefix: string): Promise<Response> {
  let body: { folder?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }
  try {
    const result = await toggleFolderFlag(env, prefix, String(body.folder ?? ''));
    return json(result);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── Folder share links ───────────────────────────────────────────────

export async function handleGetFolderLink(folder: string, env: Env): Promise<Response> {
  try {
    const found = await findFolderLink(env, folder);
    if (!found) return json({ token: null, hasPassword: false, expiresAt: null, folder });
    return json({
      token: found.token,
      hasPassword: !!found.link.passwordHash,
      expiresAt: found.link.expiresAt ?? null,
      folder: found.link.folder,
    });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleCreateFolderLink(request: Request, env: Env): Promise<Response> {
  let body: { folder?: unknown; password?: unknown; expiresInDays?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const folder = normalizeFolder(String(body.folder ?? ''));
    if (folder === ROOT) return error('Root cannot be shared', 400);

    const found = await findFolderLink(env, folder);
    const token = found?.token ?? newToken();
    const password = typeof body.password === 'string' && body.password ? body.password : null;
    const link: FolderShareLink = {
      folder,
      createdAt: found?.link.createdAt ?? new Date().toISOString(),
      passwordHash: password ? await hashSharePassword(password) : null,
      expiresAt: expiresAtFrom(body.expiresInDays),
    };
    await putFolderLink(env, token, link);
    return json({ token, folder, hasPassword: !!link.passwordHash, expiresAt: link.expiresAt });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleRevokeFolderLink(folder: string, env: Env): Promise<Response> {
  try {
    const found = await findFolderLink(env, folder);
    if (!found) return error('Share link not found', 404);
    await deleteFolderLink(env, found.token);
    return json({ message: 'Folder share link revoked' });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function revokeFolderLinksUnder(folder: string, env: Env): Promise<void> {
  await purgeFolderLinks(env, folder);
}

// ─── Guest visibility ─────────────────────────────────────────────────

export interface GuestFolderView {
  files: FileMeta[];
  subfolders: string[];
}

/**
 * One implementation of "may a guest see this folder", used by the public
 * folder endpoint, the clean-URL download and the folder-link browser alike.
 * Before this existed, the folder-link path simply forgot to consult the
 * exclude list and happily served folders that had been hidden.
 */
export interface GuestScope {
  /** Folder the link grants access to. */
  root: string;
  /** True when access comes from a public share (not a link). */
  publicRoot: boolean;
}

export async function guestFolderView(env: Env, requested: string, scope: GuestScope): Promise<GuestFolderView | null> {
  const path = normalizeFolder(requested);
  if (path === ROOT) return null;
  if (!isUnder(path, scope.root)) return null;

  const excluded = await getExcludedFolders(env);
  if (isExcluded(path, excluded)) return null;

  if (scope.publicRoot) {
    const shared = await getSharedFolders(env);
    if (!isFolderShared(path, shared, excluded)) return null;
  }

  const page = await listDir(env, path, { limit: 1000 });
  const files = page.objects.map((object) => metaFromObject(object));
  const subfolders = page.folders.filter((folder) => !isExcluded(folder, excluded));

  return { files, subfolders };
}

/** Resolve a folder-link token to its scope, honouring expiry. */
export async function folderLinkScope(env: Env, token: string): Promise<FolderShareLink | null> {
  const link = await getFolderLinkByToken(env, token);
  if (!link) return null;
  if (isExpired(link.expiresAt ?? null)) return null;
  return link;
}

export { isExpired, hashSharePassword };
