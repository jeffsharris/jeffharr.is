import {
  deleteListEntryById,
  getContentDb,
  getListBySlug,
  getListEntryById
} from '../../../content-library/db.js';
import { isWriteAuthorized, unauthorizedResponse } from '../../../content-library/auth.js';
import { jsonResponse } from '../../../content-library/serialize.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = getContentDb(env);
  if (!db) {
    return jsonResponse({ ok: false, error: 'Content database unavailable' }, { status: 500 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'DELETE') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  if (!(await isWriteAuthorized(request, env))) return unauthorizedResponse();

  const list = await getListBySlug(db, params.slug);
  if (!list) {
    return jsonResponse({ ok: false, error: 'List not found' }, { status: 404 });
  }

  const entry = await getListEntryById(db, params.entryId);
  if (!entry || entry.list_id !== list.id) {
    return jsonResponse({ ok: false, error: 'List item not found' }, { status: 404 });
  }

  const deleted = await deleteListEntryById(db, params.entryId);
  return jsonResponse({ ok: true, entry: deleted });
}
