import { preferReaderTitle } from './reader-utils.js';
import {
  maybeQueueIosPush,
  updateArticlePushReadiness
} from './article-push-service.js';
import { buildReaderContent, fetchAndCacheReader } from './reader.js';
import { getCoverImage, ensureCoverImage } from './covers.js';
import { isXStatusUrl } from './x-adapter.js';
import { formatError } from '../lib/logger.js';

const KV_PREFIX = 'item:';
const SYNC_QUEUE_BINDING = 'READ_LATER_SYNC_QUEUE';
const COVER_MESSAGE_TYPE = 'cover-sync';
const DEFAULT_MAX_ATTEMPTS = 2;
const MAX_MAX_ATTEMPTS = 4;
const RETRY_DELAYS_SECONDS = [20, 60, 150];
const STALE_ACTIVE_SYNC_MS = 5 * 60 * 1000;

const COVER_SYNC_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  RETRYING: 'retrying',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed'
};

function getNowIso() {
  return new Date().toISOString();
}

function clampAttempts(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_MAX_ATTEMPTS;
  return Math.min(parsed, MAX_MAX_ATTEMPTS);
}

function addSeconds(iso, seconds) {
  const base = Date.parse(iso);
  if (!Number.isFinite(base)) return null;
  return new Date(base + seconds * 1000).toISOString();
}

function createCoverJobId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cover_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getQueue(env) {
  return env?.[SYNC_QUEUE_BINDING] || null;
}

function getRetryDelaySeconds(attempt) {
  if (attempt <= 0) return RETRY_DELAYS_SECONDS[0];
  const index = Math.min(attempt - 1, RETRY_DELAYS_SECONDS.length - 1);
  return RETRY_DELAYS_SECONDS[index];
}

function isCoverSyncActive(item) {
  const status = item?.coverSync?.status;
  return (
    status === COVER_SYNC_STATUS.PENDING ||
    status === COVER_SYNC_STATUS.PROCESSING ||
    status === COVER_SYNC_STATUS.RETRYING
  );
}

function isStaleActiveCoverSync(item, nowMs = Date.now()) {
  if (!isCoverSyncActive(item)) return false;
  const updatedAt = Date.parse(item?.coverSync?.updatedAt || item?.coverSync?.queuedAt || '');
  if (!Number.isFinite(updatedAt)) return false;
  return nowMs - updatedAt > STALE_ACTIVE_SYNC_MS;
}

function isCurrentCoverJob(item, jobId) {
  if (!jobId) return true;
  const current = item?.coverSync?.jobId;
  if (!current) return true;
  return current === jobId;
}

function compactError(error) {
  if (!error) return 'Unknown error';
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 320) || 'Unknown error';
}

function classifyCoverError(error) {
  const message = compactError(error);
  const lowered = message.toLowerCase();

  if (!message || message === 'Unknown error') {
    return {
      errorCode: 'cover_generation_failed',
      retryable: true,
      message: 'Cover generation failed'
    };
  }

  if (lowered.includes('api key') || lowered.includes('not configured')) {
    return {
      errorCode: 'cover_api_key_missing',
      retryable: false,
      message
    };
  }

  if (/(abort|timeout|timed out|network|connection reset|cloudflare| 5\d\d\b| 429\b)/i.test(message)) {
    return {
      errorCode: 'cover_generation_upstream',
      retryable: true,
      message
    };
  }

  if (lowered.includes('reader') && lowered.includes('unavailable')) {
    return {
      errorCode: 'reader_unavailable',
      retryable: false,
      message
    };
  }

  return {
    errorCode: 'cover_generation_failed',
    retryable: false,
    message
  };
}

function buildPendingCoverState({ now, jobId, maxAttempts }) {
  return {
    status: COVER_SYNC_STATUS.PENDING,
    jobId,
    attempt: 0,
    maxAttempts,
    queuedAt: now,
    startedAt: null,
    completedAt: null,
    nextRetryAt: now,
    lastError: null,
    errorCode: null,
    retryable: true,
    updatedAt: now
  };
}

