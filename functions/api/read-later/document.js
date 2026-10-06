import { createReadLaterStores } from './stores.js';
import { getReadLaterAssetItemId } from './asset-store.js';

// Original PDFs are served from our saved copy, never redirected to an expiring source.
export async function onRequest({ request, env }) {
  const stores = createReadLaterStores(env, { requireAssets: true });
  if (!stores) return new Response('Document storage unavailable', { status: 503 });
  return handleDocument({ request, ...stores });
}

export async function handleDocument({ request, readLaterStore, assetStore }) {
  if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return new Response('Missing id', { status: 400 });
  const item = await readLaterStore.getItem(id);
  if (!item) return new Response('Document not found', { status: 404 });
  const pdf = await assetStore.getOriginalPdf(getReadLaterAssetItemId(item));
  if (!pdf?.bytes) return new Response('Document not saved yet', { status: 404, headers: { 'cache-control': 'no-store' } });
  return new Response(request.method === 'HEAD' ? null : pdf.bytes, {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(pdf.filename)}`,
      'content-length': String(pdf.bytes.byteLength),
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff'
    }
  });
}
