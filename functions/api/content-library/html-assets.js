function injectFavoritesAssets(html) {
  let output = html;
  if (!output.includes('/css/favorites.css')) {
    output = output.replace(
      /<\/head>/i,
      '  <link rel="stylesheet" href="/css/favorites.css?v=1">\n</head>'
    );
  }
  if (!output.includes('/js/favorites.js')) {
    output = output.replace(
      /<\/body>/i,
      '  <script src="/js/favorites.js?v=1" defer></script>\n</body>'
    );
  }
  return output;
}

export { injectFavoritesAssets };
