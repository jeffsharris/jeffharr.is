import { formatError } from '../lib/logger.js';
import { PUSH_NOTIFICATION_MESSAGE_TYPE, ensurePushChannels } from '../read-later/article-push-service.js';
import { getOwnerId, listPushDevicesForOwner, removePushDeviceByRecord } from './device-store.js';

const KV_ITEM_PREFIX = 'item:';
const APNS_PRODUCTION_HOST = 'api.push.apple.com';
const APNS_SANDBOX_HOST = 'api.sandbox.push.apple.com';
const APNS_TOKEN_TTL_SECONDS = 50 * 60;
const ALLOWED_INTERRUPTION_LEVELS = new Set(['passive', 'active', 'time-sensitive', 'critical']);
const ALLOWED_MEDIA_TYPES = new Set(['image', 'gif', 'video', 'audio', 'file']);
const TERMINAL_TOKEN_REASONS = new Set([
  'BadDeviceToken',
  'Unregistered',
  'DeviceTokenNotForTopic',
  'TopicDisallowed',
  'BadTopic'
]);

let cachedImportedKey = null;
let cachedImportedPem = null;
let cachedAuthToken = null;
let cachedAuthTokenTeam = null;
let cachedAuthTokenKeyId = null;
let cachedAuthTokenIssuedAt = 0;

function getNowIso() {
  return new Date().toISOString();
}

function nowEpochSeconds() {
  return Math.floor(Date.now() / 1000);
}

function base64UrlEncode(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    bytes = input;
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    bytes = new Uint8Array(input || []);
  }

  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function readDerLength(bytes, offset) {
  if (offset >= bytes.length) {
    throw new Error('Invalid DER signature');
  }

  const first = bytes[offset];
  if ((first & 0x80) === 0) {
    return {
      length: first,
      nextOffset: offset + 1
    };
  }

  const lengthBytes = first & 0x7f;
  if (lengthBytes < 1 || lengthBytes > 4) {
    throw new Error('Invalid DER signature length');
  }

  if (offset + 1 + lengthBytes > bytes.length) {
    throw new Error('Invalid DER signature length bytes');
  }

  let length = 0;
  for (let index = 0; index < lengthBytes; index += 1) {
    length = (length << 8) | bytes[offset + 1 + index];
  }

  return {
    length,
    nextOffset: offset + 1 + lengthBytes
  };
}

function normalizeDerInteger(bytes, targetLength) {
  let start = 0;
  while (start < bytes.length - 1 && bytes[start] === 0) {
    start += 1;
  }

  const trimmed = bytes.slice(start);
  if (trimmed.length > targetLength) {
    throw new Error('Invalid ECDSA signature integer length');
  }

  const normalized = new Uint8Array(targetLength);
  normalized.set(trimmed, targetLength - trimmed.length);
  return normalized;
}

function derToJoseSignature(derBytes, outputLength = 64) {
  if (!(derBytes instanceof Uint8Array) || derBytes.length === 0) {
    throw new Error('Invalid DER signature');
  }

  let offset = 0;
  if (derBytes[offset] !== 0x30) {
    throw new Error('Invalid DER signature sequence');
  }
  offset += 1;

  const sequence = readDerLength(derBytes, offset);
  offset = sequence.nextOffset;
  const sequenceEnd = offset + sequence.length;
  if (sequenceEnd > derBytes.length) {
    throw new Error('Invalid DER signature sequence length');
  }

  if (derBytes[offset] !== 0x02) {
    throw new Error('Invalid DER signature r marker');
  }
  offset += 1;
  const rLength = readDerLength(derBytes, offset);
  offset = rLength.nextOffset;
  const rEnd = offset + rLength.length;
  if (rEnd > sequenceEnd) {
    throw new Error('Invalid DER signature r length');
  }
  const r = derBytes.slice(offset, rEnd);
  offset = rEnd;

  if (derBytes[offset] !== 0x02) {
    throw new Error('Invalid DER signature s marker');
  }
  offset += 1;
  const sLength = readDerLength(derBytes, offset);
  offset = sLength.nextOffset;
  const sEnd = offset + sLength.length;
  if (sEnd > sequenceEnd) {
    throw new Error('Invalid DER signature s length');
  }
  const s = derBytes.slice(offset, sEnd);

  const coordinateLength = outputLength / 2;
  const normalizedR = normalizeDerInteger(r, coordinateLength);
  const normalizedS = normalizeDerInteger(s, coordinateLength);

  const jose = new Uint8Array(outputLength);
  jose.set(normalizedR, 0);
  jose.set(normalizedS, coordinateLength);
  return jose;
}

