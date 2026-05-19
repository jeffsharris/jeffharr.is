import { createLogger } from '../lib/logger.js';
import { createReadLaterRepository } from './repository.js';

export async function onRequest(context) {
  const { request, env } = context;
  const repository = createReadLaterRepository(env, { requireAssets: true });
  const logger = createLogger({ request, source: 'read-later-cover-sync' });
  const log = logger.log;

  if (!repository) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'GET') {
    log('warn', 'method_not_allowed', { stage: 'request' });
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405, cache: 'no-store' }
    );
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return jsonResponse(
      { ok: false, error: 'Missing id' },
      { status: 400, cache: 'no-store' }
    );
  }

  const item = await repository.getItem(id);
  if (!item) {
    return jsonResponse(
      { ok: false, error: 'Item not found' },
      { status: 404, cache: 'no-store' }
    );
  }

  const status = item?.coverSync?.status || (item?.cover?.updatedAt ? 'succeeded' : 'idle');
  const done = status === 'failed' || status === 'succeeded' || status === 'idle';

  return jsonResponse(
    {
      ok: true,
      item,
      status,
      done
    },
    { status: 200, cache: 'no-store' }
  );
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
