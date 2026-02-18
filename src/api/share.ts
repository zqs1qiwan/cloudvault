import { Env, FileMeta, KV_PREFIX, SiteSettings } from '../utils/types';
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

export async function listPublicShared(request: Request, env: Env): Promise<Response> {
  const settings = await getSettings(env);
  const files: Array<{
    name: string; size: number; type: string;
    token: string; folder: string; uploadedAt: string;
  }> = [];

  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: KV_PREFIX.FILE, limit: 1000, cursor });
    for (const key of result.keys) {
      const raw = await env.VAULT_KV.get(key.name);
      if (!raw) continue;
      let meta: FileMeta;
      try { meta = JSON.parse(raw); } catch { continue; }

      if (!meta.shareToken || meta.sharePassword) continue;
      if (meta.shareExpiresAt && new Date(meta.shareExpiresAt) < new Date()) continue;
      if (settings.guestFolders.length > 0 && !settings.guestFolders.includes(meta.folder)) continue;

      files.push({
        name: meta.name, size: meta.size, type: meta.type,
        token: meta.shareToken, folder: meta.folder, uploadedAt: meta.uploadedAt,
      });
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  files.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
  return json({ files, settings: { showLoginButton: settings.showLoginButton } });
}
