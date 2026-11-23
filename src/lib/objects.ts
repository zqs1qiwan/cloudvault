// ─── R2 access ────────────────────────────────────────────────────────
//
// One source of truth. Every read below comes from the bucket; every write
// below writes only the bucket. The KV namespace holds sessions, site
// settings, share tokens and rate-limit counters - never a copy of a file's
// metadata.

import type { Env, FileMeta } from '../utils/types';
import {
  ROOT,
  buildObjectKey,
  folderMarkerKey,
  folderOf,
  folderPrefix,
  isMarkerKey,
  nameOf,
  normalizeFolder,
} from './paths';
import { getMimeType } from './mime';

export const LIST_PAGE = 1000;
export const PAGE_LIMIT = 200;
export const MAX_PAGE_LIMIT = 1000;

/** A share record, reduced to what a file row needs to display. */
export interface ShareSummary {
  token: string;
  expiresAt: string | null;
  hasPassword: boolean;
  downloads: number;
}

export type ShareMap = Map<string, ShareSummary>;

const EMPTY_SHARES: ShareMap = new Map();

export function uploadedAtOf(object: R2Object): string {
  const custom = object.customMetadata?.uploadedAt;
  if (custom) {
    const parsed = Date.parse(custom);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return object.uploaded.toISOString();
}

export function metaFromObject(object: R2Object, shares: ShareMap = EMPTY_SHARES): FileMeta {
  const key = object.key;
  const name = nameOf(key);
  const share = shares.get(key);
  return {
    id: key,
    key,
    name,
    folder: folderOf(key),
    size: object.size,
    type: object.httpMetadata?.contentType || getMimeType(name),
    uploadedAt: uploadedAtOf(object),
    etag: object.httpEtag,
    shareToken: share?.token ?? null,
    shareExpiresAt: share?.expiresAt ?? null,
    hasSharePassword: share?.hasPassword ?? false,
    downloads: share?.downloads ?? 0,
  };
}

interface ListOptions {
  prefix?: string;
  delimiter?: string;
  cursor?: string;
  limit?: number;
}

function list(env: Env, options: ListOptions): Promise<R2Objects> {
  return env.VAULT_BUCKET.list({
    prefix: options.prefix,
    delimiter: options.delimiter,
    cursor: options.cursor,
    limit: options.limit ?? LIST_PAGE,
    include: ['httpMetadata', 'customMetadata'],
  });
}

/** Every object in the bucket, one page at a time, without holding them all. */
export async function scanObjects(env: Env, visit: (objects: R2Object[]) => void): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const page = await list(env, { cursor });
    visit(page.objects);
    if (!page.truncated) return;
    cursor = page.cursor;
  }
}

/** Every object in the bucket, materialised. Only for callers that need them all. */
export async function listAll(env: Env): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  await scanObjects(env, (page) => { objects.push(...page); });
  return objects;
}

/**
 * The immediate children of one folder: files plus sub-folder paths.
 *
 * `delimiter: '/'` makes R2 do the grouping, so a folder with 400 sub-folders
 * costs one list call instead of 400 prefix checks. The cursor is R2's own,
 * which keeps paging consistent with the delimiter.
 */
export async function listDir(
  env: Env,
  folder: string,
  options: { cursor?: string; limit?: number } = {},
): Promise<{ objects: R2Object[]; folders: string[]; cursor: string | null }> {
  const normalized = normalizeFolder(folder);
  const prefix = folderPrefix(normalized);
  const page = await list(env, {
    prefix,
    delimiter: '/',
    cursor: options.cursor,
    limit: options.limit ?? PAGE_LIMIT,
  });

  const folders: string[] = [];
  for (const p of page.delimitedPrefixes ?? []) {
    const trimmed = p.endsWith('/') ? p.slice(0, -1) : p;
    if (trimmed) folders.push(trimmed);
  }

  return {
    objects: page.objects.filter((object) => !isMarkerKey(object.key)),
    folders,
    cursor: page.truncated ? page.cursor ?? null : null,
  };
}

/** All files directly inside a folder, all pages, markers removed. */
export async function listAllInFolder(env: Env, folder: string): Promise<R2Object[]> {
  const normalized = normalizeFolder(folder);
  const prefix = folderPrefix(normalized);
  const objects: R2Object[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list(env, { prefix, cursor });
    for (const object of page.objects) {
      // With a prefix and no delimiter every descendant comes back; keep only
      // the direct children of this folder.
      if (isMarkerKey(object.key)) continue;
      if (folderOf(object.key) !== normalized) continue;
      objects.push(object);
    }
    if (!page.truncated) return objects;
    cursor = page.cursor;
  }
}

export function headObject(env: Env, key: string): Promise<R2Object | null> {
  return env.VAULT_BUCKET.head(key);
}

export async function objectExists(env: Env, key: string): Promise<boolean> {
  return (await env.VAULT_BUCKET.head(key)) !== null;
}

