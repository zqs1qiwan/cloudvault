// Test doubles for the two bindings the backend talks to.
//
// They deliberately implement the same shapes the real bindings do, including
// `delimiter` grouping and cursors, because half the point of these tests is
// that the production code no longer maintains its own index: if the fake is
// laxer than R2, the tests would pass while the deployed app breaks.

import type { Env } from '../../src/utils/types';

export interface StoredObject {
  bytes: Uint8Array;
  uploaded: Date;
  httpMetadata: Record<string, string>;
  customMetadata: Record<string, string>;
  httpEtag: string;
}

export class FakeKV {
  readonly store = new Map<string, string>();
  /** Every list() call made, so a test can assert there is no N+1 scan. */
  listCalls = 0;

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async put(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string | string[]): Promise<void> {
    for (const name of Array.isArray(key) ? key : [key]) this.store.delete(name);
  }

  async list(options: { prefix?: string; limit?: number; cursor?: string } = {}) {
    this.listCalls++;
    const prefix = options.prefix ?? '';
    const names = [...this.store.keys()].filter((name) => name.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = names.slice(start, start + limit);
    const next = start + page.length;
    return {
      keys: page.map((name) => ({ name, expiration: undefined, metadata: undefined })),
      list_complete: next >= names.length,
      cursor: String(next),
    };
  }
}

function digest(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0').repeat(4);
}

export class FakeR2 {
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
      version: 'v',
      size: object.bytes.byteLength,
      etag: object.httpEtag,
      httpEtag: object.httpEtag,
      uploaded: object.uploaded,
      storageClass: 'Standard',
      httpMetadata: object.httpMetadata,
      customMetadata: object.customMetadata,
      checksums: {},
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
    return { ...this.describe(key, object), body: new Response(bytes).body };
  }

  async put(
    key: string,
    body: BodyInit | null,
    options: { httpMetadata?: Record<string, string>; customMetadata?: Record<string, string> } = {},
  ) {
    const bytes = new Uint8Array(await new Response(body ?? null).arrayBuffer());
    const stored: StoredObject = {
      bytes,
      uploaded: this.tick(),
      httpMetadata: options.httpMetadata ?? {},
      customMetadata: options.customMetadata ?? {},
      httpEtag: `"${digest(bytes)}"`,
    };
    this.objects.set(key, stored);
    return this.describe(key, stored);
  }

  async delete(key: string | string[]): Promise<void> {
    for (const name of Array.isArray(key) ? key : [key]) this.objects.delete(name);
  }

  /**
   * Mirrors R2's list semantics for the fields used in this project: prefix
   * filtering, `delimiter` grouping and a resumable cursor.
   */
  async list(options: {
    prefix?: string;
    delimiter?: string;
    cursor?: string;
    limit?: number;
    include?: string[];
  } = {}) {
    const prefix = options.prefix ?? '';
    const delimiter = options.delimiter;
    const names = [...this.objects.keys()].filter((name) => name.startsWith(prefix)).sort();
    const start = options.cursor ? Number(options.cursor) : 0;
    const limit = options.limit ?? 1000;
    const page = names.slice(start, start + limit);

    const seenPrefix = new Set<string>();
    const returned: string[] = [];
    for (const name of page) {
      const rest = name.slice(prefix.length);
      if (delimiter) {
        const index = rest.indexOf(delimiter);
        if (index >= 0) {
          seenPrefix.add(prefix + rest.slice(0, index + 1));
          continue;
        }
      }
      returned.push(name);
    }

    const next = start + page.length;
    return {
      objects: returned.map((name) => this.describe(name, this.objects.get(name)!)),
      delimitedPrefixes: [...seenPrefix].sort(),
      truncated: next < names.length,
      cursor: String(next),
    };
  }
}

export function makeEnv() {
  const kv = new FakeKV();
  const r2 = new FakeR2();
  const env = { VAULT_KV: kv, VAULT_BUCKET: r2 } as unknown as Env;
  return { env, kv, r2 };
}

export function makeRequest(path: string, init: RequestInit = {}): Request {
  return new Request('https://example.com' + path, init);
}
