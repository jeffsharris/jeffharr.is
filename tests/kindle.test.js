import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKindleHtml, buildKindleAttachment, formatFilename } from '../functions/api/read-later/kindle.js';
import { buildEpubAttachment } from '../functions/api/read-later/epub.js';
import { unzipSync } from 'fflate';

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

test('buildEpubAttachment returns a zip payload', async () => {
  const item = { url: 'https://example.com', title: 'Example', id: 'test-1' };
  const reader = { title: 'Reader Title', contentHtml: '<p>Hi there.</p>' };
  const result = await buildEpubAttachment(item, reader, { maxEncodedBytes: 5 * 1024 * 1024 });
  assert.ok(result?.attachment.filename.endsWith('.epub'));
  assert.equal(result?.attachment.contentType, 'application/epub+zip');
  const bytes = Buffer.from(result.attachment.content, 'base64');
  assert.equal(bytes[0], 0x50);
  assert.equal(bytes[1], 0x4b);
});

test('buildEpubAttachment falls back when images are too large', async () => {
  const item = { url: 'https://example.com', title: 'Example', id: 'test-2' };
  const reader = {
    title: 'Reader Title',
    contentHtml: '<p>Hello.</p><img src="https://example.com/a.jpg" alt="A" /><img src="https://example.com/b.jpg" alt="B" />'
  };
  const baseResult = await buildEpubAttachment(item, reader, { modes: ['none'] });
  assert.ok(baseResult?.meta);

  const maxEncodedBytes = baseResult.meta.encodedBytes + 2000;
  const fetchImage = async () => {
    const bytes = new Uint8Array(2 * 1024 * 1024);
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = i % 251;
    }
    return { bytes, contentType: 'image/jpeg' };
  };

  const result = await buildEpubAttachment(item, reader, { maxEncodedBytes, fetchImage });
  assert.equal(result?.meta.embedMode, 'none');
  assert.ok(result?.meta.placeholderCount >= 2);
});

test('buildEpubAttachment bakes title into cover SVG', async () => {
  const item = { url: 'https://example.com', title: 'Cover Title', id: 'test-3' };
  const reader = {
    title: 'Cover Title',
    contentHtml: '<p>Hello.</p><img src="https://example.com/cover.jpg" alt="Cover" />'
  };
  const fetchImage = async () => ({
    bytes: new Uint8Array([1, 2, 3, 4]),
    contentType: 'image/jpeg'
  });

  const result = await buildEpubAttachment(item, reader, { fetchImage });
  const bytes = Buffer.from(result.attachment.content, 'base64');
  const files = unzipSync(bytes);
  const coverSvg = files['OEBPS/images/cover.svg'];
  assert.ok(coverSvg);
  const coverText = new TextDecoder().decode(coverSvg);
  assert.ok(coverText.includes('Cover Title'));
});

test('buildEpubAttachment escapes ampersands in chapter XHTML', async () => {
  const item = { url: 'https://example.com', title: 'Amp Test', id: 'test-4' };
  const reader = {
    title: 'Amp Test',
    contentHtml: '<p><a href="https://example.com/?a=1&b=2">Link</a></p>'
  };
  const result = await buildEpubAttachment(item, reader);
  const bytes = Buffer.from(result.attachment.content, 'base64');
  const files = unzipSync(bytes);
  const chapterText = new TextDecoder().decode(files['OEBPS/chapter.xhtml']);
  assert.ok(chapterText.includes('a=1&amp;b=2'));
});
