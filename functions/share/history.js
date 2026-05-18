import { getShareKv, listShareHistory } from '../api/share/store.js';
import { renderHistoryPage } from './render.js';
import { getContentDb } from '../api/content-library/db.js';
import { listShareHistoryFromContentLibrary } from '../api/content-library/share-store.js';

export async function onRequest(context) {
  const db = shouldUseContentLibrary(context.env) ? getContentDb(context.env) : null;
  const kv = getShareKv(context.env);
  const items = db
    ? await listShareHistoryFromContentLibrary(db, { limit: 100 })
    : (kv ? await listShareHistory(kv, { limit: 100 }) : []);
  return new Response(renderHistoryPage(items, context.request.url), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function shouldUseContentLibrary(env) {
  return Boolean(env?.CONTENT_DB && env?.CONTENT_LIBRARY_SHARE === '1');
}
