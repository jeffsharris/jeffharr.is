import { createLogger, formatError } from '../lib/logger.js';
import { getOwnerId, normalizeDeviceId, normalizeMetadataValue } from './device-store.js';

const DEFAULT_ALERT_TITLE = 'Sukha Test Push';
const DEFAULT_ALERT_SUBTITLE = 'Sukha';

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store'
    }
  });
}

function generateEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `test_${crypto.randomUUID()}`;
  }
  return `test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeText(value, maxLength) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeOptionalUrl(value) {
  const candidate = normalizeText(value, 2048);
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function readApiKey(request) {
  const direct = request.headers.get('x-push-test-key');
  if (direct && direct.trim()) return direct.trim();

  const auth = request.headers.get('authorization');
  if (!auth) return '';
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export async function onRequest(context) {
  const { request, env } = context;
  const logger = createLogger({ request, source: 'push-test-api' });
  const log = logger.log;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405 }
    );
  }

  const kv = env?.READ_LATER;
  if (!kv) {
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500 }
    );
  }

  const configuredKey = typeof env?.PUSH_TEST_API_KEY === 'string' ? env.PUSH_TEST_API_KEY.trim() : '';
  if (!configuredKey) {
    return jsonResponse(
      { ok: false, error: 'Test push is not configured' },
      { status: 503 }
    );
  }

  const providedKey = readApiKey(request);
  if (!providedKey || providedKey !== configuredKey) {
    return jsonResponse(
      { ok: false, error: 'Unauthorized' },
      { status: 401 }
    );
  }

  const payload = await parseJson(request);
  const ownerId = normalizeMetadataValue(payload?.ownerId, 120) || getOwnerId(env);
  const deviceId = normalizeDeviceId(payload?.deviceId);
  const now = new Date().toISOString();
  const eventId = generateEventId();
  const queue = env?.PUSH_DELIVERY_QUEUE || null;

  if (!queue) {
    return jsonResponse(
      { ok: false, error: 'Push queue unavailable' },
      { status: 500 }
    );
  }

  const alertTitle = normalizeText(payload?.title, 120) || DEFAULT_ALERT_TITLE;
  const alertSubtitle = normalizeText(payload?.subtitle, 120) || DEFAULT_ALERT_SUBTITLE;
  const alertBody = normalizeText(payload?.body, 240) || `Triggered at ${now}`;
  const itemId = normalizeText(payload?.itemId, 200) || `test-item-${Date.now()}`;

  try {
    await queue.send(JSON.stringify({
      ownerId,
      type: 'push.notification.test',
      source: 'push-test',
      itemId,
      savedAt: now,
      eventId,
      coverURL: normalizeOptionalUrl(payload?.coverURL),
      alertTitle,
      alertSubtitle,
      alertBody,
      targetDeviceId: deviceId || null
    }));

    log('info', 'ios_test_push_queued', {
      stage: 'test_push',
      ownerId,
      eventId,
      itemId,
      targetDeviceId: deviceId || null
    });

    return jsonResponse({
      ok: true,
      queued: true,
      ownerId,
      itemId,
      targetDeviceId: deviceId || null,
      eventId
    });
  } catch (error) {
    log('error', 'ios_test_push_queue_failed', {
      stage: 'test_push',
      ownerId,
      eventId,
      targetDeviceId: deviceId || null,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Failed to queue test push' },
      { status: 500 }
    );
  }
}
