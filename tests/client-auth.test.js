import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { onRequest as native } from '../functions/api/auth/native.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { getLibraryUser, hashCredential, randomCredential } from '../functions/api/lib/client-auth.js';
import { allowPublicSave } from '../functions/api/lib/public-save.js';
import { saveReadLaterItem, updateReadLaterRead } from '../functions/api/content-library/read-later-store.js';
import { ensureSystemLists } from '../functions/api/content-library/db.js';

function database(t) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../migrations/0001_content_library.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0005_client_credentials.sql', import.meta.url), 'utf8'));
  sqlite.exec(readFileSync(new URL('../migrations/0006_public_save_limits.sql', import.meta.url), 'utf8'));
  t.after(() => sqlite.close());
  return {batch: statements => Promise.all(statements.map(statement => statement.run())),prepare(sql) {
    const statement = sqlite.prepare(sql);
    return {bind(...args) {return {first: async () => statement.get(...args) || null, all:async()=>({results:statement.all(...args)}),run: async () => statement.run(...args)};}};
  }};
}

test('public duplicate saves cannot change titles or unarchive items', async t => {
  const db = database(t);
  await ensureSystemLists(db);
  const original = await saveReadLaterItem(db,{url:'https://example.com/article',title:'Original title'});
  assert.equal(original.ok,true);
  await updateReadLaterRead(db,{id:original.item.id,read:true});
  const duplicate = await saveReadLaterItem(db,{url:'https://example.com/article',title:'Untrusted replacement'}, {allowDuplicateChanges:false});
  assert.equal(duplicate.duplicate,true);
  assert.equal(duplicate.item.read,true);
  assert.equal(duplicate.item.title,'Original title');
  assert.equal(duplicate.unarchived,false);
});

test('native codes require PKCE, expire, and can only be redeemed once', async t => {
  const db = database(t);
  const code = randomCredential();
  const verifier = randomCredential();
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT INTO client_authorization_codes VALUES (?, ?, ?, ?)')
    .bind(await hashCredential(code), await hashCredential(verifier), 'owner@example.com', now + 120).run();
  const exchange = (value, proof) => native({env:{CONTENT_DB:db},request:new Request('https://jeffharr.is/api/auth/native?action=exchange', {
    method:'POST',body:JSON.stringify({code:value,verifier:proof})
  })});
  assert.equal((await exchange(code, randomCredential())).status,401);
  const response = await exchange(code,verifier);
  assert.equal(response.status,200);
  const credential = await response.json();
  assert.match(credential.token,/^sukha_[\w-]{43}$/);
  assert.ok(credential.expiresAt > now);
  assert.equal((await exchange(code,verifier)).status,401);
  const row = await db.prepare('SELECT token_hash FROM client_credentials').bind().first();
  assert.notEqual(row.token_hash,credential.token);
  assert.equal(row.token_hash,await hashCredential(credential.token));
  await db.prepare('INSERT INTO client_authorization_codes VALUES (?, ?, ?, ?)')
    .bind(await hashCredential(code),await hashCredential(verifier),'owner@example.com',now - 1).run();
  assert.equal((await exchange(code,verifier)).status,401);
});

test('public saving is limited both per IP and across all anonymous callers', async t => {
  const env = {CONTENT_DB:database(t)};
  const request = ip => new Request('https://jeffharr.is/api/read-later',{headers:{'cf-connecting-ip':ip}});
  for (let i=0;i<10;i++) assert.equal(await allowPublicSave(request('192.0.2.1'),env),true);
  assert.equal(await allowPublicSave(request('192.0.2.1'),env),false);
  for (let i=0;i<20;i++) assert.equal(await allowPublicSave(request(`192.0.2.${i+2}`),env),true);
  assert.equal(await allowPublicSave(request('198.51.100.1'),env),false);
});

test('native credentials are scoped, expire, and are revoked on disconnect', async t => {
  const db = database(t);
  const token = `sukha_${randomCredential()}`;
  const now = Math.floor(Date.now() / 1000);
  await db.prepare('INSERT INTO client_credentials VALUES (?, ?, ?, ?, ?)')
    .bind(await hashCredential(token),'owner@example.com','sukha',now,now + 60).run();
  const env = {CONTENT_DB:db, ADMIN_ALLOWED_EMAILS:'owner@example.com'};
  const request = path => new Request(`https://jeffharr.is${path}`,{method:'DELETE',headers:{authorization:`Bearer ${token}`}});
  assert.ok(await getLibraryUser(request('/api/read-later'),env));
  assert.equal(await getLibraryUser(request('/api/favorites'),env),null);
  assert.equal((await middleware({request:request('/api/read-later'),env,next:async()=>new Response('ok')})).status,200);
  assert.equal((await middleware({request:request('/api/admin/session'),env,next:async()=>new Response('ok')})).status,401);
  assert.equal((await native({request:request('/api/auth/native'),env})).status,200);
  assert.equal(await getLibraryUser(request('/api/read-later'),env),null);
  await db.prepare('INSERT INTO client_credentials VALUES (?, ?, ?, ?, ?)')
    .bind(await hashCredential(token),'owner@example.com','sukha',now - 120,now - 1).run();
  assert.equal(await getLibraryUser(request('/api/read-later'),env),null);
});

test('native authorization requires existing owner sign-in and never accepts arbitrary redirects', async t => {
  const response = await native({env:{CONTENT_DB:database(t)},request:new Request('https://jeffharr.is/api/auth/native?redirect_uri=https://evil.example')});
  assert.equal(response.status,302);
  assert.equal(new URL(response.headers.get('location')).origin,'https://jeffharr.is');
  assert.equal(new URL(response.headers.get('location')).pathname,'/api/admin/session');
});
