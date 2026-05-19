/**
 * Read-later API endpoint for Cloudflare Pages Functions.
 * Supports listing, saving, and updating read status for saved links.
 */

import { deriveTitleFromUrl, preferReaderTitle } from './read-later/reader-utils.js';
import { createInitialPushChannels } from './read-later/article-push-service.js';
import { createReadLaterRepository } from './read-later/repository.js';
import { enqueueKindleSync } from './read-later/sync-service.js';
import { createLogger, formatError } from './lib/logger.js';
import { getContentDb } from './content-library/db.js';
import {
  deleteReadLaterItem,
  listReadLaterItems,
  saveReadLaterItem,
  updateReadLaterRead
} from './content-library/read-later-store.js';

const MAX_TITLE_LENGTH = 220;
const MAX_URL_LENGTH = 2048;

export async function onRequest(context) {
  const { request, env } = context;
  const db = getContentDb(env);
  const repository = createReadLaterRepository(env, { requireAssets: true });
  const logger = createLogger({ request, source: 'read-later' });
  const log = logger.log;

  if (!db || !repository) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  return handleReadLaterRequest({ request, env, db, repository, log });
}

async function handleReadLaterRequest({ request, env, db, repository, log }) {
  try {
    if (request.method === 'GET') {
      const items = await listReadLaterItems(db);
      return jsonResponse(
        { items, count: items.length },
        { status: 200, cache: 'no-store' }
      );
    }

    if (request.method === 'POST') {
      if (shouldStreamResponse(request)) {
        return handleReadLaterSaveStream(request, db, repository, env, log);
      }

      const result = await saveReadLaterItem(db, await parseJson(request));
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: result.error },
          { status: result.status, cache: 'no-store' }
        );
      }
      const enqueueResult = await enqueueReadLaterSync({
        item: result.item,
        repository,
        env,
        log,
        reason: result.duplicate ? 'duplicate-save' : 'save',
        force: result.duplicate
      });
      result.item = enqueueResult?.item || result.item;
      return jsonResponse(
        {
          ok: true,
          item: result.item,
          duplicate: result.duplicate,
          unarchived: result.unarchived
        },
        { status: result.status, cache: 'no-store' }
      );
    }

    if (request.method === 'PATCH') {
      const payload = await parseJson(request);
      const result = await updateReadLaterRead(db, {
        id: typeof payload?.id === 'string' ? payload.id.trim() : '',
        read: payload?.read
      });
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: result.error },
          { status: result.status, cache: 'no-store' }
        );
      }
      return jsonResponse({ ok: true, item: result.item }, { status: 200, cache: 'no-store' });
    }

    if (request.method === 'DELETE') {
      const payload = await parseJson(request);
      const idFromQuery = new URL(request.url).searchParams.get('id');
      const id = typeof payload?.id === 'string' ? payload.id.trim() : (idFromQuery || '').trim();
      const result = await deleteReadLaterItem(db, id);
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: result.error },
          { status: result.status, cache: 'no-store' }
        );
      }
      return jsonResponse({ ok: true, item: result.item }, { status: 200, cache: 'no-store' });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204 });
    }
  } catch (error) {
    log('error', 'request_failed', {
      stage: 'request',
      ...formatError(error)
    });
  }

  return jsonResponse(
    { ok: false, error: 'Method not allowed' },
    { status: 405, cache: 'no-store' }
  );
}

async function handleReadLaterSaveStream(request, db, repository, env, log) {
  const stream = createEventStream(log);

  (async () => {
    let savedItem = null;
    try {
      const result = await saveReadLaterItem(db, await parseJson(request));
      if (!result.ok) {
        await safeStreamSend(stream, 'error', { ok: false, error: result.error });
        return;
      }

      savedItem = result.item;
      await safeStreamSend(stream, 'saved', { ok: true, item: { ...result.item } });

      const enqueueResult = await enqueueReadLaterSync({
        item: result.item,
        repository,
        env,
        log,
        reason: result.duplicate ? 'duplicate-save' : 'save',
        force: result.duplicate
      });
      result.item = enqueueResult?.item || result.item;
      savedItem = result.item;
      await safeStreamSend(stream, 'status', {
        ok: true,
        message: 'Queued Kindle sync'
      });

      await safeStreamSend(stream, 'done', {
        ok: true,
        item: result.item,
        duplicate: result.duplicate,
        unarchived: result.unarchived
      });
    } catch (error) {
      log('error', 'content_library_save_stream_failed', {
        stage: 'save',
        itemId: savedItem?.id || null,
        ...formatError(error)
      });
      if (savedItem) {
        await safeStreamSend(stream, 'done', { ok: true, item: savedItem, syncFailed: true });
      } else {
        await safeStreamSend(stream, 'error', { ok: false, error: 'Failed to save item' });
      }
    } finally {
      await stream.close();
    }
  })();

  return new Response(stream.readable, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      'Connection': 'keep-alive'
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

function normalizeUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const parsed = tryParseUrl(trimmed) || tryParseUrl(`https://${trimmed}`);
  if (!parsed) return null;
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;

  const normalized = parsed.toString();
  if (normalized.length > MAX_URL_LENGTH) return null;
  return normalized;
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeTitle(input, fallbackUrl) {
  const raw = typeof input === 'string' ? input.trim() : '';
  let title = raw || deriveTitleFromUrl(fallbackUrl);

  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).trim();
  }

  return title;
}

function createItem({
  url,
  title,
  id = createId(),
  savedAt = new Date().toISOString(),
  read = false,
  readAt = null,
  progress = null,
  pushChannels = null
}) {
  const now = new Date().toISOString();
  return {
    id,
    url,
    title,
    savedAt,
    read,
    readAt: read ? readAt || new Date().toISOString() : null,
    progress,
    pushChannels: pushChannels || createInitialPushChannels(now)
  };
}

function createId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `item_${Date.now()}_${Math.random().toString(16).slice(2)}`;
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

function shouldStreamResponse(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('stream') === '1') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/event-stream');
}

function createEventStream(log) {
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const send = async (event, data) => {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    try {
      await writer.write(encoder.encode(payload));
    } catch (error) {
      if (log) {
        log('error', 'stream_write_failed', {
          stage: 'stream',
          event,
          ...formatError(error)
        });
      }
      throw error;
    }
  };

  const close = async () => {
    try {
      await writer.close();
    } catch {
      // Ignore broken pipe.
    }
  };

  return { readable, send, close };
}

async function enqueueReadLaterSync({ item, repository, env, log, reason, force = false }) {
  if (!repository || !item?.id) return { queued: false, item };
  return enqueueKindleSync({
    item,
    repository,
    env,
    log,
    reason,
    force
  });
}

async function safeStreamSend(stream, event, data) {
  try {
    await stream.send(event, data);
    return true;
  } catch {
    return false;
  }
}

export {
  createItem,
  createId,
  normalizeTitle,
  normalizeUrl,
  deriveTitleFromUrl,
  preferReaderTitle
};
