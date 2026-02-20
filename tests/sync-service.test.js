import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueKindleSync } from '../functions/api/read-later/sync-service.js';

function createMockKv(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key, options = {}) {
      const value = store.get(key);
      if (value == null) return null;
      if (options.type === 'json') {
        return JSON.parse(value);
      }
      return value;
    },
    async put(key, value) {
      store.set(key, value);
    }
  };
}

test('enqueueKindleSync marks item pending and enqueues first attempt', async () => {
  const kv = createMockKv();
  const sent = [];
  const env = {
    READ_LATER_SYNC_QUEUE: {
      async send(body, options) {
        sent.push({ body, options });
      }
    }
  };

  const item = {
    id: 'item-1',
    url: 'https://example.com/post',
    title: 'Example Post'
  };

  const result = await enqueueKindleSync({ item, kv, env, reason: 'save' });
  assert.equal(result.queued, true);
  assert.equal(item.kindle.status, 'pending');
  assert.equal(item.kindle.attempt, 0);
  assert.equal(item.kindle.maxAttempts, 3);

  const stored = await kv.get('item:item-1', { type: 'json' });
  assert.equal(stored.kindle.status, 'pending');

  assert.equal(sent.length, 1);
  const message = JSON.parse(sent[0].body);
  assert.equal(message.itemId, 'item-1');
  assert.equal(message.attempt, 1);
  assert.equal(message.maxAttempts, 3);
  assert.equal(typeof message.syncVersion, 'string');
  assert.equal(Boolean(message.syncVersion), true);
});

test('enqueueKindleSync persists terminal failed state when queue binding is missing', async () => {
  const kv = createMockKv();
  const item = {
    id: 'item-2',
    url: 'https://example.com/post',
    title: 'Missing Queue'
  };

  const result = await enqueueKindleSync({ item, kv, env: {} });
  assert.equal(result.queued, false);
  assert.equal(result.queueMissing, true);
  assert.equal(item.kindle.status, 'failed');
  assert.equal(item.kindle.errorCode, 'sync_queue_unavailable');

  const stored = await kv.get('item:item-2', { type: 'json' });
  assert.equal(stored.kindle.status, 'failed');
  assert.equal(stored.kindle.errorCode, 'sync_queue_unavailable');
});

test('enqueueKindleSync skips already-synced items that have covers', async () => {
  const kv = createMockKv();
  let sendCount = 0;
  const env = {
    READ_LATER_SYNC_QUEUE: {
      async send() {
        sendCount += 1;
      }
    }
  };
  const item = {
    id: 'item-3',
    url: 'https://example.com/post',
    title: 'Already synced',
    cover: { updatedAt: '2026-02-20T00:00:00.000Z' },
    kindle: {
      status: 'synced'
    }
  };

  const result = await enqueueKindleSync({ item, kv, env });
  assert.equal(result.skipped, true);
  assert.equal(sendCount, 0);
  assert.equal(kv.store.size, 0);
});
