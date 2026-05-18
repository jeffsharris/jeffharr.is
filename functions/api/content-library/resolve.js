import { resolveShareUrl } from '../share/podcast-resolver.js';
import {
  getItemById,
  upsertAsset,
  upsertItem,
  upsertItemSource
} from './db.js';
import {
  canonicalKeyForUrl,
  createStableId,
  getNowIso,
  normalizeHttpUrl
} from './ids.js';

async function resolveContentInput({ db, payload, env }) {
  if (payload?.itemId) {
    const existing = await getItemById(db, String(payload.itemId));
    if (!existing) {
      const error = new Error('Item not found');
      error.status = 404;
      throw error;
    }
    return existing;
  }

  if (payload?.ref?.kind === 'dharma_talk') {
    return upsertDharmaTalkRef({ db, ref: payload.ref, env });
  }

  const rawUrl = payload?.url || payload?.text || '';
  const normalizedUrl = normalizeHttpUrl(rawUrl);
  if (!normalizedUrl) {
    const error = new Error('Invalid URL');
    error.status = 400;
    throw error;
  }

  let resolved;
  try {
    resolved = await resolveShareUrl(normalizedUrl, { env });
  } catch {
    resolved = fallbackArticle(normalizedUrl, payload);
  }

  return upsertShareResolvedItem({ db, resolved, sourceUrl: normalizedUrl });
}

async function upsertShareResolvedItem({ db, resolved, sourceUrl }) {
  const now = getNowIso();
  const kind = mapShareKind(resolved?.type);
  const canonicalUrl = normalizeHttpUrl(resolved?.canonicalUrl) || normalizeHttpUrl(sourceUrl);
  const canonicalKey = resolved?.identityKey || canonicalKeyForUrl(canonicalUrl, kind);
  const title = resolved?.title || fallbackTitle(canonicalUrl);
  let item = await upsertItem(db, {
    kind,
    canonicalKey,
    canonicalUrl,
    sourceUrl: normalizeHttpUrl(resolved?.sourceUrl) || sourceUrl,
    title,
    summary: resolved?.description || '',
    creator: resolved?.author || '',
    publisher: resolved?.publisher || hostnameFromUrl(canonicalUrl),
    publishedAt: resolved?.publishedAt || null,
    extra: {
      shareType: resolved?.type || kind,
      media: resolved?.media || {},
      podcast: resolved?.podcast || null,
      platforms: resolved?.platforms || {},
      resolution: resolved?.resolution || null,
      x: resolved?.x || null
    },
    resolvedAt: now
  });

  const imageUrl = normalizeHttpUrl(resolved?.imageUrl);
  if (imageUrl) {
    const asset = await upsertAsset(db, {
      itemId: item.id,
      role: 'thumbnail',
      kind: 'image',
      url: imageUrl,
      mimeType: inferImageMimeType(imageUrl)
    });
    item = await upsertItem(db, {
      id: item.id,
      kind,
      canonicalKey,
      canonicalUrl,
      sourceUrl,
      title,
      summary: resolved?.description || '',
      creator: resolved?.author || '',
      publisher: resolved?.publisher || hostnameFromUrl(canonicalUrl),
      thumbnailAssetId: asset.id,
      primaryAssetId: asset.id,
      extra: {
        shareType: resolved?.type || kind,
        media: resolved?.media || {},
        podcast: resolved?.podcast || null,
        platforms: resolved?.platforms || {},
        resolution: resolved?.resolution || null,
        x: resolved?.x || null
      },
      resolvedAt: now
    });
  }

  const audioUrl = normalizeHttpUrl(resolved?.media?.audioUrl);
  if (audioUrl) {
    await upsertAsset(db, {
      itemId: item.id,
      role: 'audio',
      kind: 'audio',
      url: audioUrl,
      mimeType: resolved?.media?.audioType || 'audio/mpeg',
      durationSeconds: resolved?.media?.durationSeconds || null
    });
  }

  await upsertItemSource(db, {
    itemId: item.id,
    sourceKind: 'external_url',
    sourceId: sourceUrl,
    sourceUrl,
    source: resolved || {}
  });

  return item;
}

async function upsertDharmaTalkRef({ db, ref, env }) {
  const corpus = String(ref.corpus || '').trim();
  const id = String(ref.id || ref.sourceId || '').trim();
  if (!corpus || !id) {
    const error = new Error('Invalid Dharma talk reference');
    error.status = 400;
    throw error;
  }

  const talk = await loadDharmaTalk({ corpus, id, env });
  if (!talk) {
    const error = new Error('Dharma talk not found');
    error.status = 404;
    throw error;
  }

  return upsertDharmaTalk({ db, corpus, talk });
}

