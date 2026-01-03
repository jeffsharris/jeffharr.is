/**
 * Letterboxd API endpoint for Cloudflare Pages Functions
 * Uses public RSS/HTML endpoints to surface recent diary activity and watchlist picks.
 */

const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';
const MAX_ITEMS = 6;

export async function onRequest(context) {
  const rawUsername = (context.env?.LETTERBOXD_USERNAME || 'jeffharris').trim();
  const sanitizedUsername = rawUsername.replace(/[^\w-]/g, '') || 'jeffharris';

  const profileUrl = `https://letterboxd.com/${sanitizedUsername}/`;
  const diaryFeedUrl = `${profileUrl}rss/`;
  const diaryByDateUrl = `${profileUrl}films/by/date/`;
  const watchlistFeedUrl = `${profileUrl}watchlist/rss/`;
  const watchlistPageUrl = `${profileUrl}watchlist/`;

  const headers = { 'User-Agent': USER_AGENT };

  try {
    const [diaryEntries, watchlist] = await Promise.all([
      fetchDiary(diaryFeedUrl, diaryByDateUrl, profileUrl, headers),
      fetchWatchlist(watchlistFeedUrl, watchlistPageUrl, headers)
    ]);

    const payload = {
      entries: diaryEntries,
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
    console.error('Letterboxd error:', error);
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

async function fetchDiary(feedUrl, diaryByDateUrl, profileUrl, headers) {
  try {
    const response = await fetch(feedUrl, { headers });
    if (!response.ok) throw new Error('RSS feed unavailable');
    const xml = await response.text();
    const parsed = parseRssItems(xml);
    if (parsed.length) return parsed.slice(0, MAX_ITEMS);
  } catch (error) {
    console.warn('Diary RSS failed, attempting HTML fallback:', error.message);
  }

  // Fallback: parse the films by date page (public)
  try {
    const response = await fetch(diaryByDateUrl, { headers });
    if (!response.ok) throw new Error('Diary by date page unavailable');
    const html = await response.text();
    const parsed = parseDiaryByDateHtml(html);
    if (parsed.length) return parsed.slice(0, MAX_ITEMS);
  } catch (error) {
    console.warn('Diary by date HTML fallback failed:', error.message);
  }

  // Fallback: parse the classic diary page
  try {
    const diaryUrl = `${profileUrl}films/diary/`;
    const response = await fetch(diaryUrl, { headers });
    if (!response.ok) throw new Error('Diary page unavailable');
    const html = await response.text();
    return parseDiaryHtml(html).slice(0, MAX_ITEMS);
  } catch (error) {
    console.error('Diary HTML fallback failed:', error);
    return [];
  }
}

async function fetchWatchlist(feedUrl, watchlistPageUrl, headers) {
  try {
    const response = await fetch(feedUrl, { headers });
    if (!response.ok) throw new Error('Watchlist feed unavailable');
    const xml = await response.text();
    const parsed = parseRssItems(xml, { includeReviews: false });
    if (parsed.length) return parsed.slice(0, MAX_ITEMS);
  } catch (error) {
    console.warn('Watchlist RSS failed, attempting HTML fallback:', error.message);
  }

  try {
    const response = await fetch(watchlistPageUrl, { headers });
    if (!response.ok) throw new Error('Watchlist page unavailable');
    const html = await response.text();
    return parseWatchlistHtml(html).slice(0, MAX_ITEMS);
  } catch (error) {
    console.error('Watchlist HTML fallback failed:', error);
    return [];
  }
}

function parseRssItems(xml, { includeReviews = true } = {}) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xml)) !== null && items.length < MAX_ITEMS) {
    const block = match[1];
    const title = extractTag(block, 'letterboxd:filmTitle') || extractTag(block, 'title');
    if (!title) continue;

    const ratingRaw = extractTag(block, 'letterboxd:memberRating') || extractTag(block, 'letterboxd:rating');
    const rating = ratingRaw ? parseFloat(ratingRaw) : null;
    const description = includeReviews ? cleanHtml(extractTag(block, 'description') || '') : '';
    const blurb = description ? truncate(description, 200) : null;

    items.push({
      title,
      year: extractTag(block, 'letterboxd:filmYear'),
      watchedDate: extractTag(block, 'letterboxd:watchedDate') || extractTag(block, 'pubDate'),
      rating: isNaN(rating) ? null : rating,
      link: extractTag(block, 'link'),
      poster: normalizePoster(extractPoster(block)),
      blurb
    });
  }

  return items;
}

