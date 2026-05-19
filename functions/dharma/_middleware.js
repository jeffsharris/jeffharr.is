import { injectFavoritesAssets } from '../api/content-library/html-assets.js';

export async function onRequest(context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') || context.request.method === 'HEAD') {
    return response;
  }

  const html = await response.text();
  const output = injectFavoritesAssets(html);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
