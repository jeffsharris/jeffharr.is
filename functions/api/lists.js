import { getContentDb, listLists } from './content-library/db.js';
import { jsonResponse, serializeList } from './content-library/serialize.js';
import { isWriteAuthorized, unauthorizedResponse } from './content-library/auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const db = getContentDb(env);
  if (!db) {
    return jsonResponse({ ok: false, error: 'Content database unavailable' }, { status: 500 });
  }

  if (request.method === 'GET') {
    const lists = await listLists(db);
    return jsonResponse({ lists: lists.map(serializeList), count: lists.length });
  }

  if (request.method === 'POST') {
    if (!isWriteAuthorized(request, env)) return unauthorizedResponse();
    return jsonResponse(
      { ok: false, error: 'Custom list creation is not enabled yet' },
      { status: 501 }
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
}
