import { Env, FileMeta, KV_PREFIX } from '../utils/types';
import { json } from '../utils/response';

export async function getStats(request: Request, env: Env): Promise<Response> {
  const files: FileMeta[] = [];
  let cursor: string | undefined;

  for (;;) {
    const result = await env.VAULT_KV.list({ prefix: KV_PREFIX.FILE, limit: 1000, cursor });
    for (const key of result.keys) {
      const raw = await env.VAULT_KV.get(key.name);
      if (raw) {
        try { files.push(JSON.parse(raw)); } catch { /* skip */ }
      }
    }
    if (result.list_complete) break;
    cursor = result.cursor;
  }

  let totalSize = 0;
  let totalDownloads = 0;
  for (const f of files) {
    totalSize += f.size;
    totalDownloads += f.downloads;
  }

  const recentUploads = [...files]
    .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
    .slice(0, 5);

  const topDownloaded = [...files]
    .filter(f => f.downloads > 0)
    .sort((a, b) => b.downloads - a.downloads)
    .slice(0, 5);

  return json({
    totalFiles: files.length,
    totalSize,
    totalDownloads,
    recentUploads,
    topDownloaded,
  });
}
