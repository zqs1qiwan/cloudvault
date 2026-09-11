import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { json, error, getMimeType } from '../utils/response';
import { getSharedFolders, getExcludedFolders, isFolderShared } from './share';
import {
  buildObjectKey,
  contentDisposition,
  findIndexedFileByKey,
  getAllIndexedFiles,
  getIndexedFiles,
  normalizeFolder,
  parseSingleRange,
  serveR2File,
  splitObjectKey,
  stableObjectId,
} from '../utils/files';
import { buildStats } from './stats';

function extractId(url: URL): string | null {
  const parts = url.pathname.split('/');
  const idx = parts.indexOf('files');
  return idx >= 0 && parts[idx + 1] ? parts[idx + 1] : null;
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
  let fileName: string;
  let folder: string;
  try {
    fileName = decodeURIComponent(request.headers.get('X-File-Name') || 'untitled');
    folder = normalizeFolder(decodeURIComponent(request.headers.get('X-Folder') || 'root'));
  } catch {
    return error('Invalid file path', 400);
  }
  const contentType = request.headers.get('Content-Type') || getMimeType(fileName);
  let key: string;
  try { key = buildObjectKey(folder, fileName); } catch { return error('Invalid file path', 400); }
  const existing = await findIndexedFileByKey(env, key);
  const id = existing?.id ?? stableObjectId(key);

  const r2Object = await env.VAULT_BUCKET.put(key, request.body, {
    httpMetadata: {
      contentType,
      contentDisposition: contentDisposition('attachment', fileName),
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
    shareToken: existing?.shareToken ?? null,
    sharePassword: existing?.sharePassword ?? null,
    shareExpiresAt: existing?.shareExpiresAt ?? null,
    downloads: existing?.downloads ?? 0,
  };

  await env.VAULT_KV.put(KV_PREFIX.FILE + id, JSON.stringify(meta));
  await updateStatsCounters(env, meta.size - (existing?.size ?? 0), existing ? 0 : 1);

  return json(meta, existing ? 200 : 201);
}

async function handleMultipartCreate(request: Request, env: Env): Promise<Response> {
  let fileName: string;
  let folder: string;
  let key: string;
  try {
    fileName = decodeURIComponent(request.headers.get('X-File-Name') || 'untitled');
    folder = normalizeFolder(decodeURIComponent(request.headers.get('X-Folder') || 'root'));
    key = buildObjectKey(folder, fileName);
  } catch {
    return error('Invalid file path', 400);
  }
  const contentType = request.headers.get('Content-Type') || getMimeType(fileName);
  const existing = await findIndexedFileByKey(env, key);
  const id = existing?.id ?? stableObjectId(key);

  const multipart = await env.VAULT_BUCKET.createMultipartUpload(key, {
    httpMetadata: {
      contentType,
      contentDisposition: contentDisposition('attachment', fileName),
    },
    customMetadata: { fileId: id },
  });

  return json({ uploadId: multipart.uploadId, key, fileId: id });
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
  if (!body.uploadId || !body.key || !body.parts?.length) {
    return error('Invalid multipart upload data', 400);
  }

  const multipart = env.VAULT_BUCKET.resumeMultipartUpload(body.key, body.uploadId);
  const r2Object = await multipart.complete(body.parts);
  const fileId = r2Object.customMetadata?.fileId;
  if (!fileId) return error('Upload completed without file identity', 500);
  const existing = await findIndexedFileByKey(env, body.key);
  const { name, folder } = splitObjectKey(body.key);
  const meta: FileMeta = {
    id: existing?.id ?? fileId,
    key: body.key,
    name,
    folder,
    size: r2Object.size,
    type: r2Object.httpMetadata?.contentType ?? existing?.type ?? getMimeType(name),
    uploadedAt: new Date().toISOString(),
    shareToken: existing?.shareToken ?? null,
    sharePassword: existing?.sharePassword ?? null,
    shareExpiresAt: existing?.shareExpiresAt ?? null,
    downloads: existing?.downloads ?? 0,
  };
  await env.VAULT_KV.put(KV_PREFIX.FILE + meta.id, JSON.stringify(meta));
  await updateStatsCounters(env, meta.size - (existing?.size ?? 0), existing ? 0 : 1);
  return json(meta, existing ? 200 : 201);
}

function selectFiles(request: Request, files: FileMeta[]): FileMeta[] {
  const url = new URL(request.url);
  const folderFilter = url.searchParams.get('folder');
  const searchFilter = url.searchParams.get('search')?.toLowerCase();
  let selected = files.filter(f => f.folder === (folderFilter || 'root'));
  if (searchFilter) selected = selected.filter(f => f.name.toLowerCase().includes(searchFilter));
  return selected.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
}

export async function list(request: Request, env: Env): Promise<Response> {
  const files = selectFiles(request, await getIndexedFiles(env));
  return json({ files, cursor: null, totalFiles: files.length });
}

export async function syncIndex(request: Request, env: Env): Promise<Response> {
  const allFiles = await getAllIndexedFiles(env, true);
  const folders = await getFolderList(env, allFiles);
  return json({
    totalFiles: allFiles.length,
    files: selectFiles(request, allFiles),
    folders,
    stats: buildStats(allFiles),
  });
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

  return await serveR2File(
    request,
    env.VAULT_BUCKET,
    meta.key,
    meta.name,
    'attachment',
    'private, max-age=14400',
    meta.type,
  ) ?? error('File not found in storage', 404);
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
  let deleted = 0;
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
    deleted++;
  }

  await updateStatsCounters(env, -totalSizeRemoved, -deleted);

  return json({ deleted });
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
  let newKey: string;
  try { newKey = buildObjectKey(meta.folder, body.name); } catch { return error('Invalid file name', 400); }
  const conflict = await findIndexedFileByKey(env, newKey);
  if (conflict && conflict.id !== id) return error('A file with this name already exists', 409);
  if (newKey === meta.key) return json(meta);
  const object = await env.VAULT_BUCKET.get(meta.key);
  if (!object) return error('File not found in storage', 404);
  await env.VAULT_BUCKET.put(newKey, object.body, {
    httpMetadata: { ...object.httpMetadata, contentDisposition: contentDisposition('attachment', body.name.trim()) },
    customMetadata: { ...object.customMetadata, fileId: meta.id },
  });
  await env.VAULT_BUCKET.delete(meta.key);
  meta.name = body.name.trim();
  meta.key = newKey;
  await env.VAULT_KV.put(KV_PREFIX.FILE + id, JSON.stringify(meta));

  return json(meta);
}

export async function createFolder(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ name: string; parent: string }>();
  if (!body.name?.trim()) return error('Folder name required', 400);

  let folderName: string;
  try {
    const parent = normalizeFolder(body.parent);
    folderName = normalizeFolder(parent === 'root' ? body.name : `${parent}/${body.name}`);
  } catch { return error('Invalid folder name', 400); }
  if (await env.VAULT_KV.get('folder:' + folderName)) return error('Folder already exists', 409);
  await env.VAULT_KV.put('folder:' + folderName, JSON.stringify({ name: folderName, createdAt: new Date().toISOString() }));

  return json({ folder: folderName }, 201);
}

