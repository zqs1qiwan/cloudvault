import { Env } from './utils/types';
import { error, redirect, corsPreflightResponse, fetchAssetHtml, injectBranding } from './utils/response';
import { handleLogin, handleLogout, authMiddleware, validateSession } from './auth';
import { getSettings } from './api/settings';
import * as files from './api/files';
import * as share from './api/share';
import * as stats from './api/stats';
import * as settings from './api/settings';
import * as download from './handlers/download';

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') {
      return corsPreflightResponse();
    }

    try {
      if (path === '/auth/login' && method === 'POST') {
        return await handleLogin(request, env);
      }
      if (path === '/auth/logout') {
        return await handleLogout(request, env);
      }

      if (path.startsWith('/s/')) {
        return await handleShareRoutes(request, env, url, path, method);
      }

      if (path === '/login') {
        const loginSettings = await getSettings(env);
        let loginHtml = await fetchAssetHtml(env.ASSETS, request.url, '/login.html');
        loginHtml = injectBranding(loginHtml, { siteName: loginSettings.siteName, siteIconUrl: loginSettings.siteIconUrl });
        return new Response(loginHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      if (path === '/api/public/shared' && method === 'GET') {
        return await share.listPublicShared(request, env);
      }
      if (path === '/api/public/folder' && method === 'GET') {
        return await share.browsePublicFolder(request, env);
      }
      if (path.startsWith('/api/public/download/') && method === 'GET') {
        return (await serveWithEdgeCache(request, ctx, () => share.publicDownload(request, env)))!;
      }

      if (path === '/' && method === 'GET') {
        return await handleRootPage(request, env);
      }

      if (path === '/admin' && method === 'GET') {
        const authResponse = await authMiddleware(request, env);
        if (authResponse) return authResponse;
        const adminSettings = await getSettings(env);
        let dashHtml = await fetchAssetHtml(env.ASSETS, request.url, '/dashboard.html');
        dashHtml = injectBranding(dashHtml, { siteName: adminSettings.siteName, siteIconUrl: adminSettings.siteIconUrl });
        return new Response(dashHtml, {
          headers: { 'Content-Type': 'text/html; charset=utf-8' },
        });
      }

      if (path.startsWith('/api/')) {
        const authResponse = await authMiddleware(request, env);
        if (authResponse) return authResponse;
        return await handleApiRoutes(request, env, url, path, method);
      }

      // Serve static assets (css, js, images, fonts) without auth — needed by all pages
      if (method === 'GET' && isStaticAsset(path)) {
        return env.ASSETS.fetch(request);
      }

      if (method === 'GET') {
        const cleanResponse = await serveWithEdgeCache(request, ctx, () => download.handleCleanDownload(request, env));
        if (cleanResponse) return cleanResponse;
      }

      const isAuth = await validateSession(request, env);
      if (isAuth) return env.ASSETS.fetch(request);

      return await serve404Page(request, env);

    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      console.error('Unhandled error:', message);
      return error(message, 500);
    }
  },
} satisfies ExportedHandler<Env>;

