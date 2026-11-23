// ─── MIME, sizes, dispositions ─────────────────────────────────────────

const MIME_MAP: Record<string, string> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.heic': 'image/heic',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.7z': 'application/x-7z-compressed',
  '.rar': 'application/vnd.rar',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.apk': 'application/vnd.android.package-archive',
  '.exe': 'application/vnd.microsoft.portable-executable',
  '.dmg': 'application/x-apple-diskimage',
};

export function getMimeType(filename: string): string {
  const dot = filename.lastIndexOf('.');
  if (dot < 0) return 'application/octet-stream';
  return MIME_MAP[filename.slice(dot).toLowerCase()] ?? 'application/octet-stream';
}

export type PreviewType = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'code' | 'none';

const CODE_EXTENSIONS = new Set([
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.rb', '.go', '.rs', '.java',
  '.c', '.cpp', '.h', '.hpp', '.cs', '.swift', '.kt', '.sh', '.bash',
  '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.sql', '.graphql',
]);

export function getPreviewType(filename: string, mimeType: string): PreviewType {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType.startsWith('text/')) return 'text';
  const dot = filename.lastIndexOf('.');
  if (dot >= 0 && CODE_EXTENSIONS.has(filename.slice(dot).toLowerCase())) return 'code';
  return 'none';
}

/**
 * Content types that turn an inline response into an XSS vector on our own
 * origin. Everything else is safe to render inline.
 */
const SCRIPTABLE_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
  'text/javascript',
  'application/javascript',
]);

export function isScriptableType(type: string): boolean {
  return SCRIPTABLE_TYPES.has(type.split(';')[0].trim().toLowerCase());
}

/** RFC 6266: ASCII fallback plus the real name in `filename*`. */
export function contentDisposition(disposition: 'attachment' | 'inline', fileName: string): string {
  const ascii = fileName.replace(/[\r\n\\"]/g, '_').replace(/[^\x20-\x7e]/g, '_') || 'download';
  return `${disposition}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

/**
 * Zip entry names must not escape the extraction directory and must survive
 * the trip: strip control characters, backslashes and leading slashes.
 */
export function sanitizeEntryName(name: string): string {
  return name
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}