export async function deleteFolder(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ folder: string }>();
  if (!body.folder?.trim()) return error('Folder name required', 400);
  let folder: string;
  try { folder = normalizeFolder(body.folder); } catch { return error('Invalid folder path', 400); }
  if (folder === 'root') return error('Root folder cannot be deleted', 400);

  // Delete the folder KV entry
  await env.VAULT_KV.delete('folder:' + folder);

  // Delete any share keys for this folder
  await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE + folder);
  await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_EXCLUDE + folder);

  // Clean up folder share link for this folder
  const metaRaw = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + folder);
  if (metaRaw) {
    try {
      const meta = JSON.parse(metaRaw);
      await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_LINK + meta.token);
    } catch { /* ignore parse errors */ }
    await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + folder);
  }

  // Delete sub-folder KV entries and their share links
  let cursor: string | undefined;
  let deletedSubfolders = 0;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: 'folder:' + folder + '/', limit: 1000, cursor });
    for (const key of result.keys) {
      await env.VAULT_KV.delete(key.name);
      const subName = key.name.replace('folder:', '');
      await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE + subName);
      await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_EXCLUDE + subName);
      // Clean up sub-folder share link
      const subMetaRaw = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + subName);
      if (subMetaRaw) {
        try {
          const subMeta = JSON.parse(subMetaRaw);
          await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_LINK + subMeta.token);
        } catch { /* ignore */ }
        await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + subName);
      }
      deletedSubfolders++;
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  // Delete all contained files (R2 objects + KV entries + share tokens)
  const allFiles = await getIndexedFiles(env);
  let deletedFiles = 0;
  let totalSizeRemoved = 0;
  for (const file of allFiles) {
    if (file.folder === folder || file.folder.startsWith(folder + '/')) {
      await env.VAULT_BUCKET.delete(file.key);
      await env.VAULT_KV.delete(KV_PREFIX.FILE + file.id);
      if (file.shareToken) {
        await env.VAULT_KV.delete(KV_PREFIX.SHARE + file.shareToken);
      }
      totalSizeRemoved += file.size;
      deletedFiles++;
    }
  }

  if (deletedFiles > 0) {
    await updateStatsCounters(env, -totalSizeRemoved, -deletedFiles);
  }

  return json({ deleted: folder, deletedFiles, deletedSubfolders });
}

