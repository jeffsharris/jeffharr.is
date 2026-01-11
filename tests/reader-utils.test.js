import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldCacheReader, absolutizeUrl, absolutizeSrcset } from '../functions/api/read-later/reader-utils.js';

test('shouldCacheReader requires content and minimum word count', () => {
  assert.equal(shouldCacheReader(null), false);
  assert.equal(shouldCacheReader({ contentHtml: '', wordCount: 100 }), false);
  assert.equal(shouldCacheReader({ contentHtml: '<p>Hi</p>', wordCount: 10 }), false);
  assert.equal(shouldCacheReader({ contentHtml: '<p>Hi</p>', wordCount: 50 }), true);
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
