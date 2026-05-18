import {
  getAssetByRole,
  getContentAssets,
  getContentDb,
  upsertAsset
} from './db.js';
import {
  getBinaryAsset,
  getJsonAsset,
  putJsonAsset
} from './assets.js';
import {
  getReadLaterItem,
  getReadLaterRow,
  updateReadLaterCompatibilityState
} from './read-later-store.js';
import {
  createStableId,
  getNowIso,
  safeJsonParse
} from './ids.js';

const ITEM_PREFIX = 'item:';
const READER_PREFIX = 'reader:';
const COVER_PREFIX = 'cover:';

function shouldUseContentLibraryReadLater(env) {
  return Boolean(env?.CONTENT_DB && env?.CONTENT_LIBRARY_READ_LATER === '1');
}

function shouldUseContentLibraryReadLaterAssets(env) {
  return Boolean(
    env?.CONTENT_DB &&
    env?.CONTENT_ASSETS &&
    env?.CONTENT_LIBRARY_READ_LATER === '1'
  );
}

function shouldUseContentLibrarySync(env) {
  return Boolean(
    env?.CONTENT_DB &&
    env?.CONTENT_ASSETS &&
    env?.CONTENT_LIBRARY_READ_LATER === '1' &&
    env?.CONTENT_LIBRARY_SYNC_ENABLED === '1'
  );
}

function createReadLaterStorage(env, { requireAssets = false } = {}) {
  if (requireAssets ? shouldUseContentLibraryReadLaterAssets(env) : shouldUseContentLibraryReadLater(env)) {
    return createContentLibraryKvAdapter(env);
  }
  return env?.READ_LATER || null;
}

function createSyncStorage(env) {
  if (shouldUseContentLibrarySync(env)) {
    return createContentLibraryKvAdapter(env);
  }
  return env?.READ_LATER || null;
}

function withReadLaterStorage(env, storage) {
  if (!storage || storage === env?.READ_LATER) return env;
  return { ...env, READ_LATER: storage };
}

function createContentLibraryKvAdapter(env) {
  const db = getContentDb(env);
  const bucket = getContentAssets(env);
  const fallback = env?.READ_LATER || null;

  return {
    async get(key, options = {}) {
      if (!isManagedReadLaterKey(key)) {
        return fallback ? fallback.get(key, options) : null;
      }
      const value = await getContentLibraryValue({ db, bucket, key });
      if (value == null && fallback) {
        return fallback.get(key, options);
      }
      if (options?.type === 'json') return value;
      if (value == null) return null;
      return typeof value === 'string' ? value : JSON.stringify(value);
    },

    async put(key, value, options) {
      if (!isManagedReadLaterKey(key)) {
        if (fallback) await fallback.put(key, value, options);
        return;
      }
      const handled = await putContentLibraryValue({ db, bucket, key, value });
      if (!handled && fallback) {
        await fallback.put(key, value, options);
      }
    },

    async delete(key) {
      if (!isManagedReadLaterKey(key)) {
        if (fallback) await fallback.delete(key);
        return;
      }
      const handled = await deleteContentLibraryValue({ db, bucket, key });
      if (!handled && fallback) {
        await fallback.delete(key);
      }
    },

    async list(options = {}) {
      if (!fallback) return { keys: [], list_complete: true };
      return fallback.list(options);
    }
  };
}

function isManagedReadLaterKey(key) {
  return (
    typeof key === 'string' &&
    (
      key.startsWith(ITEM_PREFIX) ||
      key.startsWith(READER_PREFIX) ||
      key.startsWith(COVER_PREFIX)
    )
  );
}

async function getContentLibraryValue({ db, bucket, key }) {
  if (!db || !key) return null;

  if (key.startsWith(ITEM_PREFIX)) {
    return getReadLaterItem(db, key.slice(ITEM_PREFIX.length));
  }

  if (key.startsWith(READER_PREFIX)) {
    if (!bucket) return null;
    return getReaderAsset({ db, bucket, entryId: key.slice(READER_PREFIX.length) });
  }

  if (key.startsWith(COVER_PREFIX)) {
    if (!bucket) return null;
    return getCoverAsset({ db, bucket, entryId: key.slice(COVER_PREFIX.length) });
  }

  return null;
}

async function putContentLibraryValue({ db, bucket, key, value }) {
  if (!db || !key) return false;
  const parsed = parseStoredJson(value);

  if (key.startsWith(ITEM_PREFIX)) {
    return putReadLaterItem(db, key.slice(ITEM_PREFIX.length), parsed);
  }

  if (key.startsWith(READER_PREFIX)) {
    if (!bucket) return false;
    return putReaderAsset({ db, bucket, entryId: key.slice(READER_PREFIX.length), reader: parsed });
  }

  if (key.startsWith(COVER_PREFIX)) {
    if (!bucket) return false;
    return putCoverAsset({ db, bucket, entryId: key.slice(COVER_PREFIX.length), cover: parsed });
  }
  return false;
}

async function deleteContentLibraryValue({ db, bucket, key }) {
  if (!db || !key) return false;

  if (key.startsWith(READER_PREFIX)) {
    return deleteAssetByRole({
      db,
      bucket,
      entryId: key.slice(READER_PREFIX.length),
      role: 'reader_html'
    });
  }

  if (key.startsWith(COVER_PREFIX)) {
    return deleteAssetByRole({
      db,
      bucket,
      entryId: key.slice(COVER_PREFIX.length),
      role: 'generated_cover'
    });
  }
  return false;
}

