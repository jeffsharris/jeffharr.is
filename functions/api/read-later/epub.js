import { parseHTML } from 'linkedom';
import { zipSync, strToU8 } from 'fflate';
import { deriveTitleFromUrl, absolutizeUrl } from './reader-utils.js';
import { formatError } from '../lib/logger.js';

const MAX_EMAIL_BYTES = 50 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8000;
const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';

const MIME_TO_EXT = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/gif', 'gif'],
  ['image/webp', 'webp'],
  ['image/svg+xml', 'svg'],
  ['image/avif', 'avif']
]);

const EXT_TO_MIME = new Map([
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['avif', 'image/avif']
]);

const DEFAULT_COVER_NAME = 'cover-generated';

async function buildEpubAttachment(item, reader, options = {}) {
  if (!reader?.contentHtml) return null;

  const maxEncodedBytes = Number.isFinite(options.maxEncodedBytes)
    ? options.maxEncodedBytes
    : MAX_EMAIL_BYTES;
  const fetchImage = options.fetchImage || fetchImageBytes;
  const imageCache = options.imageCache || new Map();
  const modes = options.modes || ['all', 'cover-only', 'none'];
  const coverOverride = normalizeCoverImage(options.coverImage);
  const log = options.log;

  let lastResult = null;
  for (const embedMode of modes) {
    try {
      lastResult = await buildEpubVariant({
        item,
        reader,
        embedMode,
        fetchImage,
        imageCache,
        coverOverride
      });
    } catch (error) {
      if (log) {
        log('warn', 'epub_variant_failed', {
          stage: 'epub_build',
          itemId: item?.id || null,
          url: item?.url || null,
          title: item?.title || null,
          embedMode,
          ...formatError(error)
        });
      }
      continue;
    }

    if (!lastResult?.attachment) {
      continue;
    }

    if (lastResult.meta.encodedBytes <= maxEncodedBytes) {
      return lastResult;
    }
  }

  return null;
}

async function buildEpubVariant({ item, reader, embedMode, fetchImage, imageCache, coverOverride }) {
  const contentHtml = reader?.contentHtml || '';
  if (!contentHtml) return null;

  const baseUrl = item?.url || '';
  const title = resolveTitle(item, reader);
  const images = extractImages(contentHtml, baseUrl);
  const coverSrc = images[0]?.src || null;
  const embedSet = selectEmbedSet(images, embedMode, coverSrc);

  const assets = await buildImageAssets({
    images,
    embedSet,
    coverSrc,
    fetchImage,
    imageCache
  });
  const coverImage = coverOverride || assets.coverSource;

  const rewritten = rewriteContentHtml(contentHtml, baseUrl, assets, embedSet);
  const epubFiles = buildEpubFiles({
    title,
    item,
    reader,
    contentHtml: rewritten.contentHtml,
    coverImage,
    coverSource: assets.coverSource,
    images: assets.items
  });

  const epubBytes = zipSync(epubFiles);
  const encodedBytes = base64EncodedLength(epubBytes.length);
  const attachment = {
    filename: `${formatFilename(title)}.epub`,
    content: toBase64(epubBytes),
    contentType: 'application/epub+zip'
  };

  return {
    attachment,
    meta: {
      embedMode,
      encodedBytes,
      imageCount: assets.items.length + (assets.coverSource ? 1 : 0),
      placeholderCount: rewritten.placeholderCount,
      coverIncluded: Boolean(coverImage)
    }
  };
}

function extractImages(html, baseUrl) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const nodes = Array.from(document.querySelectorAll('img'));
  const seen = new Set();
  const images = [];

  nodes.forEach((node) => {
    const src = (node.getAttribute('src') || '').trim();
    const abs = absolutizeUrl(src, baseUrl) || src;
    if (!abs || seen.has(abs)) {
      return;
    }
    seen.add(abs);
    images.push({
      src: abs,
      alt: (node.getAttribute('alt') || '').trim()
    });
  });

  return images;
}

function selectEmbedSet(images, embedMode, coverSrc) {
  if (embedMode === 'none') {
    return new Set();
  }
  if (embedMode === 'cover-only') {
    return coverSrc ? new Set([coverSrc]) : new Set();
  }
  return new Set(images.map((image) => image.src));
}

