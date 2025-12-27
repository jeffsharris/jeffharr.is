/**
 * Goodreads API endpoint for Cloudflare Pages Functions
 * Fetches currently reading and recently read books from RSS feed
 *
 * Goodreads RSS feed URL format:
 * https://www.goodreads.com/review/list_rss/USER_ID?shelf=SHELF_NAME
 */

export async function onRequest(context) {
  const userId = '2632308';

  // Try to fetch currently-reading first, then fall back to recent reads
  const shelves = [
    { name: 'currently-reading', label: 'Currently Reading' },
    { name: 'read', label: 'Recently Read' }
  ];

  for (const shelf of shelves) {
    try {
      const feedUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=${shelf.name}`;

      const response = await fetch(feedUrl, {
        headers: {
          'User-Agent': 'jeffharr.is'
        }
      });

      if (!response.ok) continue;

      const xml = await response.text();

      // Parse multiple books from the RSS feed
      const books = [];
      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      let count = 0;

      while ((match = itemRegex.exec(xml)) !== null && count < 10) {
        const itemXml = match[1];

        // Try to extract title (with or without CDATA)
        const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                          itemXml.match(/<title>(.*?)<\/title>/);

        // Try to extract author
        const authorMatch = itemXml.match(/<author_name>(.*?)<\/author_name>/);

        // Try to extract book link
        const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);

        // Try to extract rating (user's rating, if any)
        const ratingMatch = itemXml.match(/<user_rating>(\d+)<\/user_rating>/);

        // Try to extract book image
        const imageMatch = itemXml.match(/<book_medium_image_url>(.*?)<\/book_medium_image_url>/) ||
                          itemXml.match(/<book_small_image_url>(.*?)<\/book_small_image_url>/);

        if (titleMatch) {
          books.push({
            title: titleMatch[1].trim(),
            author: authorMatch ? authorMatch[1].trim() : null,
            url: linkMatch ? linkMatch[1].trim() : null,
            rating: ratingMatch ? parseInt(ratingMatch[1]) : null,
            imageUrl: imageMatch ? imageMatch[1].trim() : null
          });
          count++;
        }
      }

      if (books.length > 0) {
        return new Response(JSON.stringify({
          books,
          shelf: shelf.label,
          profileUrl: `https://www.goodreads.com/user/show/${userId}`
        }), {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
          }
        });
      }
    } catch (error) {
      console.error(`Error fetching ${shelf.name} shelf:`, error);
      continue;
    }
  }

  // Fallback if no books found
  return new Response(JSON.stringify({
    books: [],
    currentlyReading: 'Check out my reading list',
    profileUrl: `https://www.goodreads.com/user/show/${userId}`
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    }
  });
}
