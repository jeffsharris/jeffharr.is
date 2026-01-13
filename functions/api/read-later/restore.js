/**
 * Restore endpoint for read-later items (used by undo).
 * Recreates an item with its original metadata.
 */

import { createItem, normalizeTitle, normalizeUrl } from '../read-later.js';

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

  if (request.method !== 'POST') {
    return jsonResponse(
      { ok: false, error: 'Method not allowed' },
      { status: 405, cache: 'no-store' }
    );
  }

  try {
    const payload = await parseJson(request);
    const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
    const normalizedUrl = normalizeUrl(payload?.url);

    if (!id || !normalizedUrl) {
      return jsonResponse(
        { ok: false, error: 'Invalid payload' },
        { status: 400, cache: 'no-store' }
      );
    }

    const title = normalizeTitle(payload?.title, normalizedUrl);
    const read = typeof payload?.read === 'boolean' ? payload.read : false;
    const savedAt = normalizeIsoDate(payload?.savedAt) || new Date().toISOString();
    const readAt = normalizeIsoDate(payload?.readAt);
    const progress = normalizeProgress(payload?.progress);

    const item = createItem({
      id,
      url: normalizedUrl,
      title,
      savedAt,
      read,
      readAt,
      progress
    });

    await kv.put(`${KV_PREFIX}${id}`, JSON.stringify(item));

    return jsonResponse(
      { ok: true, item },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    console.error('Read later restore error:', error);
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

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeProgress(progress) {
  if (!progress || typeof progress !== 'object') return null;

  const result = {};
  const scrollTop = Number(progress.scrollTop);
  const scrollRatio = Number(progress.scrollRatio);
  const hasScroll = Number.isFinite(scrollTop) && Number.isFinite(scrollRatio);

  if (hasScroll) {
    result.scrollTop = Math.max(0, scrollTop);
    result.scrollRatio = clamp(scrollRatio, 0, 1);
    result.updatedAt = normalizeIsoDate(progress.updatedAt) || new Date().toISOString();
  }

  const video = progress.video;
  if (video && typeof video === 'object') {
    const currentTime = Number(video.currentTime);
    const duration = Number(video.duration);
    if (Number.isFinite(currentTime) && Number.isFinite(duration) && duration >= MIN_VIDEO_SECONDS) {
      const safeDuration = Math.max(duration, 0);
      const safeTime = clamp(currentTime, 0, safeDuration || 0);
      result.video = {
        currentTime: safeTime,
        duration: safeDuration,
        ratio: safeDuration ? clamp(safeTime / safeDuration, 0, 1) : 0,
        updatedAt: normalizeIsoDate(video.updatedAt) || new Date().toISOString()
      };
    }
  }

  return Object.keys(result).length > 0 ? result : null;
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