function parseDiaryHtml(html) {
  const items = [];
  const entryRegex = /<li class="diary-entry-row[\s\S]*?<\/li>/gi;
  let match;

  while ((match = entryRegex.exec(html)) !== null && items.length < MAX_ITEMS) {
    const block = match[0];
    const title = getAttr(block, 'data-film-name') || getAttr(block, 'data-film-title');
    if (!title) continue;

    const ratingRaw = getAttr(block, 'data-rating') || getAttr(block, 'data-entry-rating');
    const rating = ratingRaw ? normalizeRating(ratingRaw) : null;
    const poster = normalizePoster(getAttr(block, 'data-poster-url') || getPosterFromImg(block));
    const link = getAttr(block, 'data-film-link') || getAttr(block, 'data-target-link') || extractHref(block);

    items.push({
      title,
      year: getAttr(block, 'data-film-release-year') || getAttr(block, 'data-film-year'),
      watchedDate: getAttr(block, 'data-viewing-date') || getTimeDate(block),
      rating,
      link: link ? `https://letterboxd.com${link}` : null,
      poster,
      blurb: null
    });
  }

  return items;
}

function parseDiaryByDateHtml(html) {
  const items = [];
  const entryRegex = /<li[^>]*data-film-slug="([^"]+)"[\s\S]*?<\/li>/gi;
  let match;

  while ((match = entryRegex.exec(html)) !== null && items.length < MAX_ITEMS) {
    const block = match[0];
    const slug = match[1];
    const title = getAttr(block, 'data-film-name') || getAttr(block, 'data-film-title');
    if (!title) continue;

    const poster = normalizePoster(getAttr(block, 'data-poster-url') || getPosterFromImg(block));

    items.push({
      title,
      year: getAttr(block, 'data-film-year') || getAttr(block, 'data-film-release-year'),
      watchedDate: getAttr(block, 'data-viewing-date') || getTimeDate(block),
      rating: normalizeRating(getAttr(block, 'data-rating') || getAttr(block, 'data-entry-rating')),
      link: slug ? `https://letterboxd.com${slug}` : null,
      poster,
      blurb: null
    });
  }

  return items;
}

function parseWatchlistHtml(html) {
  const items = [];
  const cardRegex = /data-film-slug="([^"]+)"[\s\S]*?data-film-title="([^"]+)"[\s\S]*?data-film-year="(\d{4})"[\s\S]*?data-poster-url="([^"]+)"/gi;
  let match;

  while ((match = cardRegex.exec(html)) !== null && items.length < MAX_ITEMS) {
    const [, slug, title, year, poster] = match;
    items.push({
      title,
      year,
      watchedDate: null,
      rating: null,
      link: `https://letterboxd.com${slug}`,
      poster: normalizePoster(poster),
      blurb: null
    });
  }

  return items;
}

function extractTag(xml, tag) {
  const cdata = new RegExp(`<${tag}><!\[CDATA\[([\s\S]*?)\]\]><\/${tag}>`, 'i').exec(xml);
  if (cdata) return cdata[1].trim();
  const text = new RegExp(`<${tag}>([\s\S]*?)<\/${tag}>`, 'i').exec(xml);
  if (text) return text[1].trim();
  return null;
}

function extractPoster(block) {
  const thumb = /<media:thumbnail[^>]*url="([^"]+)"/i.exec(block);
  if (thumb) return thumb[1];
  const enclosure = /<enclosure[^>]*url="([^"]+)"/i.exec(block);
  if (enclosure) return enclosure[1];
  return null;
}

function getAttr(block, attr) {
  const match = new RegExp(`${attr}="([^"]+)"`).exec(block);
  return match ? match[1] : null;
}

function getPosterFromImg(block) {
  const match = /<img[^>]*src="([^"]+)"/i.exec(block);
  return match ? match[1] : null;
}

function extractHref(block) {
  const match = /<a[^>]*href="([^"]+)"/i.exec(block);
  return match ? match[1] : null;
}

function getTimeDate(block) {
  const match = /<time[^>]*datetime="([^"]+)"/i.exec(block);
  return match ? match[1] : null;
}

function normalizePoster(url) {
  if (!url) return null;
  if (url.startsWith('//')) return `https:${url}`;
  return url;
}

function normalizeRating(raw) {
  // Some pages store ratings as 35 (for 3.5) or as "3.5"
  const numeric = parseFloat(raw);
  if (isNaN(numeric)) return null;
  return numeric > 10 ? numeric / 10 : numeric;
}

function cleanHtml(value) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, max) {
  if (!value || value.length <= max) return value;
  return `${value.slice(0, max - 1).trim()}…`;
}
