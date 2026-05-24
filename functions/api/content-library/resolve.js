import { resolveShareUrl } from '../share/podcast-resolver.js';
import { parsePoem, slugToTitle } from '../poems.js';
import {
  getAssetByRole,
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
import {
  dharmaTalkCanonicalKey,
  dharmaTalkMatchesId,
  dharmaTalkSourceId
} from '../dharma/ref.js';

const DHARMA_TALKS_CACHE = new Map();
const DHARMA_TALKS_CACHE_MS = 5 * 60 * 1000;

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

  if (payload?.ref?.kind === 'share_page') {
    return upsertSharePageRef({ db, ref: payload.ref, requestUrl: payload.requestUrl });
  }

  if (payload?.ref?.kind === 'poem') {
    return upsertPoemRef({ db, ref: payload.ref, env, requestUrl: payload.requestUrl });
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

async function resolveContentLookup({ db, payload, env }) {
  if (payload?.itemId) {
    const itemId = String(payload.itemId).trim();
    const existing = itemId ? await getItemById(db, itemId) : null;
    if (!existing) {
      return { itemId, canonicalKey: null, found: false };
    }
    return { itemId: existing.id, canonicalKey: existing.canonical_key, found: true };
  }

  if (payload?.ref?.kind === 'share_page') {
    const slug = normalizeSlug(payload.ref.slug || payload.ref.id);
    return {
      itemId: null,
      canonicalKey: slug ? sharePageCanonicalKey(slug) : null,
      found: Boolean(slug)
    };
  }

  if (payload?.ref?.kind === 'poem') {
    const slug = normalizeSlug(payload.ref.slug || payload.ref.id);
    return {
      itemId: null,
      canonicalKey: slug ? poemCanonicalKey(slug) : null,
      found: Boolean(slug)
    };
  }

  if (payload?.ref?.kind === 'dharma_talk') {
    const talk = await loadDharmaTalkFromRef({ ref: payload.ref, env });
    return {
      itemId: null,
      canonicalKey: talk ? dharmaTalkCanonicalKey(payload.ref.corpus, talk) : null,
      found: Boolean(talk)
    };
  }

  return { itemId: null, canonicalKey: null, found: false };
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
  const corpus = String(ref?.corpus || '').trim();
  const talk = await loadDharmaTalkFromRef({ ref, env });
  if (!talk) {
    const error = new Error('Dharma talk not found');
    error.status = 404;
    throw error;
  }

  return upsertDharmaTalk({ db, corpus, talk });
}

async function upsertSharePageRef({ db, ref, requestUrl }) {
  const slug = normalizeSlug(ref.slug || ref.id);
  if (!slug) {
    const error = new Error('Invalid share page reference');
    error.status = 400;
    throw error;
  }

  const share = await loadSharePageForFavorite(db, slug);
  if (!share) {
    const error = new Error('Share page not found');
    error.status = 404;
    throw error;
  }

  const now = getNowIso();
  const localUrl = absoluteUrl(`/share/${slug}`, requestUrl);
  let item = await upsertItem(db, {
    kind: 'share_page',
    canonicalKey: sharePageCanonicalKey(slug),
    canonicalUrl: localUrl,
    sourceUrl: localUrl,
    title: share.title || 'Shared item',
    summary: share.summary || '',
    creator: share.creator || '',
    publisher: share.publisher || 'jeffharr.is',
    publishedAt: share.created_at || null,
    extra: {
      shareSlug: slug,
      shareType: share.render_kind || share.item_kind || '',
      sourceItemId: share.source_item_id || '',
      sourceUrl: share.source_url || '',
      sourceCanonicalUrl: share.source_canonical_url || ''
    },
    resolvedAt: now
  });

  const imageUrl = normalizeHttpUrl(share.image_url);
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
      kind: 'share_page',
      canonicalKey: sharePageCanonicalKey(slug),
      canonicalUrl: localUrl,
      sourceUrl: localUrl,
      title: share.title || 'Shared item',
      summary: share.summary || '',
      creator: share.creator || '',
      publisher: share.publisher || 'jeffharr.is',
      publishedAt: share.created_at || null,
      thumbnailAssetId: asset.id,
      primaryAssetId: asset.id,
      extra: {
        shareSlug: slug,
        shareType: share.render_kind || share.item_kind || '',
        sourceItemId: share.source_item_id || '',
        sourceUrl: share.source_url || '',
        sourceCanonicalUrl: share.source_canonical_url || ''
      },
      resolvedAt: now
    });
  }

  await upsertItemSource(db, {
    itemId: item.id,
    sourceKind: 'share_page',
    sourceId: slug,
    sourceUrl: localUrl,
    source: share
  });

  return item;
}

