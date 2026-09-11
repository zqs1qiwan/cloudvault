import type { Env, FileMeta } from './types';
import { KV_PREFIX } from './types';
import { getMimeType } from './response';

export interface IndexedObject {
  key: string;
  size: number;
  uploaded: Date;
  httpMetadata?: R2HTTPMetadata;
  customMetadata?: Record<string, string>;
}

export interface FileIndexPlan {
  files: FileMeta[];
  puts: FileMeta[];
  deletes: string[];
  shareUpdates: Array<{ token: string; fileId: string }>;
  shareDeletes: string[];
}

function validateSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`Invalid ${label}`);
  }
  return trimmed;
}

export function normalizeFolder(folder: string): string {
  const value = folder.trim();
  if (!value || value === 'root') return 'root';
  const parts = value.split('/');
  if (parts.some((part) => part === '')) throw new Error('Invalid folder path');
  return parts.map((part) => validateSegment(part, 'folder path')).join('/');
}

export function buildObjectKey(folder: string, fileName: string): string {
  const normalizedFolder = normalizeFolder(folder);
  const normalizedName = validateSegment(fileName, 'file name');
  return normalizedFolder === 'root' ? normalizedName : `${normalizedFolder}/${normalizedName}`;
}

export function splitObjectKey(key: string): { name: string; folder: string } {
  const slash = key.lastIndexOf('/');
  return slash < 0
    ? { name: key, folder: 'root' }
    : { name: key.slice(slash + 1), folder: key.slice(0, slash) };
}

export function stableObjectId(key: string): string {
  const seeds = [0x811c9dc5, 0x9e3779b9, 0x85ebca6b, 0xc2b2ae35];
  const values = seeds.map((seed) => {
    let hash = seed;
    for (const byte of new TextEncoder().encode(key)) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
  });
  return `r2-${values.join('')}`;
}

function sameMeta(a: FileMeta, b: FileMeta): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function buildFileIndexPlan(existing: FileMeta[], objects: IndexedObject[]): FileIndexPlan {
  const byKey = new Map<string, FileMeta[]>();
  for (const meta of existing) {
    const entries = byKey.get(meta.key) ?? [];
    entries.push(meta);
    byKey.set(meta.key, entries);
  }

  const files: FileMeta[] = [];
  const puts: FileMeta[] = [];
  const deletes: string[] = [];
  const shareUpdates: Array<{ token: string; fileId: string }> = [];
  const shareDeletes: string[] = [];
  const objectKeys = new Set(objects.map((object) => object.key));
  const claimedIds = new Set<string>();
  const preferredIdCounts = new Map<string, number>();
  for (const object of objects) {
    const id = object.customMetadata?.fileId;
    if (id) preferredIdCounts.set(id, (preferredIdCounts.get(id) ?? 0) + 1);
  }

  for (const object of objects) {
    const candidates = (byKey.get(object.key) ?? []).sort((a, b) =>
      a.uploadedAt.localeCompare(b.uploadedAt),
    );
    const preferredId = object.customMetadata?.fileId;
    const preferredMeta = existing.find((meta) => meta.id === preferredId);
    const hasUniquePreferredId = !!preferredId && preferredIdCounts.get(preferredId) === 1;
    const relocatedMeta = preferredMeta && hasUniquePreferredId && !objectKeys.has(preferredMeta.key)
      ? preferredMeta
      : null;
    const canonical = candidates[0]
      ?? relocatedMeta
      ?? null;
    const related = canonical && !candidates.some((meta) => meta.id === canonical.id)
      ? [canonical, ...candidates]
      : candidates;
    const shared = related.find((meta) => meta.shareToken);
    const { name, folder } = splitObjectKey(object.key);
    const usablePreferredId = hasUniquePreferredId && (!preferredMeta || relocatedMeta) ? preferredId : undefined;
    let id = canonical?.id ?? usablePreferredId ?? stableObjectId(object.key);
    if (claimedIds.has(id)) id = stableObjectId(object.key);
    let suffix = 1;
    const baseId = id;
    while (claimedIds.has(id)) id = `${baseId}-${suffix++}`;
    claimedIds.add(id);
    const next: FileMeta = {
      id,
      key: object.key,
      name,
      size: object.size,
      type: object.httpMetadata?.contentType ?? canonical?.type ?? getMimeType(name),
      folder,
      uploadedAt: object.uploaded.toISOString(),
      shareToken: canonical?.shareToken ?? shared?.shareToken ?? null,
      sharePassword: canonical?.sharePassword ?? shared?.sharePassword ?? null,
      shareExpiresAt: canonical?.shareExpiresAt ?? shared?.shareExpiresAt ?? null,
      downloads: Math.max(0, ...related.map((meta) => meta.downloads ?? 0)),
    };

    files.push(next);
    if (!canonical || !sameMeta(canonical, next)) puts.push(next);
    if (next.shareToken) shareUpdates.push({ token: next.shareToken, fileId: next.id });

    for (const duplicate of candidates) {
      if (duplicate.id === next.id) continue;
      deletes.push(duplicate.id);
      if (duplicate.shareToken && duplicate.shareToken !== next.shareToken) {
        shareDeletes.push(duplicate.shareToken);
      }
    }
  }

  for (const meta of existing) {
    if (!objectKeys.has(meta.key)) {
      deletes.push(meta.id);
      if (meta.shareToken) shareDeletes.push(meta.shareToken);
    }
  }

  const retainedIds = new Set(files.map((file) => file.id));
  return {
    files,
    puts,
    deletes: [...new Set(deletes)].filter((id) => !retainedIds.has(id)),
    shareUpdates,
    shareDeletes: [...new Set(shareDeletes)],
  };
}

