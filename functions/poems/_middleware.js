import { parsePoem, slugToTitle } from '../api/poems.js';
import { injectFavoritesAssets } from '../api/content-library/html-assets.js';

const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';
const VALID_SLUG = /^[a-z0-9-]+$/;

export async function onRequest(context) {
  const requestUrl = new URL(context.request.url);
  const slug = requestUrl.searchParams.get('poem') || '';

  if (!slug || !VALID_SLUG.test(slug)) {
    return injectFavoritesForHtml(context);
  }

  try {
    const manifest = await fetchJsonAsset(context, '/poems/manifest.json');
    const slugs = new Set([...(manifest.memorized || []), ...(manifest.learning || [])]);

    if (!slugs.has(slug)) {
      return injectFavoritesForHtml(context);
    }

    const [indexHtml, markdown] = await Promise.all([
      fetchTextAsset(context, '/poems/index.html'),
      fetchTextAsset(context, `/poems/content/${slug}.md`)
    ]);
    const poem = parsePoem(markdown);
    const title = poem.title || slugToTitle(slug);
    const author = poem.author || 'Unknown';
    const description = poem.excerpt || `A poem by ${author}.`;
    const imagePath = manifest.images?.[slug] || '/images/profile.jpg';
    const previewUrl = new URL('/poems/', context.request.url);
    previewUrl.searchParams.set('poem', slug);

    const html = injectFavoritesAssets(injectPoemPreviewMetadata(indexHtml, {
      title,
      author,
      description,
      imageUrl: new URL(imagePath, context.request.url).href,
      url: previewUrl.href
    }));

    return new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=UTF-8',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  } catch (error) {
    console.error(`Poem preview metadata error for ${slug}:`, error);
    return injectFavoritesForHtml(context);
  }
}

async function injectFavoritesForHtml(context) {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') || context.request.method === 'HEAD') {
    return response;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(injectFavoritesAssets(await response.text()), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function fetchJsonAsset(context, path) {
  const response = await fetchAsset(context, path);
  return response.json();
}

async function fetchTextAsset(context, path) {
  const response = await fetchAsset(context, path);
  return response.text();
}

async function fetchAsset(context, path) {
  const assetUrl = new URL(path, context.request.url);
  const response = await context.env.ASSETS.fetch(assetUrl, {
    headers: { 'User-Agent': USER_AGENT }
  });

  if (!response.ok) {
    throw new Error(`${path} fetch failed with status ${response.status}`);
  }

  return response;
}

function injectPoemPreviewMetadata(html, metadata) {
  const documentTitle = `${metadata.title} by ${metadata.author} | Poems | Jeff Harris`;
  const previewTitle = `${metadata.title} by ${metadata.author}`;
  const description = truncate(metadata.description, 220);
  const tags = renderPreviewTags({
    ...metadata,
    title: previewTitle,
    description
  });

  let output = html.replace(
    /<title>[\s\S]*?<\/title>/i,
    `<title>${escapeHtml(documentTitle)}</title>`
  );

  const descriptionTag = `<meta name="description" content="${escapeAttribute(description)}">`;

  if (/<meta\s+name=["']description["'][^>]*>/i.test(output)) {
    output = output.replace(
      /<meta\s+name=["']description["'][^>]*>/i,
      `${descriptionTag}\n${tags}`
    );
  } else {
    output = output.replace(
      /<head[^>]*>/i,
      (match) => `${match}\n  ${descriptionTag}\n${tags}`
    );
  }

  return output;
}

function renderPreviewTags({ title, description, imageUrl, url }) {
  return `  <meta property="og:title" content="${escapeAttribute(title)}">
  <meta property="og:description" content="${escapeAttribute(description)}">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="Jeff Harris Poems">
  <meta property="og:url" content="${escapeAttribute(url)}">
  <meta property="og:image" content="${escapeAttribute(imageUrl)}">
  <meta property="og:image:secure_url" content="${escapeAttribute(imageUrl)}">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1024">
  <meta property="og:image:height" content="1024">
  <meta property="og:image:alt" content="${escapeAttribute(title)}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeAttribute(title)}">
  <meta name="twitter:description" content="${escapeAttribute(description)}">
  <meta name="twitter:image" content="${escapeAttribute(imageUrl)}">
  <link rel="canonical" href="${escapeAttribute(url)}">`;
}

function truncate(value = '', maxLength = 220) {
  const normalized = String(value).replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

function escapeAttribute(value = '') {
  return escapeHtml(value).replace(/`/g, '&#096;');
}

export { injectPoemPreviewMetadata };
