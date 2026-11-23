// ─── WebDAV ───────────────────────────────────────────────────────────
//
// WebDAV is a view over the bucket, not a second data model. A PROPFIND on a
// folder is one `list()` with a delimiter, a GET is one `head()` plus one
// ranged read, and MKCOL is one marker object - the class of bug where the
// DAV tree and the file index disagreed cannot occur, because there is no
// index.
//
// Class 1 only: MOVE/COPY work for files *and* folders, but LOCK is not
// advertised because it is not implemented.

import type { Env, FileMeta } from '../utils/types';
import {
  ROOT,
  davPathToKey,
  folderOf,
  isMarkerKey,
  nameOf,
} from '../lib/paths';
import {
  copyObject,
  copyTree,
  createFolderMarker,
  deleteKeys,
  folderExists,
  headObject,
  listDir,
  listKeysUnder,
  metaFromObject,
  objectExists,
  putObject,
} from '../lib/objects';
import { error, html, serveObject } from '../lib/http';
import { bootstrapAccounts, verifyBasicAuth } from '../lib/accounts';
import { checkLimit, clearFailures, clientId, recordFailure } from '../lib/ratelimit';
import { invalidateSnapshot } from '../lib/snapshot';
import { deleteSharesForKeys, purgeFolderFlags, purgeFolderLinks, renameFolderFlags, retargetFolderLinks, retargetSharesBulk } from '../lib/shares';
import {
  escapeXml,
  fileToProps,
  fileToHref,
  folderToProps,
  folderToHref,
  multistatusResponse,
  propstatEntry,
} from '../utils/webdav-xml';

const MAX_INFINITY_ENTRIES = 5000;

/**
 * Basic auth against the account store, not a shared deploy secret. That is
 * what makes "change my password" take effect for the sync client too, and
 * what lets a second person get their own DAV credentials.
 */
async function authorized(request: Request, env: Env): Promise<boolean> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Basic ')) return false;

  let decoded: string;
  try {
    decoded = atob(header.slice(6).trim());
  } catch {
    return false;
  }

  const colon = decoded.indexOf(':');
  if (colon < 0) return false;
  const username = decoded.slice(0, colon);
  const password = decoded.slice(colon + 1);
  if (!username || !password) return false;

  // An existing deployment may still be carrying ADMIN_PASSWORD only; seed the
  // first account so its sync client keeps working across the upgrade.
  if (!(await bootstrapAccounts(env)).ready) return false;

  const guard = await checkLimit(env, 'dav', clientId(request));
  if (guard.blocked) return false;

  if (await verifyBasicAuth(env, username, password)) {
    await clearFailures(env, 'dav', clientId(request));
    return true;
  }
  await recordFailure(env, 'dav', clientId(request));
  return false;
}

