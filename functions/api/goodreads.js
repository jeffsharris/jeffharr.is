/**
 * Goodreads API endpoint for Cloudflare Pages Functions
 * Fetches currently reading (3 books) and recently read (10 books)
 */

export async function onRequest(context) {
  const userId = '2632308';
  const FETCH_TIMEOUT_MS = 8000;

  const fetchShelf = async (shelfName) => {
    try {
      const feedUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=${shelfName}`;
      const response = await fetchWithTimeout(feedUrl, {
        headers: { 'User-Agent': 'jeffharr.is' }
      }, FETCH_TIMEOUT_MS);

      if (!response.ok) return [];

      const xml = await response.text();
      const books = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;

      while ((match = itemRegex.exec(xml)) !== null) {
        const itemXml = match[1];

        const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                          itemXml.match(/<title>(.*?)<\/title>/);
        const authorMatch = itemXml.match(/<author_name>(.*?)<\/author_name>/);
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);
        const ratingMatch = itemXml.match(/<user_rating>(\d+)<\/user_rating>/);

        if (titleMatch) {
          books.push({
            title: decodeXmlEntities(titleMatch[1].trim()),
            author: authorMatch ? decodeXmlEntities(authorMatch[1].trim()) : null,
            url: linkMatch ? linkMatch[1].trim() : null,
            rating: ratingMatch ? parseInt(ratingMatch[1]) : null
          });
        }
      }

      return books;
    } catch (error) {
      console.error(`Error fetching ${shelfName} shelf:`, error);
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

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
