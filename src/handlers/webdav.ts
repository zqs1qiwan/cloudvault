import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { getMimeType } from '../utils/response';
import { contentDisposition, getIndexedFiles, parseSingleRange, stableObjectId } from '../utils/files';
import {
  multistatusResponse,
  propstatEntry,
  fileToProps,
  fileToHref,
  folderToProps,
  folderToHref,
  fileEtag,
} from '../utils/webdav-xml';

const DAV_PREFIX = '/dav/';
const DAV_METHODS = 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY';

function getAllFiles(env: Env): Promise<FileMeta[]> {
  return getIndexedFiles(env);
}

function parseDavPath(request: Request): string {
  const url = new URL(request.url);
  const raw = decodeURIComponent(url.pathname.slice(DAV_PREFIX.length));
  return raw.replace(/\/+$/, '');
}

function toFolder(davPath: string): string {
  const idx = davPath.lastIndexOf('/');
  return idx < 0 ? 'root' : davPath.substring(0, idx);
}

function toFileName(davPath: string): string {
  return davPath.split('/').pop() || davPath;
}

function toR2Key(folder: string, name: string): string {
  return folder === 'root' ? name : folder + '/' + name;
}

async function getAllFolders(env: Env): Promise<Map<string, string>> {
  const folders = new Map<string, string>();
  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: 'folder:', limit: 1000, cursor });
    for (const key of result.keys) {
      const name = key.name.replace('folder:', '');
      const raw = await env.VAULT_KV.get(key.name);
      let createdAt = '';
      if (raw) {
        try { createdAt = JSON.parse(raw).createdAt || ''; } catch { /* skip */ }
      }
      if (name) folders.set(name, createdAt);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }
  return folders;
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

async function findFileByDavPath(env: Env, davPath: string): Promise<FileMeta | null> {
  const folder = toFolder(davPath);
  const name = toFileName(davPath);
  const allFiles = await getAllFiles(env);
  return allFiles.find(f => f.folder === folder && f.name === name) || null;
}

/**
 * Resolve a path to its metadata, falling back to the R2 object when the KV
 * index has not caught up yet.
 *
 * Every path lookup used to go through a KV list, which is only eventually
 * consistent: a client that PUT a file and immediately MOVEd it in the same
 * second got 404 from a colo that had not seen the row yet. R2 is strongly
 * consistent and carries the owning row id in `customMetadata.fileId`, so the
 * object itself can stand in until the index arrives.
 */
async function resolveFileByDavPath(env: Env, davPath: string): Promise<FileMeta | null> {
  const found = await findFileByDavPath(env, davPath);
  if (found) return found;

  const folder = toFolder(davPath);
  const name = toFileName(davPath);
  const key = toR2Key(folder, name);
  const head = await env.VAULT_BUCKET.head(key);
  if (!head) return null;

  const objectId = head.customMetadata?.fileId;
  if (objectId) {
    const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + objectId);
    if (raw) {
      try {
        const meta = JSON.parse(raw) as FileMeta;
        if (meta.key === key) return meta;
      } catch { /* corrupt row: synthesize from the object instead */ }
    }
  }

  return {
    id: objectId || stableObjectId(key),
    key,
    name,
    folder,
    size: head.size,
    type: head.httpMetadata?.contentType || getMimeType(name),
    uploadedAt: head.uploaded.toISOString(),
    shareToken: null,
    sharePassword: null,
    shareExpiresAt: null,
    downloads: 0,
  };
}

