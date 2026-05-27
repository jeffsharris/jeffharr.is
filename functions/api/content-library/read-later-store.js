import { createInitialPushChannels } from '../read-later/state.js';
import { deriveTitleFromUrl } from '../read-later/reader-utils.js';
import {
  READ_LATER_LIST_ID,
  getAssetByRole,
  getItemByCanonicalKey,
  upsertItem,
  upsertItemSource,
  upsertListEntry
} from './db.js';
import {
  canonicalKeyForUrl,
  createRandomId,
  getNowIso,
  normalizeHttpUrl,
  safeJsonParse,
  stringifyJson
} from './ids.js';

const MAX_TITLE_LENGTH = 220;
const MIN_VIDEO_SECONDS = 300;

async function listReadLaterItems(db) {
  const rows = await listReadLaterRows(db, { limit: 1000 });
  return Promise.all(rows.map((row) => readLaterRowToItem(null, row)));
}

function createReadLaterItemStore(db) {
  if (!db) return null;
  return {
    async getItem(entryId) {
      return getReadLaterItem(db, entryId);
    },

    async saveItem(item) {
      return saveReadLaterRuntimeItem(db, item);
    }
  };
}

async function getReadLaterItem(db, entryId) {
  const row = await getReadLaterRow(db, entryId);
  return row ? readLaterRowToItem(db, row) : null;
}

async function saveReadLaterItem(db, payload) {
  const normalizedUrl = normalizeHttpUrl(payload?.url);
  if (!normalizedUrl) {
    return { ok: false, status: 400, error: 'Invalid URL' };
  }

  const now = getNowIso();
  const canonicalKey = canonicalKeyForUrl(normalizedUrl, inferKindFromUrl(normalizedUrl));
  const existingItem = await getItemByCanonicalKey(db, canonicalKey);
  const hasIncomingTitle = typeof payload?.title === 'string' && payload.title.trim();
  const title = existingItem && !hasIncomingTitle
    ? existingItem.title
    : normalizeTitle(payload?.title, normalizedUrl);
  const item = await upsertItem(db, {
    kind: inferKindFromUrl(normalizedUrl),
    canonicalKey,
    canonicalUrl: normalizedUrl,
    sourceUrl: normalizedUrl,
    title,
    publisher: hostnameFromUrl(normalizedUrl),
    resolvedAt: now
  });

  await upsertItemSource(db, {
    itemId: item.id,
    sourceKind: 'read_later',
    sourceId: normalizedUrl,
    sourceUrl: normalizedUrl,
    source: { url: normalizedUrl, title }
  });

  const existing = await getReadLaterEntryForItem(db, item.id);
  const incomingRead = typeof payload?.read === 'boolean' ? payload.read : false;
  const read = existing ? false : incomingRead;
  const entry = await upsertListEntry(db, {
    id: existing?.id || createRandomId('rli'),
    listId: READ_LATER_LIST_ID,
    itemId: item.id,
    status: read ? 'done' : 'active',
    addedAt: now,
    updatedAt: now
  });

  const previousState = existing ? await getReadState(db, existing.id) : null;
  const pushChannels = previousState?.push_channels_json
    ? safeJsonParse(previousState.push_channels_json, null)
    : createInitialPushChannels(now);

  await upsertReadState(db, entry.id, {
    readAt: read ? now : null,
    progress: previousState ? safeJsonParse(previousState.progress_json, null) : null,
    kindle: previousState ? safeJsonParse(previousState.kindle_json, null) : null,
    coverSync: previousState ? safeJsonParse(previousState.cover_sync_json, null) : null,
    pushChannels,
    updatedAt: now
  });

  const saved = await getReadLaterItem(db, entry.id);
  return {
    ok: true,
    status: existing ? 200 : 201,
    item: saved,
    duplicate: Boolean(existing),
    unarchived: Boolean(existing?.read_at)
  };
}

