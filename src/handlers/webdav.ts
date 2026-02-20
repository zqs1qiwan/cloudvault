import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { getMimeType } from '../utils/response';
import {
  multistatusResponse,
  propstatEntry,
  fileToProps,
  fileToHref,
  folderToProps,
  folderToHref,
} from '../utils/webdav-xml';

const DAV_PREFIX = '/dav/';
const DAV_METHODS = 'OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY';

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

  const file = await findFileByDavPath(env, davPath);
  if (file) {
    return multistatusResponse([
      propstatEntry(fileToHref(file), fileToProps(file), false),
    ]);
  }

  const folders = await getAllFolders(env);
  const allFiles = await getAllFiles(env);

  const isFolder = folders.has(davPath) || allFiles.some(f => f.folder === davPath || f.folder.startsWith(davPath + '/'));

  if (!isFolder) {
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

    const childFolders = new Set<string>();
    for (const [name] of folders) {
      if (name.startsWith(davPath + '/') && !name.slice(davPath.length + 1).includes('/')) {
        childFolders.add(name);
      }
    }
    for (const f of allFiles) {
      if (f.folder.startsWith(davPath + '/') && !f.folder.slice(davPath.length + 1).includes('/')) {
        childFolders.add(f.folder);
      }
    }
    for (const cf of childFolders) {
      items.push(propstatEntry(folderToHref(cf), folderToProps(cf, folders.get(cf)), true));
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

async function serveDirectoryListing(env: Env, davPath: string, folders: Map<string, string>): Promise<Response> {
  const allFiles = await getAllFiles(env);
  const displayPath = davPath || '/';
  const prefix = davPath ? davPath + '/' : '';
  const parentHref = davPath
    ? '/dav/' + encodeURIComponent(davPath.substring(0, davPath.lastIndexOf('/')).replace(/^\//, '')) + '/'
    : null;

  const childFolders: string[] = [];
  if (!davPath) {
    const topSet = new Set<string>();
    for (const [name] of folders) { topSet.add(name.split('/')[0]); }
    for (const f of allFiles) { if (f.folder !== 'root') topSet.add(f.folder.split('/')[0]); }
    childFolders.push(...[...topSet].sort());
  } else {
    for (const [name] of folders) {
      if (name.startsWith(prefix) && !name.slice(prefix.length).includes('/')) {
        childFolders.push(name.slice(prefix.length));
      }
    }
    childFolders.sort();
  }

  const directFiles = davPath
    ? allFiles.filter(f => f.folder === davPath).sort((a, b) => a.name.localeCompare(b.name))
    : allFiles.filter(f => f.folder === 'root').sort((a, b) => a.name.localeCompare(b.name));

  let rows = '';
  if (parentHref) {
    rows += `<tr><td>📁</td><td><a href="${davPath.includes('/') ? parentHref : '/dav/'}">..</a></td><td>—</td><td>—</td></tr>\n`;
  }
  for (const cf of childFolders) {
    const href = '/dav/' + encodeURIComponent(davPath ? davPath + '/' + cf : cf) + '/';
    rows += `<tr><td>📁</td><td><a href="${href}">${escapeHtml(cf)}/</a></td><td>—</td><td>—</td></tr>\n`;
  }
  for (const f of directFiles) {
    const href = '/dav/' + encodeURIComponent(davPath ? davPath + '/' + f.name : f.name);
    const date = f.uploadedAt ? new Date(f.uploadedAt).toISOString().slice(0, 16).replace('T', ' ') : '—';
    rows += `<tr><td>📄</td><td><a href="${href}">${escapeHtml(f.name)}</a></td><td>${formatSize(f.size)}</td><td>${date}</td></tr>\n`;
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

  const isBrowser = (request.headers.get('Accept') || '').includes('text/html');
  const folders = await getAllFolders(env);
  const isDir = !davPath || folders.has(davPath);

  if (isDir) {
    if (!isBrowser) return new Response('', { status: 200, headers: { 'Content-Type': 'httpd/unix-directory' } });
    return serveDirectoryListing(env, davPath, folders);
  }

  const file = await findFileByDavPath(env, davPath);
  if (!file) return new Response('Not Found', { status: 404 });

  const object = await env.VAULT_BUCKET.get(file.key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (!object) return new Response('Not Found', { status: 404 });

  if (!('body' in object)) {
    return new Response('Preconditions failed', { status: 412 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', '"' + file.id + '"');
  headers.set('Content-Length', String(object.size));
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', file.type || getMimeType(file.name));
  }

  return new Response(object.body, { headers });
}

async function handleHead(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) {
    return new Response(null, {
      status: 200,
      headers: { 'Content-Type': 'httpd/unix-directory' },
    });
  }

  const file = await findFileByDavPath(env, davPath);
  if (!file) {
    const folders = await getAllFolders(env);
    if (folders.has(davPath)) {
      return new Response(null, {
        status: 200,
        headers: { 'Content-Type': 'httpd/unix-directory' },
      });
    }
    return new Response('Not Found', { status: 404 });
  }

  return new Response(null, {
    status: 200,
    headers: {
      'Content-Type': file.type || getMimeType(file.name),
      'Content-Length': String(file.size),
      ETag: '"' + file.id + '"',
      'Last-Modified': new Date(file.uploadedAt).toUTCString(),
    },
  });
}

async function handlePut(request: Request, env: Env): Promise<Response> {
  const davPath = parseDavPath(request);
  if (!davPath) return new Response('Cannot PUT to root', { status: 405 });
  if (davPath.includes('..')) return new Response('Invalid path', { status: 400 });

  const folder = toFolder(davPath);
  const fileName = toFileName(davPath);
  const contentType = request.headers.get('Content-Type') || getMimeType(fileName);
  const key = toR2Key(folder, fileName);

  const existingFile = await findFileByDavPath(env, davPath);

  if (existingFile) {
    await env.VAULT_BUCKET.delete(existingFile.key);
    const r2Object = await env.VAULT_BUCKET.put(key, request.body, {
      httpMetadata: {
        contentType,
        contentDisposition: 'attachment; filename="' + fileName + '"',
      },
      customMetadata: { fileId: existingFile.id },
    });
    if (!r2Object) return new Response('Upload failed', { status: 500 });

    const sizeDelta = r2Object.size - existingFile.size;
    existingFile.key = key;
    existingFile.size = r2Object.size;
    existingFile.type = contentType;
    existingFile.uploadedAt = new Date().toISOString();
    await env.VAULT_KV.put(KV_PREFIX.FILE + existingFile.id, JSON.stringify(existingFile));
    if (sizeDelta !== 0) await updateStatsCounters(env, sizeDelta, 0);

    return new Response(null, { status: 204 });
  }

  if (folder !== 'root') {
    await ensureFolderChain(env, folder);
  }

  const id = crypto.randomUUID();
  const r2Object = await env.VAULT_BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      contentDisposition: 'attachment; filename="' + fileName + '"',
    },
    customMetadata: { fileId: id },
  });
  if (!r2Object) return new Response('Upload failed', { status: 500 });

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

  return new Response(null, { status: 201 });
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

  const file = await findFileByDavPath(env, davPath);
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

  const existingFile = await findFileByDavPath(env, davPath);
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

  const overwrite = request.headers.get('Overwrite') !== 'F';

  const file = await findFileByDavPath(env, davPath);
  if (file) {
    const destFile = await findFileByDavPath(env, destination);
    if (destFile && !overwrite) return new Response('Precondition Failed', { status: 412 });

    if (destFile) {
      await env.VAULT_BUCKET.delete(destFile.key);
      await env.VAULT_KV.delete(KV_PREFIX.FILE + destFile.id);
      if (destFile.shareToken) await env.VAULT_KV.delete(KV_PREFIX.SHARE + destFile.shareToken);
      await updateStatsCounters(env, -destFile.size, -1);
    }

    const newFolder = toFolder(destination);
    const newName = toFileName(destination);
    const newKey = toR2Key(newFolder, newName);

    if (newFolder !== 'root') await ensureFolderChain(env, newFolder);

    const object = await env.VAULT_BUCKET.get(file.key);
    if (!object) return new Response('Not Found', { status: 404 });

    await env.VAULT_BUCKET.put(newKey, object.body, {
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
    });
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

  const overwrite = request.headers.get('Overwrite') !== 'F';

  const file = await findFileByDavPath(env, davPath);
  if (!file) return new Response('Not Found', { status: 404 });

  const destFile = await findFileByDavPath(env, destination);
  if (destFile && !overwrite) return new Response('Precondition Failed', { status: 412 });

  if (destFile) {
    await env.VAULT_BUCKET.delete(destFile.key);
    await env.VAULT_KV.delete(KV_PREFIX.FILE + destFile.id);
    if (destFile.shareToken) await env.VAULT_KV.delete(KV_PREFIX.SHARE + destFile.shareToken);
    await updateStatsCounters(env, -destFile.size, -1);
  }

  const newFolder = toFolder(destination);
  const newName = toFileName(destination);
  const newKey = toR2Key(newFolder, newName);
  const newId = crypto.randomUUID();

  if (newFolder !== 'root') await ensureFolderChain(env, newFolder);

  const object = await env.VAULT_BUCKET.get(file.key);
  if (!object) return new Response('Not Found', { status: 404 });

  await env.VAULT_BUCKET.put(newKey, object.body, {
    httpMetadata: object.httpMetadata,
    customMetadata: { fileId: newId },
  });

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
