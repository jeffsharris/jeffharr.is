import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isXStatusUrl,
  parseTweetIdFromUrl,
  buildXReaderFromUrl
} from '../functions/api/read-later/x-adapter.js';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

test('parseTweetIdFromUrl and isXStatusUrl support x and twitter hosts', () => {
  assert.equal(isXStatusUrl('https://x.com/user/status/123456789'), true);
  assert.equal(isXStatusUrl('https://twitter.com/user/status/123456789'), true);
  assert.equal(isXStatusUrl('https://example.com/user/status/123456789'), false);
  assert.equal(parseTweetIdFromUrl('https://x.com/user/status/123456789?s=12'), '123456789');
  assert.equal(parseTweetIdFromUrl('https://x.com/home'), null);
});

test('buildXReaderFromUrl returns article content and media metadata', async () => {
  const sourceText = Array.from({ length: 80 }, (_, index) => `token${index}`).join(' ');
  const payload = {
    data: [
      {
        id: '2022788750388998543',
        author_id: '1',
        text: 'https://t.co/a',
        article: {
          title: 'Article title',
          preview_text: 'Article preview',
          plain_text: sourceText,
          cover_media: '3_cover',
          media_entities: ['3_inline_1']
        }
      }
    ],
    includes: {
      users: [{ id: '1', name: 'Ray Dalio', username: 'RayDalio' }],
      media: [
        { media_key: '3_cover', type: 'photo', url: 'https://pbs.twimg.com/media/cover.jpg' },
        { media_key: '3_inline_1', type: 'photo', url: 'https://pbs.twimg.com/media/inline-1.jpg' }
      ]
    }
  };

  const reader = await buildXReaderFromUrl(
    'https://x.com/raydalio/status/2022788750388998543',
    'https://x.com/raydalio/status/2022788750388998543',
    'test-token',
    {
      fetchImpl: async () => jsonResponse(payload)
    }
  );

  assert.ok(reader);
  assert.equal(reader.title, 'Article title');
  assert.equal(reader.siteName, 'X (formerly Twitter)');
  assert.equal(reader.coverImageUrl, 'https://pbs.twimg.com/media/cover.jpg');
  assert.deepEqual(reader.imageUrls, ['https://pbs.twimg.com/media/inline-1.jpg']);
  assert.ok(reader.contentHtml.includes('<img src="https://pbs.twimg.com/media/inline-1.jpg"'));
  assert.equal(reader.wordCount, 80);
});

test('buildXReaderFromUrl prefers note_tweet text when article is absent', async () => {
  const payload = {
    data: [
      {
        id: '2005768629691019544',
        author_id: '2',
        text: 'short text',
        note_tweet: {
          text: 'This is the full long-form note tweet text with enough words to parse cleanly.',
          entities: {
            urls: []
          }
        }
      }
    ],
    includes: {
      users: [{ id: '2', name: 'Addy Osmani', username: 'addyosmani' }],
      media: []
    }
  };

  const reader = await buildXReaderFromUrl(
    'https://x.com/addyosmani/status/2005768629691019544',
    'https://x.com/addyosmani/status/2005768629691019544',
    'test-token',
    {
      fetchImpl: async () => jsonResponse(payload)
    }
  );

  assert.ok(reader);
  assert.ok(reader.contentHtml.includes('This is the full long-form note tweet'));
  assert.equal(reader.coverImageUrl, null);
});

test('buildXReaderFromUrl returns null when token is missing or response fails', async () => {
  const url = 'https://x.com/user/status/123';

  const missingToken = await buildXReaderFromUrl(url, url, '');
  assert.equal(missingToken, null);

  const failedResponse = await buildXReaderFromUrl(url, url, 'token', {
    fetchImpl: async () => jsonResponse({ error: 'bad' }, 500)
  });
  assert.equal(failedResponse, null);
});
