#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID || '';
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN || '';
const DATABASE_ID = process.env.CONTENT_DB_ID || 'efe5518b-5617-4ee8-992a-5c84f4cfe900';
const KV_NAMESPACE_ID = process.env.READ_LATER_NAMESPACE_ID || '1ab7a301e16e47f7a17651e89f7442b6';
const R2_BUCKET = process.env.CONTENT_ASSETS_BUCKET || 'jeffharr-is-content-assets';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_WRITE_MODE = process.env.R2_WRITE_MODE || 'wrangler';
const execFileAsync = promisify(execFile);

const READ_LATER_LIST_ID = 'lst_read_later';
const DEFAULT_CORPORA = ['brensilver', 'burbea', 'watts'];

const args = parseArgs(process.argv.slice(2));
const apply = args.has('apply');
const migrateAssets = args.has('assets');
const limit = numberArg(args.get('limit'), Infinity);
const only = new Set((args.get('only') || 'read-later,shares,dharma').split(',').map((value) => value.trim()).filter(Boolean));
const sqlOutputPath = args.get('sql-out') || '';
const sqlOutput = [];

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN.');
  process.exit(1);
}

if (migrateAssets && R2_WRITE_MODE === 's3' && (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY)) {
  console.error('Missing R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY for --assets.');
  process.exit(1);
}

const stats = {
  readLater: 0,
  share: 0,
  shareEvents: 0,
  dharma: 0,
  readerAssets: 0,
  coverAssets: 0,
  errors: 0
};

console.log(`[mode] ${apply ? 'apply' : 'dry-run'}${migrateAssets ? ' with assets' : ''}`);

if (only.has('read-later')) {
  await migrateReadLater();
}
if (only.has('shares')) {
  await migrateShares();
  await migrateShareEvents();
}
if (only.has('dharma')) {
  await migrateDharma();
}

if (sqlOutputPath) {
  await fs.writeFile(
    sqlOutputPath,
    `PRAGMA foreign_keys = ON;\n${sqlOutput.join('\n')}\n`,
    'utf8'
  );
  console.log(`[sql-out] wrote ${sqlOutput.length} statements to ${sqlOutputPath}`);
}

console.log(JSON.stringify(stats, null, 2));

async function migrateReadLater() {
  let processed = 0;
  for await (const key of listKvKeys('item:')) {
    if (processed >= limit) break;
    processed += 1;
    try {
      const item = await getKvJson(key.name);
      if (!item?.id || !item?.url) continue;
      await migrateReadLaterItem(item, key.name);
      stats.readLater += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(`[read-later] ${key.name}: ${error.message}`);
      await recordAudit({
        sourceKind: 'read_later_kv',
        sourceKey: key.name,
        targetKind: 'read_later',
        targetId: null,
        checksum: null,
        status: 'failed',
        error: error.message
      });
    }
  }
}

async function migrateReadLaterItem(item, sourceKey) {
  const now = new Date().toISOString();
  const normalizedUrl = normalizeHttpUrl(item.url);
  if (!normalizedUrl) throw new Error('Invalid URL');
  const kind = inferKindFromUrl(normalizedUrl);
  const canonicalKey = canonicalKeyForUrl(normalizedUrl, kind);
  const itemId = await stableId('itm', canonicalKey);
  const title = normalizeTitle(item.title, normalizedUrl);
  const savedAt = normalizeIso(item.savedAt) || now;
  const readAt = item.read ? (normalizeIso(item.readAt) || now) : null;
  const sourceJson = {
    originalId: item.id,
    url: item.url,
    migratedFrom: sourceKey
  };

  await d1Batch([
    upsertItemSql({
      id: itemId,
      kind,
      canonicalKey,
      canonicalUrl: normalizedUrl,
      sourceUrl: normalizedUrl,
      title,
      summary: item.description || null,
      creator: item.author || null,
      publisher: item.publisher || hostnameFromUrl(normalizedUrl),
      publishedAt: item.publishedAt || null,
      extra: {},
      createdAt: savedAt,
      updatedAt: now,
      resolvedAt: now
    }),
    upsertListEntrySql({
      id: item.id,
      listId: READ_LATER_LIST_ID,
      itemId,
      status: readAt ? 'done' : 'active',
      addedAt: savedAt,
      updatedAt: now
    }),
    upsertReadStateSql({
      entryId: item.id,
      readAt,
      progress: item.progress || null,
      kindle: item.kindle || null,
      coverSync: item.coverSync || null,
      pushChannels: item.pushChannels || null,
      updatedAt: now
    }),
    upsertItemSourceSql({
      id: await stableId('src', `${itemId}:read_later_kv:${sourceKey}`),
      itemId,
      sourceKind: 'read_later_kv',
      sourceId: item.id,
      sourceUrl: normalizedUrl,
      storageKind: 'kv_legacy',
      storageKey: sourceKey,
      source: sourceJson,
      createdAt: savedAt,
      updatedAt: now
    }),
    auditSql({
      id: await stableId('mig', `read_later_kv:${sourceKey}:list_entry`),
      sourceKind: 'read_later_kv',
      sourceKey,
      targetKind: 'list_entry',
      targetId: item.id,
      checksum: checksum(item),
      status: 'succeeded',
      error: null,
      migratedAt: now
    })
  ]);

  if (migrateAssets) {
    await migrateReaderAsset({ item, itemId });
    await migrateCoverAsset({ item, itemId });
  }
}

