import {
  getContentDb,
  getListBySlug,
  getListEntry,
  upsertListEntry
} from '../../content-library/db.js';
import { isWriteAuthorized, unauthorizedResponse } from '../../content-library/auth.js';
import { resolveContentInput } from '../../content-library/resolve.js';
import { jsonResponse } from '../../content-library/serialize.js';
import { createRandomId, getNowIso } from '../../content-library/ids.js';

export async function onRequest(context) {
  const { request, env, params } = context;
  const db = getContentDb(env);
  if (!db) {
    return jsonResponse({ ok: false, error: 'Content database unavailable' }, { status: 500 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method === 'GET') {
    return Response.redirect(new URL(`/api/lists/${params.slug}`, request.url), 307);
  }

  if (!['PUT', 'POST'].includes(request.method)) {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  if (!(await isWriteAuthorized(request, env))) return unauthorizedResponse();

  try {
    const list = await getListBySlug(db, params.slug);
    if (!list) {
      return jsonResponse({ ok: false, error: 'List not found' }, { status: 404 });
    }

    const payload = await readPayload(request);
    const item = await resolveContentInput({ db, payload, env });
    const existing = await getListEntry(db, list.id, item.id);
    const now = getNowIso();
    const entry = await upsertListEntry(db, {
      id: existing?.id || createRandomId('ent'),
      listId: list.id,
      itemId: item.id,
      status: payload?.status || 'active',
      position: payload?.position ?? null,
      note: typeof payload?.note === 'string' ? payload.note : null,
      addedAt: existing?.added_at || payload?.addedAt || now,
      updatedAt: now,
      extra: payload?.extra || {}
    });

    return jsonResponse({
      ok: true,
      duplicate: Boolean(existing),
      item,
      entry
    }, { status: existing ? 200 : 201 });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error?.message || 'Failed to add list item' },
      { status: error?.status || 500 }
    );
  }
}

async function readPayload(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
