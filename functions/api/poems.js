/**
 * Poems manifest endpoint for Cloudflare Pages Functions
 * Surfaces a quick summary for the panel view without scraping the poems app.
 */

const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';

export async function onRequest(context) {
  try {
    const manifestUrl = new URL('/poems/manifest.json', context.request.url);
    const assetResponse = await context.env.ASSETS.fetch(manifestUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (!assetResponse.ok) {
      throw new Error(`Manifest fetch failed with status ${assetResponse.status}`);
    }

    const manifest = await assetResponse.json();
    const memorized = manifest.memorized || [];
    const learning = manifest.learning || [];

    const data = {
      memorizedCount: memorized.length,
      learningCount: learning.length,
      highlights: selectHighlights(memorized, learning),
      profileUrl: '/poems'
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=43200'
      }
    });
  } catch (error) {
    console.error('Poems manifest error:', error);
    return new Response(JSON.stringify({
      memorizedCount: 0,
      learningCount: 0,
      highlights: [],
      profileUrl: '/poems'
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      },
      status: 200
    });
  }
}

function selectHighlights(memorized, learning) {
  const allSlugs = [...memorized, ...learning];
  const selected = shuffle(allSlugs).slice(0, 10);
  return selected.map(slugToTitle).filter(Boolean);
}

function slugToTitle(slug = '') {
  return slug
    .split('-')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function shuffle(items = []) {
  const array = [...items];
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
