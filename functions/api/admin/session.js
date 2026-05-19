import { getAdminUser, unauthorizedResponse } from '../content-library/auth.js';
import { jsonResponse } from '../content-library/serialize.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'GET') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const user = await getAdminUser(request, env);
  if (!user) return unauthorizedResponse();

  const url = new URL(request.url);
  const redirect = safeRedirect(url.searchParams.get('redirect'), request.url);
  if (redirect && acceptsHtml(request)) {
    return Response.redirect(redirect, 302);
  }

  return jsonResponse({
    ok: true,
    authenticated: true,
    admin: true,
    user
  });
}

function safeRedirect(value, requestUrl) {
  if (!value) return '';
  try {
    const redirect = new URL(value, requestUrl);
    const current = new URL(requestUrl);
    if (redirect.origin !== current.origin) return '';
    return redirect.href;
  } catch {
    return '';
  }
}

function acceptsHtml(request) {
  return (request.headers.get('accept') || '').includes('text/html');
}
