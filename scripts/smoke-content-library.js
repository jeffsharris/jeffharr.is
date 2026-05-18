#!/usr/bin/env node

import { spawnSync } from 'node:child_process';

import { onRequest as readLaterRequest } from '../functions/api/read-later.js';
import { onRequest as readLaterReaderRequest } from '../functions/api/read-later/reader.js';
import { onRequest as readLaterCoverRequest } from '../functions/api/read-later/cover.js';
import { onRequest as readLaterProgressRequest } from '../functions/api/read-later/progress.js';
import { onRequest as regenerateCoverRequest } from '../functions/api/read-later/regenerate-cover.js';
import { onRequest as listsRequest } from '../functions/api/lists.js';
import { onRequest as listDetailRequest } from '../functions/api/lists/[slug].js';
import { onRequest as shareHistoryRequest } from '../functions/api/share/history.js';
import { onRequest as sharePageRequest } from '../functions/share/[id].js';
import readLaterSyncWorker from '../workers/read-later-sync/index.js';
import pushDeliveryWorker from '../workers/push-delivery/index.js';
import { createContentLibraryKvAdapter } from '../functions/api/content-library/kv-adapter.js';

const args = new Set(process.argv.slice(2));
const allowWrites = args.has('--write');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
const DATABASE_ID = process.env.CONTENT_LIBRARY_DATABASE_ID || 'efe5518b-5617-4ee8-992a-5c84f4cfe900';
const R2_BUCKET = process.env.CONTENT_ASSETS_BUCKET || 'jeffharr-is-content-assets';

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

if (!allowWrites) {
  console.error('This smoke test writes temporary D1 rows. Rerun with --write to allow cleanup-safe writes.');
  process.exit(1);
}

const createdItemIds = new Set();
const checks = [];

