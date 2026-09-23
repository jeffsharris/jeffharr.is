import { getAdminUser, unauthorizedResponse } from '../content-library/auth.js';
import { CLIENT_LIFETIME_SECONDS, clientToken, hashCredential, randomCredential } from '../lib/client-auth.js';

function json(body, status = 200) {
  return Response.json(body, {status, headers:{'cache-control':'no-store', 'referrer-policy':'no-referrer'}});
}

export async function onRequest({request, env}) {
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
    if (!row) return json({ok:false,error:'Expired or invalid authorization code'},401);
    const token = `sukha_${randomCredential()}`;
    const expiresAt = now + CLIENT_LIFETIME_SECONDS;
    await db.prepare('INSERT INTO client_credentials (token_hash, owner_email, scope, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .bind(await hashCredential(token), row.owner_email, 'sukha', now, expiresAt).run();
    return json({ok:true,token,expiresAt});
  }
  if (request.method === 'DELETE') {
    const token = clientToken(request);
    if (!token) return unauthorizedResponse();
    await db.prepare('DELETE FROM client_credentials WHERE token_hash = ?').bind(await hashCredential(token)).run();
    return json({ok:true});
  }
  if (!['GET','POST'].includes(request.method)) return json({ok:false,error:'Method not allowed'},405);
  const user = await getAdminUser(request, env);
  if (!user) {
    if (request.method !== 'GET') return unauthorizedResponse();
    const signIn = new URL('/api/admin/session', url);
    signIn.searchParams.set('redirect', url.pathname + url.search);
    return Response.redirect(signIn.href, 302);
  }
  const challenge = url.searchParams.get('challenge') || '';
  const state = url.searchParams.get('state') || '';
  if (!/^[A-Za-z0-9_-]{43}$/.test(challenge) || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
    return json({ok:false,error:'Invalid connection request'},400);
  }
  if (request.method === 'GET') {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect Sukha</title><style>body{font:17px system-ui;max-width:30rem;margin:15vh auto;padding:24px;line-height:1.6}button{font:inherit;padding:12px 20px;cursor:pointer}</style><h1>Connect Sukha</h1><p>Allow this device to manage your Read Later library, sync to Kindle, and play article audio. Access lasts 180 days and can be revoked by disconnecting in the app.</p><form method="post"><button type="submit">Connect this device</button></form></html>`, {
      headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',
        'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' sukha:; frame-ancestors 'none'; base-uri 'none'"}
    });
  }
  const code = randomCredential();
  await db.batch([
    db.prepare('DELETE FROM client_authorization_codes WHERE expires_at <= ?').bind(now),
    db.prepare('DELETE FROM client_credentials WHERE expires_at <= ?').bind(now),
    db.prepare('INSERT INTO client_authorization_codes (code_hash, challenge, owner_email, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await hashCredential(code), challenge, user.email, now + 120)
  ]);
  const callback = new URL('sukha://auth/callback');
  callback.searchParams.set('code',code);
  callback.searchParams.set('state',state);
  return new Response(null,{status:302,headers:{location:callback.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}
