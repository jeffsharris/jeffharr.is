/**
 * Goodreads API endpoint for Cloudflare Pages Functions
 * Fetches currently reading (3 books) and recently read (10 books)
 */

import { createLogger, formatError } from './lib/logger.js';

export async function onRequest(context) {
  const logger = createLogger({ request: context.request, source: 'goodreads' });
  const log = logger.log;
  const userId = '2632308';
  const FETCH_TIMEOUT_MS = 8000;

  const fetchShelf = async (shelfName) => {
    try {
      const feedUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=${shelfName}`;
      const response = await fetchWithTimeout(feedUrl, {
        headers: { 'User-Agent': 'jeffharr.is' }
      }, FETCH_TIMEOUT_MS);

      if (!response.ok) {
        log('error', 'goodreads_shelf_failed', {
          stage: 'shelf_fetch',
          shelf: shelfName,
          url: feedUrl,
          status: response.status
        });
        return [];
      }

      const xml = await response.text();
      const books = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];

        const title = extractTag(itemXml, 'title');
        const author = extractTag(itemXml, 'author_name');
        const url = extractTag(itemXml, 'link');
        const rating = extractTag(itemXml, 'user_rating');
        const image =
          extractTag(itemXml, 'book_large_image_url') ||
          extractTag(itemXml, 'book_medium_image_url') ||
          extractTag(itemXml, 'book_image_url') ||
          extractTag(itemXml, 'image_url');
        const publishedAt =
          extractTag(itemXml, 'user_read_at') ||
          extractTag(itemXml, 'pubDate');

        if (title) {
          books.push({
            title,
            author,
            url,
            rating: rating ? parseInt(rating, 10) : null,
            image,
            publishedAt
          });
        }
      }

      return books;
    } catch (error) {
      log('error', 'goodreads_shelf_error', {
        stage: 'shelf_fetch',
        shelf: shelfName,
        ...formatError(error)
      });
      return [];
    }
  };

  // Fetch both shelves in parallel
  const [currentlyReading, recentlyRead] = await Promise.all([
    fetchShelf('currently-reading'),
    fetchShelf('read')
  ]);

  const data = {
    currentlyReading: currentlyReading.slice(0, 3), // Max 3 currently reading
    recentlyRead: recentlyRead.slice(0, 15), // Max 15 recently read
    profileUrl: `https://www.goodreads.com/user/show/${userId}`
  };

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
    }
  });
}

function decodeXmlEntities(text = '') {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function extractTag(xml = '', tagName = '') {
  const escaped = tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const cdataMatch = xml.match(new RegExp(`<${escaped}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${escaped}>`));
  if (cdataMatch) return decodeXmlEntities(cdataMatch[1].trim());
  const match = xml.match(new RegExp(`<${escaped}>([\\s\\S]*?)<\\/${escaped}>`));
  if (!match) return null;
  const inner = match[1]
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '')
    .trim();
  return decodeXmlEntities(inner);
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

export { decodeXmlEntities, extractTag };
