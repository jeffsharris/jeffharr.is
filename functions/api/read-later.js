/**
 * Read-later API endpoint for Cloudflare Pages Functions.
 * Supports listing, saving, and updating read status for saved links.
 */

import { enqueueKindleSync } from './read-later/sync-service.js';
import { createLogger, formatError } from './lib/logger.js';
import { getContentDb } from './content-library/db.js';
import { jsonResponse, parseJson } from './content-library/serialize.js';
import { enrichXVideos } from './read-later/video.js';
import { getAdminUser } from './content-library/auth.js';
import { getLibraryUser } from './lib/client-auth.js';
import { allowPublicSave } from './lib/public-save.js';
import {
  createReadLaterItemStore,
  deleteReadLaterItem,
  listReadLaterItems,
  saveReadLaterItem,
  updateReadLaterRead
} from './content-library/read-later-store.js';

export async function onRequest(context) {
  const { request, env } = context;
  const db = getContentDb(env);
  const readLaterStore = createReadLaterItemStore(db);
  const logger = createLogger({ request, source: 'read-later' });
  const log = logger.log;

  if (!db || !readLaterStore) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  return handleReadLaterRequest({ request, env, db, readLaterStore, log, waitUntil: context.waitUntil?.bind(context) });
}

async function handleReadLaterRequest({ request, env, db, readLaterStore, log, waitUntil }) {
  try {
    if (request.method === 'GET') {
      const items = await listReadLaterItems(db);
      if (waitUntil && await getAdminUser(request, env)) waitUntil(enrichXVideos(db, items, env));
      return jsonResponse(
        { items, count: items.length },
        { status: 200, cache: 'no-store' }
      );
    }

    if (request.method === 'POST') {
      const trusted = Boolean(await getLibraryUser(request, env));
      if (!trusted && !(await allowPublicSave(request, env))) {
        return jsonResponse({ok:false,error:'Public saving limit reached. Try again later or sign in.'}, {status:429,cache:'no-store'});
      }
      if (shouldStreamResponse(request)) {
        return handleReadLaterSaveStream(request, db, readLaterStore, env, log, trusted);
      }

      const payload = await parseJson(request);
      const result = await saveReadLaterItem(db, trusted ? payload : publicSavePayload(payload), {allowDuplicateChanges:trusted});
      if (!result.ok) {
        return jsonResponse(
          { ok: false, error: result.error },
          { status: result.status, cache: 'no-store' }
        );
      }
      const enqueueResult = !trusted && result.duplicate ? null : await enqueueReadLaterSync({
        item: result.item,
        readLaterStore,
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

async function handleReadLaterSaveStream(request, db, readLaterStore, env, log, trusted) {
  const stream = createEventStream(log);

  (async () => {
    let savedItem = null;
    try {
      const payload = await parseJson(request);
      const result = await saveReadLaterItem(db, trusted ? payload : publicSavePayload(payload), {allowDuplicateChanges:trusted});
      if (!result.ok) {
        await safeStreamSend(stream, 'error', { ok: false, error: result.error });
        return;
      }

      savedItem = result.item;
      await safeStreamSend(stream, 'saved', { ok: true, item: { ...result.item } });

      const enqueueResult = !trusted && result.duplicate ? null : await enqueueReadLaterSync({
        item: result.item,
        readLaterStore,
        env,
        log,
        reason: result.duplicate ? 'duplicate-save' : 'save',
        force: result.duplicate
      });
      result.item = enqueueResult?.item || result.item;
      savedItem = result.item;
      await safeStreamSend(stream, 'status', {
        ok: true,
        message: !trusted && result.duplicate ? 'Already saved' : 'Queued Kindle sync'
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

function shouldStreamResponse(request) {
  const url = new URL(request.url);
  if (url.searchParams.get('stream') === '1') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('text/event-stream');
}

function publicSavePayload(payload) {
  return {
    url: typeof payload?.url === 'string' && payload.url.length <= 4096 ? payload.url : '',
    title: typeof payload?.title === 'string' ? payload.title.slice(0, 220) : '',
    read: false
  };
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

async function enqueueReadLaterSync({ item, readLaterStore, env, log, reason, force = false }) {
  if (!readLaterStore || !item?.id) return { queued: false, item };
  return enqueueKindleSync({
    item,
    readLaterStore,
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