export async function renameFolder(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ oldName: string; newName: string }>();
  if (!body.oldName?.trim() || !body.newName?.trim()) return error('Both old and new names required', 400);
  let oldName: string;
  let newName: string;
  try {
    oldName = normalizeFolder(body.oldName);
    newName = normalizeFolder(body.newName);
  } catch { return error('Invalid folder path', 400); }
  if (oldName === 'root' || newName === 'root') return error('Root is a reserved folder name', 400);
  if (oldName === newName) return json({ folder: newName });
  if (newName.startsWith(oldName + '/')) return error('Cannot move a folder into itself', 409);
  if (await env.VAULT_KV.get('folder:' + newName)) return error('Target folder already exists', 409);

  const allFiles = await getIndexedFiles(env);
  const movingIds = new Set(allFiles
    .filter((file) => file.folder === oldName || file.folder.startsWith(oldName + '/'))
    .map((file) => file.id));
  for (const file of allFiles) {
    if (!movingIds.has(file.id)) continue;
    const targetFolder = newName + file.folder.slice(oldName.length);
    const targetKey = targetFolder + '/' + file.name;
    if (allFiles.some((other) => !movingIds.has(other.id) && other.key === targetKey)) {
      return error('A file already exists in the target folder', 409);
    }
  }

  async function migrateShareLink(from: string, to: string): Promise<void> {
    const linkMetaRaw = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + from);
    if (!linkMetaRaw) return;
    const linkMeta = JSON.parse(linkMetaRaw) as { token?: string };
    if (linkMeta.token) {
      const tokenKey = KV_PREFIX.FOLDER_SHARE_LINK + linkMeta.token;
      const tokenRaw = await env.VAULT_KV.get(tokenKey);
      if (tokenRaw) {
        const tokenData = JSON.parse(tokenRaw) as Record<string, unknown>;
        tokenData.folder = to;
        await env.VAULT_KV.put(tokenKey, JSON.stringify(tokenData));
      }
    }
    await env.VAULT_KV.put(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + to, linkMetaRaw);
    await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_LINK + 'meta:' + from);
  }

  // Create new folder entry
  await env.VAULT_KV.put('folder:' + newName, JSON.stringify({ name: newName, createdAt: new Date().toISOString() }));
  await env.VAULT_KV.delete('folder:' + oldName);

  // Transfer share status
  const shareVal = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE + oldName);
  if (shareVal) {
    await env.VAULT_KV.put(KV_PREFIX.FOLDER_SHARE + newName, shareVal);
    await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE + oldName);
  }
  const excludeVal = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE_EXCLUDE + oldName);
  if (excludeVal) {
    await env.VAULT_KV.put(KV_PREFIX.FOLDER_SHARE_EXCLUDE + newName, excludeVal);
    await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_EXCLUDE + oldName);
  }
  await migrateShareLink(oldName, newName);

  // Rename sub-folders
  let cursor: string | undefined;
  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: 'folder:' + oldName + '/', limit: 1000, cursor });
    for (const key of result.keys) {
      const subOld = key.name.replace('folder:', '');
      const subNew = newName + subOld.slice(oldName.length);
      const val = await env.VAULT_KV.get(key.name);
      if (val) await env.VAULT_KV.put('folder:' + subNew, val);
      await env.VAULT_KV.delete(key.name);
      const subShare = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE + subOld);
      if (subShare) {
        await env.VAULT_KV.put(KV_PREFIX.FOLDER_SHARE + subNew, subShare);
        await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE + subOld);
      }
      const subExcl = await env.VAULT_KV.get(KV_PREFIX.FOLDER_SHARE_EXCLUDE + subOld);
      if (subExcl) {
        await env.VAULT_KV.put(KV_PREFIX.FOLDER_SHARE_EXCLUDE + subNew, subExcl);
        await env.VAULT_KV.delete(KV_PREFIX.FOLDER_SHARE_EXCLUDE + subOld);
      }
      await migrateShareLink(subOld, subNew);
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  // Update file paths
  for (const file of allFiles) {
    if (file.folder === oldName || file.folder.startsWith(oldName + '/')) {
      const newFolder = newName + file.folder.slice(oldName.length);
      const newKey = newFolder === 'root' ? file.name : newFolder + '/' + file.name;
      const obj = await env.VAULT_BUCKET.get(file.key);
      if (obj) {
        await env.VAULT_BUCKET.put(newKey, obj.body, {
          httpMetadata: obj.httpMetadata,
          customMetadata: obj.customMetadata,
        });
        await env.VAULT_BUCKET.delete(file.key);
      }
      file.key = newKey;
      file.folder = newFolder;
      await env.VAULT_KV.put(KV_PREFIX.FILE + file.id, JSON.stringify(file));
    }
  }

  return json({ folder: newName });
}

