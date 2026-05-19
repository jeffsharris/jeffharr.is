import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/push/test.js';
import { createMockPushDb } from './mock-push-db.js';

async function decodeJson(response) {
  return JSON.parse(await response.text());
}

test('push-test endpoint requires API key', async () => {
  const request = new Request('https://example.com/api/push/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });

  const response = await onRequest({
    request,
    env: {
      CONTENT_DB: createMockPushDb(),
      PUSH_TEST_API_KEY: 'secret-key'
    }
  });

  assert.equal(response.status, 401);
  const payload = await decodeJson(response);
  assert.equal(payload.ok, false);
});

test('push-test endpoint enqueues test push', async () => {
  let queuedPayload = null;
  const queue = {
    async send(body) {
      queuedPayload = JSON.parse(body);
    }
  };

  const request = new Request('https://example.com/api/push/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-push-test-key': 'secret-key'
    },
    body: JSON.stringify({
      notification: {
        alert: {
          title: 'Test Title',
          subtitle: 'Test Subtitle',
          body: 'Test Body'
        },
        media: [
          {
            type: 'image',
            url: 'https://example.com/cover.jpg'
          }
        ],
        threadId: 'read-later',
        interruptionLevel: 'time-sensitive',
        relevanceScore: 0.75,
        mutableContent: true
      },
      data: {
        route: 'read-later',
        itemId: 'abc123'
      },
      deviceId: 'device-1'
    })
  });

  const response = await onRequest({
    request,
    env: {
      CONTENT_DB: createMockPushDb(),
      PUSH_TEST_API_KEY: 'secret-key',
      PUSH_DEFAULT_OWNER_ID: 'default',
      PUSH_DELIVERY_QUEUE: queue
    }
  });

  assert.equal(response.status, 200);
  const payload = await decodeJson(response);
  assert.equal(payload.ok, true);
  assert.equal(payload.queued, true);
  assert.equal(queuedPayload.type, 'push.notification.test');
  assert.equal(queuedPayload.targetDeviceId, 'device-1');
  assert.equal(queuedPayload.notification.alert.title, 'Test Title');
  assert.equal(queuedPayload.notification.threadId, 'read-later');
  assert.equal(queuedPayload.notification.interruptionLevel, 'time-sensitive');
  assert.equal(queuedPayload.notification.relevanceScore, 0.75);
  assert.equal(queuedPayload.notification.mutableContent, true);
  assert.equal(queuedPayload.notification.media[0].url, 'https://example.com/cover.jpg');
  assert.equal(queuedPayload.data.route, 'read-later');
});

test('push-test endpoint fails when queue binding is missing', async () => {
  const request = new Request('https://example.com/api/push/test', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-push-test-key': 'secret-key'
    },
    body: JSON.stringify({})
  });

  const response = await onRequest({
    request,
    env: {
      CONTENT_DB: createMockPushDb(),
      PUSH_TEST_API_KEY: 'secret-key'
    }
  });

  assert.equal(response.status, 500);
  const payload = await decodeJson(response);
  assert.equal(payload.ok, false);
  assert.equal(payload.error, 'Push queue unavailable');
});
