import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/utils/types';
import { KV_PREFIX } from '../src/utils/types';
import {
  copyTree,
  deleteKeys,
  listAllInFolder,
  listDir,
  putObject,
  createFolderMarker,
  uploadedAtOf,
} from '../src/lib/objects';
import {
  deleteSharesForKeys,
  findShareForKey,
  isExcluded,
  isFolderShared,
  migrateLegacyIndex,
  listShares,
  putShare,
  retargetSharesBulk,
} from '../src/lib/shares';
import { getSnapshot, invalidateSnapshot, listFolders, buildStats } from '../src/lib/snapshot';
import { FakeKV, FakeR2, makeEnv } from './helpers/fakes';

function envWith(bucket: FakeR2, kv: FakeKV): Env {
  return { VAULT_BUCKET: bucket, VAULT_KV: kv } as unknown as Env;
}

async function seed(bucket: FakeR2, key: string, body = 'x', uploadedAt?: string) {
  await putObject(envWith(bucket, new FakeKV()), key, body, { uploadedAt });
}

describe('listing a folder', () => {
  it('reports sub-folders from the delimiter and hides folder markers', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'papers/report.txt');
    await seed(r2, 'papers/notes/todo.md');
    await createFolderMarker(env, 'papers/empty');

    const page = await listDir(env, 'papers');
    expect(page.objects.map((object) => object.key)).toEqual(['papers/report.txt']);
    expect(page.folders.sort()).toEqual(['papers/empty', 'papers/notes']);
    expect(page.cursor).toBeNull();
  });

  it('pages with a cursor instead of returning the whole directory', async () => {
    const { env, r2 } = makeEnv();
    for (let i = 0; i < 5; i++) await seed(r2, `bulk/f${i}.txt`);

    const first = await listDir(env, 'bulk', { limit: 3 });
    expect(first.objects).toHaveLength(3);
    expect(first.cursor).toBeTypeOf('string');

    const second = await listDir(env, 'bulk', { limit: 3, cursor: first.cursor ?? undefined });
    expect(second.objects.map((object) => object.key)).toEqual(['bulk/f3.txt', 'bulk/f4.txt']);
    expect(second.cursor).toBeNull();
  });

  it('lists only direct children of a folder, all pages', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'a/one.txt');
    await seed(r2, 'a/b/two.txt');
    expect((await listAllInFolder(env, 'a')).map((object) => object.key)).toEqual(['a/one.txt']);
  });
});

describe('moving a folder', () => {
  it('copies first and deletes after, keeping content type and upload time', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'old/a.txt', 'body', '2025-01-01T00:00:00.000Z');
    await seed(r2, 'old/deep/b.txt', 'body2', '2025-02-02T00:00:00.000Z');
    await createFolderMarker(env, 'old/deep/empty');

    const { pairs, failed } = await copyTree(env, 'old', 'new', { deleteSource: true });

    expect(failed).toEqual([]);
    expect([...r2.objects.keys()].sort()).toEqual([
      'new/a.txt',
      'new/deep/b.txt',
      'new/deep/empty/.cv-folder',
    ]);
    expect(uploadedAtOf(r2.objects.get('new/a.txt') as never)).toBe('2025-01-01T00:00:00.000Z');

    const pair = pairs.find(([from]) => from === 'old/a.txt');
    expect(pair?.[1]).toBe('new/a.txt');
  });

  it('leaves the source alone when the caller does not ask for a delete', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'x/a.txt');
    await copyTree(env, 'x', 'y');
    expect([...r2.objects.keys()].sort()).toEqual(['x/a.txt', 'y/a.txt']);
  });
});

