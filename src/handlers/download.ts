import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { error, getPreviewType, fetchAssetHtml, injectBranding } from '../utils/response';
import { verifySharePassword, resolveFolderShareToken, browseFolderShareLink } from '../api/share';
import { getSettings } from '../api/settings';

function extractToken(url: URL): string | null {
  const parts = url.pathname.split('/');
  const sIdx = parts.indexOf('s');
  return sIdx >= 0 && parts[sIdx + 1] ? parts[sIdx + 1] : null;
}

async function resolveShare(token: string, env: Env): Promise<{ meta: FileMeta; expired: boolean } | null> {
  const fileId = await env.VAULT_KV.get(KV_PREFIX.SHARE + token);
  if (!fileId) return null;

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + fileId);
  if (!raw) return null;

  const meta: FileMeta = JSON.parse(raw);
  const expired = !!meta.shareExpiresAt && new Date(meta.shareExpiresAt) < new Date();
  return { meta, expired };
}

function hasValidShareCookie(request: Request, token: string): boolean {
  const cookies = request.headers.get('Cookie') || '';
  return cookies.includes('share_' + token + '=verified');
}

export async function handleSharePage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return error('Invalid share link', 400);

  const result = await resolveShare(token, env);
  if (result) {
    if (result.expired) {
      return serveShareHtml(env, request, { error: 'This share link has expired.' });
    }
    if (result.meta.sharePassword && !hasValidShareCookie(request, token)) {
      return serveShareHtml(env, request, { needsPassword: true });
    }
    return serveShareHtml(env, request, {
      name: result.meta.name,
      size: result.meta.size,
      type: result.meta.type,
      uploadedAt: result.meta.uploadedAt,
      downloads: result.meta.downloads,
      previewType: getPreviewType(result.meta.name, result.meta.type),
    });
  }

  const folderLink = await resolveFolderShareToken(token, env);
  if (!folderLink) {
    return serveShareHtml(env, request, { error: 'This share link is invalid or has been revoked.' });
  }

  if (folderLink.expiresAt && new Date(folderLink.expiresAt) < new Date()) {
    return serveShareHtml(env, request, { error: 'This share link has expired.' });
  }

  if (folderLink.passwordHash && !hasValidShareCookie(request, token)) {
    return serveShareHtml(env, request, { needsPassword: true, isFolder: true });
  }

  const subpath = url.searchParams.get('path') || '';
  const browseResult = await browseFolderShareLink(folderLink.folder, subpath, env);
  const folderName = folderLink.folder.split('/').pop() || folderLink.folder;

  return serveShareHtml(env, request, {
    isFolder: true,
    folderName,
    folder: folderLink.folder,
    subpath,
    files: browseResult.files,
    subfolders: browseResult.subfolders,
  });
}