/**
 * A folder exists when something lives under it - a file, a sub-folder marker,
 * or its own marker. This is the same rule `listDir` uses to report sub-folders,
 * so "can I open it" and "does the listing show it" can never disagree.
 */
export async function folderExists(env: Env, folder: string): Promise<boolean> {
  const normalized = normalizeFolder(folder);
  if (normalized === ROOT) return true;
  const marker = await env.VAULT_BUCKET.head(folderMarkerKey(normalized));
  if (marker) return true;
  const page = await list(env, { prefix: `${normalized}/`, limit: 1 });
  return page.objects.length > 0 || (page.delimitedPrefixes?.length ?? 0) > 0;
}

export interface PutOptions {
  contentType?: string;
  uploadedAt?: string;
}

export type R2PutValue = ReadableStream | ArrayBuffer | ArrayBufferView | string | Blob | null;

export function putObject(
  env: Env,
  key: string,
  body: R2PutValue,
  options: PutOptions = {},
): Promise<R2Object | null> {
  const contentType = options.contentType || getMimeType(nameOf(key));
  // The disposition is decided at serve time, so it is not baked into the
  // object: the same bytes are served as attachment and as inline.
  return env.VAULT_BUCKET.put(key, body, {
    httpMetadata: { contentType },
    customMetadata: { uploadedAt: options.uploadedAt ?? new Date().toISOString() },
  });
}

/** Create the marker that lets an otherwise empty folder exist in a flat store. */
export async function createFolderMarker(env: Env, folder: string): Promise<void> {
  const normalized = normalizeFolder(folder);
  await env.VAULT_BUCKET.put(folderMarkerKey(normalized), null, {
    httpMetadata: { contentType: 'application/x-directory' },
    customMetadata: { uploadedAt: new Date().toISOString() },
  });
}

export async function deleteKeys(env: Env, keys: string[]): Promise<void> {
  // R2 accepts at most 1000 keys per call.
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    if (batch.length) await env.VAULT_BUCKET.delete(batch);
  }
}

/** All keys under a folder prefix, paginated. */
export async function listKeysUnder(env: Env, folder: string): Promise<string[]> {
  const prefix = folderPrefix(normalizeFolder(folder));
  const keys: string[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await list(env, { prefix, cursor, limit: LIST_PAGE });
    for (const object of page.objects) keys.push(object.key);
    if (!page.truncated) return keys;
    cursor = page.cursor;
  }
}

/**
 * Server-side copy: R2 has no copy API, so the bytes go through the Worker -
 * but streamed, never buffered, which keeps memory flat regardless of size.
 */
export async function copyObject(
  env: Env,
  from: string,
  to: string,
  options: { contentType?: string; uploadedAt?: string } = {},
): Promise<boolean> {
  const source = await env.VAULT_BUCKET.get(from);
  if (!source) return false;
  const written = await env.VAULT_BUCKET.put(to, source.body, {
    httpMetadata: {
      contentType: options.contentType || source.httpMetadata?.contentType || getMimeType(nameOf(to)),
    },
    customMetadata: { uploadedAt: options.uploadedAt ?? uploadedAtOf(source) },
  });
  return written !== null;
}

/** `a/b.txt` → `c/b.txt` when the folder part is rewritten. */
export function rebaseKey(key: string, fromFolder: string, toFolder: string): string {
  const tail = key.slice(folderPrefix(fromFolder).length);
  return `${folderPrefix(toFolder)}${tail}`;
}

/**
 * Move a whole subtree: copy first, delete after. Re-running is safe (a copy
 * overwrites, a delete of an absent key is a no-op), which is what makes a
 * partial failure recoverable instead of corrupting half a folder.
 *
 * Shares are not touched here - the caller retargets them in one pass.
 */
export async function copyTree(
  env: Env,
  fromFolder: string,
  toFolder: string,
  options: { deleteSource?: boolean } = {},
): Promise<{ pairs: Array<[string, string]>; failed: string[] }> {
  const keys = await listKeysUnder(env, fromFolder);
  const pairs: Array<[string, string]> = [];
  const failed: string[] = [];

  await mapLimit(keys, 4, async (key) => {
    const target = rebaseKey(key, fromFolder, toFolder);
    if (isMarkerKey(key)) {
      try {
        await createFolderMarker(env, folderOf(target));
        pairs.push([key, target]);
      } catch {
        failed.push(key);
      }
      return;
    }
    const copied = await copyObject(env, key, target);
    if (!copied) {
      failed.push(key);
      return;
    }
    pairs.push([key, target]);
  });

  if (options.deleteSource) await deleteKeys(env, keys);
  return { pairs, failed };
}

export function keyForFolder(folder: string, name: string): string {
  return buildObjectKey(folder, name);
}

/**
 * Run tasks with a fixed concurrency, preserving order. Used for bulk copies
 * and heads: enough parallelism to hide R2 round-trips, few enough to stay
 * clear of subrequest limits.
 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
