import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKindleHtml, buildKindleAttachment, formatFilename } from '../functions/api/read-later/kindle.js';

test('formatFilename slugifies titles', () => {
  assert.equal(formatFilename('Hello World!'), 'hello-world');
  assert.equal(formatFilename('  '), 'read-later');
});

test('buildKindleHtml prefers reader content', () => {
  const item = { url: 'https://example.com', title: 'Example' };
  const reader = {
    title: 'Reader Title',
    byline: 'Author',
    siteName: 'Example Site',
    excerpt: 'Short summary.',
    contentHtml: '<p>Hello there.</p>'
  };
  const html = buildKindleHtml(item, reader);
  assert.ok(html.includes('<article>'));
  assert.ok(html.includes(reader.contentHtml));
  assert.ok(html.includes('Source:'));
});

test('buildKindleAttachment base64 encodes HTML', () => {
  const item = { url: 'https://example.com', title: 'Example' };
  const reader = { title: 'Reader Title', contentHtml: '<p>Hi</p>' };
  const attachment = buildKindleAttachment(item, reader);
  const decoded = Buffer.from(attachment.content, 'base64').toString('utf-8');
  assert.ok(attachment.filename.endsWith('.html'));
  assert.ok(decoded.includes('<h1>'));
  assert.ok(decoded.includes('Reader Title'));
});
