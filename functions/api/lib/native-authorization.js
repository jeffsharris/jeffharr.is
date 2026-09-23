import { getAdminUser, unauthorizedResponse } from '../content-library/auth.js';
import { hashCredential, randomCredential } from './client-auth.js';
import { createLogger } from './logger.js';

export function validNativeAttempt(url) {
  return ['challenge', 'state'].every(key =>
    url.searchParams.getAll(key).length === 1 && /^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get(key)));
}

export async function authorizeNativeDevice({ request, env }) {
  const { log } = createLogger({ request, source: 'native-auth' });
  const url = new URL(request.url);
  if (!['GET', 'POST'].includes(request.method)) return Response.json({ok:false,error:'Method not allowed'}, {status:405});
  const user = await getAdminUser(request, env);
  if (!user) {
    log('warn', 'native_authorization_rejected', {reason:'owner_sign_in_required',status:401});
    return unauthorizedResponse();
  }
  if (!validNativeAttempt(url)) return Response.json({ok:false,error:'Invalid connection request'}, {status:400,headers:{'cache-control':'no-store'}});
  if (!env.CONTENT_DB) return Response.json({ok:false,error:'Storage unavailable'}, {status:503,headers:{'cache-control':'no-store'}});

  if (request.method === 'GET') {
    log('info', 'native_consent_shown', {status:200});
    return new Response(renderNativeConsent(), {headers:{
      'content-type':'text/html; charset=utf-8', 'cache-control':'no-store', 'x-robots-tag':'noindex',
      // A no-referrer policy makes browser form POSTs send Origin: null.
      'referrer-policy':'same-origin',
      'content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self' sukha:; frame-ancestors 'none'; base-uri 'none'"
    }});
  }

  const now = Math.floor(Date.now() / 1000);
  const code = randomCredential();
  await env.CONTENT_DB.batch([
    env.CONTENT_DB.prepare('DELETE FROM client_authorization_codes WHERE expires_at <= ?').bind(now),
    env.CONTENT_DB.prepare('DELETE FROM client_credentials WHERE expires_at <= ?').bind(now),
    env.CONTENT_DB.prepare('INSERT INTO client_authorization_codes (code_hash, challenge, owner_email, expires_at) VALUES (?, ?, ?, ?)')
      .bind(await hashCredential(code), url.searchParams.get('challenge'), user.email, now + 120)
  ]);
  const callback = new URL('sukha://auth/callback');
  callback.searchParams.set('code',code);
  callback.searchParams.set('state',url.searchParams.get('state'));
  log('info', 'native_code_issued', {status:302});
  return new Response(null,{status:302,headers:{location:callback.href,'cache-control':'no-store','referrer-policy':'no-referrer'}});
}

export function renderNativeConsent() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>Connect Sukha</title>
<style>
:root{color-scheme:light dark;--background:#fff;--text:#171717;--muted:#626267;--line:#dedee3;--accent:#0064cf}
*{box-sizing:border-box}body{margin:0;background:var(--background);color:var(--text);font:17px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;letter-spacing:0}
main{max-width:440px;margin:0 auto;padding:48px 24px max(32px,env(safe-area-inset-bottom))}.brand{font-size:17px;font-weight:600;margin:0 0 40px;color:var(--muted)}h1{font-size:30px;line-height:1.15;margin:0 0 16px;text-wrap:balance}p{margin:0 0 24px;color:var(--muted)}ul{list-style:none;padding:0;margin:28px 0 32px}li{padding:16px 0;border-bottom:1px solid var(--line)}li:first-child{border-top:1px solid var(--line)}button{width:100%;min-height:52px;border:0;border-radius:8px;background:var(--accent);color:#fff;font:600 17px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}button:focus-visible{outline:3px solid var(--text);outline-offset:4px}.privacy{font-size:14px;line-height:1.5;margin:18px 0 0;text-align:center}
@media(prefers-color-scheme:dark){:root{--background:#161618;--text:#f5f5f7;--muted:#b4b4bb;--line:#3b3b40;--accent:#0877df}}
</style></head><body><main><p class="brand">Sukha</p><h1>Your library,<br>on this device.</h1><p>Connect to keep your reading and listening in sync.</p><ul><li>Save your place and manage your queue</li><li>Listen to articles and send them to Kindle</li></ul><form method="post"><button type="submit">Connect this device</button></form><p class="privacy">Only this device will be connected.<br>Access lasts 180 days. Disconnect anytime in the app.</p></main></body></html>`;
}
