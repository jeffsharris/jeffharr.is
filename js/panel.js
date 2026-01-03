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
    x: {
      title: 'X',
      icon: null,
      linkText: 'X',
      profileUrl: 'https://x.com/jeffintime'
    },
    goodreads: {
      title: 'Goodreads',
      icon: '/images/goodreads.png',
      linkText: 'Goodreads',
      profileUrl: 'https://www.goodreads.com/user/show/2632308'
    }
  };

  // Cache for API responses
  const cache = new Map();
  let currentPlatform = null;

  // Proactively fetch all platform data on page load
  function prefetchAll() {
    const platforms = ['github', 'substack', 'goodreads'];
    platforms.forEach(platform => {
      fetch(`/api/${platform}`)
        .then(response => response.ok ? response.json() : null)
        .then(data => {
          if (data) cache.set(platform, data);
        })
        .catch(() => {}); // Silently fail, will retry on panel open
    });
    // X doesn't need fetching - it's static profile data
    cache.set('x', {
      handle: '@jeffintime',
      name: 'Jeff Harris',
      profileUrl: 'https://x.com/jeffintime',
      profileImageUrl: '/images/profile.jpg'
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
    } else if (platform === 'x') {
      panelIcon.innerHTML = `
        <svg width="28" height="28" viewBox="0 0 40 40" fill="currentColor">
          <rect width="40" height="40" rx="6" fill="currentColor" fill-opacity="0.08"/>
          <path d="M23.5 18.3L30 11H28.2L22.7 17.1L18.3 11H12.5L19.3 21.5L12.5 29H14.3L20.1 22.7L24.7 29H30.5L23.5 18.3ZM21 21.8L20.2 20.7L14.9 12.2H17.5L21.7 18L22.5 19.1L28.2 27.9H25.6L21 21.8Z" fill="currentColor"/>
        </svg>
      `;
    }

    // Update footer link
    panelLink.href = config.profileUrl;
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
    try {
      const response = await fetch(`/api/${platform}`);
      if (!response.ok) throw new Error('API request failed');
      const data = await response.json();
      cache.set(platform, data);
      renderContent(platform, data);
    } catch (error) {
      console.error(`Failed to fetch ${platform}:`, error);
      panelContent.innerHTML = `
        <div class="panel-empty">
          <p>Unable to load content</p>
          <p>Visit the profile directly to see more.</p>
        </div>
      `;
    }
  }

  // Render content based on platform
  function renderContent(platform, data) {
    switch (platform) {
      case 'github':
        renderGitHub(data);
        break;
      case 'substack':
        renderSubstack(data);
        break;
      case 'x':
        renderX(data);
        break;
      case 'goodreads':
        renderGoodreads(data);
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
          <a href="${commit.url}" target="_blank" rel="noopener" class="content-item content-item--commit">
            <div class="content-item__header">
              <span class="content-item__repo">${commit.repo}</span>
              <span class="content-item__meta">${formatDate(commit.date)}</span>
            </div>
            <p class="content-item__message">${escapeHtml(commit.message)}</p>
            <span class="content-item__sha">${commit.sha}</span>
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
          <a href="${post.url || '#'}" target="_blank" rel="noopener" class="content-item">
            <div class="content-item__header">
              <h3 class="content-item__title">${post.title}</h3>
              ${post.date ? `<span class="content-item__meta">${formatDate(post.date)}</span>` : ''}
            </div>
            ${post.excerpt ? `<p class="content-item__description">${post.excerpt}</p>` : ''}
          </a>
        `).join('')}
      </div>
    `;

    panelContent.innerHTML = html;
  }

  // X (Twitter) content - profile card only
  function renderX(data) {
    const html = `
      <div class="x-profile-card">
        <div class="x-profile-card__header">
          <img src="${data.profileImageUrl || '/images/profile.jpg'}" alt="${data.name || 'Profile'}" class="x-profile-card__avatar">
          <div class="x-profile-card__info">
            <h3 class="x-profile-card__name">${data.name || 'Jeff Harris'}</h3>
            <p class="x-profile-card__handle">${data.handle || '@jeffintime'}</p>
          </div>
        </div>
        <div class="x-profile-card__cta">
          <p>Follow me on X to see my posts and thoughts.</p>
        </div>
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
              <h3 class="content-item__title">${book.title}</h3>
              ${book.author ? `<p class="content-item__author">by ${book.author}</p>` : ''}
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
              <h3 class="content-item__title">${book.title}</h3>
              ${book.author ? `<p class="content-item__author">by ${book.author}</p>` : ''}
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
          <h4 class="panel-section__title">${data.shelf || 'Reading'}</h4>
          ${data.books.map(book => `
            <div class="content-item content-item--book">
              <h3 class="content-item__title">${book.title}</h3>
              ${book.author ? `<p class="content-item__author">by ${book.author}</p>` : ''}
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

  // Format date helper
  function formatDate(dateStr) {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays}d ago`;
    if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
    if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
    return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  // Escape HTML to prevent XSS
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
