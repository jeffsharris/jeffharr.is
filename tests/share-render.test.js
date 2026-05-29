import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSharePage } from '../functions/share/render.js';

test('renderSharePage collapses long podcast descriptions and keeps preview metadata short', () => {
  const description = [
    'This episode opens with a long setup about the paper and the central claim.',
    'It then follows the implications across selection pressure, agricultural societies, and the way old consensus positions can change.',
    'The closing section returns to why the argument matters for listeners who are trying to understand human history in a less static way.',
    'A fourth section adds more context about the field, the disputed assumptions, and why the debate has become newly relevant.',
    'A final section gives listeners enough detail to decide whether they want to read the original paper and follow the supporting evidence.'
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
  const preview = html.match(/<span data-description-preview>([^<]+)<\/span>/)?.[1] || '';
  const rest = html.match(/<span class="share-description__rest" data-description-rest hidden> ([^<]+)<\/span>/)?.[1] || '';

  assert.ok(preview.length <= 500);
  assert.ok(preview.length >= 375);
  assert.ok(rest.length > 0);
  assert.equal(`${preview} ${rest}`, description);
  assert.match(html, /data-description-toggle aria-expanded="false" aria-label="Show full description"/);
  assert.match(html, /share-description__ellipsis/);
  assert.ok(metaDescription.length <= 180);
  assert.match(metaDescription, /…$/);
  assert.doesNotMatch(html, /Copy RSS/);
  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="\/share-assets\/apple-touch-icon\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="A Long Episode">/);
});

test('renderSharePage uses resolved artwork for share detail home screen metadata', () => {
  const html = renderSharePage({
    id: 'p_with_artwork',
    type: 'podcast_episode',
    title: 'Episode With Artwork',
    description: 'A shared episode with specific artwork.',
    imageUrl: 'https://cdn.example.com/episode.png',
    platforms: {},
    media: {}
  }, 'https://jeffharr.is/share/p_with_artwork');

  assert.match(html, /<link rel="apple-touch-icon" sizes="180x180" href="https:\/\/cdn\.example\.com\/episode\.png">/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Episode With Artwork">/);
});
