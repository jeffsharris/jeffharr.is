import { getAdminUser } from '../content-library/auth.js';
import { getContentDb } from '../content-library/db.js';
import { listFavoriteStates } from '../content-library/list-store.js';
import { jsonResponse } from '../content-library/serialize.js';

export async function onRequest(context) {
  const { request, env } = context;
  const db = getContentDb(env);
  if (!db) {
    return jsonResponse({ ok: false, error: 'Content database unavailable' }, { status: 500 });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const user = await getAdminUser(request, env);

  const payload = await readPayload(request);
  const refs = Array.isArray(payload?.refs) ? payload.refs.slice(0, 1000) : [];
  const states = await listFavoriteStates({ db, refs, env });

  return jsonResponse({
    ok: true,
    authenticated: Boolean(user),
    user: user || null,
    states
  });
}

async function readPayload(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}
