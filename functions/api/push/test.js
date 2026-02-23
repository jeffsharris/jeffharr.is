import { createLogger, formatError } from '../lib/logger.js';
import { getOwnerId, normalizeDeviceId, normalizeMetadataValue } from './device-store.js';

const DEFAULT_ALERT_TITLE = 'Sukha Test Push';
const DEFAULT_ALERT_SUBTITLE = 'Sukha';
const ALLOWED_INTERRUPTION_LEVELS = new Set(['passive', 'active', 'time-sensitive', 'critical']);
const ALLOWED_MEDIA_TYPES = new Set(['image', 'gif', 'video', 'audio', 'file']);

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

function normalizeRelevanceScore(value) {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;
  if (numeric < 0 || numeric > 1) return null;
  return Number(numeric.toFixed(3));
}

function normalizeInterruptionLevel(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return ALLOWED_INTERRUPTION_LEVELS.has(normalized) ? normalized : null;
}

function normalizeBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
    return null;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1') return true;
    if (normalized === 'false' || normalized === '0') return false;
  }
  return null;
}

function normalizeObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function normalizeMediaList(value) {
  if (!Array.isArray(value)) return [];

  const normalized = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const url = normalizeOptionalUrl(entry.url || entry.href);
    if (!url) continue;
    const typeRaw = normalizeText(entry.type, 32);
    const type = typeRaw ? typeRaw.toLowerCase() : 'image';
    normalized.push({
      type: ALLOWED_MEDIA_TYPES.has(type) ? type : 'image',
      url,
      mimeType: normalizeText(entry.mimeType, 120) || null,
      filename: normalizeText(entry.filename, 120) || null
    });
    if (normalized.length >= 3) break;
  }

  return normalized;
}

function normalizeDataPayload(value) {
  const obj = normalizeObject(value);
  if (!obj) return null;
  try {
    return JSON.parse(JSON.stringify(obj));
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

  const itemId = normalizeText(payload?.itemId, 200) || `test-item-${Date.now()}`;
  const notification = normalizeObject(payload?.notification) || {};
  const notificationAlert = normalizeObject(notification?.alert);
  const notificationMedia = normalizeMediaList(notification?.media);
  const data = normalizeDataPayload(payload?.data);

  const resolvedAlertTitle = normalizeText(notificationAlert?.title, 120) || DEFAULT_ALERT_TITLE;
  const resolvedAlertSubtitle = normalizeText(notificationAlert?.subtitle, 120) || DEFAULT_ALERT_SUBTITLE;
  const resolvedAlertBody = normalizeText(notificationAlert?.body, 240) || `Triggered at ${now}`;
  const resolvedThreadId = normalizeText(notification?.threadId, 120);
  const resolvedCategory = normalizeText(notification?.category, 120);
  const resolvedTargetContentId = normalizeText(notification?.targetContentId, 120);
  const resolvedInterruptionLevel = normalizeInterruptionLevel(notification?.interruptionLevel);
  const resolvedRelevanceScore = normalizeRelevanceScore(notification?.relevanceScore);
  const resolvedMutableContent = normalizeBoolean(notification?.mutableContent);
  const resolvedMedia = notificationMedia;

  try {
    await queue.send(JSON.stringify({
      ownerId,
      type: 'push.notification.test',
      source: 'push-test',
      itemId,
      savedAt: now,
      eventId,
      notification: {
        alert: {
          title: resolvedAlertTitle,
          subtitle: resolvedAlertSubtitle,
          body: resolvedAlertBody
        },
        threadId: resolvedThreadId,
        category: resolvedCategory,
        targetContentId: resolvedTargetContentId,
        interruptionLevel: resolvedInterruptionLevel,
        relevanceScore: resolvedRelevanceScore,
        mutableContent: resolvedMutableContent,
        media: resolvedMedia
      },
      data,
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
