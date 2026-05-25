/**
 * X API endpoint for Cloudflare Pages Functions.
 * Returns recent posts when X API credentials are configured.
 */

import { createLogger, formatError } from './lib/logger.js';

const DEFAULT_USERNAME = 'jeffintime';
const DEFAULT_NAME = 'Jeff Harris';
const DEFAULT_PROFILE_IMAGE_URL = '/images/profile.jpg';
const FETCH_TIMEOUT_MS = 8000;

export async function onRequest(context) {
  const logger = createLogger({ request: context.request, source: 'x' });
  const log = logger.log;
  const username = sanitizeUsername(context.env?.X_USERNAME || context.env?.TWITTER_USERNAME || DEFAULT_USERNAME);
  const bearerToken = context.env?.X_BEARER_TOKEN || context.env?.TWITTER_BEARER_TOKEN || '';
  const configuredUserId = cleanString(context.env?.X_USER_ID || context.env?.TWITTER_USER_ID);
  const fallback = fallbackPayload(username);

  if (!bearerToken) {
    return jsonResponse(fallback, 3600);
  }

  try {
    const user = configuredUserId
      ? { id: configuredUserId, username, name: DEFAULT_NAME, profile_image_url: DEFAULT_PROFILE_IMAGE_URL }
      : await fetchUserByUsername(username, bearerToken);
    const tweets = await fetchUserTweets(user.id, bearerToken, user.username || username);

    return jsonResponse({
      handle: `@${user.username || username}`,
      username: user.username || username,
      name: user.name || DEFAULT_NAME,
      profileUrl: `https://x.com/${user.username || username}`,
      profileImageUrl: user.profile_image_url || DEFAULT_PROFILE_IMAGE_URL,
      tweets
    }, 900);
  } catch (error) {
    log('error', 'x_request_failed', {
      stage: 'request',
      username,
      ...formatError(error)
    });
    return jsonResponse(fallback, 300);
  }
}

async function fetchUserByUsername(username, bearerToken) {
  const url = new URL(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`);
  url.searchParams.set('user.fields', 'profile_image_url,name,username');

  const response = await fetchWithTimeout(url.toString(), {
    headers: xHeaders(bearerToken)
  }, FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`X user lookup failed with ${response.status}`);
  }

  const payload = await response.json();
  if (!payload?.data?.id) {
    throw new Error('X user lookup did not return a user id');
  }
  return payload.data;
}

async function fetchUserTweets(userId, bearerToken, username) {
  const url = new URL(`https://api.x.com/2/users/${encodeURIComponent(userId)}/tweets`);
  url.searchParams.set('max_results', '10');
  url.searchParams.set('exclude', 'retweets,replies');
  url.searchParams.set('tweet.fields', 'attachments,created_at,entities,public_metrics');
  url.searchParams.set('expansions', 'attachments.media_keys');
  url.searchParams.set('media.fields', 'alt_text,height,media_key,preview_image_url,type,url,width');

  const response = await fetchWithTimeout(url.toString(), {
    headers: xHeaders(bearerToken)
  }, FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`X timeline fetch failed with ${response.status}`);
  }

  return normalizeTweetsResponse(await response.json(), username);
}

function normalizeTweetsResponse(payload, username = DEFAULT_USERNAME) {
  const posts = Array.isArray(payload?.data) ? payload.data : [];
  const mediaByKey = new Map(
    (Array.isArray(payload?.includes?.media) ? payload.includes.media : [])
      .map(media => [media.media_key, media])
  );

  return posts
    .map(post => {
      const mediaKeys = Array.isArray(post?.attachments?.media_keys) ? post.attachments.media_keys : [];
      const media = mediaKeys
        .map(key => mediaByKey.get(key))
        .filter(Boolean)
        .map(mediaItem => ({
          type: mediaItem.type || '',
          url: mediaItem.url || '',
          preview_image_url: mediaItem.preview_image_url || '',
          alt_text: mediaItem.alt_text || '',
          width: mediaItem.width || null,
          height: mediaItem.height || null
        }));

      return {
        id: post.id || '',
        text: cleanTweetText(post.text || ''),
        publishedAt: post.created_at || '',
        created_at: post.created_at || '',
        url: post.id ? `https://x.com/${username}/status/${post.id}` : `https://x.com/${username}`,
        media,
        metrics: post.public_metrics || null
      };
    })
    .filter(post => post.id && (post.text || post.media.length));
}

function cleanTweetText(text) {
  return String(text || '').trim();
}

function fallbackPayload(username) {
  return {
    handle: `@${username}`,
    username,
    name: DEFAULT_NAME,
    profileUrl: `https://x.com/${username}`,
    profileImageUrl: DEFAULT_PROFILE_IMAGE_URL,
    tweets: []
  };
}

function xHeaders(bearerToken) {
  return {
    'Authorization': `Bearer ${bearerToken}`,
    'Accept': 'application/json',
    'User-Agent': 'jeffharr.is'
  };
}

function sanitizeUsername(value) {
  return cleanString(value).replace(/^@+/, '').replace(/[^\w]/g, '') || DEFAULT_USERNAME;
}

function cleanString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function jsonResponse(data, maxAgeSeconds) {
  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${maxAgeSeconds}`
    }
  });
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

export { normalizeTweetsResponse, sanitizeUsername };
