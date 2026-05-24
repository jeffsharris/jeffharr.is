import {
  getAssetByRole,
  getContentAssets,
  getContentDb
} from '../content-library/db.js';
import {
  getBinaryAsset,
  getJsonAsset,
  putBinaryAsset,
  putJsonAsset
} from '../content-library/assets.js';
import { getNowIso } from '../content-library/ids.js';

function createReadLaterAssetStore(env, { requireAssets = true } = {}) {
  const db = getContentDb(env);
  const bucket = getContentAssets(env);
  if (!db) return null;
  if (requireAssets && !bucket) return null;
  return createD1ReadLaterAssetStore({ db, bucket });
}

function createD1ReadLaterAssetStore({ db, bucket }) {
  if (!db || !bucket) return null;
  return {
    async getReader(itemId) {
      return getReaderAsset({ db, bucket, itemId });
    },

    async saveReader(itemId, reader) {
      return putReaderAsset({ db, bucket, itemId, reader });
    },

    async getCover(itemId) {
      return getCoverAsset({ db, bucket, itemId });
    },

    async getCoverBytes(itemId) {
      return getCoverBytesAsset({ db, bucket, itemId });
    },

    async saveCover(itemId, cover) {
      return putCoverAsset({ db, bucket, itemId, cover });
    }
  };
}

function getReadLaterAssetItemId(itemOrId) {
  if (typeof itemOrId === 'string') return itemOrId;
  return itemOrId?.itemId || itemOrId?.id || null;
}

async function getReaderAsset({ db, bucket, itemId }) {
  if (!db || !bucket || !itemId) return null;
  const asset = await getAssetByRole(db, itemId, 'reader_html');
  if (!asset?.r2_key) return null;
  return getJsonAsset({ bucket, asset });
}

async function putReaderAsset({ db, bucket, itemId, reader }) {
  if (!db || !bucket || !itemId || !reader?.contentHtml) return false;

  const asset = await putJsonAsset({
    db,
    bucket,
    itemId,
    role: 'reader_html',
    key: `items/${itemId}/reader.json`,
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
    itemId,
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

async function getCoverAsset({ db, bucket, itemId }) {
  const stored = await getCoverBytesAsset({ db, bucket, itemId });
  if (!stored?.bytes) return null;
  return {
    base64: arrayBufferToBase64(stored.bytes),
    contentType: stored.contentType || 'image/png',
    createdAt: stored.createdAt
  };
}

async function getCoverBytesAsset({ db, bucket, itemId }) {
  if (!db || !bucket || !itemId) return null;
  const asset = await getAssetByRole(db, itemId, 'generated_cover');
  if (!asset?.r2_key) return null;
  const stored = await getBinaryAsset({ bucket, asset });
  if (!stored?.bytes) return null;
  return {
    bytes: stored.bytes,
    contentType: stored.contentType || 'image/png',
    createdAt: asset.updated_at || asset.created_at || getNowIso()
  };
}

async function putCoverAsset({ db, bucket, itemId, cover }) {
  if (!db || !bucket || !itemId || !cover?.base64) return null;

  const contentType = cover.contentType || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const createdAt = cover.createdAt || getNowIso();
  const bytes = base64ToBytes(cover.base64);

  await putBinaryAsset({
    db,
    bucket,
    itemId,
    role: 'generated_cover',
    kind: 'image',
    key: `items/${itemId}/generated-cover.${ext}`,
    bytes,
    contentType,
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

export {
  createD1ReadLaterAssetStore,
  createReadLaterAssetStore,
  getReadLaterAssetItemId
};
