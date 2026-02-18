import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { json, error } from '../utils/response';
import { getSettings } from './settings';

function extractFileId(url: URL): string | null {
  const parts = url.pathname.split('/');
  const idx = parts.indexOf('share');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

async function hashSharePassword(password: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(password + ':cloudvault-share-salt');
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifySharePassword(input: string, storedHash: string): Promise<boolean> {
  const inputHash = await hashSharePassword(input);
  const encoder = new TextEncoder();
  const a = encoder.encode(inputHash);
  const b = encoder.encode(storedHash);
  if (a.byteLength !== b.byteLength) return false;
  return crypto.subtle.timingSafeEqual(a, b);
}

// ─── Folder Sharing Helpers ───────────────────────────────────────────

export async function getSharedFolders(env: Env): Promise<Set<string>> {
  const folders = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: KV_PREFIX.FOLDER_SHARE, limit: 1000, cursor });
    for (const key of result.keys) {
      const name = key.name.slice(KV_PREFIX.FOLDER_SHARE.length);
      if (name) folders.add(name);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return folders;
}

export function isFolderShared(folderPath: string, sharedFolders: Set<string>): boolean {
  if (!folderPath || folderPath === 'root') return false;
  let current = folderPath;
  while (current) {
    if (sharedFolders.has(current)) return true;
    const lastSlash = current.lastIndexOf('/');
    if (lastSlash < 0) break;
    current = current.substring(0, lastSlash);
  }
  return false;
}

async function getAllFiles(env: Env): Promise<FileMeta[]> {
  const files: FileMeta[] = [];
  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: KV_PREFIX.FILE, limit: 1000, cursor });
    for (const key of result.keys) {
      const raw = await env.VAULT_KV.get(key.name);
      if (raw) {
        try { files.push(JSON.parse(raw)); } catch { /* skip */ }
      }
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return files;
}

// ─── File Share CRUD ──────────────────────────────────────────────────

export async function createShare(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    fileId: string;
    password?: string;
    expiresInDays?: number;
  }>();

  if (!body.fileId) return error('fileId required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + body.fileId);
  if (!raw) return error('File not found', 404);

  const meta: FileMeta = JSON.parse(raw);

  if (meta.shareToken) {
    await env.VAULT_KV.delete(KV_PREFIX.SHARE + meta.shareToken);
  }

  const token = crypto.randomUUID();
  let passwordHash: string | null = null;
  if (body.password) {
    passwordHash = await hashSharePassword(body.password);
  }

  let expiresAt: string | null = null;
  if (body.expiresInDays && body.expiresInDays > 0) {
    expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString();
  }

  meta.shareToken = token;
  meta.sharePassword = passwordHash;
  meta.shareExpiresAt = expiresAt;

  await Promise.all([
    env.VAULT_KV.put(KV_PREFIX.SHARE + token, body.fileId),
    env.VAULT_KV.put(KV_PREFIX.FILE + body.fileId, JSON.stringify(meta)),
  ]);

  return json({
    token,
    url: '/s/' + token,
    expiresAt,
    hasPassword: !!passwordHash,
  });
}

export async function revokeShare(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const fileId = extractFileId(url);
  if (!fileId) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + fileId);
  if (!raw) return error('File not found', 404);

  const meta: FileMeta = JSON.parse(raw);
  if (meta.shareToken) {
    await env.VAULT_KV.delete(KV_PREFIX.SHARE + meta.shareToken);
  }

  meta.shareToken = null;
  meta.sharePassword = null;
  meta.shareExpiresAt = null;

  await env.VAULT_KV.put(KV_PREFIX.FILE + fileId, JSON.stringify(meta));

  return json({ message: 'Share revoked' });
}

export async function getShareInfo(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const fileId = extractFileId(url);
  if (!fileId) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + fileId);
  if (!raw) return error('File not found', 404);

  const meta: FileMeta = JSON.parse(raw);

  return json({
    fileId: meta.id,
    token: meta.shareToken,
    hasPassword: !!meta.sharePassword,
    expiresAt: meta.shareExpiresAt,
    downloads: meta.downloads,
  });
}

// ─── Folder Share Toggle ──────────────────────────────────────────────

export async function shareFolderToggle(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ folder: string }>();
  if (!body.folder?.trim()) return error('Folder name required', 400);

  const folder = body.folder.trim();
  const kvKey = KV_PREFIX.FOLDER_SHARE + folder;
  const existing = await env.VAULT_KV.get(kvKey);

  if (existing) {
    await env.VAULT_KV.delete(kvKey);
    return json({ shared: false, folder });
  }

  await env.VAULT_KV.put(kvKey, JSON.stringify({ folder, sharedAt: new Date().toISOString() }));
  return json({ shared: true, folder });
}

