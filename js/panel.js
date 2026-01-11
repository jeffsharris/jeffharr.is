/**
 * Slide-in Panel for expanded content exploration
 * Proactively fetches data on page load for instant panel opening
 */

(function() {
  'use strict';

  // DOM elements
  const panel = document.getElementById('panel');
  const panelOverlay = document.getElementById('panel-overlay');
  const panelClose = document.getElementById('panel-close');
  const panelTitle = document.getElementById('panel-title');
  const panelIcon = document.getElementById('panel-icon');
  const panelContent = document.getElementById('panel-content');
  const panelLink = document.getElementById('panel-link');
  const panelLinkText = document.getElementById('panel-link-text');
  const socialButtons = document.querySelectorAll('.social-btn[data-platform]');
  const VIEW_PARAM = 'view';

  // Platform configurations
  const platformConfig = {
    github: {
      title: 'GitHub',
      icon: '/images/github.png',
      linkText: 'GitHub',
      profileUrl: 'https://github.com/jeffsharris'
    },
    substack: {
      title: 'Substack',
      icon: '/images/substack.png',
      linkText: 'Substack',
      profileUrl: 'https://wakingpatiently.substack.com'
    },
    goodreads: {
      title: 'Goodreads',
      icon: '/images/goodreads.png',
      linkText: 'Goodreads',
      profileUrl: 'https://www.goodreads.com/user/show/2632308'
    },
    letterboxd: {
      title: 'Letterboxd',
      icon: '/images/letterboxd.svg',
      linkText: 'Letterboxd',
      profileUrl: 'https://letterboxd.com/jeffharris/'
    },
    poems: {
      title: 'Poems',
      icon: '/images/poems.svg',
      linkText: 'Poems',
      profileUrl: '/poems'
    },
    'read-later': {
      title: 'Read Later',
      icon: '/images/read-later.svg',
      linkText: 'Read Later',
      profileUrl: '/read-later'
    }
  };

  // Cache for API responses
  const cache = new Map();
  let currentPlatform = null;
  let latestRequestId = 0;

  // Proactively fetch all platform data on page load
  function prefetchAll() {
    const platforms = ['github', 'substack', 'goodreads', 'letterboxd', 'poems', 'read-later'];
    platforms.forEach(platform => {
      fetch(`/api/${platform}`)
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          if (data) cache.set(platform, data);
        })
        .catch(() => {}); // Silently fail, will retry on panel open
    });
  }

  // Read the platform from the URL (if valid)
  function getPlatformFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const platform = params.get(VIEW_PARAM);
    return platformConfig[platform] ? platform : null;
  }

  // Update the URL to include/remove the deep link
  function setDeepLink(platform, { replace = false } = {}) {
    const url = new URL(window.location.href);

    if (platform) {
      url.searchParams.set(VIEW_PARAM, platform);
      const method = replace ? 'replaceState' : 'pushState';
      history[method]({ panel: platform }, '', url.toString());
    } else {
      url.searchParams.delete(VIEW_PARAM);
      history.replaceState({ panel: null }, '', url.toString());
    }
  }

  // Open panel
  function openPanel(platform, options = {}) {
    const { skipHistory = false } = options;
    const config = platformConfig[platform];
    if (!config) return;

    const previousPlatform = currentPlatform;
    currentPlatform = platform;

    // Update header
    panelTitle.textContent = config.title;
    if (config.icon) {
      panelIcon.innerHTML = `<img src="${config.icon}" alt="" width="28" height="28">`;
    }

    // Update footer link
    panelLink.href = safeUrl(config.profileUrl);
    panelLinkText.textContent = config.linkText;

    // Check if data is already cached
    if (cache.has(platform)) {
      renderContent(platform, cache.get(platform));
    } else {
      // Show loading state and fetch
      panelContent.innerHTML = `
        <div class="panel-loading">
          <div class="panel-loading__dots">
            <span class="panel-loading__dot"></span>
            <span class="panel-loading__dot"></span>
            <span class="panel-loading__dot"></span>
          </div>
          <span>Loading...</span>
        </div>
      `;
      fetchContent(platform);
    }

    // Open panel
    document.body.classList.add('panel-open');
    panel.classList.add('is-open');
    panelOverlay.classList.add('is-visible');
    panel.setAttribute('aria-hidden', 'false');

    if (!skipHistory) {
      const replace = previousPlatform === platform;
      setDeepLink(platform, { replace });
    }
  }

  // Close panel
  function closePanel(options = {}) {
    const { skipHistory = false } = options;
    document.body.classList.remove('panel-open');
    panel.classList.remove('is-open');
    panelOverlay.classList.remove('is-visible');
    panel.setAttribute('aria-hidden', 'true');
    currentPlatform = null;

    if (!skipHistory) {
      setDeepLink(null);
    }
  }

  // Fetch content from API
  async function fetchContent(platform) {
    const requestId = ++latestRequestId;
    try {
      const response = await fetch(`/api/${platform}`);
      if (!response.ok) throw new Error('API request failed');
      const data = await response.json();
      cache.set(platform, data);
      if (currentPlatform === platform && requestId === latestRequestId) {
        renderContent(platform, data);
      }
    } catch (error) {
      console.error(`Failed to fetch ${platform}:`, error);
      if (currentPlatform === platform && requestId === latestRequestId) {
        panelContent.innerHTML = `
          <div class="panel-empty">
            <p>Unable to load content</p>
            <p>Visit the profile directly to see more.</p>
          </div>
        `;
      }
    }
  }

  // Render content based on platform
  function renderContent(platform, data) {
    if (data && data.profileUrl) {
      panelLink.href = safeUrl(data.profileUrl);
    }
    const isInlinePage = platform === 'poems' || platform === 'read-later';
    panelLink.target = isInlinePage ? '_self' : '_blank';
    if (platform === 'poems') {
      panelLink.removeAttribute('rel');
      panelLink.innerHTML = 'Browse <span id="panel-link-text">Poems</span> \u2192';
    } else if (platform === 'read-later') {
      panelLink.removeAttribute('rel');
      panelLink.innerHTML = 'View all <span id="panel-link-text">Read Later</span> \u2192';
    } else {
      panelLink.rel = 'noopener';
      panelLink.innerHTML = 'View on <span id="panel-link-text"></span> \u2192';
    }
    // Re-grab the span element after updating innerHTML
    const linkTextEl = document.getElementById('panel-link-text');
    if (platform === 'letterboxd' && data && (data.watchlistUrl || data.profileUrl)) {
      panelLink.href = safeUrl(data.watchlistUrl || data.profileUrl);
      if (linkTextEl) linkTextEl.textContent = data.watchlistUrl ? 'Letterboxd Watchlist' : 'Letterboxd';
    } else if (!isInlinePage) {
      if (linkTextEl) linkTextEl.textContent = platformConfig[platform]?.linkText || 'Link';
    }

    switch (platform) {
      case 'github':
        renderGitHub(data);
        break;
      case 'substack':
        renderSubstack(data);
        break;
      case 'goodreads':
        renderGoodreads(data);
        break;
      case 'letterboxd':
        renderLetterboxd(data);
        break;
      case 'poems':
        renderPoems(data);
        break;
      case 'read-later':
        renderReadLater(data);
        break;
      default:
        panelContent.innerHTML = '<div class="panel-empty">Content unavailable</div>';
    }
  }

  // GitHub content - recent commits
  function renderGitHub(data) {
    if (!data.commits || data.commits.length === 0) {
      panelContent.innerHTML = '<div class="panel-empty">No recent commits found</div>';
      return;
    }

    const html = `
      <div class="panel-section">
        <h4 class="panel-section__title">Recent Commits</h4>
        ${data.commits.map(commit => `
          <a href="${safeUrl(commit.url)}" target="_blank" rel="noopener" class="content-item content-item--commit">
            <div class="content-item__header">
              <span class="content-item__repo">${escapeHtml(commit.repo)}</span>
              <span class="content-item__meta">${formatDate(commit.date)}</span>
            </div>
            <p class="content-item__message">${escapeHtml(commit.message)}</p>
            <span class="content-item__sha">${escapeHtml(commit.sha)}</span>
          </a>
        `).join('')}
      </div>
    `;

    panelContent.innerHTML = html;
  }

  // Substack content
  function renderSubstack(data) {
    if (!data.posts || data.posts.length === 0) {
      panelContent.innerHTML = '<div class="panel-empty">No posts found</div>';
      return;
    }

    const html = `
      <div class="panel-section">
        <h4 class="panel-section__title">Recent Posts</h4>
        ${data.posts.map(post => `
          <a href="${safeUrl(post.url)}" target="_blank" rel="noopener" class="content-item">
            <div class="content-item__header">
              <h3 class="content-item__title">${escapeHtml(post.title)}</h3>
              ${post.date ? `<span class="content-item__meta">${formatDate(post.date)}</span>` : ''}
            </div>
            ${post.excerpt ? `<p class="content-item__description">${escapeHtml(post.excerpt)}</p>` : ''}
          </a>
        `).join('')}
      </div>
    `;

    panelContent.innerHTML = html;
  }

  // Goodreads content - currently reading + recently read
  function renderGoodreads(data) {
    let html = '';

    // Currently Reading section (if any)
    if (data.currentlyReading && data.currentlyReading.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Currently Reading</h4>
          ${data.currentlyReading.map(book => `
            <div class="content-item content-item--book">
              <h3 class="content-item__title">${escapeHtml(book.title)}</h3>
              ${book.author ? `<p class="content-item__author">by ${escapeHtml(book.author)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    // Recently Read section
    if (data.recentlyRead && data.recentlyRead.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Recently Read</h4>
          ${data.recentlyRead.map(book => `
            <div class="content-item content-item--book">
              <h3 class="content-item__title">${escapeHtml(book.title)}</h3>
              ${book.author ? `<p class="content-item__author">by ${escapeHtml(book.author)}</p>` : ''}
              ${book.rating ? `<span class="content-item__rating">${'★'.repeat(book.rating)}${'☆'.repeat(5 - book.rating)}</span>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    // Fallback for old API format
    if (!html && data.books && data.books.length > 0) {
      html = `
        <div class="panel-section">
          <h4 class="panel-section__title">${escapeHtml(data.shelf || 'Reading')}</h4>
          ${data.books.map(book => `
            <div class="content-item content-item--book">
              <h3 class="content-item__title">${escapeHtml(book.title)}</h3>
              ${book.author ? `<p class="content-item__author">by ${escapeHtml(book.author)}</p>` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    if (!html) {
      html = '<div class="panel-empty">No books found</div>';
    }

    panelContent.innerHTML = html;
  }

  // Letterboxd content - recently watched + watchlist
  function renderLetterboxd(data) {
    const entries = data.entries || [];
    const watchlist = data.watchlist || [];
    let html = '';

    if (entries.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Recently Watched</h4>
          <div class="film-grid">
            ${entries.slice(0, 5).map(entry => renderFilmCard(entry, { includeBlurb: false })).join('')}
          </div>
        </div>
      `;
    }

    if (watchlist.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Watchlist</h4>
          <div class="film-grid">
            ${watchlist.slice(0, 5).map(entry => renderFilmCard(entry, { includeBlurb: false })).join('')}
          </div>
        </div>
      `;
    }

    if (!html) {
      html = '<div class="panel-empty">No recent films found</div>';
    }

    panelContent.innerHTML = html;
  }

  // Poems content - quick summary
  function renderPoems(data) {
    const poems = (data.poems || []).slice(0, 10);

    if (!poems.length) {
      panelContent.innerHTML = '<div class="panel-empty">Poems are loading—visit the collection to explore them all.</div>';
      return;
    }

    const html = `
      <div class="panel-section">
        <h4 class="panel-section__title">Random Picks</h4>
        <div class="panel-list">
          ${poems.map(poem => `
            <a href="/poems?poem=${encodeURIComponent(poem.slug || '')}" class="content-item content-item--poem">
              <div class="content-item__header">
                <h3 class="content-item__title">${escapeHtml(poem.title)}</h3>
                ${poem.author ? `<span class="content-item__meta">${escapeHtml(poem.author)}</span>` : ''}
              </div>
              ${poem.excerpt ? `<p class="content-item__description">${escapeHtml(poem.excerpt)}</p>` : ''}
            </a>
          `).join('')}
        </div>
      </div>
    `;

    panelContent.innerHTML = html;
  }

  // Read Later content - saved and read items
  function renderReadLater(data) {
    const items = data.items || [];
    const unread = items.filter(item => !item.read).slice(0, 5);
    const read = items.filter(item => item.read).slice(0, 5);

    if (!items.length) {
      panelContent.innerHTML = '<div class="panel-empty">Nothing saved yet. Share a link to start your list.</div>';
      return;
    }

    let html = '';

    if (unread.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Recently Saved</h4>
          <div class="panel-list">
            ${unread.map(item => renderReadLaterItem(item)).join('')}
          </div>
        </div>
      `;
    }

    if (read.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Recently Read</h4>
          <div class="panel-list">
            ${read.map(item => renderReadLaterItem(item)).join('')}
          </div>
        </div>
      `;
    }

    panelContent.innerHTML = html;
  }

  function renderReadLaterItem(item) {
    const domain = formatDomain(item.url);
    const date = item.savedAt ? formatDate(item.savedAt) : '';
    return `
      <a href="${safeUrl(item.url)}" target="_blank" rel="noopener" class="content-item content-item--read-later">
        <div class="content-item__header">
          <h3 class="content-item__title">${escapeHtml(item.title || domain)}</h3>
          ${date ? `<span class="content-item__meta">${date}</span>` : ''}
        </div>
        <p class="content-item__description">${escapeHtml(domain)}</p>
      </a>
    `;
  }

  function formatDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'Unknown source';
    }
  }

  // Format date helper
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return '';
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 0) return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
  }

  function formatRating(rating) {
    if (!rating && rating !== 0) return '';
    const normalized = Math.min(Math.max(rating, 0), 5);
    const rounded = Math.round(normalized * 2) / 2;
    const fullStars = Math.floor(rounded);
    const halfStar = rounded % 1 !== 0;
    const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
    return `${'★'.repeat(fullStars)}${halfStar ? '½' : ''}${'☆'.repeat(Math.max(emptyStars, 0))}`;
  }

  function posterHtml(title, posterUrl) {
    const safePosterUrl = safeUrl(posterUrl, { fallback: '' });
    if (!safePosterUrl) {
      return `<div class="film-card__poster film-card__poster--placeholder">No Art</div>`;
    }
    return `<img src=\"${safePosterUrl}\" alt=\"${escapeHtml(title)} poster\" class=\"film-card__poster\">`;
  }

  function joinMeta(parts) {
    const cleanParts = parts
      .filter(Boolean)
      .map(part => `<span>${escapeHtml(part)}</span>`);
    if (!cleanParts.length) return '';
    return cleanParts.join('<span aria-hidden=\"true\">•</span>');
  }

  function renderFilmCard(entry, { includeBlurb = false } = {}) {
    const link = safeUrl(entry.link, { fallback: '' });
    const Wrapper = link ? 'a' : 'div';
    const attrs = link ? `href=\"${link}\" target=\"_blank\" rel=\"noopener\"` : '';
    const meta = joinMeta([entry.year, entry.watchedDate ? formatDate(entry.watchedDate) : null]);
    const rating = entry.rating ? `<span class=\"film-card__rating\">${formatRating(entry.rating)}</span>` : '';
    const blurb = includeBlurb && entry.blurb ? `<p class=\"film-card__blurb\">${escapeHtml(entry.blurb)}</p>` : '';

    return `
      <${Wrapper} class=\"film-card\" ${attrs}>
        ${posterHtml(entry.title || 'Film', entry.poster)}
        <div class=\"film-card__body\">
          <h3 class=\"film-card__title\">${escapeHtml(entry.title || 'Untitled')}</h3>
          <div class=\"film-card__meta\">
            ${meta}
            ${meta && rating ? '<span aria-hidden=\"true\">•</span>' : ''}
            ${rating}
          </div>
          ${blurb}
        </div>
      </${Wrapper}>
    `;
  }

  function safeUrl(url, { fallback = '#'} = {}) {
    if (!url) return fallback;
    try {
      const parsed = new URL(url, window.location.origin);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch {}
    return fallback;
  }

  // Event listeners
  socialButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const platform = btn.dataset.platform;
      openPanel(platform);
    });
  });

  panelClose.addEventListener('click', closePanel);
  panelOverlay.addEventListener('click', closePanel);

  // Escape key to close
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel.classList.contains('is-open')) {
      closePanel();
    }
  });

  // Keep panel state in sync with history navigation
  window.addEventListener('popstate', () => {
    const platform = getPlatformFromUrl();
    if (platform) {
      openPanel(platform, { skipHistory: true });
    } else {
      closePanel({ skipHistory: true });
    }
  });

  // Prefetch data on page load
  prefetchAll();

  // Open panel from deep link if present
  const initialPlatform = getPlatformFromUrl();
  if (initialPlatform) {
    openPanel(initialPlatform, { skipHistory: true });
  }

})();
