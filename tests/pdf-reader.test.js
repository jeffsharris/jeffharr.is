import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { buildPdfReader, validatePdfBatch, blocksToHtml } from '../functions/api/read-later/pdf-reader.js';
import { fetchPdfBytes, pdfFilename } from '../functions/api/read-later/pdf-utils.js';
import { shouldCacheReader, preferReaderTitle } from '../functions/api/read-later/reader-utils.js';
import { buildReaderContent, handleReadLaterReader } from '../functions/api/read-later/reader.js';
import { handleDocument } from '../functions/api/read-later/document.js';
import { handleReadLaterAudio } from '../functions/api/read-later/audio.js';
import { createMockReadLaterStores } from './mock-read-later-stores.js';

function batch(pageCount) {
  return { complete: true, title: 'The Real Document Title', author: 'An Author', pages: Array.from({ length: pageCount }, (_, i) => ({
    pageNumber: i + 1, blocks: [{ kind: 'paragraph', text: `Page ${i + 1}. ${'Readable document text. '.repeat(30)}` }]
  })) };
}

function responseFor(result, status = 'completed') {
  return new Response(JSON.stringify({ status, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(result) }] }] }),
    { headers: { 'content-type': 'application/json' } });
}

async function pdfBytes(count = 1) {
  const document = await PDFDocument.create();
  for (let i = 0; i < count; i++) document.addPage().drawText('A genuine PDF text layer');
  return document.save();
}

test('PDF names use download headers, including signed URLs and UTF-8 filenames', () => {
  assert.equal(pdfFilename('attachment; filename="Big_Blob_of_Compute.pdf"', 'https://example.com/uuid.pdf'), 'Big_Blob_of_Compute.pdf');
  assert.equal(pdfFilename("attachment; filename*=UTF-8''A%20Title.pdf", null), 'A Title.pdf');
  assert.equal(pdfFilename(null, 'https://example.com/uuid.pdf?response-content-disposition=attachment%3B%20filename%3D%22Real_Title.pdf%22'), 'Real_Title.pdf');
  assert.equal(preferReaderTitle('7087c3ff-0f96-4e38-9e7e-1d0be092d61a', 'Real Title', ''), 'Real Title');
});

test('binary garbage cannot pass reader cache validation; short PDFs can', () => {
  assert.equal(shouldCacheReader({ contentHtml: `<p>${'\uFFFD\u0000 abc '.repeat(80)}</p>` }), false);
  assert.equal(shouldCacheReader({ sourceType: 'pdf', contentHtml: '<p>A short readable document.</p>' }), true);
  assert.equal(shouldCacheReader({ contentHtml: '<p>%PDF-1.7 abc</p>' }), false);
});

test('PDF transcription rejects omissions, duplicate pages, bad text, and incomplete output', () => {
  assert.throws(() => validatePdfBatch(batch(1), 2), /omitted/);
  assert.throws(() => validatePdfBatch({ ...batch(1), complete: false }, 1), /omitted/);
  const unordered = batch(2); unordered.pages[1].pageNumber = 1;
  assert.throws(() => validatePdfBatch(unordered, 2), /page order/);
  const unreadable = batch(1); unreadable.pages[0].blocks[0].text = '\uFFFD'.repeat(20);
  assert.throws(() => validatePdfBatch(unreadable, 1), /unreadable/);
});

test('PDF reader HTML escapes active content and preserves headings and grouped lists', () => {
  const html = blocksToHtml([
    { kind: 'heading', text: 'Title' }, { kind: 'heading', text: 'Introduction' },
    { kind: 'list_item', text: '<script>alert(1)</script>' }, { kind: 'list_item', text: 'Next & last' },
    { kind: 'paragraph', text: 'Body text' }
  ], 'Title');
  assert.equal(html.includes('<h2>Title'), false);
  assert.match(html, /<h2>Introduction/);
  assert.match(html, /<ul><li>&lt;script&gt;/);
  assert.match(html, /<\/ul><p>Body text/);
  assert.equal(html.includes('<script>'), false);
});

test('PDF extraction batches all pages, resumes cached work, and never refetches an expired source', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const bytes = await pdfBytes(4);
  let savedExtraction, calls = 0;
  const assetStore = {
    getReader: async () => null,
    getOriginalPdf: async () => ({ bytes, filename: 'Real_Title.pdf' }),
    getPdfExtraction: async () => savedExtraction,
    savePdfExtraction: async (_, data) => { savedExtraction = structuredClone(data); }
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const payload = JSON.parse(options.body);
    assert.equal(payload.store, false);
    assert.equal(payload.tools, undefined);
    assert.equal(options.headers.authorization, 'Bearer test-key');
    const input = payload.input[0].content[0];
    const submitted = await PDFDocument.load(Buffer.from(input.file_data.split(',')[1], 'base64'));
    calls++;
    if (calls === 2) return new Response('retry later', { status: 503 });
    return responseFor(batch(submitted.getPageCount()));
  };
  const args = { url: 'https://example.com/expired.pdf', title: 'uuid', assetStore, itemId: 'item-1', env: { OPENAI_API_KEY: 'test-key' } };
  await assert.rejects(buildPdfReader(args), /503/);
  assert.equal(savedExtraction.pages.length, 3);
  const reader = await buildPdfReader(args);
  assert.equal(calls, 3);
  assert.equal(reader.pageCount, 4);
  assert.equal(reader.title, 'The Real Document Title');
  assert.equal(reader.sourceType, 'pdf');
  assert.equal(shouldCacheReader(reader), true);
});

