const PLATFORM_ORDER = [
  'x',
  'apple',
  'spotify',
  'youtube',
  'overcast',
  'pocketCasts',
  'antennaPod',
  'rss',
  'website'
];

const PLATFORM_NAMES = {
  x: 'X',
  apple: 'Apple Podcasts',
  spotify: 'Spotify',
  youtube: 'YouTube',
  overcast: 'Overcast',
  pocketCasts: 'Pocket Casts',
  antennaPod: 'AntennaPod',
  rss: 'RSS Feed',
  website: 'Website'
};

const PREVIEW_DESCRIPTION_MAX = 180;
const VISIBLE_DESCRIPTION_MAX = 500;
const X_DESCRIPTION_MAX = 220;

export function renderSharePage(item, requestUrl) {
  if (item.type === 'x_post') {
    return renderXSharePage(item, requestUrl);
  }

  const shareUrl = new URL(`/share/${item.id}`, requestUrl).href;
  const title = item.title || 'Shared podcast';
  const description = cleanDisplayText(item.description || item.podcast?.description || 'A shared podcast link from jeffharr.is.');
  const visibleDescription = splitDescription(description, VISIBLE_DESCRIPTION_MAX);
  const previewDescription = truncate(description, PREVIEW_DESCRIPTION_MAX);
  const sourceImageUrl = item.imageUrl || item.podcast?.imageUrl || '';
  const imageUrl = sourceImageUrl || 'https://jeffharr.is/images/profile.jpg';
  const audioUrl = item.media?.audioUrl || '';
  const isEpisode = item.type === 'podcast_episode';
  const shareText = buildShareText(item, title);

  return htmlDocument({
    title: `${title} | Jeff Harris`,
    description: previewDescription,
    imageUrl,
    touchIconUrl: sourceImageUrl,
    appTitle: title,
    url: shareUrl,
    noindex: false,
    body: `
      <header class="share-header">
        <a class="back-link" href="/share">Share</a>
      </header>
      <main class="share-main share-main--detail">
        <article class="share-card share-detail">
          <img class="share-artwork" src="${escapeAttribute(imageUrl)}" alt="" width="320" height="320">
          <div class="share-content">
            <p class="share-kicker">${escapeHtml(isEpisode ? item.podcast?.title || 'Podcast episode' : 'Podcast')}</p>
            <h1>${escapeHtml(title)}</h1>
            ${item.author || item.publisher ? `<p class="share-byline">${escapeHtml(item.author || item.publisher)}</p>` : ''}
            ${item.publishedAt || item.media?.duration ? `<p class="share-meta">${escapeHtml(formatMeta(item))}</p>` : ''}
            <div class="share-actions share-actions--hero">
              <button class="native-share-btn" type="button" data-native-share data-share-title="${escapeAttribute(title)}" data-share-text="${escapeAttribute(shareText)}" data-share-url="${escapeAttribute(shareUrl)}">
                <span class="native-share-btn__icon" aria-hidden="true">${shareIconSvg()}</span>
                <span>Share</span>
              </button>
              <button class="secondary-btn secondary-btn--compact" type="button" data-copy="${escapeAttribute(shareUrl)}">Copy link</button>
              ${renderFavoriteButton(item.id)}
            </div>
            ${renderPlatformSection(item.platforms || {})}
            ${audioUrl ? `
              <div class="share-player">
                <audio controls preload="metadata" src="${escapeAttribute(audioUrl)}"></audio>
              </div>
            ` : ''}
            ${renderExpandableDescription(visibleDescription)}
          </div>
        </article>
      </main>
      <script src="/share-assets/share.js?v=7"></script>
    `
  });
}

