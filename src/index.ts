import { Env } from './utils/types';
import { json, error, corsPreflightResponse } from './utils/response';
import { handleLogin, handleLogout, authMiddleware } from './auth';
import * as files from './api/files';
import * as share from './api/share';
import * as stats from './api/stats';
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
        return env.ASSETS.fetch(new Request(url.toString(), request));
      }

      if (path.startsWith('/api/')) {
        const authResponse = await authMiddleware(request, env);
        if (authResponse) return authResponse;
        return await handleApiRoutes(request, env, url, path, method);
      }

      const authResponse = await authMiddleware(request, env);
      if (authResponse) return authResponse;
      return env.ASSETS.fetch(request);

    } catch (e) {
      const message = e instanceof Error ? e.message : 'Internal server error';
      console.error('Unhandled error:', message);
      return error(message, 500);
    }
  },
} satisfies ExportedHandler<Env>;

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

  const fileDownloadMatch = path.match(/^\/api\/files\/([^/]+)\/download$/);
  if (fileDownloadMatch && method === 'GET') {
    return files.download(request, env);
  }

  if (path === '/api/folders' && method === 'GET') {
    return files.listFolders(request, env);
  }
  if (path === '/api/folders' && method === 'POST') {
    return files.createFolder(request, env);
  }

  if (path === '/api/share' && method === 'POST') {
    return share.createShare(request, env);
  }

  const shareMatch = path.match(/^\/api\/share\/([^/]+)$/);
  if (shareMatch) {
    if (method === 'DELETE') return share.revokeShare(request, env);
    if (method === 'GET') return share.getShareInfo(request, env);
  }

  if (path === '/api/stats' && method === 'GET') {
    return stats.getStats(request, env);
  }

  return error('Not found', 404);
}
