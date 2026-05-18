#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const checkR2Objects = args.has('--r2');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
const KV_NAMESPACE_ID = process.env.READ_LATER_KV_NAMESPACE_ID || '1ab7a301e16e47f7a17651e89f7442b6';
const DATABASE_ID = process.env.CONTENT_LIBRARY_DATABASE_ID || 'efe5518b-5617-4ee8-992a-5c84f4cfe900';
const R2_BUCKET = process.env.CONTENT_ASSETS_BUCKET || 'jeffharr-is-content-assets';
const CORPORA = ['brensilver', 'burbea', 'watts'];

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

const failures = [];
const warnings = [];
const summary = {
  readLater: {},
  shares: {},
  dharma: {},
  r2: {}
};

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});

async function main() {
  await validateReadLater();
  await validateShares();
  await validateDharma();
  if (checkR2Objects) {
    await validateR2Objects();
  }

  console.log(JSON.stringify({ summary, warnings, failureCount: failures.length }, null, 2));
  if (failures.length > 0) {
    console.error('\nValidation failures:');
    failures.slice(0, 50).forEach((failure) => console.error(`- ${failure}`));
    if (failures.length > 50) {
      console.error(`- ... ${failures.length - 50} more`);
    }
    process.exit(1);
  }
}

async function validateReadLater() {
  console.error('[validate] read later: loading KV item/reader/cover records');
  const kvItems = await listKvJson('item:');
  const kvReaders = await listKvJson('reader:');
  const kvCovers = await listKvJson('cover:');
  console.error('[validate] read later: loading D1 rows');
  const rows = await d1Rows(`
    SELECT
      le.id AS entry_id,
      le.status,
      le.added_at,
      i.id AS item_id,
      i.kind,
      i.canonical_url,
      i.source_url,
      i.title,
      i.summary,
      i.creator,
      i.publisher,
      rs.read_at,
      rs.progress_json,
      rs.kindle_json,
      rs.cover_sync_json,
      rs.push_channels_json
    FROM list_entries le
    JOIN items i ON i.id = le.item_id
    LEFT JOIN read_state rs ON rs.entry_id = le.id
    WHERE le.list_id = 'lst_read_later'
    ORDER BY le.id
  `);
  const auditRows = await d1Rows(`
    SELECT source_key, target_id, checksum, status
    FROM migration_audit
    WHERE source_kind = 'read_later_kv' AND target_kind = 'list_entry'
  `);
  const assetRows = await d1Rows(`
    SELECT le.id AS entry_id, a.role, a.r2_key, a.mime_type, a.byte_size, a.content_sha256
    FROM list_entries le
    JOIN assets a ON a.item_id = le.item_id
    WHERE le.list_id = 'lst_read_later' AND a.role IN ('reader_html', 'generated_cover')
  `);

  const rowById = new Map(rows.map((row) => [row.entry_id, row]));
  const auditByKey = new Map(auditRows.map((row) => [row.source_key, row]));
  const assetsByEntryRole = new Map(assetRows.map((row) => [`${row.entry_id}:${row.role}`, row]));

  compareCount('read later entries', kvItems.length, rows.length);
  compareCount('read later audit rows', kvItems.length, auditRows.length);

  let active = 0;
  let archived = 0;
  let associatedReaders = 0;
  let associatedCovers = 0;

  for (const { key, value: item } of kvItems) {
    const row = rowById.get(item.id);
    if (!row) {
      fail(`read later item missing from D1: ${key}`);
      continue;
    }

    if (item.read) archived += 1;
    else active += 1;

    const audit = auditByKey.get(key);
    if (!audit || audit.status !== 'succeeded') {
      fail(`read later audit missing or failed for ${key}`);
    } else if (audit.checksum !== sha256Json(item)) {
      fail(`read later audit checksum mismatch for ${key}`);
    }

    compareValue(`read later url ${item.id}`, normalizeHttpUrl(item.url), row.canonical_url || row.source_url);
    compareValue(`read later title ${item.id}`, normalizeTitle(item.title, item.url), row.title);
    compareValue(`read later savedAt ${item.id}`, normalizeIso(item.savedAt), row.added_at);
    compareValue(`read later read flag ${item.id}`, item.read ? 'done' : 'active', row.status);

    if (item.readAt) {
      compareValue(`read later readAt ${item.id}`, normalizeIso(item.readAt), row.read_at);
    } else if (item.read && !row.read_at) {
      fail(`read later archived item has no D1 read_at: ${item.id}`);
    } else if (!item.read && row.read_at) {
      fail(`read later active item unexpectedly has D1 read_at: ${item.id}`);
    }

    compareJson(`read later progress ${item.id}`, item.progress || null, parseJson(row.progress_json));
    compareJson(`read later kindle ${item.id}`, item.kindle || null, parseJson(row.kindle_json));
    compareJson(`read later coverSync ${item.id}`, item.coverSync || null, parseJson(row.cover_sync_json));
    compareJson(`read later pushChannels ${item.id}`, item.pushChannels || null, parseJson(row.push_channels_json));

    const reader = kvReaders.find((entry) => entry.key === `reader:${item.id}`)?.value || null;
    if (reader?.contentHtml) {
      associatedReaders += 1;
      const asset = assetsByEntryRole.get(`${item.id}:reader_html`);
      if (!asset) {
        fail(`reader asset missing for read later item ${item.id}`);
      } else {
        compareValue(`reader asset hash ${item.id}`, sha256Json(reader), asset.content_sha256);
        compareValue(`reader asset byte size ${item.id}`, Buffer.byteLength(JSON.stringify(reader)), asset.byte_size);
      }
    }

    const cover = kvCovers.find((entry) => entry.key === `cover:${item.id}`)?.value || null;
    if (cover?.base64) {
      associatedCovers += 1;
      const bytes = Buffer.from(cover.base64, 'base64');
      const asset = assetsByEntryRole.get(`${item.id}:generated_cover`);
      if (!asset) {
        fail(`cover asset missing for read later item ${item.id}`);
      } else {
        compareValue(`cover asset hash ${item.id}`, sha256Bytes(bytes), asset.content_sha256);
        compareValue(`cover asset byte size ${item.id}`, bytes.byteLength, asset.byte_size);
        compareValue(`cover asset mime ${item.id}`, cover.contentType || 'image/png', asset.mime_type);
      }
    }
  }

  const kvItemIds = new Set(kvItems.map((entry) => entry.value?.id).filter(Boolean));
  const orphanReaders = kvReaders.filter((entry) => !kvItemIds.has(entry.key.slice('reader:'.length)));
  const orphanCovers = kvCovers.filter((entry) => !kvItemIds.has(entry.key.slice('cover:'.length)));
  if (orphanReaders.length) warnings.push(`legacy KV has ${orphanReaders.length} reader:* keys not attached to current item:* records`);
  if (orphanCovers.length) warnings.push(`legacy KV has ${orphanCovers.length} cover:* keys not attached to current item:* records`);

  summary.readLater = {
    kvItems: kvItems.length,
    d1Entries: rows.length,
    active,
    archived,
    associatedReaders,
    associatedCovers,
    orphanReaders: orphanReaders.length,
    orphanCovers: orphanCovers.length
  };
}