function unauthorized(): Response {
  return new Response('Authentication required', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="CloudVault", charset="UTF-8"',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}

function davKeyOf(pathname: string): string {
  const raw = pathname.replace(/^\/dav(\/|$)/, '');
  if (!raw) return '';
  const decoded = raw.split('/').map((segment) => decodeURIComponent(segment)).join('/');
  return davPathToKey(decoded);
}

type Resource =
  | { kind: 'file'; meta: FileMeta }
  | { kind: 'folder' };

async function resolve(env: Env, key: string): Promise<Resource | null> {
  if (key === '') return { kind: 'folder' };
  if (isMarkerKey(key)) return null;
  const head = await headObject(env, key);
  if (head) return { kind: 'file', meta: metaFromObject(head) };
  return (await folderExists(env, key)) ? { kind: 'folder' } : null;
}

async function handlePropfind(request: Request, env: Env, key: string): Promise<Response> {
  const target = await resolve(env, key);
  if (!target) return error('Not found', 404);

  const depth = (request.headers.get('Depth') ?? '1').toLowerCase();
  const items: string[] = [
    target.kind === 'file'
      ? propstatEntry(fileToHref(target.meta), fileToProps(target.meta), false)
      : propstatEntry(folderToHref(key || ROOT), folderToProps(key || ROOT), true),
  ];

  if (target.kind === 'file' || depth === '0') return multistatusResponse(items);

  const folderPath = key || ROOT;

  if (depth === '1') {
    const page = await listDir(env, folderPath, { limit: 1000 });
    for (const object of page.objects) {
      const meta = metaFromObject(object);
      items.push(propstatEntry(fileToHref(meta), fileToProps(meta), false));
    }
    for (const sub of page.folders) {
      items.push(propstatEntry(folderToHref(sub), folderToProps(sub), true));
    }
    return multistatusResponse(items);
  }

  // Depth: infinity - a real recursive walk. Clients that ask for it (rclone,
  // Finder on first mount) used to get one level and a silently incomplete
  // tree; the walk is bounded so a huge vault degrades loudly instead.
  const queue: string[] = [folderPath];
  let count = items.length;
  while (queue.length) {
    const folder = queue.shift() as string;
    const page = await listDir(env, folder, { limit: 1000 });
    for (const object of page.objects) {
      const meta = metaFromObject(object);
      items.push(propstatEntry(fileToHref(meta), fileToProps(meta), false));
      count++;
    }
    for (const sub of page.folders) {
      items.push(propstatEntry(folderToHref(sub), folderToProps(sub), true));
      count++;
      queue.push(sub);
    }
    if (count > MAX_INFINITY_ENTRIES) {
      return new Response(
        '<?xml version="1.0" encoding="utf-8" ?><D:error xmlns:D="DAV:"><D:propfind-finite-depth/></D:error>',
        { status: 403, headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
      );
    }
  }

  return multistatusResponse(items);
}

async function handleGet(request: Request, env: Env, key: string, method: string): Promise<Response> {
  const target = await resolve(env, key);
  if (!target) return error('Not found', 404);

  if (target.kind === 'file') {
    const response = await serveObject(request, env.VAULT_BUCKET, key, {
      name: nameOf(key),
      disposition: 'inline',
      cacheControl: 'private, max-age=0',
    });
    if (!response) return error('Not found', 404);
    if (method !== 'HEAD') return response;
    await response.body?.cancel().catch(() => {});
    return new Response(null, { status: response.status, headers: response.headers });
  }

  const page = await listDir(env, key || ROOT, { limit: 1000 });
  const rows = [
    ...page.folders.map((folder) => `<li><a href="${folderToHref(folder)}">${escapeXml(folder.split('/').pop() ?? folder)}/</a></li>`),
    ...page.objects.map((object) => {
      const meta = metaFromObject(object);
      return `<li><a href="${fileToHref(meta)}">${escapeXml(meta.name)}</a> <small>${meta.size} B</small></li>`;
    }),
  ];
  const body = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeXml(key || '/dav')}</title></head>
<body><h1>${escapeXml(key || '/dav')}</h1><ul>${rows.join('')}</ul></body></html>`;
  return html(body);
}

async function handlePut(request: Request, env: Env, key: string): Promise<Response> {
  if (!key) return error('Cannot PUT a collection', 405);
  if (isMarkerKey(key)) return error('Reserved name', 403);

  // No parent check: a folder is a key prefix, so writing `a/b/c.txt` brings
  // `a` and `a/b` into existence by itself. Asking R2 "does the parent exist"
  // first would add a round-trip to every file in a sync without changing what
  // the user sees.

  // Conditional write: If-Match / If-None-Match are how clients (and rclone's
  // --immutable-style runs) express "only if unchanged" / "only if new".
  const current = await headObject(env, key);
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch) {
    const tags = ifMatch.split(',').map((value) => value.trim().replace(/^W\//, ''));
    if (!current || (!tags.includes('*') && !tags.includes(current.httpEtag))) {
      return error('Precondition Failed', 412);
    }
  }
  if ((request.headers.get('If-None-Match') ?? '').trim() === '*' && current) {
    return error('Already exists', 412);
  }

  const existed = current !== null;
  const contentType = request.headers.get('Content-Type') || undefined;
  const object = await putObject(env, key, request.body, { contentType });
  if (!object) return error('Write failed', 500);

  invalidateSnapshot(env);
  return new Response(null, {
    status: existed ? 204 : 201,
    headers: { ETag: object.httpEtag },
  });
}

async function handleDelete(env: Env, key: string): Promise<Response> {
  if (key === '') return error('Cannot delete the root collection', 403);
  const target = await resolve(env, key);
  if (!target) return error('Not found', 404);

  if (target.kind === 'file') {
    await env.VAULT_BUCKET.delete(key);
    await deleteSharesForKeys(env, new Set([key]));
  } else {
    const keys = await listKeysUnderSafe(env, key);
    await deleteKeys(env, keys);
    await deleteSharesForKeys(env, new Set(keys));
    await purgeFolderFlags(env, key);
    await purgeFolderLinks(env, key);
  }
  invalidateSnapshot(env);
  return new Response(null, { status: 204 });
}

async function listKeysUnderSafe(env: Env, folder: string): Promise<string[]> {
  return listKeysUnder(env, folder);
}

async function handleMkcol(env: Env, key: string): Promise<Response> {
  if (!key) return error('Root already exists', 405);
  if (isMarkerKey(key)) return error('Reserved name', 403);
  if (await resolve(env, key)) return error('Already exists', 405);

  const parent = folderOf(key);
  if (parent !== ROOT && !(await folderExists(env, parent))) return error('Parent collection does not exist', 409);

  await createFolderMarker(env, key);
  invalidateSnapshot(env);
  return new Response(null, { status: 201 });
}

function destinationKey(request: Request): string | null {
  const header = request.headers.get('Destination');
  if (!header) return null;
  try {
    const url = new URL(header, request.url);
    if (!url.pathname.startsWith('/dav')) return null;
    return davKeyOf(url.pathname);
  } catch {
    return null;
  }
}

async function handleCopyOrMove(request: Request, env: Env, key: string, move: boolean): Promise<Response> {
  const target = await resolve(env, key);
  if (!target) return error('Not found', 404);

  const destination = destinationKey(request);
  if (!destination) return error('Missing or invalid Destination header', 502);
  if (destination === key) return new Response(null, { status: 204 });
  if (isMarkerKey(destination)) return error('Reserved name', 403);

  if (key === '' || destination.startsWith(`${key}/`)) return error('Cannot copy a collection into itself', 409);

  const parent = folderOf(destination);
  if (parent !== ROOT && !(await folderExists(env, parent))) return error('Destination parent does not exist', 409);

  const exists = await resolve(env, destination);
  const overwrite = (request.headers.get('Overwrite') ?? 'T').toUpperCase() !== 'F';
  if (exists && !overwrite) return error('Destination exists', 412);

  if (exists) {
    if (exists.kind === 'file') {
      await env.VAULT_BUCKET.delete(destination);
      await deleteSharesForKeys(env, new Set([destination]));
    } else {
      const keys = await listKeysUnderSafe(env, destination);
      await deleteKeys(env, keys);
      await deleteSharesForKeys(env, new Set(keys));
      await purgeFolderFlags(env, destination);
      await purgeFolderLinks(env, destination);
    }
  }

  if (target.kind === 'file') {
    if (!(await copyObject(env, key, destination))) return error('Copy failed', 502);
    if (move) {
      await env.VAULT_BUCKET.delete(key);
      await retargetSharesBulk(env, new Map([[key, destination]]));
    }
  } else {
    const result = await copyTree(env, key, destination, { deleteSource: move });
    if (result.failed.length) return error(`Copy failed for ${result.failed.length} item(s)`, 502);
    if (move) {
      await retargetSharesBulk(env, new Map(result.pairs.filter(([from]) => !isMarkerKey(from))));
      await renameFolderFlags(env, key, destination);
      await retargetFolderLinks(env, key, destination);
    }
  }

  invalidateSnapshot(env);
  return new Response(null, { status: exists ? 204 : 201 });
}

export async function handleWebDAV(request: Request, env: Env): Promise<Response> {
  if (!(await authorized(request, env))) return unauthorized();

  const url = new URL(request.url);
  let key: string;
  try {
    key = davKeyOf(url.pathname);
  } catch {
    return error('Invalid path', 400);
  }

  switch (request.method) {
    case 'OPTIONS': {
      return new Response(null, {
        status: 200,
        headers: {
          DAV: '1',
          Allow: 'OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, MKCOL, MOVE, COPY',
          'MS-Author-Via': 'DAV',
        },
      });
    }
    case 'PROPFIND':
      return handlePropfind(request, env, key);
    case 'GET':
    case 'HEAD':
      return handleGet(request, env, key, request.method);
    case 'PUT':
      return handlePut(request, env, key);
    case 'DELETE':
      return handleDelete(env, key);
    case 'MKCOL':
      return handleMkcol(env, key);
    case 'MOVE':
      return handleCopyOrMove(request, env, key, true);
    case 'COPY':
      return handleCopyOrMove(request, env, key, false);
    case 'PROPPATCH':
    case 'LOCK':
    case 'UNLOCK':
      return error('Not implemented', 501);
    default:
      return error('Method not allowed', 405);
  }
}