async function getFolderList(env: Env, files: FileMeta[]) {
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

  // Ensure all intermediate parent folders are included in the set
  for (const folder of [...folderSet]) {
    const parts = folder.split('/');
    let path = '';
    for (let i = 0; i < parts.length - 1; i++) {
      path = path ? path + '/' + parts[i] : parts[i];
      folderSet.add(path);
    }
  }

  const sharedFolders = await getSharedFolders(env);
  const excludedFolders = await getExcludedFolders(env);
  return Array.from(folderSet).sort().map(name => ({
    name,
    shared: isFolderShared(name, sharedFolders, excludedFolders),
    directlyShared: sharedFolders.has(name),
    excluded: excludedFolders.has(name),
  }));

}

export async function listFolders(_request: Request, env: Env): Promise<Response> {
  return json({ folders: await getFolderList(env, await getIndexedFiles(env)) });
}

export async function bootstrap(request: Request, env: Env): Promise<Response> {
  const allFiles = await getIndexedFiles(env);
  const folders = await getFolderList(env, allFiles);
  const files = selectFiles(request, allFiles);
  return json({ files, folders, stats: buildStats(allFiles) });
}

export async function moveFiles(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ ids: string[]; targetFolder: string }>();
  if (!body.ids?.length) return error('No file IDs provided', 400);
  if (body.targetFolder === undefined) return error('Target folder required', 400);

  let targetFolder: string;
  try { targetFolder = normalizeFolder(body.targetFolder); } catch { return error('Invalid target folder', 400); }
  const allFiles = await getIndexedFiles(env);
  const reservedKeys = new Set(allFiles.map((file) => file.key));
  const operations: Array<{ meta: FileMeta; newKey: string }> = [];
  const targetKeys = new Set<string>();

  for (const id of body.ids) {
    const meta = allFiles.find((file) => file.id === id);
    if (!meta || meta.folder === targetFolder) continue;
    const newKey = targetFolder === 'root' ? meta.name : targetFolder + '/' + meta.name;
    if (reservedKeys.has(newKey) || targetKeys.has(newKey)) {
      return error('A file with the same name already exists in the target folder', 409);
    }
    if (!await env.VAULT_BUCKET.head(meta.key)) return error(`File not found in storage: ${meta.name}`, 404);
    operations.push({ meta, newKey });
    targetKeys.add(newKey);
  }

  let moved = 0;

  for (const { meta, newKey } of operations) {
    const oldObject = await env.VAULT_BUCKET.get(meta.key);
    if (!oldObject) return error(`File not found in storage: ${meta.name}`, 404);

    await env.VAULT_BUCKET.put(newKey, oldObject.body, {
      httpMetadata: oldObject.httpMetadata,
      customMetadata: { ...oldObject.customMetadata, fileId: meta.id },
    });
    await env.VAULT_BUCKET.delete(meta.key);

    meta.key = newKey;
    meta.folder = targetFolder;
    await env.VAULT_KV.put(KV_PREFIX.FILE + meta.id, JSON.stringify(meta));
    moved++;
  }

  return json({ moved });
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
  headers.set('Cache-Control', 'public, max-age=14400, s-maxage=86400');

  return new Response(object.body, { headers });
}

