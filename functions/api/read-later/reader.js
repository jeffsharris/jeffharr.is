/**
 * Reader extraction endpoint for read-later items.
 * Fetches remote content, extracts readable HTML, sanitizes, and stores it in R2.
 */

import puppeteer from '@cloudflare/puppeteer';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import {
  DEFAULT_MIN_WORD_COUNT,
  deriveTitleFromUrl,
  shouldCacheReader,
  preferReaderTitle,
  absolutizeUrl,
  absolutizeSrcset,
  countWords,
  looksClientRendered
} from './reader-utils.js';
import { buildXReaderFromUrl } from './x-adapter.js';
import { createReadLaterRepository } from './repository.js';
import { createLogger, formatError } from '../lib/logger.js';
import { readLaterRowToItem } from '../content-library/read-later-store.js';
import { jsonResponse } from '../content-library/serialize.js';

const FETCH_TIMEOUT_MS = 10000;
const RENDER_TIMEOUT_MS = 15000;
const RENDER_SETTLE_MS = 1200;
const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';
const TEXT_STABILITY_THRESHOLD = 24;
const TEXT_POLL_INTERVAL_MS = 300;

const CONTENT_SELECTORS = [
  'article',
  '[role="main"]',
  'main',
  '[itemprop="articleBody"]',
  '.post-content',
  '.post-body',
  '.entry-content',
  '.article-body',
  '.article-content',
  '.story-body',
  '.content__body',
  '.content-body',
  '[data-testid="post-content"]',
  '[data-test="post-content"]'
];

const CONTENT_SELECTOR = CONTENT_SELECTORS.join(',');
const NOISE_TAGS = new Set(['nav', 'footer', 'header', 'aside']);

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figure',
  'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li',
  'ol', 'p', 'picture', 'pre', 'section', 'small', 'source', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'time',
  'article', 'caption'
]);

const REMOVE_TAGS = new Set([
  'script', 'style', 'iframe', 'noscript', 'form', 'input', 'button', 'select',
  'textarea', 'nav', 'footer', 'header', 'aside', 'svg', 'canvas', 'video',
  'audio', 'object', 'embed'
]);

const ALLOWED_ATTRS = new Map([
  ['a', new Set(['href', 'title', 'rel', 'target'])],
  ['img', new Set(['src', 'alt', 'title', 'width', 'height', 'loading', 'decoding', 'srcset'])],
  ['source', new Set(['srcset', 'type', 'media', 'sizes'])],
  ['time', new Set(['datetime'])]
]);

export async function onRequest(context) {
  const { request, env } = context;
  const repository = createReadLaterRepository(env, { requireAssets: true });
  const logger = createLogger({ request, source: 'read-later-reader' });
  const log = logger.log;

  if (!repository) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, reader: null, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  return handleReadLaterReader({ request, env, repository, log });
}

