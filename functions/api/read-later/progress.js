/**
 * Progress endpoint for read-later reader view.
 * Stores scroll position data on the read-later item.
 */

const KV_PREFIX = 'item:';
const MIN_VIDEO_SECONDS = 300;

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
    const scrollTop = Number(payload?.scrollTop);
    const scrollRatio = Number(payload?.scrollRatio);
    const videoCurrentTime = Number(payload?.videoCurrentTime);
    const videoDuration = Number(payload?.videoDuration);

    const hasScroll = Number.isFinite(scrollTop) && Number.isFinite(scrollRatio);
    const hasVideo = Number.isFinite(videoCurrentTime) && Number.isFinite(videoDuration);

    if (!id || (!hasScroll && !hasVideo)) {
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

    const progress = item.progress && typeof item.progress === 'object'
      ? { ...item.progress }
      : {};
    const updatedAt = new Date().toISOString();

    if (hasScroll) {
      progress.scrollTop = Math.max(0, scrollTop);
      progress.scrollRatio = clamp(scrollRatio, 0, 1);
      progress.updatedAt = updatedAt;
    }

    if (hasVideo) {
      if (videoDuration >= MIN_VIDEO_SECONDS) {
        const safeDuration = Math.max(videoDuration, 0);
        const safeTime = clamp(videoCurrentTime, 0, safeDuration || 0);
        progress.video = {
          currentTime: safeTime,
          duration: safeDuration,
          ratio: safeDuration ? clamp(safeTime / safeDuration, 0, 1) : 0,
          updatedAt
        };
      } else {
        delete progress.video;
      }
    }

    item.progress = Object.keys(progress).length > 0 ? progress : null;

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
