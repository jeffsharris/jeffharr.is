import { createLogger, formatError } from '../lib/logger.js';
import { getContentDb } from '../content-library/db.js';
import { restoreReadLaterItem } from '../content-library/read-later-store.js';

export async function onRequest(context) {
  const { request, env } = context;
  const db = getContentDb(env);
  const logger = createLogger({ request, source: 'read-later-restore' });
  const log = logger.log;

  if (!db) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  return handleReadLaterRestore(request, db, log);
}

async function handleReadLaterRestore(request, db, log) {
  if (request.method !== 'POST') {
    log('warn', 'method_not_allowed', { stage: 'request' });
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405, cache: 'no-store' }
    );
  }

  try {
    const result = await restoreReadLaterItem(db, await parseJson(request));
    if (!result.ok) {
      return jsonResponse(
        { ok: false, error: result.error },
        { status: result.status, cache: 'no-store' }
      );
    }
    return jsonResponse(
      { ok: true, item: result.item },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    log('error', 'restore_failed', {
      stage: 'save',
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Failed to restore item' },
      { status: 500, cache: 'no-store' }
    );
  }
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function jsonResponse(payload, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache
    }
  });
}
