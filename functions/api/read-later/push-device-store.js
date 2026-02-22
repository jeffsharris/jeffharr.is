const PUSH_DEVICE_PREFIX = 'push_device:';
const PUSH_TOKEN_PREFIX = 'push_token:';
const DEFAULT_OWNER_ID = 'default';

function getNowIso() {
  return new Date().toISOString();
}

function getOwnerId(env) {
  const configured = typeof env?.READ_LATER_DEFAULT_OWNER_ID === 'string'
    ? env.READ_LATER_DEFAULT_OWNER_ID.trim()
    : '';
  return configured || DEFAULT_OWNER_ID;
}

function normalizeDeviceId(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.slice(0, 200);
}

function normalizeToken(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim().replace(/\s+/g, '');
  if (!trimmed) return '';
  return trimmed.slice(0, 4096);
}

function normalizeEnvironment(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized === 'development' ? 'development' : 'production';
}

function normalizePlatform(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return normalized || 'ios';
}

function normalizeMetadataValue(value, maxLength = 200) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLength);
}

function buildDeviceKey(ownerId, deviceId) {
  return `${PUSH_DEVICE_PREFIX}${ownerId}:${deviceId}`;
}

function buildDevicePrefix(ownerId) {
  return `${PUSH_DEVICE_PREFIX}${ownerId}:`;
}

function buildTokenKey(tokenHash) {
  return `${PUSH_TOKEN_PREFIX}${tokenHash}`;
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(digest);
}

async function listPushDevicesForOwner(kv, ownerId) {
  const records = [];
  if (!kv || !ownerId) return records;

  const prefix = buildDevicePrefix(ownerId);
  let cursor;

  do {
    const response = await kv.list({ prefix, cursor });
    const batch = await Promise.all(
      (response.keys || []).map((entry) => kv.get(entry.name, { type: 'json' }))
    );
    batch.filter(Boolean).forEach((record) => records.push(record));
    cursor = response.list_complete ? undefined : response.cursor;
  } while (cursor);

  return records;
}

async function removePushDeviceByRecord(kv, record) {
  if (!kv || !record) return { removed: false };
  const ownerId = normalizeMetadataValue(record.ownerId, 120) || DEFAULT_OWNER_ID;
  const deviceId = normalizeDeviceId(record.deviceId);
  const tokenHash = normalizeMetadataValue(record.tokenHash, 128);
  if (!deviceId) return { removed: false };

  await kv.delete(buildDeviceKey(ownerId, deviceId));

  if (tokenHash) {
    const tokenKey = buildTokenKey(tokenHash);
    const linked = await kv.get(tokenKey, { type: 'json' });
    if (linked?.ownerId === ownerId && linked?.deviceId === deviceId) {
      await kv.delete(tokenKey);
    }
  }

  return {
    removed: true,
    ownerId,
    deviceId,
    tokenHash
  };
}

async function removePushDevice(kv, ownerId, deviceId) {
  if (!kv) return { removed: false, missing: true };

  const normalizedOwnerId = normalizeMetadataValue(ownerId, 120) || DEFAULT_OWNER_ID;
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!normalizedDeviceId) return { removed: false, missing: true };

  const key = buildDeviceKey(normalizedOwnerId, normalizedDeviceId);
  const existing = await kv.get(key, { type: 'json' });
  if (!existing) {
    return {
      removed: false,
      missing: true,
      ownerId: normalizedOwnerId,
      deviceId: normalizedDeviceId
    };
  }

  const result = await removePushDeviceByRecord(kv, existing);
  return {
    ...result,
    missing: false,
    ownerId: normalizedOwnerId,
    deviceId: normalizedDeviceId
  };
}

async function upsertPushDevice({
  kv,
  ownerId,
  deviceId,
  token,
  platform,
  environment,
  bundleId,
  appVersion,
  buildNumber
}) {
  if (!kv) {
    throw new Error('Storage unavailable');
  }

  const normalizedOwnerId = normalizeMetadataValue(ownerId, 120) || DEFAULT_OWNER_ID;
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  const normalizedToken = normalizeToken(token);

  if (!normalizedDeviceId || !normalizedToken) {
    throw new Error('Invalid push device payload');
  }

  const now = getNowIso();
  const tokenHash = await hashToken(normalizedToken);
  const deviceKey = buildDeviceKey(normalizedOwnerId, normalizedDeviceId);
  const tokenKey = buildTokenKey(tokenHash);

  const existing = await kv.get(deviceKey, { type: 'json' });
  if (existing?.tokenHash && existing.tokenHash !== tokenHash) {
    const oldTokenKey = buildTokenKey(existing.tokenHash);
    const previousIndex = await kv.get(oldTokenKey, { type: 'json' });
    if (previousIndex?.ownerId === normalizedOwnerId && previousIndex?.deviceId === normalizedDeviceId) {
      await kv.delete(oldTokenKey);
    }
  }

  const linkedRecord = await kv.get(tokenKey, { type: 'json' });
  if (
    linkedRecord?.ownerId &&
    linkedRecord?.deviceId &&
    (linkedRecord.ownerId !== normalizedOwnerId || linkedRecord.deviceId !== normalizedDeviceId)
  ) {
    const staleDeviceKey = buildDeviceKey(linkedRecord.ownerId, linkedRecord.deviceId);
    await kv.delete(staleDeviceKey);
  }

  const record = {
    ownerId: normalizedOwnerId,
    deviceId: normalizedDeviceId,
    token: normalizedToken,
    tokenHash,
    platform: normalizePlatform(platform),
    environment: normalizeEnvironment(environment),
    bundleId: normalizeMetadataValue(bundleId, 200),
    appVersion: normalizeMetadataValue(appVersion, 120),
    buildNumber: normalizeMetadataValue(buildNumber, 120),
    registeredAt: existing?.registeredAt || now,
    updatedAt: now
  };

  await kv.put(deviceKey, JSON.stringify(record));
  await kv.put(
    tokenKey,
    JSON.stringify({
      ownerId: normalizedOwnerId,
      deviceId: normalizedDeviceId,
      tokenHash,
      updatedAt: now
    })
  );

  return record;
}

export {
  DEFAULT_OWNER_ID,
  PUSH_DEVICE_PREFIX,
  PUSH_TOKEN_PREFIX,
  getOwnerId,
  normalizeDeviceId,
  normalizeEnvironment,
  normalizePlatform,
  normalizeToken,
  normalizeMetadataValue,
  hashToken,
  buildDeviceKey,
  buildDevicePrefix,
  buildTokenKey,
  listPushDevicesForOwner,
  removePushDevice,
  removePushDeviceByRecord,
  upsertPushDevice
};
