import { getAdminUser } from '../content-library/auth.js';

export async function authenticateAdminRequest(request, env = {}) {
  const hasToken = request.headers.has('cf-access-jwt-assertion') || request.headers.has('authorization') || /(?:^|;\s*)CF_Authorization=/.test(request.headers.get('cookie') || '');
  if (hasToken && (!env.CLOUDFLARE_ACCESS_TEAM_DOMAIN || !(env.ADMIN_ACCESS_AUD || env.CLOUDFLARE_ACCESS_AUD))) {
    return { authenticated: false, admin: false, status: 503, error: 'access_not_configured' };
  }
  const user = await getAdminUser(request, env);
  return user
    ? { authenticated: true, admin: true, email: user.email }
    : { authenticated: false, admin: false, status: 401, error: hasToken ? 'invalid_access_token' : 'not_authenticated' };
}

export function adminJsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex'
    }
  });
}
