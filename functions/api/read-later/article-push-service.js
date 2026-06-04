import { deriveTitleFromUrl, shouldCacheReader } from './reader-utils.js';
import { getReadLaterAssetItemId } from './asset-store.js';
import { isLikelyPdfUrl } from './pdf-utils.js';
import { ensurePushChannels } from './state.js';
import { formatError } from '../lib/logger.js';
import { getOwnerId } from '../push/device-store.js';

const PUSH_QUEUE_BINDING = 'PUSH_DELIVERY_QUEUE';
const PUSH_NOTIFICATION_MESSAGE_TYPE = 'push.notification.requested';
const DEFAULT_PUBLIC_ORIGIN = 'https://jeffharr.is';

function getNowIso() {
  return new Date().toISOString();
}

function createEventId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `push_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeOrigin(value) {
  if (typeof value !== 'string') return DEFAULT_PUBLIC_ORIGIN;
  const trimmed = value.trim();
  if (!trimmed) return DEFAULT_PUBLIC_ORIGIN;
  return trimmed.replace(/\/+$/, '');
}

function parseDomain(url) {
  if (typeof url !== 'string') return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}

function isTerminalCoverSyncFailure(item) {
  return item?.coverSync?.status === 'failed';
}

function buildReadinessReason({ readerReady, coverReady, coverTerminal }) {
  const coverDone = coverReady || coverTerminal;
  if (readerReady && coverDone) return null;
  if (!readerReady && !coverDone) return 'waiting_for_reader_and_cover';
  if (!readerReady) return 'waiting_for_reader';
  return 'waiting_for_cover';
}

async function saveItem(readLaterStore, item) {
  await readLaterStore.saveItem(item);
}

async function updateArticlePushReadiness(itemId, stores = {}, log) {
  const { readLaterStore, assetStore } = stores || {};
  if (!readLaterStore || !assetStore || !itemId) {
    return {
      ok: false,
      item: null,
      ready: false,
      readerReady: false,
      coverReady: false,
      reason: 'missing_context'
    };
  }

  const item = await readLaterStore.getItem(itemId);
  if (!item) {
    return {
      ok: false,
      item: null,
      ready: false,
      readerReady: false,
      coverReady: false,
      reason: 'item_missing'
    };
  }

  const now = getNowIso();
  ensurePushChannels(item, now);

  const isPdf = isLikelyPdfUrl(item.url);
  const reader = isPdf ? null : await assetStore.getReader(getReadLaterAssetItemId(item));
  const readerReady = isPdf || shouldCacheReader(reader);
  const coverReady = Boolean(item?.cover?.updatedAt);
  const coverTerminal = isTerminalCoverSyncFailure(item);
  const ready = readerReady && (coverReady || coverTerminal);
  const reason = buildReadinessReason({ readerReady, coverReady, coverTerminal });

  item.pushChannels.readiness = {
    status: ready ? 'ready' : 'pending',
    readyAt: ready ? (item.pushChannels.readiness.readyAt || now) : null,
    reason: ready ? null : reason
  };

  await saveItem(readLaterStore, item);

  if (log) {
    log('info', 'article_push_readiness_updated', {
      stage: 'push_readiness',
      itemId,
      ready,
      readerReady,
      coverReady,
      isPdf,
      reason
    });
  }

  return {
    ok: true,
    item,
    ready,
    readerReady,
    coverReady,
    coverTerminal,
    isPdf,
    reason
  };
}

function buildIosPayload(item, env, eventId) {
  const origin = normalizeOrigin(env?.READ_LATER_PUBLIC_ORIGIN || DEFAULT_PUBLIC_ORIGIN);
  const coverUpdatedAt = item?.cover?.updatedAt || null;
  let coverURL = null;
  if (coverUpdatedAt && item?.id) {
    const url = new URL('/api/read-later/cover', origin);
    url.searchParams.set('id', item.id);
    url.searchParams.set('v', coverUpdatedAt);
    coverURL = url.toString();
  }

  const title = item.title || deriveTitleFromUrl(item.url || '');
  const domain = parseDomain(item.url) || null;
  const media = coverURL
    ? [{ type: 'image', url: coverURL, purpose: 'cover' }]
    : [];

  return {
    type: PUSH_NOTIFICATION_MESSAGE_TYPE,
    source: 'read-later',
    ownerId: getOwnerId(env),
    itemId: item.id,
    eventId,
    savedAt: item.savedAt || getNowIso(),
    notification: {
      alert: {
        title: 'Saved to Read Later',
        subtitle: domain || 'Read Later',
        body: title
      },
      threadId: 'read-later',
      category: 'read-later',
      media
    },
    data: {
      channel: 'read-later',
      itemId: item.id,
      url: item.url || null
    }
  };
}

async function maybeQueueIosPush({ item, env, readLaterStore, log, source = 'unknown' }) {
  if (!readLaterStore || !item?.id) {
    return { queued: false, item, reason: 'missing_context' };
  }

  const now = getNowIso();
  ensurePushChannels(item, now);

  if (item.pushChannels.readiness.status !== 'ready') {
    return { queued: false, item, reason: 'not_ready' };
  }

  const iosStatus = item.pushChannels.ios.status;
  if (iosStatus === 'queued' || iosStatus === 'sent') {
    return { queued: false, item, reason: 'already_queued_or_sent' };
  }

  const queue = env?.[PUSH_QUEUE_BINDING] || null;
  if (!queue) {
    item.pushChannels.ios = {
      ...item.pushChannels.ios,
      status: 'failed',
      updatedAt: now,
      lastError: 'Background queue unavailable for iOS push'
    };
    await saveItem(readLaterStore, item);

    if (log) {
      log('error', 'ios_push_queue_missing', {
        stage: 'queue',
        itemId: item.id,
        source
      });
    }

    return { queued: false, item, reason: 'queue_missing' };
  }

  const eventId = createEventId();
  const payload = buildIosPayload(item, env, eventId);

  try {
    await queue.send(JSON.stringify(payload));

    item.pushChannels.ios = {
      ...item.pushChannels.ios,
      status: 'queued',
      updatedAt: now,
      eventId,
      lastError: null
    };
    await saveItem(readLaterStore, item);

    if (log) {
      log('info', 'ios_push_queued', {
        stage: 'queue',
        itemId: item.id,
        source,
        eventId
      });
    }

    return { queued: true, item, eventId };
  } catch (error) {
    item.pushChannels.ios = {
      ...item.pushChannels.ios,
      status: 'failed',
      updatedAt: now,
      eventId,
      lastError: 'Failed to enqueue iOS push'
    };
    await saveItem(readLaterStore, item);

    if (log) {
      log('error', 'ios_push_queue_failed', {
        stage: 'queue',
        itemId: item.id,
        source,
        eventId,
        ...formatError(error)
      });
    }

    return { queued: false, item, reason: 'queue_failed', eventId };
  }
}

export {
  PUSH_NOTIFICATION_MESSAGE_TYPE,
  updateArticlePushReadiness,
  maybeQueueIosPush
};