/** Split an `If-Match` / `If-None-Match` list into comparable tags (weak prefix dropped). */
function parseEntityTags(header: string): string[] {
  return header
    .split(',')
    .map((value) => value.trim().replace(/^W\//, ''))
    .filter((value) => value.length > 0);
}

/**
 * Evaluate the request's preconditions against the resource's published ETag.
 *
 * Returns the response to send when a precondition fails, else null. Per RFC
 * 9110 a failed `If-None-Match` on GET/HEAD is 304 Not Modified, and only other
 * methods get 412 - the old code answered 412 for every method, which made
 * ETag-validating sync clients treat an unchanged file as an error.
 */
function evaluatePreconditions(request: Request, etag: string, lastModified: Date | null): Response | null {
  const validators: Record<string, string> = { ETag: etag };
  if (lastModified && Number.isFinite(lastModified.getTime())) {
    validators['Last-Modified'] = lastModified.toUTCString();
  }

  const ifMatch = request.headers.get('If-Match');
  if (ifMatch) {
    const tags = parseEntityTags(ifMatch);
    if (!tags.includes('*') && !tags.includes(etag)) {
      return new Response('Preconditions failed', { status: 412 });
    }
  } else {
    const ifUnmodifiedSince = request.headers.get('If-Unmodified-Since');
    const since = ifUnmodifiedSince ? Date.parse(ifUnmodifiedSince) : NaN;
    if (Number.isFinite(since) && lastModified && lastModified.getTime() > since) {
      return new Response('Preconditions failed', { status: 412 });
    }
  }

  const isReadMethod = request.method === 'GET' || request.method === 'HEAD';

  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch) {
    const tags = parseEntityTags(ifNoneMatch);
    if (tags.includes('*') || tags.includes(etag)) {
      return isReadMethod
        ? new Response(null, { status: 304, headers: validators })
        : new Response('Preconditions failed', { status: 412 });
    }
  } else {
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    const since = ifModifiedSince ? Date.parse(ifModifiedSince) : NaN;
    if (Number.isFinite(since) && lastModified && Math.floor(lastModified.getTime() / 1000) <= Math.floor(since / 1000)) {
      return isReadMethod
        ? new Response(null, { status: 304, headers: validators })
        : null;
    }
  }

  return null;
}

export async function handleWebDav(request: Request, env: Env): Promise<Response> {
  const method = request.method;

  switch (method) {
    case 'OPTIONS': return handleOptions();
    case 'PROPFIND': return handlePropfind(request, env);
    case 'GET': return handleGet(request, env);
    case 'HEAD': return handleHead(request, env);
    case 'PUT': return handlePut(request, env);
    case 'DELETE': return handleDelete(request, env);
    case 'MKCOL': return handleMkcol(request, env);
    case 'MOVE': return handleMove(request, env);
    case 'COPY': return handleCopy(request, env);
    default:
      return new Response('Method Not Allowed', {
        status: 405,
        headers: { Allow: DAV_METHODS },
      });
  }
}

function handleOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: DAV_METHODS,
      DAV: '1',
      'MS-Author-Via': 'DAV',
    },
  });
}

async function handlePropfind(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  const depth = request.headers.get('Depth') ?? '1';

  if (davPath === '') {
    return propfindRoot(env, depth);
  }

  const file = await resolveFileByDavPath(env, davPath);
  if (file) {
    return multistatusResponse([
      propstatEntry(fileToHref(file), fileToProps(file), false),
    ]);
  }

  const folders = await getAllFolders(env);
  const allFiles = await getAllFiles(env);

  if (!isDirPath(davPath, folders, allFiles)) {
    return new Response('Not Found', { status: 404 });
  }

  const items: string[] = [
    propstatEntry(folderToHref(davPath), folderToProps(davPath, folders.get(davPath)), true),
  ];

  if (depth !== '0') {
    const directFiles = allFiles.filter(f => f.folder === davPath);
    for (const f of directFiles) {
      items.push(propstatEntry(fileToHref(f), fileToProps(f), false));
    }

    const childNames = collectChildFolders(davPath, folders, allFiles);
    for (const cn of childNames) {
      const fullPath = davPath + '/' + cn;
      items.push(propstatEntry(folderToHref(fullPath), folderToProps(fullPath, folders.get(fullPath)), true));
    }
  }

  return multistatusResponse(items);
}

async function propfindRoot(env: Env, depth: string): Promise<Response> {
  const items: string[] = [
    propstatEntry(folderToHref(''), folderToProps('', new Date().toISOString()), true),
  ];

  if (depth !== '0') {
    const folders = await getAllFolders(env);
    const allFiles = await getAllFiles(env);

    const rootFiles = allFiles.filter(f => f.folder === 'root');
    for (const f of rootFiles) {
      items.push(propstatEntry(fileToHref(f), fileToProps(f), false));
    }

    const topFolders = new Set<string>();
    for (const [name] of folders) {
      const top = name.split('/')[0];
      topFolders.add(top);
    }
    for (const f of allFiles) {
      if (f.folder !== 'root') {
        topFolders.add(f.folder.split('/')[0]);
      }
    }
    for (const tf of topFolders) {
      items.push(propstatEntry(folderToHref(tf), folderToProps(tf, folders.get(tf)), true));
    }
  }

  return multistatusResponse(items);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
  return (bytes / 1073741824).toFixed(2) + ' GB';
}

