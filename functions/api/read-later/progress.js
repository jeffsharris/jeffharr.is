/**
 * Progress endpoint for read-later reader view.
 * Stores scroll position data on the read-later item.
 */

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

  if (!['PATCH', 'POST'].includes(request.method)) {
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405, cache: 'no-store' }
    );
  }

  try {
    const payload = await parseJson(request);
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const scrollTop = Number(payload?.scrollTop ?? 0);
    const scrollRatio = Number(payload?.scrollRatio ?? 0);

    if (!id || Number.isNaN(scrollTop) || Number.isNaN(scrollRatio)) {
      return jsonResponse(
        { ok: false, error: 'Invalid payload' },
        { status: 400, cache: 'no-store' }
      );
    }

    const key = `${KV_PREFIX}${id}`;
    const item = await kv.get(key, { type: 'json' });

    if (!item) {
      return jsonResponse(
        { ok: false, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    item.progress = {
      scrollTop: Math.max(0, scrollTop),
      scrollRatio: clamp(scrollRatio, 0, 1),
      updatedAt: new Date().toISOString()
    };

    await kv.put(key, JSON.stringify(item));

    return jsonResponse(
      { ok: true, progress: item.progress },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    console.error('Read later progress error:', error);
    return jsonResponse(
      { ok: false, error: 'Failed to save progress' },
      { status: 200, cache: 'no-store' }
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
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
