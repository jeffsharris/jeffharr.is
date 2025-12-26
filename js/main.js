/**
 * Main JavaScript for jeffharr.is
 * Handles theme toggle and core interactions
 */

(function() {
  'use strict';

  // Theme Toggle
  const themeToggle = document.getElementById('theme-toggle');
  const STORAGE_KEY = 'theme-preference';

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
    // Moon for light mode (click to go dark), Sun for dark mode (click to go light)
    themeToggle.innerHTML = theme === 'dark'
      ? '<span class="theme-toggle__icon">&#9728;</span>' // Sun
      : '<span class="theme-toggle__icon">&#9790;</span>'; // Moon
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
