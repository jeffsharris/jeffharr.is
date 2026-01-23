/**
 * Read-later API endpoint for Cloudflare Pages Functions.
 * Supports listing, saving, and updating read status for saved links.
 */

import { deriveTitleFromUrl, preferReaderTitle } from './read-later/reader-utils.js';
import { cacheReader } from './read-later/reader.js';
import { syncKindleForItem, shouldCacheKindleReader } from './read-later/kindle.js';
import { createLogger, formatError } from './lib/logger.js';

const KV_PREFIX = 'item:';
const MAX_TITLE_LENGTH = 220;
const MAX_URL_LENGTH = 2048;

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.READ_LATER;
  const logger = createLogger({ request, source: 'read-later' });
  const log = logger.log;

  if (!kv) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  try {
    if (request.method === 'GET') {
      return handleList(kv, log);
    }

    if (request.method === 'POST') {
      if (shouldStreamResponse(request)) {
        return handleSaveStream(request, kv, env, log);
      }
      return handleSave(request, kv, env, log);
    }

    if (request.method === 'PATCH') {
      return handleUpdate(request, kv, log);
    }

    if (request.method === 'DELETE') {
      return handleDelete(request, kv, log);
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

async function handleList(kv, log) {
  try {
    const items = await listAllItems(kv);
    items.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));

    return jsonResponse(
      { items, count: items.length },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    log('error', 'list_failed', {
      stage: 'list',
      ...formatError(error)
    });
    return jsonResponse(
      { items: [], count: 0 },
      { status: 200, cache: 'no-store' }
    );
  }
}

async function handleSave(request, kv, env, log) {
  const payload = await parseJson(request);
  const normalizedUrl = normalizeUrl(payload?.url);
  const incomingRead = payload?.read;

  if (!normalizedUrl) {
    log('warn', 'save_invalid_url', {
      stage: 'save',
      url: payload?.url || null,
      title: payload?.title || null
    });
    return jsonResponse(
      { ok: false, error: 'Invalid URL' },
      { status: 400, cache: 'no-store' }
    );
  }

  const title = normalizeTitle(payload?.title, normalizedUrl);
  const read = typeof incomingRead === 'boolean' ? incomingRead : false;

  try {
    // Check for existing item with same URL
    const existingItem = await findItemByUrl(kv, normalizedUrl);

    if (existingItem) {
      // Item already exists - update it
      const wasRead = existingItem.read;
      existingItem.savedAt = new Date().toISOString();
      existingItem.read = false;
      existingItem.readAt = null;
      // Update title if a new one was provided
      if (payload?.title) {
        existingItem.title = title;
      }

      await kv.put(`${KV_PREFIX}${existingItem.id}`, JSON.stringify(existingItem));
      log('info', 'save_duplicate', {
        stage: 'save',
        itemId: existingItem.id,
        url: normalizedUrl,
        title: existingItem.title,
        unarchived: wasRead
      });

      return jsonResponse(
        {
          ok: true,
          item: existingItem,
          duplicate: true,
          unarchived: wasRead
        },
        { status: 200, cache: 'no-store' }
      );
    }

    // New item - save basic item FIRST before expensive operations
    const item = createItem({ url: normalizedUrl, title, read });
    await kv.put(`${KV_PREFIX}${item.id}`, JSON.stringify(item));
    log('info', 'save_persisted', {
      stage: 'save',
      itemId: item.id,
      url: item.url,
      title: item.title
    });

    // Now do expensive work (cover generation, kindle sync)
    try {
      const { reader, kindle, cover } = await syncKindleForItem(item, env, {
        kv,
        log
      });
      const resolvedTitle = preferReaderTitle(item.title, reader?.title, item.url);
      if (resolvedTitle && resolvedTitle !== item.title) {
        item.title = resolvedTitle;
      }
      item.kindle = kindle;
      if (cover?.createdAt) {
        item.cover = { updatedAt: cover.createdAt };
      }
      // Update item with kindle/cover info
      await kv.put(`${KV_PREFIX}${item.id}`, JSON.stringify(item));
      if (reader && shouldCacheKindleReader(reader)) {
        await cacheReader(kv, item.id, reader);
      }
      log('info', 'save_sync_complete', {
        stage: 'sync',
        itemId: item.id,
        url: item.url,
        title: item.title,
        kindleStatus: kindle?.status || null,
        coverCreatedAt: cover?.createdAt || null
      });
    } catch (syncError) {
      // Log but don't fail - basic item is already saved
      log('error', 'save_sync_failed', {
        stage: 'sync',
        itemId: item.id,
        url: item.url,
        title: item.title,
        ...formatError(syncError)
      });
    }

    return jsonResponse(
      { ok: true, item },
      { status: 201, cache: 'no-store' }
    );
  } catch (error) {
    log('error', 'save_failed', {
      stage: 'save',
      url: normalizedUrl,
      title,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Failed to save item' },
      { status: 500, cache: 'no-store' }
    );
  }
}

async function handleUpdate(request, kv, log) {
  const payload = await parseJson(request);
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  const read = payload?.read;

  if (!id || typeof read !== 'boolean') {
    log('warn', 'update_invalid_payload', {
      stage: 'update',
      itemId: id || null
    });
    return jsonResponse(
      { ok: false, error: 'Invalid payload' },
      { status: 400, cache: 'no-store' }
    );
  }

  try {
    const key = `${KV_PREFIX}${id}`;
    const item = await kv.get(key, { type: 'json' });

    if (!item) {
      log('warn', 'update_item_missing', {
        stage: 'update',
        itemId: id
      });
      return jsonResponse(
        { ok: false, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    item.read = read;
    item.readAt = read ? new Date().toISOString() : null;
    await kv.put(key, JSON.stringify(item));

    return jsonResponse(
      { ok: true, item },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    log('error', 'update_failed', {
      stage: 'update',
      itemId: id,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Failed to update item' },
      { status: 500, cache: 'no-store' }
    );
  }
}

async function handleDelete(request, kv, log) {
  const payload = await parseJson(request);
  const idFromQuery = new URL(request.url).searchParams.get('id');
  const id = typeof payload?.id === 'string' ? payload.id.trim() : (idFromQuery || '').trim();

  if (!id) {
    log('warn', 'delete_invalid_payload', {
      stage: 'delete'
    });
    return jsonResponse(
      { ok: false, error: 'Invalid payload' },
      { status: 400, cache: 'no-store' }
    );
  }

  try {
    const key = `${KV_PREFIX}${id}`;
    const item = await kv.get(key, { type: 'json' });

    if (!item) {
      log('warn', 'delete_item_missing', {
        stage: 'delete',
        itemId: id
      });
      return jsonResponse(
        { ok: false, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    await kv.delete(key);
    return jsonResponse(
      { ok: true, item },
      { status: 200, cache: 'no-store' }
    );
  } catch (error) {
    log('error', 'delete_failed', {
      stage: 'delete',
      itemId: id,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Failed to delete item' },
      { status: 500, cache: 'no-store' }
    );
  }
}

async function listAllItems(kv) {
  const items = [];
  let cursor = undefined;

  do {
    const response = await kv.list({ prefix: KV_PREFIX, cursor });
    const values = await Promise.all(
      response.keys.map((key) => kv.get(key.name, { type: 'json' }))
    );

    values.filter(Boolean).forEach((value) => items.push(value));
    cursor = response.list_complete ? undefined : response.cursor;
  } while (cursor);

  return items;
}

async function findItemByUrl(kv, url) {
  const items = await listAllItems(kv);
  return items.find((item) => item.url === url) || null;
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
  progress = null
}) {
  return {
    id,
    url,
    title,
    savedAt,
    read,
    readAt: read ? readAt || new Date().toISOString() : null,
    progress
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

async function handleSaveStream(request, kv, env, log) {
  const stream = createEventStream(log);

  (async () => {
    let savedItem = null;

    try {
      const payload = await parseJson(request);
      const normalizedUrl = normalizeUrl(payload?.url);
      const incomingRead = payload?.read;

      if (!normalizedUrl) {
        log('warn', 'save_stream_invalid_url', {
          stage: 'save',
          url: payload?.url || null,
          title: payload?.title || null
        });
        await stream.send('error', { ok: false, error: 'Invalid URL' });
        return;
      }

      const title = normalizeTitle(payload?.title, normalizedUrl);
      const read = typeof incomingRead === 'boolean' ? incomingRead : false;

      const existingItem = await findItemByUrl(kv, normalizedUrl);
      if (existingItem) {
        const wasRead = existingItem.read;
        existingItem.savedAt = new Date().toISOString();
        existingItem.read = false;
        existingItem.readAt = null;
        if (payload?.title) {
          existingItem.title = title;
        }

        await kv.put(`${KV_PREFIX}${existingItem.id}`, JSON.stringify(existingItem));
        log('info', 'save_stream_duplicate', {
          stage: 'save',
          itemId: existingItem.id,
          url: normalizedUrl,
          title: existingItem.title,
          unarchived: wasRead
        });
        await stream.send('done', {
          ok: true,
          item: existingItem,
          duplicate: true,
          unarchived: wasRead
        });
        return;
      }

      // Save basic item FIRST - this ensures we never lose the URL/title
      const item = createItem({ url: normalizedUrl, title, read });
      await kv.put(`${KV_PREFIX}${item.id}`, JSON.stringify(item));
      savedItem = item;
      log('info', 'save_stream_persisted', {
        stage: 'save',
        itemId: item.id,
        url: item.url,
        title: item.title
      });

      // Notify client that item is safely saved
      await stream.send('saved', { ok: true, item: { ...item } });

      // Now do expensive work (cover generation, kindle sync)
      await stream.send('status', { ok: true, message: 'Generating cover' });

      try {
        const { reader, kindle, cover } = await syncKindleForItem(item, env, {
          kv,
          log,
          onCoverPartial: async (partial) => {
            await stream.send('partial_image', {
              index: partial.index,
              image: partial.base64
            });
          }
        });

        const resolvedTitle = preferReaderTitle(item.title, reader?.title, item.url);
        if (resolvedTitle && resolvedTitle !== item.title) {
          item.title = resolvedTitle;
        }
        item.kindle = kindle;
        if (cover?.createdAt) {
          item.cover = { updatedAt: cover.createdAt };
        }

        // Update item with kindle/cover info
        await kv.put(`${KV_PREFIX}${item.id}`, JSON.stringify(item));
        if (reader && shouldCacheKindleReader(reader)) {
          await cacheReader(kv, item.id, reader);
        }
        log('info', 'save_stream_sync_complete', {
          stage: 'sync',
          itemId: item.id,
          url: item.url,
          title: item.title,
          kindleStatus: kindle?.status || null,
          coverCreatedAt: cover?.createdAt || null
        });
      } catch (syncError) {
        // Log but don't fail - basic item is already saved
        log('error', 'save_stream_sync_failed', {
          stage: 'sync',
          itemId: item.id,
          url: item.url,
          title: item.title,
          ...formatError(syncError)
        });
      }

      await stream.send('done', { ok: true, item });
    } catch (error) {
      log('error', 'save_stream_failed', {
        stage: 'save',
        itemId: savedItem?.id || null,
        url: savedItem?.url || null,
        title: savedItem?.title || null,
        ...formatError(error)
      });
      // If we already saved the item, send it even though there was an error
      if (savedItem) {
        await stream.send('done', { ok: true, item: savedItem, syncFailed: true });
      } else {
        await stream.send('error', { ok: false, error: 'Failed to save item' });
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

export {
  createItem,
  createId,
  normalizeTitle,
  normalizeUrl,
  deriveTitleFromUrl,
  preferReaderTitle
};
