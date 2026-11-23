// ─── Public downloads and share pages ─────────────────────────────────
//
// Everything a guest can reach: the share page, its download and preview
// endpoints, folder links, and the "clean" URLs (`/<folder>/<file>`).
//
// Two rules apply to all of them, in one place:
//   1. the token must be alive and, if it has a password, the cookie must match;
//   2. the requested key must live inside the folder the link grants, and must
//      not be excluded from sharing.

import type { Env, FileMeta } from '../utils/types';
import { KV_PREFIX } from '../utils/types';
import { ROOT, folderOf, isUnder, nameOf, normalizeFolder } from '../lib/paths';
import { headObject, metaFromObject } from '../lib/objects';
import { error, fetchAssetHtml, html, json, jsonIsland, serveObject, injectBranding } from '../lib/http';
import { getSettings } from '../api/settings';
import { folderLinkScope, guestFolderView, shareIsUsable } from '../api/share';
import { countShareDownload, getExcludedFolders, getShare, getSharedFolders, isExcluded, isFolderShared, verifySharePassword } from '../lib/shares';
import { checkLimit, clientId, recordFailure, clearFailures } from '../lib/ratelimit';
import { constantTimeEqual } from '../lib/passwords';
import { getInstanceSecret } from '../lib/secret';

const COOKIE_MAX_AGE = 3600;

// ─── Password gate ────────────────────────────────────────────────────

async function cookieName(token: string): Promise<string> {
  return `share_auth_${token}`;
}

async function signature(env: Env, token: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(await getInstanceSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`share:${token}`));
  return Array.from(new Uint8Array(mac), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hasAccessCookie(request: Request, env: Env, token: string): Promise<boolean> {
  const name = await cookieName(token);
  const cookie = request.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === name) return constantTimeEqual(rest.join('='), await signature(env, token));
  }
  return false;
}

async function grantAccess(env: Env, token: string): Promise<string> {
  const name = await cookieName(token);
  return `${name}=${await signature(env, token)}; Path=/s/${token}; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`;
}

export async function handleShareVerify(token: string, request: Request, env: Env): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const password = String(form?.get('password') ?? '');

  const guard = await checkLimit(env, 'sharePassword', `${token}:${clientId(request)}`);
  if (guard.blocked) {
    return json({ error: 'Too many attempts', retryAfter: guard.retryAfter }, 429, 'no-store');
  }

  const record = await getShare(env, token);
  const link = record ? null : await folderLinkScope(env, token);
  const hash = record?.passwordHash ?? link?.passwordHash ?? null;

  if (!hash) return error('This link is not password protected', 400);
  if (!password) return error('Password required', 400);

  const result = await verifySharePassword(password, hash);
  if (!result.valid) {
    await recordFailure(env, 'sharePassword', `${token}:${clientId(request)}`);
    return error('Incorrect password', 401);
  }
  await clearFailures(env, 'sharePassword', `${token}:${clientId(request)}`);

  const headers = { Location: `/s/${token}`, 'Set-Cookie': await grantAccess(env, token) };
  return new Response(null, { status: 303, headers });
}

// ─── Share page ───────────────────────────────────────────────────────

