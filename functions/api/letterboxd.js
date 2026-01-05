/**
 * Letterboxd API endpoint for Cloudflare Pages Functions
 * Parses public HTML pages to surface recently watched and watchlist films.
 */

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const MAX_ITEMS = 5;

export async function onRequest(context) {
  const rawUsername = (context.env?.LETTERBOXD_USERNAME || 'jeffharris').trim();
  const sanitizedUsername = rawUsername.replace(/[^\w-]/g, '') || 'jeffharris';

  const profileUrl = `https://letterboxd.com/${sanitizedUsername}/`;
  const recentFilmsUrl = `${profileUrl}films/by/date/`;
  const watchlistPageUrl = `${profileUrl}watchlist/`;

  const headers = { 'User-Agent': USER_AGENT };

  try {
    const [recentlyWatched, watchlist] = await Promise.all([
      fetchRecentlyWatched(recentFilmsUrl, headers),
      fetchWatchlist(watchlistPageUrl, headers)
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

async function fetchRecentlyWatched(url, headers) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Films page unavailable');
    const html = await response.text();
    return parseFilmsHtml(html, { includeRating: true });
  } catch (error) {
    console.error('Recently watched fetch failed:', error);
    return [];
  }
}

async function fetchWatchlist(url, headers) {
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error('Watchlist page unavailable');
    const html = await response.text();
    return parseFilmsHtml(html, { includeRating: false });
  } catch (error) {
    console.error('Watchlist fetch failed:', error);
    return [];
  }
}

function parseFilmsHtml(html, { includeRating = false } = {}) {
  const items = [];
  const seen = new Set();

  // Match the LazyPoster react components that contain film data
  // The HTML structure includes: data-item-name, data-item-slug, data-target-link, data-film-id, and poster path info
  const filmBlocks = html.split('data-component-class="LazyPoster"');

  for (let i = 1; i < filmBlocks.length && items.length < MAX_ITEMS; i++) {
    const block = filmBlocks[i];

    // Extract film data from attributes
    const nameMatch = block.match(/data-item-name="([^"]+)"/);
    const slugMatch = block.match(/data-item-slug="([^"]+)"/);
    const linkMatch = block.match(/data-target-link="([^"]+)"/);
    const filmIdMatch = block.match(/data-film-id="(\d+)"/);

    if (!nameMatch || !slugMatch) continue;

    const slug = slugMatch[1];
    if (seen.has(slug)) continue;
    seen.add(slug);

    const fullName = decodeHtmlEntities(nameMatch[1]);
    const link = linkMatch ? linkMatch[1] : `/film/${slug}/`;
    const filmId = filmIdMatch ? filmIdMatch[1] : null;

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

    // Extract cache busting key for poster URL
    let posterUrl = null;
    if (filmId) {
      const cacheKeyMatch = block.match(/cacheBustingKey":"([^"]+)"/);
      const cacheKey = cacheKeyMatch ? cacheKeyMatch[1] : null;
      posterUrl = buildPosterUrl(filmId, slug, cacheKey);
    }

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
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
