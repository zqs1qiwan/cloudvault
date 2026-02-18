import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { json, error } from '../utils/response';

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
