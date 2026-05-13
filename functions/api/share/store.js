const ITEM_PREFIX = 'share:item:';
const CANONICAL_PREFIX = 'share:canonical:';
const HISTORY_PREFIX = 'share:history:';
const DEFAULT_HISTORY_LIMIT = 100;

export function getShareKv(env) {
  return env?.SHARE || env?.READ_LATER || null;
}

export async function loadShareItem(kv, id) {
  if (!kv || !id) return null;
  return kv.get(`${ITEM_PREFIX}${id}`, { type: 'json' });
}

export async function saveShareItem({ kv, item, sourceUrl }) {
  if (!kv) {
    throw new Error('Share storage unavailable');
  }

  const now = new Date().toISOString();
  const identityKey = item.identityKey || `url:${item.sourceUrl || sourceUrl}`;
  const identityHash = await hashText(identityKey);
  const prefix = getIdPrefix(item.type);
  const stableId = `${prefix}_${identityHash.slice(0, 12)}`;
  const canonicalKey = `${CANONICAL_PREFIX}${identityHash}`;
  const existingId = await kv.get(canonicalKey);
  const id = existingId || stableId;
  const existing = existingId ? await loadShareItem(kv, existingId) : null;
  const createdAt = existing?.createdAt || item.createdAt || now;

  const savedItem = {
    ...existing,
    ...item,
    id,
    identityKey,
    identityHash,
    createdAt,
    updatedAt: now,
    shareCount: (existing?.shareCount || 0) + 1,
    platforms: mergeObjects(existing?.platforms, item.platforms),
    media: mergeObjects(existing?.media, item.media),
    podcast: mergeObjects(existing?.podcast, item.podcast),
    resolution: {
      confidence: item.resolution?.confidence || existing?.resolution?.confidence || 'low',
      sources: uniqueStrings([...(existing?.resolution?.sources || []), ...(item.resolution?.sources || [])]),
      warnings: uniqueStrings([...(existing?.resolution?.warnings || []), ...(item.resolution?.warnings || [])])
    }
  };

  await kv.put(`${ITEM_PREFIX}${id}`, JSON.stringify(savedItem));
  await kv.put(canonicalKey, id);
  await saveHistoryEvent(kv, savedItem, sourceUrl || item.sourceUrl || '');

  return savedItem;
}

export async function listShareHistory(kv, { limit = DEFAULT_HISTORY_LIMIT } = {}) {
  if (!kv) return [];

  const events = [];
  let cursor;

  do {
    const response = await kv.list({ prefix: HISTORY_PREFIX, cursor, limit: 1000 });
    for (const key of response.keys || []) {
      const event = await kv.get(key.name, { type: 'json' });
      if (event) events.push(event);
    }
    cursor = response.list_complete ? null : response.cursor;
  } while (cursor);

  events.sort((a, b) => new Date(b.sharedAt || 0) - new Date(a.sharedAt || 0));
  return events.slice(0, limit);
}

async function saveHistoryEvent(kv, item, sourceUrl) {
  const sharedAt = new Date().toISOString();
  const nonce = Math.random().toString(36).slice(2, 8);
  const key = `${HISTORY_PREFIX}${sharedAt}:${nonce}:${item.id}`;
  const event = {
    id: item.id,
    type: item.type,
    title: item.title,
    description: item.description,
    imageUrl: item.imageUrl,
    author: item.author,
    publisher: item.publisher,
    sourceUrl,
    canonicalUrl: item.canonicalUrl,
    sharedAt
  };

  await kv.put(key, JSON.stringify(event));
}

function getIdPrefix(type) {
  if (typeof type === 'string' && type.startsWith('podcast_')) return 'p';
  if (type === 'article') return 'a';
  return 's';
}

function mergeObjects(previous, next) {
  return {
    ...(previous || {}),
    ...(next || {})
  };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

export async function hashText(text) {
  const input = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