describe('share records', () => {
  let env: Env;
  let kv: FakeKV;
  let r2: FakeR2;

  beforeEach(() => {
    ({ env, kv, r2 } = makeEnv());
  });

  it('is the single authority for a share link', async () => {
    await putShare(env, 'tok-1', {
      key: 'papers/report.txt',
      createdAt: '2026-01-01T00:00:00.000Z',
      passwordHash: null,
      expiresAt: null,
      downloads: 3,
    });

    const map = await listShares(env);
    expect(map.get('papers/report.txt')).toMatchObject({ token: 'tok-1', downloads: 3, hasPassword: false });

    expect(await findShareForKey(env, 'papers/report.txt')).toMatchObject({ token: 'tok-1', downloads: 3 });
    expect(await findShareForKey(env, 'other.txt')).toBeNull();
  });

  it('drops links whose file is gone', async () => {
    await putShare(env, 'a', { key: 'x/1.txt', createdAt: '', passwordHash: null, expiresAt: null, downloads: 0 });
    await putShare(env, 'b', { key: 'y/2.txt', createdAt: '', passwordHash: null, expiresAt: null, downloads: 0 });

    await deleteSharesForKeys(env, new Set(['x/1.txt']));
    expect([...kv.store.keys()].filter((key) => key.startsWith(KV_PREFIX.SHARE)).sort()).toEqual(['share:b']);
  });

  it('keeps working links alive across a rename', async () => {
    await putShare(env, 'a', { key: 'x/1.txt', createdAt: '', passwordHash: null, expiresAt: null, downloads: 7 });
    await retargetSharesBulk(env, new Map([['x/1.txt', 'z/1.txt']]));
    expect(await findShareForKey(env, 'z/1.txt')).toMatchObject({ token: 'a', downloads: 7 });
  });

  it('converts legacy KV rows into share records before deleting them', async () => {
    kv.store.set('file:legacy-id', JSON.stringify({
      id: 'legacy-id',
      key: 'papers/old.txt',
      folder: 'papers',
      name: 'old.txt',
      uploadedAt: '2025-05-05T00:00:00.000Z',
      shareToken: 'legacy-token',
      sharePassword: 'deadbeef',
      shareExpiresAt: null,
      downloads: 9,
    }));
    kv.store.set('folder:papers', JSON.stringify({ name: 'papers' }));

    const result = await migrateLegacyIndex(env);
    expect(result).toEqual({ removed: 2, shares: 1 });
    expect(kv.store.size).toBe(1);
    const record = JSON.parse(kv.store.get('share:legacy-token') as string);
    expect(record).toMatchObject({ key: 'papers/old.txt', passwordHash: 'deadbeef', downloads: 9 });
  });
});

describe('guest visibility', () => {
  it('needs an ancestor to be shared and no ancestor to be excluded', () => {
    const shared = new Set(['papers']);
    expect(isFolderShared('papers', shared)).toBe(true);
    expect(isFolderShared('papers/2026', shared)).toBe(true);
    expect(isFolderShared('papersx', shared)).toBe(false);
    expect(isFolderShared('root', shared)).toBe(false);

    const excluded = new Set(['papers/secret']);
    expect(isFolderShared('papers/secret', shared, excluded)).toBe(false);
    expect(isFolderShared('papers/secret/deeper', shared, excluded)).toBe(false);
    expect(isFolderShared('papers/public', shared, excluded)).toBe(true);
    expect(isExcluded('papers/secret/x', excluded)).toBe(true);
    expect(isExcluded('papers', excluded)).toBe(false);
  });
});

describe('snapshot', () => {
  it('counts files and folders, honours markers, and can be invalidated', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'one.txt', '12345');
    await seed(r2, 'docs/two.txt', '1234567890');
    await createFolderMarker(env, 'docs/empty');

    const first = await getSnapshot(env);
    expect(first.folders).toEqual(['docs', 'docs/empty']);
    expect(first.totalFiles).toBe(2);
    expect(first.totalSize).toBe(15);

    await seed(r2, 'docs/three.txt', '123');
    invalidateSnapshot(env);
    const second = await getSnapshot(env);
    expect(second.totalFiles).toBe(3);
    expect(second.totalSize).toBe(18);
  });

  it('marks folders as shared/excluded for the sidebar', async () => {
    const { env, r2, kv } = makeEnv();
    await seed(r2, 'papers/a.txt');
    await seed(r2, 'papers/secret/b.txt');
    kv.store.set('foldershare:papers', '{}');
    kv.store.set('foldershare-exclude:papers/secret', '{}');

    const folders = await listFolders(env);
    expect(folders).toEqual([
      { name: 'papers', shared: true, directlyShared: true, excluded: false },
      { name: 'papers/secret', shared: false, directlyShared: false, excluded: true },
    ]);
  });

  it('sums downloads from share records, not from file rows', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'a.txt', '1');
    await putShare(env, 't1', { key: 'a.txt', createdAt: '', passwordHash: null, expiresAt: null, downloads: 4 });
    await putShare(env, 't2', { key: 'gone.txt', createdAt: '', passwordHash: null, expiresAt: null, downloads: 2 });

    const stats = await buildStats(env);
    expect(stats.totalFiles).toBe(1);
    expect(stats.totalDownloads).toBe(6);
    expect(stats.topDownloaded.map((file) => file.key)).toEqual(['a.txt']);
  });
});

describe('deleting', () => {
  it('removes a whole tree in one batched call', async () => {
    const { env, r2 } = makeEnv();
    await seed(r2, 'del/a.txt');
    await seed(r2, 'del/b/c.txt');
    const keys = [...r2.objects.keys()];
    await deleteKeys(env, keys);
    expect(r2.objects.size).toBe(0);
  });
});
