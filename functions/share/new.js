import { resolveShareUrl, ShareResolveError } from '../api/share/podcast-resolver.js';
import { getShareKv, saveShareItem } from '../api/share/store.js';
import { renderLoadingPage, renderRedirectPage } from './render.js';
import { getContentDb } from '../api/content-library/db.js';
import { saveShareItemToContentLibrary } from '../api/content-library/share-store.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rawInput = getQueryParamPreservingPlus(url, 'url') ||
    url.searchParams.get('text') ||
    url.searchParams.get('title') ||
    '';
  const kv = getShareKv(env);
  const contentDb = shouldUseContentLibrary(env) ? getContentDb(env) : null;

  if ((!contentDb && !kv) || !rawInput) {
    return Response.redirect(new URL('/share?error=missing-url', request.url), 303);
  }

  if ((request.headers.get('accept') || '').includes('text/html') && url.searchParams.get('resolve') !== '1') {
    return new Response(renderLoadingPage(rawInput, request.url), {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store'
      }
    });
  }

  try {
    const resolvedItem = await resolveShareUrl(rawInput, { env });
    const item = contentDb
      ? await saveShareItemToContentLibrary({
        db: contentDb,
        item: resolvedItem,
        sourceUrl: rawInput,
        requestUrl: request.url
      })
      : await saveShareItem({ kv, item: resolvedItem, sourceUrl: rawInput });
    const shareUrl = new URL(`/share/${item.id}`, request.url).href;

    if ((request.headers.get('accept') || '').includes('text/html')) {
      return new Response(renderRedirectPage(shareUrl), {
        status: 200,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store'
        }
      });
    }

    return Response.redirect(shareUrl, 303);
  } catch (error) {
    const message = error instanceof ShareResolveError ? error.message : 'resolve-failed';
    const redirectUrl = new URL('/share', request.url);
    redirectUrl.searchParams.set('error', message);
    return Response.redirect(redirectUrl, 303);
  }
}

function shouldUseContentLibrary(env) {
  return Boolean(env?.CONTENT_DB && env?.CONTENT_LIBRARY_SHARE === '1');
}

export function getQueryParamPreservingPlus(url, name) {
  const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;
  for (const part of query.split('&')) {
    if (!part) continue;
    const [rawKey, ...rawValueParts] = part.split('=');
    if (decodeURIComponent(rawKey || '') !== name) continue;
    return decodeURIComponent(rawValueParts.join('=') || '');
  }
  return '';
}
