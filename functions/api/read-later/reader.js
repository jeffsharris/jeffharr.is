/**
 * Reader extraction endpoint for read-later items.
 * Fetches remote content, extracts readable HTML, sanitizes, and caches in KV.
 */

import puppeteer from '@cloudflare/puppeteer';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { deriveTitleFromUrl } from '../read-later.js';
import { shouldCacheReader, absolutizeUrl, absolutizeSrcset } from './reader-utils.js';

const KV_PREFIX = 'item:';
const READER_PREFIX = 'reader:';
const FETCH_TIMEOUT_MS = 10000;
const RENDER_TIMEOUT_MS = 15000;
const RENDER_SETTLE_MS = 1200;
const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';

const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'blockquote', 'br', 'code', 'del', 'div', 'em', 'figure',
  'figcaption', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'li',
  'ol', 'p', 'picture', 'pre', 'section', 'small', 'source', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'th', 'thead', 'tr', 'ul', 'time',
  'article'
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

    const cached = await kv.get(`${READER_PREFIX}${id}`, { type: 'json' });
    if (cached?.contentHtml && shouldCacheReader(cached)) {
      return jsonResponse(
        { ok: true, item: pickItem(item), reader: cached },
        { status: 200, cache: 'public, max-age=3600' }
      );
    }

    if (cached?.contentHtml && !shouldCacheReader(cached)) {
      await kv.delete(`${READER_PREFIX}${id}`);
    }

    const reader = await buildReaderContent(item.url, item.title, env.BROWSER);
    if (!reader?.contentHtml || !shouldCacheReader(reader)) {
      return jsonResponse(
        { ok: false, reader: null, error: 'Reader unavailable' },
        { status: 200, cache: 'public, max-age=60' }
      );
    }

    await kv.put(`${READER_PREFIX}${id}`, JSON.stringify(reader));
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
  let reader = extractReader(html, url, fallbackTitle);

  if (!shouldCacheReader(reader) && browserBinding) {
    const renderedHtml = await renderWithBrowser(url, browserBinding);
    if (renderedHtml) {
      const renderedReader = extractReader(renderedHtml, url, fallbackTitle);
      if (shouldCacheReader(renderedReader)) {
        reader = renderedReader;
      }
    }
  }

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

  try {
    document.URL = url;
    document.baseURI = url;
  } catch {
    // Ignore if not supported.
  }

  const reader = new Readability(document).parse();
  if (!reader?.content) {
    return null;
  }

  const contentHtml = sanitizeContent(reader.content, url);
  if (!contentHtml) {
    return null;
  }

  return {
    title: reader.title || fallbackTitle || deriveTitleFromUrl(url),
    byline: reader.byline || '',
    excerpt: reader.excerpt || '',
    siteName: reader.siteName || '',
    wordCount: reader.length || 0,
    contentHtml,
    retrievedAt: new Date().toISOString()
  };
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

    await page.goto(url, {
      waitUntil: 'networkidle2',
      timeout: RENDER_TIMEOUT_MS
    });

    await page.waitForTimeout(RENDER_SETTLE_MS);
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


function jsonResponse(payload, { status = 200, cache = 'no-store' } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': cache
    }
  });
}

export { sanitizeContent };
