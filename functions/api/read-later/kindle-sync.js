import { cacheReader } from './reader.js';
import { syncKindleForItem, shouldCacheKindleReader } from './kindle.js';

const KV_PREFIX = 'item:';

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.READ_LATER;

  if (!kv) {
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405, cache: 'no-store' }
    );
  }

  const payload = await parseJson(request);
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';

  if (!id) {
    return jsonResponse(
      { ok: false, error: 'Invalid payload' },
      { status: 400, cache: 'no-store' }
    );
  }

  try {
    const key = `${KV_PREFIX}${id}`;
    const item = await kv.get(key, { type: 'json' });

    if (!item) {
      return jsonResponse(
        { ok: false, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    const { reader, kindle } = await syncKindleForItem(item, env);
    item.kindle = kindle;

    await kv.put(key, JSON.stringify(item));
    if (reader && shouldCacheKindleReader(reader)) {
      await cacheReader(kv, id, reader);
    }

    return jsonResponse(
      { ok: true, item },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    console.error('Read later Kindle sync error:', error);
    return jsonResponse(
      { ok: false, error: 'Kindle sync failed' },
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
