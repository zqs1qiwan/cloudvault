import { describe, expect, it } from 'vitest';
import {
  buildFileIndexPlan,
  buildObjectKey,
  getIndexedFiles,
  parseSingleRange,
  stableObjectId,
  type IndexedObject,
} from '../src/utils/files';
import type { Env, FileMeta } from '../src/utils/types';
import { isFolderShared } from '../src/api/share';

function file(overrides: Partial<FileMeta> & Pick<FileMeta, 'id' | 'key'>): FileMeta {
  const name = overrides.key.split('/').pop()!;
  const folder = overrides.key.includes('/')
    ? overrides.key.slice(0, overrides.key.lastIndexOf('/'))
    : 'root';
  return {
    id: overrides.id,
    key: overrides.key,
    name,
    folder,
    size: 1,
    type: 'application/octet-stream',
    uploadedAt: '2026-01-01T00:00:00.000Z',
    shareToken: null,
    sharePassword: null,
    shareExpiresAt: null,
    downloads: 0,
    ...overrides,
  };
}

function object(key: string, overrides: Partial<IndexedObject> = {}): IndexedObject {
  return {
    key,
    size: 10,
    uploaded: new Date('2026-02-01T00:00:00.000Z'),
    httpMetadata: { contentType: 'text/plain' },
    customMetadata: {},
    ...overrides,
  };
}

describe('buildObjectKey', () => {
  it('normalizes root paths without changing valid file names', () => {
    expect(buildObjectKey('root', 'notes..txt')).toBe('notes..txt');
    expect(buildObjectKey('docs/2026', 'report.pdf')).toBe('docs/2026/report.pdf');
  });

  it('rejects ambiguous path segments and separators in file names', () => {
    expect(() => buildObjectKey('../private', 'a.txt')).toThrow('Invalid folder path');
    expect(() => buildObjectKey('docs', '../a.txt')).toThrow('Invalid file name');
    expect(() => buildObjectKey('docs', 'a/b.txt')).toThrow('Invalid file name');
  });
});

describe('buildFileIndexPlan', () => {
  it('imports an R2-only object with a stable deterministic id', () => {
    const first = buildFileIndexPlan([], [object('manual/file.txt')]);
    const second = buildFileIndexPlan([], [object('manual/file.txt')]);

    expect(first.files).toHaveLength(1);
    expect(first.files[0]).toMatchObject({ key: 'manual/file.txt', name: 'file.txt', folder: 'manual' });
    expect(first.files[0].id).toBe(second.files[0].id);
    expect(first.puts).toHaveLength(1);
  });

  it('deduplicates legacy metadata for one R2 key and preserves the original identity and share', () => {
    const original = file({
      id: 'old-id',
      key: 'same.txt',
      uploadedAt: '2025-01-01T00:00:00.000Z',
      shareToken: 'shared-token',
      downloads: 4,
    });
    const duplicate = file({
      id: 'new-id',
      key: 'same.txt',
      uploadedAt: '2026-01-01T00:00:00.000Z',
      size: 999,
    });

    const plan = buildFileIndexPlan([duplicate, original], [object('same.txt', { size: 42 })]);

    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toMatchObject({
      id: 'old-id',
      key: 'same.txt',
      size: 42,
      shareToken: 'shared-token',
      downloads: 4,
    });
    expect(plan.deletes).toEqual(['new-id']);
    expect(plan.shareUpdates).toEqual([{ token: 'shared-token', fileId: 'old-id' }]);
  });

  it('omits metadata whose R2 object no longer exists', () => {
    const plan = buildFileIndexPlan([file({ id: 'gone', key: 'gone.txt' })], []);
    expect(plan.files).toEqual([]);
    expect(plan.deletes).toEqual(['gone']);
  });

  it('treats an object with the same file id at a new key as a relocation', () => {
    const existing = file({ id: 'stable-id', key: 'old/name.txt', downloads: 7, shareToken: 'token' });
    const plan = buildFileIndexPlan(
      [existing],
      [object('new/name.txt', { customMetadata: { fileId: 'stable-id' } })],
    );

    expect(plan.files[0]).toMatchObject({
      id: 'stable-id',
      key: 'new/name.txt',
      downloads: 7,
      shareToken: 'token',
    });
    expect(plan.deletes).not.toContain('stable-id');
    expect(plan.puts).toHaveLength(1);
  });

  it('assigns unique ids when multiple objects claim the same file id', () => {
    const plan = buildFileIndexPlan([], [
      object('first.txt', { customMetadata: { fileId: 'duplicate-id' } }),
      object('second.txt', { customMetadata: { fileId: 'duplicate-id' } }),
    ]);

    expect(new Set(plan.files.map(item => item.id)).size).toBe(2);
    expect(plan.files.every(item => item.id !== 'duplicate-id')).toBe(true);
  });

  it('does not let another object steal the id of an existing object', () => {
    const existing = file({ id: 'owned-id', key: 'owner.txt' });
    const plan = buildFileIndexPlan([existing], [
      object('attacker.txt', { customMetadata: { fileId: 'owned-id' } }),
      object('owner.txt', { customMetadata: { fileId: 'owned-id' } }),
    ]);

    expect(plan.files.find(item => item.key === 'owner.txt')?.id).toBe('owned-id');
    expect(plan.files.find(item => item.key === 'attacker.txt')?.id).not.toBe('owned-id');
  });

  it('does not inherit a relocated share when the file id claim is ambiguous', () => {
    const missing = file({ id: 'old-id', key: 'missing.txt', shareToken: 'private-share' });
    const plan = buildFileIndexPlan([missing], [
      object('first.txt', { customMetadata: { fileId: 'old-id' } }),
      object('second.txt', { customMetadata: { fileId: 'old-id' } }),
    ]);

    expect(plan.files.every(item => item.shareToken === null)).toBe(true);
    expect(plan.shareUpdates).toEqual([]);
  });
});

