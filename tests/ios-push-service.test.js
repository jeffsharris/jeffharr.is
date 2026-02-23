import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createInitialPushChannels } from '../functions/api/read-later/article-push-service.js';
import { processIosPushBatch } from '../functions/api/push/ios-push-service.js';
import { upsertPushDevice } from '../functions/api/push/device-store.js';

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

function createApnsPrivateKeyPem() {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

function buildReadyItem(id, eventId) {
  const pushChannels = createInitialPushChannels('2026-02-22T00:00:00.000Z');
  pushChannels.readiness = {
    status: 'ready',
    readyAt: '2026-02-22T00:01:00.000Z',
    reason: null
  };
  pushChannels.ios = {
    status: 'queued',
    updatedAt: '2026-02-22T00:01:00.000Z',
    eventId,
    lastError: null
  };

  return {
    id,
    url: 'https://example.com/article',
    title: 'Example Article',
    savedAt: '2026-02-22T00:00:00.000Z',
    cover: {
      updatedAt: '2026-02-22T00:01:00.000Z'
    },
    pushChannels
  };
}

function buildMessage(item, ownerId, eventId) {
  return {
    body: JSON.stringify({
      type: 'push.notification.requested',
      source: 'read-later',
      ownerId,
      itemId: item.id,
      eventId,
      savedAt: item.savedAt,
      title: item.title,
      domain: 'example.com',
      coverURL: 'https://example.com/cover.jpg'
    })
  };
}

test('ios push prunes invalid APNs token and marks item as skipped', async (t) => {
  const kv = createMockKv();
  const ownerId = 'owner-1';
  const item = buildReadyItem('item-ios-1', 'event-1');
  await kv.put(`item:${item.id}`, JSON.stringify(item));

  await upsertPushDevice({
    kv,
    ownerId,
    deviceId: 'device-1',
    token: 'token-1',
    platform: 'ios',
    environment: 'development',
    bundleId: 'com.jeffharris.sukha',
    appVersion: '1.0',
    buildNumber: '100'
  });

  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => new Response(
    JSON.stringify({ reason: 'Unregistered' }),
    {
      status: 410,
      headers: {
        'Content-Type': 'application/json'
      }
    }
  );

  const env = {
    READ_LATER: kv,
    PUSH_DEFAULT_OWNER_ID: ownerId,
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID: 'ABC123DEFG',
    APNS_PRIVATE_KEY_P8: createApnsPrivateKeyPem(),
    APNS_TOPIC: 'com.jeffharris.sukha'
  };

  await processIosPushBatch(
    { messages: [buildMessage(item, ownerId, 'event-1')] },
    env,
    null
  );

  const device = await kv.get(`push_device:${ownerId}:device-1`, { type: 'json' });
  assert.equal(device, null);

  const tokenEntries = Array.from(kv.store.keys()).filter((key) => key.startsWith('push_token:'));
  assert.equal(tokenEntries.length, 0);

  const updatedItem = await kv.get(`item:${item.id}`, { type: 'json' });
  assert.equal(updatedItem.pushChannels.ios.status, 'skipped');
  assert.equal(updatedItem.pushChannels.ios.lastError, 'No valid registered iOS devices');
});

test('ios push worker drops stale event messages without sending', async (t) => {
  const kv = createMockKv();
  const ownerId = 'owner-1';
  const item = buildReadyItem('item-ios-2', 'event-current');
  await kv.put(`item:${item.id}`, JSON.stringify(item));

  await upsertPushDevice({
    kv,
    ownerId,
    deviceId: 'device-2',
    token: 'token-2',
    platform: 'ios',
    environment: 'development',
    bundleId: 'com.jeffharris.sukha',
    appVersion: '1.0',
    buildNumber: '100'
  });

  let fetchCallCount = 0;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async () => {
    fetchCallCount += 1;
    return new Response(null, { status: 200 });
  };

  await processIosPushBatch(
    { messages: [buildMessage(item, ownerId, 'event-old')] },
    {
      READ_LATER: kv,
      PUSH_DEFAULT_OWNER_ID: ownerId,
      APNS_TEAM_ID: 'TEAM123456',
      APNS_KEY_ID: 'ABC123DEFG',
      APNS_PRIVATE_KEY_P8: createApnsPrivateKeyPem(),
      APNS_TOPIC: 'com.jeffharris.sukha'
    },
    null
  );

  assert.equal(fetchCallCount, 0);
  const storedItem = await kv.get(`item:${item.id}`, { type: 'json' });
  assert.equal(storedItem.pushChannels.ios.eventId, 'event-current');
  assert.equal(storedItem.pushChannels.ios.status, 'queued');
});
