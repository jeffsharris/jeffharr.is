import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/push/devices.js';

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

async function decodeJson(response) {
  return JSON.parse(await response.text());
}

test('push-device register and unregister flow', async () => {
  const kv = createMockKv();

  const registerRequest = new Request('https://example.com/api/push/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'device-1',
      token: 'token-value-1',
      platform: 'ios',
      environment: 'development',
      bundleId: 'com.jeffharris.sukha',
      appVersion: '1.0',
      buildNumber: '10'
    })
  });

  const registerResponse = await onRequest({
    request: registerRequest,
    env: {
      READ_LATER: kv,
      PUSH_DEFAULT_OWNER_ID: 'owner-1'
    }
  });

  assert.equal(registerResponse.status, 200);
  const registerPayload = await decodeJson(registerResponse);
  assert.equal(registerPayload.ok, true);
  assert.equal(registerPayload.registered, true);

  const deviceEntries = Array.from(kv.store.keys()).filter((key) => key.startsWith('push_device:owner-1:'));
  const tokenEntries = Array.from(kv.store.keys()).filter((key) => key.startsWith('push_token:'));
  assert.equal(deviceEntries.length, 1);
  assert.equal(tokenEntries.length, 1);

  const unregisterRequest = new Request('https://example.com/api/push/devices', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-1' })
  });

  const unregisterResponse = await onRequest({
    request: unregisterRequest,
    env: {
      READ_LATER: kv,
      PUSH_DEFAULT_OWNER_ID: 'owner-1'
    }
  });

  assert.equal(unregisterResponse.status, 200);
  const unregisterPayload = await decodeJson(unregisterResponse);
  assert.equal(unregisterPayload.ok, true);
  assert.equal(unregisterPayload.removed, true);

  const remainingEntries = Array.from(kv.store.keys()).filter((key) => key.startsWith('push_'));
  assert.equal(remainingEntries.length, 0);
});

test('push-device rebind moves token between device ids', async () => {
  const kv = createMockKv();

  const firstRegister = new Request('https://example.com/api/push/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'device-a',
      token: 'same-token',
      platform: 'ios',
      environment: 'production'
    })
  });

  await onRequest({ request: firstRegister, env: { READ_LATER: kv } });

  const secondRegister = new Request('https://example.com/api/push/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      deviceId: 'device-b',
      token: 'same-token',
      platform: 'ios',
      environment: 'production'
    })
  });

  await onRequest({ request: secondRegister, env: { READ_LATER: kv } });

  const deviceA = await kv.get('push_device:default:device-a', { type: 'json' });
  const deviceB = await kv.get('push_device:default:device-b', { type: 'json' });
  assert.equal(deviceA, null);
  assert.equal(deviceB?.deviceId, 'device-b');
});
