import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COVER_MESSAGE_TYPE,
  enqueueCoverGeneration
} from '../functions/api/read-later/cover-sync-service.js';

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

test('enqueueCoverGeneration marks item pending and enqueues first attempt', async () => {
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
    id: 'cover-item-1',
    url: 'https://example.com/article',
    title: 'Example article'
  };

  const result = await enqueueCoverGeneration({ item, kv, env });
  assert.equal(result.queued, true);
  assert.equal(item.coverSync.status, 'pending');
  assert.equal(item.coverSync.attempt, 0);
  assert.equal(item.coverSync.maxAttempts, 2);

  const stored = await kv.get('item:cover-item-1', { type: 'json' });
  assert.equal(stored.coverSync.status, 'pending');

  assert.equal(sent.length, 1);
  const message = JSON.parse(sent[0].body);
  assert.equal(message.type, COVER_MESSAGE_TYPE);
  assert.equal(message.itemId, 'cover-item-1');
  assert.equal(message.attempt, 1);
  assert.equal(message.maxAttempts, 2);
  assert.equal(typeof message.jobId, 'string');
  assert.equal(Boolean(message.jobId), true);
});

test('enqueueCoverGeneration persists failed state when queue binding is missing', async () => {
  const kv = createMockKv();
  const item = {
    id: 'cover-item-2',
    url: 'https://example.com/article',
    title: 'Missing queue'
  };

  const result = await enqueueCoverGeneration({ item, kv, env: {} });
  assert.equal(result.queued, false);
  assert.equal(result.queueMissing, true);
  assert.equal(item.coverSync.status, 'failed');
  assert.equal(item.coverSync.errorCode, 'cover_queue_unavailable');

  const stored = await kv.get('item:cover-item-2', { type: 'json' });
  assert.equal(stored.coverSync.status, 'failed');
  assert.equal(stored.coverSync.errorCode, 'cover_queue_unavailable');
});

test('enqueueCoverGeneration does not enqueue while a job is already active', async () => {
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
    id: 'cover-item-3',
    url: 'https://example.com/article',
    title: 'Already running',
    coverSync: {
      status: 'processing',
      jobId: 'job-running'
    }
  };

  const result = await enqueueCoverGeneration({ item, kv, env });
  assert.equal(result.queued, false);
  assert.equal(result.inProgress, true);
  assert.equal(sendCount, 0);
  assert.equal(kv.store.size, 0);
});

test('enqueueCoverGeneration requeues stale active jobs', async () => {
  const kv = createMockKv();
  let sendCount = 0;
  const env = {
    READ_LATER_SYNC_QUEUE: {
      async send() {
        sendCount += 1;
      }
    }
  };

  const staleUpdatedAt = new Date(Date.now() - (6 * 60 * 1000)).toISOString();
  const item = {
    id: 'cover-item-stale',
    url: 'https://example.com/article',
    title: 'Stale active job',
    coverSync: {
      status: 'pending',
      jobId: 'job-stale',
      updatedAt: staleUpdatedAt
    }
  };

  const result = await enqueueCoverGeneration({ item, kv, env });
  assert.equal(result.queued, true);
  assert.equal(sendCount, 1);

  const stored = await kv.get('item:cover-item-stale', { type: 'json' });
  assert.equal(stored.coverSync.status, 'pending');
  assert.notEqual(stored.coverSync.jobId, 'job-stale');
});

test('enqueueCoverGeneration requeues when cover metadata exists but image payload is missing', async () => {
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
    id: 'cover-item-4',
    url: 'https://example.com/article',
    title: 'Metadata-only cover',
    cover: {
      updatedAt: '2026-02-21T00:00:00.000Z'
    }
  };

  const result = await enqueueCoverGeneration({ item, kv, env });
  assert.equal(result.queued, true);
  assert.equal(sent.length, 1);
});

test('enqueueCoverGeneration skips when cover image payload exists in KV', async () => {
  const kv = createMockKv({
    'cover:cover-item-5': JSON.stringify({
      base64: 'Zm9v',
      contentType: 'image/png',
      createdAt: '2026-02-21T00:00:00.000Z'
    })
  });
  let sendCount = 0;
  const env = {
    READ_LATER_SYNC_QUEUE: {
      async send() {
        sendCount += 1;
      }
    }
  };

  const item = {
    id: 'cover-item-5',
    url: 'https://example.com/article',
    title: 'Has cover bytes',
    cover: {
      updatedAt: '2026-02-21T00:00:00.000Z'
    }
  };

  const result = await enqueueCoverGeneration({ item, kv, env });
  assert.equal(result.queued, false);
  assert.equal(result.coverExists, true);
  assert.equal(sendCount, 0);
});
