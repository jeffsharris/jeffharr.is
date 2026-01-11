const DEFAULT_MIN_WORD_COUNT = 50;
const CLIENT_RENDER_MARKERS = [
  '/_next/static',
  '__NUXT__',
  'data-reactroot',
  'data-hydration',
  'window.__APOLLO_STATE__',
  'window.__INITIAL_STATE__'
];

function deriveTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url || 'Untitled';
  }
}

function shouldCacheReader(reader, minWords = DEFAULT_MIN_WORD_COUNT) {
  if (!reader || !reader.contentHtml) return false;
  const wordCount = Number(reader.wordCount || 0);
  return Number.isFinite(wordCount) && wordCount >= minWords;
}

function countWords(text) {
  if (typeof text !== 'string') return 0;
  const trimmed = text.replace(/\s+/g, ' ').trim();
  if (!trimmed) return 0;
  return trimmed.split(' ').length;
}

function looksClientRendered(html) {
  if (typeof html !== 'string' || !html) return false;
  const haystack = html.toLowerCase();
  return CLIENT_RENDER_MARKERS.some((marker) => haystack.includes(marker.toLowerCase()));
}

function absolutizeUrl(value, baseUrl) {
  if (!value) return null;

  try {
    const url = new URL(value, baseUrl);
    if (!['http:', 'https:'].includes(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function absolutizeSrcset(value, baseUrl) {
  if (!value) return null;

  const parts = value.split(',').map((candidate) => {
    const trimmed = candidate.trim();
    if (!trimmed) return null;

    const segments = trimmed.split(/\s+/);
    const url = absolutizeUrl(segments[0], baseUrl);
    if (!url) return null;
    return [url, ...segments.slice(1)].join(' ');
  }).filter(Boolean);

  return parts.length > 0 ? parts.join(', ') : null;
}

export {
  DEFAULT_MIN_WORD_COUNT,
  deriveTitleFromUrl,
  shouldCacheReader,
  countWords,
  looksClientRendered,
  absolutizeUrl,
  absolutizeSrcset
};
