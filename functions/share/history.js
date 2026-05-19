import { renderHistoryPage } from './render.js';
import { getContentDb } from '../api/content-library/db.js';
import { listShareHistoryFromContentLibrary } from '../api/content-library/share-store.js';

export async function onRequest(context) {
  const db = getContentDb(context.env);
  const items = db ? await listShareHistoryFromContentLibrary(db, { limit: 100 }) : [];
  return new Response(renderHistoryPage(items, context.request.url), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}
