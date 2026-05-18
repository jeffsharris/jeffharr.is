import {
  createRandomId,
  createStableId,
  getNowIso,
  safeJsonParse,
  stringifyJson
} from './ids.js';

const READ_LATER_LIST_ID = 'lst_read_later';
const STARRED_LIST_ID = 'lst_starred';

function getContentDb(env) {
  return env?.CONTENT_DB || null;
}

function getContentAssets(env) {
  return env?.CONTENT_ASSETS || null;
}

function hasContentLibrary(env) {
  return Boolean(getContentDb(env));
}

async function listLists(db) {
  const result = await db.prepare(
    `SELECT id, slug, title, description, visibility, kind, sort_mode, created_at, updated_at
     FROM lists
     ORDER BY title`
  ).all();
  return result.results || [];
}

async function getListBySlug(db, slug) {
  if (!db || !slug) return null;
  return db.prepare(
    `SELECT id, slug, title, description, visibility, kind, sort_mode, created_at, updated_at
     FROM lists
     WHERE slug = ?`
  ).bind(slug).first();
}

async function ensureSystemLists(db) {
  const now = getNowIso();
  await db.batch([
    db.prepare(
      `INSERT INTO lists (
        id, slug, title, description, visibility, kind, sort_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO NOTHING`
    ).bind(
      STARRED_LIST_ID,
      'starred',
      'Starred',
      'Default saved favorites across content types.',
      'private',
      'system',
      'added_desc',
      now,
      now
    ),
    db.prepare(
      `INSERT INTO lists (
        id, slug, title, description, visibility, kind, sort_mode, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO NOTHING`
    ).bind(
      READ_LATER_LIST_ID,
      'read-later',
      'Read Later',
      'Items saved for reading, watching, or listening later.',
      'public',
      'system',
      'added_desc',
      now,
      now
    )
  ]);
}

async function upsertItem(db, item) {
  const now = getNowIso();
  const id = item.id || await createStableId('itm', item.canonicalKey);
  const createdAt = item.createdAt || now;
  const updatedAt = item.updatedAt || now;
  const title = normalizeTitle(item.title, item.canonicalUrl || item.sourceUrl || item.canonicalKey);

  await db.prepare(
    `INSERT INTO items (
      id, kind, canonical_key, canonical_url, source_url, title, subtitle, summary,
      creator, publisher, published_at, language, thumbnail_asset_id, primary_asset_id,
      extra_json, created_at, updated_at, resolved_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(canonical_key) DO UPDATE SET
      kind = excluded.kind,
      canonical_url = COALESCE(excluded.canonical_url, items.canonical_url),
      source_url = COALESCE(excluded.source_url, items.source_url),
      title = COALESCE(NULLIF(excluded.title, ''), items.title),
      subtitle = COALESCE(excluded.subtitle, items.subtitle),
      summary = COALESCE(excluded.summary, items.summary),
      creator = COALESCE(excluded.creator, items.creator),
      publisher = COALESCE(excluded.publisher, items.publisher),
      published_at = COALESCE(excluded.published_at, items.published_at),
      language = COALESCE(excluded.language, items.language),
      thumbnail_asset_id = COALESCE(excluded.thumbnail_asset_id, items.thumbnail_asset_id),
      primary_asset_id = COALESCE(excluded.primary_asset_id, items.primary_asset_id),
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at,
      resolved_at = COALESCE(excluded.resolved_at, items.resolved_at)`
  ).bind(
    id,
    item.kind,
    item.canonicalKey,
    item.canonicalUrl || null,
    item.sourceUrl || null,
    title,
    item.subtitle || null,
    item.summary || null,
    item.creator || null,
    item.publisher || null,
    item.publishedAt || null,
    item.language || null,
    item.thumbnailAssetId || null,
    item.primaryAssetId || null,
    stringifyJson(item.extra),
    createdAt,
    updatedAt,
    item.resolvedAt || now
  ).run();

  return getItemByCanonicalKey(db, item.canonicalKey);
}

