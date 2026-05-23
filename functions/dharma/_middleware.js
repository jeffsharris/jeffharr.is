import { injectFavoritesAssets } from '../api/content-library/html-assets.js';
import { getContentDb } from '../api/content-library/db.js';
import {
  feedItemIsStarred,
  hasStarredRefs,
  loadStarredDharmaRefs
} from '../api/dharma/starred.js';

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
    const decodedCorpus = decodeURIComponent(corpus);
    const refs = await loadStarredDharmaRefs(db, decodedCorpus);
    if (!hasStarredRefs(refs, decodedCorpus)) {
      return textResponse(response, xml);
    }
    return textResponse(response, prefixFeedItemTitles(xml, refs, decodedCorpus));
  } catch {
    return textResponse(response, xml);
  }
}

function prefixFeedItemTitles(xml, refs, corpus) {
  return xml.replace(/<item>([\s\S]*?)<\/item>/g, (itemXml) => {
    if (!feedItemIsStarred(itemXml, refs, corpus)) return itemXml;
    return itemXml.replace(/<title>([\s\S]*?)<\/title>/, (titleXml, titleText) => {
      if (titleText.trimStart().startsWith('⭐')) return titleXml;
      return `<title>${FAVORITE_TITLE_PREFIX}${titleText}</title>`;
    });
  });
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
