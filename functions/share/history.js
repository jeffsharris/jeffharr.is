import { getShareKv, listShareHistory } from '../api/share/store.js';
import { renderHistoryPage } from './render.js';

export async function onRequest(context) {
  const kv = getShareKv(context.env);
  const items = kv ? await listShareHistory(kv, { limit: 100 }) : [];
  return new Response(renderHistoryPage(items, context.request.url), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