// ─── Inline Preview (admin) ───────────────────────────────────────────
export async function preview(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split('/');
  const id = parts[parts.indexOf('files') + 1];
  if (!id) return error('File ID required', 400);

  const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
  if (!raw) return error('File not found', 404);
  const meta: FileMeta = JSON.parse(raw);

  const rangeHeader = request.headers.get('Range');
  const head = await env.VAULT_BUCKET.head(meta.key);
  if (!head) return error('File not found in storage', 404);
  const range = rangeHeader ? parseSingleRange(rangeHeader, head.size) : null;
  if (rangeHeader && !range) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': 'bytes */' + head.size },
    });
  }
  const object = await env.VAULT_BUCKET.get(meta.key, range ? { range } : undefined);
  if (!object) return error('File not found in storage', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Content-Type', meta.type || 'application/octet-stream');
  headers.set('Content-Disposition', contentDisposition('inline', meta.name));
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('Accept-Ranges', 'bytes');

  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    headers.set('Content-Length', String(range.length));
    return new Response(object.body, { status: 206, headers });
  }

  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { headers });
}

// ─── Zip Download (multiple files) ────────────────────────────────────
export async function zipDownload(request: Request, env: Env): Promise<Response> {
  const body = await request.json<{ ids: string[] }>();
  if (!body.ids?.length) return error('No file IDs provided', 400);
  if (body.ids.length > 100) return error('Max 100 files per zip', 400);

  // Collect file metadata
  const fileMetas: FileMeta[] = [];
  for (const id of body.ids) {
    const raw = await env.VAULT_KV.get(KV_PREFIX.FILE + id);
    if (raw) {
      try { fileMetas.push(JSON.parse(raw)); } catch { /* skip */ }
    }
  }

  if (fileMetas.length === 0) return error('No valid files found', 404);

  // For single file, just redirect to download
  if (fileMetas.length === 1) {
    const meta = fileMetas[0];
    const object = await env.VAULT_BUCKET.get(meta.key);
    if (!object) return error('File not found in storage', 404);
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('Content-Disposition', 'attachment; filename="' + encodeURIComponent(meta.name) + '"');
    headers.set('Content-Length', String(object.size));
    return new Response(object.body, { headers });
  }

  // Build a simple uncompressed zip using Uint8Arrays
  // We stream a minimal zip format (store method, no compression)
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const meta of fileMetas) {
    const object = await env.VAULT_BUCKET.get(meta.key);
    if (!object) continue;

    const fileData = new Uint8Array(await object.arrayBuffer());
    const fileName = encoder.encode(meta.name);
    const crc = crc32(fileData);

    // Local file header (30 + nameLen bytes)
    const localHeader = new Uint8Array(30 + fileName.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);  // signature
    lv.setUint16(4, 20, true);           // version needed
    lv.setUint16(6, 0, true);            // flags
    lv.setUint16(8, 0, true);            // compression (store)
    lv.setUint16(10, 0, true);           // mod time
    lv.setUint16(12, 0, true);           // mod date
    lv.setUint32(14, crc, true);         // crc-32
    lv.setUint32(18, fileData.length, true); // compressed size
    lv.setUint32(22, fileData.length, true); // uncompressed size
    lv.setUint16(26, fileName.length, true); // file name length
    lv.setUint16(28, 0, true);           // extra field length
    localHeader.set(fileName, 30);

    // Central directory entry
    const cdEntry = new Uint8Array(46 + fileName.length);
    const cv = new DataView(cdEntry.buffer);
    cv.setUint32(0, 0x02014b50, true);   // signature
    cv.setUint16(4, 20, true);           // version made by
    cv.setUint16(6, 20, true);           // version needed
    cv.setUint16(8, 0, true);            // flags
    cv.setUint16(10, 0, true);           // compression
    cv.setUint16(12, 0, true);           // mod time
    cv.setUint16(14, 0, true);           // mod date
    cv.setUint32(16, crc, true);         // crc-32
    cv.setUint32(20, fileData.length, true); // compressed size
    cv.setUint32(24, fileData.length, true); // uncompressed size
    cv.setUint16(28, fileName.length, true); // file name length
    cv.setUint16(30, 0, true);           // extra length
    cv.setUint16(32, 0, true);           // comment length
    cv.setUint16(34, 0, true);           // disk number start
    cv.setUint16(36, 0, true);           // internal attributes
    cv.setUint32(38, 0, true);           // external attributes
    cv.setUint32(42, offset, true);      // relative offset
    cdEntry.set(fileName, 46);

    parts.push(localHeader);
    parts.push(fileData);
    centralDir.push(cdEntry);
    offset += localHeader.length + fileData.length;
  }

  // End of central directory
  let cdSize = 0;
  for (const cd of centralDir) cdSize += cd.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);     // signature
  ev.setUint16(4, 0, true);              // disk number
  ev.setUint16(6, 0, true);              // disk with cd
  ev.setUint16(8, centralDir.length, true); // entries on disk
  ev.setUint16(10, centralDir.length, true); // total entries
  ev.setUint32(12, cdSize, true);         // cd size
  ev.setUint32(16, offset, true);         // cd offset
  ev.setUint16(20, 0, true);             // comment length

  // Combine all parts
  let totalSize = offset + cdSize + 22;
  const zipBuffer = new Uint8Array(totalSize);
  let pos = 0;
  for (const part of parts) { zipBuffer.set(part, pos); pos += part.length; }
  for (const cd of centralDir) { zipBuffer.set(cd, pos); pos += cd.length; }
  zipBuffer.set(eocd, pos);

  const zipName = 'cloudvault-' + new Date().toISOString().slice(0, 10) + '.zip';
  return new Response(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="' + zipName + '"',
      'Content-Length': String(totalSize),
    },
  });
}

// ─── CRC-32 for zip ───────────────────────────────────────────────────
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
