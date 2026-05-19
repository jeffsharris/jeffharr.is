import { createLogger, formatError } from './lib/logger.js';
import { resolveShareUrl, ShareResolveError } from './share/podcast-resolver.js';
import { getContentDb } from './content-library/db.js';
import { saveShareItemToContentLibrary } from './content-library/share-store.js';

export async function onRequest(context) {
  const { request, env } = context;
  const logger = createLogger({ request, source: 'share' });
  const log = logger.log;
  const db = getContentDb(env);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  if (!db) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse({ ok: false, error: 'Storage unavailable' }, { status: 500 });
  }

  try {
    const payload = await readPayload(request);
    const rawUrl = payload?.url || payload?.text || '';
    const resolvedItem = await resolveShareUrl(rawUrl, { env });
    const item = await saveShareItemToContentLibrary({
      db,
      item: resolvedItem,
      sourceUrl: rawUrl,
      requestUrl: request.url
    });
    const shareUrl = new URL(`/share/${item.id}`, request.url).href;

    log('info', 'share_created', {
      stage: 'create',
      itemId: item.id,
      type: item.type,
      sourceUrl: item.sourceUrl
    });

    return jsonResponse({ ok: true, item, shareUrl }, { status: 201 });
  } catch (error) {
    const status = error instanceof ShareResolveError ? error.status : 500;
    log(status >= 500 ? 'error' : 'warn', 'share_failed', {
      stage: 'create',
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: status >= 500 ? 'Failed to create share link' : error.message },
      { status }
    );
  }
}

async function readPayload(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return request.json();
  }
  if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
    const formData = await request.formData();
    return {
      url: formData.get('url'),
      text: formData.get('text'),
      title: formData.get('title')
    };
  }
  return { url: await request.text() };
}

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}