export async function handleSharePage(request: Request, env: Env, token: string, url: URL): Promise<Response> {
  const body = await fetchAssetHtml(env.ASSETS, request.url, '/share.html');
  const settings = await getSettings(env);

  const record = await getShare(env, token);
  let data: Record<string, unknown>;

  if (record) {
    if (!shareIsUsable(record)) {
      data = { error: 'This share link has expired.' };
    } else if (record.passwordHash && !(await hasAccessCookie(request, env, token))) {
      data = { needsPassword: true };
    } else {
      const head = await headObject(env, record.key);
      if (!head) {
        data = { error: 'This file no longer exists.' };
      } else {
        const meta: FileMeta = { ...metaFromObject(head), shareToken: token, downloads: record.downloads ?? 0 };
        data = {
          id: meta.id,
          key: meta.key,
          name: meta.name,
          size: meta.size,
          type: meta.type,
          uploadedAt: meta.uploadedAt,
          downloads: meta.downloads,
        };
      }
    }
  } else {
    const link = await folderLinkScope(env, token);
    if (!link) {
      data = { error: 'This share link may have expired or been revoked.' };
    } else if (link.passwordHash && !(await hasAccessCookie(request, env, token))) {
      data = { needsPassword: true };
    } else {
      const requested = url.searchParams.get('path') || link.folder;
      const view = await guestFolderView(env, requested, { root: link.folder, publicRoot: false });
      if (!view) {
        data = { error: 'This folder is no longer available.' };
      } else {
        const relative = normalizeFolder(requested) === link.folder
          ? ''
          : normalizeFolder(requested).slice(link.folder.length + 1);
        data = {
          isFolder: true,
          folderName: link.folder,
          folder: link.folder,
          subpath: relative,
          subfolders: view.subfolders,
          files: view.files.map((file) => ({
            id: file.id,
            key: file.key,
            name: file.name,
            size: file.size,
            type: file.type,
            uploadedAt: file.uploadedAt,
          })),
        };
      }
    }
  }

  const page = injectBranding(body, settings).replace(
    /<script id="file-data"[^>]*>[\s\S]*?<\/script>/,
    jsonIsland('file-data', data),
  );
  return html(page, 200, { 'Cache-Control': 'no-store' });
}

// ─── Resolving a public request to an object key ──────────────────────

interface ResolvedShare {
  key: string;
  downloadsToken: string | null;
}

/**
 * Gate for the file endpoints: token → live record → password cookie → key.
 * Returns null when the caller must get a 404.
 */
async function resolveFileShare(env: Env, request: Request, token: string): Promise<ResolvedShare | null> {
  const record = await getShare(env, token);
  if (!record || !shareIsUsable(record)) return null;
  if (record.passwordHash && !(await hasAccessCookie(request, env, token))) return null;
  if (!(await headObject(env, record.key))) return null;
  return { key: record.key, downloadsToken: token };
}

export async function handleShareDownload(
  request: Request,
  env: Env,
  token: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const resolved = await resolveFileShare(env, request, token);
  if (!resolved) return error('Link not available', 404);

  const response = await serveObject(request, env.VAULT_BUCKET, resolved.key, {
    name: nameOf(resolved.key),
    disposition: 'attachment',
    cacheControl: 'private, max-age=0',
  });
  if (!response) return error('File not found', 404);

  if (response.status === 200 && resolved.downloadsToken) {
    await countShareDownload(env, resolved.downloadsToken, ctx);
  }
  return response;
}

export async function handleSharePreview(request: Request, env: Env, token: string): Promise<Response> {
  const resolved = await resolveFileShare(env, request, token);
  if (!resolved) return error('Link not available', 404);

  const response = await serveObject(request, env.VAULT_BUCKET, resolved.key, {
    name: nameOf(resolved.key),
    disposition: 'inline',
    cacheControl: 'private, max-age=3600',
  });
  return response ?? error('File not found', 404);
}

/** A key asked for through a folder link: same link, but scoped to its folder. */
async function folderLinkKey(
  env: Env,
  request: Request,
  token: string,
  rawKey: string | null,
): Promise<{ key: string } | null> {
  const link = await folderLinkScope(env, token);
  if (!link) return null;
  if (link.passwordHash && !(await hasAccessCookie(request, env, token))) return null;

  const key = rawKey ?? '';
  if (!key || !isUnder(folderOf(key), link.folder)) return null;

  const excluded = await getExcludedFolders(env);
  if (isExcluded(folderOf(key), excluded)) return null;

  return (await headObject(env, key)) ? { key } : null;
}

export async function handleFolderShareDownload(request: Request, env: Env, token: string, url: URL): Promise<Response> {
  const resolved = await folderLinkKey(env, request, token, url.searchParams.get('key'));
  if (!resolved) return error('File not found', 404);
  const response = await serveObject(request, env.VAULT_BUCKET, resolved.key, {
    name: nameOf(resolved.key),
    disposition: 'attachment',
    cacheControl: 'private, max-age=0',
  });
  return response ?? error('File not found', 404);
}

