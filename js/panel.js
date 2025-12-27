/**
 * Slide-in Panel for expanded content exploration
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
      icon: null, // Uses inline SVG
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

  // Open panel
  function openPanel(platform) {
    const config = platformConfig[platform];
    if (!config) return;

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

    // Show loading state
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

    // Open panel
    document.body.classList.add('panel-open');
    panel.classList.add('is-open');
    panelOverlay.classList.add('is-visible');
    panel.setAttribute('aria-hidden', 'false');

    // Fetch and render content
    fetchContent(platform);
  }

  // Close panel
  function closePanel() {
    document.body.classList.remove('panel-open');
    panel.classList.remove('is-open');
    panelOverlay.classList.remove('is-visible');
    panel.setAttribute('aria-hidden', 'true');
  }

  // Fetch content from API
  async function fetchContent(platform) {
    // Check cache first
    if (cache.has(platform)) {
      renderContent(platform, cache.get(platform));
      return;
    }

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

  // GitHub content
  function renderGitHub(data) {
    let html = '';

    // Profile info
    if (data.name || data.bio) {
      html += `
        <div class="panel-section">
          <div class="content-item">
            <h3 class="content-item__title">${data.name || 'jeffsharris'}</h3>
            ${data.bio ? `<p class="content-item__description">${data.bio}</p>` : ''}
          </div>
        </div>
      `;
    }

    // Recent activity
    if (data.recentEvents && data.recentEvents.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Recent Activity</h4>
          ${data.recentEvents.map(event => `
            <div class="content-item">
              <div class="content-item__header">
                <h3 class="content-item__title">${event.repo}</h3>
                <span class="content-item__meta">${formatDate(event.date)}</span>
              </div>
              <p class="content-item__description">${event.action}</p>
            </div>
          `).join('')}
        </div>
      `;
    }

    // Repositories
    if (data.repos && data.repos.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Repositories</h4>
          ${data.repos.map(repo => `
            <div class="content-item">
              <div class="content-item__header">
                <h3 class="content-item__title">${repo.name}</h3>
                ${repo.stars ? `<span class="content-item__meta">★ ${repo.stars}</span>` : ''}
              </div>
              ${repo.description ? `<p class="content-item__description">${repo.description}</p>` : ''}
              ${repo.language ? `
                <div class="content-item__tags">
                  <span class="content-item__tag">${repo.language}</span>
                </div>
              ` : ''}
            </div>
          `).join('')}
        </div>
      `;
    }

    if (!html) {
      html = '<div class="panel-empty">No recent activity found</div>';
    }

    panelContent.innerHTML = html;
  }

  // Substack content
  function renderSubstack(data) {
    let html = '';

    if (data.posts && data.posts.length > 0) {
      html = `
        <div class="panel-section">
          <h4 class="panel-section__title">Recent Posts</h4>
          ${data.posts.map(post => `
            <a href="${post.url || '#'}" target="_blank" rel="noopener" class="content-item" style="text-decoration: none; display: block;">
              <div class="content-item__header">
                <h3 class="content-item__title">${post.title}</h3>
                ${post.date ? `<span class="content-item__meta">${formatDate(post.date)}</span>` : ''}
              </div>
              ${post.excerpt ? `<p class="content-item__description">${post.excerpt}</p>` : ''}
            </a>
          `).join('')}
        </div>
      `;
    } else if (data.title) {
      // Single post fallback
      html = `
        <div class="panel-section">
          <h4 class="panel-section__title">Latest Post</h4>
          <div class="content-item">
            <h3 class="content-item__title">${data.title}</h3>
            ${data.excerpt ? `<p class="content-item__description">${data.excerpt}</p>` : ''}
          </div>
        </div>
      `;
    } else {
      html = '<div class="panel-empty">No posts found</div>';
    }

    panelContent.innerHTML = html;
  }

  // X (Twitter) content
  function renderX(data) {
    let html = '';

    // Bio
    if (data.handle || data.bio) {
      html += `
        <div class="panel-section">
          <div class="content-item">
            <h3 class="content-item__title">${data.handle || '@jeffintime'}</h3>
            ${data.bio ? `<p class="content-item__description">${data.bio}</p>` : ''}
          </div>
        </div>
      `;
    }

    // Tweets
    if (data.recentTweets && data.recentTweets.length > 0) {
      html += `
        <div class="panel-section">
          <h4 class="panel-section__title">Featured Posts</h4>
          ${data.recentTweets.map(tweet => `
            <div class="content-item content-item--tweet">
              <p class="content-item__text">"${tweet}"</p>
            </div>
          `).join('')}
        </div>
      `;
    }

    if (!html) {
      html = '<div class="panel-empty">No content available</div>';
    }

    panelContent.innerHTML = html;
  }

  // Goodreads content
  function renderGoodreads(data) {
    let html = '';

    if (data.books && data.books.length > 0) {
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
    } else {
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

})();
