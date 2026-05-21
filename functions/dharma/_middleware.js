import { injectFavoritesAssets } from '../api/content-library/html-assets.js';
import { getContentDb } from '../api/content-library/db.js';
import { safeJsonParse } from '../api/content-library/ids.js';

const FAVORITE_TITLE_PREFIX = '⭐️ ';

export async function onRequest(context) {
  const response = await context.next();
  const feedMatch = new URL(context.request.url).pathname.match(
    /^\/dharma\/([^/]+)\/(?:guided-)?feed\.xml$/
  );
  if (feedMatch && context.request.method !== 'HEAD') {
    return prefixStarredFeedTitles(context, response, feedMatch[1]);
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') || context.request.method === 'HEAD') {
    return response;
  }

  const html = await response.text();
  const output = injectFavoritesAssets(html);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function prefixStarredFeedTitles(context, response, corpus) {
  if (!response.ok) return response;

  const db = getContentDb(context.env);
  if (!db) return response;

  const xml = await response.text();
  try {
    const refs = await loadStarredDharmaRefs(db, decodeURIComponent(corpus));
    if (!hasStarredRefs(refs)) {
      return textResponse(response, xml);
    }
    return textResponse(response, prefixFeedItemTitles(xml, refs));
  } catch {
    return textResponse(response, xml);
  }
}

async function loadStarredDharmaRefs(db, corpus) {
  const result = await db.prepare(
    `SELECT i.canonical_key, i.canonical_url, i.source_url, i.extra_json
     FROM list_entries le
     JOIN lists l ON l.id = le.list_id
     JOIN items i ON i.id = le.item_id
     WHERE l.slug = 'starred'
       AND le.status = 'active'
       AND i.kind = 'dharma_talk'
       AND i.canonical_key LIKE ?`
  ).bind(`dharma_talk:${corpus}:%`).all();

  return collectDharmaRefs(result.results || []);
}

function collectDharmaRefs(rows) {
  const refs = {
    sourceIds: new Set(),
    safeIds: new Set(),
    urls: new Set()
  };

  for (const row of rows) {
    const extra = safeJsonParse(row.extra_json, {});
    addRef(refs.sourceIds, extra?.sourceId);
    addRef(refs.sourceIds, sourceIdFromCanonicalKey(row.canonical_key));
    addSafeIdFromUrl(refs, row.canonical_url);
    addSafeIdFromUrl(refs, row.source_url);
    addUrlRef(refs, row.canonical_url);
    addUrlRef(refs, row.source_url);
  }

  return refs;
}

function sourceIdFromCanonicalKey(canonicalKey) {
  const parts = String(canonicalKey || '').split(':');
  return parts.length >= 4 ? parts.at(-1) : '';
}

function addSafeIdFromUrl(refs, url) {
  const match = String(url || '').match(/\/talks\/([^/?#]+)\/?/);
  if (match) addRef(refs.safeIds, match[1]);
}

function addUrlRef(refs, url) {
  const value = String(url || '').trim();
  if (value) refs.urls.add(value);
}

function addRef(set, value) {
  const normalized = normalizeRef(value);
  if (normalized) set.add(normalized);
}

function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

function hasStarredRefs(refs) {
  return refs.sourceIds.size > 0 || refs.safeIds.size > 0 || refs.urls.size > 0;
}

function prefixFeedItemTitles(xml, refs) {
  return xml.replace(/<item>([\s\S]*?)<\/item>/g, (itemXml) => {
    if (!feedItemIsStarred(itemXml, refs)) return itemXml;
    return itemXml.replace(/<title>([\s\S]*?)<\/title>/, (titleXml, titleText) => {
      if (titleText.trimStart().startsWith('⭐')) return titleXml;
      return `<title>${FAVORITE_TITLE_PREFIX}${titleText}</title>`;
    });
  });
}

function feedItemIsStarred(itemXml, refs) {
  const guid = xmlText(itemXml, 'guid');
  const sourceId = guid.includes(':') ? guid.split(':').slice(1).join(':') : guid;
  if (refs.sourceIds.has(normalizeRef(sourceId))) return true;

  const link = xmlText(itemXml, 'link');
  const safeId = String(link || '').match(/\/talks\/([^/?#]+)\/?/)?.[1] || '';
  if (refs.safeIds.has(normalizeRef(safeId))) return true;

  return refs.urls.has(link);
}

function xmlText(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`));
  return decodeXmlEntities(match?.[1] || '').trim();
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function textResponse(sourceResponse, body) {
  const headers = new Headers(sourceResponse.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(body, {
    status: sourceResponse.status,
    statusText: sourceResponse.statusText,
    headers
  });
}