async function getItemByCanonicalKey(db, canonicalKey) {
  if (!db || !canonicalKey) return null;
  return db.prepare(
    `SELECT * FROM items WHERE canonical_key = ?`
  ).bind(canonicalKey).first();
}

async function getItemById(db, id) {
  if (!db || !id) return null;
  return db.prepare(
    `SELECT * FROM items WHERE id = ?`
  ).bind(id).first();
}

async function upsertAsset(db, asset) {
  const now = getNowIso();
  const id = asset.id || await createStableId('ast', [
    asset.itemId,
    asset.role,
    asset.r2Key || asset.url || asset.kind
  ].filter(Boolean).join(':'));
  const createdAt = asset.createdAt || now;
  const updatedAt = asset.updatedAt || now;

  await db.prepare(
    `INSERT INTO assets (
      id, item_id, role, kind, url, r2_key, mime_type, width, height,
      duration_seconds, byte_size, alt_text, content_sha256, extra_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      role = excluded.role,
      kind = excluded.kind,
      url = COALESCE(excluded.url, assets.url),
      r2_key = COALESCE(excluded.r2_key, assets.r2_key),
      mime_type = COALESCE(excluded.mime_type, assets.mime_type),
      width = COALESCE(excluded.width, assets.width),
      height = COALESCE(excluded.height, assets.height),
      duration_seconds = COALESCE(excluded.duration_seconds, assets.duration_seconds),
      byte_size = COALESCE(excluded.byte_size, assets.byte_size),
      alt_text = COALESCE(excluded.alt_text, assets.alt_text),
      content_sha256 = COALESCE(excluded.content_sha256, assets.content_sha256),
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at`
  ).bind(
    id,
    asset.itemId,
    asset.role,
    asset.kind,
    asset.url || null,
    asset.r2Key || null,
    asset.mimeType || null,
    integerOrNull(asset.width),
    integerOrNull(asset.height),
    numberOrNull(asset.durationSeconds),
    integerOrNull(asset.byteSize),
    asset.altText || null,
    asset.contentSha256 || null,
    stringifyJson(asset.extra),
    createdAt,
    updatedAt
  ).run();

  return getAssetById(db, id);
}

async function getAssetById(db, id) {
  if (!db || !id) return null;
  return db.prepare(`SELECT * FROM assets WHERE id = ?`).bind(id).first();
}

async function getAssetByRole(db, itemId, role) {
  if (!db || !itemId || !role) return null;
  return db.prepare(
    `SELECT * FROM assets WHERE item_id = ? AND role = ? ORDER BY updated_at DESC LIMIT 1`
  ).bind(itemId, role).first();
}

async function upsertListEntry(db, {
  id,
  listId,
  itemId,
  status = 'active',
  position = null,
  note = null,
  addedAt = null,
  updatedAt = null,
  extra = {}
}) {
  const now = getNowIso();
  const entryId = id || createRandomId('ent');
  const entryAddedAt = addedAt || now;
  const entryUpdatedAt = updatedAt || now;

  await db.prepare(
    `INSERT INTO list_entries (
      id, list_id, item_id, status, position, note, added_at, updated_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(list_id, item_id) DO UPDATE SET
      status = excluded.status,
      position = COALESCE(excluded.position, list_entries.position),
      note = COALESCE(excluded.note, list_entries.note),
      added_at = excluded.added_at,
      updated_at = excluded.updated_at,
      extra_json = excluded.extra_json`
  ).bind(
    entryId,
    listId,
    itemId,
    status,
    numberOrNull(position),
    note,
    entryAddedAt,
    entryUpdatedAt,
    stringifyJson(extra)
  ).run();

  return getListEntry(db, listId, itemId);
}

async function getListEntry(db, listId, itemId) {
  return db.prepare(
    `SELECT * FROM list_entries WHERE list_id = ? AND item_id = ?`
  ).bind(listId, itemId).first();
}

