import { beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../src/utils/types';
import { handleWebDAV } from '../src/handlers/webdav';
import { makeEnv } from './helpers/fakes';

const AUTH = 'Basic ' + btoa('root:secret');
const PASSWORD = 'secret';

let env: Env;

function dav(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  if (!headers.has('Authorization')) headers.set('Authorization', AUTH);
  return new Request('https://example.com/dav/' + path, { ...init, headers });
}

function put(path: string, body = 'hello', headers: Record<string, string> = {}) {
  return handleWebDAV(dav(path, { method: 'PUT', body, headers }), env);
}

function propfind(path: string, depth = '0') {
  return handleWebDAV(dav(path, { method: 'PROPFIND', headers: { Depth: depth } }), env);
}

async function etagOf(path: string): Promise<string> {
  const response = await propfind(path);
  const xml = await response.text();
  const match = /<D:getetag>(.*?)<\/D:getetag>/.exec(xml);
  if (!match) throw new Error('PROPFIND did not publish a getetag');
  return match[1];
}

beforeEach(() => {
  const made = makeEnv();
  env = { ...made.env, ADMIN_PASSWORD: PASSWORD } as unknown as Env;
});

describe('WebDAV auth and capabilities', () => {
  it('refuses requests without credentials', async () => {
    const response = await handleWebDAV(
      new Request('https://example.com/dav/', { method: 'PROPFIND' }),
      env,
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('Basic');
  });

  it('advertises class 1 and no LOCK', async () => {
    const response = await handleWebDAV(dav('', { method: 'OPTIONS' }), env);
    expect(response.status).toBe(200);
    expect(response.headers.get('DAV')).toBe('1');
    expect(response.headers.get('Allow')).not.toContain('LOCK');
    expect((await handleWebDAV(dav('x', { method: 'LOCK' }), env)).status).toBe(501);
  });
});

describe('WebDAV reads and conditionals', () => {
  it('publishes the same ETag through PROPFIND, GET and HEAD', async () => {
    const created = await put('file-backup/a.txt');
    expect(created.status).toBe(201);
    const tag = created.headers.get('ETag');

    expect(await etagOf('file-backup/a.txt')).toBe(tag);

    const get = await handleWebDAV(dav('file-backup/a.txt'), env);
    expect(get.status).toBe(200);
    expect(get.headers.get('ETag')).toBe(tag);
    expect(await get.text()).toBe('hello');

    const head = await handleWebDAV(dav('file-backup/a.txt', { method: 'HEAD' }), env);
    expect(head.headers.get('ETag')).toBe(tag);
    expect(await head.text()).toBe('');
  });

  it('answers 304 when If-None-Match matches, 200 when it does not', async () => {
    await put('file-backup/a.txt');
    const tag = await etagOf('file-backup/a.txt');

    const cached = await handleWebDAV(dav('file-backup/a.txt', { headers: { 'If-None-Match': tag } }), env);
    expect(cached.status).toBe(304);
    expect(await cached.text()).toBe('');

    const changed = await handleWebDAV(dav('file-backup/a.txt', { headers: { 'If-None-Match': '"stale"' } }), env);
    expect(changed.status).toBe(200);
  });

  it('honours If-Match and rejects a stale tag with 412', async () => {
    await put('file-backup/a.txt');
    const tag = await etagOf('file-backup/a.txt');

    expect((await handleWebDAV(dav('file-backup/a.txt', { headers: { 'If-Match': tag } }), env)).status).toBe(200);
    expect((await handleWebDAV(dav('file-backup/a.txt', { headers: { 'If-Match': `W/${tag}` } }), env)).status).toBe(200);
    expect((await handleWebDAV(dav('file-backup/a.txt', { headers: { 'If-Match': '"outdated"' } }), env)).status).toBe(412);
  });

  it('serves a byte range with 206 and rejects an impossible one with 416', async () => {
    await put('file-backup/a.txt', '0123456789');

    const ranged = await handleWebDAV(dav('file-backup/a.txt', { headers: { Range: 'bytes=2-5' } }), env);
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(await ranged.text()).toBe('2345');

    const suffix = await handleWebDAV(dav('file-backup/a.txt', { headers: { Range: 'bytes=-3' } }), env);
    expect(await suffix.text()).toBe('789');

    expect((await handleWebDAV(dav('file-backup/a.txt', { headers: { Range: 'bytes=10-' } }), env)).status).toBe(416);
  });

  it('sandboxes inline responses so an uploaded HTML file cannot run', async () => {
    await put('file-backup/evil.html', '<script>alert(1)</script>', { 'Content-Type': 'text/html' });
    const response = await handleWebDAV(dav('file-backup/evil.html'), env);
    expect(response.headers.get('Content-Security-Policy')).toContain('sandbox');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });
});

describe('WebDAV writes', () => {
  it('does not duplicate the listing when the same path is PUT repeatedly', async () => {
    await put('file-backup/a.txt', 'v1');
    await put('file-backup/a.txt', 'v2');
    const overwrite = await put('file-backup/a.txt', 'v3');
    expect(overwrite.status).toBe(204);

    const xml = await (await propfind('file-backup', '1')).text();
    expect(xml.match(/<D:href>\/dav\/file-backup\/a\.txt<\/D:href>/g)).toHaveLength(1);
  });

  it('refuses a conditional write when the precondition fails', async () => {
    expect((await put('cond/a.txt', 'one', { 'If-None-Match': '*' })).status).toBe(201);
    expect((await put('cond/a.txt', 'two', { 'If-None-Match': '*' })).status).toBe(412);
    expect((await put('cond/a.txt', 'three', { 'If-Match': '"nope"' })).status).toBe(412);
  });

  it('creates an empty collection that shows up in the parent listing', async () => {
    expect((await handleWebDAV(dav('empty/', { method: 'MKCOL' }), env)).status).toBe(201);
    expect((await handleWebDAV(dav('empty/', { method: 'MKCOL' }), env)).status).toBe(405);

    const xml = await (await propfind('', '1')).text();
    expect(xml).toContain('/dav/empty/');
  });

  it('creates parent folders implicitly when a file is PUT', async () => {
    expect((await put('missing/a.txt')).status).toBe(201);
    expect((await propfind('missing')).status).toBe(207);
  });

  it('requires the parent collection to exist for MKCOL', async () => {
    expect((await handleWebDAV(dav('missing/sub/', { method: 'MKCOL' }), env)).status).toBe(409);
  });

  it('refuses to write the internal folder marker', async () => {
    await handleWebDAV(dav('folder/', { method: 'MKCOL' }), env);
    expect((await put('folder/.cv-folder')).status).toBe(403);
  });
});

describe('WebDAV move and copy', () => {
  it('moves a file and keeps its content', async () => {
    await put('file-backup/a.txt', 'payload');
    const moved = await handleWebDAV(
      dav('file-backup/a.txt', { method: 'MOVE', headers: { Destination: 'https://example.com/dav/file-backup/b.txt' } }),
      env,
    );
    expect(moved.status).toBe(201);
    expect((await handleWebDAV(dav('file-backup/a.txt'), env)).status).toBe(404);

    const destination = await handleWebDAV(dav('file-backup/b.txt'), env);
    expect(destination.status).toBe(200);
    expect(await destination.text()).toBe('payload');
  });

  it('moves a whole folder, markers included', async () => {
    await put('old/a.txt', 'one');
    await put('old/deep/b.txt', 'two');
    await handleWebDAV(dav('old/empty/', { method: 'MKCOL' }), env);

    const moved = await handleWebDAV(
      dav('old/', { method: 'MOVE', headers: { Destination: 'https://example.com/dav/new/' } }),
      env,
    );
    expect(moved.status).toBe(201);

    expect((await propfind('old')).status).toBe(404);
    expect(await (await handleWebDAV(dav('new/deep/b.txt'), env)).text()).toBe('two');
    const tree = await (await propfind('new', 'infinity')).text();
    expect(tree).toContain('/dav/new/empty/');
  });

  it('copies a file without touching the source', async () => {
    await put('file-backup/a.txt', 'payload');
    const copied = await handleWebDAV(
      dav('file-backup/a.txt', { method: 'COPY', headers: { Destination: 'https://example.com/dav/file-backup/b.txt' } }),
      env,
    );
    expect(copied.status).toBe(201);
    expect(await (await handleWebDAV(dav('file-backup/a.txt'), env)).text()).toBe('payload');
    expect(await (await handleWebDAV(dav('file-backup/b.txt'), env)).text()).toBe('payload');
  });

  it('reports 412 when Overwrite: F finds an existing destination', async () => {
    await put('file-backup/a.txt');
    await put('file-backup/b.txt', 'existing');
    const response = await handleWebDAV(
      dav('file-backup/a.txt', {
        method: 'MOVE',
        headers: { Destination: 'https://example.com/dav/file-backup/b.txt', Overwrite: 'F' },
      }),
      env,
    );
    expect(response.status).toBe(412);
  });

  it('refuses to move a folder into itself', async () => {
    await put('loop/a.txt');
    const response = await handleWebDAV(
      dav('loop/', { method: 'MOVE', headers: { Destination: 'https://example.com/dav/loop/inner/' } }),
      env,
    );
    expect(response.status).toBe(409);
  });
});

describe('WebDAV delete and depth', () => {
  it('deletes a folder with everything under it and drops its share links', async () => {
    await put('doomed/a.txt', 'one');
    await put('doomed/deep/b.txt', 'two');

    const response = await handleWebDAV(dav('doomed/', { method: 'DELETE' }), env);
    expect(response.status).toBe(204);
    expect((await handleWebDAV(dav('doomed/deep/b.txt'), env)).status).toBe(404);
    expect((await handleWebDAV(dav('doomed/', { method: 'DELETE' }), env)).status).toBe(404);
  });

  it('answers Depth: 1 with the folder and its direct children only', async () => {
    await put('tree/a.txt');
    await put('tree/sub/b.txt');

    const xml = await (await propfind('tree', '1')).text();
    expect(xml).toContain('/dav/tree/a.txt');
    expect(xml).toContain('/dav/tree/sub/');
    expect(xml).not.toContain('/dav/tree/sub/b.txt');
  });

  it('answers Depth: infinity recursively', async () => {
    await put('tree/a.txt');
    await put('tree/sub/b.txt');
    await put('tree/sub/deeper/c.txt');

    const xml = await (await propfind('tree', 'infinity')).text();
    expect(xml).toContain('/dav/tree/sub/deeper/c.txt');
  });
});