export async function getStoredFiles(env: Env): Promise<FileMeta[]> {
  const files: FileMeta[] = [];
  let cursor: string | undefined;
  do {
    const result = await env.VAULT_KV.list({ prefix: KV_PREFIX.FILE, limit: 1000, cursor });
    const values = await Promise.all(result.keys.map((key) => env.VAULT_KV.get(key.name)));
    for (const raw of values) {
      if (!raw) continue;
      try {
        files.push(JSON.parse(raw) as FileMeta);
      } catch {
        // Corrupt metadata is ignored; its key can be repaired manually.
      }
    }
    cursor = result.list_complete ? undefined : result.cursor;
  } while (cursor);
  return files;
}

export async function getIndexedFiles(env: Env): Promise<FileMeta[]> {
  return getStoredFiles(env);
}

async function readR2Objects(env: Env): Promise<IndexedObject[]> {
  const objects: IndexedObject[] = [];
  let cursor: string | undefined;
  do {
    const result = await env.VAULT_BUCKET.list({
      limit: 1000,
      cursor,
      include: ['httpMetadata', 'customMetadata'],
    });
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function getAllIndexedFiles(env: Env, repair = false): Promise<FileMeta[]> {
  const [metadata, objects] = await Promise.all([getStoredFiles(env), readR2Objects(env)]);
  const plan = buildFileIndexPlan(metadata, objects);

  if (repair) {
    await Promise.all([
      ...plan.deletes.map((id) => env.VAULT_KV.delete(KV_PREFIX.FILE + id)),
      ...plan.shareDeletes.map((token) => env.VAULT_KV.delete(KV_PREFIX.SHARE + token)),
    ]);
    await Promise.all([
      ...plan.puts.map((meta) => env.VAULT_KV.put(KV_PREFIX.FILE + meta.id, JSON.stringify(meta))),
      ...plan.shareUpdates.map(({ token, fileId }) => env.VAULT_KV.put(KV_PREFIX.SHARE + token, fileId)),
    ]);
  }

  return plan.files;
}

export async function findIndexedFileByKey(env: Env, key: string): Promise<FileMeta | null> {
  const files = await getIndexedFiles(env);
  return files.find((file) => file.key === key) ?? null;
}

export function parseSingleRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}

export function contentDisposition(disposition: 'attachment' | 'inline', fileName: string): string {
  const safe = fileName.replace(/[\r\n\\"]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'download';
  return `${disposition}; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export async function serveR2File(
  request: Request,
  bucket: R2Bucket,
  key: string,
  fileName: string,
  disposition: 'attachment' | 'inline',
  cacheControl: string,
  contentType?: string,
): Promise<Response | null> {
  const head = await bucket.head(key);
  if (!head) return null;
  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader ? parseSingleRange(rangeHeader, head.size) : null;
  if (rangeHeader && !range) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${head.size}` },
    });
  }
  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object) return null;
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', cacheControl);
  headers.set('Content-Disposition', contentDisposition(disposition, fileName));
  headers.set('Content-Type', contentType || head.httpMetadata?.contentType || getMimeType(fileName));
  headers.set('Accept-Ranges', 'bytes');
  headers.set('Content-Length', String(range?.length ?? head.size));
  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
  }
  return new Response(object.body, { status: range ? 206 : 200, headers });
}
