import { getContentDb } from '../content-library/db.js';
import {
  hasStarredRefs,
  loadStarredDharmaRefs,
  talkIsStarred
} from '../dharma/starred.js';
import { FAVORITE_TITLE_PREFIX } from '../dharma/feed-constants.js';

const MAX_FEED_ITEMS = 500;
const DEFAULT_LIMIT = 200;
const VALID_SCOPES = new Set(['all', 'dharma', 'guided']);
const SCOPE_FILES = {
  all: 'talks.json',
  dharma: 'dharma-talks.json',
  guided: 'guided-talks.json'
};
const SCOPE_LABELS = {
  all: 'recordings',
  dharma: 'Dharma talks',
  guided: 'guided meditations'
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!['GET', 'HEAD'].includes(request.method)) {
    return textResponse('Method not allowed', 405, 'text/plain; charset=utf-8');
  }

  const url = new URL(request.url);
  const query = parseFeedQuery(url);
  if (!query.corpora.length) {
    return textResponse('Missing corpus query parameter', 400, 'text/plain; charset=utf-8');
  }

  try {
    const result = await buildDharmaFeed({ env, requestUrl: request.url, query });
    return textResponse(request.method === 'HEAD' ? '' : result.xml, 200, 'application/rss+xml; charset=utf-8');
  } catch (error) {
    return textResponse(error?.message || 'Could not build feed', error?.status || 500, 'text/plain; charset=utf-8');
  }
}

async function buildDharmaFeed({ env, requestUrl, query }) {
  const db = getContentDb(env);
  const starredRefs = db ? await loadStarredDharmaRefs(db, query.corpora) : { byCorpus: new Map() };
  const talksByCorpus = await Promise.all(
    query.corpora.map(async (corpus) => ({
      corpus,
      talks: await loadScopedTalks({ env, corpus, scope: query.scope })
    }))
  );
  let talks = talksByCorpus.flatMap(({ corpus, talks }) => (
    talks.map((talk) => ({ ...talk, __corpus: corpus }))
  ));

  if (query.search) {
    talks = talks.filter((talk) => matchesSearch(talk, query.search));
  }
  if (query.starred) {
    talks = talks.filter((talk) => talkIsStarred(talk, talk.__corpus, starredRefs));
  }
  talks = talks
    .filter((talk) => talk?.audio_url)
    .sort((left, right) => String(right.published_at || '').localeCompare(String(left.published_at || '')))
    .slice(0, query.limit);

  return {
    xml: renderRss({
      requestUrl,
      query,
      talks,
      starredRefs,
      hasAnyStarred: hasStarredRefs(starredRefs, query.corpora)
    }),
    talks
  };
}

function parseFeedQuery(url) {
  const corpusParam = url.searchParams.get('corpus') || url.searchParams.get('teacher') || '';
  const corpora = corpusParam
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => /^[a-z0-9-]+$/.test(value));
  const rawScope = (url.searchParams.get('scope') || 'all').trim().toLowerCase();
  const scope = VALID_SCOPES.has(rawScope) ? rawScope : 'all';
  const limit = Math.min(
    MAX_FEED_ITEMS,
    Math.max(1, Number.parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );
  return {
    corpora: Array.from(new Set(corpora)),
    scope,
    search: String(url.searchParams.get('q') || '').trim(),
    starred: truthyParam(url.searchParams.get('starred')),
    limit
  };
}

function truthyParam(value) {
  return /^(1|true|yes|on)$/i.test(String(value || '').trim());
}

async function loadScopedTalks({ env, corpus, scope }) {
  const primary = await loadTalkJson(env, `/dharma/${corpus}/${SCOPE_FILES[scope]}`);
  if (Array.isArray(primary)) return primary;
  if (scope === 'guided') return [];
  return await loadTalkJson(env, `/dharma/${corpus}/talks.json`) || [];
}

async function loadTalkJson(env, path) {
  if (!env?.ASSETS?.fetch) return null;
  const response = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  return Array.isArray(body) ? body : null;
}

function matchesSearch(talk, search) {
  const terms = normalizeSearch(search).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeSearch([
    talk.title,
    talk.podcast_description,
    talk.short_summary,
    talk.description,
    talk.speaker,
    talk.source,
    talk.venue,
    talk.series,
    ...(Array.isArray(talk.tags) ? talk.tags : []),
    ...(Array.isArray(talk.chapters)
      ? talk.chapters.flatMap((chapter) => [chapter.title, chapter.description])
      : [])
  ].filter(Boolean).join(' '));
  return terms.every((term) => haystack.includes(term));
}

