import { Env } from '../utils/types';
import { json } from '../utils/response';
import { getAllIndexedFiles } from '../utils/files';

export async function getStats(request: Request, env: Env): Promise<Response> {
  const files = await getAllIndexedFiles(env, true);

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