async function main() {
  const db = new RestD1Database();
  const bucket = new WranglerR2Bucket();
  const fallbackKv = new MemoryKv();
  const env = {
    CONTENT_DB: db,
    CONTENT_ASSETS: bucket,
    READ_LATER: fallbackKv,
    CONTENT_LIBRARY_READ_LATER: '1',
    CONTENT_LIBRARY_SHARE: '1',
    CONTENT_LIBRARY_SYNC_ENABLED: '1',
    READ_LATER_SYNC_QUEUE: new MemoryQueue(),
    PUSH_DELIVERY_QUEUE: new MemoryQueue()
  };

  await smokeReadViews(env, db);
  await smokeShareViews(env, db);
  await smokeSaveFlows(env, db);
  await smokeWorkers(env, db);
  await cleanup(db);

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

async function smokeReadViews(env, db) {
  const baseline = await db.prepare(
    `SELECT COUNT(*) AS count FROM list_entries WHERE list_id = 'lst_read_later'`
  ).first();
  const sample = await db.prepare(
    `SELECT le.id AS entry_id
     FROM list_entries le
     WHERE le.list_id = 'lst_read_later'
       AND EXISTS (SELECT 1 FROM assets a WHERE a.item_id = le.item_id AND a.role = 'reader_html')
       AND EXISTS (SELECT 1 FROM assets a WHERE a.item_id = le.item_id AND a.role = 'generated_cover')
     LIMIT 1`
  ).first();
  assert(sample?.entry_id, 'found read-later sample with reader and cover');

  const listResponse = await readLaterRequest(context({
    method: 'GET',
    url: 'https://jeffharr.is/api/read-later',
    env
  }));
  const listPayload = await json(listResponse);
  assert(listResponse.status === 200, 'read-later GET returned 200');
  assert(listPayload.count === baseline.count, 'read-later GET count matches D1 baseline');

  const readerResponse = await readLaterReaderRequest(context({
    method: 'GET',
    url: `https://jeffharr.is/api/read-later/reader?id=${encodeURIComponent(sample.entry_id)}`,
    env
  }));
  const readerPayload = await json(readerResponse);
  assert(readerResponse.status === 200 && readerPayload.ok === true, 'reader endpoint reads migrated R2 reader asset');
  assert(Boolean(readerPayload.reader?.contentHtml), 'reader endpoint returns contentHtml');

  const coverResponse = await readLaterCoverRequest(context({
    method: 'GET',
    url: `https://jeffharr.is/api/read-later/cover?id=${encodeURIComponent(sample.entry_id)}`,
    env
  }));
  assert(coverResponse.status === 200, 'cover endpoint returns migrated cover image');
  assert((await coverResponse.arrayBuffer()).byteLength > 0, 'cover endpoint returns non-empty bytes');

  const listsResponse = await listsRequest(context({
    method: 'GET',
    url: 'https://jeffharr.is/api/lists',
    env
  }));
  const listsPayload = await json(listsResponse);
  assert(listsPayload.count >= 2, 'lists endpoint returns system lists');
  assert(listsPayload.lists.some((list) => list.slug === 'read-later'), 'lists endpoint includes read-later');
  assert(listsPayload.lists.some((list) => list.slug === 'starred'), 'lists endpoint includes starred');

  const listDetailResponse = await listDetailRequest(context({
    method: 'GET',
    url: 'https://jeffharr.is/api/lists/read-later?limit=5',
    env,
    params: { slug: 'read-later' }
  }));
  const listDetailPayload = await json(listDetailResponse);
  assert(listDetailResponse.status === 200, 'read-later list detail returned 200');
  assert(listDetailPayload.count > 0, 'read-later list detail returns entries');
}

async function smokeShareViews(env, db) {
  const share = await db.prepare(
    `SELECT share_slug FROM share_details ORDER BY updated_at DESC LIMIT 1`
  ).first();
  assert(share?.share_slug, 'found migrated share');

  const historyResponse = await shareHistoryRequest(context({
    method: 'GET',
    url: 'https://jeffharr.is/api/share/history?limit=100',
    env
  }));
  const historyPayload = await json(historyResponse);
  assert(historyResponse.status === 200, 'share history endpoint returned 200');
  assert(historyPayload.count === 23, 'share history count matches migrated events');

  const pageResponse = await sharePageRequest(context({
    method: 'GET',
    url: `https://jeffharr.is/share/${share.share_slug}`,
    env,
    params: { id: share.share_slug }
  }));
  const html = await pageResponse.text();
  assert(pageResponse.status === 200, 'share page renders from D1');
  assert(html.includes('<html') || html.includes('<!doctype html>'), 'share page returns HTML');
}

async function smokeSaveFlows(env, db) {
  const queue = new MemoryQueue();
  const saveEnv = { ...env, READ_LATER_SYNC_QUEUE: queue };
  const url = `https://example.com/content-library-cutover-${Date.now()}`;
  const saveResponse = await readLaterRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later',
    env: saveEnv,
    body: { url, title: 'Content Library Cutover Smoke' }
  }));
  const savePayload = await json(saveResponse);
  assert(saveResponse.status === 201, 'read-later save returned 201');
  assert(savePayload.ok === true && savePayload.item?.id, 'read-later save returns item');
  assert(queue.messages.length === 1, 'read-later save enqueues Kindle sync through D1 adapter');
  createdItemIds.add(savePayload.item.itemId);

  const progressResponse = await readLaterProgressRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later/progress',
    env,
    body: {
      id: savePayload.item.id,
      scrollTop: 120,
      scrollRatio: 0.42,
      updatedAt: new Date().toISOString()
    }
  }));
  const progressPayload = await json(progressResponse);
  assert(progressResponse.status === 200 && progressPayload.ok === true, 'progress endpoint updates D1 read state');

  const streamQueue = new MemoryQueue();
  const streamResponse = await readLaterRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later?stream=1',
    env: { ...env, READ_LATER_SYNC_QUEUE: streamQueue },
    headers: { accept: 'text/event-stream' },
    body: {
      url: `${url}-stream`,
      title: 'Content Library Stream Smoke'
    }
  }));
  const streamText = await streamResponse.text();
  assert(streamResponse.status === 200, 'stream save returned 200');
  assert(streamText.includes('event: saved') && streamText.includes('event: done'), 'stream save emits saved and done events');
  assert(streamQueue.messages.length === 1, 'stream save enqueues sync through D1 adapter');

  const streamEntry = await db.prepare(
    `SELECT i.id AS item_id
     FROM list_entries le
     JOIN items i ON i.id = le.item_id
     WHERE i.canonical_url = ?`
  ).bind(`${url}-stream`).first();
  if (streamEntry?.item_id) createdItemIds.add(streamEntry.item_id);
}