function pemToBytes(pem) {
  if (typeof pem !== 'string') {
    throw new Error('APNS private key is missing');
  }

  const sanitized = pem
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');

  if (!sanitized) {
    throw new Error('APNS private key is invalid');
  }

  return decodeBase64ToBytes(sanitized);
}

async function importPrivateKey(pem) {
  if (cachedImportedKey && cachedImportedPem === pem) {
    return cachedImportedKey;
  }

  const keyData = pemToBytes(pem);
  const imported = await crypto.subtle.importKey(
    'pkcs8',
    keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );

  cachedImportedPem = pem;
  cachedImportedKey = imported;
  return imported;
}

async function createApnsAuthToken({ teamId, keyId, privateKeyPem }) {
  const issuedAt = nowEpochSeconds();
  const header = base64UrlEncode(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64UrlEncode(JSON.stringify({ iss: teamId, iat: issuedAt }));
  const unsigned = `${header}.${claims}`;

  const privateKey = await importPrivateKey(privateKeyPem);
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(unsigned)
  );
  const signatureBytes = new Uint8Array(signature);
  const joseSignature = signatureBytes.length === 64
    ? signatureBytes
    : derToJoseSignature(signatureBytes);

  return {
    token: `${unsigned}.${base64UrlEncode(joseSignature)}`,
    issuedAt
  };
}

async function getApnsAuthToken(env) {
  const teamId = typeof env?.APNS_TEAM_ID === 'string' ? env.APNS_TEAM_ID.trim() : '';
  const keyId = typeof env?.APNS_KEY_ID === 'string' ? env.APNS_KEY_ID.trim() : '';
  const privateKeyPemRaw = typeof env?.APNS_PRIVATE_KEY_P8 === 'string' ? env.APNS_PRIVATE_KEY_P8 : '';
  const privateKeyPem = privateKeyPemRaw.replace(/\\n/g, '\n').trim();

  if (!teamId || !keyId || !privateKeyPem) {
    throw new Error('APNS credentials are not fully configured');
  }

  const currentEpoch = nowEpochSeconds();
  const isCachedValid = (
    cachedAuthToken &&
    cachedAuthTokenTeam === teamId &&
    cachedAuthTokenKeyId === keyId &&
    currentEpoch - cachedAuthTokenIssuedAt < APNS_TOKEN_TTL_SECONDS
  );

  if (isCachedValid) {
    return cachedAuthToken;
  }

  const signed = await createApnsAuthToken({ teamId, keyId, privateKeyPem });
  cachedAuthToken = signed.token;
  cachedAuthTokenTeam = teamId;
  cachedAuthTokenKeyId = keyId;
  cachedAuthTokenIssuedAt = signed.issuedAt;
  return cachedAuthToken;
}

function parseQueueMessageBody(message) {
  if (!message) return null;

  if (typeof message.body === 'string') {
    try {
      return JSON.parse(message.body);
    } catch {
      return null;
    }
  }

  if (message.body && typeof message.body === 'object') {
    return message.body;
  }

  return null;
}

function getApnsHost(environment) {
  return environment === 'development' ? APNS_SANDBOX_HOST : APNS_PRODUCTION_HOST;
}

function getApnsTopic(env, device) {
  const configured = typeof env?.APNS_TOPIC === 'string' ? env.APNS_TOPIC.trim() : '';
  if (configured) return configured;
  if (typeof device?.bundleId === 'string' && device.bundleId.trim()) return device.bundleId.trim();
  return 'com.jeffharris.sukha';
}

function normalizeApsString(value, maxLength = 120) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function normalizeApsInterruptionLevel(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return ALLOWED_INTERRUPTION_LEVELS.has(normalized) ? normalized : null;
}

function normalizeApsRelevanceScore(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return Number(value.toFixed(3));
}

function normalizeMutableContent(value) {
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

function normalizePayloadObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value;
}