async function migrateReaderAsset({ item, itemId }) {
  const reader = await getKvJson(`reader:${item.id}`);
  if (!reader?.contentHtml) return;
  const now = new Date().toISOString();
  const key = `items/${itemId}/reader.json`;
  await putR2Object(key, Buffer.from(JSON.stringify(reader)), 'application/json; charset=utf-8');
  const assetId = await stableId('ast', `${itemId}:reader_html:${key}`);
  await d1Batch([
    upsertAssetSql({
      id: assetId,
      itemId,
      role: 'reader_html',
      kind: 'html',
      r2Key: key,
      mimeType: 'application/json; charset=utf-8',
      byteSize: Buffer.byteLength(JSON.stringify(reader)),
      contentSha256: checksum(reader),
      createdAt: now,
      updatedAt: now
    }),
    {
      sql: `INSERT INTO article_details (
        item_id, word_count, reading_time_minutes, reader_asset_id, site_name, byline, excerpt, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(item_id) DO UPDATE SET
        word_count = excluded.word_count,
        reading_time_minutes = excluded.reading_time_minutes,
        reader_asset_id = excluded.reader_asset_id,
        site_name = excluded.site_name,
        byline = excluded.byline,
        excerpt = excluded.excerpt,
        updated_at = excluded.updated_at`,
      params: [
        itemId,
        integerOrNull(reader.wordCount),
        reader.wordCount ? Math.max(1, Math.round(reader.wordCount / 230)) : null,
        assetId,
        reader.siteName || null,
        reader.byline || null,
        reader.excerpt || null,
        now
      ]
    }
  ]);
  stats.readerAssets += 1;
}

async function migrateCoverAsset({ item, itemId }) {
  const cover = await getKvJson(`cover:${item.id}`);
  if (!cover?.base64) return;
  const now = new Date().toISOString();
  const contentType = cover.contentType || 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : contentType.includes('webp') ? 'webp' : 'png';
  const key = `items/${itemId}/generated-cover.${ext}`;
  const bytes = Buffer.from(cover.base64, 'base64');
  await putR2Object(key, bytes, contentType);
  await d1Batch([
    upsertAssetSql({
      id: await stableId('ast', `${itemId}:generated_cover:${key}`),
      itemId,
      role: 'generated_cover',
      kind: 'image',
      r2Key: key,
      mimeType: contentType,
      byteSize: bytes.byteLength,
      contentSha256: sha256Hex(bytes),
      createdAt: cover.createdAt || now,
      updatedAt: cover.createdAt || now
    })
  ]);
  stats.coverAssets += 1;
}

async function migrateShares() {
  let processed = 0;
  for await (const key of listKvKeys('share:item:')) {
    if (processed >= limit) break;
    processed += 1;
    try {
      const share = await getKvJson(key.name);
      if (!share?.id) continue;
      await migrateShareItem(share, key.name);
      stats.share += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(`[share] ${key.name}: ${error.message}`);
    }
  }
}

