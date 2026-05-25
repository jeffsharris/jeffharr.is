/**
 * Letterboxd API endpoint for Cloudflare Pages Functions
 * Parses public HTML pages to surface recently watched and watchlist films.
 */

import { createLogger, formatError } from './lib/logger.js';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const MAX_ITEMS = 5;
const FETCH_TIMEOUT_MS = 8000;

export async function onRequest(context) {
  const logger = createLogger({ request: context.request, source: 'letterboxd' });
  const log = logger.log;
  const rawUsername = (context.env?.LETTERBOXD_USERNAME || 'jeffharris').trim();
  const sanitizedUsername = rawUsername.replace(/[^\w-]/g, '') || 'jeffharris';

  const profileUrl = `https://letterboxd.com/${sanitizedUsername}/`;
  const recentFilmsUrl = `${profileUrl}films/by/date/`;
  const watchlistPageUrl = `${profileUrl}watchlist/`;

  const headers = { 'User-Agent': USER_AGENT };

  try {
    const [recentlyWatched, watchlist] = await Promise.all([
      fetchRecentlyWatched(recentFilmsUrl, headers, log),
      fetchWatchlist(watchlistPageUrl, headers, log)
    ]);

    const payload = {
      entries: recentlyWatched,
      watchlist,
      profileUrl,
      watchlistUrl: watchlistPageUrl
    };

    return new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=10800'
      }
    });
  } catch (error) {
    log('error', 'letterboxd_request_failed', {
      stage: 'request',
      profileUrl,
      ...formatError(error)
    });
    return new Response(JSON.stringify({
      entries: [],
      watchlist: [],
      profileUrl,
      watchlistUrl: watchlistPageUrl
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=900'
      },
      status: 200
    });
  }
}

async function fetchRecentlyWatched(url, headers, log) {
  try {
    const response = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      if (log) {
        log('error', 'letterboxd_recent_failed', {
          stage: 'recent_fetch',
          url,
          status: response.status
        });
      }
      throw new Error('Films page unavailable');
    }
    const html = await response.text();
    return parseFilmsHtml(html, { includeRating: true });
  } catch (error) {
    if (log) {
      log('error', 'letterboxd_recent_error', {
        stage: 'recent_fetch',
        url,
        ...formatError(error)
      });
    } else {
      console.error('Recently watched fetch failed:', error);
    }
    return [];
  }
}

async function fetchWatchlist(url, headers, log) {
  try {
    const response = await fetchWithTimeout(url, { headers }, FETCH_TIMEOUT_MS);
    if (!response.ok) {
      if (log) {
        log('error', 'letterboxd_watchlist_failed', {
          stage: 'watchlist_fetch',
          url,
          status: response.status
        });
      }
      throw new Error('Watchlist page unavailable');
    }
    const html = await response.text();
    return parseFilmsHtml(html, { includeRating: false });
  } catch (error) {
    if (log) {
      log('error', 'letterboxd_watchlist_error', {
        stage: 'watchlist_fetch',
        url,
        ...formatError(error)
      });
    } else {
      console.error('Watchlist fetch failed:', error);
    }
    return [];
  }
}