async function getListEntryById(db, entryId) {
  if (!db || !entryId) return null;
  return db.prepare(
    `SELECT
      le.*,
      l.slug AS list_slug,
      i.id AS item_id,
      i.kind AS item_kind,
      i.canonical_key,
      i.canonical_url,
      i.source_url,
      i.title,
      i.subtitle,
      i.summary,
      i.creator,
      i.publisher,
      i.published_at,
      i.language,
      i.extra_json AS item_extra_json
     FROM list_entries le
     JOIN lists l ON l.id = le.list_id
     JOIN items i ON i.id = le.item_id
     WHERE le.id = ?`
  ).bind(entryId).first();
}

async function deleteListEntryById(db, entryId) {
  const existing = await getListEntryById(db, entryId);
  if (!existing) return null;
  await db.prepare(`DELETE FROM list_entries WHERE id = ?`).bind(entryId).run();
  return existing;
}

async function listEntries(db, slug, { limit = 500, status = null } = {}) {
  const safeLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 500, 1), 1000);
  const params = [slug];
  let statusSql = '';
  if (status) {
    statusSql = 'AND le.status = ?';
    params.push(status);
  }
  params.push(safeLimit);

  const result = await db.prepare(
    `SELECT
      le.id AS entry_id,
      le.status AS entry_status,
      le.position,
      le.note,
      le.added_at,
      le.updated_at AS entry_updated_at,
      le.extra_json AS entry_extra_json,
      i.id AS item_id,
      i.kind AS item_kind,
      i.canonical_key,
      i.canonical_url,
      i.source_url,
      i.title,
      i.subtitle,
      i.summary,
      i.creator,
      i.publisher,
      i.published_at,
      i.language,
      i.thumbnail_asset_id,
      i.primary_asset_id,
      i.extra_json AS item_extra_json
     FROM list_entries le
     JOIN lists l ON l.id = le.list_id
     JOIN items i ON i.id = le.item_id
     WHERE l.slug = ?
     ${statusSql}
     ORDER BY le.added_at DESC
     LIMIT ?`
  ).bind(...params).all();

  return result.results || [];
}

async function upsertItemSource(db, source) {
  const now = getNowIso();
  const id = source.id || await createStableId('src', [
    source.itemId,
    source.sourceKind,
    source.sourceId || source.sourceUrl || source.storageKey || now
  ].filter(Boolean).join(':'));

  await db.prepare(
    `INSERT INTO item_sources (
      id, item_id, source_kind, source_id, source_url, storage_kind, storage_key,
      source_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_url = COALESCE(excluded.source_url, item_sources.source_url),
      storage_kind = COALESCE(excluded.storage_kind, item_sources.storage_kind),
      storage_key = COALESCE(excluded.storage_key, item_sources.storage_key),
      source_json = excluded.source_json,
      updated_at = excluded.updated_at`
  ).bind(
    id,
    source.itemId,
    source.sourceKind,
    source.sourceId || null,
    source.sourceUrl || null,
    source.storageKind || null,
    source.storageKey || null,
    stringifyJson(source.source),
    source.createdAt || now,
    source.updatedAt || now
  ).run();
}

function normalizeTitle(title, fallback = 'Untitled') {
  const value = typeof title === 'string' ? title.trim() : '';
  if (value) return value.slice(0, 500);
  return String(fallback || 'Untitled').slice(0, 500);
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseRowJson(row, key, fallback = {}) {
  return safeJsonParse(row?.[key], fallback);
}

export {
  READ_LATER_LIST_ID,
  STARRED_LIST_ID,
  deleteListEntryById,
  ensureSystemLists,
  getAssetById,
  getAssetByRole,
  getContentAssets,
  getContentDb,
  getItemByCanonicalKey,
  getItemById,
  getListBySlug,
  getListEntry,
  getListEntryById,
  hasContentLibrary,
  listEntries,
  listLists,
  parseRowJson,
  upsertAsset,
  upsertItem,
  upsertItemSource,
  upsertListEntry
};
