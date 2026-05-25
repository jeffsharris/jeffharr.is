import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest, normalizeTweetsResponse, sanitizeUsername } from '../functions/api/x.js';

test('sanitizeUsername strips handles and unsafe characters', () => {
  assert.equal(sanitizeUsername('@jeffintime'), 'jeffintime');
  assert.equal(sanitizeUsername(' jeff.in-time! '), 'jeffintime');
});

test('normalizeTweetsResponse maps posts and expanded media', () => {
  const tweets = normalizeTweetsResponse({
    data: [
      {
        id: '123',
        text: 'A recent post',
        created_at: '2026-05-25T05:00:00.000Z',
        attachments: { media_keys: ['media-1'] },
        public_metrics: { like_count: 4 }
      }
    ],
    includes: {
      media: [
        {
          media_key: 'media-1',
          type: 'photo',
          url: 'https://pbs.twimg.com/media/example.jpg',
          alt_text: 'Example image',
          width: 1200,
          height: 800
        }
      ]
    }
  }, 'jeffintime');

  assert.equal(tweets.length, 1);
  assert.equal(tweets[0].url, 'https://x.com/jeffintime/status/123');
  assert.equal(tweets[0].publishedAt, '2026-05-25T05:00:00.000Z');
  assert.equal(tweets[0].media[0].url, 'https://pbs.twimg.com/media/example.jpg');
  assert.equal(tweets[0].metrics.like_count, 4);
});

test('x endpoint returns profile fallback without API credentials', async () => {
  const response = await onRequest({
    request: new Request('https://example.com/api/x'),
    env: {}
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.profileUrl, 'https://x.com/jeffintime');
  assert.deepEqual(payload.tweets, []);
});
