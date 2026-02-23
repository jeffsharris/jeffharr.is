import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialPushChannels,
  maybeQueueIosPush,
  recordKindleChannelState,
  updateArticlePushReadiness
} from '../functions/api/read-later/article-push-service.js';

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
    },
    async delete(key) {
      store.delete(key);
    },
    async list({ prefix = '' } = {}) {
      const keys = [];
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) {
          keys.push({ name: key });
        }
      }
      return {
        keys,
        list_complete: true,
        cursor: null
      };
    }
  };
}

function buildReaderHtml(wordCount = 65) {
  const words = Array.from({ length: wordCount }, (_, index) => `word${index}`).join(' ');
  return `<article><p>${words}</p></article>`;
}

test('article push readiness stays pending until both reader and cover are ready', async () => {
  const item = {
    id: 'item-1',
    url: 'https://example.com/a',
    title: 'Example A',
    savedAt: '2026-02-22T00:00:00.000Z',
    pushChannels: createInitialPushChannels('2026-02-22T00:00:00.000Z')
  };

  const kv = createMockKv({
    'item:item-1': JSON.stringify(item),
    'reader:item-1': JSON.stringify({
      title: 'Example A',
      byline: 'Author',
      excerpt: 'Excerpt',
      siteName: 'Example',
      wordCount: 200,
      contentHtml: buildReaderHtml(),
      retrievedAt: '2026-02-22T00:00:01.000Z'
    })
  });

  const first = await updateArticlePushReadiness('item-1', kv, null);
  assert.equal(first.ready, false);
  assert.equal(first.readerReady, true);
  assert.equal(first.coverReady, false);
  assert.equal(first.reason, 'waiting_for_cover');

  const stored = await kv.get('item:item-1', { type: 'json' });
  stored.cover = { updatedAt: '2026-02-22T00:02:00.000Z' };
  await kv.put('item:item-1', JSON.stringify(stored));

  const second = await updateArticlePushReadiness('item-1', kv, null);
  assert.equal(second.ready, true);
  assert.equal(second.reason, null);
  assert.equal(second.item.pushChannels.readiness.status, 'ready');
  assert.equal(Boolean(second.item.pushChannels.readiness.readyAt), true);
});

test('maybeQueueIosPush enqueues exactly once after readiness is ready', async () => {
  const sent = [];
  const env = {
    PUSH_DEFAULT_OWNER_ID: 'owner-1',
    PUSH_DELIVERY_QUEUE: {
      async send(body) {
        sent.push(JSON.parse(body));
      }
    }
  };

  const item = {
    id: 'item-2',
    url: 'https://example.com/b',
    title: 'Example B',
    savedAt: '2026-02-22T00:00:00.000Z',
    cover: { updatedAt: '2026-02-22T00:01:00.000Z' },
    pushChannels: {
      readiness: {
        status: 'ready',
        readyAt: '2026-02-22T00:01:00.000Z',
        reason: null
      },
      kindle: {
        status: 'pending',
        updatedAt: '2026-02-22T00:00:00.000Z',
        lastError: null
      },
      ios: {
        status: 'pending',
        updatedAt: '2026-02-22T00:00:00.000Z',
        eventId: null,
        lastError: null
      }
    }
  };

  const kv = createMockKv({
    'item:item-2': JSON.stringify(item)
  });

  const first = await maybeQueueIosPush({ item, env, kv, log: null, source: 'test' });
  assert.equal(first.queued, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'push.notification.requested');
  assert.equal(sent[0].source, 'read-later');
  assert.equal(sent[0].itemId, 'item-2');
  assert.equal(sent[0].notification.alert.title, 'Saved to Read Later');
  assert.equal(sent[0].notification.alert.subtitle, 'example.com');
  assert.equal(sent[0].notification.alert.body, 'Example B');
  assert.equal(sent[0].notification.threadId, 'read-later');
  assert.equal(sent[0].notification.category, 'read-later');
  assert.equal(Array.isArray(sent[0].notification.media), true);
  assert.equal(sent[0].notification.media.length, 1);
  assert.equal(sent[0].notification.media[0].type, 'image');
  assert.equal(sent[0].notification.media[0].url.includes('/api/read-later/cover'), true);
  assert.equal(sent[0].data.channel, 'read-later');
  assert.equal(sent[0].data.itemId, 'item-2');

  const second = await maybeQueueIosPush({ item: first.item, env, kv, log: null, source: 'test' });
  assert.equal(second.queued, false);
  assert.equal(second.reason, 'already_queued_or_sent');
  assert.equal(sent.length, 1);
});

test('recordKindleChannelState mirrors kindle sync outcomes', async () => {
  const item = {
    id: 'item-kindle',
    pushChannels: createInitialPushChannels('2026-02-22T00:00:00.000Z')
  };

  recordKindleChannelState(item, { status: 'synced' }, '2026-02-22T00:00:10.000Z');
  assert.equal(item.pushChannels.kindle.status, 'sent');
  assert.equal(item.pushChannels.kindle.lastError, null);

  recordKindleChannelState(item, { status: 'failed', lastError: 'SMTP timeout' }, '2026-02-22T00:00:20.000Z');
  assert.equal(item.pushChannels.kindle.status, 'failed');
  assert.equal(item.pushChannels.kindle.lastError, 'SMTP timeout');

  recordKindleChannelState(item, { status: 'unsupported' }, '2026-02-22T00:00:30.000Z');
  assert.equal(item.pushChannels.kindle.status, 'skipped');
  assert.equal(item.pushChannels.kindle.lastError, null);
});