async function handleReadLaterReader({ request, env, repository, log }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  const forceRefresh = url.searchParams.get('refresh') === '1';

  if (!id) {
    log('warn', 'reader_missing_id', { stage: 'request' });
    return jsonResponse(
      { ok: false, reader: null, error: 'Missing id' },
      { status: 400, cache: 'no-store' }
    );
  }

  try {
    const row = await repository.getRow(id);
    if (!row) {
      log('warn', 'reader_item_missing', {
        stage: 'lookup',
        itemId: id
      });
      return jsonResponse(
        { ok: false, reader: null, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    const item = await readLaterRowToItem(repository.db, row);
    const reader = await fetchAndCacheReader({
      repository,
      id,
      url: item.url,
      title: item.title,
      browser: env.BROWSER,
      xBearerToken: env.X_API_BEARER_TOKEN,
      forceRefresh,
      log
    });

    if (!reader) {
      log('warn', 'reader_unavailable', {
        stage: 'reader_fetch',
        itemId: id,
        url: item.url,
        title: item.title
      });
      return jsonResponse(
        { ok: false, reader: null, error: 'Reader unavailable' },
        { status: 200, cache: 'public, max-age=60' }
      );
    }

    if (forceRefresh) {
      const resolvedTitle = preferReaderTitle(item.title, reader?.title, item.url);
      if (resolvedTitle && resolvedTitle !== item.title) {
        item.title = resolvedTitle;
        await repository.saveItem(item);
      }
    }

    return jsonResponse(
      { ok: true, item: pickItem(item), reader },
      { status: 200, cache: 'public, max-age=3600' }
    );
  } catch (error) {
    log('error', 'reader_request_failed', {
      stage: 'reader_fetch',
      itemId: id,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, reader: null, error: 'Reader unavailable' },
      { status: 200, cache: 'public, max-age=60' }
    );
  }
}

async function buildReaderContent(url, fallbackTitle, browserBinding, options = {}) {
  const log = options.log;
  const xBearerToken = options.xBearerToken || null;
  const logContext = {
    itemId: options.itemId || null,
    url,
    title: fallbackTitle
  };

  const xReader = await buildXReaderFromUrl(url, fallbackTitle, xBearerToken, {
    log,
    itemId: options.itemId || null
  });
  if (xReader?.contentHtml) {
    return xReader;
  }

  const substackReader = await buildSubstackReaderFromUrl(url, fallbackTitle, {
    log,
    ...logContext
  });
  if (substackReader?.contentHtml && shouldCacheReader(substackReader)) {
    return substackReader;
  }

  let html;
  try {
    html = await fetchHtml(url);
  } catch (error) {
    if (log) {
      log('error', 'reader_fetch_failed', {
        stage: 'reader_fetch',
        ...logContext,
        ...formatError(error)
      });
    }
    throw error;
  }
  const preferBrowser = Boolean(browserBinding) && looksClientRendered(html);
  let reader = preferBrowser ? null : extractReader(html, url, fallbackTitle);

  if (!shouldCacheReader(reader) && browserBinding) {
    const renderedHtml = await renderWithBrowser(url, browserBinding, log, logContext);
    if (renderedHtml) {
      const renderedReader = extractReader(renderedHtml, url, fallbackTitle);
      if (shouldCacheReader(renderedReader) || !reader) {
        reader = renderedReader;
      }
    }
  }

  if (!reader && preferBrowser) {
    reader = extractReader(html, url, fallbackTitle);
  }

  return reader;
}

async function buildSubstackReaderFromUrl(url, fallbackTitle, options = {}) {
  const postRef = parseSubstackPostRef(url);
  if (!postRef) return null;

  let response;
  try {
    response = await fetchWithTimeout(postRef.apiUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'application/json'
      }
    }, FETCH_TIMEOUT_MS);
  } catch (error) {
    logSubstackReaderFallback(options, {
      status: null,
      error
    });
    return null;
  }

  if (!response.ok) {
    logSubstackReaderFallback(options, {
      status: response.status
    });
    return null;
  }

  let post;
  try {
    post = await response.json();
  } catch (error) {
    logSubstackReaderFallback(options, {
      status: response.status,
      error
    });
    return null;
  }

  const bodyHtml = typeof post?.body_html === 'string' ? post.body_html : '';
  if (!bodyHtml) return null;

  const canonicalUrl = typeof post?.canonical_url === 'string' && post.canonical_url
    ? post.canonical_url
    : postRef.canonicalUrl;
  const contentHtml = sanitizeContent(bodyHtml, canonicalUrl);
  if (!contentHtml) return null;

  const { document } = parseHTML(`<article>${contentHtml}</article>`);
  const wordCount = integerOrNull(post?.wordcount) || countWords(document.body?.textContent || '');

  return {
    title: normalizeReaderText(post?.title) || fallbackTitle || deriveTitleFromUrl(canonicalUrl),
    byline: substackByline(post),
    excerpt: normalizeReaderText(post?.subtitle || post?.description) || '',
    siteName: postRef.siteName,
    wordCount,
    contentHtml,
    retrievedAt: new Date().toISOString()
  };
}

function parseSubstackPostRef(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
  const segments = parsed.pathname.split('/').filter(Boolean);
  let publication = '';
  let slug = '';

  if (host === 'open.substack.com') {
    if (segments[0] !== 'pub' || segments[2] !== 'p') return null;
    publication = segments[1] || '';
    slug = segments[3] || '';
  } else if (host.endsWith('.substack.com')) {
    if (segments[0] !== 'p') return null;
    publication = host.slice(0, -'.substack.com'.length);
    slug = segments[1] || '';
  } else {
    return null;
  }

  if (!publication || !slug) return null;
  const safePublication = publication.toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (!safePublication) return null;
  const safeSlug = encodeURIComponent(decodeURIComponent(slug));
  const publicationHost = `${safePublication}.substack.com`;

  return {
    apiUrl: `https://${publicationHost}/api/v1/posts/${safeSlug}`,
    canonicalUrl: `https://${publicationHost}/p/${safeSlug}`,
    siteName: publicationHost
  };
}

function substackByline(post) {
  const bylines = Array.isArray(post?.publishedBylines) ? post.publishedBylines : [];
  const names = bylines
    .map((byline) => normalizeReaderText(byline?.name || byline?.handle))
    .filter(Boolean);
  if (names.length > 0) return [...new Set(names)].join(', ');
  return '';
}

function normalizeReaderText(value) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim();
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number : null;
}

