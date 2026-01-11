const DEFAULT_MIN_WORD_COUNT = 50;

function shouldCacheReader(reader, minWords = DEFAULT_MIN_WORD_COUNT) {
  if (!reader || !reader.contentHtml) return false;
  const wordCount = Number(reader.wordCount || 0);
  return Number.isFinite(wordCount) && wordCount >= minWords;
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
  shouldCacheReader,
  absolutizeUrl,
  absolutizeSrcset
};