async function buildImageAssets({ images, embedSet, coverSrc, fetchImage, imageCache }) {
  const items = [];
  let coverSource = null;
  let imageIndex = 0;

  for (const image of images) {
    if (!embedSet.has(image.src)) {
      continue;
    }

    const isCoverSource = coverSrc && image.src === coverSrc;
    const cached = imageCache.get(image.src);
    const filenamePrefix = isCoverSource
      ? 'cover-source'
      : `image-${String(imageIndex + 1).padStart(3, '0')}`;
    const asset = cached || (await fetchImageAsset(image.src, fetchImage, filenamePrefix));

    if (!asset) {
      continue;
    }

    imageCache.set(image.src, asset);

    if (isCoverSource) {
      coverSource = asset;
    } else {
      imageIndex += 1;
      items.push(asset);
    }
  }

  return { coverSource, items };
}

async function fetchImageAsset(src, fetchImage, filenamePrefix) {
  if (!src.startsWith('http://') && !src.startsWith('https://')) {
    return null;
  }

  const response = await fetchImage(src);
  if (!response?.bytes?.length) {
    return null;
  }

  const { mediaType, ext } = resolveMediaType(src, response.contentType);
  if (!mediaType || !ext) {
    return null;
  }

  const filename = `images/${filenamePrefix}.${ext}`;

  return {
    src,
    href: filename,
    mediaType,
    bytes: response.bytes
  };
}

function normalizeCoverImage(coverImage) {
  if (!coverImage?.base64) return null;

  const contentType = (coverImage.contentType || coverImage.mediaType || 'image/png')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const { mediaType, ext } = resolveCoverMediaType(contentType);
  if (!mediaType || !ext) return null;

  return {
    src: 'generated-cover',
    href: `images/${DEFAULT_COVER_NAME}.${ext}`,
    mediaType,
    bytes: decodeBase64(coverImage.base64)
  };
}

function resolveCoverMediaType(contentType) {
  const normalized = (contentType || '').split(';')[0].trim().toLowerCase();
  if (normalized && MIME_TO_EXT.has(normalized)) {
    const ext = MIME_TO_EXT.get(normalized);
    const mime = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
    return { mediaType: mime, ext };
  }
  return { mediaType: null, ext: null };
}

function resolveMediaType(src, contentType) {
  const normalized = (contentType || '').split(';')[0].trim().toLowerCase();
  if (normalized && MIME_TO_EXT.has(normalized)) {
    const ext = MIME_TO_EXT.get(normalized);
    const mime = normalized === 'image/jpg' ? 'image/jpeg' : normalized;
    return { mediaType: mime, ext };
  }

  try {
    const url = new URL(src);
    const match = url.pathname.toLowerCase().match(/\.([a-z0-9]+)$/);
    if (match) {
      const ext = match[1];
      const mime = EXT_TO_MIME.get(ext);
      if (mime) {
        return { mediaType: mime, ext };
      }
    }
  } catch {
    return { mediaType: null, ext: null };
  }

  return { mediaType: null, ext: null };
}

function rewriteContentHtml(html, baseUrl, assets, embedSet) {
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const nodes = Array.from(document.querySelectorAll('img'));
  let placeholderCount = 0;
  const assetMap = new Map();

  if (assets?.coverSource) {
    assetMap.set(assets.coverSource.src, assets.coverSource);
  }
  assets?.items?.forEach((item) => {
    assetMap.set(item.src, item);
  });

  nodes.forEach((node) => {
    const src = (node.getAttribute('src') || '').trim();
    const abs = absolutizeUrl(src, baseUrl) || src;
    const asset = abs ? assetMap.get(abs) : null;

    if (asset && embedSet.has(asset.src)) {
      node.setAttribute('src', asset.href);
      node.removeAttribute('srcset');
      node.removeAttribute('sizes');
      return;
    }

    const altText = (node.getAttribute('alt') || '').trim() || 'Image';
    const placeholder = document.createElement('p');
    placeholder.setAttribute('class', 'image-placeholder');
    placeholder.textContent = `[Image: ${altText}]`;

    const parent = node.parentElement;
    if (parent && parent.tagName && parent.tagName.toLowerCase() === 'picture') {
      parent.replaceWith(placeholder);
    } else {
      node.replaceWith(placeholder);
    }
    placeholderCount += 1;
  });

  document.querySelectorAll('source').forEach((node) => node.remove());

  const body = document.body;
  return {
    contentHtml: body ? body.innerHTML : '',
    placeholderCount
  };
}

