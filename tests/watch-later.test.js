import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { directVideo, isVideoUrl } from '../functions/api/read-later/media-utils.js';
import { enrichXVideos, selectXVideo, onRequest } from '../functions/api/read-later/video.js';
import { listReadLaterItems } from '../functions/api/content-library/read-later-store.js';

test('video classification distinguishes provider videos from text and profile pages', () => {
  for (const url of ['https://youtu.be/dQw4w9WgXcQ', 'https://vimeo.com/12345', 'https://www.tiktok.com/@author/video/123', 'https://example.com/movie.MP4?token=value']) {
    assert.equal(isVideoUrl(url), true, url);
  }
  for (const url of ['https://x.com/person/status/123', 'https://example.com/article', 'https://vimeo.com/settings', 'https://evil.com/watch?v=dQw4w9WgXcQ']) {
    assert.equal(isVideoUrl(url), false, url);
  }
  assert.equal(directVideo('file:///private/movie.mp4'), null);
  assert.equal(directVideo('https://example.com/stream.m3u8').contentType, 'application/x-mpegURL');
});

test('website recognizes legacy YouTube and direct videos, but keeps X text in Read', () => {
  const context = { window: {}, URL };
  vm.runInNewContext(readFileSync(new URL('../js/media-utils.js', import.meta.url), 'utf8'), context);
  const classify = context.window.JeffMedia.isVideoItem;
  assert.equal(classify({ url: 'https://youtu.be/dQw4w9WgXcQ' }), true);
  assert.equal(classify({ url: 'https://example.com/test.mp4' }), true);
  assert.equal(classify({ url: 'https://x.com/person/status/1' }), false);
  assert.equal(classify({ url: 'https://x.com/person/status/1', video: { url: 'https://video.twimg.com/test.mp4' } }), true);
});

test('X stream selection chooses the highest bitrate playable HTTPS MP4', () => {
  const video = selectXVideo({ type: 'video', preview_image_url: 'https://pbs.twimg.com/preview.jpg', variants: [
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/a.m3u8' },
    { content_type: 'video/mp4', bit_rate: 800, url: 'https://video.twimg.com/low.mp4' },
    { content_type: 'video/mp4', bit_rate: 2000, url: 'https://video.twimg.com/high.mp4' },
    { content_type: 'video/mp4', bit_rate: 5000, url: 'javascript:bad' }
  ] });
  assert.equal(video.url, 'https://video.twimg.com/high.mp4');
  assert.equal(video.thumbnailUrl, 'https://pbs.twimg.com/preview.jpg');
  assert.equal(selectXVideo({ type: 'photo', variants: [] }), null);
});

test('X enrichment batches requests and caches both video and text results', async () => {
  const writes = [];
  const db = { prepare: () => ({ bind: (...args) => ({ run: async () => writes.push(args) }) }) };
  const items = [1, 2].map(id => ({ id: `entry-${id}`, itemId: `item-${id}`, url: `https://x.com/person/status/${id}` }));
  items[0].video = { provider: 'x', url: 'https://video.twimg.com/older.mp4' };
  items[0].videoCheckedAt = new Date().toISOString();
  let requests = 0;
  const fetchImpl = async endpoint => {
    requests++;
    assert.equal(endpoint.hostname, 'api.x.com');
    assert.equal(endpoint.searchParams.get('ids'), '1,2');
    assert.equal(endpoint.searchParams.get('tweet.fields'), 'attachments');
    return Response.json({ data: [{ id: '1', attachments: { media_keys: ['v'] } }, { id: '2' }], includes: { media: [
      { media_key: 'v', type: 'video', variants: [{ content_type: 'video/mp4', url: 'https://video.twimg.com/a.mp4', bit_rate: 100 }] }
    ] } });
  };
  await enrichXVideos(db, items, { X_API_BEARER_TOKEN: 'test-only' }, fetchImpl);
  assert.equal(writes.length, 2);
  assert.equal(writes[0][2], 'item-1');
  assert.equal(items[0].video.provider, 'x');
  assert.equal(items[1].video, null);
  await enrichXVideos(db, items, { X_API_BEARER_TOKEN: 'test-only' }, fetchImpl);
  assert.equal(requests, 1);
});

test('missing credentials and provider failures leave saved items available', async () => {
  const items = [{ id: '1', itemId: 'item-1', url: 'https://x.com/person/status/1' }];
  const original = structuredClone(items);
  await enrichXVideos(null, items, {}, () => { throw new Error('must not fetch'); });
  await enrichXVideos(null, items, { X_API_BEARER_TOKEN: 'test-only' }, async () => new Response('', { status: 429 }));
  assert.deepEqual(items, original);
  const response = await onRequest({ request: new Request('https://example.com/api/read-later/video', { method: 'POST' }), env: {} });
  assert.equal(response.status, 405);
});

test('video preview fills missing legacy source thumbnails in list responses', async () => {
  const row = {
    entry_id: 'entry-1', item_id: 'item-1', item_kind: 'x_post',
    canonical_url: 'https://x.com/person/status/1', title: 'Video',
    item_extra_json: JSON.stringify({ video: { provider: 'x', thumbnailUrl: 'https://pbs.twimg.com/preview.jpg' } })
  };
  const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [row] }) }) }) };
  const [item] = await listReadLaterItems(db);
  assert.equal(item.kind, 'video');
  assert.equal(item.thumbnailUrl, 'https://pbs.twimg.com/preview.jpg');
});
