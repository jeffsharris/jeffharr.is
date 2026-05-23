import { getAdminUser } from '../content-library/auth.js';
import { getContentDb } from '../content-library/db.js';
import { listFavoriteStates } from '../content-library/list-store.js';
import { jsonResponse, parseJson } from '../content-library/serialize.js';

export async function onRequest(context) {
  return handleFavoriteStateRequest(context, { includeAuth: true });
}

async function handleFavoriteStateRequest(context, { includeAuth = true } = {}) {
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

  const user = includeAuth ? await getAdminUser(request, env) : null;

  const payload = await parseJson(request, {});
  const refs = Array.isArray(payload?.refs) ? payload.refs.slice(0, 1000) : [];
  const states = await listFavoriteStates({ db, refs, env });

  const body = {
    ok: true,
    states
  };

  if (includeAuth) {
    body.authenticated = Boolean(user);
    body.user = user || null;
  }

  return jsonResponse(body);
}

export { handleFavoriteStateRequest };