function parseFilmsHtml(html, { includeRating = false } = {}) {
  if (!html) return [];
  const items = [];
  const seen = new Set();

  const filmBlocks = html.split(/data-component-class=["']LazyPoster["']/);

  for (let i = 1; i < filmBlocks.length && items.length < MAX_ITEMS; i++) {
    const block = filmBlocks[i];

    const fullName = getAttribute(block, 'data-item-name') ||
      getAttribute(block, 'data-item-full-display-name');
    const targetLink = getAttribute(block, 'data-target-link');
    const itemLink = getAttribute(block, 'data-item-link');
    const linkCandidate = targetLink && targetLink !== '/'
      ? targetLink
      : itemLink && itemLink !== '/'
        ? itemLink
        : targetLink || itemLink;
    const slug = getAttribute(block, 'data-item-slug') || slugFromFilmLink(linkCandidate);

    if (!fullName || !slug) continue;

    const dedupeKey = linkCandidate || slug;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const link = linkCandidate || `/film/${slug}/`;

    // Parse year from name (e.g., "Bad Santa (2003)")
    const yearMatch = fullName.match(/\((\d{4})\)$/);
    const year = yearMatch ? yearMatch[1] : null;
    const title = yearMatch ? fullName.replace(/\s*\(\d{4}\)$/, '') : fullName;

    // Try to find rating if requested
    let rating = null;
    if (includeRating) {
      // Rating appears after the poster div in format: rated-N (where N is 1-10)
      const ratingMatch = block.match(/class="rating[^"]*rated-(\d+)"/);
      if (ratingMatch) {
        // Convert from 1-10 scale to 0.5-5 scale
        rating = parseInt(ratingMatch[1], 10) / 2;
      }
    }

    const posterData = extractPosterData(block);
    const posterUrl = posterData.posterUrl ||
      (posterData.filmId ? buildPosterUrl(posterData.filmId, slug, posterData.cacheKey) : null);

    items.push({
      title,
      year,
      rating,
      link: link.startsWith('http') ? link : `https://letterboxd.com${link}`,
      poster: posterUrl,
      blurb: null
    });
  }

  return items;
}

function extractPosterData(block) {
  const directFilmId = getAttribute(block, 'data-film-id');
  const posteredIdentifier = parseJsonAttribute(getAttribute(block, 'data-postered-identifier'));
  const resolvablePosterPath = parseJsonAttribute(getAttribute(block, 'data-resolvable-poster-path'));
  const filmId =
    directFilmId ||
    filmIdFromIdentifier(posteredIdentifier) ||
    filmIdFromIdentifier(resolvablePosterPath?.postered) ||
    filmIdFromText(block);
  const cacheKey = resolvablePosterPath?.cacheBustingKey || cacheKeyFromText(block);

  return {
    filmId,
    cacheKey,
    posterUrl: directPosterUrl(block)
  };
}

function filmIdFromIdentifier(identifier) {
  const uid = identifier?.uid;
  const match = typeof uid === 'string' ? uid.match(/^film:(\d+)$/) : null;
  return match ? match[1] : null;
}

function filmIdFromText(text) {
  const match = decodeHtmlEntities(text || '').match(/"uid"\s*:\s*"film:(\d+)"/);
  return match ? match[1] : null;
}

function cacheKeyFromText(text) {
  const match = decodeHtmlEntities(text || '').match(/"cacheBustingKey"\s*:\s*"([^"]+)"/);
  return match ? match[1] : null;
}

function directPosterUrl(block) {
  const candidates = [
    getAttribute(block, 'data-image-url'),
    getAttribute(block, 'data-src'),
    getAttribute(block, 'src')
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.startsWith('//') ? `https:${candidate}` : candidate;
    if (/^https?:\/\/.+\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(normalized) &&
        !normalized.includes('/empty-poster-')) {
      return normalized;
    }
  }

  return null;
}

function getAttribute(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = html.match(new RegExp(`${escaped}=(["'])([\\s\\S]*?)\\1`));
  return match ? decodeHtmlEntities(match[2].trim()) : null;
}

function parseJsonAttribute(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function slugFromFilmLink(link) {
  const match = String(link || '').match(/\/film\/([^/]+)\//);
  return match ? match[1] : null;
}

/**
 * Build the Letterboxd poster URL
 * Format: https://a.ltrbxd.com/resized/film-poster/{id_path}/{film_id}-{slug}-0-{w}-0-{h}-crop.jpg
 *
 * Letterboxd changed their poster URL scheme around film ID 1,000,000:
 * - Older films (ID < 1M): use slug WITHOUT year suffix (e.g., "carol" not "carol-2015")
 * - Newer films (ID >= 1M): use full slug WITH year suffix (e.g., "the-mastermind-2025")
 *
 * @param {string} filmId - The numeric film ID
 * @param {string} slug - The film slug (may include year suffix)
 * @param {string} cacheKey - The cache busting key (optional)
 * @returns {string} The poster URL
 */
function buildPosterUrl(filmId, slug, cacheKey) {
  // Split film ID into path segments (e.g., 182142 -> 1/8/2/1/4/2)
  const idPath = filmId.split('').join('/');

  // Use 125x187 size which is common for thumbnails
  const width = 125;
  const height = 187;

  // Determine which slug format to use based on film ID
  // Films with ID >= 1,000,000 use the full slug including year suffix
  // Older films use the slug with year suffix stripped
  const filmIdNum = parseInt(filmId, 10);
  const slugForUrl = filmIdNum >= 1000000 ? slug : slug.replace(/-\d{4}$/, '');

  let url = `https://a.ltrbxd.com/resized/film-poster/${idPath}/${filmId}-${slugForUrl}-0-${width}-0-${height}-crop.jpg`;
  if (cacheKey) {
    url += `?k=${cacheKey}`;
  }

  return url;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, value) => String.fromCharCode(parseInt(value, 10)))
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export { parseFilmsHtml, buildPosterUrl, decodeHtmlEntities };
