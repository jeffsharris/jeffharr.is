import { getCoverImage } from './covers.js';

const CACHE_HIT = 'public, max-age=86400';
const CACHE_MISS = 'public, max-age=300';

export async function onRequest(context) {
  const { request, env } = context;
  const kv = env.READ_LATER;

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
    if (!cover?.base64) {
      return new Response(null, { status: 404, headers: { 'Cache-Control': CACHE_MISS } });
    }

    const bytes = decodeBase64(cover.base64);
    return new Response(bytes, {
      status: 200,
      headers: {
        'Content-Type': cover.contentType || 'image/png',
        'Cache-Control': CACHE_HIT
      }
    });
  } catch (error) {
    console.error('Read later cover error:', error);
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
