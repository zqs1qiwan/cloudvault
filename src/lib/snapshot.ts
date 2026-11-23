// ─── Snapshot: folders + totals ───────────────────────────────────────
//
// Nothing lists the whole bucket any more except this: one metadata-only scan
// that answers "which folders exist" and "how much is stored". It is cached per
// isolate for a few seconds, and it never feeds a write path - so a stale value
// can only mislabel a counter, never lose or hide a file.
//
// Everything else (a folder's contents, one file) reads the bucket directly.

import type { Env, FileMeta, StatsResponse } from '../utils/types';
import { ancestorFolders, folderOf, folderOfMarkerKey, isMarkerKey } from './paths';
import { metaFromObject, scanObjects } from './objects';
import { getExcludedFolders, getSharedFolders, isFolderShared, listShares } from './shares';

const TTL_MS = 30_000;

export interface Snapshot {
  folders: string[];
  totalFiles: number;
  totalSize: number;
  recent: FileMeta[];
}

interface CacheEntry {
  at: number;
  value: Snapshot;
}

const cache = new WeakMap<object, CacheEntry>();

export function invalidateSnapshot(env: Env): void {
  cache.delete(env);
}

async function computeSnapshot(env: Env): Promise<Snapshot> {
  const folders = new Set<string>();
  let totalFiles = 0;
  let totalSize = 0;
  const recent: Array<{ meta: FileMeta; at: number }> = [];

  await scanObjects(env, (page) => {
    for (const object of page) {
      const marker = folderOfMarkerKey(object.key);
      if (marker) {
        for (const ancestor of ancestorFolders(marker)) folders.add(ancestor);
        continue;
      }
      if (isMarkerKey(object.key)) continue;

      const folder = folderOf(object.key);
      for (const ancestor of ancestorFolders(folder)) folders.add(ancestor);
      totalFiles++;
      totalSize += object.size;
      if (recent.length < 8) {
        recent.push({ meta: metaFromObject(object), at: object.uploaded.getTime() });
        recent.sort((a, b) => b.at - a.at);
      } else if (object.uploaded.getTime() > recent[recent.length - 1].at) {
        recent.push({ meta: metaFromObject(object), at: object.uploaded.getTime() });
        recent.sort((a, b) => b.at - a.at);
        recent.length = 8;
      }
    }
  });

  return {
    folders: [...folders].sort(),
    totalFiles,
    totalSize,
    recent: recent.slice(0, 5).map((entry) => entry.meta),
  };
}

export async function getSnapshot(env: Env): Promise<Snapshot> {
  const cached = cache.get(env);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  const value = await computeSnapshot(env);
  cache.set(env, { at: Date.now(), value });
  return value;
}

export interface FolderEntry {
  name: string;
  shared: boolean;
  directlyShared: boolean;
  excluded: boolean;
}

export async function listFolders(env: Env): Promise<FolderEntry[]> {
  const [snapshot, shared, excluded] = await Promise.all([
    getSnapshot(env),
    getSharedFolders(env),
    getExcludedFolders(env),
  ]);

  return snapshot.folders.map((name) => ({
    name,
    shared: isFolderShared(name, shared, excluded),
    directlyShared: shared.has(name),
    excluded: excluded.has(name),
  }));
}

export async function buildStats(env: Env): Promise<StatsResponse> {
  const [snapshot, shares] = await Promise.all([getSnapshot(env), listShares(env)]);

  let totalDownloads = 0;
  const ranked: Array<{ key: string; downloads: number }> = [];
  for (const [key, share] of shares) {
    totalDownloads += share.downloads;
    if (share.downloads > 0) ranked.push({ key, downloads: share.downloads });
  }
  ranked.sort((a, b) => b.downloads - a.downloads);

  // Only the leaders are resolved to real metadata - five heads, not a scan.
  const leaders = await Promise.all(
    ranked.slice(0, 5).map(async (entry) => {
      const head = await env.VAULT_BUCKET.head(entry.key);
      return head ? metaFromObject(head, shares) : null;
    }),
  );

  return {
    totalFiles: snapshot.totalFiles,
    totalSize: snapshot.totalSize,
    totalDownloads,
    recentUploads: snapshot.recent,
    topDownloaded: leaders.filter((meta): meta is FileMeta => meta !== null),
  };
}
