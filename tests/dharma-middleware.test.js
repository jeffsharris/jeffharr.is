import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/dharma/_middleware.js';

test('Dharma RSS middleware prefixes starred talk titles', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<title>Alan Watts</title>
<item><title>The Tea Ceremony</title><link>https://jeffharr.is/dharma/watts/talks/watts-bb0654/</link><guid isPermaLink="false">watts:bb0654</guid></item>
<item><title>Other Talk</title><link>https://jeffharr.is/dharma/watts/talks/watts-bb0001/</link><guid isPermaLink="false">watts:bb0001</guid></item>
</channel></rss>`;
  const response = await onRequest({
    request: new Request('https://jeffharr.is/dharma/watts/feed.xml'),
    env: {
      CONTENT_DB: createDharmaFavoritesDb([
        {
          canonical_key: 'dharma_talk:watts:KPFA Archive:bb0654',
          canonical_url: 'https://jeffharr.is/dharma/watts/talks/watts-bb0654/',
          source_url: 'https://example.com/audio/bb0654.mp3',
          extra_json: JSON.stringify({ sourceId: 'bb0654' })
        }
      ])
    },
    next: async () => new Response(xml, {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
    })
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(body, /<title>Alan Watts<\/title>/);
  assert.match(body, /<title>⭐️ The Tea Ceremony<\/title>/);
  assert.match(body, /<title>Other Talk<\/title>/);
});

test('Dharma RSS middleware does not duplicate existing favorite prefixes', async () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0"><channel>
<item><title>⭐️ The Tea Ceremony</title><link>https://jeffharr.is/dharma/watts/talks/watts-bb0654/</link><guid isPermaLink="false">watts:bb0654</guid></item>
</channel></rss>`;
  const response = await onRequest({
    request: new Request('https://jeffharr.is/dharma/watts/feed.xml'),
    env: {
      CONTENT_DB: createDharmaFavoritesDb([
        {
          canonical_key: 'dharma_talk:watts:KPFA Archive:bb0654',
          canonical_url: 'https://jeffharr.is/dharma/watts/talks/watts-bb0654/',
          source_url: null,
          extra_json: JSON.stringify({ sourceId: 'bb0654' })
        }
      ])
    },
    next: async () => new Response(xml, {
      headers: { 'content-type': 'application/rss+xml; charset=utf-8' }
    })
  });
  const body = await response.text();

  assert.equal(body.match(/⭐️/g).length, 1);
});

function createDharmaFavoritesDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM list_entries le/);
      return {
        all: async () => ({ results: rows })
      };
    }
  };
}
