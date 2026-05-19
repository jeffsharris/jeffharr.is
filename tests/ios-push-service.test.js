import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { createInitialPushChannels } from '../functions/api/read-later/article-push-service.js';
import { processIosPushBatch } from '../functions/api/push/ios-push-service.js';
import { upsertPushDevice } from '../functions/api/push/device-store.js';
import { createMockPushDb, listPushDeviceRows } from './mock-push-db.js';
import { createMockReadLaterRepository } from './mock-read-later-repository.js';

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
  const db = createMockPushDb();
  const ownerId = 'owner-1';
  const item = buildReadyItem('item-ios-1', 'event-1');
  const repository = createMockReadLaterRepository({ items: { [item.id]: item } });

  await upsertPushDevice({
    db,
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
    READ_LATER_REPOSITORY: repository,
    CONTENT_DB: db,
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

  assert.equal(listPushDeviceRows(db).length, 0);

  const updatedItem = await repository.getItem(item.id);
  assert.equal(updatedItem.pushChannels.ios.status, 'skipped');
  assert.equal(updatedItem.pushChannels.ios.lastError, 'No valid registered iOS devices');
});

test('ios push worker drops stale event messages without sending', async (t) => {
  const db = createMockPushDb();
  const ownerId = 'owner-1';
  const item = buildReadyItem('item-ios-2', 'event-current');
  const repository = createMockReadLaterRepository({ items: { [item.id]: item } });

  await upsertPushDevice({
    db,
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
      READ_LATER_REPOSITORY: repository,
      CONTENT_DB: db,
      PUSH_DEFAULT_OWNER_ID: ownerId,
      APNS_TEAM_ID: 'TEAM123456',
      APNS_KEY_ID: 'ABC123DEFG',
      APNS_PRIVATE_KEY_P8: createApnsPrivateKeyPem(),
      APNS_TOPIC: 'com.jeffharris.sukha'
    },
    null
  );

  assert.equal(fetchCallCount, 0);
  const storedItem = await repository.getItem(item.id);
  assert.equal(storedItem.pushChannels.ios.eventId, 'event-current');
  assert.equal(storedItem.pushChannels.ios.status, 'queued');
});

test('ios push worker processes queued test push message without item lookup', async (t) => {
  const db = createMockPushDb();
  const ownerId = 'owner-1';

  await upsertPushDevice({
    db,
    ownerId,
    deviceId: 'device-3',
    token: 'token-3',
    platform: 'ios',
    environment: 'development',
    bundleId: 'com.jeffharris.sukha',
    appVersion: '1.0',
    buildNumber: '100'
  });

  let fetchCallCount = 0;
  let apnsBody = null;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (_url, init) => {
    fetchCallCount += 1;
    apnsBody = JSON.parse(init?.body || '{}');
    return new Response(null, { status: 200 });
  };

  await processIosPushBatch(
    {
      messages: [
        {
          body: JSON.stringify({
            type: 'push.notification.test',
            source: 'push-test',
            ownerId,
            itemId: 'does-not-exist',
            eventId: 'test-event-1',
            alertTitle: 'Test',
            alertSubtitle: 'Sukha',
            alertBody: 'Hello',
            notification: {
              media: [
                {
                  type: 'image',
                  url: 'https://example.com/cover.jpg'
                }
              ]
            },
            data: {
              route: 'read-later'
            }
          })
        }
      ]
    },
    {
      CONTENT_DB: db,
      PUSH_DEFAULT_OWNER_ID: ownerId,
      APNS_TEAM_ID: 'TEAM123456',
      APNS_KEY_ID: 'ABC123DEFG',
      APNS_PRIVATE_KEY_P8: createApnsPrivateKeyPem(),
      APNS_TOPIC: 'com.jeffharris.sukha'
    },
    null
  );

  assert.equal(fetchCallCount, 1);
  assert.equal(apnsBody.aps['mutable-content'], 1);
  assert.equal(Array.isArray(apnsBody.notification.media), true);
  assert.equal(apnsBody.notification.media[0].url, 'https://example.com/cover.jpg');
  assert.equal(apnsBody.media, undefined);
  assert.equal(apnsBody.data.route, 'read-later');
});