async function handleRootPage(request: Request, env: Env): Promise<Response> {
  const siteSettings = await getSettings(env);

  if (!siteSettings.guestPageEnabled) {
    const isAuth = await validateSession(request, env);
    if (isAuth) return redirect('/admin');
    return redirect('/login');
  }

  let guestHtml = await fetchAssetHtml(env.ASSETS, request.url, '/guest.html');
  guestHtml = injectBranding(guestHtml, { siteName: siteSettings.siteName, siteIconUrl: siteSettings.siteIconUrl });
  return new Response(guestHtml, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function serveWithEdgeCache(
  request: Request,
  ctx: ExecutionContext,
  handler: () => Promise<Response | null>,
): Promise<Response | null> {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) {
    const headers = new Headers(cached.headers);
    headers.set('X-Cache', 'HIT');
    return new Response(cached.body, { status: cached.status, headers });
  }

  const response = await handler();
  if (!response || !response.ok) return response;

  ctx.waitUntil(cache.put(request, response.clone()));
  response.headers.set('X-Cache', 'MISS');
  return response;
}

const STATIC_EXTENSIONS = new Set([
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map',
]);

function isStaticAsset(pathname: string): boolean {
  const dot = pathname.lastIndexOf('.');
  if (dot < 0) return false;
  return STATIC_EXTENSIONS.has(pathname.slice(dot).toLowerCase());
}

async function serve404Page(request: Request, env: Env): Promise<Response> {
  const siteSettings = await getSettings(env);
  let notFoundHtml = await fetchAssetHtml(env.ASSETS, request.url, '/404.html');
  notFoundHtml = injectBranding(notFoundHtml, { siteName: siteSettings.siteName, siteIconUrl: siteSettings.siteIconUrl });
  return new Response(notFoundHtml, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

async function handleShareRoutes(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  method: string,
): Promise<Response> {
  const segments = path.split('/').filter(Boolean);

  if (segments.length === 2 && method === 'GET') {
    return download.handleSharePage(request, env);
  }
  if (segments.length === 3 && segments[2] === 'download' && method === 'GET') {
    return download.handleShareDownload(request, env);
  }
  if (segments.length === 3 && segments[2] === 'preview' && method === 'GET') {
    return download.handlePreview(request, env);
  }
  if (segments.length === 3 && segments[2] === 'folder-download' && method === 'GET') {
    return download.handleFolderShareDownload(request, env);
  }
  if (segments.length === 3 && segments[2] === 'folder-preview' && method === 'GET') {
    return download.handleFolderSharePreview(request, env);
  }
  if (segments.length === 3 && segments[2] === 'verify' && method === 'POST') {
    return download.handleSharePassword(request, env);
  }

  return error('Not found', 404);
}

async function handleApiRoutes(
  request: Request,
  env: Env,
  url: URL,
  path: string,
  method: string,
): Promise<Response> {
  if (path === '/api/files' && method === 'GET') {
    return files.list(request, env);
  }
  if (path === '/api/files/upload' && method === 'POST') {
    return files.upload(request, env);
  }
  if (path === '/api/files/upload' && method === 'PUT') {
    return files.upload(request, env);
  }
  if (path === '/api/files/delete' && method === 'POST') {
    return files.deleteFiles(request, env);
  }

  const filesMatch = path.match(/^\/api\/files\/([^/]+)$/);
  if (filesMatch) {
    if (method === 'GET') return files.get(request, env);
    if (method === 'PUT') return files.rename(request, env);
    if (method === 'DELETE') return files.deleteFiles(request, env);
  }

  const thumbnailMatch = path.match(/^\/api\/files\/([^/]+)\/thumbnail$/);
  if (thumbnailMatch && method === 'GET') {
    return files.thumbnail(request, env);
  }

  const previewMatch = path.match(/^\/api\/files\/([^/]+)\/preview$/);
  if (previewMatch && method === 'GET') {
    return files.preview(request, env);
  }

  const fileDownloadMatch = path.match(/^\/api\/files\/([^/]+)\/download$/);
  if (fileDownloadMatch && method === 'GET') {
    return files.download(request, env);
  }

  if (path === '/api/files/zip' && method === 'POST') {
    return files.zipDownload(request, env);
  }

  if (path === '/api/folders' && method === 'GET') {
    return files.listFolders(request, env);
  }
  if (path === '/api/folders' && method === 'POST') {
    return files.createFolder(request, env);
  }
  if (path === '/api/folders' && method === 'DELETE') {
    return files.deleteFolder(request, env);
  }
  if (path === '/api/folders' && method === 'PUT') {
    return files.renameFolder(request, env);
  }
  if (path === '/api/folders/exclude' && method === 'POST') {
    return share.toggleFolderExclude(request, env);
  }
  if (path === '/api/folders/share' && method === 'POST') {
    return share.shareFolderToggle(request, env);
  }
  if (path === '/api/folders/shared' && method === 'GET') {
    return share.listSharedFolders(request, env);
  }
  if (path === '/api/files/move' && method === 'POST') {
    return files.moveFiles(request, env);
  }

  if (path === '/api/share' && method === 'POST') {
    return share.createShare(request, env);
  }

  const shareMatch = path.match(/^\/api\/share\/([^/]+)$/);
  if (shareMatch) {
    if (method === 'DELETE') return share.revokeShare(request, env);
    if (method === 'GET') return share.getShareInfo(request, env);
  }

  if (path === '/api/folder-share-link' && method === 'POST') {
    return share.createFolderShareLink(request, env);
  }
  if (path.startsWith('/api/folder-share-link/') && method === 'DELETE') {
    return share.revokeFolderShareLink(request, env);
  }
  if (path.startsWith('/api/folder-share-link/') && method === 'GET') {
    return share.getFolderShareLinkInfo(request, env);
  }

  if (path === '/api/stats' && method === 'GET') {
    return stats.getStats(request, env);
  }

  if (path === '/api/settings' && method === 'GET') {
    return settings.handleGetSettings(request, env);
  }
  if (path === '/api/settings' && method === 'PUT') {
    return settings.handlePutSettings(request, env);
  }

  return error('Not found', 404);
}
