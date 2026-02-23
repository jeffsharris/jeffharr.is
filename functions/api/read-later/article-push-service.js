import { deriveTitleFromUrl, shouldCacheReader } from './reader-utils.js';
import { formatError } from '../lib/logger.js';
import { getOwnerId } from '../push/device-store.js';

const KV_ITEM_PREFIX = 'item:';
const KV_READER_PREFIX = 'reader:';
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

function normalizePushChannels(item, now = getNowIso()) {
  const base = item?.pushChannels && typeof item.pushChannels === 'object' ? item.pushChannels : {};

  const readiness = base.readiness && typeof base.readiness === 'object'
    ? base.readiness
    : {};
  const kindle = base.kindle && typeof base.kindle === 'object'
    ? base.kindle
    : {};
  const ios = base.ios && typeof base.ios === 'object'
    ? base.ios
    : {};

  return {
    readiness: {
      status: readiness.status === 'ready' ? 'ready' : 'pending',
      readyAt: readiness.readyAt || null,
      reason: readiness.status === 'ready'
        ? null
        : (readiness.reason || 'waiting_for_reader_and_cover')
    },
    kindle: {
      status: normalizeChannelStatus(kindle.status),
      updatedAt: kindle.updatedAt || now,
      lastError: kindle.lastError || null
    },
    ios: {
      status: normalizeChannelStatus(ios.status),
      updatedAt: ios.updatedAt || now,
      eventId: ios.eventId || null,
      lastError: ios.lastError || null
    }
  };
}

function normalizeChannelStatus(status) {
  if (status === 'sent' || status === 'failed' || status === 'skipped' || status === 'queued') {
    return status;
  }
  return 'pending';
}

function createInitialPushChannels(now = getNowIso()) {
  return {
    readiness: {
      status: 'pending',
      readyAt: null,
      reason: 'waiting_for_reader_and_cover'
    },
    kindle: {
      status: 'pending',
      updatedAt: now,
      lastError: null
    },
    ios: {
      status: 'pending',
      updatedAt: now,
      eventId: null,
      lastError: null
    }
  };
}

function ensurePushChannels(item, now = getNowIso()) {
  const channels = normalizePushChannels(item, now);
  if (item && typeof item === 'object') {
    item.pushChannels = channels;
  }
  return channels;
}

function buildReadinessReason({ readerReady, coverReady }) {
  if (readerReady && coverReady) return null;
  if (!readerReady && !coverReady) return 'waiting_for_reader_and_cover';
  if (!readerReady) return 'waiting_for_reader';
  return 'waiting_for_cover';
}

async function saveItem(kv, item) {
  await kv.put(`${KV_ITEM_PREFIX}${item.id}`, JSON.stringify(item));
}

function mapKindleStatusToChannelStatus(kindleStatus) {
  if (kindleStatus === 'synced') return 'sent';
  if (kindleStatus === 'failed') return 'failed';
  if (kindleStatus === 'unsupported' || kindleStatus === 'needs-content') return 'skipped';
  return 'pending';
}

function recordKindleChannelState(item, kindleState, now = getNowIso()) {
  if (!item || typeof item !== 'object') return item;
  ensurePushChannels(item, now);

  const mappedStatus = mapKindleStatusToChannelStatus(kindleState?.status || null);
  item.pushChannels.kindle = {
    status: mappedStatus,
    updatedAt: now,
    lastError: mappedStatus === 'failed'
      ? (kindleState?.lastError || 'Kindle sync failed')
      : null
  };

  return item;
}

async function updateArticlePushReadiness(itemId, kv, log) {
  if (!kv || !itemId) {
    return {
      ok: false,
      item: null,
      ready: false,
      readerReady: false,
      coverReady: false,
      reason: 'missing_context'
    };
  }

  const key = `${KV_ITEM_PREFIX}${itemId}`;
  const item = await kv.get(key, { type: 'json' });
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

  const reader = await kv.get(`${KV_READER_PREFIX}${itemId}`, { type: 'json' });
  const readerReady = shouldCacheReader(reader);
  const coverReady = Boolean(item?.cover?.updatedAt);
  const ready = readerReady && coverReady;
  const reason = buildReadinessReason({ readerReady, coverReady });

  item.pushChannels.readiness = {
    status: ready ? 'ready' : 'pending',
    readyAt: ready ? (item.pushChannels.readiness.readyAt || now) : null,
    reason: ready ? null : reason
  };

  await saveItem(kv, item);

  if (log) {
    log('info', 'article_push_readiness_updated', {
      stage: 'push_readiness',
      itemId,
      ready,
      readerReady,
      coverReady,
      reason
    });
  }

  return {
    ok: true,
    item,
    ready,
    readerReady,
    coverReady,
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

async function maybeQueueIosPush({ item, env, kv, log, source = 'unknown' }) {
  if (!kv || !item?.id) {
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
    await saveItem(kv, item);

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
    await saveItem(kv, item);

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
    await saveItem(kv, item);

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
  createInitialPushChannels,
  ensurePushChannels,
  recordKindleChannelState,
  updateArticlePushReadiness,
  maybeQueueIosPush
};
