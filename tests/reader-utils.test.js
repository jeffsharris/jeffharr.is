import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldCacheReader,
  absolutizeUrl,
  absolutizeSrcset,
  countWords,
  looksClientRendered
} from '../functions/api/read-later/reader-utils.js';

test('shouldCacheReader requires content and minimum word count', () => {
  const manyWords = Array.from({ length: 55 }, (_, index) => `word${index + 1}`).join(' ');
  assert.equal(shouldCacheReader(null), false);
  assert.equal(shouldCacheReader({ contentHtml: '', wordCount: 100 }), false);
  assert.equal(shouldCacheReader({ contentHtml: '<p>Hi</p>', wordCount: 10 }), false);
  assert.equal(shouldCacheReader({ contentHtml: `<p>${manyWords}</p>`, wordCount: 50 }), true);
});

test('shouldCacheReader rejects known placeholder extraction text', () => {
  const placeholder = `
    <div>
      <p>Something went wrong, but don't fret — let's give it another shot.</p>
      <p>${Array.from({ length: 60 }, () => 'word').join(' ')}</p>
    </div>
  `;
  assert.equal(shouldCacheReader({ contentHtml: placeholder, wordCount: 160 }), false);
});

test('absolutizeUrl resolves relative URLs and rejects non-http', () => {
  assert.equal(
    absolutizeUrl('/path', 'https://example.com/base'),
    'https://example.com/path'
  );
  assert.equal(
    absolutizeUrl('https://example.com/ok', 'https://example.com'),
    'https://example.com/ok'
  );
  assert.equal(absolutizeUrl('data:text/plain,hi', 'https://example.com'), null);
});

test('absolutizeSrcset resolves multiple candidates', () => {
  const srcset = 'image-1x.jpg 1x, /img-2x.jpg 2x';
  assert.equal(
    absolutizeSrcset(srcset, 'https://example.com/articles/'),
    'https://example.com/articles/image-1x.jpg 1x, https://example.com/img-2x.jpg 2x'
  );
});

test('countWords returns word count for trimmed text', () => {
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   '), 0);
  assert.equal(countWords('hello world'), 2);
  assert.equal(countWords('one\ttwo\nthree'), 3);
});

test('looksClientRendered detects hydration markers', () => {
  assert.equal(looksClientRendered('<script src=\"/_next/static/app.js\"></script>'), true);
  assert.equal(looksClientRendered('window.__NUXT__ = {}'), true);
  assert.equal(looksClientRendered('<html><body><p>hi</p></body></html>'), false);
});