function encodeDavHref(davPath: string, trailingSlash = false): string {
  if (!davPath) return '/dav/';
  const encoded = davPath.split('/').map(s => encodeURIComponent(s)).join('/');
  return '/dav/' + encoded + (trailingSlash ? '/' : '');
}

function isDirPath(davPath: string, folders: Map<string, string>, allFiles: FileMeta[]): boolean {
  if (!davPath) return true;
  return folders.has(davPath) || allFiles.some(f => f.folder === davPath || f.folder.startsWith(davPath + '/'));
}

function collectChildFolders(davPath: string, folders: Map<string, string>, allFiles: FileMeta[]): string[] {
  const childSet = new Set<string>();
  const prefix = davPath ? davPath + '/' : '';

  if (!davPath) {
    for (const [name] of folders) { childSet.add(name.split('/')[0]); }
    for (const f of allFiles) { if (f.folder !== 'root') childSet.add(f.folder.split('/')[0]); }
  } else {
    for (const [name] of folders) {
      if (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')) {
        childSet.add(name.slice(prefix.length));
      }
    }
    for (const f of allFiles) {
      if (f.folder.startsWith(prefix) && !f.folder.slice(prefix.length).includes('/')) {
        childSet.add(f.folder.slice(prefix.length));
      }
    }
  }

  return [...childSet].sort();
}

async function serveDirectoryListing(env: Env, davPath: string, folders: Map<string, string>, allFiles: FileMeta[]): Promise<Response> {
  const displayPath = davPath || '/';
  const childFolders = collectChildFolders(davPath, folders, allFiles);

  const directFiles = davPath
    ? allFiles.filter(f => f.folder === davPath).sort((a, b) => a.name.localeCompare(b.name))
    : allFiles.filter(f => f.folder === 'root').sort((a, b) => a.name.localeCompare(b.name));

  let rows = '';
  if (davPath) {
    const parentPath = davPath.includes('/') ? davPath.substring(0, davPath.lastIndexOf('/')) : '';
    rows += `<tr><td>📁</td><td><a href="${encodeDavHref(parentPath, true)}">..</a></td><td>—</td><td>—</td></tr>\n`;
  }
  for (const cf of childFolders) {
    const fullPath = davPath ? davPath + '/' + cf : cf;
    rows += `<tr><td>📁</td><td><a href="${encodeDavHref(fullPath, true)}">${escapeHtml(cf)}/</a></td><td>—</td><td>—</td></tr>\n`;
  }
  for (const f of directFiles) {
    const fullPath = davPath ? davPath + '/' + f.name : f.name;
    const date = f.uploadedAt ? new Date(f.uploadedAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
    rows += `<tr><td>📄</td><td><a href="${encodeDavHref(fullPath)}">${escapeHtml(f.name)}</a></td><td>${formatSize(f.size)}</td><td>${date}</td></tr>\n`;
  }

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebDAV — ${escapeHtml(displayPath)}</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#e0e0e0;background:#1a1a2e}
a{color:#82aaff;text-decoration:none}a:hover{text-decoration:underline}
table{border-collapse:collapse;width:100%;max-width:800px}th,td{text-align:left;padding:6px 12px;border-bottom:1px solid #333}
th{color:#888;font-size:13px}h1{font-size:18px;font-weight:500}</style></head>
<body><h1>Index of ${escapeHtml(displayPath)}</h1>
<table><thead><tr><th></th><th>Name</th><th>Size</th><th>Modified</th></tr></thead>
<tbody>${rows}</tbody></table>
<p style="color:#555;font-size:12px;margin-top:2rem">CloudVault WebDAV</p></body></html>`;

  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  const folders = await getAllFolders(env);
  const allFiles = await getAllFiles(env);
  const isDir = isDirPath(davPath, folders, allFiles);

  if (isDir) {
    const isBrowser = (request.headers.get('Accept') || '').includes('text/html');
    if (!isBrowser) return new Response('', { status: 200, headers: { 'Content-Type': 'httpd/unix-directory' } });
    return serveDirectoryListing(env, davPath, folders, allFiles);
  }

  const folder = toFolder(davPath);
  const name = toFileName(davPath);
  const file = allFiles.find(f => f.folder === folder && f.name === name) || null;

  const r2Key = file ? file.key : toR2Key(folder, name);
  const head = await env.VAULT_BUCKET.head(r2Key);
  if (!head) return new Response('Not Found', { status: 404 });

  const etag = file ? fileEtag(file) : head.httpEtag;
  const lastModified = file ? new Date(file.uploadedAt) : head.uploaded;

  const precondition = evaluatePreconditions(request, etag, lastModified);
  if (precondition) return precondition;

  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader ? parseSingleRange(rangeHeader, head.size) : null;
  if (rangeHeader && !range) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${head.size}` },
    });
  }
  // No `onlyIf`: R2 compares conditionals against its own MD5 ETag, which is a
  // different namespace from the ETag published to clients. The checks above
  // compare like with like, so the object is fetched unconditionally here.
  const object = await env.VAULT_BUCKET.get(r2Key, {
    range: range ?? undefined,
  });
  if (!object) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('Content-Length', String(range?.length ?? object.size));
  headers.set('Accept-Ranges', 'bytes');
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  }
  headers.set('ETag', etag);
  if (lastModified && Number.isFinite(lastModified.getTime())) {
    headers.set('Last-Modified', lastModified.toUTCString());
  }
  if (file) {
    if (!headers.has('Content-Type')) {
      headers.set('Content-Type', file.type || getMimeType(file.name));
    }
  } else if (!headers.has('Content-Type')) {
    headers.set('Content-Type', getMimeType(name));
  }

  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function handleHead(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  const folders = await getAllFolders(env);
  const allFiles = await getAllFiles(env);

  if (davPath) {
    const folder = toFolder(davPath);
    const name = toFileName(davPath);
    const file = allFiles.find(f => f.folder === folder && f.name === name) || null;
    const r2Key = file ? file.key : toR2Key(folder, name);
    const r2Head = await env.VAULT_BUCKET.head(r2Key);
    if (r2Head) {
      const etag = file ? fileEtag(file) : r2Head.httpEtag;
      const lastModified = file ? new Date(file.uploadedAt) : r2Head.uploaded;

      const precondition = evaluatePreconditions(request, etag, lastModified);
      if (precondition) return precondition;

      const headers: Record<string, string> = {
        'Content-Type': file
          ? file.type || getMimeType(file.name)
          : r2Head.httpMetadata?.contentType || getMimeType(name),
        'Content-Length': String(file ? file.size : r2Head.size),
        ETag: etag,
      };
      if (Number.isFinite(lastModified.getTime())) {
        headers['Last-Modified'] = lastModified.toUTCString();
      }
      return new Response(null, { status: 200, headers });
    }
  }

  if (isDirPath(davPath, folders, allFiles)) {
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'httpd/unix-directory' },
    });
  }

  return new Response('Not Found', { status: 404 });
}

