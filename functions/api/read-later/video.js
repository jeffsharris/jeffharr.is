import { getContentDb } from '../content-library/db.js';
import { getReadLaterItem } from '../content-library/read-later-store.js';
import { jsonResponse } from '../content-library/serialize.js';
import { getYouTubeInfo, directVideo } from './media-utils.js';
import { getAdminUser } from '../content-library/auth.js';

export function selectXVideo(media) {
  if (media?.type !== 'video') return null;
  const variants = (media.variants || []).filter(v => v.content_type === 'video/mp4' && /^https:\/\//.test(v.url || ''));
  variants.sort((a, b) => (b.bit_rate || 0) - (a.bit_rate || 0));
  return {
    url: variants[0]?.url || null,
    contentType: variants[0] ? 'video/mp4' : null,
    provider: 'x',
    thumbnailUrl: /^https:\/\//.test(media.preview_image_url || '') ? media.preview_image_url : null
  };
}

// Batch official X metadata, including negative results, so text posts stay in Read Later.
export async function enrichXVideos(db, items, env, fetchImpl = fetch) {
  if (!env.X_API_BEARER_TOKEN) return;
  const candidates = items.filter(item => {
    try {
      const url = new URL(item.url);
      return /^(www\.|mobile\.)?(x\.com|twitter\.com)$/.test(url.hostname)
        && /\/status\/\d+/.test(url.pathname)
        && (!item.videoCheckedAt || Date.now() - Date.parse(item.videoCheckedAt) > 86400000
          || (item.video && !Object.hasOwn(item.video, 'thumbnailUrl')));
    } catch { return false; }
  }).slice(0, 50);
  if (!candidates.length) return;
  const ids = candidates.map(item => item.url.match(/\/status\/(\d+)/)[1]);
  const endpoint = new URL('https://api.x.com/2/tweets');
  endpoint.searchParams.set('ids', [...new Set(ids)].join(','));
  endpoint.searchParams.set('expansions', 'attachments.media_keys');
  endpoint.searchParams.set('tweet.fields', 'attachments');
  endpoint.searchParams.set('media.fields', 'type,variants,preview_image_url');
  try {
    const response = await fetchImpl(endpoint, {
      headers: { Authorization: `Bearer ${env.X_API_BEARER_TOKEN}` },
      signal: AbortSignal.timeout(6000)
    });
    if (!response.ok) return;
    const data = await response.json();
    const media = new Map((data.includes?.media || []).map(m => [m.media_key, m]));
    const tweets = new Map((data.data || []).map(t => [t.id, t]));
    for (const item of candidates) {
      const tweet = tweets.get(item.url.match(/\/status\/(\d+)/)[1]);
      if (!tweet) continue;
      const video = (tweet.attachments?.media_keys || []).map(key => selectXVideo(media.get(key))).find(Boolean) || null;
      const checkedAt = new Date().toISOString();
      await db.prepare(`UPDATE items SET extra_json = json_set(COALESCE(extra_json, '{}'),
        '$.video', json(?), '$.videoCheckedAt', ?) WHERE id = ?`)
        .bind(JSON.stringify(video), checkedAt, item.itemId).run();
      item.video = video;
      item.videoCheckedAt = checkedAt;
    }
  } catch { /* Keep the queue available when the provider is unavailable. */ }
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return jsonResponse({ error: 'Method not allowed' }, { status: 405 });
  const db = getContentDb(env);
  if (!db) return jsonResponse({ error: 'Storage unavailable' }, { status: 503 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return jsonResponse({ error: 'Missing item id' }, { status: 400 });
  const item = await getReadLaterItem(db, id);
  if (!item) return jsonResponse({ error: 'Item not found' }, { status: 404 });
  // Refresh expiring media on playback, but avoid repeated provider calls for quick reopens.
  const recentlyChecked = Date.now() - Date.parse(item.videoCheckedAt) < 900000;
  if (await getAdminUser(request, env)) {
    await enrichXVideos(db, [{ ...item, videoCheckedAt: recentlyChecked ? item.videoCheckedAt : null }], env);
  }
  const refreshed = await getReadLaterItem(db, item.id);
  const video = refreshed?.video || directVideo(item.url);
  return jsonResponse({ video, provider: getYouTubeInfo(item.url) ? 'youtube' : (video?.provider || 'web') }, { cache: 'no-store' });
}
