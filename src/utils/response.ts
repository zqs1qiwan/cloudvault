// ─── Response Helpers ─────────────────────────────────────────────────

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-File-Name, X-Folder',
  'Access-Control-Max-Age': '86400',
};

export function json<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...CORS_HEADERS,
    },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function ok(message = 'ok'): Response {
  return json({ message });
}

export function redirect(url: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: { Location: url, ...CORS_HEADERS },
  });
}

export function corsPreflightResponse(): Response {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

export function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

// ─── Asset HTML Fetching ──────────────────────────────────────────────
// ASSETS.fetch may return 307 redirects (e.g. /share.html → /share).
// We must follow the redirect to get the actual HTML content.
export async function fetchAssetHtml(assets: Fetcher, requestUrl: string, assetPath: string): Promise<string> {
  const assetUrl = new URL(assetPath, requestUrl);
  let res = await assets.fetch(new Request(assetUrl.toString()));
  if (res.status >= 300 && res.status < 400) {
    const loc = res.headers.get('Location');
    if (loc) {
      res = await assets.fetch(new Request(new URL(loc, assetUrl).toString()));
    }
  }
  return res.text();
}

export function injectBranding(html: string, branding: { siteName: string; siteIconUrl: string }): string {
  const tag = `<script id="branding-data" type="application/json">${JSON.stringify(branding)}</script>`;
  const favicon = branding.siteIconUrl ? `<link rel="icon" type="image/png" href="${branding.siteIconUrl}">` : '';
  return html.replace('</head>', favicon + tag + '</head>');
}

// ─── Size Formatting ──────────────────────────────────────────────────
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// ─── MIME Type Detection ──────────────────────────────────────────────
const MIME_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.xml': 'text/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

export function getMimeType(filename: string): string {
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  return MIME_MAP[ext] || 'application/octet-stream';
}

// ─── Preview Category ─────────────────────────────────────────────────
export type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'none';

const CODE_EXTENSIONS = new Set([
  '.js', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.sh', '.bash',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sql', '.graphql',
]);

export function getPreviewType(filename: string, mimeType: string): PreviewType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  const ext = '.' + filename.split('.').pop()?.toLowerCase();
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  return 'none';
}