test('incomplete batches split into pages and resume each successful page after a transient failure', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const bytes = await pdfBytes(3);
  let savedExtraction, calls = 0;
  const pageCounts = [];
  const assetStore = {
    getReader: async () => null,
    getOriginalPdf: async () => ({ bytes, filename: 'Title.pdf' }),
    getPdfExtraction: async () => savedExtraction,
    savePdfExtraction: async (_, value) => { savedExtraction = structuredClone(value); }
  };
  globalThis.fetch = async (_, options) => {
    const input = JSON.parse(options.body).input[0].content[0];
    const submitted = await PDFDocument.load(Buffer.from(input.file_data.split(',')[1], 'base64'));
    const count = submitted.getPageCount();
    pageCounts.push(count); calls++;
    if (count > 1) return responseFor({ ...batch(count), complete: false });
    if (calls === 3) return new Response('retry later', { status: 503 });
    return responseFor(batch(count));
  };
  const args = { url: 'https://example.com/expired.pdf', assetStore, itemId: 'asset', env: { OPENAI_API_KEY: 'test-key' } };
  await assert.rejects(buildPdfReader(args), /503/);
  assert.equal(savedExtraction.pages.length, 1);
  const reader = await buildPdfReader(args);
  assert.deepEqual(pageCounts, [3, 1, 1, 3, 1, 1]);
  assert.equal(savedExtraction.pages.length, 3);
  assert.equal(reader.title, 'The Real Document Title');
  assert.equal(reader.pageCount, 3);
});

test('a single-page omission still fails instead of publishing partial text', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0, saves = 0;
  globalThis.fetch = async () => { calls++; return responseFor({ ...batch(1), complete: false }); };
  await assert.rejects(buildPdfReader({ url: 'https://example.com/book.pdf', bytes: await pdfBytes(), itemId: 'asset',
    env: { OPENAI_API_KEY: 'test-key' }, assetStore: { getReader: async () => null, savePdfExtraction: async () => { saves++; } }
  }), (error) => error.code === 'pdf_transcription_incomplete');
  assert.equal(calls, 1);
  assert.equal(saves, 0);
});

test('PDFs without filename extensions are detected by bytes and preserved before extraction', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const bytes = await pdfBytes(); let saved = false;
  globalThis.fetch = async (url) => String(url).startsWith('https://example.com/')
    ? new Response(bytes, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'inline; filename="Title.pdf"' } })
    : responseFor(batch(1));
  const reader = await buildReaderContent('https://example.com/download?id=42', 'Fallback', null, {
    itemId: 'item', env: { OPENAI_API_KEY: 'test-key' }, assetStore: {
      getReader: async () => null, getOriginalPdf: async () => null,
      saveOriginalPdf: async (_, pdf) => { saved = true; assert.deepEqual(pdf.bytes, bytes); }
    }
  });
  assert.equal(saved, true);
  assert.equal(reader.sourceType, 'pdf');
});

test('original PDF cache survives expired links, and document API uses it without a fetch', async () => {
  const bytes = await pdfBytes();
  const assetStore = { getOriginalPdf: async () => ({ bytes, filename: 'The Title.pdf' }) };
  const stored = await fetchPdfBytes('https://example.com/expired.pdf', { assetStore, itemId: 'asset-id' });
  assert.deepEqual(stored.bytes, bytes);
  const response = await handleDocument({ request: new Request('https://jeffharr.is/api/read-later/document?id=entry'),
    readLaterStore: { getItem: async () => ({ itemId: 'asset-id' }) }, assetStore });
  assert.equal(response.headers.get('content-type'), 'application/pdf');
  assert.match(response.headers.get('content-disposition'), /The%20Title.pdf/);
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
});

test('interactive detection captures extensionless PDFs but defers paid transcription to the queue', async (t) => {
  const originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; });
  const bytes = await pdfBytes(); let saved = false, calls = 0;
  globalThis.fetch = async () => { calls++; return new Response(bytes, { headers: { 'content-type': 'application/pdf' } }); };
  await assert.rejects(buildReaderContent('https://example.com/download', '', null, {
    deferPdfExtraction: true, itemId: 'asset', assetStore: {
      getOriginalPdf: async () => null, saveOriginalPdf: async () => { saved = true; }
    }
  }), (error) => error.pdfPending === true);
  assert.equal(saved, true);
  assert.equal(calls, 1);
});

test('reader endpoint rejects corrupt PDF cache and exposes saved original without paid work', async () => {
  const response = await handleReadLaterReader({ request: new Request('https://jeffharr.is/api/read-later/reader?id=entry'),
    env: {}, log: () => {}, readLaterStore: { getItem: async () => ({ id: 'entry', itemId: 'asset', url: 'https://example.com/book.pdf' }) },
    assetStore: { getReader: async () => ({ contentHtml: `<p>${'\uFFFD'.repeat(500)}</p>` }), getOriginalPdf: async () => ({ bytes: await pdfBytes() }) }
  });
  const result = await response.json();
  assert.equal(result.ok, false);
  assert.equal(result.reader, null);
  assert.equal(result.documentUrl, '/api/read-later/document?id=entry');
});

test('audio cannot speak corrupted cached binary content', async () => {
  const stores = createMockReadLaterStores({ items: { entry: { id: 'entry', url: 'https://example.com/book.pdf' } },
    readers: { entry: { contentHtml: `<p>${'\uFFFD word '.repeat(100)}</p>` } } });
  const response = await handleReadLaterAudio({ request: new Request('https://jeffharr.is/api/read-later/audio?id=entry&manifest=1'), env: {}, ...stores });
  assert.equal((await response.json()).ok, false);
});
