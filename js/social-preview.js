/**
 * Social Preview Cards for jeffharr.is
 * Handles hover/tap interactions and fetches preview data from APIs
 */

(function() {
  'use strict';

  // Cache for API responses
  const cache = new Map();
  const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Debounce helper
  function debounce(fn, delay) {
    let timeoutId;
    return function(...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  // Check if we're on mobile
  function isMobile() {
    return window.matchMedia('(max-width: 640px)').matches;
  }

  // Fetch preview data from API
  async function fetchPreviewData(platform) {
    // Check cache first
    const cached = cache.get(platform);
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return cached.data;
    }

    try {
      const response = await fetch(`/api/${platform}`);
      if (!response.ok) throw new Error('API request failed');

      const data = await response.json();
      cache.set(platform, { data, timestamp: Date.now() });
      return data;
    } catch (error) {
      console.warn(`Failed to fetch ${platform} preview:`, error);
      return null;
    }
  }

  // Render preview card content
  function renderPreviewContent(platform, data) {
    if (!data) {
      return `<p class="preview-card__content">Unable to load preview</p>`;
    }

    switch (platform) {
      case 'github':
        return `
          <div class="preview-card__title">${data.name || 'GitHub'}</div>
          <p class="preview-card__content">${data.bio || ''}</p>
          ${data.recentActivity ? `
            <p class="preview-card__content">
              <strong>Recent:</strong> ${data.recentActivity}
            </p>
          ` : ''}
          ${data.publicRepos ? `
            <p class="preview-card__content" style="margin-top: 8px; opacity: 0.7;">
              ${data.publicRepos} public repos
            </p>
          ` : ''}
        `;

      case 'substack':
        return `
          <div class="preview-card__title">Latest Post</div>
          <p class="preview-card__content">
            <strong>${data.title || 'No recent posts'}</strong>
          </p>
          ${data.excerpt ? `<p class="preview-card__content">${data.excerpt}</p>` : ''}
        `;

      case 'x':
        return `
          <div class="preview-card__title">@jeffintime</div>
          ${data.recentTweets && data.recentTweets.length > 0 ? `
            <p class="preview-card__content">"${data.recentTweets[0]}"</p>
          ` : `
            <p class="preview-card__content">${data.bio || 'Follow me on X'}</p>
          `}
        `;

      case 'goodreads':
        if (data.books && data.books.length > 0) {
          const booksHtml = data.books.map(book => `
            <li class="preview-card__book">
              <span class="preview-card__book-title">${book.title}</span>
              ${book.author ? `<br><small>by ${book.author}</small>` : ''}
            </li>
          `).join('');
          return `
            <div class="preview-card__title">${data.shelf || 'Reading'}</div>
            <ul class="preview-card__books">${booksHtml}</ul>
          `;
        }
        return `
          <div class="preview-card__title">Reading</div>
          <p class="preview-card__content">
            ${data.currentlyReading || 'Check out my reading list'}
          </p>
        `;

      default:
        return `<p class="preview-card__content">Preview not available</p>`;
    }
  }

  // Update preview card with data
  async function updatePreviewCard(card, platform) {
    const data = await fetchPreviewData(platform);
    card.innerHTML = renderPreviewContent(platform, data);
  }

  // Initialize preview cards
  function initPreviews() {
    const socialLinks = document.querySelectorAll('[data-preview]');

    socialLinks.forEach(link => {
      const platform = link.dataset.preview;
      const card = link.querySelector('.preview-card');

      if (!card) return;

      // Track if we've loaded this preview
      let loaded = false;

      // Desktop: load on hover
      const handleHover = debounce(() => {
        if (!loaded && !isMobile()) {
          loaded = true;
          updatePreviewCard(card, platform);
        }
      }, 100);

      link.addEventListener('mouseenter', handleHover);

      // Mobile: load on first tap, second tap follows link
      if (isMobile()) {
        let tapped = false;

        link.addEventListener('click', (e) => {
          if (!tapped) {
            e.preventDefault();
            tapped = true;
            card.classList.add('is-visible');

            if (!loaded) {
              loaded = true;
              updatePreviewCard(card, platform);
            }
          }
        });

        // Close on tap outside
        document.addEventListener('click', (e) => {
          if (!link.contains(e.target)) {
            tapped = false;
            card.classList.remove('is-visible');
          }
        });
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initPreviews);
  } else {
    initPreviews();
  }
})();