async function handlePut(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) return new Response('Cannot PUT to root', { status: 405 });
  if (davPath.includes('..')) return new Response('Invalid path', { status: 400 });

  const folder = toFolder(davPath);
  const fileName = toFileName(davPath);
  const contentType = request.headers.get('Content-Type') || getMimeType(fileName);
  const key = toR2Key(folder, fileName);

  const [existingFile, existingHead] = await Promise.all([
    findFileByDavPath(env, davPath),
    env.VAULT_BUCKET.head(key),
  ]);

  if (folder !== 'root' && !existingFile && !existingHead) {
    await ensureFolderChain(env, folder);
  }

  const id = existingFile?.id ?? await resolveUploadId(env, key, existingHead?.customMetadata?.fileId);
  const r2Object = await env.VAULT_BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      contentDisposition: contentDisposition('attachment', fileName),
    },
    customMetadata: { fileId: id },
  });
  if (!r2Object) return new Response('Upload failed', { status: 500 });

  const created = !existingFile && !existingHead;
  const previousSize = existingFile?.size ?? existingHead?.size ?? 0;
  // ETags are derived from `uploadedAt`, so make sure an overwrite never reuses
  // the previous millisecond: two fast PUTs would otherwise publish the same
  // validator and sync clients would skip the newer body.
  const previousStamp = existingFile ? Date.parse(existingFile.uploadedAt) : NaN;
  const uploadedAt = new Date(
    Number.isFinite(previousStamp) ? Math.max(Date.now(), previousStamp + 1) : Date.now(),
  ).toISOString();

  const meta: FileMeta = {
    id,
    key,
    name: fileName,
    size: r2Object.size,
    type: contentType,
    folder,
    uploadedAt,
    shareToken: existingFile?.shareToken ?? null,
    sharePassword: existingFile?.sharePassword ?? null,
    shareExpiresAt: existingFile?.shareExpiresAt ?? null,
    downloads: existingFile?.downloads ?? 0,
  };

  await env.VAULT_KV.put(KV_PREFIX.FILE + id, JSON.stringify(meta));

  const sizeDelta = meta.size - previousSize;
  if (created || sizeDelta !== 0) {
    await updateStatsCounters(env, sizeDelta, created ? 1 : 0);
  }

  return new Response(null, { status: created ? 201 : 204 });
}

