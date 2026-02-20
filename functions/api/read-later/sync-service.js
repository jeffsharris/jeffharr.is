import { preferReaderTitle } from './reader-utils.js';
import { cacheReader } from './reader.js';
import { syncKindleForItem, shouldCacheKindleReader, KINDLE_STATUS } from './kindle.js';
import { formatError } from '../lib/logger.js';

const KV_PREFIX = 'item:';
const SYNC_QUEUE_BINDING = 'READ_LATER_SYNC_QUEUE';
const DEFAULT_MAX_ATTEMPTS = 3;
const MAX_MAX_ATTEMPTS = 5;
const RETRY_DELAYS_SECONDS = [30, 120];

function getNowIso() {
  return new Date().toISOString();
}

function clampAttempts(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(parsed, MAX_MAX_ATTEMPTS);
}

function createSyncVersion() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `sync_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function addSeconds(iso, seconds) {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return null;
  return new Date(base + seconds * 1000).toISOString();
}

function getQueue(env) {
  return env?.[SYNC_QUEUE_BINDING] || null;
}

function getRetryDelaySeconds(attempt) {
  if (attempt <= 0) return RETRY_DELAYS_SECONDS[0];
  const index = Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1);
  return RETRY_DELAYS_SECONDS[index];
}

function shouldSkipQueue(item, force = false) {
  if (!item?.id) return true;
  if (force) return false;

  const status = item?.kindle?.status || null;
  if (status === KINDLE_STATUS.UNSUPPORTED) {
    return true;
  }

  // If the item is fully synced and has a cover, no need to enqueue again.
  if (status === KINDLE_STATUS.SYNCED && item?.cover?.updatedAt) {
    return true;
  }

  return false;
}

function buildPendingKindleState(existing, { now, maxAttempts, syncVersion }) {
  return {
    status: 'pending',
    lastAttemptAt: existing?.lastAttemptAt || null,
    lastSyncedAt: existing?.lastSyncedAt || null,
    lastError: null,
    errorCode: null,
    retryable: true,
    attempt: 0,
    maxAttempts,
    nextRetryAt: now,
    queuedAt: now,
    updatedAt: now,
    syncVersion
  };
}

function buildQueueConfigFailureState(existing, now, message, syncVersion, maxAttempts) {
  return {
    status: KINDLE_STATUS.FAILED,
    lastAttemptAt: existing?.lastAttemptAt || now,
    lastSyncedAt: existing?.lastSyncedAt || null,
    lastError: message,
    errorCode: 'sync_queue_unavailable',
    retryable: false,
    attempt: existing?.attempt || 0,
    maxAttempts,
    nextRetryAt: null,
    queuedAt: existing?.queuedAt || now,
    updatedAt: now,
    syncVersion
  };
}

function withAttemptMetadata(kindle, {
  now,
  attempt,
  maxAttempts,
  syncVersion,
  queuedAt,
  status,
  nextRetryAt
}) {
  return {
    status: status || kindle?.status || KINDLE_STATUS.FAILED,
    lastAttemptAt: kindle?.lastAttemptAt || now,
    lastSyncedAt: kindle?.lastSyncedAt || null,
    lastError: kindle?.lastError || null,
    errorCode: kindle?.errorCode || null,
    retryable: kindle?.retryable !== false,
    attempt,
    maxAttempts,
    nextRetryAt: nextRetryAt || null,
    queuedAt: queuedAt || now,
    updatedAt: now,
    syncVersion
  };
}

function shouldRetry(kindle, attempt, maxAttempts) {
  if (!kindle) return false;
  if (attempt >= maxAttempts) return false;

  const status = kindle.status;
  if (status === KINDLE_STATUS.SYNCED || status === KINDLE_STATUS.UNSUPPORTED) {
    return false;
  }

  return kindle.retryable !== false;
}

async function sendSyncMessage(queue, payload, delaySeconds = 0) {
  const body = JSON.stringify(payload);
  if (delaySeconds > 0) {
    await queue.send(body, { delaySeconds });
    return;
  }
  await queue.send(body);
}

function parseMessageBody(message) {
  if (!message) return null;

  if (typeof message.body === 'string') {
    try {
      return JSON.parse(message.body);
    } catch {
      return null;
    }
  }

  if (message.body && typeof message.body === 'object') {
    return message.body;
  }

  return null;
}

function isCurrentSyncVersion(item, syncVersion) {
  if (!syncVersion) return true;
  const current = item?.kindle?.syncVersion;
  if (!current) return true;
  return current === syncVersion;
}

async function saveItem(kv, item) {
  await kv.put(`${KV_PREFIX}${item.id}`, JSON.stringify(item));
}

async function enqueueKindleSync({
  item,
  kv,
  env,
  log,
  reason = 'save',
  force = false,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  if (!kv || !item?.id) {
    return { queued: false, item };
  }

  if (shouldSkipQueue(item, force)) {
    return { queued: false, skipped: true, item };
  }

  const attemptLimit = clampAttempts(maxAttempts);
  const now = getNowIso();
  const syncVersion = createSyncVersion();

  item.kindle = buildPendingKindleState(item.kindle, {
    now,
    maxAttempts: attemptLimit,
    syncVersion
  });
  await saveItem(kv, item);

  const queue = getQueue(env);
  if (!queue) {
    item.kindle = buildQueueConfigFailureState(
      item.kindle,
      now,
      'Background sync queue is not configured',
      syncVersion,
      attemptLimit
    );
    await saveItem(kv, item);

    if (log) {
      log('error', 'kindle_sync_queue_missing', {
        stage: 'queue',
        itemId: item.id,
        url: item.url,
        title: item.title,
        reason
      });
    }

    return { queued: false, queueMissing: true, item };
  }

  try {
    await sendSyncMessage(queue, {
      itemId: item.id,
      attempt: 1,
      maxAttempts: attemptLimit,
      syncVersion,
      reason,
      queuedAt: now
    });

    if (log) {
      log('info', 'kindle_sync_queued', {
        stage: 'queue',
        itemId: item.id,
        url: item.url,
        title: item.title,
        attempt: 1,
        maxAttempts: attemptLimit,
        reason,
        syncVersion
      });
    }

    return { queued: true, item };
  } catch (error) {
    item.kindle = buildQueueConfigFailureState(
      item.kindle,
      now,
      'Failed to queue background sync',
      syncVersion,
      attemptLimit
    );
    await saveItem(kv, item);

    if (log) {
      log('error', 'kindle_sync_queue_failed', {
        stage: 'queue',
        itemId: item.id,
        url: item.url,
        title: item.title,
        reason,
        syncVersion,
        ...formatError(error)
      });
    }

    return { queued: false, queueFailed: true, item };
  }
}

async function processKindleSyncBatch(batch, env, log) {
  const messages = Array.isArray(batch?.messages) ? batch.messages : [];
  for (const message of messages) {
    try {
      await processKindleSyncMessage(message, env, log);
    } catch (error) {
      if (log) {
        log('error', 'kindle_sync_worker_failed', {
          stage: 'queue',
          ...formatError(error)
        });
      }
    }
  }
}

async function processKindleSyncMessage(message, env, log) {
  const payload = parseMessageBody(message);
  const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : '';
  const syncVersion = typeof payload?.syncVersion === 'string' ? payload.syncVersion.trim() : '';
  const attempt = Math.max(1, Number.parseInt(payload?.attempt, 10) || 1);
  const maxAttempts = clampAttempts(payload?.maxAttempts);

  if (!itemId) {
    if (log) {
      log('warn', 'kindle_sync_invalid_message', {
        stage: 'queue'
      });
    }
    return;
  }

  const kv = env?.READ_LATER;
  if (!kv) {
    if (log) {
      log('error', 'storage_unavailable', {
        stage: 'queue',
        itemId
      });
    }
    return;
  }

  const key = `${KV_PREFIX}${itemId}`;
  const item = await kv.get(key, { type: 'json' });
  if (!item) {
    if (log) {
      log('warn', 'kindle_sync_item_missing', {
        stage: 'queue',
        itemId
      });
    }
    return;
  }

  if (!isCurrentSyncVersion(item, syncVersion)) {
    if (log) {
      log('info', 'kindle_sync_stale_message', {
        stage: 'queue',
        itemId,
        syncVersion,
        currentSyncVersion: item?.kindle?.syncVersion || null
      });
    }
    return;
  }

  const queuedAt = item?.kindle?.queuedAt || payload?.queuedAt || getNowIso();

  if (log) {
    log('info', 'kindle_sync_attempt_started', {
      stage: 'sync',
      itemId,
      url: item.url,
      title: item.title,
      attempt,
      maxAttempts,
      syncVersion
    });
  }

  const { reader, kindle, cover } = await syncKindleForItem(item, env, { kv, log });

  const resolvedTitle = preferReaderTitle(item.title, reader?.title, item.url);

  if (reader && shouldCacheKindleReader(reader)) {
    await cacheReader(kv, itemId, reader);
  }

  const latestItem = await kv.get(key, { type: 'json' });
  if (!latestItem) {
    if (log) {
      log('warn', 'kindle_sync_item_missing', {
        stage: 'queue',
        itemId
      });
    }
    return;
  }

  if (!isCurrentSyncVersion(latestItem, syncVersion)) {
    if (log) {
      log('info', 'kindle_sync_stale_message', {
        stage: 'queue',
        itemId,
        syncVersion,
        currentSyncVersion: latestItem?.kindle?.syncVersion || null
      });
    }
    return;
  }

  if (resolvedTitle && resolvedTitle !== latestItem.title) {
    latestItem.title = resolvedTitle;
  }

  if (cover?.createdAt) {
    latestItem.cover = { updatedAt: cover.createdAt };
  }

  const now = getNowIso();
  const retry = shouldRetry(kindle, attempt, maxAttempts);

  if (retry) {
    const delaySeconds = getRetryDelaySeconds(attempt);
    const nextRetryAt = addSeconds(now, delaySeconds);
    const retryState = withAttemptMetadata(kindle, {
      now,
      attempt,
      maxAttempts,
      syncVersion,
      queuedAt,
      status: 'retrying',
      nextRetryAt
    });

    latestItem.kindle = retryState;
    await saveItem(kv, latestItem);

    const queue = getQueue(env);
    if (!queue) {
      latestItem.kindle = {
        ...retryState,
        status: KINDLE_STATUS.FAILED,
        lastError: 'Retry queue unavailable',
        errorCode: 'sync_queue_unavailable',
        retryable: false,
        nextRetryAt: null,
        updatedAt: now
      };
      await saveItem(kv, latestItem);
      if (log) {
        log('error', 'kindle_sync_retry_queue_missing', {
          stage: 'queue',
          itemId,
          url: latestItem.url,
          title: latestItem.title,
          attempt,
          maxAttempts,
          syncVersion
        });
      }
      return;
    }

    try {
      await sendSyncMessage(queue, {
        itemId,
        attempt: attempt + 1,
        maxAttempts,
        syncVersion,
        reason: 'retry',
        queuedAt
      }, delaySeconds);

      if (log) {
        log('info', 'kindle_sync_retry_scheduled', {
          stage: 'queue',
          itemId,
          url: latestItem.url,
          title: latestItem.title,
          attempt,
          maxAttempts,
          delaySeconds,
          nextRetryAt,
          syncVersion,
          kindleStatus: kindle?.status || null,
          errorCode: kindle?.errorCode || null
        });
      }
      return;
    } catch (error) {
      latestItem.kindle = {
        ...retryState,
        status: KINDLE_STATUS.FAILED,
        lastError: 'Retry queue failed',
        errorCode: 'sync_retry_queue_failed',
        retryable: false,
        nextRetryAt: null,
        updatedAt: now
      };
      await saveItem(kv, latestItem);
      if (log) {
        log('error', 'kindle_sync_retry_enqueue_failed', {
          stage: 'queue',
          itemId,
          url: latestItem.url,
          title: latestItem.title,
          attempt,
          maxAttempts,
          syncVersion,
          ...formatError(error)
        });
      }
      return;
    }
  }

  latestItem.kindle = withAttemptMetadata(kindle, {
    now,
    attempt,
    maxAttempts,
    syncVersion,
    queuedAt,
    status: kindle?.status,
    nextRetryAt: null
  });
  await saveItem(kv, latestItem);

  if (log) {
    log('info', 'kindle_sync_attempt_complete', {
      stage: 'sync',
      itemId,
      url: latestItem.url,
      title: latestItem.title,
      attempt,
      maxAttempts,
      syncVersion,
      kindleStatus: latestItem.kindle?.status || null,
      errorCode: latestItem.kindle?.errorCode || null,
      retryable: latestItem.kindle?.retryable !== false,
      coverCreatedAt: cover?.createdAt || null
    });
  }
}

export {
  DEFAULT_MAX_ATTEMPTS,
  enqueueKindleSync,
  processKindleSyncBatch
};
