import { getShareKv, listShareHistory } from '../share/store.js';

export async function onRequest(context) {
  const kv = getShareKv(context.env);
  if (!kv) {
    return jsonResponse({ items: [], count: 0 }, { status: 200 });
  }

  const url = new URL(context.request.url);
  const limit = clamp(Number.parseInt(url.searchParams.get('limit') || '100', 10), 1, 250);
  const items = await listShareHistory(kv, { limit });
  return jsonResponse({ items, count: items.length }, { status: 200 });
}

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function clamp(value, min, max) {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}