function normalizeMediaList(value) {
  if (!Array.isArray(value)) return [];

  const output = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const url = normalizeApsString(entry.url || entry.href, 2048);
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) continue;
      const type = normalizeApsString(entry.type, 32)?.toLowerCase() || 'image';
      output.push({
        type: ALLOWED_MEDIA_TYPES.has(type) ? type : 'image',
        url: parsed.toString(),
        mimeType: normalizeApsString(entry.mimeType, 120) || null,
        filename: normalizeApsString(entry.filename, 120) || null
      });
    } catch {
      continue;
    }
    if (output.length >= 3) break;
  }

  return output;
}

function normalizeDataPayload(value) {
  const obj = normalizePayloadObject(value);
  if (!obj) return null;
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch {
    return null;
  }
}

function buildApnsPayload(payload) {
  const notification = normalizePayloadObject(payload?.notification);
  const alert = normalizePayloadObject(notification?.alert);
  const alertTitle = normalizeApsString(alert?.title, 120)
    || 'Sukha';
  const alertSubtitle = normalizeApsString(alert?.subtitle, 120)
    || 'Notification';
  const alertBody = normalizeApsString(alert?.body, 240)
    || 'Open Sukha';

  const media = normalizeMediaList(notification?.media);

  const threadId = normalizeApsString(notification?.threadId, 120);
  const category = normalizeApsString(notification?.category, 120);
  const targetContentId = normalizeApsString(notification?.targetContentId, 120);
  const interruptionLevel = normalizeApsInterruptionLevel(notification?.interruptionLevel);
  const relevanceScore = normalizeApsRelevanceScore(notification?.relevanceScore);
  const mutableContentOverride = normalizeMutableContent(notification?.mutableContent);
  const mutableContent = mutableContentOverride === null
    ? media.length > 0
    : mutableContentOverride;
  const data = normalizeDataPayload(payload?.data);

  return {
    aps: {
      alert: {
        title: alertTitle,
        subtitle: alertSubtitle,
        body: alertBody
      },
      sound: 'default',
      'thread-id': threadId || undefined,
      category: category || undefined,
      'target-content-id': targetContentId || undefined,
      'interruption-level': interruptionLevel || undefined,
      'relevance-score': relevanceScore ?? undefined,
      'mutable-content': mutableContent ? 1 : undefined
    },
    type: payload?.type || PUSH_NOTIFICATION_MESSAGE_TYPE,
    source: payload?.source || 'read-later',
    itemId: payload?.itemId || null,
    savedAt: payload?.savedAt || null,
    eventId: payload?.eventId || null,
    notification: {
      alert: {
        title: alertTitle,
        subtitle: alertSubtitle,
        body: alertBody
      },
      threadId: threadId || null,
      category: category || null,
      targetContentId: targetContentId || null,
      interruptionLevel: interruptionLevel || null,
      relevanceScore: relevanceScore ?? null,
      mutableContent,
      media
    },
    data
  };
}

