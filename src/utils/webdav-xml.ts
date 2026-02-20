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

export function fileToProps(file: FileMeta): Record<string, string> {
  return {
    displayname: escapeXml(file.name),
    getcontentlength: String(file.size),
    getcontenttype: file.type || getMimeType(file.name),
    getlastmodified: new Date(file.uploadedAt).toUTCString(),
    creationdate: new Date(file.uploadedAt).toISOString(),
    getetag: '"' + file.id + '"',
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