async function updateReadLaterRead(db, { id, read }) {
  if (!id || typeof read !== 'boolean') {
    return { ok: false, status: 400, error: 'Invalid payload' };
  }

  const row = await getReadLaterRow(db, id);
  if (!row) {
    return { ok: false, status: 404, error: 'Item not found' };
  }

  const now = getNowIso();
  const readAt = read ? now : null;
  await db.prepare(
    `UPDATE list_entries SET status = ?, updated_at = ? WHERE id = ?`
  ).bind(read ? 'done' : 'active', now, id).run();

  const state = await getReadState(db, id);
  await upsertReadState(db, id, {
    readAt,
    progress: state ? safeJsonParse(state.progress_json, null) : null,
    kindle: state ? safeJsonParse(state.kindle_json, null) : null,
    coverSync: state ? safeJsonParse(state.cover_sync_json, null) : null,
    pushChannels: state ? safeJsonParse(state.push_channels_json, null) : null,
    updatedAt: now
  });

  return { ok: true, status: 200, item: await getReadLaterItem(db, id) };
}

async function deleteReadLaterItem(db, id) {
  if (!id) return { ok: false, status: 400, error: 'Invalid payload' };
  const item = await getReadLaterItem(db, id);
  if (!item) return { ok: false, status: 404, error: 'Item not found' };
  await db.prepare(`DELETE FROM list_entries WHERE id = ?`).bind(id).run();
  return { ok: true, status: 200, item };
}

async function restoreReadLaterItem(db, payload) {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  const normalizedUrl = normalizeHttpUrl(payload?.url);
  if (!id || !normalizedUrl) {
    return { ok: false, status: 400, error: 'Invalid payload' };
  }

  const savedAt = normalizeIsoDate(payload?.savedAt) || getNowIso();
  const readAt = normalizeIsoDate(payload?.readAt);
  const read = typeof payload?.read === 'boolean' ? payload.read : Boolean(readAt);
  const title = normalizeTitle(payload?.title, normalizedUrl);
  const canonicalKey = canonicalKeyForUrl(normalizedUrl, inferKindFromUrl(normalizedUrl));
  const item = await upsertItem(db, {
    kind: inferKindFromUrl(normalizedUrl),
    canonicalKey,
    canonicalUrl: normalizedUrl,
    sourceUrl: normalizedUrl,
    title,
    publisher: hostnameFromUrl(normalizedUrl),
    resolvedAt: getNowIso()
  });

  const entry = await upsertListEntry(db, {
    id,
    listId: READ_LATER_LIST_ID,
    itemId: item.id,
    status: read ? 'done' : 'active',
    addedAt: savedAt,
    updatedAt: getNowIso()
  });

  await upsertReadState(db, entry.id, {
    readAt: read ? readAt || getNowIso() : null,
    progress: normalizeProgress(payload?.progress),
    pushChannels: createInitialPushChannels(getNowIso()),
    updatedAt: getNowIso()
  });

  return { ok: true, status: 200, item: await getReadLaterItem(db, entry.id) };
}

