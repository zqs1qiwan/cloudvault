// ─── Files API ────────────────────────────────────────────────────────
//
// Every handler here talks to R2 directly. There is no index to read, no index
// to repair, and no row that can disagree with the bytes: a listing is a
// `list()` on a prefix, a file is a `head()` on its key.

import type { Env, FileMeta } from '../utils/types';
import {
  ROOT,
  buildObjectKey,
  folderOf,
  isMarkerKey,
  nameOf,
  normalizeFolder,
  validateFileName,
} from '../lib/paths';
import {
  copyObject,
  copyTree,
  createFolderMarker,
  deleteKeys,
  folderExists,
  headObject,
  listAllInFolder,
  listDir,
  listKeysUnder,
  mapLimit,
  metaFromObject,
  objectExists,
  putObject,
} from '../lib/objects';
import { json, error, ok, serveObject } from '../lib/http';
import { buildStats, invalidateSnapshot, listFolders } from '../lib/snapshot';
import {
  deleteSharesForKeys,
  findShareForKey,
  listShares,
  migrateLegacyIndex,
  purgeFolderFlags,
  purgeFolderLinks,
  renameFolderFlags,
  retargetFolderLinks,
  retargetShares,
  retargetSharesBulk,
} from '../lib/shares';
import { buildZipStream, uniqueEntryNames } from '../lib/zip';

const ZIP_MAX_ENTRIES = 200;
const ZIP_MAX_BYTES = 512 * 1024 * 1024;

/** Keys arrive from the client (they *are* the file ids) and are validated. */
function keyFromClient(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Invalid key');
  const parts = value.split('/');
  if (parts.length > 64) throw new Error('Invalid key');
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || part.includes('\\') || /[\u0000-\u001f\u007f]/.test(part)) {
      throw new Error('Invalid key');
    }
  }
  if (isMarkerKey(value)) throw new Error('Invalid key');
  return value;
}

function keysFromBody(value: unknown, field = 'ids'): string[] {
  if (!Array.isArray(value)) throw new Error(`Missing ${field}`);
  const unique = new Set<string>();
  for (const entry of value) unique.add(keyFromClient(entry));
  return [...unique];
}

async function metaForKey(env: Env, key: string): Promise<FileMeta | null> {
  const object = await headObject(env, key);
  if (!object) return null;
  const share = await findShareForKey(env, key);
  return metaFromObject(object, share ? new Map([[key, share]]) : undefined);
}

// ─── Listing ──────────────────────────────────────────────────────────