async function migrateShareEvents() {
  let processed = 0;
  for await (const key of listKvKeys('share:history:')) {
    if (processed >= limit) break;
    processed += 1;
    try {
      const event = await getKvJson(key.name);
      if (!event?.id) continue;
      const itemId = apply ? await getShareItemIdBySlug(event.id) : `dry-run-item-for-${event.id}`;
      if (!itemId) continue;
      const sharedAt = normalizeIso(event.sharedAt) || new Date().toISOString();
      await d1Batch([{
        sql: `INSERT INTO share_events (
          id, share_slug, item_id, source_url, title, summary, image_url,
          creator, publisher, shared_at, extra_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source_url = excluded.source_url,
          title = excluded.title,
          summary = excluded.summary,
          image_url = excluded.image_url,
          creator = excluded.creator,
          publisher = excluded.publisher,
          shared_at = excluded.shared_at,
          extra_json = excluded.extra_json`,
        params: [
          await stableId('sev', key.name),
          event.id,
          itemId,
          event.sourceUrl || null,
          event.title || null,
          event.description || null,
          event.imageUrl || null,
          event.author || null,
          event.publisher || null,
          sharedAt,
          JSON.stringify({ type: event.type || null, migratedFrom: key.name })
        ]
      }]);
      stats.shareEvents += 1;
    } catch (error) {
      stats.errors += 1;
      console.error(`[share-history] ${key.name}: ${error.message}`);
    }
  }
}

async function getShareItemIdBySlug(shareSlug) {
  const data = await d1Query([{
    sql: 'SELECT item_id FROM share_details WHERE share_slug = ? LIMIT 1',
    params: [shareSlug]
  }]);
  return data?.[0]?.results?.[0]?.item_id || null;
}

async function migrateShareItem(share, sourceKey) {
  const now = new Date().toISOString();
  const kind = mapShareKind(share.type);
  const canonicalUrl = normalizeHttpUrl(share.canonicalUrl || share.sourceUrl) || '';
  const canonicalKey = share.identityKey || canonicalKeyForUrl(canonicalUrl, kind) || `${kind}:share:${share.id}`;
  const itemId = await stableId('itm', canonicalKey);
  const title = normalizeTitle(share.title, canonicalUrl || share.id);

  const statements = [
    upsertItemSql({
      id: itemId,
      kind,
      canonicalKey,
      canonicalUrl: canonicalUrl || null,
      sourceUrl: normalizeHttpUrl(share.sourceUrl) || canonicalUrl || null,
      title,
      summary: share.description || null,
      creator: share.author || null,
      publisher: share.publisher || hostnameFromUrl(canonicalUrl),
      publishedAt: share.publishedAt || null,
      extra: {
        shareType: share.type,
        media: share.media || {},
        podcast: share.podcast || null,
        platforms: share.platforms || {},
        x: share.x || null
      },
      createdAt: share.createdAt || now,
      updatedAt: share.updatedAt || now,
      resolvedAt: share.updatedAt || now
    }),
    {
      sql: `INSERT INTO share_details (
        item_id, share_slug, share_url, render_kind, share_count, visibility,
        extra_json, created_at, updated_at, rendered_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(share_slug) DO UPDATE SET
        item_id = excluded.item_id,
        render_kind = excluded.render_kind,
        share_count = excluded.share_count,
        extra_json = excluded.extra_json,
        updated_at = excluded.updated_at`,
      params: [
        itemId,
        share.id,
        `/share/${share.id}`,
        share.type || kind,
        integerOrNull(share.shareCount) || 0,
        'unlisted',
        JSON.stringify({ resolution: share.resolution || null }),
        share.createdAt || now,
        share.updatedAt || now,
        share.updatedAt || now
      ]
    },
    upsertItemSourceSql({
      id: await stableId('src', `${itemId}:share_kv:${sourceKey}`),
      itemId,
      sourceKind: 'share_kv',
      sourceId: share.id,
      sourceUrl: share.sourceUrl || share.canonicalUrl || null,
      storageKind: 'kv_legacy',
      storageKey: sourceKey,
      source: share,
      createdAt: share.createdAt || now,
      updatedAt: share.updatedAt || now
    }),
    auditSql({
      id: await stableId('mig', `share_kv:${sourceKey}:share_details`),
      sourceKind: 'share_kv',
      sourceKey,
      targetKind: 'share_details',
      targetId: share.id,
      checksum: checksum(share),
      status: 'succeeded',
      error: null,
      migratedAt: now
    })
  ];

  if (share.imageUrl) {
    statements.push(upsertAssetSql({
      id: await stableId('ast', `${itemId}:thumbnail:${share.imageUrl}`),
      itemId,
      role: 'thumbnail',
      kind: 'image',
      url: share.imageUrl,
      mimeType: inferImageMimeType(share.imageUrl),
      createdAt: share.createdAt || now,
      updatedAt: share.updatedAt || now
    }));
  }

  if (share.media?.audioUrl) {
    statements.push(upsertAssetSql({
      id: await stableId('ast', `${itemId}:audio:${share.media.audioUrl}`),
      itemId,
      role: 'audio',
      kind: 'audio',
      url: share.media.audioUrl,
      mimeType: share.media.audioType || 'audio/mpeg',
      durationSeconds: numberOrNull(share.media.durationSeconds),
      createdAt: share.createdAt || now,
      updatedAt: share.updatedAt || now
    }));
  }

  await d1Batch(statements);
}