export async function listSharedFolders(_request: Request, env: Env): Promise<Response> {
  const folders = await getSharedFolders(env);
  return json({ folders: Array.from(folders).sort() });
}

// ─── Public Shared Listing (with folder inheritance) ──────────────────

export async function listPublicShared(request: Request, env: Env): Promise<Response> {
  const settings = await getSettings(env);
  const sharedFolders = await getSharedFolders(env);
  const allFiles = await getAllFiles(env);

  const files: Array<{
    id: string; name: string; size: number; type: string;
    token: string | null; folder: string; uploadedAt: string;
  }> = [];

  for (const meta of allFiles) {
    const hasValidShareLink = !!meta.shareToken && !meta.sharePassword &&
      (!meta.shareExpiresAt || new Date(meta.shareExpiresAt) >= new Date());
    const inSharedFolder = isFolderShared(meta.folder, sharedFolders);

    if (!hasValidShareLink && !inSharedFolder) continue;

    if (settings.guestFolders.length > 0) {
      const matchesFilter = settings.guestFolders.some(gf =>
        meta.folder === gf || meta.folder.startsWith(gf + '/')
      );
      if (!matchesFilter) continue;
    }

    files.push({
      id: meta.id, name: meta.name, size: meta.size, type: meta.type,
      token: meta.shareToken || null, folder: meta.folder, uploadedAt: meta.uploadedAt,
    });
  }

  files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return json({
    files,
    sharedFolders: Array.from(sharedFolders).sort(),
    settings: { showLoginButton: settings.showLoginButton },
  });
}

// ─── Public Folder Browse ─────────────────────────────────────────────

export async function browsePublicFolder(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.searchParams.get('path') || '';
  const sharedFolders = await getSharedFolders(env);

  if (!path) {
    return json({ files: [], subfolders: Array.from(sharedFolders).sort(), currentFolder: '' });
  }

  if (!isFolderShared(path, sharedFolders)) {
    return error('Folder not shared', 403);
  }

  const allFiles = await getAllFiles(env);

  const folderFiles = allFiles
    .filter(f => f.folder === path)
    .map(f => ({
      id: f.id, name: f.name, size: f.size, type: f.type,
      token: f.shareToken || null, folder: f.folder, uploadedAt: f.uploadedAt,
    }))
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

  const prefix = path + '/';
  const subfolderSet = new Set<string>();
  for (const f of allFiles) {
    if (f.folder.startsWith(prefix)) {
      const rest = f.folder.slice(prefix.length);
      const slashIdx = rest.indexOf('/');
      const childName = slashIdx >= 0 ? rest.substring(0, slashIdx) : rest;
      if (childName) subfolderSet.add(prefix + childName);
    }
  }

  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: 'folder:' + prefix, limit: 1000, cursor });
    for (const key of result.keys) {
      const name = key.name.slice('folder:'.length);
      if (name.startsWith(prefix)) {
        const rest = name.slice(prefix.length);
        const slashIdx = rest.indexOf('/');
        const childName = slashIdx >= 0 ? rest.substring(0, slashIdx) : rest;
        if (childName) subfolderSet.add(prefix + childName);
      }
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  return json({ files: folderFiles, subfolders: Array.from(subfolderSet).sort(), currentFolder: path });
}

// ─── Public File Download (folder-shared files) ──────────────────────

export async function publicDownload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const fileId = parts[parts.length - 1];
  if (!fileId) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + fileId);
  if (!raw) return error('File not found', 404);

  const meta: FileMeta = JSON.parse(raw);

  const hasPublicLink = !!meta.shareToken && !meta.sharePassword &&
    (!meta.shareExpiresAt || new Date(meta.shareExpiresAt) >= new Date());
  const sharedFolders = await getSharedFolders(env);
  const inSharedFolder = isFolderShared(meta.folder, sharedFolders);

  if (!hasPublicLink && !inSharedFolder) {
    return error('File not publicly accessible', 403);
  }

  const object = await env.VAULT_BUCKET.get(meta.key);
  if (!object) return error('File not found in storage', 404);

  meta.downloads++;
  await env.VAULT_KV.put(KV_PREFIX.FILE + meta.id, JSON.stringify(meta));

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', 'attachment; filename="' + encodeURIComponent(meta.name) + '"');
  headers.set('Content-Length', String(object.size));

  return new Response(object.body, { headers });
}
