import { getAdminUser, unauthorizedResponse } from './content-library/auth.js';
import { getContentDb } from './content-library/db.js';
import { addFavorite, removeFavorite } from './content-library/list-store.js';
import { jsonResponse } from './content-library/serialize.js';

export async function onRequest(context) {
  const { request, env } = context;
  const db = getContentDb(env);
  if (!db) {
    return jsonResponse({ ok: false, error: 'Content database unavailable' }, { status: 500 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (!['POST', 'DELETE'].includes(request.method)) {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const user = await getAdminUser(request, env);
  if (!user) return unauthorizedResponse();

  try {
    const payload = await readPayload(request);
    const result = request.method === 'POST'
      ? await addFavorite({ db, payload, env, requestUrl: request.url })
      : await removeFavorite({ db, payload, env });

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error }, { status: result.status });
    }

    return jsonResponse({
      ok: true,
      duplicate: Boolean(result.duplicate),
      item: result.item || null,
      entry: result.entry || null
    }, { status: result.status });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error?.message || 'Favorite update failed' },
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