/**
 * Pick the metadata row a PUT should write.
 *
 * KV is only eventually consistent, so `findFileByDavPath` can miss a row that
 * was written moments ago in another colo and the old code answered with a
 * brand-new `randomUUID()` - leaving two rows for one path and two different
 * ETags. The R2 object is strongly consistent and carries the owning row's id
 * in `customMetadata.fileId`, so follow that first; otherwise derive the id
 * from the object key. Deriving instead of randomising keeps concurrent PUTs
 * for one path on a single row.
 */
async function resolveUploadId(env: Env, key: string, objectFileId?: string): Promise<string> {
  if (objectFileId) {
    const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + objectFileId);
    if (raw) {
      try {
        if ((JSON.parse(raw) as FileMeta).key === key) return objectFileId;
      } catch { /* corrupt row: fall through to a derived id */ }
    }
  }

  const derived = stableObjectId(key);
  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + derived);
  if (!raw) return derived;
  try {
    // The derived id belongs to a file that has since moved: do not clobber it.
    return (JSON.parse(raw) as FileMeta).key === key ? derived : crypto.randomUUID();
  } catch {
    return crypto.randomUUID();
  }
}

async function ensureFolderChain(env: Env, folderPath: string): Promise<void> {
  const parts = folderPath.split('/');
  let path = '';
  for (const part of parts) {
    path = path ? path + '/' + part : part;
    const existing = await env.VAULT_KV.get('folder:' + path);
    if (!existing) {
      await env.VAULT_KV.put('folder:' + path, JSON.stringify({ name: path, createdAt: new Date().toISOString() }));
    }
  }
}

async function handleDelete(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) return new Response('Cannot DELETE root', { status: 403 });

  const file = await resolveFileByDavPath(env, davPath);
  if (file) {
    await env.VAULT_BUCKET.delete(file.key);
    await env.VAULT_KV.delete(KV_PREFIX.FILE + file.id);
    if (file.shareToken) {
      await env.VAULT_KV.delete(KV_PREFIX.SHARE + file.shareToken);
    }
    await updateStatsCounters(env, -file.size, -1);
    return new Response(null, { status: 204 });
  }

  const folders = await getAllFolders(env);
  const allFiles = await getAllFiles(env);
  const isFolder = folders.has(davPath) || allFiles.some(f => f.folder === davPath || f.folder.startsWith(davPath + '/'));

  if (!isFolder) return new Response('Not Found', { status: 404 });

  await env.VAULT_KV.delete('folder:' + davPath);

  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: 'folder:' + davPath + '/', limit: 1000, cursor });
    for (const key of result.keys) {
      await env.VAULT_KV.delete(key.name);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  let totalSizeRemoved = 0;
  let deletedCount = 0;
  for (const f of allFiles) {
    if (f.folder === davPath || f.folder.startsWith(davPath + '/')) {
      await env.VAULT_BUCKET.delete(f.key);
      await env.VAULT_KV.delete(KV_PREFIX.FILE + f.id);
      if (f.shareToken) await env.VAULT_KV.delete(KV_PREFIX.SHARE + f.shareToken);
      totalSizeRemoved += f.size;
      deletedCount++;
    }
  }

  if (deletedCount > 0) {
    await updateStatsCounters(env, -totalSizeRemoved, -deletedCount);
  }

  return new Response(null, { status: 204 });
}

async function handleMkcol(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) return new Response('Cannot MKCOL root', { status: 405 });

  const body = await request.text();
  if (body) return new Response('Unsupported Media Type', { status: 415 });

  const existingFile = await resolveFileByDavPath(env, davPath);
  if (existingFile) return new Response('Conflict', { status: 409 });

  const folders = await getAllFolders(env);
  if (folders.has(davPath)) return new Response('Method Not Allowed', { status: 405 });

  const parentPath = davPath.includes('/') ? davPath.substring(0, davPath.lastIndexOf('/')) : '';
  if (parentPath && !folders.has(parentPath)) {
    const allFiles = await getAllFiles(env);
    const parentExists = allFiles.some(f => f.folder === parentPath || f.folder.startsWith(parentPath + '/'));
    if (!parentExists) return new Response('Conflict', { status: 409 });
  }

  await env.VAULT_KV.put('folder:' + davPath, JSON.stringify({ name: davPath, createdAt: new Date().toISOString() }));

  return new Response('Created', { status: 201 });
}