async function upsertDharmaTalk({ db, corpus, talk }) {
  const source = talk.source || '';
  const sourceId = talk.source_id || String(talk.id || '').split(':').at(-1) || '';
  const canonicalKey = `dharma_talk:${corpus}:${source}:${sourceId}`;
  let item = await upsertItem(db, {
    kind: 'dharma_talk',
    canonicalKey,
    canonicalUrl: talk.canonical_url || talk.link || null,
    sourceUrl: talk.link || talk.canonical_url || null,
    title: talk.title || 'Untitled Dharma talk',
    summary: talk.short_summary || talk.podcast_description || talk.description || '',
    creator: talk.speaker || '',
    publisher: source,
    publishedAt: talk.published_at || null,
    extra: {
      corpus,
      source,
      sourceId,
      duration: talk.duration || null,
      venue: talk.venue || null,
      series: talk.series || null,
      tags: talk.tags || []
    },
    resolvedAt: getNowIso()
  });

  const imageUrl = normalizeHttpUrl(talk.episode_image_url || talk.image_url);
  if (imageUrl) {
    const asset = await upsertAsset(db, {
      itemId: item.id,
      role: 'artwork',
      kind: 'image',
      url: imageUrl,
      mimeType: inferImageMimeType(imageUrl)
    });
    item = await upsertItem(db, {
      id: item.id,
      kind: 'dharma_talk',
      canonicalKey,
      canonicalUrl: talk.canonical_url || talk.link || null,
      sourceUrl: talk.link || talk.canonical_url || null,
      title: talk.title || 'Untitled Dharma talk',
      summary: talk.short_summary || talk.podcast_description || talk.description || '',
      creator: talk.speaker || '',
      publisher: source,
      publishedAt: talk.published_at || null,
      thumbnailAssetId: asset.id,
      primaryAssetId: asset.id,
      extra: {
        corpus,
        source,
        sourceId,
        duration: talk.duration || null,
        venue: talk.venue || null,
        series: talk.series || null,
        tags: talk.tags || []
      },
      resolvedAt: getNowIso()
    });
  }

  const audioUrl = normalizeHttpUrl(talk.audio_url);
  const audioAsset = audioUrl ? await upsertAsset(db, {
    itemId: item.id,
    role: 'audio',
    kind: 'audio',
    url: audioUrl,
    mimeType: talk.audio_type || 'audio/mpeg',
    durationSeconds: parseDurationSeconds(talk.duration)
  }) : null;

  const chaptersUrl = normalizeHttpUrl(talk.chapters_url);
  const chaptersAsset = chaptersUrl ? await upsertAsset(db, {
    itemId: item.id,
    role: 'chapters',
    kind: 'document',
    url: chaptersUrl,
    mimeType: 'application/json+chapters'
  }) : null;

  await db.prepare(
    `INSERT INTO dharma_talk_details (
      item_id, corpus, source, source_id, speaker, duration_seconds,
      audio_asset_id, artwork_asset_id, chapters_asset_id, transcript_asset_id,
      venue, series, extra_json, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(item_id) DO UPDATE SET
      corpus = excluded.corpus,
      source = excluded.source,
      source_id = excluded.source_id,
      speaker = excluded.speaker,
      duration_seconds = excluded.duration_seconds,
      audio_asset_id = COALESCE(excluded.audio_asset_id, dharma_talk_details.audio_asset_id),
      artwork_asset_id = COALESCE(excluded.artwork_asset_id, dharma_talk_details.artwork_asset_id),
      chapters_asset_id = COALESCE(excluded.chapters_asset_id, dharma_talk_details.chapters_asset_id),
      transcript_asset_id = COALESCE(excluded.transcript_asset_id, dharma_talk_details.transcript_asset_id),
      venue = excluded.venue,
      series = excluded.series,
      extra_json = excluded.extra_json,
      updated_at = excluded.updated_at`
  ).bind(
    item.id,
    corpus,
    source,
    sourceId,
    talk.speaker || null,
    parseDurationSeconds(talk.duration),
    audioAsset?.id || null,
    item.thumbnail_asset_id || null,
    chaptersAsset?.id || null,
    null,
    talk.venue || null,
    talk.series || null,
    JSON.stringify({ rawId: talk.id, tags: talk.tags || [] }),
    getNowIso()
  ).run();

  await upsertItemSource(db, {
    itemId: item.id,
    sourceKind: 'dharma_corpus',
    sourceId: `${corpus}:${talk.id || sourceId}`,
    sourceUrl: talk.link || talk.canonical_url || null,
    storageKind: 'static_json',
    storageKey: `/dharma/${corpus}/talks.json`,
    source: talk
  });

  return item;
}

async function loadDharmaTalk({ corpus, id, env }) {
  if (!env?.ASSETS?.fetch) return null;
  const response = await env.ASSETS.fetch(new Request(`https://assets.local/dharma/${corpus}/talks.json`));
  if (!response.ok) return null;
  const talks = await response.json();
  if (!Array.isArray(talks)) return null;
  return talks.find((talk) => {
    const safeId = String(talk.canonical_url || '').split('/talks/')[1]?.split('/')[0];
    return talk.id === id || talk.source_id === id || safeId === id;
  }) || null;
}

function fallbackArticle(url, payload = {}) {
  return {
    type: 'article',
    sourceUrl: url,
    canonicalUrl: url,
    identityKey: canonicalKeyForUrl(url, 'article'),
    title: payload?.title || fallbackTitle(url),
    description: payload?.description || '',
    publisher: hostnameFromUrl(url),
    platforms: {},
    media: {},
    resolution: {
      confidence: 'low',
      sources: ['fallback-url'],
      warnings: ['Stored without remote metadata resolution.']
    }
  };
}

function mapShareKind(type) {
  if (type === 'x_post') return 'x_post';
  if (type === 'podcast_episode') return 'podcast_episode';
  if (type === 'podcast_show') return 'podcast_show';
  if (type === 'article') return 'article';
  return 'external_url';
}

function fallbackTitle(url) {
  const host = hostnameFromUrl(url);
  return host || 'Untitled';
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function inferImageMimeType(url) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.gif')) return 'image/gif';
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

export {
  resolveContentInput,
  upsertDharmaTalk,
  upsertShareResolvedItem
};
