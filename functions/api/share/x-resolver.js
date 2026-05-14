const X_API_BASE = 'https://api.x.com/2';
const X_FETCH_TIMEOUT_MS = 12000;
const MAX_PARENT_POSTS = 12;
const MAX_SUBSEQUENT_POSTS = 18;
const USER_AGENT = 'jeffharr.is share resolver (+https://jeffharr.is/share)';

const TWEET_FIELDS = [
  'id',
  'text',
  'author_id',
  'created_at',
  'conversation_id',
  'in_reply_to_user_id',
  'referenced_tweets',
  'entities',
  'attachments',
  'note_tweet',
  'public_metrics',
  'possibly_sensitive'
].join(',');

const EXPANSIONS = [
  'author_id',
  'attachments.media_keys',
  'referenced_tweets.id',
  'referenced_tweets.id.author_id'
].join(',');

const USER_FIELDS = [
  'id',
  'name',
  'username',
  'profile_image_url',
  'verified',
  'verified_type'
].join(',');

const MEDIA_FIELDS = [
  'media_key',
  'type',
  'url',
  'preview_image_url',
  'width',
  'height',
  'alt_text',
  'duration_ms'
].join(',');

export function parseXStatusUrl(urlString) {
  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return null;
  }

  if (!isXHost(parsed.hostname)) return null;

  const path = parsed.pathname;
  const usernameMatch = path.match(/^\/([^/?#]+)\/status\/(\d+)/i);
  if (usernameMatch) {
    return {
      platform: 'x',
      username: usernameMatch[1],
      tweetId: usernameMatch[2]
    };
  }

  const webMatch = path.match(/^\/i\/web\/status\/(\d+)/i);
  if (webMatch) {
    return {
      platform: 'x',
      username: '',
      tweetId: webMatch[1]
    };
  }

  return null;
}

export function isXStatusUrl(urlString) {
  return Boolean(parseXStatusUrl(urlString)?.tweetId);
}

export async function resolveXShareUrl(inputUrl, classification, fetchImpl, env, ResolveError = Error) {
  const tweetId = classification?.tweetId || parseXStatusUrl(inputUrl)?.tweetId;
  if (!tweetId) {
    throw new ResolveError('X post URL not recognized', 400);
  }

  const bearerToken = getXBearerToken(env);
  if (!bearerToken) {
    throw new ResolveError('X API credentials are not configured', 503);
  }

  const context = createXContext();
  const warnings = [];
  const seed = await fetchTweetById(tweetId, bearerToken, fetchImpl, ResolveError, context);
  if (!seed) {
    throw new ResolveError('X post not found', 404);
  }

  const parentPosts = [];
  let parentId = getReplyParentId(seed);
  const seenParentIds = new Set([seed.id]);

  for (let depth = 0; parentId && depth < MAX_PARENT_POSTS; depth += 1) {
    if (seenParentIds.has(parentId)) break;
    seenParentIds.add(parentId);

    try {
      const parent = await fetchTweetById(parentId, bearerToken, fetchImpl, ResolveError, context);
      if (!parent) break;
      parentPosts.push(parent);
      parentId = getReplyParentId(parent);
    } catch {
      warnings.push('Some earlier posts in the reply chain could not be loaded.');
      break;
    }
  }

  const subsequentPosts = await fetchSubsequentAuthorPosts({
    seed,
    bearerToken,
    fetchImpl,
    ResolveError,
    context,
    includedIds: new Set([seed.id]),
    warnings
  });

  const orderedPosts = uniquePosts([
    ...parentPosts.reverse(),
    seed,
    ...subsequentPosts
  ]);
  const seedUser = context.usersById.get(seed.author_id) || {};
  const seedView = mapTweet(seed, context, tweetId);
  const canonicalUrl = seedView.url || canonicalXUrl(seedUser, seed);
  const title = buildXTitle(seedView);
  const description = buildXDescription(seedView);
  const imageUrl = firstMediaImage(seedView) || seedView.author.profileImageUrl || 'https://jeffharr.is/images/profile.jpg';

  return {
    type: 'x_post',
    sourceUrl: inputUrl,
    canonicalUrl,
    identityKey: `x_post:${seed.id}`,
    title,
    description,
    imageUrl,
    author: seedView.author.name || seedView.author.username || '',
    publisher: seedView.author.username ? `@${seedView.author.username}` : 'X',
    publishedAt: seed.created_at || '',
    platforms: {
      x: {
        label: 'Open on X',
        url: canonicalUrl,
        kind: 'website',
        confidence: 'exact'
      }
    },
    media: {},
    x: {
      tweetId: seed.id,
      conversationId: seed.conversation_id || seed.id,
      sharedTweetId: seed.id,
      author: seedView.author,
      posts: orderedPosts.map((post) => mapTweet(post, context, tweetId)),
      warnings
    },
    resolution: {
      confidence: 'high',
      sources: uniqueStrings([
        'x-api',
        parentPosts.length ? 'x-reply-chain' : '',
        subsequentPosts.length ? 'x-conversation-search' : ''
      ]),
      warnings
    }
  };
}

async function fetchSubsequentAuthorPosts({
  seed,
  bearerToken,
  fetchImpl,
  ResolveError,
  context,
  includedIds,
  warnings
}) {
  const seedUser = context.usersById.get(seed.author_id);
  const username = seedUser?.username;
  const conversationId = seed.conversation_id || seed.id;
  if (!username || !conversationId || !seed.created_at) return [];

  let candidates = [];
  try {
    candidates = await searchConversationByAuthor({
      conversationId,
      username,
      bearerToken,
      fetchImpl,
      ResolveError,
      context
    });
  } catch {
    warnings.push('Later posts from the same X thread could not be searched.');
    return [];
  }

  const seedTime = new Date(seed.created_at).valueOf();
  const chainIds = new Set(includedIds);
  const subsequent = [];

  for (const candidate of candidates.sort(compareTweetsChronologically)) {
    if (!candidate?.id || chainIds.has(candidate.id)) continue;
    if (candidate.author_id !== seed.author_id) continue;
    if ((candidate.conversation_id || candidate.id) !== conversationId) continue;

    const candidateTime = new Date(candidate.created_at || 0).valueOf();
    if (!Number.isFinite(candidateTime) || candidateTime <= seedTime) continue;

    const candidateParentId = getReplyParentId(candidate);
    if (!candidateParentId || !chainIds.has(candidateParentId)) continue;

    subsequent.push(candidate);
    chainIds.add(candidate.id);
    if (subsequent.length >= MAX_SUBSEQUENT_POSTS) break;
  }

  return subsequent;
}

async function fetchTweetById(tweetId, bearerToken, fetchImpl, ResolveError, context) {
  const url = createTweetLookupUrl([tweetId]);
  const payload = await fetchXJson(url, bearerToken, fetchImpl, ResolveError);
  absorbXPayload(context, payload);
  return context.tweetsById.get(String(tweetId)) || null;
}

async function searchConversationByAuthor({ conversationId, username, bearerToken, fetchImpl, ResolveError, context }) {
  const url = createRecentSearchUrl(conversationId, username);
  const payload = await fetchXJson(url, bearerToken, fetchImpl, ResolveError);
  absorbXPayload(context, payload);
  return Array.isArray(payload?.data) ? payload.data : [];
}

function createTweetLookupUrl(ids) {
  const url = new URL(`${X_API_BASE}/tweets`);
  url.searchParams.set('ids', ids.map(String).join(','));
  appendXFields(url);
  return url.href;
}

function createRecentSearchUrl(conversationId, username) {
  const url = new URL(`${X_API_BASE}/tweets/search/recent`);
  url.searchParams.set('query', `conversation_id:${conversationId} from:${username} -is:retweet`);
  url.searchParams.set('max_results', '100');
  url.searchParams.set('sort_order', 'recency');
  appendXFields(url);
  return url.href;
}

function appendXFields(url) {
  url.searchParams.set('tweet.fields', TWEET_FIELDS);
  url.searchParams.set('expansions', EXPANSIONS);
  url.searchParams.set('user.fields', USER_FIELDS);
  url.searchParams.set('media.fields', MEDIA_FIELDS);
}

async function fetchXJson(url, bearerToken, fetchImpl, ResolveError) {
  const response = await fetchWithTimeout(url, fetchImpl, {
    headers: {
      Authorization: `Bearer ${bearerToken}`,
      Accept: 'application/json'
    }
  });

  if (!response.ok) {
    throw new ResolveError(`X API request failed: ${response.status}`, response.status === 404 ? 404 : 502);
  }

  return response.json();
}

async function fetchWithTimeout(url, fetchImpl, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), X_FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function createXContext() {
  return {
    tweetsById: new Map(),
    usersById: new Map(),
    mediaByKey: new Map()
  };
}

function absorbXPayload(context, payload) {
  const tweets = [
    ...(Array.isArray(payload?.data) ? payload.data : payload?.data ? [payload.data] : []),
    ...(Array.isArray(payload?.includes?.tweets) ? payload.includes.tweets : [])
  ];

  for (const tweet of tweets) {
    if (tweet?.id) context.tweetsById.set(String(tweet.id), tweet);
  }
  for (const user of payload?.includes?.users || []) {
    if (user?.id) context.usersById.set(String(user.id), user);
  }
  for (const media of payload?.includes?.media || []) {
    if (media?.media_key) context.mediaByKey.set(String(media.media_key), media);
  }
}

function mapTweet(tweet, context, sharedTweetId, quoteDepth = 0) {
  const user = context.usersById.get(tweet.author_id) || {};
  const media = getTweetMedia(tweet, context.mediaByKey);
  const quotedId = getReferencedTweetId(tweet, 'quoted');
  const quotedTweet = quotedId ? context.tweetsById.get(quotedId) : null;

  return {
    id: String(tweet.id || ''),
    url: canonicalXUrl(user, tweet),
    text: getDisplayText(tweet),
    author: {
      id: String(user.id || tweet.author_id || ''),
      name: cleanText(user.name || ''),
      username: cleanText(user.username || ''),
      profileImageUrl: user.profile_image_url || '',
      verified: Boolean(user.verified),
      verifiedType: user.verified_type || ''
    },
    createdAt: tweet.created_at || '',
    conversationId: tweet.conversation_id || tweet.id || '',
    inReplyToTweetId: getReplyParentId(tweet),
    isShared: String(tweet.id || '') === String(sharedTweetId),
    metrics: {
      replies: Number(tweet.public_metrics?.reply_count || 0),
      reposts: Number(tweet.public_metrics?.retweet_count || 0),
      likes: Number(tweet.public_metrics?.like_count || 0),
      quotes: Number(tweet.public_metrics?.quote_count || 0)
    },
    media,
    quotedPost: quotedTweet && quoteDepth < 1 ? mapTweet(quotedTweet, context, sharedTweetId, quoteDepth + 1) : null
  };
}

function getDisplayText(tweet) {
  const entitySource = tweet.note_tweet?.entities || tweet.entities;
  const rawText = tweet.note_tweet?.text || tweet.text || '';
  const expanded = expandTcoUrls(rawText, entitySource);
  const withoutMediaLinks = removeMediaEntityUrls(expanded, entitySource);
  return cleanTweetText(withoutMediaLinks);
}

function expandTcoUrls(text, entities) {
  if (!text) return '';
  let output = String(text);
  for (const entry of entities?.urls || []) {
    const shortUrl = entry?.url;
    const expanded = entry?.unwound_url || entry?.expanded_url || '';
    if (!shortUrl || !expanded) continue;
    output = output.replaceAll(shortUrl, expanded);
  }
  return output;
}

function removeMediaEntityUrls(text, entities) {
  let output = String(text || '');
  for (const entry of entities?.urls || []) {
    const shortUrl = entry?.url || '';
    const expanded = entry?.expanded_url || '';
    const replacement = expanded || shortUrl;
    if (!replacement || !isMediaEntityUrl(replacement)) continue;
    output = output.replaceAll(replacement, '').replaceAll(shortUrl, '');
  }
  return output;
}

function isMediaEntityUrl(value) {
  try {
    const url = new URL(value);
    if (!isXHost(url.hostname)) return false;
    return /\/status\/\d+\/(?:photo|video)\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function getTweetMedia(tweet, mediaByKey) {
  const keys = Array.isArray(tweet.attachments?.media_keys) ? tweet.attachments.media_keys : [];
  return keys
    .map((key) => mediaByKey.get(String(key)))
    .filter(Boolean)
    .map((media) => ({
      key: media.media_key || '',
      type: media.type || '',
      url: media.url || media.preview_image_url || '',
      previewImageUrl: media.preview_image_url || media.url || '',
      width: media.width || null,
      height: media.height || null,
      altText: media.alt_text || '',
      durationMs: media.duration_ms || null
    }))
    .filter((media) => media.url || media.previewImageUrl);
}

function getReplyParentId(tweet) {
  return getReferencedTweetId(tweet, 'replied_to');
}

function getReferencedTweetId(tweet, type) {
  const match = (tweet?.referenced_tweets || []).find((reference) => reference?.type === type && reference.id);
  return match ? String(match.id) : '';
}

function compareTweetsChronologically(a, b) {
  const aTime = new Date(a?.created_at || 0).valueOf();
  const bTime = new Date(b?.created_at || 0).valueOf();
  return aTime - bTime;
}

function uniquePosts(posts) {
  const seen = new Set();
  const output = [];
  for (const post of posts) {
    if (!post?.id || seen.has(post.id)) continue;
    seen.add(post.id);
    output.push(post);
  }
  return output;
}

function canonicalXUrl(user, tweet) {
  const username = user?.username || 'i';
  const path = username === 'i' ? `/i/web/status/${tweet.id}` : `/${username}/status/${tweet.id}`;
  return `https://x.com${path}`;
}

function buildXTitle(seedView) {
  const author = seedView.author.name || (seedView.author.username ? `@${seedView.author.username}` : 'X');
  const lead = firstWords(seedView.text, 14);
  return lead ? `${author}: ${lead}` : `${author} on X`;
}

function buildXDescription(seedView) {
  const author = seedView.author.username ? `@${seedView.author.username}` : seedView.author.name || 'X';
  const lead = truncate(cleanText(seedView.text), 190);
  return lead ? `${author}: ${lead}` : `A shared post from ${author}.`;
}

function firstMediaImage(seedView) {
  return seedView.media.find((media) => media.url || media.previewImageUrl)?.url || '';
}

function getXBearerToken(env) {
  return env?.X_API_BEARER_TOKEN ||
    env?.TWITTER_API_BEARER_TOKEN ||
    env?.TWITTER_BEARER_TOKEN ||
    '';
}

function isXHost(hostname) {
  const normalized = String(hostname || '').toLowerCase().replace(/^www\./, '').replace(/^mobile\./, '');
  return normalized === 'x.com' ||
    normalized === 'twitter.com' ||
    normalized.endsWith('.x.com') ||
    normalized.endsWith('.twitter.com');
}

function cleanTweetText(value) {
  return String(value || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function firstWords(value, count) {
  const words = cleanText(value).split(' ').filter(Boolean);
  if (words.length <= count) return words.join(' ');
  return `${words.slice(0, count).join(' ')}...`;
}

function truncate(value, max) {
  const clean = cleanText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 3).trim()}...`;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}
