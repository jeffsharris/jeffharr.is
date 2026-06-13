(function() {
  'use strict';

  const grid = document.querySelector('[data-lately-grid]');
  if (!grid) return;
  const section = grid.closest('.section');

  const MAX_ITEMS = 12;
  const MAX_PER_BUCKET = 2;
  const HEATMAP_WEEKS = 26;

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

    const githubItem = normalizeGithubSummary(github);
    const buckets = [
      normalizeFinishedBooks(goodreads),
      normalizeReadingBooks(goodreads),
      normalizeWatchedFilms(letterboxd),
      normalizeWatchlistFilms(letterboxd),
      normalizeSavedItems(readLater),
      githubItem ? [githubItem] : [],
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

  function normalizeGithubSummary(data) {
    const contributions = data?.contributions;
    const rawCommits = Array.isArray(data?.commits) ? data.commits : [];
    const recentCommits = rawCommits.slice(0, 2).map(commit => ({
      message: commit.message || 'Recent commit',
      repo: commit.repo || 'jeffsharris',
      sha: commit.sha || '',
      meta: [commit.repo, commit.sha, relativeTime(commit.date)].filter(Boolean).join(' · '),
      url: commit.url || data?.profileUrl || PROFILE_LINKS[0][1],
      publishedAt: commit.date || ''
    }));
    const latestCommit = recentCommits[0] || null;
    const hasHeatmap = contributions && Array.isArray(contributions.days) && contributions.days.length;
    if (!hasHeatmap && !latestCommit) return null;

    const days = hasHeatmap ? alignHeatmapDays(contributions.days, HEATMAP_WEEKS) : [];
    const total = contributions?.totalContributions;
    const caption = total
      ? `${total.toLocaleString()} contributions in the last year`
      : hasHeatmap ? 'Recent contributions' : '';

    return {
      type: 'github',
      label: 'Building',
      source: 'github',
      sourceLabel: 'GitHub',
      title: latestCommit?.message || 'GitHub activity',
      commits: recentCommits,
      days,
      caption,
      url: latestCommit?.url || data?.profileUrl || PROFILE_LINKS[0][1],
      publishedAt: latestCommit?.publishedAt || contributions?.rangeEnd || ''
    };
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
      let html;
      if (item.type === 'github') html = renderGithubCard(item);
      else if (item.type === 'tweet') html = renderTextCard(item);
      else html = renderMediaCard(item);
      template.innerHTML = html;
      fragment.append(template.content.firstElementChild);
    });
    grid.replaceChildren(fragment);
    renderProfileLinks();
  }

  function renderMediaCard(item) {
    const imageUrl = safeImageUrl(item.image);
    const credit = [item.label, item.byline].filter(Boolean).join(' · ');
    return `
      <a class="lately-card lately-card--media lately-card--${escapeAttr(item.source)}" data-lately-type="${escapeAttr(item.type)}" href="${escapeAttr(safeUrl(item.url))}" target="_blank" rel="noopener">
        <div class="lately-card__media">
          ${imageUrl
            ? `<img src="${escapeAttr(imageUrl)}" alt="" loading="lazy" decoding="async">`
            : `<span class="lately-card__placeholder" aria-hidden="true">${escapeHtml(initials(item.title))}</span>`}
        </div>
        <div class="lately-card__body">
          <h3 class="lately-card__title">${escapeHtml(item.title)}</h3>
          ${credit ? `<div class="lately-card__credit">${escapeHtml(credit)}</div>` : ''}
          ${item.rating ? `<div class="lately-card__rating" aria-label="${escapeAttr(`${item.rating} out of 5`)}">${escapeHtml(formatRating(item.rating))}</div>` : ''}
        </div>
      </a>
    `;
  }

  function renderTextCard(item) {
    // tweets only — github now uses renderGithubCard
    return `
      <a class="lately-card lately-card--text lately-card--x" data-lately-type="tweet" href="${escapeAttr(safeUrl(item.url, { fallback: PROFILE_LINKS[3][1] }))}" target="_blank" rel="noopener">
        <article class="lately-text-card">
          <div class="lately-text-card__topline">
            <span class="lately-text-card__handle">${escapeHtml(item.handle)}</span>
            ${item.detail ? `<span class="lately-text-card__detail">${escapeHtml(item.detail)}</span>` : ''}
          </div>
          <p class="lately-text-card__body">${escapeHtml(item.body)}</p>
        </article>
      </a>
    `;
  }

  function renderGithubCard(item) {
    const cells = item.days.length
      ? `<div class="lately-heatmap" role="img" aria-label="${escapeAttr(item.caption || 'GitHub contributions')}">${
          item.days
            .map(day => day.blank
              ? '<span class="lately-heatmap__cell lately-heatmap__cell--blank" aria-hidden="true"></span>'
              : `<span class="lately-heatmap__cell" data-level="${escapeAttr(String(day.level))}" title="${escapeAttr(day.date)}"></span>`)
            .join('')
        }</div>`
      : '';
    const caption = item.caption
      ? `<div class="lately-github__caption">${escapeHtml(item.caption)}</div>`
      : '';
    const commitsList = Array.isArray(item.commits) && item.commits.length
      ? `<ul class="lately-github__commits">${
          item.commits.map(commit => `
            <li class="lately-github__commit">
              <span class="lately-github__commit-message">${escapeHtml(commit.message)}</span>
              ${commit.meta ? `<span class="lately-github__commit-meta">${escapeHtml(commit.meta)}</span>` : ''}
            </li>
          `).join('')
        }</ul>`
      : '';
    return `
      <a class="lately-card lately-card--github lately-card--github-summary" data-lately-type="github" href="${escapeAttr(safeUrl(item.url, { fallback: PROFILE_LINKS[0][1] }))}" target="_blank" rel="noopener">
        <article class="lately-github-card">
          ${cells}
          ${caption}
          ${commitsList}
        </article>
      </a>
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
    if (item?.id && item?.cover?.updatedAt) {
      const url = new URL('/api/read-later/cover', window.location.origin);
      url.searchParams.set('id', item.id);
      url.searchParams.set('v', item.cover.updatedAt);
      return url.toString();
    }
    if (item?.thumbnailUrl) return item.thumbnailUrl;
    const youtubeInfo = getYouTubeInfo(item?.url || '');
    return youtubeInfo?.videoId
      ? `https://img.youtube.com/vi/${encodeURIComponent(youtubeInfo.videoId)}/hqdefault.jpg`
      : '';
  }

  function getYouTubeInfo(url) {
    if (typeof url !== 'string') return null;
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(hostname)) {
      return null;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    let videoId = null;
    if (hostname === 'youtu.be') {
      videoId = normalizeYouTubeId(segments[0]);
    } else {
      const first = segments[0] || '';
      if (first === 'shorts' || first === 'embed' || first === 'v' || first === 'live') {
        videoId = normalizeYouTubeId(segments[1]);
      } else {
        videoId = normalizeYouTubeId(parsed.searchParams.get('v'));
      }
    }

    return videoId ? { videoId } : null;
  }

  function normalizeYouTubeId(value) {
    if (!value) return null;
    const candidate = String(value).split(/[?#&/]/)[0];
    return /^[a-zA-Z0-9_-]{11}$/.test(candidate) ? candidate : null;
  }

  function alignHeatmapDays(allDays, weeks) {
    if (!Array.isArray(allDays) || !allDays.length) return [];
    const totalCells = weeks * 7;
    const lastDate = new Date(`${allDays[allDays.length - 1].date}T00:00:00Z`);
    if (Number.isNaN(lastDate.getTime())) return allDays.slice(-totalCells);
    // Pad trailing days so the last column ends on Saturday
    const trailingPad = 6 - lastDate.getUTCDay();
    const recent = allDays.slice(-(totalCells - trailingPad));
    // Pad leading days so the first column starts on Sunday
    const firstDate = new Date(`${recent[0].date}T00:00:00Z`);
    const leadingPad = Number.isNaN(firstDate.getTime()) ? 0 : firstDate.getUTCDay();
    const blanks = (n) => Array.from({ length: Math.max(0, n) }, () => ({ date: '', level: 0, blank: true }));
    const padded = [...blanks(leadingPad), ...recent, ...blanks(trailingPad)];
    // Trim or extend to exactly weeks*7
    if (padded.length > totalCells) return padded.slice(padded.length - totalCells);
    if (padded.length < totalCells) return [...blanks(totalCells - padded.length), ...padded];
    return padded;
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
