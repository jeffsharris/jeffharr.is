import { enqueueKindleSync } from './sync-service.js';
import { createReadLaterStores } from './stores.js';
import { createLogger, formatError } from '../lib/logger.js';
import { jsonResponse, parseJson } from '../content-library/serialize.js';

export async function onRequest(context) {
  const { request, env } = context;
  const stores = createReadLaterStores(env);
  const logger = createLogger({ request, source: 'read-later-kindle-sync' });
  const log = logger.log;

  if (!stores) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }
  const { readLaterStore } = stores;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    log('warn', 'method_not_allowed', { stage: 'request' });
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405, cache: 'no-store' }
    );
  }

  const payload = await parseJson(request);
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';

  if (!id) {
    log('warn', 'invalid_payload', { stage: 'request' });
    return jsonResponse(
      { ok: false, error: 'Invalid payload' },
      { status: 400, cache: 'no-store' }
    );
  }

  try {
    const item = await readLaterStore.getItem(id);

    if (!item) {
      log('warn', 'item_not_found', {
        stage: 'lookup',
        itemId: id
      });
      return jsonResponse(
        { ok: false, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    await enqueueKindleSync({
      item,
      readLaterStore,
      env,
      log,
      reason: 'manual-sync',
      force: true
    });

    log('info', 'kindle_sync_complete', {
      stage: 'sync',
      itemId: id,
      url: item.url,
      title: item.title,
      kindleStatus: item?.kindle?.status || null
    });

    return jsonResponse(
      { ok: true, item },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    log('error', 'kindle_sync_failed', {
      stage: 'sync',
      itemId: id,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Kindle sync failed' },
      { status: 500, cache: 'no-store' }
    );
  }
}
