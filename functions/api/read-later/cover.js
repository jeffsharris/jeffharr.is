import { getCoverImage } from './covers.js';
import { getAssetByRole, getContentAssets, getContentDb } from '../content-library/db.js';
import { getBinaryAsset } from '../content-library/assets.js';
import { getReadLaterRow } from '../content-library/read-later-store.js';

const CACHE_HIT = 'public, max-age=86400';
const CACHE_MISS = 'public, max-age=300';

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.READ_LATER;
  const contentDb = shouldUseContentLibrary(env) ? getContentDb(env) : null;

  if (contentDb) {
    return handleContentLibraryCover(request, env, contentDb);
  }

  if (!kv) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return new Response('Missing id', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const cover = await getCoverImage(kv, id);
    if (cover?.base64) {
      const bytes = decodeBase64(cover.base64);
      return new Response(bytes, {
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

async function handleContentLibraryCover(request, env, db) {
  const bucket = getContentAssets(env);
  if (!bucket) {
    return new Response(null, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }

  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();

  if (!id) {
    return new Response('Missing id', { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  try {
    const row = await getReadLaterRow(db, id);
    if (!row) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } });
    }
    const asset = await getAssetByRole(db, row.item_id, 'generated_cover');
    const stored = await getBinaryAsset({ bucket, asset });
    if (stored?.bytes) {
      return new Response(stored.bytes, {
        status: 200,
        headers: {
          'Content-Type': stored.contentType || 'image/png',
          'Cache-Control': CACHE_HIT
        }
      });
    }
    return new Response(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } });
  } catch (error) {
    console.error('Read later content-library cover error:', error);
    return new Response(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } });
  }
}

function decodeBase64(base64) {
  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function shouldUseContentLibrary(env) {
  return Boolean(env?.CONTENT_DB && env?.CONTENT_ASSETS && env?.CONTENT_LIBRARY_READ_LATER === '1');
}
