function createMockPushDb(initial = []) {
  const rows = new Map();
  for (const record of initial) {
    rows.set(deviceKey(record.owner_id, record.device_id), { ...record });
  }

  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async all() {
              if (sql.includes('FROM push_devices') && sql.includes('WHERE owner_id = ?')) {
                const [ownerId] = args;
                const results = Array.from(rows.values())
                  .filter((row) => row.owner_id === ownerId)
                  .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')));
                return { results };
              }
              return { results: [] };
            },
            async first() {
              if (sql.includes('WHERE owner_id = ? AND device_id = ?')) {
                const [ownerId, deviceId] = args;
                return rows.get(deviceKey(ownerId, deviceId)) || null;
              }
              if (sql.includes('WHERE token_hash = ?')) {
                const [tokenHash] = args;
                return Array.from(rows.values()).find((row) => row.token_hash === tokenHash) || null;
              }
              return null;
            },
            async run() {
              if (sql.includes('DELETE FROM push_devices')) {
                const [ownerId, deviceId] = args;
                const removed = rows.delete(deviceKey(ownerId, deviceId));
                return { meta: { changes: removed ? 1 : 0 } };
              }
              if (sql.includes('INSERT INTO push_devices')) {
                const [
                  ownerId,
                  deviceId,
                  token,
                  tokenHash,
                  platform,
                  environment,
                  bundleId,
                  appVersion,
                  buildNumber,
                  registeredAt,
                  updatedAt
                ] = args;
                rows.set(deviceKey(ownerId, deviceId), {
                  owner_id: ownerId,
                  device_id: deviceId,
                  token,
                  token_hash: tokenHash,
                  platform,
                  environment,
                  bundle_id: bundleId,
                  app_version: appVersion,
                  build_number: buildNumber,
                  registered_at: registeredAt,
                  updated_at: updatedAt
                });
                return { meta: { changes: 1 } };
              }
              return { meta: { changes: 0 } };
            }
          };
        }
      };
    }
  };
}

function deviceKey(ownerId, deviceId) {
  return `${ownerId}:${deviceId}`;
}

function listPushDeviceRows(db) {
  return Array.from(db.rows.values());
}

export { createMockPushDb, listPushDeviceRows };