async function listPayload(
  env: Env,
  folder: string,
  options: { cursor?: string; search?: string; limit?: number },
): Promise<{ files: FileMeta[]; cursor: string | null }> {
  const shares = await listShares(env);

  if (options.search) {
    const needle = options.search.toLowerCase();
    const objects = await listAllInFolder(env, folder);
    const files = objects
      .map((object) => metaFromObject(object, shares))
      .filter((file) => file.name.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { files, cursor: null };
  }

  const page = await listDir(env, folder, { cursor: options.cursor, limit: options.limit });
  return {
    files: page.objects.map((object) => metaFromObject(object, shares)),
    cursor: page.cursor,
  };
}

export async function handleListFiles(url: URL, env: Env): Promise<Response> {
  try {
    const folder = normalizeFolder(url.searchParams.get('folder'));
    const payload = await listPayload(env, folder, {
      cursor: url.searchParams.get('cursor') ?? undefined,
      search: url.searchParams.get('search')?.trim() || undefined,
    });
    return json(payload);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleBootstrap(url: URL, env: Env): Promise<Response> {
  try {
    const folder = normalizeFolder(url.searchParams.get('folder'));
    const [payload, folders, stats] = await Promise.all([
      listPayload(env, folder, {
        cursor: url.searchParams.get('cursor') ?? undefined,
        search: url.searchParams.get('search')?.trim() || undefined,
      }),
      listFolders(env),
      buildStats(env),
    ]);
    return json({ ...payload, folders, stats, totalFiles: stats.totalFiles });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleFolders(env: Env): Promise<Response> {
  return json({ folders: await listFolders(env) });
}

export async function handleStats(env: Env): Promise<Response> {
  return json(await buildStats(env));
}

export async function handleFileMeta(url: URL, env: Env): Promise<Response> {
  try {
    const key = keyFromClient(url.searchParams.get('key'));
    const meta = await metaForKey(env, key);
    return meta ? json(meta) : error('File not found', 404);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── Serving bytes ────────────────────────────────────────────────────

export async function handleDownload(url: URL, request: Request, env: Env): Promise<Response> {
  try {
    const key = keyFromClient(url.searchParams.get('key'));
    const response = await serveObject(request, env.VAULT_BUCKET, key, {
      name: nameOf(key),
      disposition: 'attachment',
      cacheControl: 'private, max-age=0',
    });
    return response ?? error('File not found', 404);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handlePreview(url: URL, request: Request, env: Env): Promise<Response> {
  try {
    const key = keyFromClient(url.searchParams.get('key'));
    const response = await serveObject(request, env.VAULT_BUCKET, key, {
      name: nameOf(key),
      disposition: 'inline',
      cacheControl: 'private, max-age=3600',
    });
    return response ?? error('File not found', 404);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleThumbnail(url: URL, request: Request, env: Env): Promise<Response> {
  try {
    const key = keyFromClient(url.searchParams.get('key'));
    const response = await serveObject(request, env.VAULT_BUCKET, key, {
      name: nameOf(key),
      disposition: 'inline',
      // The bytes are immutable for a given ETag, so edge and browser caches
      // may both keep it; a re-upload changes the ETag and invalidates it.
      cacheControl: 'private, max-age=86400',
    });
    return response ?? error('File not found', 404);
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── Mutations ────────────────────────────────────────────────────────

export async function handleRename(request: Request, env: Env): Promise<Response> {
  let body: { key?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const from = keyFromClient(body.key);
    const fileName = validateFileName(String(body.name ?? ''));
    const to = buildObjectKey(folderOf(from), fileName);

    if (to === from) return json(await metaForKey(env, from));
    if (await objectExists(env, to)) return error('A file with that name already exists', 409);
    if (!(await copyObject(env, from, to))) return error('File not found', 404);

    await env.VAULT_BUCKET.delete(from);
    await retargetShares(env, from, to);
    invalidateSnapshot(env);
    return json(await metaForKey(env, to));
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleDelete(request: Request, env: Env): Promise<Response> {
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const keys = keysFromBody(body.ids);
    await deleteKeys(env, keys);
    await deleteSharesForKeys(env, new Set(keys));
    invalidateSnapshot(env);
    return json({ deleted: keys.length });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleMove(request: Request, env: Env): Promise<Response> {
  let body: { ids?: unknown; targetFolder?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const keys = keysFromBody(body.ids);
    const target = normalizeFolder(String(body.targetFolder ?? ROOT));

    const moves = keys.map((key) => ({ from: key, to: buildObjectKey(target, nameOf(key)) }));

    const conflicts: string[] = [];
    await mapLimit(moves, 4, async (move) => {
      if (move.from === move.to) return;
      if (await objectExists(env, move.to)) conflicts.push(nameOf(move.to));
    });
    if (conflicts.length) return error(`Already exists in target folder: ${conflicts.join(', ')}`, 409);

    const failures: string[] = [];
    await mapLimit(moves, 4, async (move) => {
      if (move.from === move.to) return;
      const copied = await copyObject(env, move.from, move.to);
      if (!copied) {
        failures.push(nameOf(move.from));
        return;
      }
      await env.VAULT_BUCKET.delete(move.from);
      await retargetShares(env, move.from, move.to);
    });

    invalidateSnapshot(env);
    if (failures.length) return error(`Some files could not be moved: ${failures.join(', ')}`, 502);
    return json({ moved: moves.length });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── ZIP ──────────────────────────────────────────────────────────────

export async function handleZip(request: Request, env: Env): Promise<Response> {
  let body: { ids?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  let keys: string[];
  try {
    keys = keysFromBody(body.ids);
  } catch (err) {
    return error((err as Error).message, 400);
  }

  if (keys.length > ZIP_MAX_ENTRIES) {
    return error(`Too many files for a single archive (max ${ZIP_MAX_ENTRIES})`, 413);
  }

  const heads = await mapLimit(keys, 8, (key) => headObject(env, key));
  const missing = keys.filter((_, index) => heads[index] === null);
  if (missing.length) return error(`File not found: ${missing[0]}`, 404);

  const totalBytes = heads.reduce((sum, head) => sum + (head?.size ?? 0), 0);
  if (totalBytes > ZIP_MAX_BYTES) {
    return error(`Archive would exceed ${Math.round(ZIP_MAX_BYTES / 1024 / 1024)}MB; select fewer files`, 413);
  }

  const metas = heads.map((head) => metaFromObject(head!, undefined));
  const entryNames = uniqueEntryNames(metas.map((meta) => meta.key));

  const sources = metas.map((meta, index) => ({
    name: entryNames[index],
    size: meta.size,
    modified: new Date(meta.uploadedAt),
    open: async () => (await env.VAULT_BUCKET.get(meta.key))?.body ?? null,
  }));

  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return new Response(buildZipStream(sources), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="cloudvault-${stamp}.zip"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// ─── Upload ───────────────────────────────────────────────────────────

export async function handleUpload(request: Request, url: URL, env: Env): Promise<Response> {
  const action = url.searchParams.get('action');

  if (action === 'mpu-create') return createMultipart(request, env);
  if (action === 'mpu-upload') return uploadPart(request, url, env);
  if (action === 'mpu-complete') return completeMultipart(request, env);
  if (action === 'mpu-abort') return abortMultipart(request, env);
  return directUpload(request, env);
}

async function directUpload(request: Request, env: Env): Promise<Response> {
  let key: string;
  try {
    const name = decodeURIComponent(request.headers.get('X-File-Name') ?? '');
    const folder = decodeURIComponent(request.headers.get('X-Folder') ?? ROOT);
    key = buildObjectKey(folder, name);
  } catch (err) {
    return error((err as Error).message, 400);
  }

  const contentType = request.headers.get('Content-Type') || undefined;
  const object = await putObject(env, key, request.body, { contentType });
  if (!object) return error('Upload failed', 500);

  invalidateSnapshot(env);
  return json(metaFromObject(object));
}

async function createMultipart(request: Request, env: Env): Promise<Response> {
  let key: string;
  try {
    const name = decodeURIComponent(request.headers.get('X-File-Name') ?? '');
    const folder = decodeURIComponent(request.headers.get('X-Folder') ?? ROOT);
    key = buildObjectKey(folder, name);
  } catch (err) {
    return error((err as Error).message, 400);
  }

  const contentType = request.headers.get('Content-Type') || undefined;
  const upload = await env.VAULT_BUCKET.createMultipartUpload(key, {
    httpMetadata: contentType ? { contentType } : undefined,
    customMetadata: { uploadedAt: new Date().toISOString() },
  });

  return json({ uploadId: upload.uploadId, key });
}

async function uploadPart(request: Request, url: URL, env: Env): Promise<Response> {
  try {
    const key = keyFromClient(url.searchParams.get('key'));
    const uploadId = url.searchParams.get('uploadId');
    const partNumber = Number(url.searchParams.get('partNumber'));
    if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1) throw new Error('Invalid part request');

    const upload = env.VAULT_BUCKET.resumeMultipartUpload(key, uploadId);
    const part = await upload.uploadPart(partNumber, request.body as ReadableStream);
    return json({ partNumber: part.partNumber, etag: part.etag });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

async function completeMultipart(request: Request, env: Env): Promise<Response> {
  let body: { uploadId?: unknown; key?: unknown; parts?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const key = keyFromClient(body.key);
    const uploadId = String(body.uploadId ?? '');
    if (!uploadId || !Array.isArray(body.parts)) throw new Error('Invalid completion request');

    const parts = body.parts.map((part) => ({
      partNumber: Number((part as { partNumber: unknown }).partNumber),
      etag: String((part as { etag: unknown }).etag),
    }));

    const upload = env.VAULT_BUCKET.resumeMultipartUpload(key, uploadId);
    const object = await upload.complete(parts);
    invalidateSnapshot(env);
    return json(metaFromObject(object));
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

async function abortMultipart(request: Request, env: Env): Promise<Response> {
  let body: { uploadId?: unknown; key?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const key = keyFromClient(body.key);
    const uploadId = String(body.uploadId ?? '');
    if (!uploadId) throw new Error('Invalid abort request');
    await env.VAULT_BUCKET.resumeMultipartUpload(key, uploadId).abort();
    return ok('aborted');
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── Folders ──────────────────────────────────────────────────────────

/**
 * Move a whole subtree, then retarget the shares in one pass instead of one
 * scan per file.
 */
async function migrateFolder(env: Env, from: string, to: string): Promise<{ moved: number; failed: string[] }> {
  const { pairs, failed } = await copyTree(env, from, to, { deleteSource: true });
  await retargetSharesBulk(env, new Map(pairs.filter(([key]) => !isMarkerKey(key))));
  return { moved: pairs.length - failed.length, failed };
}

export async function handleCreateFolder(request: Request, env: Env): Promise<Response> {
  let body: { name?: unknown; parent?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const name = validateFileName(String(body.name ?? ''));
    const parent = normalizeFolder(String(body.parent ?? ROOT));
    const folder = parent === ROOT ? name : `${parent}/${name}`;

    if (await objectExists(env, folder)) return error('A file with that name already exists', 409);
    if (await folderExists(env, folder)) return error('Folder already exists', 409);

    await createFolderMarker(env, folder);
    invalidateSnapshot(env);
    return json({ folder, created: true });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleRenameFolder(request: Request, env: Env): Promise<Response> {
  let body: { oldName?: unknown; newName?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const from = normalizeFolder(String(body.oldName ?? ''));
    if (from === ROOT) return error('Cannot rename the root folder', 400);

    const target = normalizeFolder(String(body.newName ?? ''));
    if (target === ROOT) return error('Invalid folder name', 400);
    if (target === from) return json({ folder: target, moved: 0 });

    if (!(await folderExists(env, from))) return error('Folder not found', 404);
    if ((await folderExists(env, target)) || (await objectExists(env, target))) {
      return error('A folder or file with that name already exists', 409);
    }

    const result = await migrateFolder(env, from, target);

    // The folder's own marker lives under the old prefix and was copied above;
    // remove the now-empty source prefix explicitly for clarity.
    const leftovers = await listKeysUnder(env, from);
    if (leftovers.length) await deleteKeys(env, leftovers);

    await renameFolderFlags(env, from, target);
    await retargetFolderLinks(env, from, target);
    invalidateSnapshot(env);

    if (result.failed.length) {
      return error(`Moved ${result.moved} items, ${result.failed.length} failed`, 502);
    }
    return json({ folder: target, moved: result.moved });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

export async function handleDeleteFolder(request: Request, env: Env): Promise<Response> {
  let body: { folder?: unknown };
  try {
    body = await request.json();
  } catch {
    return error('Invalid request body', 400);
  }

  try {
    const folder = normalizeFolder(String(body.folder ?? ''));
    if (folder === ROOT) return error('Cannot delete the root folder', 400);
    if (!(await folderExists(env, folder))) return error('Folder not found', 404);

    const keys = await listKeysUnder(env, folder);
    await deleteKeys(env, keys);
    await deleteSharesForKeys(env, new Set(keys));
    await purgeFolderFlags(env, folder);
    await purgeFolderLinks(env, folder);
    invalidateSnapshot(env);

    return json({ deleted: keys.length });
  } catch (err) {
    return error((err as Error).message, 400);
  }
}

// ─── Sync ─────────────────────────────────────────────────────────────

/**
 * `sync` used to reconcile two stores. There is only one store now, so the
 * endpoint does the one thing left that matters: retire the legacy KV index
 * (converting any share tokens it still holds into share records) and drop the
 * cached snapshot, then answer with a fresh view.
 */
export async function handleSync(url: URL, env: Env): Promise<Response> {
  const migrated = await migrateLegacyIndex(env);
  invalidateSnapshot(env);
  const folder = normalizeFolder(url.searchParams.get('folder'));

  const [payload, folders, stats] = await Promise.all([
    listPayload(env, folder, { search: url.searchParams.get('search')?.trim() || undefined }),
    listFolders(env),
    buildStats(env),
  ]);

  return json({
    ...payload,
    folders,
    stats,
    totalFiles: stats.totalFiles,
    migrated,
    message: migrated.removed
      ? `Retired ${migrated.removed} legacy index rows`
      : 'Index already up to date',
  });
}

// ─── Exported limits (used by the router's error messages) ────────────
export const ZIP_LIMITS = { maxEntries: ZIP_MAX_ENTRIES, maxBytes: ZIP_MAX_BYTES };
