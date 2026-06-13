import { authenticateAdminRequest, adminJsonResponse } from '../lib/admin-auth.js';
import { READ_LATER_LIST_ID, getContentDb } from '../content-library/db.js';
import { parseJson } from '../content-library/serialize.js';
import { enqueueCoverGeneration } from './cover-sync-service.js';
import { getReadLaterAssetItemId } from './asset-store.js';
import { ensureSourceThumbnail } from './source-thumbnail.js';
import { isXStatusUrl } from './x-adapter.js';
import { createReadLaterStores } from './stores.js';
import { createLogger, formatError } from '../lib/logger.js';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 250;

export async function onRequest(context) {
  const { request, env } = context;
  const logger = createLogger({ request, source: 'read-later-thumbnail-backfill' });
  const log = logger.log;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  if (request.method !== 'POST') {
    return adminJsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const auth = await authenticateAdminRequest(request, env);
  if (!auth.admin) {
    return adminJsonResponse({ ok: false, error: auth.error }, { status: auth.status || 401 });
  }

  const db = getContentDb(env);
  const stores = createReadLaterStores(env, { requireAssets: true });
  if (!db || !stores) {
    return adminJsonResponse({ ok: false, error: 'Storage unavailable' }, { status: 500 });
  }

  let payload = {};
  try {
    payload = await parseJson(request);
  } catch {
    payload = {};
  }

  const limit = clampLimit(payload?.limit);
  const dryRun = payload?.dryRun !== false;

  try {
    const rows = await listThumbnailBackfillCandidates(db, { limit });
    const results = [];

    for (const row of rows) {
      const item = await stores.readLaterStore.getItem(row.entry_id);
      if (!item) {
        results.push({ id: row.entry_id, action: 'missing' });
        continue;
      }

      const assetItemId = getReadLaterAssetItemId(item);
      const reader = assetItemId ? await stores.assetStore.getReader(assetItemId) : null;
      if (dryRun) {
        results.push({
          id: item.id,
          itemId: item.itemId,
          kind: item.kind,
          url: item.url,
          action: 'candidate',
          hasReader: Boolean(reader?.contentHtml)
        });
        continue;
      }

      const thumbnail = await ensureSourceThumbnail({
        item,
        reader,
        assetStore: stores.assetStore,
        log,
        force: true
      });
      if (thumbnail.saved) {
        results.push({
          id: item.id,
          itemId: item.itemId,
          kind: item.kind,
          action: 'thumbnail_saved',
          thumbnailUrl: thumbnail.thumbnailUrl,
          sourceUrl: thumbnail.sourceUrl || null,
          sourceKind: thumbnail.sourceKind || null
        });
        continue;
      }

      if (item.kind === 'x_post' || thumbnail.sourceKind === 'x' || isXStatusUrl(thumbnail.sourceUrl)) {
        const queued = await enqueueCoverGeneration({
          item,
          readLaterStore: stores.readLaterStore,
          assetStore: stores.assetStore,
          env,
          log,
          reason: 'thumbnail-backfill',
          force: true
        });
        results.push({
          id: item.id,
          itemId: item.itemId,
          kind: item.kind,
          action: queued.queued ? 'x_queued' : 'x_queue_skipped',
          sourceUrl: thumbnail.sourceUrl || null,
          reason: queued.queueMissing ? 'queue_missing' : queued.queueFailed ? 'queue_failed' : queued.inProgress ? 'in_progress' : null
        });
        continue;
      }

      results.push({
        id: item.id,
        itemId: item.itemId,
        kind: item.kind,
        action: 'no_source_thumbnail',
        sourceUrl: thumbnail.sourceUrl || null,
        sourceKind: thumbnail.sourceKind || null,
        reason: thumbnail.reason || null
      });
    }

    return adminJsonResponse({
      ok: true,
      dryRun,
      count: results.length,
      results
    });
  } catch (error) {
    log('error', 'thumbnail_backfill_failed', {
      stage: 'thumbnail_backfill',
      ...formatError(error)
    });
    return adminJsonResponse({ ok: false, error: 'Backfill failed' }, { status: 500 });
  }
}

async function listThumbnailBackfillCandidates(db, { limit }) {
  const result = await db.prepare(
    `SELECT
       le.id AS entry_id,
       i.id AS item_id,
       i.kind,
       i.canonical_url,
       i.source_url
     FROM list_entries le
     JOIN items i ON i.id = le.item_id
     WHERE le.list_id = ?
       AND NOT EXISTS (
         SELECT 1
         FROM assets a
         WHERE a.item_id = i.id
           AND a.role = 'thumbnail'
           AND a.url IS NOT NULL
       )
       AND (
         i.kind IN ('video', 'x_post')
         OR i.canonical_url LIKE '%youtube.com%'
         OR i.canonical_url LIKE '%youtu.be%'
         OR i.canonical_url LIKE '%x.com/%/status/%'
         OR i.canonical_url LIKE '%twitter.com/%/status/%'
         OR i.canonical_url LIKE '%t.co/%'
         OR i.source_url LIKE '%t.co/%'
       )
     ORDER BY le.added_at DESC
     LIMIT ?`
  ).bind(READ_LATER_LIST_ID, limit).all();
  return result.results || [];
}

function clampLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LIMIT;
  return Math.min(parsed, MAX_LIMIT);
}
