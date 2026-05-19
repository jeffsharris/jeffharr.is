import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/push/devices.js';
import { createMockPushDb, listPushDeviceRows } from './mock-push-db.js';

async function decodeJson(response) {
  return JSON.parse(await response.text());
}

test('push-device register and unregister flow', async () => {
  const db = createMockPushDb();

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
      CONTENT_DB: db,
      PUSH_DEFAULT_OWNER_ID: 'owner-1'
    }
  });

  assert.equal(registerResponse.status, 200);
  const registerPayload = await decodeJson(registerResponse);
  assert.equal(registerPayload.ok, true);
  assert.equal(registerPayload.registered, true);

  const deviceRows = listPushDeviceRows(db);
  assert.equal(deviceRows.length, 1);
  assert.equal(deviceRows[0].owner_id, 'owner-1');
  assert.equal(deviceRows[0].device_id, 'device-1');

  const unregisterRequest = new Request('https://example.com/api/push/devices', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ deviceId: 'device-1' })
  });

  const unregisterResponse = await onRequest({
    request: unregisterRequest,
    env: {
      CONTENT_DB: db,
      PUSH_DEFAULT_OWNER_ID: 'owner-1'
    }
  });

  assert.equal(unregisterResponse.status, 200);
  const unregisterPayload = await decodeJson(unregisterResponse);
  assert.equal(unregisterPayload.ok, true);
  assert.equal(unregisterPayload.removed, true);

  assert.equal(listPushDeviceRows(db).length, 0);
});

test('push-device rebind moves token between device ids', async () => {
  const db = createMockPushDb();

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

  await onRequest({ request: firstRegister, env: { CONTENT_DB: db } });

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

  await onRequest({ request: secondRegister, env: { CONTENT_DB: db } });

  const rows = listPushDeviceRows(db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].device_id, 'device-b');
});