async function sendApnsNotification({ env, authToken, device, payload }) {
  const host = getApnsHost(device?.environment);
  const topic = getApnsTopic(env, device);
  const endpoint = `https://${host}/3/device/${device.token}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `bearer ${authToken}`,
      'apns-topic': topic,
      'apns-push-type': 'alert',
      'apns-priority': '10'
    },
    body: JSON.stringify(buildApnsPayload(payload))
  });

  let reason = null;
  if (!response.ok) {
    try {
      const responsePayload = await response.json();
      reason = typeof responsePayload?.reason === 'string' ? responsePayload.reason : null;
    } catch {
      reason = null;
    }
  }

  return {
    ok: response.ok,
    status: response.status,
    reason
  };
}

async function saveItem(kv, item) {
  await kv.put(`${KV_ITEM_PREFIX}${item.id}`, JSON.stringify(item));
}

function isCurrentEvent(item, eventId) {
  const currentEventId = item?.pushChannels?.ios?.eventId;
  if (!currentEventId) return true;
  if (!eventId) return false;
  return currentEventId === eventId;
}

async function updateIosChannel(kv, item, { status, eventId, lastError }) {
  const now = getNowIso();
  ensurePushChannels(item, now);
  item.pushChannels.ios = {
    ...item.pushChannels.ios,
    status,
    updatedAt: now,
    eventId: eventId || item.pushChannels.ios.eventId || null,
    lastError: lastError || null
  };
  await saveItem(kv, item);
}

async function deliverIosPush({
  env,
  kv,
  ownerId,
  payload,
  log,
  stage = 'push',
  itemId = null,
  eventId = null,
  targetDeviceId = null
}) {
  const targetDevice = typeof targetDeviceId === 'string' ? targetDeviceId.trim() : '';
  const devices = await listPushDevicesForOwner(kv, ownerId);
  const validDevices = devices.filter((device) => {
    if (device?.platform !== 'ios') return false;
    if (typeof device?.token !== 'string' || !device.token) return false;
    if (targetDevice && device.deviceId !== targetDevice) return false;
    return true;
  });

  if (!validDevices.length) {
    return {
      ok: false,
      reason: 'no_devices',
      successCount: 0,
      failedCount: 0,
      prunedCount: 0,
      attemptedCount: 0
    };
  }

  let authToken;
  try {
    authToken = await getApnsAuthToken(env);
  } catch (error) {
    return {
      ok: false,
      reason: 'auth_failed',
      successCount: 0,
      failedCount: 0,
      prunedCount: 0,
      attemptedCount: validDevices.length,
      error
    };
  }

  let successCount = 0;
  let failedCount = 0;
  let prunedCount = 0;

  for (const device of validDevices) {
    try {
      const result = await sendApnsNotification({
        env,
        authToken,
        device,
        payload
      });

      if (result.ok) {
        successCount += 1;
        continue;
      }

      failedCount += 1;
      if (TERMINAL_TOKEN_REASONS.has(result.reason)) {
        const prune = await removePushDeviceByRecord(kv, device);
        if (prune.removed) {
          prunedCount += 1;
        }
      }

      if (log) {
        log('warn', 'ios_push_device_failed', {
          stage,
          itemId,
          ownerId,
          eventId,
          status: result.status,
          reason: result.reason || null,
          deviceId: device.deviceId || null
        });
      }
    } catch (error) {
      failedCount += 1;
      if (log) {
        log('error', 'ios_push_device_request_failed', {
          stage,
          itemId,
          ownerId,
          eventId,
          deviceId: device.deviceId || null,
          ...formatError(error)
        });
      }
    }
  }

  if (successCount > 0) {
    return {
      ok: true,
      reason: 'sent',
      successCount,
      failedCount,
      prunedCount,
      attemptedCount: validDevices.length
    };
  }

  return {
    ok: false,
    reason: prunedCount > 0 && failedCount === prunedCount ? 'no_valid_devices' : 'delivery_failed',
    successCount,
    failedCount,
    prunedCount,
    attemptedCount: validDevices.length
  };
}

async function sendIosTestPush({
  env,
  kv,
  ownerId,
  payload,
  log,
  targetDeviceId = null
}) {
  return deliverIosPush({
    env,
    kv,
    ownerId,
    payload,
    log,
    stage: 'test_push',
    itemId: payload?.itemId || null,
    eventId: payload?.eventId || null,
    targetDeviceId
  });
}

async function processIosTestPushMessage(payload, env, log) {
  const kv = env?.READ_LATER;
  if (!kv) {
    if (log) {
      log('error', 'storage_unavailable', {
        stage: 'test_push'
      });
    }
    return;
  }

  const ownerId = typeof payload?.ownerId === 'string' && payload.ownerId.trim()
    ? payload.ownerId.trim()
    : getOwnerId(env);
  const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : null;
  const eventId = typeof payload?.eventId === 'string' ? payload.eventId.trim() : null;
  const targetDeviceId = typeof payload?.targetDeviceId === 'string'
    ? payload.targetDeviceId.trim()
    : null;

  const delivery = await sendIosTestPush({
    env,
    kv,
    ownerId,
    payload,
    log,
    targetDeviceId
  });

  if (delivery.ok) {
    if (log) {
      log('info', 'ios_test_push_sent', {
        stage: 'test_push',
        itemId,
        ownerId,
        eventId,
        targetDeviceId: targetDeviceId || null,
        successCount: delivery.successCount,
        failedCount: delivery.failedCount,
        prunedCount: delivery.prunedCount
      });
    }
    return;
  }

  const level = delivery.reason === 'auth_failed' ? 'error' : 'warn';
  if (log) {
    log(level, 'ios_test_push_not_delivered', {
      stage: 'test_push',
      itemId,
      ownerId,
      eventId,
      targetDeviceId: targetDeviceId || null,
      reason: delivery.reason || null,
      successCount: delivery.successCount,
      failedCount: delivery.failedCount,
      prunedCount: delivery.prunedCount,
      ...(delivery.error ? formatError(delivery.error) : {})
    });
  }
}

async function processIosPushMessage(message, env, log) {
  const payload = parseQueueMessageBody(message);
  if (payload?.type === 'push.notification.test') {
    await processIosTestPushMessage(payload, env, log);
    return;
  }

  const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : '';
  const eventId = typeof payload?.eventId === 'string' ? payload.eventId.trim() : '';
  const ownerId = typeof payload?.ownerId === 'string' && payload.ownerId.trim()
    ? payload.ownerId.trim()
    : getOwnerId(env);

  if (!itemId) {
    if (log) {
      log('warn', 'ios_push_invalid_message', {
        stage: 'queue'
      });
    }
    return;
  }

  const kv = env?.READ_LATER;
  if (!kv) {
    if (log) {
      log('error', 'storage_unavailable', {
        stage: 'queue',
        itemId
      });
    }
    return;
  }

  const key = `${KV_ITEM_PREFIX}${itemId}`;
  const item = await kv.get(key, { type: 'json' });
  if (!item) {
    if (log) {
      log('warn', 'ios_push_item_missing', {
        stage: 'queue',
        itemId
      });
    }
    return;
  }

  ensurePushChannels(item);

  if (!isCurrentEvent(item, eventId)) {
    if (log) {
      log('info', 'ios_push_stale_message', {
        stage: 'queue',
        itemId,
        eventId,
        currentEventId: item?.pushChannels?.ios?.eventId || null
      });
    }
    return;
  }

  if (item.pushChannels.readiness.status !== 'ready') {
    await updateIosChannel(kv, item, {
      status: 'skipped',
      eventId,
      lastError: 'Article is not push-ready'
    });

    if (log) {
      log('warn', 'ios_push_skipped_not_ready', {
        stage: 'push',
        itemId,
        eventId
      });
    }
    return;
  }

  const delivery = await deliverIosPush({
    env,
    kv,
    ownerId,
    payload,
    log,
    stage: 'push',
    itemId,
    eventId
  });

  if (delivery.reason === 'no_devices') {
    await updateIosChannel(kv, item, {
      status: 'skipped',
      eventId,
      lastError: 'No registered iOS devices'
    });

    if (log) {
      log('info', 'ios_push_skipped_no_devices', {
        stage: 'push',
        itemId,
        ownerId,
        eventId
      });
    }
    return;
  }

  if (delivery.reason === 'auth_failed') {
    await updateIosChannel(kv, item, {
      status: 'failed',
      eventId,
      lastError: 'APNS credentials unavailable'
    });

    if (log) {
      log('error', 'ios_push_auth_failed', {
        stage: 'push',
        itemId,
        ownerId,
        eventId,
        ...formatError(delivery.error)
      });
    }
    return;
  }

  if (delivery.ok) {
    await updateIosChannel(kv, item, {
      status: 'sent',
      eventId,
      lastError: null
    });

    if (log) {
      log('info', 'ios_push_sent', {
        stage: 'push',
        itemId,
        ownerId,
        eventId,
        successCount: delivery.successCount,
        failedCount: delivery.failedCount,
        prunedCount: delivery.prunedCount
      });
    }
    return;
  }

  const status = delivery.reason === 'no_valid_devices'
    ? 'skipped'
    : 'failed';
  const errorMessage = status === 'skipped'
    ? 'No valid registered iOS devices'
    : 'Failed to deliver iOS push';

  await updateIosChannel(kv, item, {
    status,
    eventId,
    lastError: errorMessage
  });

  if (log) {
    log('warn', 'ios_push_not_delivered', {
      stage: 'push',
      itemId,
      ownerId,
      eventId,
      successCount: delivery.successCount,
      failedCount: delivery.failedCount,
      prunedCount: delivery.prunedCount,
      status
    });
  }
}

async function processIosPushBatch(batch, env, log) {
  const messages = Array.isArray(batch?.messages) ? batch.messages : [];
  for (const message of messages) {
    try {
      await processIosPushMessage(message, env, log);
    } catch (error) {
      if (log) {
        log('error', 'ios_push_worker_failed', {
          stage: 'queue',
          ...formatError(error)
        });
      }
    }
  }
}

export {
  PUSH_NOTIFICATION_MESSAGE_TYPE,
  processIosPushBatch,
  sendIosTestPush
};
