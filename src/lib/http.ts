// ─── HTTP responses ───────────────────────────────────────────────────

import { contentDisposition, getMimeType, isScriptableType } from './mime';

/**
 * The app is same-origin only, so there is no CORS surface to open. Browsers
 * never send credentialed cross-site requests here, and a wildcard
 * `Access-Control-Allow-Origin` on an authenticated API is one `ACAC` away from
 * being a real hole.
 */
export function json<T>(
  data: T,
  status = 200,
  cacheControl = 'no-store',
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
      'X-Content-Type-Options': 'nosniff',
      ...headers,
    },
  });
}

export function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

export function ok(message = 'ok'): Response {
  return json({ message });
}

export function redirect(url: string, status = 302, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers: { Location: url, ...headers } });
}

const HTML_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=(), interest-cohort=()',
  // Alpine evaluates expressions with `new Function`, and the pages carry
  // inline script, so those two relaxations are unavoidable. Everything else
  // is locked to this origin, and framing is denied outright.
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
};

export function html(body: string, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(body, { status, headers: { ...HTML_HEADERS, ...extra } });
}

/**
 * Preflight is answered without CORS headers, which is the correct answer for a
 * same-origin application: browsers only send it cross-origin, and we refuse
 * those.
 */
export function preflight(): Response {
  return new Response(null, { status: 204, headers: { Allow: 'GET, HEAD, POST, PUT, DELETE, OPTIONS' } });
}

// ─── Asset HTML ───────────────────────────────────────────────────────

/** Extensions the Worker lets through to R2-backed static assets. */
const STATIC_EXTENSIONS = new Set([
  '.css', '.js', '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.avif',
  '.woff', '.woff2', '.ttf', '.eot', '.otf', '.map', '.txt',
]);

export function isStaticAsset(pathname: string): boolean {
  const dot = pathname.lastIndexOf('.');
  return dot >= 0 && STATIC_EXTENSIONS.has(pathname.slice(dot).toLowerCase());
}

/**
 * ASSETS.fetch answers 307 for extensionless paths (`/share.html` → `/share`),
 * so a redirect has to be followed to get the real body.
 */
export async function fetchAssetHtml(assets: Fetcher, requestUrl: string, assetPath: string): Promise<string> {
  const assetUrl = new URL(assetPath, requestUrl);
  let res = await assets.fetch(new Request(assetUrl.toString()));
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('Location');
    if (location) res = await assets.fetch(new Request(new URL(location, assetUrl).toString()));
  }
  return res.text();
}

function escapeJsonForHtml(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (char) => {
    switch (char) {
      case '<': return '\\u003c';
      case '>': return '\\u003e';
      case '&': return '\\u0026';
      case '\u2028': return '\\u2028';
      default: return '\\u2029';
    }
  });
}

/** A JSON island that is safe to embed in HTML: no `</script>` can survive it. */
export function jsonIsland(id: string, value: unknown): string {
  return `<script id="${id}" type="application/json">${escapeJsonForHtml(value)}</script>`;
}

export function injectBranding(body: string, branding: { siteName: string; siteIconUrl: string }): string {
  const tag = jsonIsland('branding-data', branding);
  let favicon = '';
  try {
    const iconUrl = new URL(branding.siteIconUrl);
    if (iconUrl.protocol === 'https:' || iconUrl.protocol === 'http:') {
      favicon = `<link rel="icon" type="image/png" href="${iconUrl.toString().replace(/&/g, '&amp;').replace(/"/g, '&quot;')}">`;
    }
  } catch {
    // An empty or invalid icon URL simply keeps the default icon.
  }
  return body.replace('</head>', favicon + tag + '</head>');
}

// ─── Range requests ───────────────────────────────────────────────────

export function parseSingleRange(header: string, size: number): { offset: number; length: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || size <= 0 || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    const length = Math.min(suffix, size);
    return { offset: size - length, length };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return null;
  }
  const end = Math.min(requestedEnd, size - 1);
  return { offset: start, length: end - start + 1 };
}

