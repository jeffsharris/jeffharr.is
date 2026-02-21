import { countWords, deriveTitleFromUrl, normalizeTitleValue } from './reader-utils.js';
import { formatError } from '../lib/logger.js';

const X_API_ENDPOINT = 'https://api.x.com/2/tweets';
const X_FETCH_TIMEOUT_MS = 12000;
const X_SITE_NAME = 'X (formerly Twitter)';
const URL_PATTERN = /https?:\/\/[^\s<]+/g;

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/^mobile\./, '');
}

function isXHostname(hostname) {
  const normalized = normalizeHost(hostname);
  return normalized === 'x.com'
    || normalized === 'twitter.com'
    || normalized.endsWith('.x.com')
    || normalized.endsWith('.twitter.com');
}

function isXStatusUrl(url) {
  try {
    const parsed = new URL(url);
    return isXHostname(parsed.hostname) && /\/status\/\d+/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function parseTweetIdFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!isXHostname(parsed.hostname)) return null;
    const match = parsed.pathname.match(/\/status\/(\d+)/i);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function createXApiUrl(tweetId) {
  const url = new URL(X_API_ENDPOINT);
  url.searchParams.set('ids', tweetId);
  url.searchParams.set(
    'tweet.fields',
    'created_at,author_id,text,note_tweet,entities,attachments,article,public_metrics'
  );
  url.searchParams.set(
    'expansions',
    'author_id,attachments.media_keys,article.media_entities'
  );
  url.searchParams.set('user.fields', 'name,username,profile_image_url');
  url.searchParams.set('media.fields', 'type,url,preview_image_url,width,height,alt_text,duration_ms');
  return url.toString();
}

function mapByKey(items, key) {
  const map = new Map();
  if (!Array.isArray(items)) return map;
  items.forEach((item) => {
    const value = item?.[key];
    if (!value) return;
    map.set(value, item);
  });
  return map;
}

function pickMediaUrl(media) {
  if (!media || typeof media !== 'object') return null;
  return media.url || media.preview_image_url || null;
}

function expandTcoUrls(text, entities) {
  if (typeof text !== 'string' || !text) return '';
  const urls = Array.isArray(entities?.urls) ? entities.urls : [];
  if (!urls.length) return text;

  let output = text;
  urls.forEach((entry) => {
    const shortUrl = entry?.url;
    const expanded = entry?.unwound_url || entry?.expanded_url || null;
    if (!shortUrl || !expanded) return;
    output = output.replace(shortUrl, expanded);
  });
  return output;
}

function stripTextToExcerpt(text, maxWords = 36) {
  const normalized = normalizeTitleValue(text || '');
  if (!normalized) return '';
  const words = normalized.split(' ').filter(Boolean);
  if (words.length <= maxWords) return normalized;
  return `${words.slice(0, maxWords).join(' ')}...`;
}

function isUrlLikeTitle(title, url) {
  const current = normalizeTitleValue(title);
  if (!current) return true;
  const derived = normalizeTitleValue(deriveTitleFromUrl(url));
  if (current.toLowerCase() === derived.toLowerCase()) return true;
  if (/^https?:\/\//i.test(current)) return true;
  return false;
}

function deriveReaderTitle({ tweet, user, url, fallbackTitle, sourceText }) {
  const articleTitle = normalizeTitleValue(tweet?.article?.title || '');
  if (articleTitle) return articleTitle;

  if (!isUrlLikeTitle(fallbackTitle, url)) {
    return normalizeTitleValue(fallbackTitle);
  }

  const firstLine = normalizeTitleValue(String(sourceText || '').split('\n')[0] || '');
  if (firstLine) {
    const words = firstLine.split(' ').filter(Boolean);
    return words.length > 16 ? `${words.slice(0, 16).join(' ')}...` : firstLine;
  }

  const author = normalizeTitleValue(user?.name || user?.username || '');
  if (author) return `${author} on X`;

  return normalizeTitleValue(fallbackTitle) || deriveTitleFromUrl(url);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function linkifyText(text) {
  const input = String(text || '');
  if (!input) return '';

  let html = '';
  let cursor = 0;
  let match;

  while ((match = URL_PATTERN.exec(input)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    const rawUrl = match[0];
    html += escapeHtml(input.slice(cursor, start));
    html += `<a href="${escapeAttr(rawUrl)}" target="_blank" rel="noopener">${escapeHtml(rawUrl)}</a>`;
    cursor = end;
  }

  html += escapeHtml(input.slice(cursor));
  return html;
}

function textToParagraphs(text) {
  const sections = String(text || '')
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  if (!sections.length) return '';

  return sections.map((section) => {
    const lineHtml = section
      .split('\n')
      .map((line) => linkifyText(line.trim()))
      .filter(Boolean)
      .join('<br />');
    return lineHtml ? `<p>${lineHtml}</p>` : '';
  }).filter(Boolean).join('\n');
}

function dedupeStrings(values) {
  const seen = new Set();
  const output = [];
  values.forEach((value) => {
    const normalized = String(value || '').trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    output.push(normalized);
  });
  return output;
}

function buildXContentHtml(text, mediaUrls = []) {
  const body = textToParagraphs(text);
  const mediaHtml = mediaUrls.map((url) => (
    `<figure><img src="${escapeAttr(url)}" alt="" loading="lazy" decoding="async" /></figure>`
  )).join('\n');

  if (body && mediaHtml) {
    return `${body}\n${mediaHtml}`;
  }
  return body || mediaHtml || '';
}

function getSourceText(tweet) {
  const articleText = normalizeTitleValue(tweet?.article?.plain_text || '');
  if (articleText) return articleText;

  const noteText = normalizeTitleValue(expandTcoUrls(tweet?.note_tweet?.text || '', tweet?.note_tweet?.entities));
  if (noteText) return noteText;

  return normalizeTitleValue(expandTcoUrls(tweet?.text || '', tweet?.entities));
}

function getMediaUrls(tweet, mediaByKey) {
  const articleMediaKeys = Array.isArray(tweet?.article?.media_entities)
    ? tweet.article.media_entities
    : [];
  const articleMediaUrls = articleMediaKeys
    .map((key) => pickMediaUrl(mediaByKey.get(key)))
    .filter(Boolean);

  const attachmentKeys = Array.isArray(tweet?.attachments?.media_keys)
    ? tweet.attachments.media_keys
    : [];
  const attachmentUrls = attachmentKeys
    .map((key) => pickMediaUrl(mediaByKey.get(key)))
    .filter(Boolean);

  return dedupeStrings([...articleMediaUrls, ...attachmentUrls]);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = X_FETCH_TIMEOUT_MS, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function buildXReaderFromUrl(url, fallbackTitle, bearerToken, options = {}) {
  if (!isXStatusUrl(url)) return null;
  const log = options.log;
  const itemId = options.itemId || null;
  if (!bearerToken) {
    if (log) {
      log('warn', 'x_adapter_token_missing', {
        stage: 'x_adapter',
        itemId,
        url
      });
    }
    return null;
  }

  const tweetId = parseTweetIdFromUrl(url);
  if (!tweetId) return null;

  const fetchImpl = typeof options.fetchImpl === 'function' ? options.fetchImpl : fetch;

  let response;
  try {
    response = await fetchWithTimeout(
      createXApiUrl(tweetId),
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          Accept: 'application/json'
        }
      },
      X_FETCH_TIMEOUT_MS,
      fetchImpl
    );
  } catch (error) {
    if (log) {
      log('warn', 'x_adapter_request_failed', {
        stage: 'x_adapter',
        itemId,
        tweetId,
        url,
        ...formatError(error)
      });
    }
    return null;
  }

  if (!response.ok) {
    const body = await safeReadText(response);
    if (log) {
      log('warn', 'x_adapter_response_failed', {
        stage: 'x_adapter',
        itemId,
        tweetId,
        url,
        status: response.status,
        response: body.slice(0, 800)
      });
    }
    return null;
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const tweet = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!tweet || String(tweet.id || '') !== String(tweetId)) {
    return null;
  }

  const usersById = mapByKey(payload?.includes?.users, 'id');
  const mediaByKey = mapByKey(payload?.includes?.media, 'media_key');
  const user = usersById.get(tweet.author_id) || null;

  const sourceText = getSourceText(tweet);
  if (!sourceText) return null;

  const imageUrls = getMediaUrls(tweet, mediaByKey);
  const contentHtml = buildXContentHtml(sourceText, imageUrls);
  if (!contentHtml) return null;

  const byline = user?.name
    ? `${user.name}${user.username ? ` (@${user.username})` : ''}`
    : user?.username
      ? `@${user.username}`
      : '';

  return {
    title: deriveReaderTitle({ tweet, user, url, fallbackTitle, sourceText }),
    byline,
    excerpt: normalizeTitleValue(tweet?.article?.preview_text || '') || stripTextToExcerpt(sourceText),
    siteName: X_SITE_NAME,
    wordCount: countWords(sourceText),
    contentHtml,
    coverImageUrl: null,
    imageUrls,
    source: 'x-api',
    retrievedAt: new Date().toISOString()
  };
}

export {
  isXStatusUrl,
  parseTweetIdFromUrl,
  buildXReaderFromUrl
};