async function handleMove(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) return new Response('Cannot MOVE root', { status: 403 });

  const destination = parseDestination(request);
  if (!destination) return new Response('Bad Request', { status: 400 });
  if (destination === davPath) return new Response(null, { status: 204 });

  const overwrite = request.headers.get('Overwrite') !== 'F';

  const file = await resolveFileByDavPath(env, davPath);
  if (file) {
    const destFile = await resolveFileByDavPath(env, destination);
    if (destFile && !overwrite) return new Response('Precondition Failed', { status: 412 });

    const newFolder = toFolder(destination);
    const newName = toFileName(destination);
    const newKey = toR2Key(newFolder, newName);

    if (newFolder !== 'root') await ensureFolderChain(env, newFolder);

    const object = await env.VAULT_BUCKET.get(file.key);
    if (!object) return new Response('Not Found', { status: 404 });

    await env.VAULT_BUCKET.put(newKey, object.body, {
      httpMetadata: { ...object.httpMetadata, contentDisposition: contentDisposition('attachment', newName) },
      customMetadata: { ...object.customMetadata, fileId: file.id },
    });
    if (destFile) {
      await env.VAULT_KV.delete(KV_PREFIX.FILE + destFile.id);
      if (destFile.shareToken) await env.VAULT_KV.delete(KV_PREFIX.SHARE + destFile.shareToken);
      await updateStatsCounters(env, -destFile.size, -1);
    }
    await env.VAULT_BUCKET.delete(file.key);

    file.key = newKey;
    file.folder = newFolder;
    file.name = newName;
    await env.VAULT_KV.put(KV_PREFIX.FILE + file.id, JSON.stringify(file));

    return new Response(null, { status: destFile ? 204 : 201 });
  }

  return new Response('Not Found', { status: 404 });
}

async function handleCopy(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) return new Response('Cannot COPY root', { status: 403 });

  const destination = parseDestination(request);
  if (!destination) return new Response('Bad Request', { status: 400 });
  if (destination === davPath) return new Response(null, { status: 204 });

  const overwrite = request.headers.get('Overwrite') !== 'F';

  const file = await resolveFileByDavPath(env, davPath);
  if (!file) return new Response('Not Found', { status: 404 });

  const destFile = await resolveFileByDavPath(env, destination);
  if (destFile && !overwrite) return new Response('Precondition Failed', { status: 412 });

  const newFolder = toFolder(destination);
  const newName = toFileName(destination);
  const newKey = toR2Key(newFolder, newName);
  const newId = crypto.randomUUID();

  if (newFolder !== 'root') await ensureFolderChain(env, newFolder);

  const object = await env.VAULT_BUCKET.get(file.key);
  if (!object) return new Response('Not Found', { status: 404 });

  await env.VAULT_BUCKET.put(newKey, object.body, {
    httpMetadata: { ...object.httpMetadata, contentDisposition: contentDisposition('attachment', newName) },
    customMetadata: { fileId: newId },
  });
  if (destFile) {
    await env.VAULT_KV.delete(KV_PREFIX.FILE + destFile.id);
    if (destFile.shareToken) await env.VAULT_KV.delete(KV_PREFIX.SHARE + destFile.shareToken);
    await updateStatsCounters(env, -destFile.size, -1);
  }

  const meta: FileMeta = {
    id: newId,
    key: newKey,
    name: newName,
    size: file.size,
    type: file.type,
    folder: newFolder,
    uploadedAt: new Date().toISOString(),
    shareToken: null,
    sharePassword: null,
    shareExpiresAt: null,
    downloads: 0,
  };

  await env.VAULT_KV.put(KV_PREFIX.FILE + newId, JSON.stringify(meta));
  await updateStatsCounters(env, meta.size, 1);

  return new Response(null, { status: destFile ? 204 : 201 });
}

function parseDestination(request: Request): string | null {
  const dest = request.headers.get('Destination');
  if (!dest) return null;

  try {
    const url = new URL(dest);
    const decoded = decodeURIComponent(url.pathname);
    if (!decoded.startsWith(DAV_PREFIX)) return null;
    return decoded.slice(DAV_PREFIX.length).replace(/\/+$/, '');
  } catch {
    const decoded = decodeURIComponent(dest);
    if (!decoded.startsWith(DAV_PREFIX)) return null;
    return decoded.slice(DAV_PREFIX.length).replace(/\/+$/, '');
  }
}
