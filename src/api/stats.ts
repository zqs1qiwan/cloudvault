import { Env } from '../utils/types';
import { json } from '../utils/response';
import { getIndexedFiles } from '../utils/files';
import type { FileMeta } from '../utils/types';

export function buildStats(files: FileMeta[]) {
  let totalSize = 0;
  let totalDownloads = 0;
  for (const f of files) {
    totalSize += f.size;
    totalDownloads += f.downloads;
  }

  return {
    totalFiles: files.length,
    totalSize,
    totalDownloads,
    recentUploads: [...files]
      .sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime())
      .slice(0, 5),
    topDownloaded: [...files]
      .filter(f => f.downloads > 0)
      .sort((a, b) => b.downloads - a.downloads)
      .slice(0, 5),
  };
}

export async function getStats(request: Request, env: Env): Promise<Response> {
  return json(buildStats(await getIndexedFiles(env)));
}
