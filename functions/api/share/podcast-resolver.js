import { DOMParser, parseHTML } from 'linkedom';

const FETCH_TIMEOUT_MS = 12000;
const MAX_FEED_BYTES = 2_500_000;
const MAX_HTML_BYTES = 900_000;
const USER_AGENT = 'jeffharr.is share resolver (+https://jeffharr.is/share)';

export async function resolveShareUrl(rawInput, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const env = options.env || {};
  const sourceUrl = normalizeInputUrl(rawInput);

  if (!sourceUrl) {
    throw new ShareResolveError('No URL found', 400);
  }

  const inputUrl = normalizeHttpUrl(sourceUrl);
  if (!inputUrl) {
    throw new ShareResolveError('Invalid URL', 400);
  }

  const classification = classifyUrl(inputUrl);

  if (classification.platform === 'apple') {
    return resolveApple(inputUrl, classification, fetchImpl, env);
  }

  if (classification.platform === 'overcast' && classification.appleId) {
    return resolveApple(inputUrl, { platform: 'apple', appleId: classification.appleId }, fetchImpl, env);
  }

  if (classification.platform === 'overcast') {
    return resolveOvercast(inputUrl, classification, fetchImpl, env);
  }

  if (classification.platform === 'spotify') {
    return resolveSpotify(inputUrl, classification, fetchImpl, env);
  }

  if (classification.platform === 'youtube') {
    return resolveYouTube(inputUrl, classification, fetchImpl, env);
  }

  const fetched = await fetchText(inputUrl, fetchImpl, { maxBytes: MAX_FEED_BYTES });
  const contentType = fetched.contentType || '';

  if (looksLikePodcastFeed(inputUrl, contentType, fetched.text)) {
    const feed = parsePodcastFeed(fetched.text, inputUrl);
    const websiteLinks = feed.link ? await fetchWebsitePlatformLinks(feed.link, fetchImpl) : {};
    return buildPodcastItem({
      sourceUrl: inputUrl,
      sourcePlatform: 'rss',
      feed,
      platformLinks: normalizePlatformLinks({
        rss: platformLink('RSS Feed', inputUrl, 'rss', 'exact'),
        website: feed.link ? platformLink('Website', feed.link, 'website', 'verified') : null,
        ...websiteLinks
      }),
      resolutionSources: ['rss-feed', ...(Object.keys(websiteLinks).length ? ['website'] : [])]
    });
  }

  return resolveWebsite(inputUrl, fetched.text, fetchImpl, env);
}

