/**
 * Substack API endpoint for Cloudflare Pages Functions
 * Fetches latest posts from Waking Patiently RSS feed
 */

import { createLogger, formatError } from './lib/logger.js';

export async function onRequest(context) {
  const logger = createLogger({ request: context.request, source: 'substack' });
  const log = logger.log;
  const feedUrl = 'https://wakingpatiently.substack.com/feed';
  const FETCH_TIMEOUT_MS = 8000;

  try {
    const response = await fetchWithTimeout(feedUrl, {
      headers: {
        'User-Agent': 'jeffharr.is'
      }
    }, FETCH_TIMEOUT_MS);

    if (!response.ok) {
      log('error', 'substack_feed_failed', {
        stage: 'feed_fetch',
        url: feedUrl,
        status: response.status
      });
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
        excerpt = stripHtml(excerpt);
        excerpt = decodeXmlEntities(excerpt);
        if (excerpt.length > 200) {
          excerpt = excerpt.substring(0, 200) + '...';
        }

        posts.push({
          title: decodeXmlEntities(titleMatch[1].trim()),
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
    log('error', 'substack_request_failed', {
      stage: 'request',
      url: feedUrl,
      ...formatError(error)
    });

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

function stripHtml(input = '') {
  return input.replace(/<[^>]*>/g, '').trim();
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
