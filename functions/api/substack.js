/**
 * Substack API endpoint for Cloudflare Pages Functions
 * Fetches latest posts from Waking Patiently RSS feed
 */

export async function onRequest(context) {
  const feedUrl = 'https://wakingpatiently.substack.com/feed';

  try {
    const response = await fetch(feedUrl, {
      headers: {
        'User-Agent': 'jeffharr.is'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Substack feed');
    }

    const xml = await response.text();

    // Simple XML parsing for RSS feed
    const titleMatch = xml.match(/<item>[\s\S]*?<title><!\[CDATA\[(.*?)\]\]><\/title>/);
    const descMatch = xml.match(/<item>[\s\S]*?<description><!\[CDATA\[(.*?)\]\]><\/description>/);
    const linkMatch = xml.match(/<item>[\s\S]*?<link>(.*?)<\/link>/);

    // Also try without CDATA wrapper
    const titleAlt = xml.match(/<item>[\s\S]*?<title>(.*?)<\/title>/);
    const descAlt = xml.match(/<item>[\s\S]*?<description>(.*?)<\/description>/);

    const title = titleMatch?.[1] || titleAlt?.[1] || 'Latest from Waking Patiently';

    // Clean up description - remove HTML tags and truncate
    let excerpt = descMatch?.[1] || descAlt?.[1] || '';
    excerpt = excerpt.replace(/<[^>]*>/g, '').trim();
    if (excerpt.length > 120) {
      excerpt = excerpt.substring(0, 120) + '...';
    }

    const data = {
      title,
      excerpt,
      link: linkMatch?.[1] || 'https://wakingpatiently.substack.com'
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
      }
    });

  } catch (error) {
    console.error('Substack feed error:', error);

    return new Response(JSON.stringify({
      title: 'Waking Patiently',
      excerpt: 'Thoughts on technology, consciousness, and the inner life.',
      link: 'https://wakingpatiently.substack.com'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }
}
