import { getCoverImage } from './covers.js';
import { enqueueCoverGeneration } from './cover-sync-service.js';
import { createLogger, formatError } from '../lib/logger.js';

const KV_PREFIX = 'item:';

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.READ_LATER;
  const logger = createLogger({ request, source: 'read-later-cover' });
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
    const key = `${KV_PREFIX}${id}`;
    const item = await kv.get(key, { type: 'json' });

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

    // Check if cover already exists
    const existingCover = await getCoverImage(kv, id);
    if (existingCover?.base64) {
      log('info', 'cover_exists', {
        stage: 'cover_generation',
        itemId: id,
        url: item.url,
        title: item.title
      });
      return jsonResponse(
        { ok: true, item, coverExists: true },
        { status: 200, cache: 'no-store' }
      );
    }

    const enqueueResult = await enqueueCoverGeneration({
      item,
      kv,
      env,
      log,
      reason: 'manual-regenerate'
    });

    if (enqueueResult.queueMissing || enqueueResult.queueFailed) {
      return jsonResponse(
        {
          ok: false,
          error: 'Cover queue unavailable',
          detail: item?.coverSync?.lastError || 'Failed to queue cover generation'
        },
        { status: 500, cache: 'no-store' }
      );
    }

    if (enqueueResult.inProgress) {
      return jsonResponse(
        { ok: true, item, inProgress: true },
        { status: 202, cache: 'no-store' }
      );
    }

    return jsonResponse(
      {
        ok: true,
        item,
        queued: enqueueResult.queued === true
      },
      { status: enqueueResult.queued ? 202 : 200, cache: 'no-store' }
    );
  } catch (error) {
    const formattedError = formatError(error);
    log('error', 'cover_regeneration_failed', {
      stage: 'cover_generation',
      itemId: id,
      ...formattedError
    });
    return jsonResponse(
      {
        ok: false,
        error: 'Cover regeneration failed',
        detail: formattedError.error || null
      },
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