async function smokeWorkers(env, db) {
  const kindleQueue = new MemoryQueue();
  const kindleEnv = { ...env, READ_LATER_SYNC_QUEUE: kindleQueue };
  const youtubeResponse = await readLaterRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later',
    env: kindleEnv,
    body: {
      url: `https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=${Date.now()}`,
      title: 'Content Library Kindle Worker Smoke'
    }
  }));
  const youtubePayload = await json(youtubeResponse);
  createdItemIds.add(youtubePayload.item.itemId);
  assert(kindleQueue.messages.length === 1, 'Kindle worker smoke item enqueued');
  await readLaterSyncWorker.queue({ messages: kindleQueue.messages }, kindleEnv);
  const kindleState = await readState(db, youtubePayload.item.id);
  assert(kindleState?.kindle?.status === 'unsupported', 'read-later sync worker updates D1 Kindle state');

  const coverQueue = new MemoryQueue();
  const coverEnv = { ...env, READ_LATER_SYNC_QUEUE: coverQueue, OPENAI_API_KEY: '' };
  const coverSaveResponse = await readLaterRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later',
    env: { ...coverEnv, CONTENT_LIBRARY_SYNC_ENABLED: '0' },
    body: {
      url: `https://example.com/content-library-cover-worker-${Date.now()}`,
      title: 'Content Library Cover Worker Smoke'
    }
  }));
  const coverSavePayload = await json(coverSaveResponse);
  createdItemIds.add(coverSavePayload.item.itemId);
  const regenResponse = await regenerateCoverRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later/regenerate-cover',
    env: coverEnv,
    body: { id: coverSavePayload.item.id }
  }));
  assert(regenResponse.status === 202, 'cover regenerate endpoint enqueues cover job');
  assert(coverQueue.messages.length === 1, 'cover worker smoke item enqueued');
  await readLaterSyncWorker.queue({ messages: coverQueue.messages }, coverEnv);
  const coverState = await readState(db, coverSavePayload.item.id);
  assert(coverState?.coverSync?.status === 'failed', 'cover worker writes D1 failure state when OpenAI key is absent');
  assert(coverState?.coverSync?.errorCode === 'cover_api_key_missing', 'cover worker records expected missing-key error');

  const pushEnv = {
    ...env,
    READ_LATER: new MemoryKv(),
    CONTENT_LIBRARY_SYNC_ENABLED: '1'
  };
  const adapter = createContentLibraryKvAdapter(pushEnv);
  const pushSaveResponse = await readLaterRequest(context({
    method: 'POST',
    url: 'https://jeffharr.is/api/read-later',
    env: { ...pushEnv, READ_LATER_SYNC_QUEUE: new MemoryQueue(), CONTENT_LIBRARY_SYNC_ENABLED: '0' },
    body: {
      url: `https://example.com/content-library-ios-worker-${Date.now()}`,
      title: 'Content Library iOS Worker Smoke'
    }
  }));
  const pushSavePayload = await json(pushSaveResponse);
  createdItemIds.add(pushSavePayload.item.itemId);
  const eventId = `smoke_${Date.now()}`;
  const itemForPush = {
    ...pushSavePayload.item,
    pushChannels: {
      readiness: { status: 'ready', readyAt: new Date().toISOString(), reason: null },
      kindle: { status: 'sent', updatedAt: new Date().toISOString(), lastError: null },
      ios: { status: 'queued', updatedAt: new Date().toISOString(), eventId, lastError: null }
    }
  };
  await adapter.put(`item:${itemForPush.id}`, JSON.stringify(itemForPush));
  await pushDeliveryWorker.queue({
    messages: [toQueueMessage({
      type: 'push.notification.requested',
      ownerId: 'smoke',
      itemId: itemForPush.id,
      eventId,
      notification: { alert: { title: 'Smoke', body: 'Smoke' } },
      data: { itemId: itemForPush.id }
    })]
  }, pushEnv);
  const pushState = await readState(db, itemForPush.id);
  assert(pushState?.pushChannels?.ios?.status === 'skipped', 'push delivery worker updates D1 iOS state with no devices');
}

