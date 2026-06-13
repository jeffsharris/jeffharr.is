import { getReadLaterAssetItemId } from './asset-store.js';
import { getYouTubeThumbnailUrl } from './media-utils.js';
import { isXStatusUrl } from './x-adapter.js';
import { formatError } from '../lib/logger.js';

const REDIRECT_TIMEOUT_MS = 8000;
const SHORT_LINK_HOSTS = new Set(['t.co']);

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

async function resolveSourceThumbnail(itemOrUrl, reader = null, options = {}) {
  const readerUrl = pickReaderThumbnailUrl(reader);
  if (readerUrl) {
    return {
      thumbnailUrl: readerUrl,
      sourceUrl: readerUrl,
      sourceKind: 'reader'
    };
  }

  const url = normalizeHttpUrl(typeof itemOrUrl === 'string' ? itemOrUrl : itemOrUrl?.url);
  const directThumbnailUrl = normalizeHttpUrl(getYouTubeThumbnailUrl(url));
  if (directThumbnailUrl) {
    return {
      thumbnailUrl: directThumbnailUrl,
      sourceUrl: url,
      sourceKind: 'youtube'
    };
  }

  if (!isShortLinkUrl(url)) {
    return {
      thumbnailUrl: null,
      sourceUrl: url,
      sourceKind: null
    };
  }

  const resolvedUrl = await resolveRedirectUrl(url, options.fetchImpl);
  const redirectedThumbnailUrl = normalizeHttpUrl(getYouTubeThumbnailUrl(resolvedUrl));
  if (redirectedThumbnailUrl) {
    return {
      thumbnailUrl: redirectedThumbnailUrl,
      sourceUrl: resolvedUrl,
      sourceKind: 'youtube'
    };
  }

  if (isXStatusUrl(resolvedUrl)) {
    return {
      thumbnailUrl: null,
      sourceUrl: resolvedUrl,
      sourceKind: 'x'
    };
  }

  return {
    thumbnailUrl: null,
    sourceUrl: resolvedUrl || url,
    sourceKind: null
  };
}

async function ensureSourceThumbnail({
  item,
  reader = null,
  assetStore,
  log,
  force = false,
  fetchImpl
}) {
  if (!item || !assetStore) {
    return { saved: false, thumbnailUrl: null, reason: 'missing_context' };
  }

  const assetItemId = getReadLaterAssetItemId(item);
  const resolved = await resolveSourceThumbnail(item, reader, { fetchImpl });
  const thumbnailUrl = resolved.thumbnailUrl;
  if (!assetItemId || !thumbnailUrl) {
    return {
      saved: false,
      thumbnailUrl: null,
      sourceUrl: resolved.sourceUrl,
      sourceKind: resolved.sourceKind,
      reason: 'no_source_thumbnail'
    };
  }

  if (!force && item.thumbnailUrl === thumbnailUrl) {
    return { saved: false, thumbnailUrl, sourceUrl: resolved.sourceUrl, sourceKind: resolved.sourceKind, reason: 'already_current' };
  }

  if (typeof assetStore.saveThumbnail !== 'function') {
    return { saved: false, thumbnailUrl, sourceUrl: resolved.sourceUrl, sourceKind: resolved.sourceKind, reason: 'unsupported_store' };
  }

  try {
    await assetStore.saveThumbnail(assetItemId, { url: thumbnailUrl });
    item.thumbnailUrl = thumbnailUrl;
    return { saved: true, thumbnailUrl, sourceUrl: resolved.sourceUrl, sourceKind: resolved.sourceKind };
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
    return { saved: false, thumbnailUrl, sourceUrl: resolved.sourceUrl, sourceKind: resolved.sourceKind, reason: 'save_failed' };
  }
}

function isShortLinkUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return SHORT_LINK_HOSTS.has(host);
  } catch {
    return false;
  }
}

async function resolveRedirectUrl(url, fetchImpl = fetch) {
  if (!url || typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REDIRECT_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'jeffharr.is read-later thumbnail resolver (+https://jeffharr.is/read-later)',
        Accept: 'text/html,application/xhtml+xml'
      },
      signal: controller.signal
    });
    return normalizeHttpUrl(response?.url || url);
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

export {
  ensureSourceThumbnail,
  getSourceThumbnailUrl,
  pickReaderThumbnailUrl,
  resolveSourceThumbnail
};