function renderXSharePage(item, requestUrl) {
  const shareUrl = new URL(`/share/${item.id}`, requestUrl).href;
  const posts = Array.isArray(item.x?.posts) ? item.x.posts : [];
  const sharedPost = posts.find((post) => post.id === item.x?.sharedTweetId) || posts[0] || null;
  const title = item.title || buildXPostTitle(sharedPost) || 'Shared X post';
  const description = truncate(item.description || sharedPost?.text || 'A shared X post from jeffharr.is.', X_DESCRIPTION_MAX);
  const sourceImageUrl = item.imageUrl || firstXPostImage(sharedPost) || sharedPost?.author?.profileImageUrl || '';
  const imageUrl = sourceImageUrl || 'https://jeffharr.is/images/profile.jpg';
  const shareText = sharedPost?.author?.username
    ? `${sharedPost.author.name || `@${sharedPost.author.username}`} on X`
    : title;
  const originalUrl = item.canonicalUrl || sharedPost?.url || '';
  const warnings = item.x?.warnings || item.resolution?.warnings || [];

  return htmlDocument({
    title: `${title} | Jeff Harris`,
    description,
    imageUrl,
    touchIconUrl: sourceImageUrl,
    appTitle: title,
    url: shareUrl,
    noindex: false,
    body: `
      <header class="share-header">
        <a class="back-link" href="/share">Share</a>
        <a class="back-link" href="/share/history">History</a>
      </header>
      <main class="share-main share-main--x">
        <article class="share-card x-share-detail">
          <section class="x-share-summary">
            <p class="share-kicker">X thread</p>
            <h1>${escapeHtml(title)}</h1>
            <p class="share-description">${escapeHtml(description)}</p>
            <div class="share-actions share-actions--hero">
              <button class="native-share-btn" type="button" data-native-share data-share-title="${escapeAttribute(title)}" data-share-text="${escapeAttribute(shareText)}" data-share-url="${escapeAttribute(shareUrl)}">
                <span class="native-share-btn__icon" aria-hidden="true">${shareIconSvg()}</span>
                <span>Share thread</span>
              </button>
              <button class="secondary-btn secondary-btn--compact" type="button" data-copy="${escapeAttribute(shareUrl)}">Copy link</button>
              ${originalUrl ? `<a class="secondary-btn secondary-btn--compact" href="${escapeAttribute(originalUrl)}" target="_blank" rel="noopener">Open on X</a>` : ''}
              ${renderFavoriteButton(item.id)}
            </div>
          </section>
          <section class="x-thread" aria-label="Shared X thread">
            ${posts.map((post) => renderXPostCard(post)).join('') || '<p class="empty-state">This X post could not be rendered.</p>'}
          </section>
          ${warnings.length ? `<p class="x-thread-note">${escapeHtml(warnings[0])}</p>` : ''}
        </article>
      </main>
      <script src="/share-assets/share.js?v=7"></script>
    `
  });
}

export function renderHistoryPage(items, requestUrl) {
  const rows = items.map((item) => {
    const url = new URL(`/share/${item.id}`, requestUrl).href;
    const image = item.imageUrl || 'https://jeffharr.is/images/profile.jpg';
    return `
      <a class="history-item" href="/share/${escapeAttribute(item.id)}">
        <img src="${escapeAttribute(image)}" alt="" width="72" height="72">
        <span class="history-item__body">
          <span class="history-item__heading">
            <strong>${escapeHtml(item.title || 'Untitled share')}</strong>
            ${renderFavoriteIndicator(item.id)}
          </span>
          <span>${escapeHtml(formatHistoryMeta(item))}</span>
          <small>${escapeHtml(url)}</small>
        </span>
      </a>
    `;
  }).join('');

  return htmlDocument({
    title: 'Share History | Jeff Harris',
    description: 'Unlisted history of shared links.',
    imageUrl: 'https://jeffharr.is/images/profile.jpg',
    url: new URL('/share/history', requestUrl).href,
    noindex: true,
    body: `
      <header class="share-header">
        <a class="back-link" href="/share">Share</a>
      </header>
      <main class="share-main">
        <section class="share-card history-card">
          <div class="share-content">
            <p class="share-kicker">Unlisted</p>
            <h1>Share History</h1>
            <p class="share-description">Recent links created through the share tool.</p>
          </div>
          <div class="history-list">
            ${rows || '<p class="empty-state">No shared links yet.</p>'}
          </div>
        </section>
      </main>
    `
  });
}

export function renderNotFoundPage(requestUrl) {
  return htmlDocument({
    title: 'Share Not Found | Jeff Harris',
    description: 'This shared link could not be found.',
    imageUrl: 'https://jeffharr.is/images/profile.jpg',
    url: requestUrl,
    noindex: true,
    body: `
      <main class="share-main">
        <section class="share-card share-content">
          <p class="share-kicker">Missing</p>
          <h1>Share not found</h1>
          <p class="share-description">This share link does not exist or is no longer available.</p>
          <a class="primary-btn" href="/share">Create a share link</a>
        </section>
      </main>
    `
  });
}

