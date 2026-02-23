import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { onRequest } from '../functions/api/push/test.js';
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

async function decodeJson(response) {
  return JSON.parse(await response.text());
}

test('push-test endpoint requires API key', async () => {
  const kv = createMockKv();
  const request = new Request('https://example.com/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await onRequest({
    request,
    env: {
      READ_LATER: kv,
      PUSH_TEST_API_KEY: 'secret-key'
    }
  });

  assert.equal(response.status, 401);
  const payload = await decodeJson(response);
  assert.equal(payload.ok, false);
});

test('push-test endpoint sends APNS push for registered device', async (t) => {
  const kv = createMockKv();
  await upsertPushDevice({
    kv,
    ownerId: 'default',
    deviceId: 'device-1',
    token: 'token-1',
    platform: 'ios',
    environment: 'development',
    bundleId: 'com.jeffharris.sukha',
    appVersion: '1.0',
    buildNumber: '100'
  });

  let fetchCount = 0;
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url) => {
    fetchCount += 1;
    assert.match(String(url), /api\.sandbox\.push\.apple\.com/);
    return new Response(null, { status: 200 });
  };

  const request = new Request('https://example.com/api/push/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-push-test-key': 'secret-key'
    },
    body: JSON.stringify({
      title: 'Test Title',
      subtitle: 'Test Subtitle',
      body: 'Test Body',
      deviceId: 'device-1'
    })
  });

  const response = await onRequest({
    request,
    env: {
      READ_LATER: kv,
      PUSH_TEST_API_KEY: 'secret-key',
      PUSH_DEFAULT_OWNER_ID: 'default',
      APNS_TEAM_ID: 'TEAM123456',
      APNS_KEY_ID: 'ABC123DEFG',
      APNS_PRIVATE_KEY_P8: createApnsPrivateKeyPem(),
      APNS_TOPIC: 'com.jeffharris.sukha'
    }
  });

  assert.equal(response.status, 200);
  const payload = await decodeJson(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.reason, 'sent');
  assert.equal(fetchCount, 1);
});
