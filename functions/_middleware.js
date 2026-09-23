import { unauthorizedResponse } from './api/content-library/auth.js';
import { getLibraryUser } from './api/lib/client-auth.js';

const READ_ONLY_POSTS = new Set(['/api/public/favorites/state', '/api/favorites/state']);
const INTERNAL_PATH = /^\/(?:\.|notes(?:\/|$)|scripts(?:\/|$)|tests(?:\/|$)|tools(?:\/|$)|workers(?:\/|$)|migrations(?:\/|$)|node_modules(?:\/|$)|functions(?:\/|$)|tmp(?:\/|$)|AGENTS\.md$|package(?:-lock)?\.json$|wrangler\.(?:toml|jsonc?)$)/i;
const MAX_BODY_BYTES = 256 * 1024;
const PUBLIC_FEEDS = new Set(['/api/goodreads', '/api/letterboxd', '/api/github', '/api/substack', '/api/x']);

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  let path;
  try { path = decodeURIComponent(url.pathname).replace(/\/+$/, '') || '/'; }
  catch { return secure(new Response('Bad request', { status: 400 })); }
  if (INTERNAL_PATH.test(path)) return secure(new Response('Not found', { status: 404 }));

  if (request.method === 'GET' && PUBLIC_FEEDS.has(path) && globalThis.caches?.default) {
    const cacheKey = new Request(`${url.origin}${path}`);
    const cached = await caches.default.match(cacheKey);
    if (cached) return secure(cached);
    const response = secure(await context.next());
    if (response.ok && /public/.test(response.headers.get('cache-control') || '')) {
      context.waitUntil(caches.default.put(cacheKey, response.clone()));
    }
    return response;
  }

  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const nativeTokenAction = path === '/api/auth/native' && (request.method === 'DELETE' || (request.method === 'POST' && url.searchParams.get('action') === 'exchange'));
  const publicSave = path === '/api/read-later' && request.method === 'POST';
  const ownerAction = (mutation && !READ_ONLY_POSTS.has(path) && path !== '/api/push/test' && !nativeTokenAction && !publicSave) ||
    path === '/api/read-later/audio' ||
    (path === '/api/read-later/reader' && url.searchParams.get('refresh') === '1') ||
    (path === '/share/new' && (url.searchParams.get('resolve') === '1' || !(request.headers.get('accept') || '').includes('text/html')));

  if (mutation || ownerAction) {
    const origin = request.headers.get('origin');
    if ((origin && origin !== url.origin) || request.headers.get('sec-fetch-site') === 'cross-site') {
      return secure(jsonError('Cross-site request forbidden', 403));
    }
  }
  if (ownerAction && !(await getLibraryUser(request, env))) return secure(unauthorizedResponse());

  if (mutation && request.body) {
    // Bound the actual stream, including requests without Content-Length.
    const reader = request.body.getReader();
    const chunks = [];
    let length = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BODY_BYTES) {
          await reader.cancel();
          return secure(jsonError('Request too large', 413));
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const nextRequest = new Request(request, { body: bytes });
    return secure(await context.next(nextRequest));
  }
  return secure(await context.next());
}

function jsonError(error, status) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}

export function secure(response) {
  const headers = new Headers(response.headers);
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', 'DENY');
  if (!headers.has('referrer-policy')) headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  headers.set('strict-transport-security', 'max-age=31536000');
  if (!headers.has('content-security-policy')) {
    headers.set('content-security-policy', "base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'");
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
