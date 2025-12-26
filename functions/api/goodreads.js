/**
 * Goodreads API endpoint for Cloudflare Pages Functions
 * Fetches currently reading from RSS feed
 *
 * Goodreads RSS feed URL format:
 * https://www.goodreads.com/review/list_rss/USER_ID?shelf=currently-reading
 */

export async function onRequest(context) {
  // Jeff's Goodreads user ID
  const userId = '2632308';
  const feedUrl = `https://www.goodreads.com/review/list_rss/${userId}?shelf=currently-reading`;

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'jeffharr.is'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Goodreads feed');
    }

    const xml = await response.text();

    // Parse the first book from the RSS feed
    const titleMatch = xml.match(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>/);
    const authorMatch = xml.match(/<item>[\s\S]*?<author_name>(.*?)<\/author_name>/);

    // Try alternative formats
    const titleAlt = xml.match(/<item>[\s\S]*?<title>(.*?)<\/title>/);

    const title = titleMatch?.[1] || titleAlt?.[1];
    const author = authorMatch?.[1];

    let currentlyReading;
    if (title) {
      currentlyReading = author ? `"${title}" by ${author}` : `"${title}"`;
    } else {
      currentlyReading = null;
    }

    const data = {
      currentlyReading,
      profileUrl: `https://www.goodreads.com/user/show/${userId}`
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error('Goodreads feed error:', error);

    return new Response(JSON.stringify({
      currentlyReading: 'Check out my reading list',
      profileUrl: 'https://www.goodreads.com/user/show/2632308'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }
}
