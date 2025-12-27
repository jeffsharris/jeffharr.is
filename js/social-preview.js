/**
 * Social Preview Cards
 * Preloads all data on page load for instant hover experience
 */

(function() {
  'use strict';

  const cache = new Map();
  const platforms = ['github', 'substack', 'x', 'goodreads'];

  // Fetch preview data
  async function fetchPreviewData(platform) {
    try {
      const response = await fetch(`/api/${platform}`);
      if (!response.ok) throw new Error('API request failed');
      return await response.json();
    } catch (error) {
      console.warn(`Failed to fetch ${platform}:`, error);
      return null;
    }
  }

  // Render content for each platform
  function renderContent(platform, data) {
    if (!data) {
      return '<p class="preview-card__content">Unable to load</p>';
    }

    switch (platform) {
      case 'github':
        return `
          <div class="preview-card__title">${data.name || 'GitHub'}</div>
          ${data.bio ? `<p class="preview-card__content">${data.bio}</p>` : ''}
          ${data.recentActivity ? `<p class="preview-card__content"><strong>Recent:</strong> ${data.recentActivity}</p>` : ''}
        `;

      case 'substack':
        return `
          <div class="preview-card__title">Latest Post</div>
          <p class="preview-card__content"><strong>${data.title || 'Waking Patiently'}</strong></p>
          ${data.excerpt ? `<p class="preview-card__content">${data.excerpt}</p>` : ''}
        `;

      case 'x':
        const tweet = data.recentTweets?.[0];
        return `
          <div class="preview-card__title">@jeffintime</div>
          <p class="preview-card__content">${tweet ? `"${tweet}"` : data.bio || 'Follow me on X'}</p>
        `;

      case 'goodreads':
        if (data.books?.length > 0) {
          const books = data.books.map(b => `
            <li class="preview-card__book">
              <span class="preview-card__book-title">${b.title}</span>
              ${b.author ? `<br><small>by ${b.author}</small>` : ''}
            </li>
          `).join('');
          return `
            <div class="preview-card__title">${data.shelf || 'Reading'}</div>
            <ul class="preview-card__books">${books}</ul>
          `;
        }
        return `
          <div class="preview-card__title">Reading</div>
          <p class="preview-card__content">${data.currentlyReading || 'Check out my reading list'}</p>
        `;

      default:
        return '<p class="preview-card__content">Preview unavailable</p>';
    }
  }

  // Preload all preview data
  async function preloadAll() {
    const promises = platforms.map(async (platform) => {
      const data = await fetchPreviewData(platform);
      cache.set(platform, data);

      // Update the card immediately
      const card = document.querySelector(`.preview-card[data-platform="${platform}"]`);
      if (card) {
        card.innerHTML = renderContent(platform, data);
      }
    });

    await Promise.all(promises);
  }

  // Initialize
  function init() {
    // Show loading state initially
    platforms.forEach(platform => {
      const card = document.querySelector(`.preview-card[data-platform="${platform}"]`);
      if (card) {
        card.innerHTML = `
          <div class="preview-card__loading">
            <span class="loading-dot"></span>
            <span class="loading-dot"></span>
            <span class="loading-dot"></span>
          </div>
        `;
      }
    });

    // Preload all data
    preloadAll();

    // Mobile tap handling
    if (window.matchMedia('(max-width: 480px)').matches) {
      const links = document.querySelectorAll('.social-link[data-preview]');
      links.forEach(link => {
        let tapped = false;
        const card = link.querySelector('.preview-card');

        link.addEventListener('click', (e) => {
          if (!tapped) {
            e.preventDefault();
            tapped = true;
            card?.classList.add('is-visible');
          }
        });

        document.addEventListener('click', (e) => {
          if (!link.contains(e.target)) {
            tapped = false;
            card?.classList.remove('is-visible');
          }
        });
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