async function validateShares() {
  console.error('[validate] shares: loading KV records');
  const kvShares = await listKvJson('share:item:');
  const kvHistory = await listKvJson('share:history:');
  console.error('[validate] shares: loading D1 rows');
  const sourceRows = await d1Rows(`
    SELECT source_id, storage_key, source_json
    FROM item_sources
    WHERE source_kind = 'share_kv'
  `);
  const shareRows = await d1Rows(`
    SELECT sd.share_slug, sd.render_kind, sd.share_count, i.title, i.canonical_url, i.source_url
    FROM share_details sd
    JOIN items i ON i.id = sd.item_id
  `);
  const eventRows = await d1Rows(`
    SELECT share_slug, source_url, title, summary, image_url, creator, publisher, shared_at, extra_json
    FROM share_events
  `);

  const sourceByKey = new Map(sourceRows.map((row) => [row.storage_key, row]));
  const shareBySlug = new Map(shareRows.map((row) => [row.share_slug, row]));
  const eventsByMigratedKey = new Map();
  for (const row of eventRows) {
    const extra = parseJson(row.extra_json) || {};
    if (extra.migratedFrom) eventsByMigratedKey.set(extra.migratedFrom, row);
  }

  compareCount('share items', kvShares.length, shareRows.length);
  compareCount('share source records', kvShares.length, sourceRows.length);
  compareCount('share history events', kvHistory.length, eventRows.length);

  for (const { key, value: share } of kvShares) {
    const source = sourceByKey.get(key);
    if (!source) {
      fail(`share source missing from D1: ${key}`);
    } else {
      compareJson(`share source json ${key}`, share, parseJson(source.source_json));
    }

    const row = shareBySlug.get(share.id);
    if (!row) {
      fail(`share detail missing from D1: ${share.id}`);
      continue;
    }
    compareValue(`share title ${share.id}`, normalizeTitle(share.title, share.sourceUrl || share.id), row.title);
    compareValue(`share count ${share.id}`, Number(share.shareCount || 0), Number(row.share_count || 0));
  }

  for (const { key, value: event } of kvHistory) {
    const row = eventsByMigratedKey.get(key);
    if (!row) {
      fail(`share history event missing from D1: ${key}`);
      continue;
    }
    compareValue(`share history slug ${key}`, event.id, row.share_slug);
    compareValue(`share history sourceUrl ${key}`, event.sourceUrl || null, row.source_url);
    compareValue(`share history title ${key}`, event.title || null, row.title);
    compareValue(`share history sharedAt ${key}`, normalizeIso(event.sharedAt), row.shared_at);
  }

  summary.shares = {
    kvShares: kvShares.length,
    d1Shares: shareRows.length,
    kvHistory: kvHistory.length,
    d1Events: eventRows.length
  };
}

