import {
  getAssetByRole,
  getContentAssets,
  getContentDb,
  upsertAsset
} from '../content-library/db.js';
import {
  getBinaryAsset,
  getJsonAsset,
  putJsonAsset
} from '../content-library/assets.js';
import {
  getReadLaterItem,
  getReadLaterRow,
  saveReadLaterRuntimeItem
} from '../content-library/read-later-store.js';
import {
  createStableId,
  getNowIso
} from '../content-library/ids.js';

function createReadLaterRepository(env, { requireAssets = false } = {}) {
  const db = getContentDb(env);
  const bucket = getContentAssets(env);
  if (!db) return null;
  if (requireAssets && !bucket) return null;
  return createD1ReadLaterRepository({ db, bucket });
}

function createD1ReadLaterRepository({ db, bucket }) {
  return {
    db,
    bucket,

    async getItem(entryId) {
      return getReadLaterItem(db, entryId);
    },

    async getRow(entryId) {
      return getReadLaterRow(db, entryId);
    },

    async saveItem(item) {
      return saveReadLaterRuntimeItem(db, item);
    },

    async getReader(entryId) {
      return getReaderAsset({ db, bucket, entryId });
    },

    async saveReader(entryId, reader) {
      return putReaderAsset({ db, bucket, entryId, reader });
    },

    async getCover(entryId) {
      return getCoverAsset({ db, bucket, entryId });
    },

    async saveCover(entryId, cover) {
      return putCoverAsset({ db, bucket, entryId, cover });
    }
  };
}

async function getReaderAsset({ db, bucket, entryId }) {
  if (!db || !bucket || !entryId) return null;
  const row = await getReadLaterRow(db, entryId);
  if (!row) return null;
  const asset = await getAssetByRole(db, row.item_id, 'reader_html');
  if (!asset?.r2_key) return null;
  return getJsonAsset({ bucket, asset });
}

async function putReaderAsset({ db, bucket, entryId, reader }) {
  if (!db || !bucket || !entryId || !reader?.contentHtml) return false;
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
  if (!db || !bucket || !entryId) return null;
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
  if (!db || !bucket || !entryId || !cover?.base64) return null;
  const row = await getReadLaterRow(db, entryId);
  if (!row) return null;

  const contentType = cover.contentType || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const key = `items/${row.item_id}/generated-cover.${ext}`;
  const bytes = base64ToBytes(cover.base64);
  const createdAt = cover.createdAt || getNowIso();

  await bucket.put(key, bytes, {
    httpMetadata: { contentType },
    customMetadata: {
      itemId: row.item_id,
      role: 'generated_cover',
      createdAt
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
    createdAt,
    updatedAt: createdAt
  });

  return {
    base64: cover.base64,
    contentType,
    createdAt
  };
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
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

async function hashBytes(bytes) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export {
  createD1ReadLaterRepository,
  createReadLaterRepository
};
