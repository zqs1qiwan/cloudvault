// ─── Object paths ─────────────────────────────────────────────────────
//
// The bucket key *is* the file's identity: no separate id, no index row, no
// second place to disagree with R2. `folder/name` is the key, the key is the
// id, and `root` is the empty prefix (a root file is just `name`).
//
// Folders are prefixes, so they exist as soon as something is stored under
// them. An *empty* folder needs something in R2 to exist at all, which is what
// the marker object below is for - one object per empty folder, not per file.

export const ROOT = 'root';
export const FOLDER_MARKER = '.cv-folder';
/** Names we refuse so a user file can never be mistaken for internal state. */
export const RESERVED_NAMES: ReadonlySet<string> = new Set([FOLDER_MARKER]);

function validateSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..' || /[\\/\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error(`Invalid ${label}`);
  }
  if (trimmed.length > 255) throw new Error(`${label} is too long`);
  return trimmed;
}

/** `a//b`, `a/./b`, `../x` and trailing slashes are rejected, never repaired. */
export function normalizeFolder(folder: string | null | undefined): string {
  const value = (folder ?? '').trim();
  if (!value || value === ROOT) return ROOT;
  const parts = value.split('/');
  if (parts.some((part) => part === '')) throw new Error('Invalid folder path');
  return parts.map((part) => validateSegment(part, 'folder path')).join('/');
}

export function validateFileName(name: string): string {
  const value = validateSegment(name, 'file name');
  if (RESERVED_NAMES.has(value)) throw new Error('Reserved file name');
  return value;
}

export function buildObjectKey(folder: string, fileName: string): string {
  const normalizedFolder = normalizeFolder(folder);
  const normalizedName = validateFileName(fileName);
  return normalizedFolder === ROOT ? normalizedName : `${normalizedFolder}/${normalizedName}`;
}

export function folderOf(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash < 0 ? ROOT : key.slice(0, slash);
}

export function nameOf(key: string): string {
  const slash = key.lastIndexOf('/');
  return slash < 0 ? key : key.slice(slash + 1);
}

export function splitObjectKey(key: string): { name: string; folder: string } {
  return { name: nameOf(key), folder: folderOf(key) };
}

export function parentFolder(folder: string): string {
  const slash = folder.lastIndexOf('/');
  return slash < 0 ? ROOT : folder.slice(0, slash);
}

/** `['a', 'a/b', 'a/b/c']` - every ancestor of a folder path. */
export function ancestorFolders(folder: string): string[] {
  if (!folder || folder === ROOT) return [];
  const parts = folder.split('/');
  const out: string[] = [];
  let path = '';
  for (const part of parts) {
    path = path ? `${path}/${part}` : part;
    out.push(path);
  }
  return out;
}

/** True when `folder` is `parent` itself or lives underneath it. */
export function isUnder(folder: string, parent: string): boolean {
  if (parent === ROOT) return true;
  return folder === parent || folder.startsWith(`${parent}/`);
}

/** Key prefix covering everything inside a folder (empty string for root). */
export function folderPrefix(folder: string): string {
  return folder === ROOT ? '' : `${folder}/`;
}

export function folderMarkerKey(folder: string): string {
  if (folder === ROOT) throw new Error('Root has no marker');
  return `${folder}/${FOLDER_MARKER}`;
}

export function isMarkerKey(key: string): boolean {
  return key === FOLDER_MARKER || key.endsWith(`/${FOLDER_MARKER}`);
}

export function folderOfMarkerKey(key: string): string | null {
  if (!isMarkerKey(key)) return null;
  const folder = key === FOLDER_MARKER ? ROOT : key.slice(0, key.length - FOLDER_MARKER.length - 1);
  return folder === ROOT ? null : folder;
}

/** `/dav/a/b.txt` (trailing slash trimmed) → `a/b.txt`; '' means the DAV root. */
export function davPathToKey(davPath: string): string {
  const trimmed = davPath.replace(/\/+$/, '');
  if (!trimmed) return '';
  // Decoding happens at the HTTP boundary; here we only validate the shape.
  const segments = trimmed.split('/');
  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..' || segment.includes('\\')) {
      throw new Error('Invalid path');
    }
  }
  return segments.join('/');
}

/** Key → the path a WebDAV client uses (`/dav/<encoded>`). */
export function keyToDavHref(key: string, trailingSlash = false): string {
  if (!key) return '/dav/';
  const encoded = key.split('/').map((part) => encodeURIComponent(part)).join('/');
  return `/dav/${encoded}${trailingSlash ? '/' : ''}`;
}
