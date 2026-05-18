import { getContentDb, getListBySlug, listEntries } from '../content-library/db.js';
import {
  jsonResponse,
  serializeList,
  serializeListEntryRow
} from '../content-library/serialize.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = getContentDb(env);
  if (!db) {
    return jsonResponse({ ok: false, error: 'Content database unavailable' }, { status: 500 });
  }

  if (request.method !== 'GET') {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const slug = params.slug;
  const list = await getListBySlug(db, slug);
  if (!list) {
    return jsonResponse({ ok: false, error: 'List not found' }, { status: 404 });
  }

  const url = new URL(request.url);
  const limit = url.searchParams.get('limit') || '500';
  const status = url.searchParams.get('status') || null;
  const rows = await listEntries(db, slug, { limit, status });
  return jsonResponse({
    list: serializeList(list),
    items: rows.map(serializeListEntryRow),
    count: rows.length
  });
}