async function saveReadLaterProgress(db, payload) {
  const id = typeof payload?.id === 'string' ? payload.id.trim() : '';
  const scrollTop = Number(payload?.scrollTop);
  const scrollRatio = Number(payload?.scrollRatio);
  const incomingScrollUpdatedAt = normalizeIsoDate(payload?.updatedAt);
  const videoCurrentTime = Number(payload?.videoCurrentTime);
  const videoDuration = Number(payload?.videoDuration);
  const hasScroll = Number.isFinite(scrollTop) && Number.isFinite(scrollRatio);
  const hasVideo = Number.isFinite(videoCurrentTime) && Number.isFinite(videoDuration);

  if (!id || (!hasScroll && !hasVideo)) {
    return { ok: false, status: 400, error: 'Invalid payload' };
  }

  const row = await getReadLaterRow(db, id);
  if (!row) {
    return { ok: false, status: 404, error: 'Item not found' };
  }

  const state = await getReadState(db, id);
  const progress = state ? safeJsonParse(state.progress_json, {}) || {} : {};
  const serverNow = getNowIso();

  if (hasScroll) {
    const nextScrollUpdatedAt = incomingScrollUpdatedAt || serverNow;
    const existingScrollUpdatedAt = normalizeIsoDate(progress.updatedAt);
    if (isSameOrAfter(nextScrollUpdatedAt, existingScrollUpdatedAt)) {
      progress.scrollTop = Math.max(0, scrollTop);
      progress.scrollRatio = clamp(scrollRatio, 0, 1);
      progress.updatedAt = nextScrollUpdatedAt;
    }
  }

  if (hasVideo) {
    if (videoDuration >= MIN_VIDEO_SECONDS) {
      const safeDuration = Math.max(videoDuration, 0);
      const safeTime = clamp(videoCurrentTime, 0, safeDuration || 0);
      progress.video = {
        currentTime: safeTime,
        duration: safeDuration,
        ratio: safeDuration ? clamp(safeTime / safeDuration, 0, 1) : 0,
        updatedAt: serverNow
      };
    } else {
      delete progress.video;
    }
  }

  const nextProgress = Object.keys(progress).length > 0 ? progress : null;
  await upsertReadState(db, id, {
    readAt: state?.read_at || null,
    progress: nextProgress,
    kindle: state ? safeJsonParse(state.kindle_json, null) : null,
    coverSync: state ? safeJsonParse(state.cover_sync_json, null) : null,
    pushChannels: state ? safeJsonParse(state.push_channels_json, null) : null,
    updatedAt: serverNow
  });

  return { ok: true, status: 200, progress: nextProgress };
}

async function updateReadLaterCompatibilityState(db, entryId, statePatch = {}) {
  const state = await getReadState(db, entryId);
  await upsertReadState(db, entryId, {
    readAt: Object.hasOwn(statePatch, 'readAt') ? statePatch.readAt : state?.read_at || null,
    progress: Object.hasOwn(statePatch, 'progress') ? statePatch.progress : safeJsonParse(state?.progress_json, null),
    kindle: Object.hasOwn(statePatch, 'kindle') ? statePatch.kindle : safeJsonParse(state?.kindle_json, null),
    coverSync: Object.hasOwn(statePatch, 'coverSync') ? statePatch.coverSync : safeJsonParse(state?.cover_sync_json, null),
    pushChannels: Object.hasOwn(statePatch, 'pushChannels') ? statePatch.pushChannels : safeJsonParse(state?.push_channels_json, null),
    updatedAt: statePatch.updatedAt || getNowIso()
  });
  return getReadLaterItem(db, entryId);
}

async function saveReadLaterRuntimeItem(db, item) {
  if (!item?.id) return false;
  const row = await getReadLaterRow(db, item.id);
  if (!row) return false;

  const now = getNowIso();
  const readAt = item.read ? (item.readAt || now) : null;

  await db.batch([
    db.prepare(
      `UPDATE list_entries
       SET status = ?, added_at = COALESCE(?, added_at), updated_at = ?
       WHERE id = ?`
    ).bind(item.read ? 'done' : 'active', normalizeIsoDate(item.savedAt), now, item.id),
    db.prepare(
      `UPDATE items
       SET title = COALESCE(NULLIF(?, ''), title),
           canonical_url = COALESCE(?, canonical_url),
           source_url = COALESCE(?, source_url),
           summary = COALESCE(?, summary),
           creator = COALESCE(?, creator),
           publisher = COALESCE(?, publisher),
           updated_at = ?
       WHERE id = ?`
    ).bind(
      stringOrNull(item.title),
      stringOrNull(item.canonicalUrl || item.url),
      stringOrNull(item.url),
      stringOrNull(item.description || item.summary),
      stringOrNull(item.author || item.creator),
      stringOrNull(item.publisher),
      now,
      row.item_id
    )
  ]);

  await updateReadLaterCompatibilityState(db, item.id, {
    readAt,
    progress: item.progress || null,
    kindle: item.kindle || null,
    coverSync: item.coverSync || null,
    pushChannels: item.pushChannels || null,
    updatedAt: now
  });

  return true;
}

