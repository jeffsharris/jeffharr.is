import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSharePage } from '../functions/share/render.js';

test('renderSharePage shows full podcast descriptions but keeps preview metadata short', () => {
  const description = [
    'This episode opens with a long setup about the paper and the central claim.',
    'It then follows the implications across selection pressure, agricultural societies, and the way old consensus positions can change.',
    'The closing section returns to why the argument matters for listeners who are trying to understand human history in a less static way.'
  ].join(' ');
  const html = renderSharePage({
    id: 'p_long_description',
    type: 'podcast_episode',
    title: 'A Long Episode',
    description,
    platforms: {
      rss: { label: 'RSS Feed', url: 'https://example.com/feed.xml', kind: 'rss' }
    },
    podcast: {
      title: 'Example Podcast',
      feedUrl: 'https://example.com/feed.xml'
    },
    media: {}
  }, 'https://jeffharr.is/share/p_long_description');
  const metaDescription = html.match(/<meta name="description" content="([^"]+)">/)?.[1] || '';

  assert.ok(html.includes(`<p class="share-description">${description}</p>`));
  assert.ok(metaDescription.length <= 180);
  assert.match(metaDescription, /…$/);
  assert.doesNotMatch(html, /Copy RSS/);
});