async function migrateDharma() {
  const corpora = (args.get('corpus') || DEFAULT_CORPORA.join(',')).split(',').map((value) => value.trim()).filter(Boolean);
  for (const corpus of corpora) {
    const talksPath = path.join(process.cwd(), 'dharma', corpus, 'talks.json');
    const raw = await fs.readFile(talksPath, 'utf8').catch(() => null);
    if (!raw) continue;
    const talks = JSON.parse(raw);
    for (const talk of talks.slice(0, Number.isFinite(limit) ? limit : talks.length)) {
      await migrateDharmaTalk(corpus, talk);
      stats.dharma += 1;
    }
  }
}

async function migrateDharmaTalk(corpus, talk) {
  const now = new Date().toISOString();
  const source = talk.source || '';
  const sourceId = talk.source_id || String(talk.id || '').split(':').pop() || '';
  const canonicalKey = `dharma_talk:${corpus}:${source}:${sourceId}`;
  const itemId = await stableId('itm', canonicalKey);
  const imageUrl = normalizeHttpUrl(talk.episode_image_url || talk.image_url);
  const audioUrl = normalizeHttpUrl(talk.audio_url);
  const chaptersUrl = normalizeHttpUrl(talk.chapters_url);
  const imageAssetId = imageUrl ? await stableId('ast', `${itemId}:artwork:${imageUrl}`) : null;
  const audioAssetId = audioUrl ? await stableId('ast', `${itemId}:audio:${audioUrl}`) : null;
  const chaptersAssetId = chaptersUrl ? await stableId('ast', `${itemId}:chapters:${chaptersUrl}`) : null;

  const statements = [
    upsertItemSql({
      id: itemId,
      kind: 'dharma_talk',
      canonicalKey,
      canonicalUrl: talk.canonical_url || talk.link || null,
      sourceUrl: talk.link || talk.canonical_url || null,
      title: talk.title || 'Untitled Dharma talk',
      summary: talk.short_summary || talk.podcast_description || talk.description || null,
      creator: talk.speaker || null,
      publisher: source,
      publishedAt: talk.published_at || null,
      extra: { corpus, source, sourceId, tags: talk.tags || [] },
      createdAt: talk.published_at || now,
      updatedAt: now,
      resolvedAt: now
    }),
    upsertItemSourceSql({
      id: await stableId('src', `${itemId}:dharma_corpus:${corpus}:${talk.id}`),
      itemId,
      sourceKind: 'dharma_corpus',
      sourceId: `${corpus}:${talk.id}`,
      sourceUrl: talk.link || talk.canonical_url || null,
      storageKind: 'static_json',
      storageKey: `dharma/${corpus}/talks.json`,
      source: talk,
      createdAt: talk.published_at || now,
      updatedAt: now
    })
  ];

  if (imageUrl) {
    statements.push(upsertAssetSql({
      id: imageAssetId,
      itemId,
      role: 'artwork',
      kind: 'image',
      url: imageUrl,
      mimeType: inferImageMimeType(imageUrl),
      createdAt: now,
      updatedAt: now
    }));
  }
  if (audioUrl) {
    statements.push(upsertAssetSql({
      id: audioAssetId,
      itemId,
      role: 'audio',
      kind: 'audio',
      url: audioUrl,
      mimeType: talk.audio_type || 'audio/mpeg',
      durationSeconds: parseDurationSeconds(talk.duration),
      createdAt: now,
      updatedAt: now
    }));
  }
  if (chaptersUrl) {
    statements.push(upsertAssetSql({
      id: chaptersAssetId,
      itemId,
      role: 'chapters',
      kind: 'document',
      url: chaptersUrl,
      mimeType: 'application/json+chapters',
      createdAt: now,
      updatedAt: now
    }));
  }
  statements.push({
    sql: `INSERT INTO dharma_talk_details (
      item_id, corpus, source, source_id, speaker, duration_seconds,
      audio_asset_id, artwork_asset_id, chapters_asset_id, transcript_asset_id,
      venue, series, extra_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      speaker = excluded.speaker,
      duration_seconds = excluded.duration_seconds,
      audio_asset_id = excluded.audio_asset_id,
      artwork_asset_id = excluded.artwork_asset_id,
      chapters_asset_id = excluded.chapters_asset_id,
      venue = excluded.venue,
      series = excluded.series,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at`,
    params: [
      itemId,
      corpus,
      source,
      sourceId,
      talk.speaker || null,
      parseDurationSeconds(talk.duration),
      audioAssetId,
      imageAssetId,
      chaptersAssetId,
      null,
      talk.venue || null,
      talk.series || null,
      JSON.stringify({ rawId: talk.id, duration: talk.duration || null, tags: talk.tags || [] }),
      now
    ]
  });
  if (imageAssetId || audioAssetId) {
    statements.push(updateItemAssetRefsSql({
      itemId,
      thumbnailAssetId: imageAssetId,
      primaryAssetId: imageAssetId || audioAssetId
    }));
  }

  await d1Batch(statements);
}

