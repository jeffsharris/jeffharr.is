function injectFavoritesAssets(html) {
  let output = html;
  output = output.replace(/\/js\/admin-presence\.js\?v=\d+/g, '/js/admin-presence.js?v=2');
  if (!output.includes('/css/favorites.css')) {
    output = output.replace(
      /<\/head>/i,
      '  <link rel="stylesheet" href="/css/favorites.css?v=2">\n</head>'
    );
  }
  if (!output.includes('/js/admin-presence.js')) {
    output = output.replace(
      /<\/body>/i,
      '  <script src="/js/admin-presence.js?v=2" defer></script>\n</body>'
    );
  }
  if (!output.includes('/js/favorites.js')) {
    output = output.replace(
      /<\/body>/i,
      '  <script src="/js/favorites.js?v=2" defer></script>\n</body>'
    );
  }
  return output;
}

export { injectFavoritesAssets };
