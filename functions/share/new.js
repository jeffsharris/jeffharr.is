import { resolveShareUrl, ShareResolveError } from '../api/share/podcast-resolver.js';
import { getShareKv, saveShareItem } from '../api/share/store.js';
import { renderRedirectPage } from './render.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const rawInput = getQueryParamPreservingPlus(url, 'url') ||
    url.searchParams.get('text') ||
    url.searchParams.get('title') ||
    '';
  const kv = getShareKv(env);

  if (!kv || !rawInput) {
    return Response.redirect(new URL('/share?error=missing-url', request.url), 303);
  }

  try {
    const resolvedItem = await resolveShareUrl(rawInput, { env });
    const item = await saveShareItem({ kv, item: resolvedItem, sourceUrl: rawInput });
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
