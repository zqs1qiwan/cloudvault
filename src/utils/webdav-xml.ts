import { FileMeta } from './types';
import { getMimeType } from './response';

const DAV_ENDPOINT = '/dav/';

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function multistatusResponse(items: string[]): Response {
  const body = '<?xml version="1.0" encoding="utf-8" ?>\n<D:multistatus xmlns:D="DAV:">\n' + items.join('\n') + '\n</D:multistatus>';
  return new Response(body, {
    status: 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8' },
  });
}

export function propstatEntry(href: string, props: Record<string, string>, isCollection: boolean): string {
  const propLines = Object.entries(props)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `      <D:${k}>${v}</D:${k}>`)
    .join('\n');

  const resourceType = isCollection ? '<D:collection/>' : '';

  return `  <D:response>
    <D:href>${escapeXml(href)}</D:href>
    <D:propstat>
      <D:prop>
${propLines}
        <D:resourcetype>${resourceType}</D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>`;
}

/**
 * The one ETag every WebDAV response must agree on.
 *
 * PROPFIND used to publish the bare file id while GET published R2's object
 * ETag (the content MD5), so a client that read `getetag` from PROPFIND and
 * sent it back as `If-Match` could never match: R2 compared the UUID with the
 * MD5 and answered 412. Deriving the tag from the identity *and* the upload
 * time keeps it consistent across PROPFIND/GET/HEAD while still changing when
 * the bytes change (an overwrite refreshes `uploadedAt`).
 */
export function fileEtag(file: FileMeta): string {
  const uploaded = Date.parse(file.uploadedAt);
  const stamp = Number.isFinite(uploaded) ? uploaded : 0;
  return `"${file.id}-${stamp}"`;
}

export function fileToProps(file: FileMeta): Record<string, string> {
  return {
    displayname: escapeXml(file.name),
    getcontentlength: String(file.size),
    getcontenttype: file.type || getMimeType(file.name),
    getlastmodified: new Date(file.uploadedAt).toUTCString(),
    creationdate: new Date(file.uploadedAt).toISOString(),
    getetag: fileEtag(file),
  };
}

export function fileToHref(file: FileMeta): string {
  const path = file.folder === 'root' ? file.name : file.folder + '/' + file.name;
  return DAV_ENDPOINT + encodeURI(path);
}

export function folderToProps(name: string, createdAt?: string): Record<string, string> {
  const date = createdAt ? new Date(createdAt) : new Date();
  return {
    displayname: escapeXml(name.split('/').pop() || name),
    getlastmodified: date.toUTCString(),
    creationdate: date.toISOString(),
  };
}

export function folderToHref(folderPath: string): string {
  return DAV_ENDPOINT + (folderPath ? encodeURI(folderPath) + '/' : '');
}
