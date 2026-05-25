(function() {
  'use strict';

  const grid = document.querySelector('[data-lately-grid]');
  if (!grid) return;
  const section = grid.closest('.section');

  const SOURCES = {
    goodreads: '/api/goodreads',
    letterboxd: '/api/letterboxd',
    github: '/api/github',
    x: '/api/x'
  };

  async function init() {
    const [goodreads, letterboxd, github, x] = await Promise.all([
      fetchJson(SOURCES.goodreads),
      fetchJson(SOURCES.letterboxd),
      fetchJson(SOURCES.github),
      fetchJson(SOURCES.x)
    ]);

    const books = normalizeBooks(goodreads).slice(0, 2);
    const films = normalizeFilms(letterboxd).slice(0, 2);
    const textItems = [
      ...normalizeCommits(github),
      ...normalizeTweets(x)
    ].sort(sortByPublishedAt).slice(0, 2);

    const overflow = [
      ...normalizeBooks(goodreads).slice(2),
      ...normalizeFilms(letterboxd).slice(2),
      ...normalizeCommits(github).slice(2),
      ...normalizeTweets(x).slice(2)
    ].sort(sortByPublishedAt);

    const slots = compact([
      books[0],
      films[0],
      textItems[0],
      textItems[1],
      books[1],
      films[1]
    ]);

    while (slots.length < 6 && overflow.length) {
      slots.push(overflow.shift());
    }

    render(slots.slice(0, 6));
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

  function normalizeBooks(data) {
    const books = Array.isArray(data?.recentlyRead) ? data.recentlyRead : [];
    return books.map(book => ({
      type: 'book',
      source: 'goodreads',
      monogram: 'g',
      title: book.title || 'Untitled book',
      byline: book.author || '',
      rating: book.rating,
      image: book.image || book.cover || book.imageUrl || '',
      url: book.url || data?.profileUrl || 'https://www.goodreads.com/user/show/2632308',
      publishedAt: book.publishedAt || book.pubDate || book.readAt || ''
    }));
  }

  function normalizeFilms(data) {
    const films = Array.isArray(data?.entries) ? data.entries : [];
    return films.map(film => ({
      type: 'film',
      source: 'letterboxd',
      monogram: 'l',
      title: film.title || 'Untitled film',
      byline: film.year || '',
      rating: film.rating,
      image: film.poster || '',
      url: film.link || data?.profileUrl || 'https://letterboxd.com/jeffharris/',
      publishedAt: film.watchedDate || film.publishedAt || ''
    }));
  }

  function normalizeCommits(data) {
    const commits = Array.isArray(data?.commits) ? data.commits : [];
    return commits.map(commit => ({
      type: 'commit',
      source: 'github',
      monogram: 'h',
      repo: commit.repo || 'jeffsharris',
      title: commit.message || 'Recent commit',
      detail: [commit.sha, relativeTime(commit.date)].filter(Boolean).join(' · '),
      url: commit.url || data?.profileUrl || 'https://github.com/jeffsharris',
      publishedAt: commit.date || ''
    }));
  }

  function normalizeTweets(data) {
    const tweets = Array.isArray(data?.tweets) ? data.tweets : [];
    return tweets.map(tweet => ({
      type: 'tweet',
      source: 'x',
      monogram: 'x',
      handle: '@jeffintime',
      body: tweet.text || tweet.body || '',
      image: tweet.media?.[0]?.url || tweet.media?.[0]?.preview_image_url || '',
      detail: relativeTime(tweet.publishedAt || tweet.created_at),
      url: tweet.url || `https://x.com/jeffintime/status/${encodeURIComponent(tweet.id || '')}`,
      publishedAt: tweet.publishedAt || tweet.created_at || ''
    })).filter(tweet => tweet.body || tweet.image);
  }

  function render(items) {
    if (!items.length) {
      grid.replaceChildren();
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
  }

  function renderMediaCard(item) {
    const label = item.type === 'book' ? 'Goodreads' : 'Letterboxd';
    return `
      <a class="lately-card lately-card--media lately-card--${escapeAttr(item.source)}" href="${escapeAttr(safeUrl(item.url))}" target="_blank" rel="noopener">
        <div class="lately-card__media">
          ${item.image
            ? `<img src="${escapeAttr(safeUrl(item.image, { fallback: '' }))}" alt="" loading="lazy" decoding="async">`
            : `<span class="lately-card__placeholder" aria-hidden="true">${escapeHtml(initials(item.title))}</span>`}
          <span class="lately-card__source" title="${label}" aria-label="${label}">${escapeHtml(item.monogram)}</span>
        </div>
        <div class="lately-card__body">
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
        <a class="lately-card lately-card--text lately-card--x" href="${escapeAttr(safeUrl(item.url, { fallback: 'https://x.com/jeffintime' }))}" target="_blank" rel="noopener">
          <article class="lately-text-card">
            <div class="lately-text-card__topline">
              <span class="lately-text-card__handle">${escapeHtml([item.handle, item.detail].filter(Boolean).join(' · '))}</span>
              <span class="lately-card__source" title="X" aria-label="X">x</span>
            </div>
            <p class="lately-text-card__body">${escapeHtml(item.body)}</p>
          </article>
        </a>
      `;
    }

    return `
      <a class="lately-card lately-card--text lately-card--github" href="${escapeAttr(safeUrl(item.url, { fallback: 'https://github.com/jeffsharris' }))}" target="_blank" rel="noopener">
        <article class="lately-text-card">
          <div class="lately-text-card__topline">
            <span class="lately-text-card__repo">${escapeHtml(item.repo)}</span>
            <span class="lately-card__source" title="GitHub" aria-label="GitHub">h</span>
          </div>
          <h3 class="lately-text-card__title">${escapeHtml(item.title)}</h3>
          ${item.detail ? `<div class="lately-text-card__detail">${escapeHtml(item.detail)}</div>` : ''}
        </article>
      </a>
    `;
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
    if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
    return `${Math.floor(diffDays / 365)} years ago`;
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

  function compact(items) {
    return items.filter(Boolean);
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