function normalizeSearch(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function renderRss({ requestUrl, query, talks, starredRefs, hasAnyStarred }) {
  const now = new Date();
  const lastBuild = latestTalkDate(talks) || now;
  const title = feedTitle(query, talks);
  const description = feedDescription(query, talks.length);
  const imageUrl = talks.find((talk) => talk.episode_image_url || talk.image_url)?.episode_image_url
    || talks.find((talk) => talk.image_url)?.image_url
    || '';
  const author = feedAuthor(talks);
  const baseUrl = feedBaseUrl(query);

  return `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:media="http://search.yahoo.com/mrss/" xmlns:podcast="https://podcastindex.org/namespace/1.0">
<channel>
<title>${escapeXml(title)}</title>
<link>${escapeXml(baseUrl)}</link>
<description>${escapeXml(description)}</description>
<language>en</language>
<lastBuildDate>${formatRssDate(lastBuild)}</lastBuildDate>
<atom:link href="${escapeXml(requestUrl)}" rel="self" type="application/rss+xml"/>
${imageUrl ? `<image><url>${escapeXml(imageUrl)}</url><title>${escapeXml(title)}</title><link>${escapeXml(baseUrl)}</link></image>` : ''}
<itunes:author>${escapeXml(author)}</itunes:author>
<itunes:summary>${escapeXml(description)}</itunes:summary>
<itunes:explicit>no</itunes:explicit>
${imageUrl ? `<itunes:image href="${escapeXml(imageUrl)}"/>` : ''}
<itunes:category text="Religion &amp; Spirituality"><itunes:category text="Buddhism"/></itunes:category>
${talks.map((talk) => renderItem(talk, starredRefs, hasAnyStarred)).join('\n')}
</channel>
</rss>`;
}

function renderItem(talk, starredRefs, hasAnyStarred) {
  const imageUrl = talk.episode_image_url || talk.image_url || '';
  const starred = hasAnyStarred && talkIsStarred(talk, talk.__corpus, starredRefs);
  const title = `${starred ? FAVORITE_TITLE_PREFIX : ''}${talk.title || 'Untitled talk'}`;
  return `<item>
<title>${escapeXml(title)}</title>
<link>${escapeXml(talk.canonical_url || talk.link || '')}</link>
<pubDate>${formatRssDate(parseDate(talk.published_at) || new Date())}</pubDate>
<guid isPermaLink="false">${escapeXml(talk.id || `${talk.__corpus}:${talk.source_id || title}`)}</guid>
<description>${escapeXml(talkDescription(talk))}</description>
<enclosure url="${escapeXml(talk.audio_url || '')}" length="${escapeXml(String(talk.audio_length || 0))}" type="${escapeXml(talk.audio_type || 'audio/mpeg')}"/>
<itunes:author>${escapeXml(talk.speaker || '')}</itunes:author>
<itunes:explicit>no</itunes:explicit>
${talk.duration ? `<itunes:duration>${escapeXml(talk.duration)}</itunes:duration>` : ''}
<itunes:summary>${escapeXml(talkSummary(talk))}</itunes:summary>
${imageUrl ? `<itunes:image href="${escapeXml(imageUrl)}"/><media:thumbnail url="${escapeXml(imageUrl)}" width="1024" height="1024"/>` : ''}
${talk.chapters_url ? `<podcast:chapters url="${escapeXml(talk.chapters_url)}" type="application/json+chapters"/>` : ''}
</item>`;
}

function feedTitle(query, talks) {
  const corpusTitle = query.corpora.length === 1
    ? corpusDisplayName(query.corpora[0], talks)
    : 'Dharma archive';
  const parts = [corpusTitle];
  if (query.starred) parts.push('starred');
  parts.push(SCOPE_LABELS[query.scope] || 'recordings');
  if (query.search) parts.push(`matching "${query.search}"`);
  return parts.join(' ');
}

function feedDescription(query, count) {
  const terms = [];
  if (query.corpora.length) terms.push(`corpus=${query.corpora.join(',')}`);
  if (query.scope !== 'all') terms.push(`scope=${query.scope}`);
  if (query.starred) terms.push('starred');
  if (query.search) terms.push(`search="${query.search}"`);
  const suffix = terms.length ? ` for ${terms.join(', ')}` : '';
  const noun = count === 1 ? 'recording' : 'recordings';
  return `${count} ${noun}${suffix}.`;
}

function corpusDisplayName(corpus, talks) {
  const speaker = talks.find((talk) => talk.speaker)?.speaker;
  if (speaker) return speaker;
  return String(corpus || 'Dharma')
    .split(/[-_]+/)
    .map((part) => part ? part[0].toUpperCase() + part.slice(1) : '')
    .join(' ');
}

function feedAuthor(talks) {
  const authors = Array.from(new Set(talks.map((talk) => talk.speaker).filter(Boolean)));
  return authors.length ? authors.slice(0, 4).join(', ') : 'Jeff Harris';
}

function feedBaseUrl(query) {
  if (query.corpora.length === 1) return `https://jeffharr.is/dharma/${query.corpora[0]}/`;
  return 'https://jeffharr.is/dharma/';
}

function latestTalkDate(talks) {
  return talks
    .map((talk) => parseDate(talk.published_at))
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime())[0] || null;
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function formatRssDate(date) {
  return date.toUTCString();
}

function talkDescription(talk) {
  const parts = [
    talk.podcast_description || talk.description || talk.short_summary || '',
    talk.source ? `Source: ${talk.source}` : '',
    talk.link ? `Original page: ${talk.link}` : ''
  ].filter(Boolean);
  return parts.join('\n\n');
}

function talkSummary(talk) {
  return talk.podcast_description || talk.short_summary || talk.description || `${talk.speaker || 'Dharma'} talk.`;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function textResponse(body, status, contentType) {
  return new Response(body, {
    status,
    headers: {
      'content-type': contentType,
      'cache-control': 'no-store'
    }
  });
}

export {
  buildDharmaFeed,
  matchesSearch,
  parseFeedQuery
};
