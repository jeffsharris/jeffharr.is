import { unauthorizedResponse } from '../content-library/auth.js';
import { CLIENT_LIFETIME_SECONDS, clientToken, hashCredential, randomCredential } from '../lib/client-auth.js';
import { validNativeAttempt } from '../lib/native-authorization.js';
import { createLogger } from '../lib/logger.js';

function json(body, status = 200) {
  return Response.json(body, {status, headers:{'cache-control':'no-store', 'referrer-policy':'no-referrer'}});
}

export async function onRequest({request, env}) {
  const { log } = createLogger({ request, source:'native-auth' });
  const url = new URL(request.url);
  const db = env.CONTENT_DB;
  if (!db) return json({ok:false,error:'Storage unavailable'}, 503);
  const now = Math.floor(Date.now() / 1000);
  if (request.method === 'POST' && url.searchParams.get('action') === 'exchange') {
    let body;
    try { body = await request.json(); } catch { return json({ok:false,error:'Invalid request'},400); }
    if (!/^[A-Za-z0-9_-]{43}$/.test(body?.code || '') || !/^[A-Za-z0-9_-]{43,128}$/.test(body?.verifier || '')) {
      return json({ok:false,error:'Invalid authorization code'},400);
    }
    // Atomic consumption prevents code replay; PKCE protects intercepted codes.
    const row = await db.prepare(
      'DELETE FROM client_authorization_codes WHERE code_hash = ? AND challenge = ? AND expires_at > ? RETURNING owner_email'
    ).bind(await hashCredential(body.code), await hashCredential(body.verifier), now).first();
    if (!row) {
      log('warn', 'native_exchange_rejected', {reason:'invalid_or_expired_code',status:401});
      return json({ok:false,error:'Expired or invalid authorization code'},401);
    }
    const token = `sukha_${randomCredential()}`;
    const expiresAt = now + CLIENT_LIFETIME_SECONDS;
    await db.prepare('INSERT INTO client_credentials (token_hash, owner_email, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hashCredential(token), row.owner_email, 'sukha', now, expiresAt).run();
    log('info', 'native_connection_created', {status:200});
    return json({ok:true,token,expiresAt});
  }
  if (request.method === 'DELETE') {
    const token = clientToken(request);
    if (!token) return unauthorizedResponse();
    await db.prepare('DELETE FROM client_credentials WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ok:true});
  }
  if (request.method !== 'GET') return json({ok:false,error:'Method not allowed'},405);
  if (!validNativeAttempt(url)) return json({ok:false,error:'Invalid connection request'},400);
  // Keep consent on the exact URL protected by Access, which supplies the signed assertion.
  const signIn = new URL('/api/admin/session', url);
  signIn.searchParams.set('native','1');
  signIn.searchParams.set('challenge',url.searchParams.get('challenge'));
  signIn.searchParams.set('state',url.searchParams.get('state'));
  log('info', 'native_sign_in_started', {status:302});
  return new Response(null,{status:302,headers:{location:signIn.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
