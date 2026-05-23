import { safeJsonParse } from './ids.js';

function serializeList(list) {
  if (!list) return null;
  return {
    id: list.id,
    slug: list.slug,
    title: list.title,
    description: list.description || '',
    visibility: list.visibility,
    kind: list.kind,
    sortMode: list.sort_mode,
    createdAt: list.created_at,
    updatedAt: list.updated_at
  };
}

function serializeListEntryRow(row) {
  const itemExtra = safeJsonParse(row.item_extra_json, {});
  const entryExtra = safeJsonParse(row.entry_extra_json, {});
  const url = row.canonical_url || row.source_url || '';
  return {
    id: row.entry_id,
    status: row.entry_status,
    position: row.position,
    note: row.note || '',
    addedAt: row.added_at,
    updatedAt: row.entry_updated_at,
    extra: entryExtra || {},
    item: {
      id: row.item_id,
      kind: row.item_kind,
      canonicalKey: row.canonical_key,
      canonicalUrl: row.canonical_url || null,
      sourceUrl: row.source_url || null,
      url,
      title: row.title,
      subtitle: row.subtitle || '',
      summary: row.summary || '',
      creator: row.creator || '',
      publisher: row.publisher || '',
      publishedAt: row.published_at || null,
      language: row.language || '',
      thumbnailAssetId: row.thumbnail_asset_id || null,
      primaryAssetId: row.primary_asset_id || null,
      extra: itemExtra || {}
    }
  };
}

function jsonResponse(body, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache
    }
  });
}

async function parseJson(request, fallback = null) {
  try {
    return await request.json();
  } catch {
    return fallback;
  }
}

export { jsonResponse, parseJson, serializeList, serializeListEntryRow };
