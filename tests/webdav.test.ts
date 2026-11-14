import { describe, expect, it } from 'vitest';
import { handleWebDav } from '../src/handlers/webdav';
import type { Env } from '../src/utils/types';

interface StoredObject {
  bytes: Uint8Array;
  uploaded: Date;
  httpMetadata: Record<string, string>;
  customMetadata: Record<string, string>;
  httpEtag: string;
}

function digest(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(4);
}

class FakeKV {
  private store = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    const prefix = options.prefix ?? '';
    const names = [...this.store.keys()].filter((name) => name.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const page = names.slice(start, start + (options.limit ?? 1000));
    const next = start + page.length;
    return {
      keys: page.map((name) => ({ name })),
      list_complete: next >= names.length,
      cursor: String(next),
    };
  }

  /** Every stored file row (not folders/sessions/stats). */
  fileRows() {
    return [...this.store.entries()]
      .filter(([key]) => key.startsWith('file:'))
      .map(([, value]) => JSON.parse(value) as { id: string; key: string; folder: string; name: string });
  }
}

class FakeR2 {
  readonly objects = new Map<string, StoredObject>();
  private clock = Date.parse('2026-01-01T00:00:00.000Z');

  private tick(): Date {
    this.clock += 1000;
    return new Date(this.clock);
  }

  private describe(key: string, object: StoredObject) {
    const writeHttpMetadata = (headers: Headers) => {
      if (object.httpMetadata.contentType) headers.set('Content-Type', object.httpMetadata.contentType);
      if (object.httpMetadata.contentDisposition) {
        headers.set('Content-Disposition', object.httpMetadata.contentDisposition);
      }
    };
    return {
      key,
      size: object.bytes.byteLength,
      etag: object.httpEtag,
      httpEtag: object.httpEtag,
      uploaded: object.uploaded,
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      writeHttpMetadata,
    };
  }

  async head(key: string) {
    const object = this.objects.get(key);
    return object ? this.describe(key, object) : null;
  }

  async get(key: string, options: { range?: { offset: number; length: number } } = {}) {
    const object = this.objects.get(key);
    if (!object) return null;
    let bytes = object.bytes;
    if (options.range) {
      bytes = bytes.slice(options.range.offset, options.range.offset + options.range.length);
    }
    return {
      ...this.describe(key, object),
      body: new Response(bytes).body,
    };
  }

  async put(key: string, body: BodyInit | null, options: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } = {}) {
    const bytes = new Uint8Array(await new Response(body ?? null).arrayBuffer());
    const stored: StoredObject = {
      bytes,
      uploaded: this.tick(),
      httpMetadata: options.httpMetadata ?? {},
      customMetadata: options.customMetadata ?? {},
      httpEtag: `"${digest(bytes)}"`,
    };
    this.objects.set(key, stored);
    return { ...this.describe(key, stored), httpMetadata: stored.httpMetadata };
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }

  async list() {
    return {
      objects: [...this.objects.entries()].map(([key, object]) => this.describe(key, object)),
      truncated: false,
    };
  }
}

function makeEnv() {
  const kv = new FakeKV();
  const r2 = new FakeR2();
  const env = { VAULT_KV: kv, VAULT_BUCKET: r2 } as unknown as Env;
  return { env, kv, r2 };
}

function dav(path: string, init: RequestInit = {}): Request {
  return new Request('https://example.com/dav/' + path, init);
}

function put(env: Env, path: string, body = 'hello', headers: Record<string, string> = {}) {
  return handleWebDav(dav(path, { method: 'PUT', body, headers }), env);
}

async function getetag(env: Env, path: string): Promise<string> {
  const response = await handleWebDav(dav(path, { method: 'PROPFIND', headers: { Depth: '0' } }), env);
  const xml = await response.text();
  const match = /<D:getetag>(.*?)<\/D:getetag>/.exec(xml);
  if (!match) throw new Error('PROPFIND did not publish a getetag');
  return match[1];
}