function logSubstackReaderFallback(options, details = {}) {
  if (!options?.log) return;
  options.log('warn', 'substack_reader_api_failed', {
    stage: 'reader_fetch',
    itemId: options.itemId || null,
    url: options.url || null,
    title: options.title || null,
    status: details.status || null,
    ...(details.error ? formatError(details.error) : {})
  });
}

async function fetchAndCacheReader({
  repository,
  id,
  url,
  title,
  browser,
  xBearerToken,
  forceRefresh = false,
  log
}) {
  if (!repository || !id || !url) return null;

  const cached = await repository.getReader(id);
  if (!forceRefresh && cached?.contentHtml && shouldCacheReader(cached)) {
    return cached;
  }

  const reader = await buildReaderContent(url, title, browser, {
    log,
    itemId: id,
    xBearerToken
  });
  if (!reader?.contentHtml || !shouldCacheReader(reader)) {
    if (forceRefresh && cached?.contentHtml && shouldCacheReader(cached)) {
      return cached;
    }
    if (log) {
      log('warn', 'reader_parse_failed', {
        stage: 'reader_parse',
        itemId: id,
        url,
        title,
        wordCount: reader?.wordCount || 0
      });
    }
    return null;
  }

  await repository.saveReader(id, reader);
  return reader;
}