describe('getIndexedFiles', () => {
  it('reads the persisted index without scanning R2', async () => {
    const stored = file({ id: 'indexed-id', key: 'TVBOX/OK-TV-pro.apk' });
    const env = {
      VAULT_KV: {
        list: async () => ({ keys: [{ name: 'file:indexed-id' }], list_complete: true }),
        get: async () => JSON.stringify(stored),
      },
      VAULT_BUCKET: {
        list: async () => { throw new Error('normal reads must not scan R2'); },
      },
    } as unknown as Env;

    await expect(getIndexedFiles(env)).resolves.toEqual([stored]);
  });
});

describe('stableObjectId', () => {
  it('gives concurrent uploads for the same object key the same identity', () => {
    expect(stableObjectId('TVBOX/OK-TV-pro.apk')).toBe(stableObjectId('TVBOX/OK-TV-pro.apk'));
    expect(stableObjectId('TVBOX/OK-TV-pro.apk')).not.toBe(stableObjectId('TVBOX/other.apk'));
  });
});

describe('parseSingleRange', () => {
  it('supports closed, open-ended, and suffix ranges', () => {
    expect(parseSingleRange('bytes=10-19', 100)).toEqual({ offset: 10, length: 10 });
    expect(parseSingleRange('bytes=90-', 100)).toEqual({ offset: 90, length: 10 });
    expect(parseSingleRange('bytes=-10', 100)).toEqual({ offset: 90, length: 10 });
  });

  it('rejects malformed, multiple, and unsatisfiable ranges', () => {
    expect(parseSingleRange('bytes=100-', 100)).toBeNull();
    expect(parseSingleRange('bytes=20-10', 100)).toBeNull();
    expect(parseSingleRange('bytes=0-1,4-5', 100)).toBeNull();
    expect(parseSingleRange('items=0-1', 100)).toBeNull();
  });
});

describe('isFolderShared', () => {
  it('applies an exclusion to all of its descendants', () => {
    const shared = new Set(['public']);
    const excluded = new Set(['public/private']);
    expect(isFolderShared('public/file', shared, excluded)).toBe(true);
    expect(isFolderShared('public/private', shared, excluded)).toBe(false);
    expect(isFolderShared('public/private/nested', shared, excluded)).toBe(false);
    shared.add('public/private/nested');
    expect(isFolderShared('public/private/nested', shared, excluded)).toBe(false);
  });
});
