const DEFAULT_OWNER_ID = 'default';

function getNowIso() {
  return new Date().toISOString();
}

function getOwnerId(env) {
  const configured = typeof env?.PUSH_DEFAULT_OWNER_ID === 'string'
    ? env.PUSH_DEFAULT_OWNER_ID.trim()
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

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token) {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(digest);
}

async function listPushDevicesForOwner(db, ownerId) {
  if (!db || !ownerId) return [];
  const result = await db.prepare(
    `SELECT *
     FROM push_devices
     WHERE owner_id = ?
     ORDER BY updated_at DESC`
  ).bind(ownerId).all();
  return (result.results || []).map(rowToPushDevice);
}

async function removePushDeviceByRecord(db, record) {
  if (!db || !record) return { removed: false };
  const ownerId = normalizeMetadataValue(record.ownerId, 120) || DEFAULT_OWNER_ID;
  const deviceId = normalizeDeviceId(record.deviceId);
  const tokenHash = normalizeMetadataValue(record.tokenHash, 128);
  if (!deviceId) return { removed: false };

  const result = await db.prepare(
    `DELETE FROM push_devices WHERE owner_id = ? AND device_id = ?`
  ).bind(ownerId, deviceId).run();

  return {
    removed: Number(result.meta?.changes || 0) > 0,
    ownerId,
    deviceId,
    tokenHash
  };
}

async function removePushDevice(db, ownerId, deviceId) {
  if (!db) return { removed: false, missing: true };

  const normalizedOwnerId = normalizeMetadataValue(ownerId, 120) || DEFAULT_OWNER_ID;
  const normalizedDeviceId = normalizeDeviceId(deviceId);
  if (!normalizedDeviceId) return { removed: false, missing: true };

  const existing = await getPushDevice(db, normalizedOwnerId, normalizedDeviceId);
  if (!existing) {
    return {
      removed: false,
      missing: true,
      ownerId: normalizedOwnerId,
      deviceId: normalizedDeviceId
    };
  }

  const result = await removePushDeviceByRecord(db, existing);
  return {
    ...result,
    missing: false,
    ownerId: normalizedOwnerId,
    deviceId: normalizedDeviceId
  };
}

async function upsertPushDevice({
  db,
  ownerId,
  deviceId,
  token,
  platform,
  environment,
  bundleId,
  appVersion,
  buildNumber
}) {
  if (!db) {
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

  const existing = await getPushDevice(db, normalizedOwnerId, normalizedDeviceId);
  const linkedRecord = await getPushDeviceByTokenHash(db, tokenHash);
  if (
    linkedRecord?.ownerId &&
    linkedRecord?.deviceId &&
    (linkedRecord.ownerId !== normalizedOwnerId || linkedRecord.deviceId !== normalizedDeviceId)
  ) {
    await removePushDevice(db, linkedRecord.ownerId, linkedRecord.deviceId);
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

  await db.prepare(
    `INSERT INTO push_devices (
      owner_id, device_id, token, token_hash, platform, environment,
      bundle_id, app_version, build_number, registered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(owner_id, device_id) DO UPDATE SET
      token = excluded.token,
      token_hash = excluded.token_hash,
      platform = excluded.platform,
      environment = excluded.environment,
      bundle_id = excluded.bundle_id,
      app_version = excluded.app_version,
      build_number = excluded.build_number,
      updated_at = excluded.updated_at`
  ).bind(
    record.ownerId,
    record.deviceId,
    record.token,
    record.tokenHash,
    record.platform,
    record.environment,
    record.bundleId,
    record.appVersion,
    record.buildNumber,
    record.registeredAt,
    record.updatedAt
  ).run();

  return record;
}

async function getPushDevice(db, ownerId, deviceId) {
  if (!db || !ownerId || !deviceId) return null;
  const row = await db.prepare(
    `SELECT * FROM push_devices WHERE owner_id = ? AND device_id = ?`
  ).bind(ownerId, deviceId).first();
  return row ? rowToPushDevice(row) : null;
}

async function getPushDeviceByTokenHash(db, tokenHash) {
  if (!db || !tokenHash) return null;
  const row = await db.prepare(
    `SELECT * FROM push_devices WHERE token_hash = ?`
  ).bind(tokenHash).first();
  return row ? rowToPushDevice(row) : null;
}

function rowToPushDevice(row) {
  if (!row) return null;
  return {
    ownerId: row.owner_id,
    deviceId: row.device_id,
    token: row.token,
    tokenHash: row.token_hash,
    platform: row.platform,
    environment: row.environment,
    bundleId: row.bundle_id || null,
    appVersion: row.app_version || null,
    buildNumber: row.build_number || null,
    registeredAt: row.registered_at,
    updatedAt: row.updated_at
  };
}

export {
  DEFAULT_OWNER_ID,
  getOwnerId,
  normalizeDeviceId,
  normalizeEnvironment,
  normalizePlatform,
  normalizeToken,
  normalizeMetadataValue,
  hashToken,
  getPushDevice,
  getPushDeviceByTokenHash,
  listPushDevicesForOwner,
  removePushDevice,
  removePushDeviceByRecord,
  rowToPushDevice,
  upsertPushDevice
};