function buildCoverState(existing, {
  now,
  status,
  attempt,
  maxAttempts,
  jobId,
  queuedAt,
  startedAt,
  completedAt,
  nextRetryAt,
  lastError,
  errorCode,
  retryable
}) {
  return {
    status,
    jobId: jobId || existing?.jobId || null,
    attempt: Number.isFinite(attempt) ? attempt : Number(existing?.attempt || 0),
    maxAttempts: Number.isFinite(maxAttempts) ? maxAttempts : Number(existing?.maxAttempts || DEFAULT_MAX_ATTEMPTS),
    queuedAt: queuedAt || existing?.queuedAt || now,
    startedAt: startedAt || existing?.startedAt || null,
    completedAt: completedAt || null,
    nextRetryAt: nextRetryAt || null,
    lastError: lastError || null,
    errorCode: errorCode || null,
    retryable: retryable === true,
    updatedAt: now
  };
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

async function sendCoverMessage(queue, payload, delaySeconds = 0) {
  const body = JSON.stringify(payload);
  if (delaySeconds > 0) {
    await queue.send(body, { delaySeconds });
    return;
  }
  await queue.send(body);
}

async function saveItem(kv, item) {
  await kv.put(`${KV_PREFIX}${item.id}`, JSON.stringify(item));
}

async function enqueueCoverGeneration({
  item,
  kv,
  env,
  log,
  reason = 'manual-cover',
  force = false,
  maxAttempts = DEFAULT_MAX_ATTEMPTS
}) {
  if (!kv || !item?.id) {
    return { queued: false, item };
  }

  if (isCoverSyncActive(item)) {
    if (!isStaleActiveCoverSync(item)) {
      return { queued: false, inProgress: true, item };
    }
    if (log) {
      log('warn', 'cover_sync_stale_active_requeue', {
        stage: 'queue',
        itemId: item.id,
        url: item.url,
        title: item.title,
        currentStatus: item?.coverSync?.status || null,
        updatedAt: item?.coverSync?.updatedAt || null
      });
    }
  }

  if (item?.cover?.updatedAt && !force) {
    const existingCover = await getCoverImage(kv, item.id);
    if (existingCover?.base64) {
      return { queued: false, coverExists: true, item };
    }
  }

  const now = getNowIso();
  const attemptLimit = clampAttempts(maxAttempts);
  const jobId = createCoverJobId();

  item.coverSync = buildPendingCoverState({
    now,
    jobId,
    maxAttempts: attemptLimit
  });
  await saveItem(kv, item);

  const queue = getQueue(env);
  if (!queue) {
    item.coverSync = buildCoverState(item.coverSync, {
      now,
      status: COVER_SYNC_STATUS.FAILED,
      attempt: 0,
      maxAttempts: attemptLimit,
      jobId,
      queuedAt: now,
      completedAt: now,
      nextRetryAt: null,
      lastError: 'Background cover queue is not configured',
      errorCode: 'cover_queue_unavailable',
      retryable: false
    });
    await saveItem(kv, item);

    if (log) {
      log('error', 'cover_sync_queue_missing', {
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
    await sendCoverMessage(queue, {
      type: COVER_MESSAGE_TYPE,
      itemId: item.id,
      jobId,
      attempt: 1,
      maxAttempts: attemptLimit,
      reason,
      queuedAt: now
    });

    if (log) {
      log('info', 'cover_sync_queued', {
        stage: 'queue',
        itemId: item.id,
        url: item.url,
        title: item.title,
        attempt: 1,
        maxAttempts: attemptLimit,
        reason,
        jobId
      });
    }

    return { queued: true, item };
  } catch (error) {
    item.coverSync = buildCoverState(item.coverSync, {
      now,
      status: COVER_SYNC_STATUS.FAILED,
      attempt: 0,
      maxAttempts: attemptLimit,
      jobId,
      queuedAt: now,
      completedAt: now,
      nextRetryAt: null,
      lastError: 'Failed to queue cover generation',
      errorCode: 'cover_queue_failed',
      retryable: false
    });
    await saveItem(kv, item);

    if (log) {
      log('error', 'cover_sync_queue_failed', {
        stage: 'queue',
        itemId: item.id,
        url: item.url,
        title: item.title,
        reason,
        jobId,
        ...formatError(error)
      });
    }

    return { queued: false, queueFailed: true, item };
  }
}

async function processCoverSyncBatch(batch, env, log) {
  const messages = Array.isArray(batch?.messages) ? batch.messages : [];
  for (const message of messages) {
    try {
      await processCoverSyncMessage(message, env, log);
    } catch (error) {
      if (log) {
        log('error', 'cover_sync_worker_failed', {
          stage: 'queue',
          ...formatError(error)
        });
      }
    }
  }
}

async function processCoverSyncMessage(message, env, log) {
  const payload = parseMessageBody(message);
  const itemId = typeof payload?.itemId === 'string' ? payload.itemId.trim() : '';
  const jobId = typeof payload?.jobId === 'string' ? payload.jobId.trim() : '';
  const attempt = Math.max(1, Number.parseInt(payload?.attempt, 10) || 1);
  const maxAttempts = clampAttempts(payload?.maxAttempts);
  const queuedAt = typeof payload?.queuedAt === 'string' ? payload.queuedAt : getNowIso();

  if (!itemId || !jobId) {
    if (log) {
      log('warn', 'cover_sync_invalid_message', {
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
      log('warn', 'cover_sync_item_missing', {
        stage: 'queue',
        itemId
      });
    }
    return;
  }

  if (!isCurrentCoverJob(item, jobId)) {
    if (log) {
      log('info', 'cover_sync_stale_message', {
        stage: 'queue',
        itemId,
        jobId,
        currentJobId: item?.coverSync?.jobId || null
      });
    }
    return;
  }

  const now = getNowIso();
  item.coverSync = buildCoverState(item.coverSync, {
    now,
    status: COVER_SYNC_STATUS.PROCESSING,
    attempt,
    maxAttempts,
    jobId,
    queuedAt,
    startedAt: item?.coverSync?.startedAt || now,
    nextRetryAt: null,
    lastError: null,
    errorCode: null,
    retryable: true
  });
  await saveItem(kv, item);

  if (!env?.OPENAI_API_KEY) {
    await markCoverSyncFailure({
      kv,
      env,
      itemId,
      jobId,
      attempt,
      maxAttempts,
      queuedAt,
      errorCode: 'cover_api_key_missing',
      message: 'Cover generation is not configured',
      retryable: false,
      log
    });
    return;
  }

  let reader = null;
  const forceReaderRefresh = isXStatusUrl(item.url);
  try {
    reader = await fetchAndCacheReader({
      kv,
      id: itemId,
      url: item.url,
      title: item.title,
      browser: env?.BROWSER,
      xBearerToken: env?.X_API_BEARER_TOKEN,
      forceRefresh: forceReaderRefresh,
      log
    });
    if (!reader?.contentHtml) {
      reader = await buildReaderContent(item.url, item.title, env?.BROWSER, {
        log,
        itemId,
        xBearerToken: env?.X_API_BEARER_TOKEN
      });
    }
  } catch (error) {
    const classified = classifyCoverError(error);
    await markCoverSyncFailure({
      kv,
      env,
      itemId,
      jobId,
      attempt,
      maxAttempts,
      queuedAt,
      errorCode: classified.errorCode || 'reader_fetch_failed',
      message: classified.message,
      retryable: classified.retryable,
      log
    });
    return;
  }

  if (!reader?.contentHtml) {
    await markCoverSyncFailure({
      kv,
      env,
      itemId,
      jobId,
      attempt,
      maxAttempts,
      queuedAt,
      errorCode: 'reader_unavailable',
      message: 'Could not parse article content',
      retryable: false,
      log
    });
    return;
  }

  let cover = null;
  try {
    cover = await ensureCoverImage({ item, reader, env, kv, log });
  } catch (error) {
    const classified = classifyCoverError(error);
    await markCoverSyncFailure({
      kv,
      env,
      itemId,
      jobId,
      attempt,
      maxAttempts,
      queuedAt,
      errorCode: classified.errorCode,
      message: classified.message,
      retryable: classified.retryable,
      log
    });
    return;
  }

  if (!cover?.createdAt) {
    await markCoverSyncFailure({
      kv,
      env,
      itemId,
      jobId,
      attempt,
      maxAttempts,
      queuedAt,
      errorCode: 'cover_missing_result',
      message: 'Cover generation returned no image output',
      retryable: true,
      log
    });
    return;
  }

  const latestItem = await kv.get(key, { type: 'json' });
  if (!latestItem) return;
  if (!isCurrentCoverJob(latestItem, jobId)) return;

  const resolvedTitle = preferReaderTitle(latestItem.title, reader?.title, latestItem.url);
  if (resolvedTitle && resolvedTitle !== latestItem.title) {
    latestItem.title = resolvedTitle;
  }

  latestItem.cover = { updatedAt: cover.createdAt };
  latestItem.coverSync = buildCoverState(latestItem.coverSync, {
    now: getNowIso(),
    status: COVER_SYNC_STATUS.SUCCEEDED,
    attempt,
    maxAttempts,
    jobId,
    queuedAt,
    startedAt: latestItem?.coverSync?.startedAt || now,
    completedAt: getNowIso(),
    nextRetryAt: null,
    lastError: null,
    errorCode: null,
    retryable: false
  });
  await saveItem(kv, latestItem);

  if (log) {
    log('info', 'cover_sync_complete', {
      stage: 'sync',
      itemId,
      url: latestItem.url,
      title: latestItem.title,
      attempt,
      maxAttempts,
      jobId,
      coverCreatedAt: cover.createdAt
    });
  }

  const readiness = await updateArticlePushReadiness(itemId, kv, log);
  if (readiness?.ready && readiness?.item) {
    await maybeQueueIosPush({
      item: readiness.item,
      env,
      kv,
      log,
      source: 'cover-sync-complete'
    });
  }
}

async function markCoverSyncFailure({
  kv,
  env,
  itemId,
  jobId,
  attempt,
  maxAttempts,
  queuedAt,
  errorCode,
  message,
  retryable,
  log
}) {
  const key = `${KV_PREFIX}${itemId}`;
  const latestItem = await kv.get(key, { type: 'json' });
  if (!latestItem) return;
  if (!isCurrentCoverJob(latestItem, jobId)) return;

  const now = getNowIso();
  const canRetry = retryable === true && attempt < maxAttempts;

  if (canRetry) {
    const delaySeconds = getRetryDelaySeconds(attempt);
    const nextRetryAt = addSeconds(now, delaySeconds);

    latestItem.coverSync = buildCoverState(latestItem.coverSync, {
      now,
      status: COVER_SYNC_STATUS.RETRYING,
      attempt,
      maxAttempts,
      jobId,
      queuedAt,
      startedAt: latestItem?.coverSync?.startedAt || now,
      nextRetryAt,
      lastError: message,
      errorCode,
      retryable: true
    });
    await saveItem(kv, latestItem);

    const queue = getQueue(env);
    if (!queue) {
      latestItem.coverSync = buildCoverState(latestItem.coverSync, {
        now: getNowIso(),
        status: COVER_SYNC_STATUS.FAILED,
        attempt,
        maxAttempts,
        jobId,
        queuedAt,
        startedAt: latestItem?.coverSync?.startedAt || now,
        completedAt: getNowIso(),
        nextRetryAt: null,
        lastError: 'Retry queue unavailable',
        errorCode: 'cover_queue_unavailable',
        retryable: false
      });
      await saveItem(kv, latestItem);
      return;
    }

    try {
      await sendCoverMessage(queue, {
        type: COVER_MESSAGE_TYPE,
        itemId,
        jobId,
        attempt: attempt + 1,
        maxAttempts,
        reason: 'retry',
        queuedAt
      }, delaySeconds);

      if (log) {
        log('info', 'cover_sync_retry_scheduled', {
          stage: 'queue',
          itemId,
          url: latestItem.url,
          title: latestItem.title,
          attempt,
          maxAttempts,
          delaySeconds,
          nextRetryAt,
          jobId,
          errorCode
        });
      }
      return;
    } catch (error) {
      latestItem.coverSync = buildCoverState(latestItem.coverSync, {
        now: getNowIso(),
        status: COVER_SYNC_STATUS.FAILED,
        attempt,
        maxAttempts,
        jobId,
        queuedAt,
        startedAt: latestItem?.coverSync?.startedAt || now,
        completedAt: getNowIso(),
        nextRetryAt: null,
        lastError: 'Failed to queue cover retry',
        errorCode: 'cover_retry_queue_failed',
        retryable: false
      });
      await saveItem(kv, latestItem);
      if (log) {
        log('error', 'cover_sync_retry_enqueue_failed', {
          stage: 'queue',
          itemId,
          url: latestItem.url,
          title: latestItem.title,
          attempt,
          maxAttempts,
          jobId,
          ...formatError(error)
        });
      }
      return;
    }
  }

  latestItem.coverSync = buildCoverState(latestItem.coverSync, {
    now,
    status: COVER_SYNC_STATUS.FAILED,
    attempt,
    maxAttempts,
    jobId,
    queuedAt,
    startedAt: latestItem?.coverSync?.startedAt || now,
    completedAt: now,
    nextRetryAt: null,
    lastError: message,
    errorCode,
    retryable: false
  });
  await saveItem(kv, latestItem);

  if (log) {
    log('warn', 'cover_sync_failed', {
      stage: 'sync',
      itemId,
      url: latestItem.url,
      title: latestItem.title,
      attempt,
      maxAttempts,
      jobId,
      errorCode,
      error: message
    });
  }
}

export {
  COVER_MESSAGE_TYPE,
  COVER_SYNC_STATUS,
  enqueueCoverGeneration,
  isCoverSyncActive,
  processCoverSyncBatch
};