export async function handleFolderSharePreview(request: Request, env: Env, token: string, url: URL): Promise<Response> {
  const resolved = await folderLinkKey(env, request, token, url.searchParams.get('key'));
  if (!resolved) return error('File not found', 404);
  const response = await serveObject(request, env.VAULT_BUCKET, resolved.key, {
    name: nameOf(resolved.key),
    disposition: 'inline',
    cacheControl: 'private, max-age=3600',
  });
  return response ?? error('File not found', 404);
}

// ─── Clean URLs (`/<folder>/<file>`) ─────────────────────────────────

/**
 * SEO-friendly direct links only work for files inside a publicly shared
 * folder - otherwise a guessed path would be a download, which is exactly the
 * leak this rewrite exists to close.
 */
export async function handleCleanDownload(request: Request, env: Env, rawPath: string): Promise<Response> {
  let key: string;
  try {
    key = rawPath.split('/').map((part) => decodeURIComponent(part)).join('/');
  } catch {
    return error('File not found', 404);
  }
  if (!key || key.includes('..')) return error('File not found', 404);

  const head = await headObject(env, key);
  if (!head) return error('File not found', 404);

  const folder = folderOf(key);
  const [shared, excluded] = await Promise.all([getSharedFolders(env), getExcludedFolders(env)]);
  if (folder === ROOT || !isFolderShared(folder, shared, excluded)) {
    return error('File not found', 404);
  }

  const response = await serveObject(request, env.VAULT_BUCKET, key, {
    name: nameOf(key),
    disposition: 'attachment',
    cacheControl: 'public, max-age=300',
  });
  return response ?? error('File not found', 404);
}

// ─── Guest folder endpoints ──────────────────────────────────────────

export async function handleGuestFolder(url: URL, env: Env): Promise<Response> {
  const path = url.searchParams.get('path') ?? '';
  const [shared, excluded] = await Promise.all([getSharedFolders(env), getExcludedFolders(env)]);
  if (!isFolderShared(normalizeFolder(path), shared, excluded)) return error('Folder not found', 404);

  const view = await guestFolderView(env, path, { root: sharedRoot(path, shared), publicRoot: true });
  if (!view) return error('Folder not found', 404);
  return json(view, 200, 'public, max-age=15');
}

function sharedRoot(path: string, shared: Set<string>): string {
  const normalized = normalizeFolder(path);
  const ancestors: string[] = [];
  let current = normalized;
  while (current) {
    ancestors.unshift(current);
    const slash = current.lastIndexOf('/');
    if (slash < 0) break;
    current = current.slice(0, slash);
  }
  return ancestors.find((folder) => shared.has(folder)) ?? normalized;
}

/**
 * The guest index: every file the owner explicitly shared, plus the shared
 * folders a guest may open.
 *
 * A per-file link is an explicit decision by the owner, so it is listed even
 * when the file happens to sit in a folder that is not public - the old code
 * filtered these out by accident and the guest page silently lost entries.
 */
export async function handleGuestIndex(env: Env): Promise<Response> {
  const settings = await getSettings(env);
  const shared = await getSharedFolders(env);
  const excluded = await getExcludedFolders(env);

  const files: FileMeta[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await env.VAULT_KV.list({ prefix: KV_PREFIX.SHARE, cursor, limit: 1000 });
    const tokens = page.keys.map((entry) => entry.name.slice(KV_PREFIX.SHARE.length));
    const values = await Promise.all(page.keys.map((entry) => env.VAULT_KV.get(entry.name)));
    for (let i = 0; i < values.length; i++) {
      const raw = values[i];
      if (!raw) continue;
      try {
        const record = JSON.parse(raw) as { key: string; expiresAt: string | null; downloads: number };
        if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) continue;
        const head = await headObject(env, record.key);
        if (!head) continue;
        files.push({
          ...metaFromObject(head),
          shareToken: tokens[i],
          downloads: record.downloads ?? 0,
        });
      } catch {
        // skip unreadable record
      }
    }
    if (page.list_complete) break;
    cursor = page.cursor;
  }

  return json({
    files,
    sharedFolders: [...shared],
    settings: { showLoginButton: settings.showLoginButton !== false },
  }, 200, 'public, max-age=15');
}
