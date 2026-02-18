import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { json, error, getMimeType } from '../utils/response';

function extractId(url: URL): string | null {
  const parts = url.pathname.split('/');
  const idx = parts.indexOf('files');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
}

async function getAllFiles(env: Env): Promise<FileMeta[]> {
  const files: FileMeta[] = [];
  let cursor: string | undefined;

  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: KV_PREFIX.FILE, limit: 1000, cursor });
    for (const key of result.keys) {
      const raw = await env.VAULT_KV.get(key.name);
      if (raw) {
        try { files.push(JSON.parse(raw)); } catch { /* skip corrupted entries */ }
      }
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return files;
}

async function updateStatsCounters(env: Env, sizeDelta: number, countDelta: number): Promise<void> {
  const [rawSize, rawCount] = await Promise.all([
    env.VAULT_KV.get(KV_PREFIX.STATS + 'totalSize'),
    env.VAULT_KV.get(KV_PREFIX.STATS + 'totalFiles'),
  ]);
  const newSize = Math.max(0, (parseInt(rawSize || '0', 10) + sizeDelta));
  const newCount = Math.max(0, (parseInt(rawCount || '0', 10) + countDelta));
  await Promise.all([
    env.VAULT_KV.put(KV_PREFIX.STATS + 'totalSize', String(newSize)),
    env.VAULT_KV.put(KV_PREFIX.STATS + 'totalFiles', String(newCount)),
  ]);
}

export async function upload(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const action = url.searchParams.get('action');

  if (action === 'mpu-create') {
    return handleMultipartCreate(request, env);
  }
  if (action === 'mpu-upload') {
    return handleMultipartUpload(request, env, url);
  }
  if (action === 'mpu-complete') {
    return handleMultipartComplete(request, env);
  }

  return handleDirectUpload(request, env);
}

async function handleDirectUpload(request: Request, env: Env): Promise<Response> {
  const fileName = decodeURIComponent(request.headers.get('X-File-Name') || 'untitled');
  const folder = request.headers.get('X-Folder') || 'root';
  const contentType = request.headers.get('Content-Type') || getMimeType(fileName);
  const contentLength = request.headers.get('Content-Length');

  const id = crypto.randomUUID();
  const key = folder === 'root' ? fileName : folder + '/' + fileName;

  if (!key || key.includes('..')) return error('Invalid file path', 400);

  const r2Object = await env.VAULT_BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      contentDisposition: 'attachment; filename="' + fileName + '"',
    },
    customMetadata: { fileId: id },
  });

  if (!r2Object) return error('Upload failed', 500);

  const meta: FileMeta = {
    id,
    key,
    name: fileName,
    size: r2Object.size,
    type: contentType,
    folder,
    uploadedAt: new Date().toISOString(),
    shareToken: null,
    sharePassword: null,
    shareExpiresAt: null,
    downloads: 0,
  };

  await env.VAULT_KV.put(KV_PREFIX.FILE + id, JSON.stringify(meta));
  await updateStatsCounters(env, meta.size, 1);

  return json(meta, 201);
}

async function handleMultipartCreate(request: Request, env: Env): Promise<Response> {
  const fileName = decodeURIComponent(request.headers.get('X-File-Name') || 'untitled');
  const folder = request.headers.get('X-Folder') || 'root';
  const contentType = request.headers.get('Content-Type') || getMimeType(fileName);
  const key = folder === 'root' ? fileName : folder + '/' + fileName;

  const multipart = await env.VAULT_BUCKET.createMultipartUpload(key, {
    httpMetadata: {
      contentType,
      contentDisposition: 'attachment; filename="' + fileName + '"',
    },
  });

  return json({ uploadId: multipart.uploadId, key });
}

async function handleMultipartUpload(request: Request, env: Env, url: URL): Promise<Response> {
  const uploadId = url.searchParams.get('uploadId');
  const partNumber = parseInt(url.searchParams.get('partNumber') || '0', 10);
  const key = url.searchParams.get('key');

  if (!uploadId || !partNumber || !key) return error('Missing uploadId, partNumber, or key', 400);

  const multipart = env.VAULT_BUCKET.resumeMultipartUpload(key, uploadId);
  const part = await multipart.uploadPart(partNumber, request.body as ReadableStream);

  return json({ partNumber: part.partNumber, etag: part.etag });
}

