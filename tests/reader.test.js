import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReaderContent } from '../functions/api/read-later/reader.js';

test('buildReaderContent uses Substack post API for open.substack article URLs', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  const bodyText = Array.from({ length: 70 }, (_, index) => `word${index + 1}`).join(' ');

  globalThis.fetch = async (url) => {
    calls.push(String(url));
    assert.equal(
      String(url),
      'https://smalldweeb.substack.com/api/v1/posts/learning-how-to-fuck'
    );
    return new Response(JSON.stringify({
      title: 'learning how to fuck',
      subtitle: 'and still searching for love in the modern dating age',
      canonical_url: 'https://smalldweeb.substack.com/p/learning-how-to-fuck',
      body_html: `<p>${bodyText}</p>`,
      wordcount: 70,
      publishedBylines: [{ name: 'azul' }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    const reader = await buildReaderContent(
      'https://open.substack.com/pub/smalldweeb/p/learning-how-to-fuck?r=lpau&utm_medium=ios',
      'Fallback title',
      null
    );

    assert.equal(reader.title, 'learning how to fuck');
    assert.equal(reader.byline, 'azul');
    assert.equal(reader.siteName, 'smalldweeb.substack.com');
    assert.equal(reader.wordCount, 70);
    assert.match(reader.contentHtml, /word70/);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