async function validateDharma() {
  console.error('[validate] dharma: loading D1 rows and local talks.json files');
  const sourceRows = await d1Rows(`
    SELECT source_id, storage_key, source_json
    FROM item_sources
    WHERE source_kind = 'dharma_corpus'
  `);
  const detailRows = await d1Rows(`
    SELECT
      d.corpus,
      d.source,
      d.source_id,
      i.title,
      i.canonical_url,
      i.source_url,
      i.summary,
      i.creator,
      i.published_at,
      audio.url AS audio_url,
      artwork.url AS artwork_url,
      chapters.url AS chapters_url
    FROM dharma_talk_details d
    JOIN items i ON i.id = d.item_id
    LEFT JOIN assets audio ON audio.id = d.audio_asset_id
    LEFT JOIN assets artwork ON artwork.id = d.artwork_asset_id
    LEFT JOIN assets chapters ON chapters.id = d.chapters_asset_id
  `);

  const sourceById = new Map(sourceRows.map((row) => [row.source_id, row]));
  const detailByKey = new Map(detailRows.map((row) => [`${row.corpus}:${row.source}:${row.source_id}`, row]));
  const corpusCounts = {};
  let expectedTotal = 0;

  for (const corpus of CORPORA) {
    const talksPath = path.join(process.cwd(), 'dharma', corpus, 'talks.json');
    const talks = JSON.parse(await fs.readFile(talksPath, 'utf8'));
    corpusCounts[corpus] = talks.length;
    expectedTotal += talks.length;

    for (const talk of talks) {
      const source = talk.source || '';
      const sourceId = talk.source_id || String(talk.id || '').split(':').pop() || '';
      const sourceKey = `${corpus}:${talk.id}`;
      const detailKey = `${corpus}:${source}:${sourceId}`;
      const sourceRow = sourceById.get(sourceKey);
      const detail = detailByKey.get(detailKey);

      if (!sourceRow) {
        fail(`Dharma source missing from D1: ${sourceKey}`);
      } else {
        compareJson(`Dharma source json ${sourceKey}`, talk, parseJson(sourceRow.source_json));
      }

      if (!detail) {
        fail(`Dharma detail missing from D1: ${detailKey}`);
        continue;
      }

      compareValue(`Dharma title ${detailKey}`, talk.title || 'Untitled Dharma talk', detail.title);
      compareValue(`Dharma speaker ${detailKey}`, talk.speaker || null, detail.creator);
      compareValue(`Dharma canonical/source ${detailKey}`, talk.canonical_url || talk.link || null, detail.canonical_url || detail.source_url);
      compareValue(`Dharma audio ${detailKey}`, normalizeHttpUrl(talk.audio_url), detail.audio_url);
      compareValue(`Dharma artwork ${detailKey}`, normalizeHttpUrl(talk.episode_image_url || talk.image_url), detail.artwork_url);
      compareValue(`Dharma chapters ${detailKey}`, normalizeHttpUrl(talk.chapters_url), detail.chapters_url);
    }
  }

  compareCount('Dharma source records', expectedTotal, sourceRows.length);
  compareCount('Dharma detail records', expectedTotal, detailRows.length);

  summary.dharma = {
    corpora: corpusCounts,
    expectedTotal,
    d1Sources: sourceRows.length,
    d1Talks: detailRows.length
  };
}