export function normalizeInputUrl(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim().replace(
    /(https?:\/\/(?:www\.)?overcast\.fm\/)\s+([A-Za-z0-9_-]+)/i,
    '$1+$2'
  );
  const match = trimmed.match(/https?:\/\/[^\s<>"']+/i);
  return cleanupUrl(match ? match[0] : trimmed);
}

export function classifyUrl(urlString) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return { platform: 'unknown' };
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname;

  if (host === 'podcasts.apple.com' || (host === 'itunes.apple.com' && /\/podcast\//.test(path))) {
    const appleId = path.match(/\/id(\d+)/)?.[1] || url.searchParams.get('id');
    const episodeId = url.searchParams.get('i') || null;
    return { platform: 'apple', appleId, episodeId };
  }

  if (host === 'overcast.fm') {
    const appleId = path.match(/\/itunes(\d+)/)?.[1] || null;
    const overcastId = path.match(/^\/\+([^/?#]+)/)?.[1] || null;
    return { platform: 'overcast', appleId, overcastId };
  }

  if (host === 'open.spotify.com') {
    const [, spotifyType, spotifyId] = path.match(/^\/(show|episode)\/([^/?#]+)/) || [];
    return { platform: 'spotify', spotifyType, spotifyId };
  }

  if (host === 'youtube.com' || host === 'youtu.be' || host === 'm.youtube.com' || host === 'music.youtube.com') {
    const videoId = host === 'youtu.be' ? path.slice(1).split('/')[0] : url.searchParams.get('v');
    const playlistId = url.searchParams.get('list');
    const channelHandle = path.match(/^\/@([^/?#]+)/)?.[1] || null;
    return { platform: 'youtube', videoId, playlistId, channelHandle };
  }

  return { platform: 'unknown' };
}

export function parsePodcastFeed(xml, feedUrl) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const channel = doc.querySelector('channel') || doc.querySelector('feed');
  if (!channel) {
    throw new ShareResolveError('Podcast feed could not be parsed', 422);
  }

  const image =
    attr(channel, 'itunes\\:image', 'href') ||
    text(channel, ['image url', 'logo', 'icon']);
  const rawDescription = text(channel, ['itunes\\:summary', 'description', 'subtitle']);
  const description = cleanDescription(rawDescription);

  const feed = {
    url: feedUrl,
    title: cleanText(text(channel, ['title'])),
    description,
    imageUrl: image,
    author: cleanText(text(channel, ['itunes\\:author', 'author name', 'author'])),
    publisher: cleanText(text(channel, ['itunes\\:owner name', 'managingEditor'])),
    link: text(channel, ['link']),
    links: extractLinksFromHtml(rawDescription)
  };

  const itemNodes = [...channel.querySelectorAll('item')];
  feed.episodes = itemNodes.map((item) => {
    const descriptionHtml = text(item, ['content\\:encoded', 'itunes\\:summary', 'description']);
    const enclosure = item.querySelector('enclosure');
    const imageUrl =
      attr(item, 'itunes\\:image', 'href') ||
      attr(item, 'media\\:thumbnail', 'url') ||
      attr(item, 'media\\:content', 'url') ||
      feed.imageUrl;

    return {
      title: cleanText(text(item, ['title'])),
      description: cleanDescription(descriptionHtml),
      descriptionHtml,
      guid: cleanText(text(item, ['guid', 'id'])),
      link: cleanText(text(item, ['link'])),
      publishedAt: parseDate(text(item, ['pubDate', 'published', 'updated'])),
      duration: normalizeDuration(cleanText(text(item, ['itunes\\:duration']))),
      imageUrl,
      audioUrl: enclosure?.getAttribute('url') || '',
      audioType: enclosure?.getAttribute('type') || '',
      links: extractLinksFromHtml(descriptionHtml)
    };
  });

  return feed;
}

async function resolveApple(inputUrl, classification, fetchImpl, env) {
  const appleId = classification.appleId;
  const episodeId = classification.episodeId;
  if (!appleId) {
    return resolveWebsite(inputUrl, null, fetchImpl, env);
  }

  const showLookup = await fetchAppleLookup(appleId, fetchImpl);

  const show = showLookup?.results?.find((result) => result.collectionId || result.wrapperType === 'track') || null;
  const episodeResult = episodeId
    ? showLookup?.results?.find((result) => String(result.trackId) === String(episodeId) && (result.wrapperType === 'podcastEpisode' || result.kind === 'podcast-episode')) || null
    : null;
  const feedUrl = show?.feedUrl || episodeResult?.feedUrl || '';
  const feed = feedUrl ? await fetchPodcastFeed(feedUrl, fetchImpl) : null;
  const pcstLinks = appleId ? await fetchPcstLinks(appleId, fetchImpl) : {};
  const websiteLinks = feed?.link ? await fetchWebsitePlatformLinks(feed.link, fetchImpl) : {};
  const episode = episodeResult && feed
    ? matchEpisode(feed.episodes, {
        title: episodeResult.trackName || episodeResult.collectionName,
        publishedAt: episodeResult.releaseDate,
        durationMillis: episodeResult.trackTimeMillis
      })
    : null;

  const platformLinks = normalizePlatformLinks({
    ...pcstLinks,
    ...websiteLinks,
    apple: platformLink('Apple Podcasts', episodeId ? inputUrl : show?.collectionViewUrl || inputUrl, episodeId ? 'episode' : 'show', 'exact'),
    overcast: appleId ? platformLink('Overcast', `https://overcast.fm/itunes${appleId}`, 'show', 'verified') : null,
    rss: feedUrl ? platformLink('RSS Feed', feedUrl, 'rss', 'exact') : null,
    website: feed?.link ? platformLink('Website', feed.link, 'website', 'verified') : null,
    ...(episode ? extractEpisodePlatformLinks(episode) : {})
  });

  return buildPodcastItem({
    sourceUrl: inputUrl,
    sourcePlatform: 'apple',
    feed,
    episode,
    platformLinks,
    sourceMetadata: {
      title: episodeResult?.trackName || show?.collectionName,
      description: episodeResult?.description || show?.description,
      imageUrl: bestAppleImage(episodeResult) || bestAppleImage(show),
      author: show?.artistName,
      canonicalUrl: episodeResult?.trackViewUrl || show?.collectionViewUrl || inputUrl,
      publishedAt: episodeResult?.releaseDate
    },
    identityFallback: episodeId ? `podcast_episode:apple:${episodeId}` : `podcast_show:apple:${appleId}`,
    resolutionSources: ['apple-lookup', ...(feed ? ['rss-feed'] : []), ...(Object.keys(pcstLinks).length ? ['pc.st'] : [])]
  });
}

async function resolveSpotify(inputUrl, classification, fetchImpl, env) {
  const spotifyLink = platformLink('Spotify', inputUrl, classification.spotifyType === 'episode' ? 'episode' : 'show', 'exact');
  const oembed = await fetchOEmbed(`https://open.spotify.com/oembed?url=${encodeURIComponent(inputUrl)}`, fetchImpl);
  const spotifyApi = await fetchSpotifyApi(inputUrl, classification, fetchImpl, env);
  const title = spotifyApi?.name || cleanSpotifyTitle(oembed?.title || '');
  const imageUrl = spotifyApi?.images?.[0]?.url || oembed?.thumbnail_url || '';
  const searchTitle = classification.spotifyType === 'show'
    ? title
    : spotifyApi?.show?.name || cleanSpotifyShowTitle(oembed?.title || '');
  const appleCandidate = searchTitle ? await searchApplePodcast(searchTitle, fetchImpl) : null;

  if (appleCandidate?.collectionId && appleCandidate?.feedUrl) {
    const feed = await fetchPodcastFeed(appleCandidate.feedUrl, fetchImpl);
    const pcstLinks = await fetchPcstLinks(String(appleCandidate.collectionId), fetchImpl);
    const episode = classification.spotifyType === 'episode'
      ? matchEpisode(feed.episodes, {
          title,
          publishedAt: spotifyApi?.release_date,
          durationMillis: spotifyApi?.duration_ms
        })
      : null;
    const appleEpisodeUrl = episode
      ? await findAppleEpisodeUrl(String(appleCandidate.collectionId), episode, fetchImpl)
      : '';

    return buildPodcastItem({
      sourceUrl: inputUrl,
      sourcePlatform: 'spotify',
      feed,
      episode,
      platformLinks: normalizePlatformLinks({
        apple: appleEpisodeUrl
          ? platformLink('Apple Podcasts', appleEpisodeUrl, 'episode', 'verified')
          : platformLink('Apple Podcasts', appleCandidate.collectionViewUrl, 'show', 'verified'),
        overcast: platformLink('Overcast', `https://overcast.fm/itunes${appleCandidate.collectionId}`, 'show', 'verified'),
        spotify: spotifyLink,
        rss: platformLink('RSS Feed', appleCandidate.feedUrl, 'rss', 'exact'),
        website: feed.link ? platformLink('Website', feed.link, 'website', 'verified') : null,
        ...pcstLinks,
        ...(episode ? extractEpisodePlatformLinks(episode) : {})
      }),
      sourceMetadata: {
        title: classification.spotifyType === 'episode' ? title : appleCandidate.collectionName || feed.title || title,
        imageUrl,
        canonicalUrl: inputUrl,
        author: spotifyApi?.show?.publisher || spotifyApi?.publisher || appleCandidate.artistName
      },
      identityFallback: `podcast_${classification.spotifyType || 'show'}:spotify:${classification.spotifyId || inputUrl}`,
      resolutionSources: ['spotify', 'apple-search', 'rss-feed', ...(Object.keys(pcstLinks).length ? ['pc.st'] : [])]
    });
  }

  return buildPodcastItem({
    sourceUrl: inputUrl,
    sourcePlatform: 'spotify',
    feed: null,
    episode: classification.spotifyType === 'episode' ? {
      title,
      description: spotifyApi?.description || '',
      imageUrl,
      publishedAt: spotifyApi?.release_date || '',
      duration: formatDurationMillis(spotifyApi?.duration_ms),
      audioUrl: '',
      links: []
    } : null,
    platformLinks: normalizePlatformLinks({ spotify: spotifyLink }),
    sourceMetadata: {
      title,
      description: spotifyApi?.description || '',
      imageUrl,
      author: spotifyApi?.publisher || spotifyApi?.show?.publisher || '',
      canonicalUrl: inputUrl
    },
    identityFallback: `podcast_${classification.spotifyType || 'show'}:spotify:${classification.spotifyId || inputUrl}`,
    resolutionSources: ['spotify-oembed'],
    warnings: ['Spotify did not expose a reliable RSS feed for this URL.']
  });
}

async function resolveOvercast(inputUrl, classification, fetchImpl, env) {
  const response = await fetchText(inputUrl, fetchImpl, { maxBytes: MAX_HTML_BYTES });
  const { document } = parseHTML(response.text);
  const canonicalUrl = resolveUrl(
    decodeEntities(document.querySelector('link[rel="canonical"]')?.getAttribute('href') || ''),
    inputUrl
  );
  const canonical = canonicalUrl ? new URL(canonicalUrl) : null;
  const pageLinks = extractPlatformLinksFromDocument(document, inputUrl);
  const pageFeedUrl = findRssUrl(document, inputUrl);
  const feedUrl = canonical?.searchParams.get('uf') || pageFeedUrl || '';
  const episodeGuid = canonical?.searchParams.get('ge') || '';
  const overcastLink = platformLink('Overcast', inputUrl, classification.overcastId ? 'episode' : 'show', 'exact');
  const pageTitle = cleanOvercastTitle(meta(document, 'og:title') || document.querySelector('title')?.textContent || '');
  const pageDescription = meta(document, 'og:description') || meta(document, 'description') || '';
  const pageImageUrl = resolveUrl(meta(document, 'og:image'), inputUrl);

  if (feedUrl) {
    const feed = await fetchPodcastFeed(feedUrl, fetchImpl);
    const episode = episodeGuid
      ? feed.episodes.find((candidate) => candidate.guid === episodeGuid) || null
      : matchEpisode(feed.episodes, { title: pageTitle });
    let appleCandidate = null;
    try {
      appleCandidate = feed.title ? await findApplePodcastByFeed(feed.title, feed.url, fetchImpl) : null;
    } catch {}
    const appleId = appleCandidate?.collectionId || classifyUrl(pageLinks.apple?.url || '').appleId || null;
    let pcstLinks = {};
    try {
      pcstLinks = appleId ? await fetchPcstLinks(String(appleId), fetchImpl) : {};
    } catch {}
    const websiteLinks = feed.link ? await fetchWebsitePlatformLinks(feed.link, fetchImpl) : {};
    const episodeLinks = episode ? extractEpisodePlatformLinks(episode) : {};
    const appleEpisodeUrl = episode && appleId ? await findAppleEpisodeUrl(String(appleId), episode, fetchImpl) : '';
    const spotifyEpisodeLink = episode
      ? await findSpotifyEpisodeLink(
          episodeLinks.spotify?.url || pcstLinks.spotify?.url || pageLinks.spotify?.url || '',
          episode,
          fetchImpl,
          env
        )
      : null;

    return buildPodcastItem({
      sourceUrl: inputUrl,
      sourcePlatform: 'overcast',
      feed,
      episode,
      platformLinks: normalizePlatformLinks({
        ...pcstLinks,
        ...websiteLinks,
        ...pageLinks,
        ...episodeLinks,
        apple: appleEpisodeUrl
          ? platformLink('Apple Podcasts', appleEpisodeUrl, 'episode', 'verified')
          : pageLinks.apple || (appleCandidate?.collectionViewUrl
          ? platformLink('Apple Podcasts', appleCandidate.collectionViewUrl, 'show', 'verified')
          : null),
        spotify: spotifyEpisodeLink || episodeLinks.spotify || pcstLinks.spotify || pageLinks.spotify,
        overcast: overcastLink,
        rss: platformLink('RSS Feed', feedUrl, 'rss', 'exact'),
        website: feed.link ? platformLink('Website', feed.link, 'website', 'verified') : null,
      }),
      sourceMetadata: {
        title: pageTitle,
        description: pageDescription,
        imageUrl: pageImageUrl,
        canonicalUrl: canonicalUrl || inputUrl
      },
      identityFallback: classification.overcastId
        ? `podcast_episode:overcast:${classification.overcastId}`
        : `podcast_show:overcast:${inputUrl}`,
      resolutionSources: [
        'overcast',
        'rss-feed',
        ...(appleCandidate ? ['apple-search'] : []),
        ...(Object.keys(pcstLinks).length ? ['pc.st'] : []),
        ...(Object.keys(websiteLinks).length ? ['website'] : [])
      ]
    });
  }

  return buildPodcastItem({
    sourceUrl: inputUrl,
    sourcePlatform: 'overcast',
    feed: null,
    episode: classification.overcastId ? {
      title: pageTitle,
      description: pageDescription,
      imageUrl: pageImageUrl,
      publishedAt: '',
      duration: '',
      audioUrl: '',
      links: [inputUrl]
    } : null,
    platformLinks: normalizePlatformLinks({ ...pageLinks, overcast: overcastLink }),
    sourceMetadata: {
      title: pageTitle,
      description: pageDescription,
      imageUrl: pageImageUrl,
      canonicalUrl: canonicalUrl || inputUrl
    },
    identityFallback: classification.overcastId
      ? `podcast_episode:overcast:${classification.overcastId}`
      : `podcast_show:overcast:${inputUrl}`,
    resolutionSources: ['overcast'],
    warnings: ['Overcast did not expose a reliable RSS feed for this URL.']
  });
}

async function resolveYouTube(inputUrl, classification, fetchImpl, env) {
  const oembed = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(inputUrl)}&format=json`, fetchImpl);
  const isEpisode = Boolean(classification.videoId);
  const link = platformLink('YouTube', inputUrl, isEpisode ? 'episode' : 'show', 'exact');
  const pageMetadata = oembed?.title ? {} : await fetchYouTubePageMetadata(inputUrl, fetchImpl);
  const title = cleanYouTubeTitle(oembed?.title || pageMetadata.title || (isEpisode ? 'YouTube episode' : 'YouTube podcast'));
  const imageUrl = oembed?.thumbnail_url || pageMetadata.imageUrl || '';
  const author = cleanText(oembed?.author_name || pageMetadata.author || '');

  if (isEpisode && author) {
    try {
      const appleCandidate = await searchApplePodcast(author, fetchImpl);
      if (appleCandidate?.feedUrl) {
        const feed = await fetchPodcastFeed(appleCandidate.feedUrl, fetchImpl);
        const episode = matchEpisodeByLink(feed.episodes, inputUrl) ||
          matchEpisode(feed.episodes, { title, alternateTitles: youtubeTitleCandidates(title) });
        if (episode) {
          const pcstLinks = appleCandidate.collectionId ? await fetchPcstLinks(String(appleCandidate.collectionId), fetchImpl) : {};
          const websiteLinks = feed.link ? await fetchWebsitePlatformLinks(feed.link, fetchImpl) : {};
          const episodeLinks = extractEpisodePlatformLinks(episode);
          const appleEpisodeUrl = appleCandidate.collectionId
            ? await findAppleEpisodeUrl(String(appleCandidate.collectionId), episode, fetchImpl)
            : '';
          const spotifyEpisodeLink = await findSpotifyEpisodeLink(
            episodeLinks.spotify?.url || pcstLinks.spotify?.url || '',
            episode,
            fetchImpl,
            env
          );
          return buildPodcastItem({
            sourceUrl: inputUrl,
            sourcePlatform: 'youtube',
            feed,
            episode,
            platformLinks: normalizePlatformLinks({
              ...pcstLinks,
              ...websiteLinks,
              ...episodeLinks,
              apple: appleEpisodeUrl
                ? platformLink('Apple Podcasts', appleEpisodeUrl, 'episode', 'verified')
                : appleCandidate.collectionViewUrl ? platformLink('Apple Podcasts', appleCandidate.collectionViewUrl, 'show', 'verified') : null,
              spotify: spotifyEpisodeLink || episodeLinks.spotify || pcstLinks.spotify,
              overcast: appleCandidate.collectionId ? platformLink('Overcast', `https://overcast.fm/itunes${appleCandidate.collectionId}`, 'show', 'verified') : null,
              rss: platformLink('RSS Feed', appleCandidate.feedUrl, 'rss', 'exact'),
              website: feed.link ? platformLink('Website', feed.link, 'website', 'verified') : null,
              youtube: link
            }),
            sourceMetadata: {
              title,
              description: pageMetadata.description || '',
              imageUrl,
              author,
              publisher: author,
              canonicalUrl: inputUrl
            },
            identityFallback: `podcast_episode:youtube:${classification.videoId}`,
            resolutionSources: ['youtube-oembed', 'apple-search', 'rss-feed', ...(Object.keys(pcstLinks).length ? ['pc.st'] : [])]
          });
        }
      }
    } catch {}
  }

  return buildPodcastItem({
    sourceUrl: inputUrl,
    sourcePlatform: 'youtube',
    feed: null,
    episode: isEpisode ? {
      title,
      description: pageMetadata.description || '',
      imageUrl,
      publishedAt: '',
      duration: '',
      audioUrl: '',
      links: [inputUrl]
    } : null,
    platformLinks: normalizePlatformLinks({ youtube: link }),
    sourceMetadata: {
      title,
      description: pageMetadata.description || '',
      imageUrl,
      author,
      publisher: author,
      canonicalUrl: inputUrl
    },
    identityFallback: isEpisode
      ? `podcast_episode:youtube:${classification.videoId}`
      : `podcast_show:youtube:${classification.channelHandle || classification.playlistId || inputUrl}`,
    resolutionSources: ['youtube-oembed']
  });
}

async function fetchYouTubePageMetadata(inputUrl, fetchImpl) {
  try {
    const response = await fetchText(inputUrl, fetchImpl, { maxBytes: MAX_HTML_BYTES });
    const { document } = parseHTML(response.text);
    return {
      title: meta(document, 'og:title') || document.querySelector('title')?.textContent || '',
      description: meta(document, 'og:description') || meta(document, 'description') || '',
      imageUrl: resolveUrl(meta(document, 'og:image'), inputUrl),
      author: meta(document, 'og:site_name') || 'YouTube'
    };
  } catch {
    return {};
  }
}

async function resolveWebsite(inputUrl, html, fetchImpl, env) {
  const pageHtml = html || (await fetchText(inputUrl, fetchImpl, { maxBytes: MAX_HTML_BYTES })).text;
  const { document } = parseHTML(pageHtml);
  const rssUrl = findRssUrl(document, inputUrl);
  const pageLinks = extractPlatformLinksFromDocument(document, inputUrl);

  if (rssUrl) {
    const feed = await fetchPodcastFeed(rssUrl, fetchImpl);
    const platformLinks = normalizePlatformLinks({
      rss: platformLink('RSS Feed', rssUrl, 'rss', 'exact'),
      website: platformLink('Website', inputUrl, 'website', 'exact'),
      ...pageLinks
    });

    return buildPodcastItem({
      sourceUrl: inputUrl,
      sourcePlatform: 'website',
      feed,
      platformLinks,
      identityFallback: `podcast_show:rss:${rssUrl}`,
      resolutionSources: ['website', 'rss-feed']
    });
  }

  const title = meta(document, 'og:title') || document.querySelector('title')?.textContent || inputUrl;
  const description = meta(document, 'og:description') || meta(document, 'description') || '';
  const imageUrl = resolveUrl(meta(document, 'og:image'), inputUrl);

  return {
    type: 'article',
    sourceUrl: inputUrl,
    canonicalUrl: resolveUrl(document.querySelector('link[rel="canonical"]')?.getAttribute('href'), inputUrl) || inputUrl,
    identityKey: `article:url:${normalizeCanonicalUrl(inputUrl)}`,
    title: cleanText(title),
    description: cleanDescription(description),
    imageUrl,
    author: meta(document, 'author') || '',
    publisher: new URL(inputUrl).hostname.replace(/^www\./, ''),
    platforms: normalizePlatformLinks({
      website: platformLink('Website', inputUrl, 'website', 'exact'),
      ...pageLinks
    }),
    media: {},
    resolution: {
      confidence: 'medium',
      sources: ['website'],
      warnings: ['Resolved as a generic article; rich article sharing can be expanded later.']
    }
  };
}

function buildPodcastItem({
  sourceUrl,
  sourcePlatform,
  feed,
  episode = null,
  platformLinks = {},
  sourceMetadata = {},
  identityFallback = '',
  resolutionSources = [],
  warnings = []
}) {
  const isEpisode = Boolean(episode);
  const title = cleanText(episode?.title || sourceMetadata.title || feed?.title || 'Podcast');
  const description = cleanDescription(episode?.description || sourceMetadata.description || feed?.description || '');
  const imageUrl = episode?.imageUrl || sourceMetadata.imageUrl || feed?.imageUrl || '';
  const canonicalUrl = episode?.link || sourceMetadata.canonicalUrl || feed?.link || sourceUrl;
  const identityKey = isEpisode
    ? episodeIdentity(feed, episode, identityFallback || sourceUrl)
    : showIdentity(feed, sourceMetadata, identityFallback || sourceUrl);

  return {
    type: isEpisode ? 'podcast_episode' : 'podcast_show',
    sourceUrl,
    canonicalUrl,
    identityKey,
    title,
    description,
    imageUrl,
    author: sourceMetadata.author || feed?.author || '',
    publisher: sourceMetadata.publisher || feed?.publisher || sourceMetadata.author || feed?.author || '',
    publishedAt: episode?.publishedAt || sourceMetadata.publishedAt || '',
    platforms: addDerivedPodcastLinks(normalizePlatformLinks(platformLinks), feed),
    podcast: {
      title: feed?.title || sourceMetadata.showTitle || (isEpisode ? '' : title),
      description: feed?.description || '',
      imageUrl: feed?.imageUrl || imageUrl,
      author: feed?.author || '',
      feedUrl: feed?.url || '',
      websiteUrl: feed?.link || ''
    },
    media: {
      audioUrl: episode?.audioUrl || '',
      audioType: episode?.audioType || '',
      duration: episode?.duration || sourceMetadata.duration || '',
      episodeGuid: episode?.guid || ''
    },
    resolution: {
      confidence: feed || sourcePlatform === 'youtube' || sourcePlatform === 'spotify' ? 'high' : 'medium',
      sources: uniqueStrings(resolutionSources),
      warnings
    }
  };
}

function addDerivedPodcastLinks(platforms, feed) {
  if (feed?.url && !platforms.antennaPod) {
    platforms.antennaPod = platformLink(
      'AntennaPod',
      `https://antennapod.org/deeplink/subscribe?url=${encodeURIComponent(feed.url)}&title=${encodeURIComponent(feed.title || 'Podcast')}`,
      'rss',
      'derived'
    );
  }
  return platforms;
}

function episodeIdentity(feed, episode, fallback) {
  if (feed?.url && episode?.guid) return `podcast_episode:rss:${normalizeCanonicalUrl(feed.url)}#${episode.guid}`;
  if (feed?.url && episode?.audioUrl) return `podcast_episode:audio:${normalizeCanonicalUrl(feed.url)}#${normalizeCanonicalUrl(episode.audioUrl)}`;
  return fallback;
}

function showIdentity(feed, sourceMetadata, fallback) {
  if (feed?.url) return `podcast_show:rss:${normalizeCanonicalUrl(feed.url)}`;
  if (sourceMetadata?.canonicalUrl) return `podcast_show:url:${normalizeCanonicalUrl(sourceMetadata.canonicalUrl)}`;
  return fallback;
}

function extractEpisodePlatformLinks(episode) {
  const links = {};
  for (const url of episode.links || []) {
    const classification = classifyUrl(url);
    if (classification.platform === 'spotify' && classification.spotifyType === 'episode') {
      links.spotify = platformLink('Spotify', url, 'episode', 'exact');
    }
    if (classification.platform === 'youtube') {
      links.youtube = platformLink('YouTube', url, classification.videoId ? 'episode' : 'show', 'exact');
    }
  }
  return links;
}

async function fetchAppleLookup(id, fetchImpl) {
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=podcast,podcastEpisode&country=US&limit=200`;
  const response = await fetchJson(url, fetchImpl);
  return response || null;
}

async function searchApplePodcast(term, fetchImpl) {
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=5&country=US&term=${encodeURIComponent(term)}`;
  const response = await fetchJson(url, fetchImpl);
  const results = response?.results || [];
  const normalizedTerm = normalizeTitle(term);
  return results.find((result) => normalizeTitle(result.collectionName) === normalizedTerm) || results[0] || null;
}

async function findApplePodcastByFeed(term, feedUrl, fetchImpl) {
  const url = `https://itunes.apple.com/search?media=podcast&entity=podcast&limit=10&country=US&term=${encodeURIComponent(term)}`;
  const response = await fetchJson(url, fetchImpl);
  const results = response?.results || [];
  const normalizedFeedUrl = normalizeFeedUrl(feedUrl);
  const normalizedTerm = normalizeTitle(term);
  return results.find((result) => normalizeFeedUrl(result.feedUrl) === normalizedFeedUrl) ||
    results.find((result) => normalizeTitle(result.collectionName) === normalizedTerm) ||
    results[0] ||
    null;
}

async function findAppleEpisodeUrl(appleId, episode, fetchImpl) {
  if (!appleId || !episode?.title) return '';
  try {
    const lookup = await fetchAppleLookup(appleId, fetchImpl);
    const results = lookup?.results || [];
    const match = matchAppleEpisodeResult(results, episode);
    return match?.trackViewUrl || '';
  } catch {
    return '';
  }
}

function matchAppleEpisodeResult(results = [], episode = {}) {
  let best = null;
  let bestScore = 0;
  const targetTitle = normalizeTitle(episode.title);
  const targetDate = episode.publishedAt ? new Date(episode.publishedAt) : null;
  const targetDuration = episode.duration ? durationToSeconds(episode.duration) : null;

  for (const result of results) {
    if (!(result.wrapperType === 'podcastEpisode' || result.kind === 'podcast-episode')) continue;
    let score = titleScore(normalizeTitle(result.trackName || result.collectionName), targetTitle);
    if (episode.guid && result.episodeGuid && episode.guid === result.episodeGuid) {
      score = Math.max(score, 1);
    }
    if (episode.audioUrl && (normalizeCanonicalUrl(result.episodeUrl) === normalizeCanonicalUrl(episode.audioUrl) ||
      normalizeCanonicalUrl(result.previewUrl) === normalizeCanonicalUrl(episode.audioUrl))) {
      score = Math.max(score, 1);
    }
    if (targetDate && result.releaseDate) {
      const deltaDays = Math.abs(new Date(result.releaseDate) - targetDate) / 86400000;
      if (deltaDays <= 3) score += 0.2;
    }
    if (targetDuration && result.trackTimeMillis) {
      const seconds = Math.round(result.trackTimeMillis / 1000);
      if (Math.abs(seconds - targetDuration) <= 120) score += 0.15;
    }
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return bestScore >= 0.72 ? best : null;
}

async function fetchSpotifyApi(inputUrl, classification, fetchImpl, env) {
  if (!env?.SPOTIFY_CLIENT_ID || !env?.SPOTIFY_CLIENT_SECRET || !classification.spotifyId) {
    return null;
  }

  const token = await fetchSpotifyAccessToken(fetchImpl, env);
  if (!token) return null;

  const endpoint = classification.spotifyType === 'episode'
    ? `https://api.spotify.com/v1/episodes/${encodeURIComponent(classification.spotifyId)}?market=US`
    : `https://api.spotify.com/v1/shows/${encodeURIComponent(classification.spotifyId)}?market=US`;

  return fetchJson(endpoint, fetchImpl, {
    headers: { Authorization: `Bearer ${token}` }
  });
}

async function findSpotifyEpisodeLink(spotifyUrl, episode, fetchImpl, env) {
  const classification = classifyUrl(spotifyUrl || '');
  if (classification.platform === 'spotify' && classification.spotifyType === 'episode') {
    return platformLink('Spotify', spotifyUrl, 'episode', 'exact');
  }
  if (classification.platform !== 'spotify' || classification.spotifyType !== 'show' || !classification.spotifyId || !episode?.title) {
    return null;
  }

  try {
    const webEpisodes = await fetchSpotifyShowPageEpisodes(classification.spotifyId, fetchImpl);
    const webMatch = matchSpotifyEpisodeResult(webEpisodes, episode);
    const webUrl = webMatch?.external_urls?.spotify || (webMatch?.id ? `https://open.spotify.com/episode/${webMatch.id}` : '');
    if (webUrl) {
      return platformLink('Spotify', webUrl, 'episode', 'verified');
    }

    const apiEpisodes = await fetchSpotifyShowEpisodes(classification.spotifyId, fetchImpl, env);
    const match = matchSpotifyEpisodeResult(apiEpisodes, episode);
    const url = match?.external_urls?.spotify || (match?.id ? `https://open.spotify.com/episode/${match.id}` : '');
    return url ? platformLink('Spotify', url, 'episode', 'verified') : null;
  } catch {
    return null;
  }
}

async function fetchSpotifyShowPageEpisodes(showId, fetchImpl) {
  try {
    const showUrl = `https://open.spotify.com/show/${encodeURIComponent(showId)}`;
    const response = await fetchText(showUrl, fetchImpl, { maxBytes: MAX_HTML_BYTES });
    const { document } = parseHTML(response.text);
    const episodes = [];
    const seen = new Set();

    for (const anchor of [...document.querySelectorAll('a[href^="/episode/"], a[href*="open.spotify.com/episode/"]')]) {
      const url = resolveUrl(anchor.getAttribute('href'), showUrl);
      const classification = classifyUrl(url);
      if (classification.platform !== 'spotify' || classification.spotifyType !== 'episode' || !classification.spotifyId) {
        continue;
      }

      const name = cleanText(anchor.textContent || anchor.getAttribute('aria-label') || '');
      if (!name || seen.has(classification.spotifyId)) continue;
      seen.add(classification.spotifyId);
      episodes.push({
        id: classification.spotifyId,
        name,
        external_urls: { spotify: `https://open.spotify.com/episode/${classification.spotifyId}` }
      });
    }

    return episodes;
  } catch {
    return [];
  }
}

async function fetchSpotifyShowEpisodes(showId, fetchImpl, env) {
  const token = await fetchSpotifyAccessToken(fetchImpl, env);
  if (!token) return [];

  const episodes = [];
  let url = `https://api.spotify.com/v1/shows/${encodeURIComponent(showId)}/episodes?market=US&limit=50`;
  for (let page = 0; page < 3 && url; page += 1) {
    const response = await fetchJson(url, fetchImpl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    episodes.push(...(response?.items || []));
    url = response?.next || '';
  }
  return episodes;
}

function matchSpotifyEpisodeResult(results = [], episode = {}) {
  let best = null;
  let bestScore = 0;
  const targetTitle = normalizeTitle(episode.title);
  const targetDate = episode.publishedAt ? new Date(episode.publishedAt) : null;
  const targetDuration = episode.duration ? durationToSeconds(episode.duration) : null;

  for (const result of results) {
    let score = titleScore(normalizeTitle(result.name), targetTitle);
    if (targetDate && result.release_date) {
      const deltaDays = Math.abs(new Date(result.release_date) - targetDate) / 86400000;
      if (deltaDays <= 3) score += 0.2;
    }
    if (targetDuration && result.duration_ms) {
      const seconds = Math.round(result.duration_ms / 1000);
      if (Math.abs(seconds - targetDuration) <= 120) score += 0.15;
    }
    if (score > bestScore) {
      best = result;
      bestScore = score;
    }
  }

  return bestScore >= 0.72 ? best : null;
}

async function fetchSpotifyAccessToken(fetchImpl, env) {
  if (!env?.SPOTIFY_CLIENT_ID || !env?.SPOTIFY_CLIENT_SECRET) {
    return '';
  }

  const tokenResponse = await fetchJson('https://accounts.spotify.com/api/token', fetchImpl, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${base64(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}`,
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  return tokenResponse?.access_token || '';
}

async function fetchPodcastFeed(feedUrl, fetchImpl) {
  const fetched = await fetchText(feedUrl, fetchImpl, { maxBytes: MAX_FEED_BYTES });
  return parsePodcastFeed(fetched.text, feedUrl);
}

async function fetchPcstLinks(appleId, fetchImpl) {
  try {
    const response = await fetchText(`https://pc.st/${encodeURIComponent(appleId)}`, fetchImpl, { maxBytes: MAX_HTML_BYTES });
    const { document } = parseHTML(response.text);
    return extractPlatformLinksFromDocument(document, `https://pc.st/${appleId}`);
  } catch {
    return {};
  }
}

async function fetchWebsitePlatformLinks(url, fetchImpl) {
  try {
    const response = await fetchText(url, fetchImpl, { maxBytes: MAX_HTML_BYTES });
    const { document } = parseHTML(response.text);
    return extractPlatformLinksFromDocument(document, url);
  } catch {
    return {};
  }
}

function extractPlatformLinksFromDocument(document, baseUrl) {
  const links = {};
  for (const anchor of [...document.querySelectorAll('a[href]')]) {
    const href = resolveUrl(anchor.getAttribute('href'), baseUrl);
    if (!href) continue;
    const textValue = normalizeTitle(anchor.textContent || href);
    const classification = classifyUrl(href);

    if (classification.platform === 'apple' && !links.apple) {
      links.apple = platformLink('Apple Podcasts', href, classification.episodeId ? 'episode' : 'show', 'verified');
    }
    if (classification.platform === 'spotify' && !links.spotify) {
      links.spotify = platformLink('Spotify', href, classification.spotifyType === 'episode' ? 'episode' : 'show', 'verified');
    }
    if (classification.platform === 'youtube' && !links.youtube) {
      links.youtube = platformLink(textValue.includes('youtube music') ? 'YouTube Music' : 'YouTube', href, classification.videoId ? 'episode' : 'show', 'verified');
    }
    if ((href.includes('pca.st') || href.includes('pocketcasts.com')) && !links.pocketCasts) {
      links.pocketCasts = platformLink('Pocket Casts', href, 'show', 'verified');
    }
    if (href.includes('overcast.fm') && !links.overcast) {
      links.overcast = platformLink('Overcast', href, 'show', 'verified');
    }
  }
  return normalizePlatformLinks(links);
}

function findRssUrl(document, baseUrl) {
  const alternates = [...document.querySelectorAll('link[rel~="alternate"], a[href]')];
  for (const node of alternates) {
    const type = (node.getAttribute('type') || '').toLowerCase();
    const href = node.getAttribute('href');
    const textValue = (node.textContent || '').toLowerCase();
    if (!href) continue;
    const hrefValue = href.toLowerCase();
    if (
      type.includes('rss') ||
      type.includes('xml') ||
      textValue.includes('rss') ||
      hrefValue.includes('rss') ||
      hrefValue.includes('/feed') ||
      hrefValue.includes('feeds.')
    ) {
      return resolveUrl(href, baseUrl);
    }
  }
  return '';
}

function matchEpisode(episodes = [], target = {}) {
  if (!target.title) return null;
  const normalizedTargets = uniqueStrings([target.title, ...(target.alternateTitles || [])].map(normalizeTitle));
  const targetDate = target.publishedAt ? new Date(target.publishedAt) : null;
  const targetDuration = target.durationMillis ? Math.round(target.durationMillis / 1000) : null;

  let best = null;
  let bestScore = 0;
  for (const episode of episodes) {
    const normalizedEpisodeTitle = normalizeTitle(episode.title);
    let score = Math.max(...normalizedTargets.map((candidate) => {
      const baseScore = titleScore(normalizedEpisodeTitle, candidate);
      const phraseScore = titleContainsDistinctPhrase(normalizedEpisodeTitle, candidate) ? 0.86 : 0;
      return Math.max(baseScore, phraseScore);
    }));
    if (targetDate && episode.publishedAt) {
      const deltaDays = Math.abs(new Date(episode.publishedAt) - targetDate) / 86400000;
      if (deltaDays <= 2) score += 0.25;
    }
    if (targetDuration && episode.duration) {
      const seconds = durationToSeconds(episode.duration);
      if (seconds && Math.abs(seconds - targetDuration) <= 90) score += 0.2;
    }
    if (score > bestScore) {
      best = episode;
      bestScore = score;
    }
  }

  return bestScore >= 0.82 ? best : null;
}

function matchEpisodeByLink(episodes = [], inputUrl) {
  const input = classifyUrl(inputUrl);
  for (const episode of episodes) {
    for (const link of episode.links || []) {
      const candidate = classifyUrl(link);
      if (input.platform === 'youtube' && candidate.platform === 'youtube' && input.videoId && candidate.videoId === input.videoId) {
        return episode;
      }
      if (normalizeCanonicalUrl(link) === normalizeCanonicalUrl(inputUrl)) {
        return episode;
      }
    }
  }
  return null;
}

function titleScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  const aWords = new Set(a.split(' ').filter(Boolean));
  const bWords = new Set(b.split(' ').filter(Boolean));
  const shared = [...aWords].filter((word) => bWords.has(word)).length;
  return shared / Math.max(aWords.size, bWords.size, 1);
}

function titleContainsDistinctPhrase(title, phrase) {
  const words = phrase.split(' ').filter(Boolean);
  return words.length >= 2 && words.length <= 5 && title.includes(phrase);
}

async function fetchOEmbed(url, fetchImpl) {
  try {
    return await fetchJson(url, fetchImpl);
  } catch {
    return null;
  }
}

async function fetchJson(url, fetchImpl, options = {}) {
  const response = await fetchWithTimeout(url, fetchImpl, options);
  if (!response.ok) {
    throw new ShareResolveError(`Fetch failed: ${response.status}`, response.status);
  }
  return response.json();
}

async function fetchText(url, fetchImpl, { maxBytes = MAX_HTML_BYTES } = {}) {
  const response = await fetchWithTimeout(url, fetchImpl);
  if (!response.ok) {
    throw new ShareResolveError(`Fetch failed: ${response.status}`, response.status);
  }

  const text = await response.text();
  return {
    text: text.length > maxBytes ? text.slice(0, maxBytes) : text,
    contentType: response.headers.get('content-type') || ''
  };
}

async function fetchWithTimeout(url, fetchImpl, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        accept: 'application/rss+xml, application/xml, text/xml, text/html, application/json;q=0.9, */*;q=0.8',
        ...(options.headers || {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikePodcastFeed(url, contentType, body) {
  const lowerType = contentType.toLowerCase();
  return lowerType.includes('rss') ||
    lowerType.includes('xml') ||
    url.endsWith('.rss') ||
    url.endsWith('.xml') ||
    /<rss[\s>]/i.test(body) ||
    /<feed[\s>]/i.test(body);
}

function platformLink(label, url, kind, confidence) {
  if (!url) return null;
  return { label, url, kind, confidence };
}

function normalizePlatformLinks(links) {
  return Object.fromEntries(Object.entries(links).filter(([, value]) => value?.url));
}

function text(element, selectors) {
  for (const selector of selectors) {
    const node = element.querySelector(selector);
    const value = node?.textContent?.trim();
    if (value) return decodeEntities(value);
  }
  return '';
}

function attr(element, selector, attribute) {
  const value = element.querySelector(selector)?.getAttribute(attribute);
  return value ? decodeEntities(value.trim()) : '';
}

function meta(document, name) {
  return document.querySelector(`meta[property="${name}"]`)?.getAttribute('content') ||
    document.querySelector(`meta[name="${name}"]`)?.getAttribute('content') ||
    '';
}

function extractLinksFromHtml(html) {
  const decoded = decodeEntities(html || '');
  const links = new Set();
  try {
    const { document } = parseHTML(`<main>${decoded}</main>`);
    for (const anchor of [...document.querySelectorAll('a[href]')]) {
      const href = cleanupUrl(anchor.getAttribute('href'));
      if (href.startsWith('http')) links.add(href);
    }
  } catch {}

  for (const match of decoded.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    links.add(cleanupUrl(match[0]));
  }
  return [...links];
}

function cleanDescription(value) {
  const decoded = decodeEntities(value || '')
    .replace(/<\s*br\s*\/?>/gi, ' ')
    .replace(/<\s*\/(p|div|li|h[1-6])\s*>/gi, ' ');
  if (!decoded) return '';
  try {
    const { document } = parseHTML(`<main>${decoded}</main>`);
    return cleanText(document.querySelector('main')?.textContent || document.body?.textContent || decoded);
  } catch {
    return cleanText(decoded.replace(/<[^>]+>/g, ' '));
  }
}

function cleanText(value) {
  return decodeEntities(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeTitle(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/\| podcast on spotify$/i, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function cleanSpotifyTitle(value) {
  return cleanText(value)
    .replace(/\s*\|\s*Podcast on Spotify\s*$/i, '')
    .replace(/\s*-\s*Podcast\s*$/i, '');
}

function cleanSpotifyShowTitle(value) {
  const cleaned = cleanSpotifyTitle(value);
  return cleaned.split(' - ')[1] || cleaned;
}

function cleanYouTubeTitle(value) {
  return cleanText(value).replace(/\s*-\s*YouTube\s*$/i, '');
}

function youtubeTitleCandidates(value) {
  const title = cleanYouTubeTitle(value);
  const candidates = [];
  for (const separator of [' | ', ' – ', ' — ', ' - ']) {
    if (!title.includes(separator)) continue;
    const parts = title.split(separator).map(cleanText).filter(Boolean);
    candidates.push(...parts);
  }
  return uniqueStrings(candidates.filter((candidate) => candidate && candidate !== title));
}

function cleanOvercastTitle(value) {
  return cleanText(value)
    .replace(/\s+—\s+Overcast\s*$/i, '')
    .replace(/\s+-\s+Overcast\s*$/i, '');
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanupUrl(value) {
  return String(value || '').trim().replace(/[),.;\]]+$/g, '');
}

function normalizeHttpUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeCanonicalUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4);
    return url.href.replace(/\/$/, '');
  } catch {
    return value || '';
  }
}

function normalizeFeedUrl(value) {
  try {
    const url = new URL(value);
    url.hash = '';
    if (url.hostname.startsWith('www.')) url.hostname = url.hostname.slice(4);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.pathname) {
      url.protocol = 'https:';
    }
    return url.href.replace(/\/$/, '');
  } catch {
    return value || '';
  }
}

function resolveUrl(value, baseUrl) {
  if (!value) return '';
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return '';
  }
}

function parseDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.valueOf()) ? date.toISOString() : '';
}

function durationToSeconds(value) {
  if (!value) return 0;
  const parts = String(value).split(':').map((part) => Number.parseInt(part, 10));
  if (parts.some(Number.isNaN)) return Number.parseInt(value, 10) || 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function normalizeDuration(value) {
  const clean = cleanText(value);
  if (!clean) return '';
  if (/^\d+$/.test(clean)) {
    return formatDurationSeconds(Number.parseInt(clean, 10));
  }
  return clean;
}

function formatDurationSeconds(totalSeconds) {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatDurationMillis(value) {
  if (!value) return '';
  return formatDurationSeconds(Math.round(value / 1000));
}

function bestAppleImage(result) {
  return result?.artworkUrl600 || result?.artworkUrl512 || result?.artworkUrl100 || '';
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()))];
}

function base64(value) {
  if (typeof btoa === 'function') return btoa(value);
  return Buffer.from(value).toString('base64');
}

export class ShareResolveError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'ShareResolveError';
    this.status = status;
  }
}