async function handleMultipartComplete(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{
    uploadId: string;
    key: string;
    parts: { partNumber: number; etag: string }[];
  }>();

  const multipart = env.VAULT_BUCKET.resumeMultipartUpload(body.key, body.uploadId);
  const r2Object = await multipart.complete(body.parts);

  const fileName = body.key.split('/').pop() || body.key;
  const folder = body.key.includes('/') ? body.key.substring(0, body.key.lastIndexOf('/')) : 'root';
  const id = crypto.randomUUID();

  const meta: FileMeta = {
    id,
    key: body.key,
    name: fileName,
    size: r2Object.size,
    type: r2Object.httpMetadata?.contentType || getMimeType(fileName),
    folder,
    uploadedAt: new Date().toISOString(),
    shareToken: null,
    sharePassword: null,
    shareExpiresAt: null,
    downloads: 0,
  };

  await env.VAULT_KV.put(KV_PREFIX.FILE + id, JSON.stringify(meta));
  await updateStatsCounters(env, meta.size, 1);

  return json(meta, 201);
}

export async function list(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const folderFilter = url.searchParams.get('folder');
  const searchFilter = url.searchParams.get('search')?.toLowerCase();

  let files = await getAllFiles(env);

  if (folderFilter) {
    files = files.filter(f => f.folder === folderFilter);
  }
  if (searchFilter) {
    files = files.filter(f => f.name.toLowerCase().includes(searchFilter));
  }

  files.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());

  return json({ files, cursor: null, totalFiles: files.length });
}

export async function get(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = extractId(url);
  if (!id) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
  if (!raw) return error('File not found', 404);

  return json(JSON.parse(raw));
}

export async function download(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const id = parts[parts.indexOf('files') + 1];
  if (!id) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
  if (!raw) return error('File not found', 404);
  const meta: FileMeta = JSON.parse(raw);

  const object = await env.VAULT_BUCKET.get(meta.key);
  if (!object) return error('File not found in storage', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Disposition', 'attachment; filename="' + meta.name + '"');

  return new Response(object.body, { headers });
}

export async function deleteFiles(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  let ids: string[];

  if (request.method === 'DELETE') {
    const id = extractId(url);
    if (!id) return error('File ID required', 400);
    ids = [id];
  } else {
    const body = await request.json<{ ids: string[] }>();
    ids = body.ids;
  }

  if (!ids || ids.length === 0) return error('No file IDs provided', 400);

  let totalSizeRemoved = 0;
  for (const id of ids) {
    const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
    if (!raw) continue;

    const meta: FileMeta = JSON.parse(raw);
    await env.VAULT_BUCKET.delete(meta.key);
    await env.VAULT_KV.delete(KV_PREFIX.FILE + id);

    if (meta.shareToken) {
      await env.VAULT_KV.delete(KV_PREFIX.SHARE + meta.shareToken);
    }
    totalSizeRemoved += meta.size;
  }

  await updateStatsCounters(env, -totalSizeRemoved, -ids.length);

  return json({ deleted: ids.length });
}

export async function rename(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const id = extractId(url);
  if (!id) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
  if (!raw) return error('File not found', 404);

  const body = await request.json<{ name: string }>();
  if (!body.name?.trim()) return error('Name required', 400);

  const meta: FileMeta = JSON.parse(raw);
  meta.name = body.name.trim();
  await env.VAULT_KV.put(KV_PREFIX.FILE + id, JSON.stringify(meta));

  return json(meta);
}

export async function createFolder(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ name: string; parent: string }>();
  if (!body.name?.trim()) return error('Folder name required', 400);

  const folderName = body.parent === 'root' ? body.name.trim() : body.parent + '/' + body.name.trim();
  await env.VAULT_KV.put('folder:' + folderName, JSON.stringify({ name: folderName, createdAt: new Date().toISOString() }));

  return json({ folder: folderName }, 201);
}

export async function listFolders(request: Request, env: Env): Promise<Response> {
  const files = await getAllFiles(env);
  const folderSet = new Set<string>();

  for (const file of files) {
    if (file.folder && file.folder !== 'root') {
      folderSet.add(file.folder);
    }
  }

  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: 'folder:', limit: 1000, cursor });
    for (const key of result.keys) {
      const name = key.name.replace('folder:', '');
      if (name) folderSet.add(name);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  return json({ folders: Array.from(folderSet).sort() });
}

export async function thumbnail(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const id = parts[parts.indexOf('files') + 1];
  if (!id) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
  if (!raw) return error('File not found', 404);
  const meta: FileMeta = JSON.parse(raw);

  if (!meta.type.startsWith('image/')) return error('Not an image', 400);

  const object = await env.VAULT_BUCKET.get(meta.key);
  if (!object) return error('File not found in storage', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', 'public, max-age=86400');

  return new Response(object.body, { headers });
}