async function upsertReadState(db, entryId, {
  readAt = null,
  progress = null,
  kindle = null,
  coverSync = null,
  pushChannels = null,
  updatedAt = getNowIso()
}) {
  const progressRatio = progress?.video?.ratio ?? progress?.scrollRatio ?? null;
  await db.prepare(
    `INSERT INTO read_state (
      entry_id, read_at, progress_ratio, progress_json, kindle_status, kindle_json,
      cover_sync_json, push_channels_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      read_at = excluded.read_at,
      progress_ratio = excluded.progress_ratio,
      progress_json = excluded.progress_json,
      kindle_status = excluded.kindle_status,
      kindle_json = excluded.kindle_json,
      cover_sync_json = excluded.cover_sync_json,
      push_channels_json = excluded.push_channels_json,
      updated_at = excluded.updated_at`
  ).bind(
    entryId,
    readAt || null,
    Number.isFinite(progressRatio) ? progressRatio : null,
    stringifyJson(progress),
    kindle?.status || null,
    stringifyJson(kindle),
    stringifyJson(coverSync),
    stringifyJson(pushChannels),
    updatedAt
  ).run();
}

async function getReadState(db, entryId) {
  return db.prepare(
    `SELECT * FROM read_state WHERE entry_id = ?`
  ).bind(entryId).first();
}

async function listReadLaterRows(db, { limit = 1000 } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 1000, 1), 1000);
  const result = await db.prepare(
    `SELECT
      le.id AS entry_id,
      le.status AS entry_status,
      le.position,
      le.note,
      le.added_at,
      le.updated_at AS entry_updated_at,
      le.extra_json AS entry_extra_json,
      i.id AS item_id,
      i.kind AS item_kind,
      i.canonical_key,
      i.canonical_url,
      i.source_url,
      i.title,
      i.subtitle,
      i.summary,
      i.creator,
      i.publisher,
      i.published_at,
      i.language,
      i.thumbnail_asset_id,
      i.primary_asset_id,
      i.extra_json AS item_extra_json,
      rs.read_at,
      rs.progress_json,
      rs.kindle_json,
      rs.cover_sync_json,
      rs.push_channels_json,
      cover.updated_at AS cover_updated_at,
      COALESCE(thumbnail_by_role.url, thumbnail_by_id.url) AS thumbnail_url
     FROM list_entries le
     JOIN items i ON i.id = le.item_id
     LEFT JOIN read_state rs ON rs.entry_id = le.id
     LEFT JOIN assets cover ON cover.id = (
       SELECT a.id
       FROM assets a
       WHERE a.item_id = i.id AND a.role = 'generated_cover'
       ORDER BY a.updated_at DESC
       LIMIT 1
     )
     LEFT JOIN assets thumbnail_by_id ON thumbnail_by_id.id = i.thumbnail_asset_id
     LEFT JOIN assets thumbnail_by_role ON thumbnail_by_role.id = (
       SELECT a.id
       FROM assets a
       WHERE a.item_id = i.id AND a.role = 'thumbnail'
       ORDER BY a.updated_at DESC
       LIMIT 1
     )
     WHERE le.list_id = ?
     ORDER BY le.added_at DESC
     LIMIT ?`
  ).bind(READ_LATER_LIST_ID, safeLimit).all();

  return result.results || [];
}

async function getReadLaterEntryForItem(db, itemId) {
  return db.prepare(
    `SELECT le.*, rs.read_at
     FROM list_entries le
     LEFT JOIN read_state rs ON rs.entry_id = le.id
     WHERE le.list_id = ? AND le.item_id = ?`
  ).bind(READ_LATER_LIST_ID, itemId).first();
}

async function getReadLaterRow(db, entryId) {
  return db.prepare(
    `SELECT
      le.id AS entry_id,
      le.status AS entry_status,
      le.position,
      le.note,
      le.added_at,
      le.updated_at AS entry_updated_at,
      le.extra_json AS entry_extra_json,
      i.id AS item_id,
      i.kind AS item_kind,
      i.canonical_key,
      i.canonical_url,
      i.source_url,
      i.title,
      i.subtitle,
      i.summary,
      i.creator,
      i.publisher,
      i.published_at,
      i.language,
      i.thumbnail_asset_id,
      i.primary_asset_id,
      i.extra_json AS item_extra_json,
      rs.read_at,
      rs.progress_json,
      rs.kindle_json,
      rs.cover_sync_json,
      rs.push_channels_json
     FROM list_entries le
     JOIN items i ON i.id = le.item_id
     LEFT JOIN read_state rs ON rs.entry_id = le.id
     WHERE le.id = ? AND le.list_id = ?`
  ).bind(entryId, READ_LATER_LIST_ID).first();
}

