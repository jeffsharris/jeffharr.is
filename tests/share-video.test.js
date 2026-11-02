import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import { selectXVideoVariant, safeXVideoUrl } from '../functions/api/share/x-media.js';
import { resolveXShareUrl } from '../functions/api/share/x-resolver.js';
import { renderSharePage } from '../functions/share/render.js';
import { onRequest as sharePage } from '../functions/share/[id].js';
import { secure } from '../functions/_middleware.js';

const mp4 = 'https://video.twimg.com/test/high.mp4?tag=12';
const poster = 'https://pbs.twimg.com/preview.jpg';
const variant = (url, bit_rate = 0) => ({ url, bit_rate, content_type: 'video/mp4' });

test('X media selects the highest-bitrate safe MP4 for videos and GIFs', () => {
  const variants = [variant('https://video.twimg.com/low.mp4', 100),
    { content_type: 'application/x-mpegURL', url: 'https://video.twimg.com/stream.m3u8' },
    variant(mp4, 1000), variant('https://untrusted.example/video.mp4', 9999), null];
  for (const type of ['video', 'animated_gif']) {
    assert.deepEqual(selectXVideoVariant({ type, variants }), { videoUrl: mp4, videoType: 'video/mp4' });
  }
  assert.equal(variants[0].bit_rate, 100, 'does not mutate provider input');
  for (const media of [null, { type: 'photo', variants }, { type: 'video' }, { type: 'video', variants: {} }]) {
    assert.equal(selectXVideoVariant(media), null);
  }
});

test('X media rejects unsafe, credentialed, non-MP4, and lookalike URLs', () => {
  for (const url of ['javascript:alert(1)', 'http://video.twimg.com/a.mp4',
    'https://video.twimg.com.evil.test/a.mp4', 'https://video.twimg.com@evil.test/a.mp4',
    'https://user:secret@video.twimg.com/a.mp4', 'https://video.twimg.com:8443/a.mp4',
    'https://video.twimg.com/a.m3u8', '', null]) assert.equal(safeXVideoUrl(url), '');
});

test('share resolver requests variants and preserves video-only and quoted media', async () => {
  const item = await resolveXShareUrl('https://x.com/alice/status/100', null, async (input) => {
    const url = new URL(input);
    assert.ok(url.searchParams.get('media.fields').split(',').includes('variants'));
    assert.ok(url.searchParams.get('expansions').split(',').includes('referenced_tweets.id.attachments.media_keys'));
    return Response.json({
      data: [{ id: '100', author_id: '1', text: 'A video', attachments: { media_keys: ['v1'] },
        referenced_tweets: [{ type: 'quoted', id: '99' }] }],
      includes: {
        users: [{ id: '1', username: 'alice' }],
        tweets: [{ id: '99', text: 'Quoted GIF', attachments: { media_keys: ['v2'] } }],
        media: [{ media_key: 'v1', type: 'video', variants: [variant(mp4)], preview_image_url: poster },
          { media_key: 'v2', type: 'animated_gif', variants: [variant(mp4)] }]
      }
    });
  }, { X_API_BEARER_TOKEN: 'test-token' });
  assert.equal(item.x.posts[0].media[0].videoUrl, mp4);
  assert.equal(item.x.posts[0].media[0].url, poster);
  assert.equal(item.x.posts[0].quotedPost.media[0].videoUrl, mp4);
  assert.equal(item.imageUrl, poster);
});

function render(media, quotedPost = null) {
  return renderSharePage({ id: 'x_test', type: 'x_post', x: { posts: [{ id: '100',
    url: 'https://x.com/alice/status/100', text: 'Video', media, quotedPost }] } }, 'https://jeffharr.is');
}

test('share page plays native video without X scripts, autoplay, or login embeds', () => {
  const html = render([{ type: 'video', videoUrl: mp4, previewImageUrl: poster, width: 720, height: 1280 }]);
  assert.match(html, /<video data-x-video controls playsinline preload="none"/);
  assert.match(html, /poster="https:\/\/pbs.twimg.com\/preview.jpg"/);
  assert.match(html, /width="720" height="1280" style="aspect-ratio: 720 \/ 1280"/);
  assert.match(html, /<source src="https:\/\/video.twimg.com\/test\/high.mp4\?tag=12" type="video\/mp4">/);
  assert.match(html, /data-video-error hidden role="status"/);
  assert.match(html, /<meta name="referrer" content="no-referrer">/);
  assert.doesNotMatch(html, /autoplay|<iframe|platform.twitter.com/);
});

test('GIFs and quoted videos play, and photos keep their image presentation', () => {
  const html = render([{ type: 'photo', url: poster, altText: 'A photo' }], {
    id: '99', url: 'https://x.com/alice/status/99', media: [
      { type: 'photo', url: poster }, { type: 'animated_gif', videoUrl: mp4 }
    ]
  });
  assert.match(html, /alt="A photo"/);
  assert.match(html, /loop muted/);
  assert.match(html, /<source /);
});

test('legacy and unavailable video shows an honest fallback; unsafe values cannot inject HTML', () => {
  const html = render([{ type: 'video', url: poster, videoUrl: 'javascript:alert(1)', width: '" onerror="bad', height: 10, altText: '"><script>bad</script>' }]);
  assert.doesNotMatch(html, /<video|<source|<script>bad|onerror="bad/);
  assert.match(html, /Video unavailable here/);
  assert.match(html, /View original on X/);
  assert.match(html, /&lt;script&gt;/);
});

test('player errors reveal a fallback, recovery hides it, and playing pauses other videos', () => {
  const { document, Event } = parseHTML(render([
    { type: 'video', videoUrl: mp4 }, { type: 'video', videoUrl: mp4 }
  ]));
  const [first, second] = document.querySelectorAll('video');
  let paused = 0;
  first.pause = () => {};
  second.pause = () => { paused++; };
  vm.runInNewContext(readFileSync(new URL('../share-assets/share.js', import.meta.url), 'utf8'), {
    document, navigator: { userAgent: '' }
  });
  const message = first.closest('figure').querySelector('[data-video-error]');
  assert.equal(message.hidden, true);
  first.querySelector('source').dispatchEvent(new Event('error'));
  assert.equal(message.hidden, false);
  first.dispatchEvent(new Event('loadeddata'));
  assert.equal(message.hidden, true);
  first.dispatchEvent(new Event('error'));
  assert.equal(message.hidden, false);
  first.dispatchEvent(new Event('play'));
  assert.equal(paused, 1);
});

test('public X pages preserve the no-referrer header through security middleware', async () => {
  const db = { prepare(sql) { return { bind() { return { async first() {
    return sql.includes('FROM share_details') ? {
      share_slug: 'x_test', item_id: 'item_test', render_kind: 'x_post', title: 'Video',
      item_extra_json: JSON.stringify({ x: { posts: [] } })
    } : null;
  } }; } }; } };
  const response = secure(await sharePage({ request: new Request('https://jeffharr.is/share/x_test'),
    env: { CONTENT_DB: db }, params: { id: 'x_test' } }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.match(await response.text(), /<meta name="referrer" content="no-referrer">/);
});
