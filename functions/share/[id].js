import { renderNotFoundPage, renderSharePage } from './render.js';
import { getContentDb } from '../api/content-library/db.js';
import { loadShareItem as loadContentLibraryShareItem } from '../api/content-library/share-store.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = getContentDb(env);
  const id = params.id;

  if (!db || !id) {
    return htmlResponse(renderNotFoundPage(request.url), { status: 404 });
  }

  const item = await loadContentLibraryShareItem(db, id);
  if (!item) {
    return htmlResponse(renderNotFoundPage(request.url), { status: 404 });
  }

  return htmlResponse(renderSharePage(item, request.url), {
    status: 200,
    cache: 'public, max-age=300',
    // X's public CDN rejects third-party Referer headers on MP4 requests.
    referrerPolicy: item.type === 'x_post' ? 'no-referrer' : null
  });
}

function htmlResponse(body, { status = 200, cache = 'no-store', referrerPolicy } = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cache,
      ...(referrerPolicy ? { 'referrer-policy': referrerPolicy } : {})
    }
  });
}
