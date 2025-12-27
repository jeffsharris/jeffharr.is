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

    // Parse multiple posts from the RSS feed
    const posts = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    let count = 0;

    while ((match = itemRegex.exec(xml)) !== null && count < 10) {
      const itemXml = match[1];

      // Try to extract title (with or without CDATA)
      const titleMatch = itemXml.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                         itemXml.match(/<title>(.*?)<\/title>/);

      // Try to extract description
      const descMatch = itemXml.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                        itemXml.match(/<description>([\s\S]*?)<\/description>/);

      // Try to extract link
      const linkMatch = itemXml.match(/<link>(.*?)<\/link>/);

      // Try to extract pubDate
      const dateMatch = itemXml.match(/<pubDate>(.*?)<\/pubDate>/);

      if (titleMatch) {
        // Clean up description - remove HTML tags and truncate
        let excerpt = descMatch?.[1] || '';
        excerpt = excerpt.replace(/<[^>]*>/g, '').trim();
        if (excerpt.length > 200) {
          excerpt = excerpt.substring(0, 200) + '...';
        }

        posts.push({
          title: titleMatch[1].trim(),
          excerpt,
          url: linkMatch?.[1] || 'https://wakingpatiently.substack.com',
          date: dateMatch?.[1] || null
        });
        count++;
      }
    }

    const data = {
      posts,
      newsletterName: 'Waking Patiently',
      description: 'Thoughts on technology, consciousness, and the inner life.',
      profileUrl: 'https://wakingpatiently.substack.com'
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
      posts: [],
      newsletterName: 'Waking Patiently',
      description: 'Thoughts on technology, consciousness, and the inner life.',
      profileUrl: 'https://wakingpatiently.substack.com'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }
}
