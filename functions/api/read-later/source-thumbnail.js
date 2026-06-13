import { getReadLaterAssetItemId } from './asset-store.js';
import { getYouTubeThumbnailUrl } from './media-utils.js';
import { formatError } from '../lib/logger.js';

function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

function pickReaderThumbnailUrl(reader) {
  const candidates = [
    reader?.coverImageUrl,
    reader?.imageUrl,
    ...(Array.isArray(reader?.imageUrls) ? reader.imageUrls : [])
  ];
  for (const candidate of candidates) {
    const url = normalizeHttpUrl(candidate);
    if (url) return url;
  }
  return null;
}

function getSourceThumbnailUrl(itemOrUrl, reader = null) {
  const readerUrl = pickReaderThumbnailUrl(reader);
  if (readerUrl) return readerUrl;

  const url = typeof itemOrUrl === 'string' ? itemOrUrl : itemOrUrl?.url;
  return normalizeHttpUrl(getYouTubeThumbnailUrl(url));
}

async function ensureSourceThumbnail({ item, reader = null, assetStore, log, force = false }) {
  if (!item || !assetStore) {
    return { saved: false, thumbnailUrl: null, reason: 'missing_context' };
  }

  const assetItemId = getReadLaterAssetItemId(item);
  const thumbnailUrl = getSourceThumbnailUrl(item, reader);
  if (!assetItemId || !thumbnailUrl) {
    return { saved: false, thumbnailUrl: null, reason: 'no_source_thumbnail' };
  }

  if (!force && item.thumbnailUrl === thumbnailUrl) {
    return { saved: false, thumbnailUrl, reason: 'already_current' };
  }

  if (typeof assetStore.saveThumbnail !== 'function') {
    return { saved: false, thumbnailUrl, reason: 'unsupported_store' };
  }

  try {
    await assetStore.saveThumbnail(assetItemId, { url: thumbnailUrl });
    item.thumbnailUrl = thumbnailUrl;
    return { saved: true, thumbnailUrl };
  } catch (error) {
    if (log) {
      log('warn', 'source_thumbnail_save_failed', {
        stage: 'thumbnail',
        itemId: item?.id || null,
        url: item?.url || null,
        thumbnailUrl,
        ...formatError(error)
      });
    }
    return { saved: false, thumbnailUrl, reason: 'save_failed' };
  }
}

export {
  ensureSourceThumbnail,
  getSourceThumbnailUrl,
  pickReaderThumbnailUrl
};
