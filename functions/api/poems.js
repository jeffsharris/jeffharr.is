/**
 * Poems manifest endpoint for Cloudflare Pages Functions
 * Surfaces a random sampling of poems for the panel view without scraping the poems app.
 */

const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';

export async function onRequest(context) {
  try {
    const manifest = await fetchManifest(context);
    const memorized = manifest.memorized || [];
    const learning = manifest.learning || [];
    const allSlugs = Array.from(new Set([...memorized, ...learning]));

    const data = {
      memorizedCount: memorized.length,
      learningCount: learning.length,
      poems: await selectRandomPoems(allSlugs, context, 10),
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
      poems: [],
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

async function fetchManifest(context) {
  const manifestUrl = new URL('/poems/manifest.json', context.request.url);
  const assetResponse = await context.env.ASSETS.fetch(manifestUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!assetResponse.ok) {
    throw new Error(`Manifest fetch failed with status ${assetResponse.status}`);
  }

  return assetResponse.json();
}

async function selectRandomPoems(slugs, context, count = 10) {
  const selected = shuffle(slugs).slice(0, count);
  const poems = await Promise.all(selected.map((slug) => loadPoem(slug, context)));
  return poems.filter(Boolean);
}

async function loadPoem(slug, context) {
  try {
    const poemUrl = new URL(`/poems/content/${slug}.md`, context.request.url);
    const response = await context.env.ASSETS.fetch(poemUrl, {
      headers: { 'User-Agent': USER_AGENT }
    });

    if (!response.ok) return null;

    const markdown = await response.text();
    const { title, author, excerpt } = parsePoem(markdown);

    return {
      slug,
      title: title || slugToTitle(slug),
      author: author || 'Unknown',
      excerpt
    };
  } catch (error) {
    console.error(`Failed to load poem ${slug}:`, error);
    return null;
  }
}

function parsePoem(markdown = '') {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { title: '', author: '', excerpt: '' };

  const frontmatter = parseFrontmatter(match[1]);
  const content = match[2].trim();

  return {
    title: frontmatter.title || '',
    author: frontmatter.author || '',
    excerpt: createExcerpt(content)
  };
}

function parseFrontmatter(block = '') {
  return block.split('\n').reduce((acc, line) => {
    const [rawKey, ...rest] = line.split(':');
    if (!rawKey || rest.length === 0) return acc;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(':').trim();
    acc[key] = value;
    return acc;
  }, {});
}

function createExcerpt(content = '') {
  const lines = content.split('\n').map(line => line.trim()).filter(Boolean);
  return lines.slice(0, 3).join(' · ');
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
