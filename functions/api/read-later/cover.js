import { createReadLaterStores } from './stores.js';
import { getReadLaterAssetItemId } from './asset-store.js';

const CACHE_HIT = 'public, max-age=86400';
const CACHE_MISS = 'public, max-age=300';

export async function onRequest(context) {
  const { request, env } = context;
  const stores = createReadLaterStores(env, { requireAssets: true });
  if (!stores) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const { readLaterStore, assetStore } = stores;

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return new Response('Missing id', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const item = await readLaterStore.getItem(id);
    const cover = item ? await assetStore.getCoverBytes(getReadLaterAssetItemId(item)) : null;
    if (cover?.bytes) {
      return new Response(cover.bytes, {
        status: 200,
        headers: {
          'Content-Type': cover.contentType || 'image/png',
          'Cache-Control': CACHE_HIT
        }
      });
    }

    return new Response(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } });
  } catch (error) {
    console.error('Read later cover error:', error);
    return new Response(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } });
  }
}