export function renderLoadingPage(sourceUrl, requestUrl) {
  const resolveUrl = new URL('/share/new', requestUrl);
  resolveUrl.searchParams.set('url', sourceUrl);
  resolveUrl.searchParams.set('resolve', '1');
  const isXPost = looksLikeXStatusSource(sourceUrl);
  const loadingCopy = isXPost ? {
    description: 'Gathering the X post, reply chain, author thread, and media.',
    kicker: 'Gathering',
    heading: 'Building X share page',
    status: 'Fetching the post and nearby thread.',
    steps: [
      'Reading shared URL',
      'Fetching the X post',
      'Following the reply chain',
      'Collecting media',
      'Opening share page'
    ]
  } : {
    description: 'Finding podcast metadata and app links.',
    kicker: 'Resolving',
    heading: 'Building share page',
    status: 'Finding the episode, artwork, audio, video, and app links.',
    steps: [
      'Reading shared URL',
      'Finding podcast feed',
      'Matching the episode',
      'Finding video and app links',
      'Opening share page'
    ]
  };

  return htmlDocument({
    title: 'Creating Share Link | Jeff Harris',
    description: loadingCopy.description,
    imageUrl: 'https://jeffharr.is/images/profile.jpg',
    url: requestUrl,
    noindex: true,
    body: `
      <header class="share-header">
        <a class="back-link" href="/share">Share</a>
      </header>
      <main class="share-main share-main--loading">
        <section class="share-card loading-card" data-share-loader data-share-kind="${escapeAttribute(isXPost ? 'x' : 'podcast')}" data-source-url="${escapeAttribute(sourceUrl)}">
          <div class="loading-mark" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="share-content loading-content">
            <p class="share-kicker">${escapeHtml(loadingCopy.kicker)}</p>
            <h1>${escapeHtml(loadingCopy.heading)}</h1>
            <p class="share-description" data-loading-status>${escapeHtml(loadingCopy.status)}</p>
            <ol class="loading-steps" aria-label="Share creation progress">
              ${loadingCopy.steps.map((step, index) => `<li data-loading-step="${index}"${index === 0 ? ' class="is-active"' : ''}>${escapeHtml(step)}</li>`).join('')}
            </ol>
            <a class="secondary-btn loading-fallback" href="${escapeAttribute(resolveUrl.href)}">Continue without loading screen</a>
          </div>
        </section>
      </main>
      <script src="/share-assets/share.js?v=7"></script>
    `
  });
}

export function renderRedirectPage(shareUrl) {
  return htmlDocument({
    title: 'Share Created | Jeff Harris',
    description: 'Your share link was created.',
    imageUrl: 'https://jeffharr.is/images/profile.jpg',
    url: shareUrl,
    noindex: true,
    body: `
      <main class="share-main">
        <section class="share-card share-content">
          <p class="share-kicker">Created</p>
          <h1>Share link ready</h1>
          <p class="share-description">Opening the share page now.</p>
          <a class="primary-btn" href="${escapeAttribute(shareUrl)}">Open share page</a>
        </section>
      </main>
      <script>location.replace(${JSON.stringify(shareUrl)});</script>
    `
  });
}

function htmlDocument({ title, description, imageUrl, touchIconUrl, appTitle, url, body, noindex }) {
  const appleTouchIconUrl = touchIconUrl || '/share-assets/apple-touch-icon.png';
  const mobileAppTitle = appTitle || 'Share';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeAttribute(description)}">
  ${noindex ? '<meta name="robots" content="noindex, nofollow">' : ''}
  <meta property="og:title" content="${escapeAttribute(title)}">
  <meta property="og:description" content="${escapeAttribute(description)}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="${escapeAttribute(url)}">
  <meta property="og:image" content="${escapeAttribute(imageUrl)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttribute(title)}">
  <meta name="twitter:description" content="${escapeAttribute(description)}">
  <meta name="twitter:image" content="${escapeAttribute(imageUrl)}">
  <link rel="apple-touch-icon" sizes="180x180" href="${escapeAttribute(appleTouchIconUrl)}">
  <meta name="apple-mobile-web-app-title" content="${escapeAttribute(mobileAppTitle)}">
  <link rel="canonical" href="${escapeAttribute(url)}">
  <link rel="icon" href="/share-assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="manifest" href="/share-assets/manifest.webmanifest">
  <link rel="stylesheet" href="/css/favorites.css?v=4">
  <link rel="stylesheet" href="/share-assets/share.css?v=7">
