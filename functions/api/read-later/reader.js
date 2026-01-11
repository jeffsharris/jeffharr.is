/**
 * Reader extraction endpoint for read-later items.
 * Fetches remote content, extracts readable HTML, sanitizes, and caches in KV.
 */

import puppeteer from '@cloudflare/puppeteer';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import {
  DEFAULT_MIN_WORD_COUNT,
  deriveTitleFromUrl,
  shouldCacheReader,
  absolutizeUrl,
  absolutizeSrcset,
  countWords,
  looksClientRendered
} from './reader-utils.js';

const KV_PREFIX = 'item:';
const READER_PREFIX = 'reader:';
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
  const kv = env.READ_LATER;

  if (!kv) {
    return jsonResponse(
      { ok: false, reader: null, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return jsonResponse(
      { ok: false, reader: null, error: 'Missing id' },
      { status: 400, cache: 'no-store' }
    );
  }

  try {
    const item = await kv.get(`${KV_PREFIX}${id}`, { type: 'json' });

    if (!item) {
      return jsonResponse(
        { ok: false, reader: null, error: 'Item not found' },
        { status: 404, cache: 'no-store' }
      );
    }

    const reader = await fetchAndCacheReader({
      kv,
      id,
      url: item.url,
      title: item.title,
      browser: env.BROWSER
    });

    if (!reader) {
      return jsonResponse(
        { ok: false, reader: null, error: 'Reader unavailable' },
        { status: 200, cache: 'public, max-age=60' }
      );
    }

    return jsonResponse(
      { ok: true, item: pickItem(item), reader },
      { status: 200, cache: 'public, max-age=3600' }
    );
  } catch (error) {
    console.error('Read later reader error:', error);
    return jsonResponse(
      { ok: false, reader: null, error: 'Reader unavailable' },
      { status: 200, cache: 'public, max-age=60' }
    );
  }
}

async function buildReaderContent(url, fallbackTitle, browserBinding) {
  const html = await fetchHtml(url);
  const preferBrowser = Boolean(browserBinding) && looksClientRendered(html);
  let reader = preferBrowser ? null : extractReader(html, url, fallbackTitle);

  if (!shouldCacheReader(reader) && browserBinding) {
    const renderedHtml = await renderWithBrowser(url, browserBinding);
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

async function fetchAndCacheReader({ kv, id, url, title, browser }) {
  if (!kv || !id || !url) return null;

  const cached = await kv.get(`${READER_PREFIX}${id}`, { type: 'json' });
  if (cached?.contentHtml && shouldCacheReader(cached)) {
    return cached;
  }

  if (cached?.contentHtml && !shouldCacheReader(cached)) {
    await kv.delete(`${READER_PREFIX}${id}`);
  }

  const reader = await buildReaderContent(url, title, browser);
  if (!reader?.contentHtml || !shouldCacheReader(reader)) {
    return null;
  }

  await kv.put(`${READER_PREFIX}${id}`, JSON.stringify(reader));
  return reader;
}

async function cacheReader(kv, id, reader) {
  if (!kv || !id || !reader) return false;
  if (!shouldCacheReader(reader)) return false;
  await kv.put(`${READER_PREFIX}${id}`, JSON.stringify(reader));
  return true;
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

async function renderWithBrowser(url, browserBinding) {
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
    console.error('Reader browser render failed:', error);
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

    await page.waitForTimeout(TEXT_POLL_INTERVAL_MS);
  }
}


function jsonResponse(payload, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache
    }
  });
}

export {
  sanitizeContent,
  fetchAndCacheReader,
  buildReaderContent,
  cacheReader
};
