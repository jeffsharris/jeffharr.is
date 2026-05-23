import { getContentDb } from '../content-library/db.js';
import { listShareHistoryFromContentLibrary } from '../content-library/share-store.js';
import { jsonResponse } from '../content-library/serialize.js';

export async function onRequest(context) {
  const db = getContentDb(context.env);
  if (!db) {
    return jsonResponse({ items: [], count: 0 }, { status: 200 });
  }

  const url = new URL(context.request.url);
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') || '100', 10), 1, 250);
  const items = await listShareHistoryFromContentLibrary(db, { limit });
  return jsonResponse({ items, count: items.length }, { status: 200 });
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