</head>
<body>
  <div class="bg-gradient"></div>
  <div class="bg-noise"></div>
  ${body}
  <script src="/js/favorites.js?v=4" defer></script>
  <script src="/js/admin-presence.js?v=2"></script>
</body>
</html>`;
}

function renderFavoriteButton(shareSlug) {
  return `<button class="favorite-button" type="button" hidden data-favorite-kind="share_page" data-favorite-share-slug="${escapeAttribute(shareSlug)}" aria-label="Favorite"></button>`;
}

function renderFavoriteIndicator(shareSlug) {
  return `<span class="favorite-indicator" hidden data-favorite-kind="share_page" data-favorite-share-slug="${escapeAttribute(shareSlug)}" aria-hidden="true"></span>`;
}

function renderPlatformSection(platforms) {
  const links = renderPlatformLinks(platforms);
  if (!links) return '';
  return `
    <section class="platform-section" aria-label="Open in app">
      <p class="platform-section__label">Open in</p>
      <div class="platform-list" data-platform-list>
        ${links}
      </div>
    </section>
  `;
}

function renderPlatformLinks(platforms) {
  return PLATFORM_ORDER
    .map((key) => [key, platforms[key]])
    .filter(([, platform]) => platform?.url)
    .map(([key, platform]) => `
      <a class="platform-btn platform-btn--${escapeAttribute(key)}"
         data-platform="${escapeAttribute(key)}"
         href="${escapeAttribute(platform.url)}"
         target="_blank"
         rel="noopener">
        <span class="platform-btn__icon" aria-hidden="true">${platformIconSvg(key)}</span>
        <span class="platform-btn__name">${escapeHtml(platform.label || PLATFORM_NAMES[key] || key)}</span>
        <span class="platform-btn__chev" aria-hidden="true">${chevronIconSvg()}</span>
      </a>
    `).join('');
}

function renderExpandableDescription(description) {
  if (!description.preview) return '';
  if (!description.rest) {
    return `<p class="share-description">${escapeHtml(description.preview)}</p>`;
  }

  return `
    <p class="share-description share-description--collapsible" data-description-wrap>
      <span data-description-preview>${escapeHtml(description.preview)}</span><span class="share-description__ellipsis" data-description-ellipsis aria-hidden="true">…</span><span class="share-description__rest" data-description-rest hidden> ${escapeHtml(description.rest)}</span>
      <button class="description-toggle" type="button" data-description-toggle aria-expanded="false" aria-label="Show full description">
        <span class="description-toggle__icon" aria-hidden="true">${chevronIconSvg()}</span>
      </button>
    </p>
  `;
}

function platformIconSvg(key) {
  switch (key) {
    case 'apple':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <rect x="10" y="3.4" width="4" height="9.4" rx="2" fill="currentColor"></rect>
        <path d="M6.5 11.4a5.5 5.5 0 0 0 11 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M12 17v3.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <path d="M9.4 20.6h5.2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
      </svg>`;
    case 'spotify':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M4.6 9Q12 6 19.4 9" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
        <path d="M6.4 13Q12 10.8 17.6 13" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path>
        <path d="M8.2 17Q12 15.2 15.8 17" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"></path>
      </svg>`;
    case 'youtube':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M9 7l9 5-9 5z" fill="currentColor"></path>
      </svg>`;
    case 'overcast':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M5.2 6.6a9 9 0 0 1 13.6 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity="0.5"></path>
        <path d="M7.8 8.4a5.6 5.6 0 0 1 8.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"></path>
        <circle cx="12" cy="12" r="2.2" fill="currentColor"></circle>
        <path d="M11.2 13.8l-1.6 5.8a1 1 0 0 0 1.6 1.1l.8-.5.8.5a1 1 0 0 0 1.6-1.1l-1.6-5.8z" fill="currentColor"></path>
      </svg>`;
    case 'pocketCasts':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M12 4.4a7.6 7.6 0 1 1-7.6 7.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"></path>
        <circle cx="12" cy="12" r="2.6" fill="currentColor"></circle>
      </svg>`;
    case 'antennaPod':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <circle cx="12" cy="9.4" r="2.4" fill="currentColor"></circle>
        <path d="M8 13.6a5.4 5.4 0 1 1 8 0" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"></path>
        <path d="M5 16a9.4 9.4 0 1 1 14 0" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" opacity="0.55"></path>
        <path d="M10.6 13l-1 7.2a.9.9 0 0 0 1.4 1l1-.7 1 .7a.9.9 0 0 0 1.4-1l-1-7.2z" fill="currentColor"></path>
      </svg>`;
    case 'rss':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <circle cx="6.4" cy="17.6" r="2.1" fill="currentColor"></circle>
        <path d="M4.4 11.4a8.2 8.2 0 0 1 8.2 8.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
        <path d="M4.4 5.4a13.6 13.6 0 0 1 14.2 14.2" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path>
      </svg>`;
    case 'website':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.8"></circle>
        <ellipse cx="12" cy="12" rx="4" ry="9" fill="none" stroke="currentColor" stroke-width="1.8"></ellipse>
        <path d="M3.2 12h17.6" fill="none" stroke="currentColor" stroke-width="1.8"></path>
      </svg>`;
    case 'x':
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <path d="M3.2 3.2h4.5l4 5.7 4.6-5.7h2.5l-6 7.3 6.6 9.3h-4.5l-4.5-6.4-5.1 6.4H3l6.5-8z" fill="currentColor"></path>
      </svg>`;
    default:
      return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"></circle>
      </svg>`;
  }
}

function chevronIconSvg() {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"></path>
  </svg>`;
}