async function validateR2Objects() {
  console.error('[validate] R2: checking object bytes and hashes');
  const rows = await d1Rows(`
    SELECT r2_key, byte_size, content_sha256
    FROM assets
    WHERE r2_key IS NOT NULL
    ORDER BY r2_key
  `);
  let checked = 0;
  for (const row of rows) {
    const objectPath = `${R2_BUCKET}/${row.r2_key}`;
    const result = spawnSync('wrangler', ['r2', 'object', 'get', objectPath, '--remote', '--pipe'], {
      encoding: null,
      maxBuffer: 25 * 1024 * 1024
    });
    if (result.status !== 0) {
      fail(`R2 object get failed for ${objectPath}: ${String(result.stderr || '').trim()}`);
      continue;
    }
    const bytes = result.stdout || Buffer.alloc(0);
    compareValue(`R2 byte size ${row.r2_key}`, Number(row.byte_size), bytes.byteLength);
    compareValue(`R2 hash ${row.r2_key}`, row.content_sha256, sha256Bytes(bytes));
    checked += 1;
  }
  summary.r2 = {
    expectedObjects: rows.length,
    checked
  };
}

async function listKvJson(prefix) {
  const keys = [];
  for await (const key of listKvKeys(prefix)) {
    keys.push(key.name);
  }
  console.error(`[validate] KV ${prefix}: ${keys.length} keys`);
  const entries = await mapConcurrent(keys, 12, async (key) => ({ key, value: await getKvJson(key) }));
  return entries.filter((entry) => entry.value);
}

async function mapConcurrent(values, concurrency, mapper) {
  const results = new Array(values.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function* listKvKeys(prefix) {
  let cursor = null;
  do {
    const query = new URLSearchParams({ prefix, limit: '1000' });
    if (cursor) query.set('cursor', cursor);
    const data = await cfFetch(`/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/keys?${query}`);
    for (const key of data.result || []) {
      yield key;
    }
    cursor = data.result_info?.cursor || null;
  } while (cursor);
}

async function getKvJson(key) {
  const encoded = key.split('/').map(encodeURIComponent).join('/');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/storage/kv/namespaces/${KV_NAMESPACE_ID}/values/${encoded}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}` }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`KV get ${key} failed with ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function d1Rows(sql, params = []) {
  const data = await cfFetch(`/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
    method: 'POST',
    body: JSON.stringify({ sql, params })
  });
  const result = data.result?.[0];
  if (!result?.success) {
    throw new Error(`D1 query failed: ${JSON.stringify(data.errors || result || data)}`);
  }
  return result.results || [];
}

async function cfFetch(pathname, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(async () => ({ success: false, errors: [{ message: await response.text() }] }));
  if (!response.ok || data.success === false) {
    throw new Error(`${response.status} ${JSON.stringify(data.errors || data)}`);
  }
  return data;
}

function compareCount(label, expected, actual) {
  if (expected !== actual) {
    fail(`${label}: expected ${expected}, got ${actual}`);
  }
}

function compareValue(label, expected, actual) {
  const normalizedExpected = expected == null ? null : expected;
  const normalizedActual = actual == null ? null : actual;
  if (normalizedExpected !== normalizedActual) {
    fail(`${label}: expected ${JSON.stringify(normalizedExpected)}, got ${JSON.stringify(normalizedActual)}`);
  }
}

function compareJson(label, expected, actual) {
  const expectedText = stableJson(expected ?? null);
  const actualText = stableJson(actual ?? null);
  if (expectedText !== actualText) {
    fail(`${label}: JSON mismatch`);
  }
}

function fail(message) {
  failures.push(message);
}

function parseJson(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function stableJson(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortJson(value[key])]));
}

function normalizeHttpUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  return parsed.toString();
}

function normalizeTitle(title, fallback = 'Untitled') {
  const value = typeof title === 'string' ? title.trim() : '';
  if (value) return value.slice(0, 500);
  return String(fallback || 'Untitled').slice(0, 500);
}

function normalizeIso(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function sha256Json(value) {
  return sha256Bytes(Buffer.from(JSON.stringify(value)));
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}