async function cleanup(db = new RestD1Database()) {
  for (const itemId of createdItemIds) {
    if (itemId) {
      await db.prepare(`DELETE FROM items WHERE id = ?`).bind(itemId).run();
    }
  }
  createdItemIds.clear();
}

async function readState(db, entryId) {
  const row = await db.prepare(
    `SELECT kindle_json, cover_sync_json, push_channels_json FROM read_state WHERE entry_id = ?`
  ).bind(entryId).first();
  return {
    kindle: parseJson(row?.kindle_json),
    coverSync: parseJson(row?.cover_sync_json),
    pushChannels: parseJson(row?.push_channels_json)
  };
}

function context({ method, url, env, params = {}, body = null, headers = {} }) {
  return {
    request: new Request(url, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    }),
    env,
    params
  };
}

async function json(response) {
  return response.json();
}

function toQueueMessage(body) {
  return {
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function assert(condition, label) {
  if (!condition) throw new Error(`Smoke check failed: ${label}`);
  checks.push(label);
}

function parseJson(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

class RestD1Database {
  prepare(sql) {
    return new RestD1Prepared(this, sql);
  }

  async batch(statements) {
    return Promise.all(statements.map((statement) => statement.run()));
  }

  async execute(sql, params = []) {
    const data = await cfFetch(`/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
      method: 'POST',
      body: JSON.stringify({ sql, params })
    });
    const result = data.result?.[0];
    if (!result?.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(data.errors || result || data)}`);
    }
    return result;
  }
}

class RestD1Prepared {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new RestD1Prepared(this.db, this.sql, params);
  }

  async all() {
    const result = await this.db.execute(this.sql, this.params);
    return {
      results: result.results || [],
      success: true,
      meta: result.meta || {}
    };
  }

  async first() {
    const result = await this.all();
    return result.results[0] || null;
  }

  async run() {
    const result = await this.db.execute(this.sql, this.params);
    return {
      success: true,
      meta: result.meta || {}
    };
  }
}

class WranglerR2Bucket {
  async get(key) {
    const result = spawnSync('wrangler', ['r2', 'object', 'get', `${R2_BUCKET}/${key}`, '--remote', '--pipe'], {
      encoding: null,
      maxBuffer: 25 * 1024 * 1024
    });
    if (result.status !== 0) return null;
    const bytes = result.stdout || Buffer.alloc(0);
    return {
      httpMetadata: { contentType: inferContentType(key) },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
      async json() {
        return JSON.parse(bytes.toString('utf8'));
      }
    };
  }

  async put() {
    throw new Error('Smoke R2 put is not implemented');
  }

  async delete() {
    throw new Error('Smoke R2 delete is not implemented');
  }
}

class MemoryQueue {
  constructor() {
    this.messages = [];
  }

  async send(body) {
    this.messages.push({ body });
  }
}

class MemoryKv {
  constructor() {
    this.values = new Map();
  }

  async get(key, options = {}) {
    const value = this.values.get(key) || null;
    if (options.type === 'json') return parseJson(value);
    return value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }

  async delete(key) {
    this.values.delete(key);
  }

  async list({ prefix = '' } = {}) {
    return {
      keys: [...this.values.keys()]
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true
    };
  }
}

async function cfFetch(pathname, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(async () => ({ success: false, errors: [{ message: await response.text() }] }));
  if (!response.ok || data.success === false) {
    throw new Error(`${response.status} ${JSON.stringify(data.errors || data)}`);
  }
  return data;
}

function inferContentType(key) {
  if (key.endsWith('.json')) return 'application/json; charset=utf-8';
  if (key.endsWith('.jpg') || key.endsWith('.jpeg')) return 'image/jpeg';
  if (key.endsWith('.webp')) return 'image/webp';
  return 'image/png';
}

main().catch(async (error) => {
  await cleanup().catch(() => {});
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