function buildEpubFiles({ title, item, reader, contentHtml, coverImage, coverSource, images }) {
  const files = {};
  const safeTitle = escapeXml(title);
  const safeUrl = escapeXml(item?.url || '');
  const author = reader?.byline ? escapeXml(reader.byline) : '';
  const siteName = reader?.siteName ? escapeXml(reader.siteName) : '';
  const modified = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const identifier = escapeXml(item?.id || item?.url || `read-later-${Date.now()}`);

  const manifestItems = [
    buildManifestItem('nav', 'nav.xhtml', 'application/xhtml+xml', 'nav'),
    buildManifestItem('chapter', 'chapter.xhtml', 'application/xhtml+xml'),
    buildManifestItem('styles', 'styles.css', 'text/css')
  ];

  const spineItems = [];

  if (coverImage) {
    manifestItems.push(
      buildManifestItem('cover-page', 'cover.xhtml', 'application/xhtml+xml'),
      buildManifestItem('cover-image', coverImage.href, coverImage.mediaType, 'cover-image')
    );
    spineItems.push('cover-page');
  }

  if (coverSource) {
    manifestItems.push(
      buildManifestItem('cover-source', coverSource.href, coverSource.mediaType)
    );
  }

  images.forEach((image, index) => {
    manifestItems.push(
      buildManifestItem(`img-${index + 1}`, image.href, image.mediaType)
    );
  });

  spineItems.push('chapter');

  const opf = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">\n` +
    `  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">\n` +
    `    <dc:identifier id="uid">${identifier}</dc:identifier>\n` +
    `    <dc:title>${safeTitle}</dc:title>\n` +
    `    <dc:language>en</dc:language>\n` +
    (author ? `    <dc:creator>${author}</dc:creator>\n` : '') +
    (siteName ? `    <dc:publisher>${siteName}</dc:publisher>\n` : '') +
    (safeUrl ? `    <dc:source>${safeUrl}</dc:source>\n` : '') +
    `    <meta property="dcterms:modified">${modified}</meta>\n` +
    `  </metadata>\n` +
    `  <manifest>\n` +
    manifestItems.map((entry) => `    ${entry}`).join('\n') + '\n' +
    `  </manifest>\n` +
    `  <spine>\n` +
    spineItems.map((id) => `    <itemref idref="${id}"/>`).join('\n') + '\n' +
    `  </spine>\n` +
    `</package>\n`;

  const nav = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="en">\n` +
    `  <head>\n` +
    `    <title>${safeTitle}</title>\n` +
    `    <link rel="stylesheet" href="styles.css" />\n` +
    `  </head>\n` +
    `  <body>\n` +
    `    <nav epub:type="toc" id="toc">\n` +
    `      <h1>${safeTitle}</h1>\n` +
    `      <ol>\n` +
    `        <li><a href="chapter.xhtml">${safeTitle}</a></li>\n` +
    `      </ol>\n` +
    `    </nav>\n` +
    `  </body>\n` +
    `</html>\n`;

  const chapter = `<?xml version="1.0" encoding="utf-8"?>\n` +
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">\n` +
    `  <head>\n` +
    `    <title>${safeTitle}</title>\n` +
    `    <link rel="stylesheet" href="styles.css" />\n` +
    `  </head>\n` +
    `  <body>\n` +
    `    <h1>${safeTitle}</h1>\n` +
    (author || siteName ? `    <p class="meta">${[author, siteName].filter(Boolean).join(' - ')}</p>\n` : '') +
    (safeUrl ? `    <p class="source">Source: ${safeUrl}</p>\n` : '') +
    `    <article>\n${indentHtml(escapeXhtml(contentHtml))}\n    </article>\n` +
    `  </body>\n` +
    `</html>\n`;

  const coverPage = coverImage
    ? `<?xml version="1.0" encoding="utf-8"?>\n` +
      `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en">\n` +
      `  <head>\n` +
      `    <title>Cover</title>\n` +
      `    <link rel="stylesheet" href="styles.css" />\n` +
      `  </head>\n` +
      `  <body class="cover">\n` +
      `    <h1 class="cover__title">${safeTitle}</h1>\n` +
      `    <img src="${coverImage.href}" alt="Cover image" />\n` +
      `  </body>\n` +
      `</html>\n`
    : '';

  const styles = `body { font-family: serif; line-height: 1.6; margin: 1.25rem; }\n` +
    `h1 { font-size: 1.6rem; margin-bottom: 0.4rem; }\n` +
    `.meta { color: #666; margin: 0 0 0.5rem; font-size: 0.9rem; }\n` +
    `.source { color: #666; font-size: 0.85rem; margin: 0 0 1rem; }\n` +
    `.image-placeholder { color: #777; font-style: italic; border-left: 2px solid #ddd; padding-left: 0.5rem; }\n` +
    `img { max-width: 100%; height: auto; }\n` +
    `.cover { margin: 0; padding: 0; text-align: center; }\n` +
    `.cover__title { font-size: 1.6rem; margin: 1.5rem 1rem 1rem; }\n` +
    `.cover img { max-width: 100%; height: auto; }\n`;

  files['mimetype'] = [strToU8('application/epub+zip'), { level: 0 }];
  files['META-INF'] = {};
  files['META-INF']['container.xml'] = strToU8(
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">\n` +
    `  <rootfiles>\n` +
    `    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>\n` +
    `  </rootfiles>\n` +
    `</container>\n`
  );
  files['OEBPS'] = {};
  files['OEBPS']['content.opf'] = strToU8(opf);
  files['OEBPS']['nav.xhtml'] = strToU8(nav);
  files['OEBPS']['chapter.xhtml'] = strToU8(chapter);
  files['OEBPS']['styles.css'] = strToU8(styles);
  if (coverPage) {
    files['OEBPS']['cover.xhtml'] = strToU8(coverPage);
  }

  if (coverImage || coverSource || images.length > 0) {
    files['OEBPS']['images'] = {};
  }
  if (coverImage) {
    files['OEBPS']['images'][coverImage.href.replace('images/', '')] = coverImage.bytes;
  }
  if (coverSource) {
    files['OEBPS']['images'][coverSource.href.replace('images/', '')] = coverSource.bytes;
  }
  images.forEach((image) => {
    const name = image.href.replace('images/', '');
    files['OEBPS']['images'][name] = image.bytes;
  });

  return files;
}

