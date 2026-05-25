(function() {
  'use strict';

  const grid = document.querySelector('[data-lately-grid]');
  if (!grid) return;
  const section = grid.closest('.section');

  const MAX_ITEMS = 12;
  const MAX_PER_BUCKET = 2;

  const SOURCES = {
    goodreads: '/api/goodreads',
    letterboxd: '/api/letterboxd',
    github: '/api/github',
    readLater: '/api/read-later',
    x: '/api/x'
  };

  const PROFILE_LINKS = [
    ['GitHub', 'https://github.com/jeffsharris'],
    ['Letterboxd', 'https://letterboxd.com/jeffharris/'],
    ['Goodreads', 'https://www.goodreads.com/user/show/2632308'],
    ['X', 'https://x.com/jeffintime']
  ];

  async function init() {
    const [goodreads, letterboxd, github, readLater, x] = await Promise.all([
      fetchJson(SOURCES.goodreads),
      fetchJson(SOURCES.letterboxd),
      fetchJson(SOURCES.github),
      fetchJson(SOURCES.readLater),
      fetchJson(SOURCES.x)
    ]);

    const buckets = [
      normalizeFinishedBooks(goodreads),
      normalizeReadingBooks(goodreads),
      normalizeWatchedFilms(letterboxd),
      normalizeWatchlistFilms(letterboxd),
      normalizeSavedItems(readLater),
      normalizeCommits(github),
      normalizeTweets(x)
    ];

    render(pickBalancedItems(buckets, MAX_ITEMS));
  }

  async function fetchJson(url) {
    try {
      const response = await fetch(url, {
        headers: { accept: 'application/json' },
        cache: 'default'
      });
      if (!response.ok) return null;
      return response.json();
    } catch {
      return null;
    }
  }

  function normalizeFinishedBooks(data) {
    const books = Array.isArray(data?.recentlyRead) ? data.recentlyRead : [];
    return books.map(book => ({
      type: 'book',
      label: 'Read',
      source: 'goodreads',
      sourceLabel: 'Goodreads',
      title: book.title || 'Untitled book',
      byline: book.author || '',
      rating: book.rating,
      image: book.image || book.cover || book.imageUrl || '',
      url: book.url || data?.profileUrl || PROFILE_LINKS[2][1],
      publishedAt: book.publishedAt || book.pubDate || book.readAt || ''
    }));
  }

  function normalizeReadingBooks(data) {
    const books = Array.isArray(data?.currentlyReading) ? data.currentlyReading : [];
    return books.map(book => ({
      type: 'book',
      label: 'Reading',
      source: 'goodreads',
      sourceLabel: 'Goodreads',
      title: book.title || 'Untitled book',
      byline: book.author || '',
      image: book.image || book.cover || book.imageUrl || '',
      url: book.url || data?.profileUrl || PROFILE_LINKS[2][1],
      publishedAt: book.publishedAt || book.pubDate || ''
    }));
  }

  function normalizeWatchedFilms(data) {
    const films = Array.isArray(data?.entries) ? data.entries : [];
    return films.map(film => ({
      type: 'film',
      label: 'Watched',
      source: 'letterboxd',
      sourceLabel: 'Letterboxd',
      title: film.title || 'Untitled film',
      byline: film.year || '',
      rating: film.rating,
      image: film.poster || '',
      url: film.link || data?.profileUrl || PROFILE_LINKS[1][1],
      publishedAt: film.watchedDate || film.publishedAt || ''
    }));
  }

  function normalizeWatchlistFilms(data) {
    const films = Array.isArray(data?.watchlist) ? data.watchlist : [];
    return films.map(film => ({
      type: 'film',
      label: 'Watchlist',
      source: 'letterboxd',
      sourceLabel: 'Letterboxd',
      title: film.title || 'Untitled film',
      byline: film.year || '',
      image: film.poster || '',
      url: film.link || data?.watchlistUrl || data?.profileUrl || PROFILE_LINKS[1][1],
      publishedAt: film.publishedAt || film.addedAt || ''
    }));
  }

  function normalizeSavedItems(data) {
    const items = Array.isArray(data?.items) ? data.items : [];
    const unread = items.filter(item => !item.read);
    const saved = unread.length ? unread : items;
    return saved.map(item => ({
      type: 'saved',
      label: 'Saved',
      source: 'read-later',
      sourceLabel: 'Read Later',
      title: item.title || 'Saved item',
      byline: item.publisher || item.author || '',
      image: readLaterCoverUrl(item),
      url: item.url || '/read-later/',
      publishedAt: item.savedAt || ''
    }));
  }

  function normalizeCommits(data) {
    const commits = Array.isArray(data?.commits) ? data.commits : [];
    return commits.map(commit => ({
      type: 'commit',
      label: 'Commit',
      source: 'github',
      sourceLabel: 'GitHub',
      repo: commit.repo || 'jeffsharris',
      title: commit.message || 'Recent commit',
      detail: [commit.sha, relativeTime(commit.date)].filter(Boolean).join(' · '),
      url: commit.url || data?.profileUrl || PROFILE_LINKS[0][1],
      publishedAt: commit.date || ''
    }));
  }

  function normalizeTweets(data) {
    const tweets = Array.isArray(data?.tweets) ? data.tweets : [];
    const handle = data?.handle || '@jeffintime';
    return tweets.map(tweet => ({
      type: 'tweet',
      label: 'Post',
      source: 'x',
      sourceLabel: 'X',
      handle,
      body: tweet.text || tweet.body || '',
      image: tweet.media?.[0]?.url || tweet.media?.[0]?.preview_image_url || '',
      detail: relativeTime(tweet.publishedAt || tweet.created_at),
      url: tweet.url || `https://x.com/jeffintime/status/${encodeURIComponent(tweet.id || '')}`,
      publishedAt: tweet.publishedAt || tweet.created_at || ''
    })).filter(tweet => tweet.body || tweet.image);
  }

  function pickBalancedItems(buckets, maxItems) {
    const queues = buckets
      .map(bucket => bucket
        .slice()
        .sort(sortByPublishedAt)
        .slice(0, MAX_PER_BUCKET))
      .filter(bucket => bucket.length);

    const result = [];
    for (let index = 0; index < MAX_PER_BUCKET && result.length < maxItems; index++) {
      const round = queues
        .map(bucket => bucket[index])
        .filter(Boolean)
        .sort(sortByPublishedAt);

      for (const item of round) {
        if (result.length >= maxItems) break;
        result.push(item);
      }
    }
    return result;
  }

  function render(items) {
    if (!items.length) {
      grid.replaceChildren();
      setProfileLinksVisible(false);
      if (section) section.hidden = true;
      return;
    }

    if (section) section.hidden = false;
    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const template = document.createElement('template');
      template.innerHTML = item.type === 'commit' || item.type === 'tweet'
        ? renderTextCard(item)
        : renderMediaCard(item);
      fragment.append(template.content.firstElementChild);
    });
    grid.replaceChildren(fragment);
    renderProfileLinks();
  }

  function renderMediaCard(item) {
    const imageUrl = safeImageUrl(item.image);
    return `
      <a class="lately-card lately-card--media lately-card--${escapeAttr(item.source)}" data-lately-type="${escapeAttr(item.type)}" href="${escapeAttr(safeUrl(item.url))}" target="_blank" rel="noopener">
        <div class="lately-card__media">
          ${imageUrl
            ? `<img src="${escapeAttr(imageUrl)}" alt="" loading="lazy" decoding="async">`
            : `<span class="lately-card__placeholder" aria-hidden="true">${escapeHtml(initials(item.title))}</span>`}
        </div>
        <div class="lately-card__body">
          ${renderItemLabel(item)}
          <h3 class="lately-card__title">${escapeHtml(item.title)}</h3>
          ${item.byline ? `<div class="lately-card__byline">${escapeHtml(item.byline)}</div>` : ''}
          ${item.rating ? `<div class="lately-card__rating" aria-label="${escapeAttr(`${item.rating} out of 5`)}">${escapeHtml(formatRating(item.rating))}</div>` : ''}
        </div>
      </a>
    `;
  }

  function renderTextCard(item) {
    if (item.type === 'tweet') {
      return `
        <a class="lately-card lately-card--text lately-card--x" data-lately-type="tweet" href="${escapeAttr(safeUrl(item.url, { fallback: PROFILE_LINKS[3][1] }))}" target="_blank" rel="noopener">
          <article class="lately-text-card">
            <div class="lately-text-card__topline">
              ${renderItemLabel(item)}
              <span class="lately-text-card__detail">${escapeHtml(item.detail || '')}</span>
            </div>
            <p class="lately-text-card__body">${escapeHtml(item.body)}</p>
          </article>
        </a>
      `;
    }

    return `
      <a class="lately-card lately-card--text lately-card--github" data-lately-type="commit" href="${escapeAttr(safeUrl(item.url, { fallback: PROFILE_LINKS[0][1] }))}" target="_blank" rel="noopener">
        <article class="lately-text-card">
          <div class="lately-text-card__topline">
            ${renderItemLabel(item)}
          </div>
          <div class="lately-text-card__repo">${escapeHtml(item.repo)}</div>
          <h3 class="lately-text-card__title">${escapeHtml(item.title)}</h3>
          ${item.detail ? `<div class="lately-text-card__detail">${escapeHtml(item.detail)}</div>` : ''}
        </article>
      </a>
    `;
  }

  function renderItemLabel(item) {
    return `
      <div class="lately-card__label">
        <span>${escapeHtml(item.label)}</span>
      </div>
    `;
  }

  function renderProfileLinks() {
    let nav = section?.querySelector('[data-lately-links]');
    if (!nav) {
      nav = document.createElement('nav');
      nav.className = 'elsewhere lately-links';
      nav.dataset.latelyLinks = '';
      nav.setAttribute('aria-label', 'More recent activity');
      grid.after(nav);
    }

    nav.innerHTML = `
      ${PROFILE_LINKS.map(([label, url], index) => `
        ${index ? '<span class="elsewhere__dot" aria-hidden="true"></span>' : ''}
        <a href="${escapeAttr(url)}" target="_blank" rel="noopener">${escapeHtml(label)}</a>
      `).join('')}
    `;
    nav.hidden = false;
  }

  function setProfileLinksVisible(visible) {
    const nav = section?.querySelector('[data-lately-links]');
    if (nav) nav.hidden = !visible;
  }

  function readLaterCoverUrl(item) {
    if (item?.coverPreview) return `data:image/png;base64,${item.coverPreview}`;
    if (!item?.id || !item?.cover?.updatedAt) return '';
    const url = new URL('/api/read-later/cover', window.location.origin);
    url.searchParams.set('id', item.id);
    url.searchParams.set('v', item.cover.updatedAt);
    return url.toString();
  }

  function sortByPublishedAt(a, b) {
    return dateValue(b.publishedAt) - dateValue(a.publishedAt);
  }

  function dateValue(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? time : 0;
  }

  function relativeTime(value) {
    const then = dateValue(value);
    if (!then) return '';
    const diffMs = Date.now() - then;
    const diffDays = Math.floor(diffMs / 86400000);
    if (diffDays <= 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) return pluralize(Math.floor(diffDays / 7), 'week');
    if (diffDays < 365) return pluralize(Math.floor(diffDays / 30), 'month');
    return pluralize(Math.floor(diffDays / 365), 'year');
  }

  function pluralize(count, unit) {
    return `${count} ${unit}${count === 1 ? '' : 's'} ago`;
  }

  function formatRating(rating) {
    const value = Number(rating);
    if (!Number.isFinite(value) || value <= 0) return '';
    const rounded = Math.round(Math.min(value, 5) * 2) / 2;
    const full = Math.floor(rounded);
    const half = rounded % 1 !== 0;
    return `${'★'.repeat(full)}${half ? '½' : ''}`;
  }

  function initials(value) {
    return String(value || '')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(word => word.charAt(0).toUpperCase())
      .join('');
  }

  function safeUrl(url, { fallback = '#' } = {}) {
    if (!url) return fallback;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch {}
    return fallback;
  }

  function safeImageUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:' || parsed.protocol === 'data:') {
        return parsed.href;
      }
    } catch {}
    return '';
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, '&#096;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