async function putReadLaterItem(db, entryId, item) {
  if (!entryId || !item || typeof item !== 'object') return false;
  const row = await getReadLaterRow(db, entryId);
  if (!row) return false;

  const now = getNowIso();
  const readAt = item.read ? (item.readAt || now) : null;

  await db.batch([
    db.prepare(
      `UPDATE list_entries
       SET status = ?, added_at = COALESCE(?, added_at), updated_at = ?
       WHERE id = ?`
    ).bind(item.read ? 'done' : 'active', normalizeIsoDate(item.savedAt), now, entryId),
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

  await updateReadLaterCompatibilityState(db, entryId, {
    readAt,
    progress: item.progress || null,
    kindle: item.kindle || null,
    coverSync: item.coverSync || null,
    pushChannels: item.pushChannels || null,
    updatedAt: now
  });
  return true;
}

async function getReaderAsset({ db, bucket, entryId }) {
  const row = await getReadLaterRow(db, entryId);
  if (!row) return null;
  const asset = await getAssetByRole(db, row.item_id, 'reader_html');
  if (!asset?.r2_key) return null;
  return getJsonAsset({ bucket, asset });
}

async function putReaderAsset({ db, bucket, entryId, reader }) {
  if (!reader?.contentHtml) return false;
  const row = await getReadLaterRow(db, entryId);
  if (!row) return false;

  const asset = await putJsonAsset({
    db,
    bucket,
    itemId: row.item_id,
    role: 'reader_html',
    key: `items/${row.item_id}/reader.json`,
    value: reader
  });

  const wordCount = integerOrNull(reader.wordCount);
  await db.prepare(
    `INSERT INTO article_details (
      item_id, word_count, reading_time_minutes, reader_asset_id, site_name, byline, excerpt, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      word_count = excluded.word_count,
      reading_time_minutes = excluded.reading_time_minutes,
      reader_asset_id = excluded.reader_asset_id,
      site_name = excluded.site_name,
      byline = excluded.byline,
      excerpt = excluded.excerpt,
      updated_at = excluded.updated_at`
  ).bind(
    row.item_id,
    wordCount,
    wordCount ? Math.max(1, Math.round(wordCount / 230)) : null,
    asset.id,
    stringOrNull(reader.siteName),
    stringOrNull(reader.byline),
    stringOrNull(reader.excerpt),
    getNowIso()
  ).run();
  return true;
}

async function getCoverAsset({ db, bucket, entryId }) {
  const row = await getReadLaterRow(db, entryId);
  if (!row) return null;
  const asset = await getAssetByRole(db, row.item_id, 'generated_cover');
  if (!asset?.r2_key) return null;
  const stored = await getBinaryAsset({ bucket, asset });
  if (!stored?.bytes) return null;
  return {
    base64: arrayBufferToBase64(stored.bytes),
    contentType: stored.contentType || 'image/png',
    createdAt: asset.updated_at || asset.created_at || getNowIso()
  };
}

async function putCoverAsset({ db, bucket, entryId, cover }) {
  if (!cover?.base64) return false;
  const row = await getReadLaterRow(db, entryId);
  if (!row) return false;

  const contentType = cover.contentType || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const key = `items/${row.item_id}/generated-cover.${ext}`;
  const bytes = base64ToBytes(cover.base64);

  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      itemId: row.item_id,
      role: 'generated_cover',
      createdAt: cover.createdAt || getNowIso()
    }
  });

  await upsertAsset(db, {
    id: await createStableId('ast', `${row.item_id}:generated_cover:${key}`),
    itemId: row.item_id,
    role: 'generated_cover',
    kind: 'image',
    r2Key: key,
    mimeType: contentType,
    byteSize: bytes.byteLength,
    contentSha256: await hashBytes(bytes),
    createdAt: cover.createdAt || getNowIso(),
    updatedAt: cover.createdAt || getNowIso()
  });
  return true;
}

async function deleteAssetByRole({ db, bucket, entryId, role }) {
  const row = await getReadLaterRow(db, entryId);
  if (!row) return false;
  const asset = await getAssetByRole(db, row.item_id, role);
  if (!asset) return false;
  if (bucket && asset.r2_key) {
    await bucket.delete(asset.r2_key);
  }
  await db.prepare(`DELETE FROM assets WHERE id = ?`).bind(asset.id).run();
  return true;
}

function parseStoredJson(value) {
  if (value == null) return null;
  if (typeof value === 'string') return safeJsonParse(value, null);
  return value;
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function normalizeIsoDate(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function hashBytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function arrayBufferToBase64(buffer) {
  return btoa(arrayBufferToBinaryString(buffer));
}

function arrayBufferToBinaryString(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return binary;
}

export {
  createContentLibraryKvAdapter,
  createReadLaterStorage,
  createSyncStorage,
  shouldUseContentLibraryReadLater,
  shouldUseContentLibraryReadLaterAssets,
  shouldUseContentLibrarySync,
  withReadLaterStorage
};