function parseEntityTags(header: string): string[] {
  return header.split(',').map((value) => value.trim().replace(/^W\//, '')).filter(Boolean);
}

// ─── Object serving ───────────────────────────────────────────────────

export interface ServeOptions {
  name: string;
  type?: string;
  disposition: 'inline' | 'attachment';
  cacheControl: string;
  /** Extra headers, e.g. the CSP that sandboxes a user-supplied document. */
  headers?: Record<string, string>;
}

/**
 * Serve one R2 object, and do it in exactly one read.
 *
 * The previous code fetched the whole object to find its size and then fetched
 * it again for the range, so every video seek cost two reads of the file. A
 * `head` is cheap, strongly consistent, and enough to answer both 304 and 206.
 */
export async function serveObject(
  request: Request,
  bucket: R2Bucket,
  key: string,
  options: ServeOptions,
): Promise<Response | null> {
  const head = await bucket.head(key);
  if (!head) return null;

  const etag = head.httpEtag;
  const lastModified = head.uploaded.toUTCString();

  const ifNoneMatch = request.headers.get('If-None-Match');
  if (ifNoneMatch) {
    const tags = parseEntityTags(ifNoneMatch);
    if (tags.includes('*') || tags.includes(etag)) {
      return new Response(null, {
        status: 304,
        headers: { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': options.cacheControl },
      });
    }
  } else {
    const ifModifiedSince = request.headers.get('If-Modified-Since');
    if (ifModifiedSince) {
      const since = Date.parse(ifModifiedSince);
      if (Number.isFinite(since) && Math.floor(head.uploaded.getTime() / 1000) <= Math.floor(since / 1000)) {
        return new Response(null, {
          status: 304,
          headers: { ETag: etag, 'Last-Modified': lastModified, 'Cache-Control': options.cacheControl },
        });
      }
    }
  }

  // If-Match is the precondition a sync client uses to avoid overwriting a
  // file that changed behind its back; without it a racing write silently wins.
  const ifMatch = request.headers.get('If-Match');
  if (ifMatch) {
    const tags = parseEntityTags(ifMatch);
    if (!tags.includes('*') && !tags.includes(etag)) {
      return new Response('Precondition Failed', {
        status: 412,
        headers: { ETag: etag, 'Last-Modified': lastModified },
      });
    }
  }

  const rangeHeader = request.headers.get('Range');
  const range = rangeHeader ? parseSingleRange(rangeHeader, head.size) : null;
  if (rangeHeader && !range) {
    return new Response('Range Not Satisfiable', {
      status: 416,
      headers: { 'Content-Range': `bytes */${head.size}` },
    });
  }

  const object = await bucket.get(key, range ? { range } : undefined);
  if (!object || !object.body) return null;

  const declaredType = options.type || object.httpMetadata?.contentType || getMimeType(options.name);
  const headers = new Headers({
    'Content-Type': declaredType,
    'Content-Disposition': contentDisposition(options.disposition, options.name),
    'Content-Length': String(range ? range.length : head.size),
    'Accept-Ranges': 'bytes',
    ETag: etag,
    'Last-Modified': lastModified,
    'Cache-Control': options.cacheControl,
    'X-Content-Type-Options': 'nosniff',
  });

  if (options.disposition === 'inline') {
    // A file someone uploaded is data, never a document on our origin: an
    // opaque-origin sandbox and no script execution, whatever the type says.
    headers.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    headers.set('Cross-Origin-Resource-Policy', 'same-origin');
    if (isScriptableType(declaredType)) {
      headers.set('Content-Disposition', contentDisposition('inline', options.name));
    }
  }

  if (range) {
    headers.set('Content-Range', `bytes ${range.offset}-${range.offset + range.length - 1}/${head.size}`);
    return new Response(object.body, { status: 206, headers });
  }
  return new Response(object.body, { status: 200, headers });
}