function buildShareText(item, title) {
  if (item.type === 'podcast_episode' && item.podcast?.title) {
    return `${title} - ${item.podcast.title}`;
  }
  return title;
}

function shareIconSvg() {
  return `<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
    <path d="M12 3v12"></path>
    <path d="M7 8l5-5 5 5"></path>
    <path d="M5 13v5a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-5"></path>
  </svg>`;
}

function formatMeta(item) {
  return [
    item.publishedAt ? formatDate(item.publishedAt) : '',
    item.media?.duration || ''
  ].filter(Boolean).join(' · ');
}

function formatHistoryMeta(item) {
  return [
    item.type === 'podcast_episode' ? 'Podcast episode' : item.type === 'podcast_show' ? 'Podcast' : item.type === 'x_post' ? 'X post' : 'Shared link',
    item.sharedAt ? formatDate(item.sharedAt) : ''
  ].filter(Boolean).join(' · ');
}

function renderXPostCard(post) {
  const author = post.author || {};
  const name = author.name || (author.username ? `@${author.username}` : 'X');
  const handle = author.username ? `@${author.username}` : '';
  const profileImage = author.profileImageUrl || 'https://jeffharr.is/images/profile.jpg';
  const metrics = formatXMetrics(post.metrics || {});
  const cardClass = post.isShared ? 'x-post x-post--shared' : 'x-post';

  return `
    <article class="${cardClass}" id="x-post-${escapeAttribute(post.id)}">
      <div class="x-post__rail" aria-hidden="true"></div>
      <div class="x-post__body">
        <header class="x-post__header">
          <img class="x-post__avatar" src="${escapeAttribute(profileImage)}" alt="" width="44" height="44" loading="lazy" decoding="async">
          <div class="x-post__author">
            <strong>${escapeHtml(name)}${author.verified ? '<span class="x-post__verified" aria-label="Verified">✓</span>' : ''}</strong>
            <span>${escapeHtml([handle, post.createdAt ? formatDate(post.createdAt) : ''].filter(Boolean).join(' · '))}</span>
          </div>
          ${post.isShared ? '<span class="x-post__badge">Shared</span>' : ''}
        </header>
        ${post.text ? `<div class="x-post__text">${renderLinkedText(post.text)}</div>` : ''}
        ${renderXMediaGrid(post.media || [])}
        ${post.quotedPost ? renderQuotedXPost(post.quotedPost) : ''}
        <footer class="x-post__footer">
          ${metrics ? `<span>${escapeHtml(metrics)}</span>` : '<span>Post on X</span>'}
          ${post.url ? `<a href="${escapeAttribute(post.url)}" target="_blank" rel="noopener">View original</a>` : ''}
        </footer>
      </div>
    </article>
  `;
}