export async function handleFolderShareDownload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return error('Invalid share link', 400);

  const folderLink = await resolveFolderShareToken(token, env);
  if (!folderLink) return error('Share link invalid', 404);
  if (folderLink.expiresAt && new Date(folderLink.expiresAt) < new Date()) return error('Share link expired', 404);
  if (folderLink.passwordHash && !hasValidShareCookie(request, token)) return error('Password required', 403);

  const fileId = url.searchParams.get('fileId');
  if (!fileId) return error('fileId required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + fileId);
  if (!raw) return error('File not found', 404);

  const meta: FileMeta = JSON.parse(raw);
  if (!meta.folder.startsWith(folderLink.folder) && meta.folder !== folderLink.folder) {
    return error('File not in shared folder', 403);
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

export async function handleFolderSharePreview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return error('Invalid share link', 400);

  const folderLink = await resolveFolderShareToken(token, env);
  if (!folderLink) return error('Share link invalid', 404);
  if (folderLink.expiresAt && new Date(folderLink.expiresAt) < new Date()) return error('Share link expired', 404);
  if (folderLink.passwordHash && !hasValidShareCookie(request, token)) return error('Password required', 403);

  const fileId = url.searchParams.get('fileId');
  if (!fileId) return error('fileId required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + fileId);
  if (!raw) return error('File not found', 404);

  const meta: FileMeta = JSON.parse(raw);
  if (!meta.folder.startsWith(folderLink.folder) && meta.folder !== folderLink.folder) {
    return error('File not in shared folder', 403);
  }

  const object = await env.VAULT_BUCKET.get(meta.key);
  if (!object) return error('File not found in storage', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Type', meta.type || 'application/octet-stream');
  headers.set('Content-Disposition', 'inline');
  headers.set('Cache-Control', 'public, max-age=3600');

  return new Response(object.body, { headers });
}

async function serveShareHtml(env: Env, request: Request, fileData: Record<string, unknown>): Promise<Response> {
  const settings = await getSettings(env);
  let html = await fetchAssetHtml(env.ASSETS, request.url, '/share.html');

  html = injectBranding(html, { siteName: settings.siteName, siteIconUrl: settings.siteIconUrl });
  html = html.replace(
    '<script id="file-data" type="application/json">{}</script>',
    '<script id="file-data" type="application/json">' + JSON.stringify(fileData) + '</script>'
  );

  return new Response(html, {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function handleShareDownload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return error('Invalid share link', 400);

  const result = await resolveShare(token, env);
  if (!result || result.expired) return error('Share link invalid or expired', 404);

  if (result.meta.sharePassword && !hasValidShareCookie(request, token)) {
    return error('Password required', 403);
  }

  const object = await env.VAULT_BUCKET.get(result.meta.key);
  if (!object) return error('File not found in storage', 404);

  result.meta.downloads++;
  await env.VAULT_KV.put(KV_PREFIX.FILE + result.meta.id, JSON.stringify(result.meta));

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', 'attachment; filename="' + result.meta.name + '"');
  headers.set('Content-Length', String(object.size));

  const rangeHeader = request.headers.get('Range');
  if (rangeHeader) {
    return handleRangeRequest(request, env, result.meta, object, headers);
  }

  return new Response(object.body, { headers });
}

export async function handlePreview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return error('Invalid share link', 400);

  const result = await resolveShare(token, env);
  if (!result || result.expired) return error('Share link invalid or expired', 404);

  if (result.meta.sharePassword && !hasValidShareCookie(request, token)) {
    return error('Password required', 403);
  }

  const rangeHeader = request.headers.get('Range');

  if (rangeHeader) {
    const object = await env.VAULT_BUCKET.get(result.meta.key);
    if (!object) return error('File not found', 404);

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('etag', object.httpEtag);
    headers.set('Content-Type', result.meta.type || 'application/octet-stream');
    headers.set('Accept-Ranges', 'bytes');

    return handleRangeRequest(request, env, result.meta, object, headers);
  }

  const object = await env.VAULT_BUCKET.get(result.meta.key);
  if (!object) return error('File not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Type', result.meta.type || 'application/octet-stream');
  headers.set('Content-Disposition', 'inline');
  headers.set('Cache-Control', 'public, max-age=3600');
  headers.set('Accept-Ranges', 'bytes');

  return new Response(object.body, { headers });
}

function handleRangeRequest(
  request: Request,
  env: Env,
  meta: FileMeta,
  object: R2ObjectBody,
  headers: Headers,
): Response {
  const rangeHeader = request.headers.get('Range') || '';
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/);

  if (!match) {
    return new Response(object.body, { headers });
  }

  const totalSize = object.size;
  const start = match[1] ? parseInt(match[1], 10) : 0;
  const end = match[2] ? parseInt(match[2], 10) : totalSize - 1;

  if (start >= totalSize || end >= totalSize || start > end) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': 'bytes */' + totalSize },
    });
  }

  headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + totalSize);
  headers.set('Content-Length', String(end - start + 1));
  headers.set('Accept-Ranges', 'bytes');

  return new Response(object.body, { status: 206, headers });
}

export async function handleSharePassword(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const token = extractToken(url);
  if (!token) return error('Invalid share link', 400);

  let storedPassword: string | null = null;

  const result = await resolveShare(token, env);
  if (result) {
    storedPassword = result.meta.sharePassword;
  } else {
    const folderLink = await resolveFolderShareToken(token, env);
    if (folderLink) {
      storedPassword = folderLink.passwordHash;
    }
  }

  if (!storedPassword) {
    return new Response(null, {
      status: 302,
      headers: { Location: '/s/' + token },
    });
  }

  const contentType = request.headers.get('Content-Type') || '';
  let password: string;

  if (contentType.includes('application/x-www-form-urlencoded')) {
    const formData = await request.formData();
    password = formData.get('password') as string || '';
  } else if (contentType.includes('application/json')) {
    const body = await request.json<{ password: string }>();
    password = body.password || '';
  } else {
    return error('Unsupported content type', 415);
  }

  const valid = await verifySharePassword(password, storedPassword);
  if (!valid) return error('Invalid password', 401);

  const cookieMaxAge = 24 * 60 * 60;
  return new Response(null, {
    status: 302,
    headers: {
      Location: '/s/' + token,
      'Set-Cookie': 'share_' + token + '=verified; Path=/s/' + token + '; HttpOnly; Secure; SameSite=Lax; Max-Age=' + cookieMaxAge,
    },
  });
}
