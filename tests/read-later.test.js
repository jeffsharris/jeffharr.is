import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createItem,
  normalizeTitle,
  normalizeUrl,
  preferReaderTitle
} from '../functions/api/read-later.js';

test('normalizeUrl accepts https URLs', () => {
  const url = normalizeUrl('https://example.com/path');
  assert.equal(url, 'https://example.com/path');
});

test('normalizeUrl adds https scheme when missing', () => {
  const url = normalizeUrl('example.com/path');
  assert.equal(url, 'https://example.com/path');
});

test('normalizeUrl rejects non-http schemes', () => {
  const url = normalizeUrl('javascript:alert(1)');
  assert.equal(url, null);
});

test('normalizeTitle uses hostname when title is empty', () => {
  const title = normalizeTitle('', 'https://www.example.com/path');
  assert.equal(title, 'example.com');
});

test('createItem sets read defaults', () => {
  const item = createItem({
    id: 'test-id',
    url: 'https://example.com',
    title: 'Example',
    savedAt: '2024-01-01T00:00:00.000Z'
  });

  assert.equal(item.id, 'test-id');
  assert.equal(item.read, false);
  assert.equal(item.readAt, null);
  assert.equal(item.savedAt, '2024-01-01T00:00:00.000Z');
});

test('preferReaderTitle keeps the existing title when it is complete', () => {
  const title = preferReaderTitle(
    'Video Games as Art',
    'Video Games as Art · Gwern.net',
    'https://gwern.net/video-game-art'
  );
  assert.equal(title, 'Video Games as Art');
});

test('preferReaderTitle upgrades single-word prefixes using reader title', () => {
  const title = preferReaderTitle(
    'Claude\'s',
    'Claude\'s new constitution',
    'https://www.anthropic.com/news/claude-new-constitution'
  );
  assert.equal(title, 'Claude\'s new constitution');
});

test('preferReaderTitle replaces hostname fallback with reader title', () => {
  const title = preferReaderTitle(
    'example.com',
    'Example Domain',
    'https://example.com/'
  );
  assert.equal(title, 'Example Domain');
});
