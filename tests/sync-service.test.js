import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueKindleSync } from '../functions/api/read-later/sync-service.js';
import { createMockReadLaterStores } from './mock-read-later-stores.js';

test('enqueueKindleSync marks item pending and enqueues first attempt', async () => {
  const { readLaterStore } = createMockReadLaterStores();
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

  const result = await enqueueKindleSync({ item, readLaterStore, env, reason: 'save' });
  assert.equal(result.queued, true);
  assert.equal(item.kindle.status, 'pending');
  assert.equal(item.kindle.attempt, 0);
  assert.equal(item.kindle.maxAttempts, 3);

  const stored = await readLaterStore.getItem('item-1');
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
  const { readLaterStore } = createMockReadLaterStores();
  const item = {
    id: 'item-2',
    url: 'https://example.com/post',
    title: 'Missing Queue'
  };

  const result = await enqueueKindleSync({ item, readLaterStore, env: {} });
  assert.equal(result.queued, false);
  assert.equal(result.queueMissing, true);
  assert.equal(item.kindle.status, 'failed');
  assert.equal(item.kindle.errorCode, 'sync_queue_unavailable');

  const stored = await readLaterStore.getItem('item-2');
  assert.equal(stored.kindle.status, 'failed');
  assert.equal(stored.kindle.errorCode, 'sync_queue_unavailable');
});

test('enqueueKindleSync skips already-synced items that have covers', async () => {
  const { readLaterStore, itemStore } = createMockReadLaterStores();
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

  const result = await enqueueKindleSync({ item, readLaterStore, env });
  assert.equal(result.skipped, true);
  assert.equal(sendCount, 0);
  assert.equal(itemStore.size, 0);
});


test('enqueueKindleSync does not skip non-YouTube unsupported items', async () => {
  const { readLaterStore } = createMockReadLaterStores();
  let sendCount = 0;
  const env = {
    READ_LATER_SYNC_QUEUE: {
      async send() {
        sendCount += 1;
      }
    }
  };
  const item = {
    id: 'item-4',
    url: 'https://x.com/user/status/123',
    title: 'X post',
    kindle: {
      status: 'unsupported'
    }
  };

  const result = await enqueueKindleSync({ item, readLaterStore, env });
  assert.equal(result.queued, true);
  assert.equal(sendCount, 1);
});
