import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { onRequest } from '../functions/poems/_middleware.js';

test('poem middleware injects per-poem share preview metadata', async () => {
  let nextCalled = false;
  const response = await onRequest({
    request: new Request('https://jeffharr.is/poems/?poem=kubla-kahn'),
    env: {
      ASSETS: mockAssets({
        '/poems/index.html': readFileSync('poems/index.html', 'utf8'),
        '/poems/manifest.json': readFileSync('poems/manifest.json', 'utf8'),
        '/poems/content/kubla-kahn.md': readFileSync('poems/content/kubla-kahn.md', 'utf8')
      })
    },
    next: async () => {
      nextCalled = true;
      return new Response('next');
    }
  });

  const html = await response.text();

  assert.equal(nextCalled, false);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=UTF-8');
  assert.match(html, /<title>Kubla Kahn by Samuel Taylor Coleridge \| Poems \| Jeff Harris<\/title>/);
  assert.match(html, /<meta name="description" content="In Xanadu did Kubla Khan · A stately pleasure-dome decree: · Where Alph, the sacred river, ran">/);
  assert.match(html, /<meta property="og:title" content="Kubla Kahn by Samuel Taylor Coleridge">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/jeffharr\.is\/poems\/images\/kubla-kahn\.jpg">/);
  assert.match(html, /<meta property="og:image:width" content="1024">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/jeffharr\.is\/poems\/\?poem=kubla-kahn">/);
  assert.doesNotMatch(html, /images\/social\/poems-card\.jpg/);
});

test('poem middleware passes through non-poem requests', async () => {
  let nextCalled = false;
  const response = await onRequest({
    request: new Request('https://jeffharr.is/poems/'),
    env: { ASSETS: mockAssets({}) },
    next: async () => {
      nextCalled = true;
      return new Response('next');
    }
  });

  assert.equal(nextCalled, true);
  assert.equal(await response.text(), 'next');
});

function mockAssets(files) {
  return {
    async fetch(input) {
      const url = new URL(input.url || input);
      const body = files[url.pathname];

      if (body === undefined) {
        return new Response('not found', { status: 404 });
      }

      const contentType = url.pathname.endsWith('.json')
        ? 'application/json'
        : url.pathname.endsWith('.md')
          ? 'text/markdown'
          : 'text/html';

      return new Response(body, {
        headers: { 'Content-Type': contentType }
      });
    }
  };
}
