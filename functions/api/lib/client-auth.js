import { getAdminUser, isAllowedEmail } from '../content-library/auth.js';

export const CLIENT_LIFETIME_SECONDS = 180 * 24 * 60 * 60;

export function randomCredential() {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function hashCredential(value) {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function clientToken(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (sukha_[A-Za-z0-9_-]{43})$/)?.[1];
  return token || '';
}

export async function getClientUser(request, env) {
  const token = clientToken(request);
  if (!token || !env.CONTENT_DB) return null;
  const row = await env.CONTENT_DB.prepare(
    'SELECT owner_email, scope FROM client_credentials WHERE token_hash = ? AND expires_at > ?'
  ).bind(await hashCredential(token), Math.floor(Date.now() / 1000)).first();
  if (!row || row.scope !== 'sukha' || !isAllowedEmail(row.owner_email, env)) return null;
  return {email:row.owner_email, scope:row.scope};
}

export function clientMayAccess(request) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  return path === '/api/read-later' || path.startsWith('/api/read-later/') || path === '/api/push/devices';
}

export async function getLibraryUser(request, env) {
  return await getAdminUser(request, env) || (clientMayAccess(request) ? await getClientUser(request, env) : null);
}