async function fetchHtml(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml'
    }
  }, FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Reader fetch failed with ${response.status}`);
  }

  return response.text();
}

function extractReader(html, url, fallbackTitle) {
  if (!html) return null;
  const { document } = parseHTML(html);
  prepareDocument(document, url);

  // Pipeline: full-doc Readability, then container-focused Readability, then sanitized container fallback.
  const primaryReader = extractReaderFromDocument(document, url, fallbackTitle);
  if (shouldCacheReader(primaryReader)) {
    return primaryReader;
  }

  const contentRoot = findContentRoot(document);
  if (contentRoot) {
    const rootReader = extractReaderFromNode(contentRoot, url, fallbackTitle);
    if (shouldCacheReader(rootReader)) {
      return rootReader;
    }

    const metadata = deriveReaderMetadata({
      reader: primaryReader,
      document,
      fallbackTitle,
      url
    });

    const fallbackReader = buildReaderFromNode(contentRoot, url, metadata);
    if (fallbackReader) {
      return fallbackReader;
    }
  }

  return primaryReader;
}

function prepareDocument(document, url) {
  if (!document) return;
  try {
    document.URL = url;
    document.baseURI = url;
  } catch {
    // Ignore if not supported.
  }
}

function extractReaderFromDocument(document, url, fallbackTitle) {
  if (!document) return null;
  let reader;

  try {
    reader = new Readability(document).parse();
  } catch {
    return null;
  }

  if (!reader?.content) {
    return null;
  }

  const contentHtml = sanitizeContent(reader.content, url);
  if (!contentHtml) {
    return null;
  }

  const metadata = deriveReaderMetadata({
    reader,
    document,
    fallbackTitle,
    url
  });

  return {
    ...metadata,
    wordCount: reader.length || 0,
    contentHtml,
    retrievedAt: new Date().toISOString()
  };
}

function extractReaderFromNode(node, url, fallbackTitle) {
  const html = node?.outerHTML || node?.innerHTML || '';
  if (!html) return null;
  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  prepareDocument(document, url);
  return extractReaderFromDocument(document, url, fallbackTitle);
}

function buildReaderFromNode(node, url, metadata) {
  if (!node) return null;
  const textContent = node.textContent || '';
  const wordCount = countWords(textContent);
  if (!wordCount) return null;

  const contentHtml = sanitizeContent(node.innerHTML || '', url);
  if (!contentHtml) return null;

  return {
    title: metadata.title,
    byline: metadata.byline || '',
    excerpt: metadata.excerpt || '',
    siteName: metadata.siteName || '',
    wordCount,
    contentHtml,
    retrievedAt: new Date().toISOString()
  };
}

function deriveReaderMetadata({ reader, document, fallbackTitle, url }) {
  return {
    title: resolveTitle(reader, document, fallbackTitle, url),
    byline: reader?.byline || '',
    excerpt: reader?.excerpt || '',
    siteName: reader?.siteName || ''
  };
}

function resolveTitle(reader, document, fallbackTitle, url) {
  const docTitle = typeof document?.title === 'string' ? document.title.trim() : '';
  return reader?.title || docTitle || fallbackTitle || deriveTitleFromUrl(url);
}

function findContentRoot(document) {
  if (!document) return null;
  const candidates = getCandidateRoots(document);
  const bestCandidate = pickBestCandidate(candidates);
  if (bestCandidate) return bestCandidate;
  return findLargestTextBlock(document);
}

function getCandidateRoots(document) {
  const nodes = new Set();
  CONTENT_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if (!isNoiseNode(node)) {
        nodes.add(node);
      }
    });
  });
  return Array.from(nodes);
}

function pickBestCandidate(nodes) {
  let best = null;
  let bestScore = 0;

  nodes.forEach((node) => {
    const textContent = node.textContent || '';
    const wordCount = countWords(textContent);
    if (!wordCount) return;

    const pCount = node.querySelectorAll ? node.querySelectorAll('p').length : 0;
    if (pCount === 0 && wordCount < DEFAULT_MIN_WORD_COUNT) return;

    const score = wordCount + pCount * 20;
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  });

  return best;
}

function findLargestTextBlock(document) {
  const nodes = Array.from(document.querySelectorAll('article, main, section, div'));
  let best = null;
  let bestScore = 0;

  nodes.forEach((node) => {
    if (isNoiseNode(node)) return;
    const pCount = node.querySelectorAll ? node.querySelectorAll('p').length : 0;
    if (pCount < 2) return;
    const wordCount = countWords(node.textContent || '');
    if (!wordCount) return;
    const score = wordCount + pCount * 20;
    if (score > bestScore) {
      best = node;
      bestScore = score;
    }
  });

  return best;
}

function isNoiseNode(node) {
  if (!node) return false;
  if (typeof node.closest === 'function' && node.closest('nav, footer, header, aside')) {
    return true;
  }

  let current = node.parentNode;
  while (current) {
    const tag = current.tagName ? current.tagName.toLowerCase() : '';
    if (tag && NOISE_TAGS.has(tag)) {
      return true;
    }
    current = current.parentNode;
  }

  return false;
}

function sanitizeContent(html, baseUrl) {
  const { document } = parseHTML(`<article>${html}</article>`);
  const root = document.querySelector('article');
  if (!root) return '';

  sanitizeNode(root, baseUrl);
  return root.innerHTML.trim();
}

function sanitizeNode(node, baseUrl) {
  const children = Array.from(node.children || []);
  children.forEach((child) => {
    const tag = child.tagName ? child.tagName.toLowerCase() : '';

    if (REMOVE_TAGS.has(tag)) {
      child.remove();
      return;
    }

    if (tag && !ALLOWED_TAGS.has(tag)) {
      sanitizeNode(child, baseUrl);
      unwrapElement(child);
      return;
    }

    if (tag) {
      sanitizeAttributes(child, baseUrl);
    }

    sanitizeNode(child, baseUrl);
  });
}

function sanitizeAttributes(element, baseUrl) {
  const tag = element.tagName.toLowerCase();
  const allowed = ALLOWED_ATTRS.get(tag) || new Set();

  if (tag === 'img') {
    ensureImageSource(element, baseUrl);
  }

  if (tag === 'a') {
    const href = absolutizeUrl(element.getAttribute('href'), baseUrl);
    if (href) {
      element.setAttribute('href', href);
      element.setAttribute('target', '_blank');
      element.setAttribute('rel', 'noopener');
    } else {
      element.removeAttribute('href');
    }
  }

  if (tag === 'img') {
    const src = absolutizeUrl(element.getAttribute('src'), baseUrl);
    if (src) {
      element.setAttribute('src', src);
      element.setAttribute('loading', 'lazy');
      element.setAttribute('decoding', 'async');
    } else {
      element.removeAttribute('src');
    }

    const srcset = absolutizeSrcset(element.getAttribute('srcset'), baseUrl);
    if (srcset) {
      element.setAttribute('srcset', srcset);
    } else {
      element.removeAttribute('srcset');
    }
  }

  if (tag === 'source') {
    const srcset = absolutizeSrcset(element.getAttribute('srcset'), baseUrl);
    if (srcset) {
      element.setAttribute('srcset', srcset);
    } else {
      element.removeAttribute('srcset');
    }
  }

  Array.from(element.attributes).forEach((attr) => {
    const name = attr.name.toLowerCase();
    if (name.startsWith('on')) {
      element.removeAttribute(attr.name);
      return;
    }

    if (!allowed.has(name)) {
      element.removeAttribute(attr.name);
    }
  });
}

function ensureImageSource(element, baseUrl) {
  const src = element.getAttribute('src');
  if (src) return;

  const candidates = [
    element.getAttribute('data-src'),
    element.getAttribute('data-original'),
    element.getAttribute('data-lazy-src')
  ].filter(Boolean);

  if (candidates.length > 0) {
    const resolved = absolutizeUrl(candidates[0], baseUrl);
    if (resolved) {
      element.setAttribute('src', resolved);
    }
  }
}

function unwrapElement(element) {
  const parent = element.parentNode;
  if (!parent) {
    element.remove();
    return;
  }

  while (element.firstChild) {
    parent.insertBefore(element.firstChild, element);
  }

  parent.removeChild(element);
}

function pickItem(item) {
  return {
    id: item.id,
    url: item.url,
    title: item.title
  };
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

async function renderWithBrowser(url, browserBinding, log = null, logContext = null) {
  let browser;
  let page;

  try {
    browser = await puppeteer.launch(browserBinding);
    page = await browser.newPage();
    await page.setUserAgent(USER_AGENT);
    await page.setViewport({ width: 1280, height: 720 });
    page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);
    page.setDefaultTimeout(RENDER_TIMEOUT_MS);

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: RENDER_TIMEOUT_MS
    });

    await waitForRenderedContent(page);
    return await page.content();
  } catch (error) {
    if (log) {
      log('error', 'browser_render_failed', {
        stage: 'browser_render',
        url,
        title: logContext?.title || null,
        itemId: logContext?.itemId || null,
        ...formatError(error)
      });
    } else {
      console.error('Reader browser render failed:', error);
    }
    return null;
  } finally {
    if (page) {
      try {
        await page.close();
      } catch {}
    }
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
  }
}

async function waitForRenderedContent(page) {
  if (!page) return;

  try {
    await page.waitForFunction(
      (selector, minWords) => {
        const el = document.querySelector(selector);
        if (!el) return false;
        const text = (el.innerText || '').trim();
        if (!text) return false;
        return text.split(/\s+/).length >= minWords;
      },
      { timeout: Math.min(6000, RENDER_TIMEOUT_MS) },
      CONTENT_SELECTOR,
      DEFAULT_MIN_WORD_COUNT
    );
  } catch {
    // Selector wait is best-effort.
  }

  await waitForTextStability(page);
}

async function waitForTextStability(page) {
  const start = Date.now();
  let lastLength = 0;
  let stableFor = 0;

  while (Date.now() - start < RENDER_TIMEOUT_MS) {
    let length = 0;
    try {
      length = await page.evaluate(() => {
        if (!document.body) return 0;
        return document.body.innerText.length;
      });
    } catch {
      break;
    }

    if (Math.abs(length - lastLength) <= TEXT_STABILITY_THRESHOLD) {
      stableFor += TEXT_POLL_INTERVAL_MS;
    } else {
      stableFor = 0;
    }

    lastLength = length;
    if (stableFor >= RENDER_SETTLE_MS) {
      break;
    }

    await waitForDelay(page, TEXT_POLL_INTERVAL_MS);
  }
}

async function waitForDelay(page, ms) {
  if (page && typeof page.waitForTimeout === 'function') {
    await page.waitForTimeout(ms);
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export {
  sanitizeContent,
  fetchAndCacheReader,
  buildReaderContent
};
