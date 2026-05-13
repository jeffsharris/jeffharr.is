const PLATFORM_ORDER = [
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
  apple: 'Apple Podcasts',
  spotify: 'Spotify',
  youtube: 'YouTube',
  overcast: 'Overcast',
  pocketCasts: 'Pocket Casts',
  antennaPod: 'AntennaPod',
  rss: 'RSS Feed',
  website: 'Website'
};

export function renderSharePage(item, requestUrl) {
  const shareUrl = new URL(`/share/${item.id}`, requestUrl).href;
  const title = item.title || 'Shared podcast';
  const description = truncate(item.description || item.podcast?.description || 'A shared podcast link from jeffharr.is.', 220);
  const imageUrl = item.imageUrl || item.podcast?.imageUrl || 'https://jeffharr.is/images/profile.jpg';
  const audioUrl = item.media?.audioUrl || '';
  const isEpisode = item.type === 'podcast_episode';

  return htmlDocument({
    title: `${title} | Jeff Harris`,
    description,
    imageUrl,
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
            <div class="platform-list" data-platform-list>
              ${renderPlatformLinks(item.platforms || {})}
            </div>
            ${audioUrl ? `
              <div class="share-player">
                <audio controls preload="metadata" src="${escapeAttribute(audioUrl)}"></audio>
              </div>
            ` : ''}
            <p class="share-description">${escapeHtml(description)}</p>
            <div class="share-actions">
              <button class="secondary-btn" type="button" data-copy="${escapeAttribute(shareUrl)}">Copy share link</button>
              ${item.podcast?.feedUrl ? `<button class="secondary-btn" type="button" data-copy="${escapeAttribute(item.podcast.feedUrl)}">Copy RSS</button>` : ''}
            </div>
          </div>
        </article>
      </main>
      <script src="/share-assets/share.js?v=2"></script>
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
          <strong>${escapeHtml(item.title || 'Untitled share')}</strong>
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

  return htmlDocument({
    title: 'Creating Share Link | Jeff Harris',
    description: 'Finding podcast metadata and app links.',
    imageUrl: 'https://jeffharr.is/images/profile.jpg',
    url: requestUrl,
    noindex: true,
    body: `
      <header class="share-header">
        <a class="back-link" href="/share">Share</a>
      </header>
      <main class="share-main share-main--loading">
        <section class="share-card loading-card" data-share-loader data-source-url="${escapeAttribute(sourceUrl)}">
          <div class="loading-mark" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="share-content loading-content">
            <p class="share-kicker">Resolving</p>
            <h1>Building share page</h1>
            <p class="share-description" data-loading-status>Finding the episode, artwork, audio, and app links.</p>
            <ol class="loading-steps" aria-label="Share creation progress">
              <li data-loading-step="0" class="is-active">Reading shared URL</li>
              <li data-loading-step="1">Finding podcast feed</li>
              <li data-loading-step="2">Matching the episode</li>
              <li data-loading-step="3">Checking listening apps</li>
              <li data-loading-step="4">Opening share page</li>
            </ol>
            <a class="secondary-btn loading-fallback" href="${escapeAttribute(resolveUrl.href)}">Continue without loading screen</a>
          </div>
        </section>
      </main>
      <script src="/share-assets/share.js?v=2"></script>
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

function htmlDocument({ title, description, imageUrl, url, body, noindex }) {
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
  <link rel="canonical" href="${escapeAttribute(url)}">
  <link rel="icon" href="/share-assets/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="manifest" href="/share-assets/manifest.webmanifest">
  <link rel="stylesheet" href="/share-assets/share.css?v=1">
</head>
<body>
  <div class="bg-gradient"></div>
  <div class="bg-noise"></div>
  ${body}
</body>
</html>`;
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
        <span>${escapeHtml(platform.label || PLATFORM_NAMES[key] || key)}</span>
        <small>${escapeHtml(platform.kind === 'rss' ? 'Subscribe by feed' : platform.kind === 'website' ? 'Open original site' : platform.kind === 'episode' ? 'Open episode' : 'Open podcast')}</small>
      </a>
    `).join('');
}

function formatMeta(item) {
  return [
    item.publishedAt ? formatDate(item.publishedAt) : '',
    item.media?.duration || ''
  ].filter(Boolean).join(' · ');
}

function formatHistoryMeta(item) {
  return [
    item.type === 'podcast_episode' ? 'Podcast episode' : item.type === 'podcast_show' ? 'Podcast' : 'Shared link',
    item.sharedAt ? formatDate(item.sharedAt) : ''
  ].filter(Boolean).join(' · ');
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function truncate(value, max) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
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