async function upsertPoemRef({ db, ref, env, requestUrl }) {
  const slug = normalizeSlug(ref.slug || ref.id);
  if (!slug) {
    const error = new Error('Invalid poem reference');
    error.status = 400;
    throw error;
  }

  const poem = await loadPoem({ slug, env, requestUrl });
  if (!poem) {
    const error = new Error('Poem not found');
    error.status = 404;
    throw error;
  }

  const now = getNowIso();
  const poemUrl = absoluteUrl(`/poems/?poem=${encodeURIComponent(slug)}`, requestUrl);
  let item = await upsertItem(db, {
    kind: 'poem',
    canonicalKey: poemCanonicalKey(slug),
    canonicalUrl: poemUrl,
    sourceUrl: poemUrl,
    title: poem.title || slugToTitle(slug),
    summary: poem.excerpt || '',
    creator: poem.author || '',
    publisher: 'Jeff Harris Poems',
    extra: {
      slug,
      collection: poem.collection || ''
    },
    resolvedAt: now
  });

  const imageUrl = poem.imageUrl ? absoluteUrl(poem.imageUrl, requestUrl) : '';
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
      kind: 'poem',
      canonicalKey: poemCanonicalKey(slug),
      canonicalUrl: poemUrl,
      sourceUrl: poemUrl,
      title: poem.title || slugToTitle(slug),
      summary: poem.excerpt || '',
      creator: poem.author || '',
      publisher: 'Jeff Harris Poems',
      thumbnailAssetId: asset.id,
      primaryAssetId: asset.id,
      extra: {
        slug,
        collection: poem.collection || ''
      },
      resolvedAt: now
    });
  }

  await upsertItemSource(db, {
    itemId: item.id,
    sourceKind: 'poem',
    sourceId: slug,
    sourceUrl: poemUrl,
    storageKind: 'static_markdown',
    storageKey: `/poems/content/${slug}.md`,
    source: poem
  });

  return item;
}

async function upsertDharmaTalk({ db, corpus, talk }) {
  const source = talk.source || '';
  const sourceId = dharmaTalkSourceId(talk);
  const canonicalKey = dharmaTalkCanonicalKey(corpus, talk);
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
  const talks = await loadDharmaTalks({ corpus, env });
  if (!Array.isArray(talks)) return null;
  return talks.find((talk) => dharmaTalkMatchesId(talk, id)) || null;
}

async function loadDharmaTalks({ corpus, env }) {
  if (!env?.ASSETS?.fetch) return null;
  const cached = DHARMA_TALKS_CACHE.get(corpus);
  if (cached?.expiresAt > Date.now()) return cached.talks;

  const response = await env.ASSETS.fetch(new Request(`https://assets.local/dharma/${corpus}/talks.json`));
  if (!response.ok) return null;
  const talks = await response.json();
  DHARMA_TALKS_CACHE.set(corpus, {
    talks,
    expiresAt: Date.now() + DHARMA_TALKS_CACHE_MS
  });
  return talks;
}

async function loadDharmaTalkFromRef({ ref, env }) {
  const corpus = String(ref?.corpus || '').trim();
  const id = String(ref?.id || ref?.sourceId || ref?.slug || '').trim();
  if (!corpus || !id) return null;
  return loadDharmaTalk({ corpus, id, env });
}

async function loadSharePageForFavorite(db, slug) {
  const row = await db.prepare(
    `SELECT
      sd.item_id AS source_item_id,
      sd.share_slug,
      sd.render_kind,
      sd.created_at,
      i.kind AS item_kind,
      i.canonical_url AS source_canonical_url,
      i.source_url,
      i.title,
      i.summary,
      i.creator,
      i.publisher
     FROM share_details sd
     JOIN items i ON i.id = sd.item_id
     WHERE sd.share_slug = ?`
  ).bind(slug).first();
  if (!row) return null;

  const image = await getAssetByRole(db, row.source_item_id, 'thumbnail');
  return {
    ...row,
    image_url: image?.url || ''
  };
}

async function loadPoem({ slug, env }) {
  if (!env?.ASSETS?.fetch) return null;
  const manifestResponse = await env.ASSETS.fetch(new Request('https://assets.local/poems/manifest.json'));
  if (!manifestResponse.ok) return null;
  const manifest = await manifestResponse.json();
  const memorized = Array.isArray(manifest.memorized) ? manifest.memorized : [];
  const learning = Array.isArray(manifest.learning) ? manifest.learning : [];
  if (![...memorized, ...learning].includes(slug)) return null;

  const poemResponse = await env.ASSETS.fetch(new Request(`https://assets.local/poems/content/${slug}.md`));
  if (!poemResponse.ok) return null;
  const poem = parsePoem(await poemResponse.text());
  return {
    slug,
    title: poem.title || slugToTitle(slug),
    author: poem.author || 'Unknown',
    excerpt: poem.excerpt || '',
    imageUrl: manifest.images?.[slug] || '',
    collection: memorized.includes(slug) ? 'memorized' : 'learning'
  };
}

function sharePageCanonicalKey(slug) {
  return `share_page:${slug}`;
}

function poemCanonicalKey(slug) {
  return `poem:${slug}`;
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
  const path = safeUrlPath(url).toLowerCase();
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

function normalizeSlug(value) {
  const slug = String(value || '').trim();
  return /^[a-z0-9][a-z0-9:_-]*$/i.test(slug) ? slug : '';
}

function absoluteUrl(path, requestUrl) {
  try {
    return new URL(path, requestUrl || 'https://jeffharr.is/').href;
  } catch {
    return path || '';
  }
}

function safeUrlPath(url) {
  try {
    return new URL(url, 'https://jeffharr.is/').pathname;
  } catch {
    return '';
  }
}

export {
  dharmaTalkCanonicalKey,
  poemCanonicalKey,
  resolveContentInput,
  resolveContentLookup,
  sharePageCanonicalKey,
  upsertDharmaTalk,
  upsertShareResolvedItem
};
