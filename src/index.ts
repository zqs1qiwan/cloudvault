import type { Account, Env } from './utils/types';
import { error, fetchAssetHtml, html, injectBranding, preflight, redirect } from './lib/http';
import { handleLogin, handleLogout, handleSetup, requireUser } from './auth';
import { bootstrapAccounts } from './lib/accounts';
import { getSettings } from './api/settings';
import * as files from './api/files';
import * as share from './api/share';
import * as settings from './api/settings';
import * as users from './api/users';
import * as download from './handlers/download';
import { handleWebDAV } from './handlers/webdav';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS' && !path.startsWith('/dav')) return preflight();

    try {
      // ── WebDAV ──
      if (path === '/dav' || path.startsWith('/dav/')) {
        return await handleWebDAV(request, env);
      }

      // ── Auth ──
      if (path === '/auth/login') {
        return method === 'POST' ? await handleLogin(request, env) : error('Method not allowed', 405);
      }
      if (path === '/auth/setup') {
        return method === 'POST' ? await handleSetup(request, env) : error('Method not allowed', 405);
      }
      if (path === '/auth/logout') {
        // GET used to log people out; that made `<img src="/auth/logout">` a
        // working sign-out button for any page on the internet.
        return method === 'POST' ? await handleLogout(request, env) : error('Method not allowed', 405);
      }

      // ── Public share links ──
      if (path.startsWith('/s/')) {
        return await handleShareRoutes(request, env, url, path, method, ctx);
      }

      // ── Public API ──
      if (path === '/api/public/shared' && method === 'GET') {
        return cachedPublic(request, ctx, () => download.handleGuestIndex(env));
      }
      if (path === '/api/public/folder' && method === 'GET') {
        return download.handleGuestFolder(url, env);
      }

      // ── Pages ──
      // `bootstrapAccounts` is also the migration hook: an existing deployment
      // with ADMIN_PASSWORD set gets a real `root` account on first page load.
      if (path === '/setup' && method === 'GET') {
        if ((await bootstrapAccounts(env)).ready) return redirect('/login');
        const site = await getSettings(env);
        const body = injectBranding(await fetchAssetHtml(env.ASSETS, request.url, '/setup.html'), site);
        return html(body);
      }

      if (path === '/login' && method === 'GET') {
        if (!(await bootstrapAccounts(env)).ready) return redirect('/setup');
        const site = await getSettings(env);
        const body = injectBranding(await fetchAssetHtml(env.ASSETS, request.url, '/login.html'), site);
        return html(body);
      }

      if (path === '/' && (method === 'GET' || method === 'HEAD')) {
        if (!(await bootstrapAccounts(env)).ready) return redirect('/setup');
        const site = await getSettings(env);
        if (!site.guestPageEnabled) {
          return (await isSignedIn(request, env)) ? redirect('/admin') : redirect('/login');
        }
        const body = injectBranding(await fetchAssetHtml(env.ASSETS, request.url, '/guest.html'), site);
        return html(body);
      }

      if (path === '/admin' && method === 'GET') {
        if (!(await bootstrapAccounts(env)).ready) return redirect('/setup');
        if (!(await isSignedIn(request, env))) return redirect('/login');
        const site = await getSettings(env);
        const body = injectBranding(await fetchAssetHtml(env.ASSETS, request.url, '/dashboard.html'), site);
        return html(body);
      }

      // ── Authenticated API ──
      if (path.startsWith('/api/')) {
        const account = await requireUser(request, env);
        if (!account) return error('Unauthorized', 401);
        return await handleApi(request, env, url, path, method, ctx, account);
      }

      // ── Static assets (needed by every page, including the login form) ──
      if ((method === 'GET' || method === 'HEAD') && isStaticAsset(path)) {
        return env.ASSETS.fetch(request);
      }

      // ── Clean URLs: /<folder>/<file> ──
      if (method === 'GET' || method === 'HEAD') {
        const clean = await download.handleCleanDownload(request, env, path.slice(1));
        if (clean.status !== 404) return clean;
      }

      if ((method === 'GET' || method === 'HEAD') && (await isSignedIn(request, env))) {
        return env.ASSETS.fetch(request);
      }

      return await notFoundPage(request, env);
    } catch (err) {
      console.error('Unhandled error:', err instanceof Error ? err.message : String(err));
      return error('Internal server error', 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function isSignedIn(request: Request, env: Env): Promise<boolean> {
  return (await requireUser(request, env)) !== null;
}

async function cachedPublic(
  request: Request,
  ctx: ExecutionContext,
  load: () => Promise<Response>,
): Promise<Response> {
  const cache = typeof caches !== 'undefined' ? caches.default : null;
  if (cache) {
    try {
      const hit = await cache.match(request);
      if (hit) return hit;
    } catch {
      // Cache API unavailable (local test runtime): fall through.
    }
  }

  const response = await load();
  if (!response.ok || !cache) return response;

  const cacheable = new Response(response.body, response);
  cacheable.headers.set('Cache-Control', 'public, max-age=15, s-maxage=60');
  ctx.waitUntil(cache.put(request, cacheable.clone()).catch(() => {}));
  return cacheable;
}

const STATIC_EXTENSIONS = new Set([
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map', '.txt',
]);

function isStaticAsset(pathname: string): boolean {
  const dot = pathname.lastIndexOf('.');
  return dot >= 0 && STATIC_EXTENSIONS.has(pathname.slice(dot).toLowerCase());
}

async function notFoundPage(request: Request, env: Env): Promise<Response> {
  const site = await getSettings(env);
  const body = injectBranding(await fetchAssetHtml(env.ASSETS, request.url, '/404.html'), site);
  return html(body, 404);
}

async function handleShareRoutes(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  method: string,
  ctx: ExecutionContext,
): Promise<Response> {
  const segments = path.split('/').filter(Boolean);
  const token = segments[1] ?? '';

  if (segments.length === 2 && method === 'GET') return download.handleSharePage(request, env, token, url);

  if (segments.length === 3) {
    const action = segments[2];
    if (action === 'download' && method === 'GET') return download.handleShareDownload(request, env, token, ctx);
    if (action === 'preview' && method === 'GET') return download.handleSharePreview(request, env, token);
    if (action === 'folder-download' && method === 'GET') return download.handleFolderShareDownload(request, env, token, url);
    if (action === 'folder-preview' && method === 'GET') return download.handleFolderSharePreview(request, env, token, url);
    if (action === 'verify' && method === 'POST') return download.handleShareVerify(token, request, env);
  }

  return error('Not found', 404);
}

// ─── API router ───────────────────────────────────────────────────────
//
// One table instead of a ladder of `if (path === ... && method === ...)`.
// Anything taking an identifier matches a trailing regex, so a key that
// happens to contain `/` cannot be mistaken for a different endpoint.

interface ApiContext {
  request: Request;
  env: Env;
  url: URL;
  path: string;
  method: string;
  match: RegExpMatchArray | null;
  account: Account;
}

interface ApiRoute {
  method: string | string[];
  pattern: string | RegExp;
  handle: (ctx: ApiContext) => Response | Promise<Response>;
}

const decodeParam = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const API_ROUTES: ApiRoute[] = [
  // Files
  { method: 'GET', pattern: '/api/files', handle: ({ url, env }) => files.handleListFiles(url, env) },
  { method: 'GET', pattern: '/api/bootstrap', handle: ({ url, env }) => files.handleBootstrap(url, env) },
  { method: 'GET', pattern: '/api/files/meta', handle: ({ url, env }) => files.handleFileMeta(url, env) },
  { method: 'GET', pattern: '/api/files/download', handle: ({ url, request, env }) => files.handleDownload(url, request, env) },
  { method: 'GET', pattern: '/api/files/preview', handle: ({ url, request, env }) => files.handlePreview(url, request, env) },
  { method: 'GET', pattern: '/api/files/thumbnail', handle: ({ url, request, env }) => files.handleThumbnail(url, request, env) },
  { method: 'PUT', pattern: '/api/files/rename', handle: ({ request, env }) => files.handleRename(request, env) },
  { method: 'POST', pattern: '/api/files/delete', handle: ({ request, env }) => files.handleDelete(request, env) },
  { method: 'POST', pattern: '/api/files/move', handle: ({ request, env }) => files.handleMove(request, env) },
  { method: 'POST', pattern: '/api/files/zip', handle: ({ request, env }) => files.handleZip(request, env) },
  { method: ['POST', 'PUT'], pattern: '/api/files/upload', handle: ({ request, url, env }) => files.handleUpload(request, url, env) },
  { method: 'POST', pattern: '/api/files/sync', handle: ({ url, env }) => files.handleSync(url, env) },

  // Folders
  { method: 'GET', pattern: '/api/folders', handle: ({ env }) => files.handleFolders(env) },
  { method: 'POST', pattern: '/api/folders', handle: ({ request, env }) => files.handleCreateFolder(request, env) },
  { method: 'PUT', pattern: '/api/folders', handle: ({ request, env }) => files.handleRenameFolder(request, env) },
  { method: 'DELETE', pattern: '/api/folders', handle: ({ request, env }) => files.handleDeleteFolder(request, env) },
  { method: 'POST', pattern: '/api/folders/share', handle: ({ request, env }) => share.handleFolderShareToggle(request, env) },
  { method: 'POST', pattern: '/api/folders/exclude', handle: ({ request, env }) => share.handleFolderExcludeToggle(request, env) },

  // Shares
  { method: 'POST', pattern: '/api/share', handle: ({ request, env }) => share.handleCreateShare(request, env) },
  {
    method: 'DELETE',
    pattern: /^\/api\/share\/(.+)$/,
    handle: ({ env, match }) => share.handleRevokeShare(decodeParam(match?.[1] ?? ''), env),
  },

  // Folder share links
  { method: 'POST', pattern: '/api/folder-share-link', handle: ({ request, env }) => share.handleCreateFolderLink(request, env) },
  {
    method: 'GET',
    pattern: /^\/api\/folder-share-link\/(.+)$/,
    handle: ({ env, match }) => share.handleGetFolderLink(decodeParam(match?.[1] ?? ''), env),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/folder-share-link\/(.+)$/,
    handle: ({ env, match }) => share.handleRevokeFolderLink(decodeParam(match?.[1] ?? ''), env),
  },

  // Misc
  { method: 'GET', pattern: '/api/stats', handle: ({ env }) => files.handleStats(env) },
  { method: 'GET', pattern: '/api/settings', handle: ({ request, env }) => settings.handleGetSettings(request, env) },
  {
    method: 'PUT',
    pattern: '/api/settings',
    handle: ({ request, env, account }) =>
      account.role === 'admin' ? settings.handlePutSettings(request, env) : error('Administrator role required', 403),
  },

  // Accounts
  { method: 'GET', pattern: '/api/account', handle: ({ account }) => users.handleGetAccount(account) },
  { method: 'PUT', pattern: '/api/account/password', handle: ({ request, env, account }) => users.handleChangePassword(request, env, account) },
  { method: 'GET', pattern: '/api/users', handle: ({ env, account }) => users.handleListUsers(env, account) },
  { method: 'POST', pattern: '/api/users', handle: ({ request, env, account }) => users.handleCreateUser(request, env, account) },
  {
    method: 'PUT',
    pattern: /^\/api\/users\/([0-9a-f-]{36})$/i,
    handle: ({ request, env, account, match }) => users.handleUpdateUser(request, env, account, match?.[1] ?? ''),
  },
  {
    method: 'DELETE',
    pattern: /^\/api\/users\/([0-9a-f-]{36})$/i,
    handle: ({ env, account, match }) => users.handleDeleteUser(env, account, match?.[1] ?? ''),
  },
];

async function handleApi(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  method: string,
  _ctx: ExecutionContext,
  account: Account,
): Promise<Response> {
  for (const route of API_ROUTES) {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    if (!methods.includes(method)) continue;

    if (typeof route.pattern === 'string') {
      if (route.pattern !== path) continue;
      return route.handle({ request, env, url, path, method, match: null, account });
    }
    const match = path.match(route.pattern);
    if (!match) continue;
    return route.handle({ request, env, url, path, method, match, account });
  }
  return error('Not found', 404);
}
