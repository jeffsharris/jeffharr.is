/**
 * Main JavaScript for jeffharr.is
 * Handles theme toggle and core interactions
 */

(function() {
  'use strict';

  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  const STORAGE_KEY = 'theme-preference';

  // SVG icons for theme toggle
  const sunIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>`;
  const moonIcon = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

  // Get the user's theme preference
  function getThemePreference() {
    // Check localStorage first
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return stored;
    }
    // Fall back to system preference
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  // Apply the theme
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    updateToggleIcon(theme);
    localStorage.setItem(STORAGE_KEY, theme);
  }

  // Update the toggle button icon
  function updateToggleIcon(theme) {
    if (!themeToggle) return;
    const iconSpan = themeToggle.querySelector('.theme-toggle__icon');
    if (iconSpan) {
      // Show sun icon in dark mode (click to go light), moon in light mode (click to go dark)
      iconSpan.innerHTML = theme === 'dark' ? sunIcon : moonIcon;
    }
  }

  // Initialize theme
  function initTheme() {
    const theme = getThemePreference();
    setTheme(theme);

    // Listen for toggle clicks
    if (themeToggle) {
      themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
      });
    }

    // Listen for system preference changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      // Only update if user hasn't set a preference
      if (!localStorage.getItem(STORAGE_KEY)) {
        setTheme(e.matches ? 'dark' : 'light');
      }
    });
  }

  // Run on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
})();