function buildManifestItem(id, href, mediaType, property) {
  const props = property ? ` properties="${property}"` : '';
  return `<item id="${id}" href="${href}" media-type="${mediaType}"${props}/>`;
}

function resolveTitle(item, reader) {
  return reader?.title || item?.title || deriveTitleFromUrl(item?.url || '');
}

function formatFilename(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'read-later';
}

function escapeXml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeXhtml(html) {
  return String(html || '').replace(/&(?!(?:[a-zA-Z]+|#\d+|#x[0-9A-Fa-f]+);)/g, '&amp;');
}

function indentHtml(html) {
  return String(html || '')
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
}

function base64EncodedLength(byteLength) {
  return Math.ceil(byteLength / 3) * 4;
}

function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  if (typeof btoa === 'function') {
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  throw new Error('Base64 encoding unavailable');
}

function decodeBase64(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  if (typeof atob === 'function') {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  throw new Error('Base64 decoding unavailable');
}

async function fetchImageBytes(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'image/*'
    }
  }, timeoutMs);

  if (!response.ok) {
    return null;
  }

  const contentType = response.headers.get('content-type') || '';
  const buffer = await response.arrayBuffer();
  return { bytes: new Uint8Array(buffer), contentType };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

export {
  MAX_EMAIL_BYTES,
  buildEpubAttachment
};
