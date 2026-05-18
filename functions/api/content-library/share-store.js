import { upsertShareResolvedItem } from './resolve.js';
import { getAssetByRole, parseRowJson } from './db.js';
import { createStableId, getNowIso, hashText, safeJsonParse } from './ids.js';

async function saveShareItemToContentLibrary({ db, item, sourceUrl, requestUrl }) {
  const contentItem = await upsertShareResolvedItem({ db, resolved: item, sourceUrl });
  const now = getNowIso();
  const identityKey = item.identityKey || `url:${item.sourceUrl || sourceUrl}`;
  const identityHash = await hashText(identityKey);
  const shareSlug = item.id || `${getShareIdPrefix(item.type)}_${identityHash.slice(0, 12)}`;
  const existing = await loadSharePage(db, shareSlug);
  const shareCount = Number(existing?.share_count || 0) + 1;
  const shareUrl = requestUrl ? new URL(`/share/${shareSlug}`, requestUrl).href : `/share/${shareSlug}`;

  await db.batch([
    db.prepare(
      `INSERT INTO share_details (
        item_id, share_slug, share_url, render_kind, share_count, visibility,
        extra_json, created_at, updated_at, rendered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(share_slug) DO UPDATE SET
        item_id = excluded.item_id,
        share_url = excluded.share_url,
        render_kind = excluded.render_kind,
        share_count = excluded.share_count,
        extra_json = excluded.extra_json,
        updated_at = excluded.updated_at`
    ).bind(
      contentItem.id,
      shareSlug,
      shareUrl,
      item.type || contentItem.kind,
      shareCount,
      'unlisted',
      JSON.stringify({ identityKey, identityHash, resolution: item.resolution || null }),
      existing?.created_at || item.createdAt || now,
      now,
      now
    ),
    db.prepare(
      `INSERT INTO share_events (
        id, share_slug, item_id, source_url, title, summary, image_url,
        creator, publisher, shared_at, extra_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      await createStableId('sev', `${shareSlug}:${now}:${Math.random()}`),
      shareSlug,
      contentItem.id,
      sourceUrl || item.sourceUrl || null,
      item.title || contentItem.title,
      item.description || contentItem.summary || null,
      item.imageUrl || null,
      item.author || contentItem.creator || null,
      item.publisher || contentItem.publisher || null,
      now,
      JSON.stringify({ type: item.type || contentItem.kind })
    )
  ]);

  return loadShareItem(db, shareSlug);
}

async function loadShareItem(db, shareSlug) {
  const page = await loadSharePage(db, shareSlug);
  if (!page) return null;
  const imageAsset = await getAssetByRole(db, page.item_id, 'thumbnail');
  const audioAsset = await getAssetByRole(db, page.item_id, 'audio');
  const extra = safeJsonParse(page.item_extra_json, {}) || {};
  const shareExtra = safeJsonParse(page.share_extra_json, {}) || {};
  return {
    id: page.share_slug,
    type: shareExtra.type || extra.shareType || page.render_kind || page.item_kind,
    sourceUrl: page.source_url || page.canonical_url || '',
    canonicalUrl: page.canonical_url || page.source_url || '',
    identityKey: shareExtra.identityKey || page.canonical_key,
    identityHash: shareExtra.identityHash || '',
    title: page.title,
    description: page.summary || '',
    imageUrl: imageAsset?.url || '',
    author: page.creator || '',
    publisher: page.publisher || '',
    createdAt: page.created_at,
    updatedAt: page.updated_at,
    shareCount: page.share_count || 0,
    platforms: extra.platforms || {},
    media: {
      ...(extra.media || {}),
      ...(audioAsset?.url ? {
        audioUrl: audioAsset.url,
        audioType: audioAsset.mime_type,
        durationSeconds: audioAsset.duration_seconds
      } : {})
    },
    podcast: extra.podcast || null,
    x: extra.x || null,
    resolution: shareExtra.resolution || extra.resolution || null
  };
}

async function loadSharePage(db, shareSlug) {
  return db.prepare(
    `SELECT
      sd.item_id,
      sd.share_slug,
      sd.share_url,
      sd.render_kind,
      sd.share_count,
      sd.extra_json AS share_extra_json,
      sd.created_at,
      sd.updated_at,
      i.kind AS item_kind,
      i.canonical_key,
      i.canonical_url,
      i.source_url,
      i.title,
      i.summary,
      i.creator,
      i.publisher,
      i.extra_json AS item_extra_json
     FROM share_details sd
     JOIN items i ON i.id = sd.item_id
     WHERE sd.share_slug = ?`
  ).bind(shareSlug).first();
}

async function listShareHistoryFromContentLibrary(db, { limit = 100 } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 100, 1), 250);
  const result = await db.prepare(
    `SELECT
      se.share_slug,
      se.source_url,
      se.title,
      se.summary,
      se.image_url,
      se.creator,
      se.publisher,
      se.shared_at,
      i.kind,
      i.canonical_url
     FROM share_events se
     JOIN items i ON i.id = se.item_id
     ORDER BY se.shared_at DESC
     LIMIT ?`
  ).bind(safeLimit).all();

  return (result.results || []).map((row) => ({
    id: row.share_slug,
    type: row.kind,
    title: row.title,
    description: row.summary,
    imageUrl: row.image_url,
    author: row.creator,
    publisher: row.publisher,
    sourceUrl: row.source_url,
    canonicalUrl: row.canonical_url,
    sharedAt: row.shared_at
  }));
}

function getShareIdPrefix(type) {
  if (typeof type === 'string' && type.startsWith('podcast_')) return 'p';
  if (type === 'x_post') return 'x';
  if (type === 'article') return 'a';
  return 's';
}

export {
  listShareHistoryFromContentLibrary,
  loadShareItem,
  saveShareItemToContentLibrary
};