describe('WebDAV conditional requests', () => {
  it('publishes one ETag for PROPFIND, GET and HEAD', async () => {
    const { env, r2 } = makeEnv();
    await put(env, 'file-backup/a.txt');

    const propfindTag = await getetag(env, 'file-backup/a.txt');
    const getResponse = await handleWebDav(dav('file-backup/a.txt'), env);
    const headResponse = await handleWebDav(dav('file-backup/a.txt', { method: 'HEAD' }), env);

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('ETag')).toBe(propfindTag);
    expect(headResponse.headers.get('ETag')).toBe(propfindTag);
    // The old code answered with R2's content MD5 here, so the two never matched.
    expect(propfindTag).not.toBe(r2.objects.get('file-backup/a.txt')!.httpEtag);
  });

  it('answers 304 (not 412) when If-None-Match matches on GET and HEAD', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt');
    const tag = await getetag(env, 'file-backup/a.txt');

    const getResponse = await handleWebDav(dav('file-backup/a.txt', { headers: { 'If-None-Match': tag } }), env);
    expect(getResponse.status).toBe(304);
    expect(getResponse.headers.get('ETag')).toBe(tag);
    expect(await getResponse.text()).toBe('');

    const headResponse = await handleWebDav(dav('file-backup/a.txt', { method: 'HEAD', headers: { 'If-None-Match': tag } }), env);
    expect(headResponse.status).toBe(304);
  });

  it('serves the body when If-None-Match does not match', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt');

    const response = await handleWebDav(dav('file-backup/a.txt', { headers: { 'If-None-Match': '"stale"' } }), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello');
  });

  it('accepts If-Match with the published ETag as plain and weak tags', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt');
    const tag = await getetag(env, 'file-backup/a.txt');

    const strong = await handleWebDav(dav('file-backup/a.txt', { headers: { 'If-Match': tag } }), env);
    expect(strong.status).toBe(200);

    const weak = await handleWebDav(dav('file-backup/a.txt', { headers: { 'If-Match': `W/${tag}` } }), env);
    expect(weak.status).toBe(200);
  });

  it('rejects a stale If-Match with 412', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt');

    const response = await handleWebDav(dav('file-backup/a.txt', { headers: { 'If-Match': '"outdated-etag"' } }), env);
    expect(response.status).toBe(412);
  });

  it('changes the ETag after an overwrite and answers 204', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt', 'first');
    const before = await getetag(env, 'file-backup/a.txt');

    const overwrite = await put(env, 'file-backup/a.txt', 'second');
    expect(overwrite.status).toBe(204);

    const after = await getetag(env, 'file-backup/a.txt');
    expect(after).not.toBe(before);

    const stale = await handleWebDav(dav('file-backup/a.txt', { headers: { 'If-Match': before } }), env);
    expect(stale.status).toBe(412);
  });
});

describe('WebDAV uploads keep one row per path', () => {
  it('does not duplicate the listing when the same path is PUT repeatedly', async () => {
    const { env, kv } = makeEnv();
    await put(env, 'file-backup/a.txt', 'v1');
    await put(env, 'file-backup/a.txt', 'v2');
    await put(env, 'file-backup/a.txt', 'v3');

    expect(kv.fileRows().filter((row) => row.key === 'file-backup/a.txt')).toHaveLength(1);

    const response = await handleWebDav(dav('file-backup', { method: 'PROPFIND', headers: { Depth: '1' } }), env);
    const xml = await response.text();
    expect(xml.match(/<D:href>\/dav\/file-backup\/a\.txt<\/D:href>/g)).toHaveLength(1);
  });

  it('moves a file that was just uploaded', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt', 'payload');

    const moved = await handleWebDav(
      dav('file-backup/a.txt', {
        method: 'MOVE',
        headers: { Destination: 'https://example.com/dav/file-backup/b.txt' },
      }),
      env,
    );
    expect(moved.status).toBe(201);

    const source = await handleWebDav(dav('file-backup/a.txt'), env);
    expect(source.status).toBe(404);

    const destination = await handleWebDav(dav('file-backup/b.txt'), env);
    expect(destination.status).toBe(200);
    expect(await destination.text()).toBe('payload');
  });

  it('copies a file into a second path with its own ETag', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt', 'payload');
    const original = await getetag(env, 'file-backup/a.txt');

    const copied = await handleWebDav(
      dav('file-backup/a.txt', {
        method: 'COPY',
        headers: { Destination: 'https://example.com/dav/file-backup/b.txt' },
      }),
      env,
    );
    expect(copied.status).toBe(201);

    const copyTag = await getetag(env, 'file-backup/b.txt');
    expect(copyTag).not.toBe(original);

    const copy = await handleWebDav(dav('file-backup/b.txt'), env);
    expect(await copy.text()).toBe('payload');
  });

  it('agrees on the ETag when only the R2 object exists (index still lagging)', async () => {
    const { env, r2 } = makeEnv();
    await r2.put('file-backup/late.txt', 'payload', { customMetadata: { fileId: 'row-late' } });

    const propfindTag = await getetag(env, 'file-backup/late.txt');
    const getResponse = await handleWebDav(dav('file-backup/late.txt'), env);

    expect(getResponse.status).toBe(200);
    expect(getResponse.headers.get('ETag')).toBe(propfindTag);

    const notModified = await handleWebDav(
      dav('file-backup/late.txt', { headers: { 'If-None-Match': propfindTag } }),
      env,
    );
    expect(notModified.status).toBe(304);
  });

  it('moves a file whose metadata row has not reached KV yet', async () => {
    const { env, r2 } = makeEnv();
    // Simulate a colo that cannot see the row another colo just wrote.
    await r2.put('file-backup/late.txt', 'payload', { customMetadata: { fileId: 'row-late' } });

    const moved = await handleWebDav(
      dav('file-backup/late.txt', {
        method: 'MOVE',
        headers: { Destination: 'https://example.com/dav/file-backup/late2.txt' },
      }),
      env,
    );
    expect(moved.status).toBe(201);

    const destination = await handleWebDav(dav('file-backup/late2.txt'), env);
    expect(destination.status).toBe(200);
    expect(await destination.text()).toBe('payload');
  });

  it('reports 412 for Overwrite: F when the destination exists', async () => {
    const { env } = makeEnv();
    await put(env, 'file-backup/a.txt');
    await put(env, 'file-backup/b.txt', 'existing');

    const response = await handleWebDav(
      dav('file-backup/a.txt', {
        method: 'MOVE',
        headers: { Destination: 'https://example.com/dav/file-backup/b.txt', Overwrite: 'F' },
      }),
      env,
    );
    expect(response.status).toBe(412);
  });
});
