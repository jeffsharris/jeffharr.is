import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, secure } from '../functions/_middleware.js';
import { publicUrl, publicFetch } from '../functions/api/lib/public-fetch.js';
import { getAdminUser } from '../functions/api/content-library/auth.js';
import { sanitizeContent } from '../functions/api/read-later/reader.js';
import { renderSharePage } from '../functions/share/render.js';

function context(path, init = {}, env = {}) {
  return { request: new Request(`https://jeffharr.is${path}`, init), env,
    next: async (request) => new Response(request ? await request.text() : 'public') };
}

test('anonymous writes and paid generation are rejected before any handler runs', async () => {
  for (const [path, method] of [
    ['/api/read-later', 'PATCH'], ['/api/read-later', 'DELETE'],
    ['/api/read-later/progress', 'POST'], ['/api/read-later/kindle-sync', 'POST'],
    ['/api/read-later/regenerate-cover', 'POST'], ['/api/push/devices', 'POST'],
    ['/api/share', 'POST'], ['/share/new?url=https://example.com&resolve=1', 'GET'],
    ['/api/read-later/audio?id=test&chunk=0', 'GET'], ['/api/read-later/reader?refresh=1', 'GET']
  ]) {
    const response = await onRequest(context(path, { method }));
    assert.equal(response.status, 401, `${method} ${path}`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('public reads and public favorite lookups remain available', async () => {
  assert.equal((await onRequest(context('/api/read-later'))).status, 200);
  assert.equal((await onRequest(context('/api/read-later', {method:'POST',body:'{}'}))).status, 200);
  assert.equal((await onRequest(context('/api/public/favorites/state', { method: 'POST', body: '{}' }))).status, 200);
});

test('cross-site writes and streamed oversized requests are rejected', async () => {
  assert.equal((await onRequest(context('/api/share', { method: 'POST', headers: { origin: 'https://evil.example' } }))).status, 403);
  assert.equal((await onRequest(context('/api/share', { method: 'POST', headers: { 'sec-fetch-site': 'cross-site' } }))).status, 403);
  assert.equal((await onRequest(context('/api/public/favorites/state', { method: 'POST', body: 'x'.repeat(256 * 1024 + 1) }))).status, 413);
});

test('internal deployment files are never served by middleware', async () => {
  for (const path of ['/notes/push-test-runbook.md', '/.env.1password', '/.git/config', '/tests/security.test.js', '/package-lock.json', '/workers/read-later-sync/index.js']) {
    assert.equal((await onRequest(context(path))).status, 404, path);
  }
});

test('security headers preserve stricter policies and cache semantics', () => {
  const response = secure(new Response('private', { headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'" } }));
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('content-security-policy'), "default-src 'none'");
});

test('reader sanitization strips active content and unsafe URL schemes', () => {
  const html = sanitizeContent('<p onclick="alert(1)">Text</p><script>alert(1)</script><svg onload="alert(1)"></svg><a href="javascript:alert(1)">link</a><img src="data:text/html,x" onerror="alert(1)"><iframe srcdoc="x"></iframe>', 'https://example.com');
  assert.doesNotMatch(html, /script|onclick|onerror|onload|javascript:|data:|iframe|svg/);
  assert.match(html, /Text/);
});

test('shared feed metadata cannot create executable platform links', () => {
  const html = renderSharePage({ id: 'safe', type: 'podcast', title: 'Test', platforms: { website: { url: 'javascript:alert(1)' } } }, 'https://jeffharr.is/share/safe');
  assert.doesNotMatch(html, /href="javascript:/);
});

test('external URL validation rejects private, encoded IP and credentialed URLs', () => {
  for (const url of ['http://localhost/a', 'http://127.1', 'http://2130706433', 'http://0x7f000001', 'http://169.254.169.254/', 'http://[::1]', 'http://[::ffff:127.0.0.1]', 'http://foo.local', 'http://foo.internal', 'https://user:pass@example.com', 'file:///etc/passwd', 'https://example.com:22']) {
    assert.throws(() => publicUrl(url), undefined, url);
  }
  assert.equal(publicUrl('https://example.com/path').hostname, 'example.com');
});

test('redirect targets are validated before being fetched', async () => {
  let calls = 0;
  await assert.rejects(publicFetch('https://example.com', {}, { fetchImpl: async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/' } });
  }}), /public HTTP/);
  assert.equal(calls, 1);
});

test('credentials do not follow redirects across origins', async () => {
  const response = await publicFetch('https://example.com', { headers: { authorization: 'Bearer test', cookie: 'test=value' } }, { fetchImpl: async (url, options) => {
    if (url === 'https://example.com/') return new Response(null, { status: 302, headers: { location: 'https://other.example/' } });
    assert.equal(options.headers.has('authorization'), false);
    assert.equal(options.headers.has('cookie'), false);
    return new Response('ok');
  }});
  assert.equal(await response.text(), 'ok');
});

test('response limits apply to streamed bytes without Content-Length', async () => {
  await assert.rejects(publicFetch('https://example.com', {}, { maxBytes: 2, fetchImpl: async () => new Response('oversized') }), /too large/);
});

test('timeouts apply while reading a stalled response body', async () => {
  await assert.rejects(publicFetch('https://example.com', {}, { timeoutMs: 20, fetchImpl: async () => new Response(new ReadableStream({ start() {} })) }), /timed out/);
});

test('Access authentication verifies signed JWTs, cookies, audience, expiry, and owner', async t => {
  const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const jwk = { ...await crypto.subtle.exportKey('jwk', keys.publicKey), kid: 'audit-key' };
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ keys: [jwk] });
  t.after(() => { globalThis.fetch = original; });
  const env = { CLOUDFLARE_ACCESS_TEAM_DOMAIN: 'audit.cloudflareaccess.com', ADMIN_ACCESS_AUD: 'owner', ADMIN_ALLOWED_EMAILS: 'owner@example.com' };
  const sign = async (override = {}) => {
    const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'RS256', kid: 'audit-key' })}.${encode({ iss: 'https://audit.cloudflareaccess.com', aud: 'owner', exp: Math.floor(Date.now() / 1000) + 300, email: 'owner@example.com', ...override })}`;
    return `${input}.${Buffer.from(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(input))).toString('base64url')}`;
  };
  const token = await sign();
  const signedContext = context('/api/read-later', { method: 'POST', headers: { cookie: `CF_Authorization=${token}` }, body: '{"url":"https://example.com"}' }, env);
  const response = await onRequest(signedContext);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '{"url":"https://example.com"}');
  for (const override of [{ aud: 'other' }, { exp: 1 }, { exp: '9999999999' }, { nbf: 9999999999 }, { email: 'stranger@example.com' }, { iss: 'https://other.cloudflareaccess.com' }]) {
    assert.equal(await getAdminUser(new Request('https://jeffharr.is', { headers: { authorization: `Bearer ${await sign(override)}` } }), env), null);
  }
  assert.equal(await getAdminUser(new Request('https://jeffharr.is', { headers: { cookie: 'CF_Authorization=%ZZ' } }), env), null);
  const [header, payload, signature] = token.split('.');
  const forgedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), name: 'forged' })).toString('base64url');
  assert.equal(await getAdminUser(new Request('https://jeffharr.is', { headers: { authorization: `Bearer ${header}.${forgedPayload}.${signature}` } }), env), null);
});
