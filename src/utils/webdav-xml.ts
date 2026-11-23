import type { FileMeta } from '../utils/types';
import { getMimeType } from '../lib/mime';
import { ROOT, keyToDavHref } from '../lib/paths';

export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function multistatusResponse(items: string[]): Response {
  const body = `<?xml version="1.0" encoding="utf-8" ?>\n<D:multistatus xmlns:D="DAV:">\n${items.join('\n')}\n</D:multistatus>`;
  return new Response(body, {
    status: 207,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function propstatEntry(href: string, props: Record<string, string>, isCollection: boolean): string {
  const propLines = Object.entries(props)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([name, value]) => `      <D:${name}>${value}</D:${name}>`)
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
 * The one ETag every WebDAV response publishes, taken straight from the object.
 *
 * It used to be synthesized from the file id plus an upload timestamp, which
 * meant PROPFIND and GET could only agree if the metadata matched the object
 * exactly - and when it didn't, `If-Match` answered 412 and clients re-uploaded
 * forever. R2's content ETag cannot disagree with R2.
 */
export function fileEtag(file: FileMeta): string {
  return file.etag.startsWith('"') ? file.etag : `"${file.etag}"`;
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
  return keyToDavHref(file.key);
}

export function folderToProps(folderPath: string, modifiedAt?: string): Record<string, string> {
  const date = modifiedAt ? new Date(modifiedAt) : new Date();
  return {
    displayname: escapeXml(folderPath === ROOT ? '/dav' : folderPath.split('/').pop() ?? folderPath),
    getlastmodified: date.toUTCString(),
    creationdate: date.toISOString(),
  };
}

export function folderToHref(folderPath: string): string {
  return folderPath === ROOT ? '/dav/' : keyToDavHref(folderPath, true);
}
