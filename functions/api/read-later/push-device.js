import { createLogger, formatError } from '../lib/logger.js';
import {
  getOwnerId,
  normalizeDeviceId,
  normalizeToken,
  upsertPushDevice,
  removePushDevice
} from './push-device-store.js';

function jsonResponse(payload, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache
    }
  });
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function tokenSuffix(tokenHash) {
  if (typeof tokenHash !== 'string') return null;
  if (tokenHash.length <= 8) return tokenHash;
  return tokenHash.slice(-8);
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.READ_LATER;
  const logger = createLogger({ request, source: 'read-later-push-device' });
  const log = logger.log;

  if (!kv) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const ownerId = getOwnerId(env);

  try {
    if (request.method === 'POST') {
      const payload = await parseJson(request);
      const deviceId = normalizeDeviceId(payload?.deviceId);
      const token = normalizeToken(payload?.token);

      if (!deviceId || !token) {
        log('warn', 'push_device_invalid_payload', {
          stage: 'register',
          ownerId,
          hasDeviceId: Boolean(deviceId),
          hasToken: Boolean(token)
        });
        return jsonResponse(
          { ok: false, error: 'Invalid payload' },
          { status: 400, cache: 'no-store' }
        );
      }

      const record = await upsertPushDevice({
        kv,
        ownerId,
        deviceId,
        token,
        platform: payload?.platform,
        environment: payload?.environment,
        bundleId: payload?.bundleId,
        appVersion: payload?.appVersion,
        buildNumber: payload?.buildNumber
      });

      log('info', 'push_device_registered', {
        stage: 'register',
        ownerId: record.ownerId,
        deviceId: record.deviceId,
        environment: record.environment,
        tokenHashSuffix: tokenSuffix(record.tokenHash)
      });

      return jsonResponse(
        {
          ok: true,
          registered: true,
          deviceId: record.deviceId,
          ownerId: record.ownerId
        },
        { status: 200, cache: 'no-store' }
      );
    }

    if (request.method === 'DELETE') {
      const payload = await parseJson(request);
      const deviceId = normalizeDeviceId(payload?.deviceId);
      if (!deviceId) {
        log('warn', 'push_device_invalid_payload', {
          stage: 'unregister',
          ownerId,
          hasDeviceId: false
        });
        return jsonResponse(
          { ok: false, error: 'Invalid payload' },
          { status: 400, cache: 'no-store' }
        );
      }

      const result = await removePushDevice(kv, ownerId, deviceId);

      if (result.removed) {
        log('info', 'push_device_unregistered', {
          stage: 'unregister',
          ownerId,
          deviceId,
          tokenHashSuffix: tokenSuffix(result.tokenHash)
        });
      } else {
        log('info', 'push_device_unregistered_missing', {
          stage: 'unregister',
          ownerId,
          deviceId
        });
      }

      return jsonResponse(
        {
          ok: true,
          removed: result.removed,
          missing: result.missing === true,
          deviceId,
          ownerId
        },
        { status: 200, cache: 'no-store' }
      );
    }
  } catch (error) {
    log('error', 'push_device_request_failed', {
      stage: 'request',
      ownerId,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Push device request failed' },
      { status: 500, cache: 'no-store' }
    );
  }

  return jsonResponse(
    { ok: false, error: 'Method not allowed' },
    { status: 405, cache: 'no-store' }
  );
}