async function readLaterRowToItem(db, row) {
  const progress = safeJsonParse(row.progress_json, null);
  const kindle = safeJsonParse(row.kindle_json, null);
  const coverSync = safeJsonParse(row.cover_sync_json, null);
  const pushChannels = safeJsonParse(row.push_channels_json, null);
  const coverUpdatedAt = row.cover_updated_at || null;
  const coverAsset = coverUpdatedAt ? null : (db ? await getAssetByRole(db, row.item_id, 'generated_cover') : null);
  const url = row.canonical_url || row.source_url || '';
  const readAt = row.read_at || null;
  const item = {
    id: row.entry_id,
    itemId: row.item_id,
    kind: row.item_kind || inferKindFromUrl(url),
    url,
    canonicalUrl: row.canonical_url || null,
    title: row.title || normalizeTitle('', url),
    savedAt: row.added_at,
    read: Boolean(readAt) || row.entry_status === 'done',
    readAt,
    progress,
    pushChannels: pushChannels || createInitialPushChannels(row.added_at || getNowIso())
  };
  if (row.summary) item.description = row.summary;
  if (row.creator) item.author = row.creator;
  if (row.publisher) item.publisher = row.publisher;
  if (row.thumbnail_url) item.thumbnailUrl = row.thumbnail_url;
  if (kindle) item.kindle = kindle;
  if (coverSync) item.coverSync = coverSync;
  const resolvedCoverUpdatedAt = coverUpdatedAt || coverAsset?.updated_at || null;
  if (resolvedCoverUpdatedAt) {
    item.cover = { updatedAt: resolvedCoverUpdatedAt };
  }
  return item;
}

function normalizeTitle(input, fallbackUrl) {
  const raw = typeof input === 'string' ? input.trim() : '';
  let title = raw || deriveTitleFromUrl(fallbackUrl);
  if (title.length > MAX_TITLE_LENGTH) {
    title = title.slice(0, MAX_TITLE_LENGTH).trim();
  }
  return title;
}

function inferKindFromUrl(url) {
  const parsed = safeParseUrl(url);
  const host = parsed?.hostname.replace(/^www\./, '') || '';
  if (host === 'x.com' || host === 'twitter.com') return 'x_post';
  if (host === 'youtube.com' || host === 'youtu.be') return 'video';
  return 'article';
}

function hostnameFromUrl(url) {
  const parsed = safeParseUrl(url);
  return parsed?.hostname.replace(/^www\./, '') || '';
}

function safeParseUrl(url) {
  try {
    return new URL(url);
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
  if (Number.isFinite(scrollTop) && Number.isFinite(scrollRatio)) {
    result.scrollTop = Math.max(0, scrollTop);
    result.scrollRatio = clamp(scrollRatio, 0, 1);
    result.updatedAt = normalizeIsoDate(progress.updatedAt) || getNowIso();
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
        updatedAt: normalizeIsoDate(video.updatedAt) || getNowIso()
      };
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function isSameOrAfter(nextIso, existingIso) {
  if (!nextIso) return true;
  if (!existingIso) return true;
  const nextTime = new Date(nextIso).getTime();
  const existingTime = new Date(existingIso).getTime();
  if (Number.isNaN(nextTime) || Number.isNaN(existingTime)) return true;
  return nextTime >= existingTime;
}

export {
  createReadLaterItemStore,
  deleteReadLaterItem,
  getReadLaterItem,
  getReadLaterRow,
  listReadLaterItems,
  normalizeTitle,
  readLaterRowToItem,
  restoreReadLaterItem,
  saveReadLaterRuntimeItem,
  saveReadLaterItem,
  saveReadLaterProgress,
  updateReadLaterCompatibilityState,
  updateReadLaterRead,
  upsertReadState
};