async function d1Batch(statements) {
  if (sqlOutputPath) {
    for (const statement of statements.filter((candidate) => candidate?.sql)) {
      sqlOutput.push(renderSql(statement));
    }
    return;
  }

  if (!apply) {
    for (const statement of statements) {
      if (!statement?.sql) continue;
      console.log(`[dry-run:d1] ${statement.sql.split('\n')[0].slice(0, 96)} ${JSON.stringify(statement.params || []).slice(0, 180)}`);
    }
    return;
  }
  for (const statement of statements.filter((candidate) => candidate?.sql)) {
    const response = await cfFetch(`/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(statement)
    });
    if (!response.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(response.errors || response)}`);
    }
  }
}

function renderSql(statement) {
  let index = 0;
  const params = statement.params || [];
  const sql = statement.sql.replace(/\?/g, () => sqlLiteral(params[index++]));
  return `${sql};`;
}

function sqlLiteral(value) {
  if (value == null) return 'NULL';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL';
  if (typeof value === 'boolean') return value ? '1' : '0';
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function d1Query(statements) {
  const results = [];
  for (const statement of statements.filter((candidate) => candidate?.sql)) {
    const response = await cfFetch(`/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`, {
      method: 'POST',
      body: JSON.stringify(statement)
    });
    if (!response.success) {
      throw new Error(`D1 query failed: ${JSON.stringify(response.errors || response)}`);
    }
    results.push(...(response.result || []));
  }
  return results;
}

async function recordAudit(record) {
  await d1Batch([auditSql({
    id: await stableId('mig', `${record.sourceKind}:${record.sourceKey}:${record.targetKind}`),
    sourceKind: record.sourceKind,
    sourceKey: record.sourceKey,
    targetKind: record.targetKind,
    targetId: record.targetId,
    checksum: record.checksum,
    status: record.status,
    error: record.error,
    migratedAt: new Date().toISOString()
  })]);
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

async function putR2Object(key, body, contentType) {
  if (!apply) {
    console.log(`[dry-run:r2] put ${R2_BUCKET}/${key} bytes=${body.byteLength || body.length}`);
    return;
  }
  if (R2_WRITE_MODE !== 's3') {
    await putR2ObjectWithWrangler(key, body, contentType);
    return;
  }
  const host = `${ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const encodedKey = key.split('/').map(encodeURIComponent).join('/');
  const pathName = `/${R2_BUCKET}/${encodedKey}`;
  const url = `https://${host}${pathName}`;
  const date = new Date();
  const amzDate = toAmzDate(date);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`
  ].join('\n') + '\n';
  const canonicalRequest = [
    'PUT',
    pathName,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash
  ].join('\n');
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join('\n');
  const signingKey = getSignatureKey(R2_SECRET_ACCESS_KEY, dateStamp, 'auto', 's3');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${R2_ACCESS_KEY_ID}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate
    },
    body
  });
  if (!response.ok) {
    throw new Error(`R2 put failed ${response.status}: ${await response.text()}`);
  }
}

async function putR2ObjectWithWrangler(key, body) {
  const filename = path.join(os.tmpdir(), `content-library-${crypto.randomUUID()}`);
  await fs.writeFile(filename, body);
  try {
    await execFileAsync('wrangler', [
      'r2',
      'object',
      'put',
      `${R2_BUCKET}/${key}`,
      '--file',
      filename,
      '--remote'
    ], {
      maxBuffer: 1024 * 1024 * 4
    });
  } finally {
    await fs.unlink(filename).catch(() => {});
  }
}

function upsertItemSql(item) {
  return {
    sql: `INSERT INTO items (
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
      resolved_at = COALESCE(excluded.resolved_at, items.resolved_at)`,
    params: [
      item.id,
      item.kind,
      item.canonicalKey,
      item.canonicalUrl || null,
      item.sourceUrl || null,
      item.title,
      item.subtitle || null,
      item.summary || null,
      item.creator || null,
      item.publisher || null,
      item.publishedAt || null,
      item.language || null,
      item.thumbnailAssetId || null,
      item.primaryAssetId || null,
      JSON.stringify(item.extra || {}),
      item.createdAt,
      item.updatedAt,
      item.resolvedAt || null
    ]
  };
}

function updateItemAssetRefsSql({ itemId, thumbnailAssetId, primaryAssetId }) {
  return {
    sql: `UPDATE items
      SET thumbnail_asset_id = COALESCE(?, thumbnail_asset_id),
          primary_asset_id = COALESCE(?, primary_asset_id),
          updated_at = ?
      WHERE id = ?`,
    params: [
      thumbnailAssetId || null,
      primaryAssetId || null,
      new Date().toISOString(),
      itemId
    ]
  };
}

function upsertAssetSql(asset) {
  return {
    sql: `INSERT INTO assets (
      id, item_id, role, kind, url, r2_key, mime_type, width, height,
      duration_seconds, byte_size, alt_text, content_sha256, extra_json,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
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
      updated_at = excluded.updated_at`,
    params: [
      asset.id,
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
      JSON.stringify(asset.extra || {}),
      asset.createdAt,
      asset.updatedAt
    ]
  };
}

function upsertListEntrySql(entry) {
  return {
    sql: `INSERT INTO list_entries (
      id, list_id, item_id, status, position, note, added_at, updated_at, extra_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(list_id, item_id) DO UPDATE SET
      status = excluded.status,
      added_at = excluded.added_at,
      updated_at = excluded.updated_at,
      extra_json = excluded.extra_json`,
    params: [
      entry.id,
      entry.listId,
      entry.itemId,
      entry.status,
      numberOrNull(entry.position),
      entry.note || null,
      entry.addedAt,
      entry.updatedAt,
      JSON.stringify(entry.extra || {})
    ]
  };
}

function upsertReadStateSql(state) {
  const progressRatio = state.progress?.video?.ratio ?? state.progress?.scrollRatio ?? null;
  return {
    sql: `INSERT INTO read_state (
      entry_id, read_at, progress_ratio, progress_json, kindle_status, kindle_json,
      cover_sync_json, push_channels_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(entry_id) DO UPDATE SET
      read_at = excluded.read_at,
      progress_ratio = excluded.progress_ratio,
      progress_json = excluded.progress_json,
      kindle_status = excluded.kindle_status,
      kindle_json = excluded.kindle_json,
      cover_sync_json = excluded.cover_sync_json,
      push_channels_json = excluded.push_channels_json,
      updated_at = excluded.updated_at`,
    params: [
      state.entryId,
      state.readAt || null,
      Number.isFinite(progressRatio) ? progressRatio : null,
      JSON.stringify(state.progress || null),
      state.kindle?.status || null,
      JSON.stringify(state.kindle || null),
      JSON.stringify(state.coverSync || null),
      JSON.stringify(state.pushChannels || null),
      state.updatedAt
    ]
  };
}

function upsertItemSourceSql(source) {
  return {
    sql: `INSERT INTO item_sources (
      id, item_id, source_kind, source_id, source_url, storage_kind, storage_key,
      source_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_url = COALESCE(excluded.source_url, item_sources.source_url),
      storage_kind = COALESCE(excluded.storage_kind, item_sources.storage_kind),
      storage_key = COALESCE(excluded.storage_key, item_sources.storage_key),
      source_json = excluded.source_json,
      updated_at = excluded.updated_at`,
    params: [
      source.id,
      source.itemId,
      source.sourceKind,
      source.sourceId || null,
      source.sourceUrl || null,
      source.storageKind || null,
      source.storageKey || null,
      JSON.stringify(source.source || {}),
      source.createdAt,
      source.updatedAt
    ]
  };
}

function auditSql(record) {
  return {
    sql: `INSERT INTO migration_audit (
      id, source_kind, source_key, target_kind, target_id, checksum, status, error, migrated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(source_kind, source_key, target_kind) DO UPDATE SET
      target_id = excluded.target_id,
      checksum = excluded.checksum,
      status = excluded.status,
      error = excluded.error,
      migrated_at = excluded.migrated_at`,
    params: [
      record.id,
      record.sourceKind,
      record.sourceKey,
      record.targetKind,
      record.targetId,
      record.checksum,
      record.status,
      record.error,
      record.migratedAt
    ]
  };
}

function parseArgs(argv) {
  const result = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (key.includes('=')) {
      const [name, ...value] = key.split('=');
      result.set(name, value.join('='));
    } else if (argv[index + 1] && !argv[index + 1].startsWith('--')) {
      result.set(key, argv[index + 1]);
      index += 1;
    } else {
      result.set(key, true);
    }
  }
  return result;
}

function numberArg(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeHttpUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`);
    } catch {
      return null;
    }
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  return parsed.toString();
}

function canonicalKeyForUrl(url, kind = 'url') {
  const normalized = normalizeHttpUrl(url);
  return normalized ? `${kind}:url:${normalized}` : null;
}

function inferKindFromUrl(url) {
  const host = hostnameFromUrl(url);
  if (host === 'x.com' || host === 'twitter.com') return 'x_post';
  if (host === 'youtube.com' || host === 'youtu.be') return 'video';
  return 'article';
}

function mapShareKind(type) {
  if (type === 'x_post') return 'x_post';
  if (type === 'podcast_episode') return 'podcast_episode';
  if (type === 'podcast_show') return 'podcast_show';
  if (type === 'article') return 'article';
  return 'external_url';
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function normalizeTitle(input, fallbackUrl) {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (raw) return raw.slice(0, 500);
  return hostnameFromUrl(fallbackUrl) || String(fallbackUrl || 'Untitled').slice(0, 500);
}

function normalizeIso(value) {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferImageMimeType(url) {
  const pathName = String(url || '').toLowerCase();
  if (pathName.endsWith('.jpg') || pathName.endsWith('.jpeg')) return 'image/jpeg';
  if (pathName.endsWith('.webp')) return 'image/webp';
  if (pathName.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}

function parseDurationSeconds(value) {
  if (typeof value !== 'string') return null;
  const parts = value.split(':').map((part) => Number.parseFloat(part));
  if (parts.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || null;
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function stableId(prefix, value) {
  return `${prefix}_${sha256Hex(String(value)).slice(0, 16)}`;
}

function checksum(value) {
  return sha256Hex(JSON.stringify(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
}

function hmac(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function getSignatureKey(key, dateStamp, regionName, serviceName) {
  const kDate = hmac(`AWS4${key}`, dateStamp);
  const kRegion = hmac(kDate, regionName);
  const kService = hmac(kRegion, serviceName);
  return hmac(kService, 'aws4_request');
}
