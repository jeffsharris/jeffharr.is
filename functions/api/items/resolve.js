import { getContentDb } from '../content-library/db.js';
import { isAdminAuthorized, unauthorizedResponse } from '../content-library/auth.js';
import { resolveContentInput } from '../content-library/resolve.js';
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

  if (!(await isAdminAuthorized(request, env))) return unauthorizedResponse();

  try {
    const payload = await request.json();
    const item = await resolveContentInput({ db, payload, env });
    return jsonResponse({ ok: true, item });
  } catch (error) {
    return jsonResponse(
      { ok: false, error: error?.message || 'Failed to resolve item' },
      { status: error?.status || 500 }
    );
  }
}
