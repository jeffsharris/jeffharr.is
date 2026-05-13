import { getShareKv, loadShareItem } from '../api/share/store.js';
import { renderNotFoundPage, renderSharePage } from './render.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const kv = getShareKv(env);
  const id = params.id;

  if (!kv || !id) {
    return htmlResponse(renderNotFoundPage(request.url), { status: 404 });
  }

  const item = await loadShareItem(kv, id);
  if (!item) {
    return htmlResponse(renderNotFoundPage(request.url), { status: 404 });
  }

  return htmlResponse(renderSharePage(item, request.url), {
    status: 200,
    cache: 'public, max-age=300'
  });
}

function htmlResponse(body, { status = 200, cache = 'no-store' } = {}) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': cache
    }
  });
}