function renderQuotedXPost(post) {
  const author = post.author || {};
  const label = author.username ? `${author.name || author.username} @${author.username}` : author.name || 'Quoted post';
  return `
    <aside class="x-quote">
      <strong>${escapeHtml(label)}</strong>
      ${post.text ? `<div>${renderLinkedText(truncate(post.text, 220))}</div>` : ''}
      ${renderXMediaGrid((post.media || []).slice(0, 1), true)}
    </aside>
  `;
}

function renderXMediaGrid(mediaItems, compact = false) {
  const usable = mediaItems.filter((media) => media.url || media.previewImageUrl).slice(0, compact ? 1 : 4);
  if (!usable.length) return '';

  return `
    <div class="x-media-grid x-media-grid--${usable.length}${compact ? ' x-media-grid--compact' : ''}">
      ${usable.map((media) => {
        const src = media.url || media.previewImageUrl;
        const alt = media.altText || '';
        const isVideo = media.type === 'video' || media.type === 'animated_gif';
        return `
          <figure class="x-media">
            <img src="${escapeAttribute(src)}" alt="${escapeAttribute(alt)}" loading="lazy" decoding="async">
            ${isVideo ? '<span class="x-media__type">Video</span>' : ''}
          </figure>
        `;
      }).join('')}
    </div>
  `;
}

function renderLinkedText(value) {
  const input = String(value || '');
  const urlPattern = /https?:\/\/[^\s<>"']+/g;
  let html = '';
  let cursor = 0;
  let match;

  while ((match = urlPattern.exec(input)) !== null) {
    const start = match.index;
    const rawUrl = trimTrailingUrlPunctuation(match[0]);
    const end = start + rawUrl.length;
    html += escapeHtml(input.slice(cursor, start));
    html += `<a href="${escapeAttribute(rawUrl)}" target="_blank" rel="noopener">${escapeHtml(shortDisplayUrl(rawUrl))}</a>`;
    cursor = end;
  }

  html += escapeHtml(input.slice(cursor));
  return html.replace(/\n/g, '<br>');
}

function formatXMetrics(metrics) {
  return [
    metrics.replies ? `${formatCompactNumber(metrics.replies)} replies` : '',
    metrics.reposts ? `${formatCompactNumber(metrics.reposts)} reposts` : '',
    metrics.likes ? `${formatCompactNumber(metrics.likes)} likes` : ''
  ].filter(Boolean).join(' · ');
}

function formatCompactNumber(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return '';
  return new Intl.NumberFormat('en', { notation: number >= 1000 ? 'compact' : 'standard' }).format(number);
}

function firstXPostImage(post) {
  return (post?.media || []).find((media) => media.url || media.previewImageUrl)?.url || '';
}

function buildXPostTitle(post) {
  if (!post) return '';
  const author = post.author?.name || (post.author?.username ? `@${post.author.username}` : 'X');
  const text = truncate(post.text || '', 88);
  return text ? `${author}: ${text}` : `${author} on X`;
}

function trimTrailingUrlPunctuation(value) {
  return String(value || '').replace(/[),.;\]]+$/g, '');
}

function shortDisplayUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname.replace(/^www\./, '')}${url.pathname === '/' ? '' : url.pathname}`;
  } catch {
    return value;
  }
}

function looksLikeXStatusSource(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, '').replace(/^mobile\./, '');
    return (host === 'x.com' || host === 'twitter.com' || host.endsWith('.x.com') || host.endsWith('.twitter.com')) &&
      (/\/status\/\d+/i.test(url.pathname) || /^\/i\/web\/status\/\d+/i.test(url.pathname));
  } catch {
    return false;
  }
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function truncate(value, max) {
  const clean = cleanDisplayText(value);
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

function splitDescription(value, max) {
  const clean = cleanDisplayText(value);
  if (clean.length <= max) {
    return { preview: clean, rest: '' };
  }

  const firstPass = clean.slice(0, max + 1);
  const lastSpace = firstPass.search(/\s\S*$/);
  const splitAt = lastSpace >= Math.floor(max * 0.75) ? lastSpace : max;
  const preview = clean.slice(0, splitAt).trimEnd();
  const rest = clean.slice(splitAt).trimStart();
  return { preview, rest };
}

function cleanDisplayText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
