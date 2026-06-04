import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  buildKindleHtml,
  buildKindleAttachment,
  buildPdfAttachmentResult,
  formatFilename,
  syncKindleForItem
} from '../functions/api/read-later/kindle.js';
import { buildEpubAttachment } from '../functions/api/read-later/epub.js';
import { createMockReadLaterStores } from './mock-read-later-stores.js';
import { unzipSync } from 'fflate';

const COVER_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

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

test('syncKindleForItem sends PDF URLs as PDF attachments', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const pdfBytes = new TextEncoder().encode('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  const resendPayloads = [];
  const fetchCalls = [];

  globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({ url: String(url), options });
    if (String(url) === 'https://example.com/book.pdf') {
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(pdfBytes.length)
        }
      });
    }

    if (String(url) === 'https://api.resend.com/emails') {
      resendPayloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await syncKindleForItem(
    { id: 'pdf-1', url: 'https://example.com/book.pdf', title: 'Book PDF' },
    {
      RESEND_API_KEY: 'test-key',
      KINDLE_TO_EMAIL: 'kindle@example.com',
      KINDLE_FROM_EMAIL: 'sender@example.com'
    }
  );

  assert.equal(result.kindle.status, 'synced');
  assert.equal(result.reader, null);
  assert.equal(resendPayloads.length, 1);
  assert.equal(resendPayloads[0].subject, 'Book PDF');
  assert.equal(resendPayloads[0].attachments.length, 1);
  const [attachment] = resendPayloads[0].attachments;
  assert.equal(attachment.filename, 'book-pdf.pdf');
  assert.equal(attachment.contentType, 'application/pdf');
  assert.equal(Buffer.from(attachment.content, 'base64').toString('utf-8'), '%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF');
  assert.equal(fetchCalls[0].options.headers.Accept, 'application/pdf');
});

test('syncKindleForItem rejects PDF URLs that do not return PDF bytes', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  let resendCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://example.com/not-a-pdf.pdf') {
      return new Response('<html><body>Not a PDF</body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' }
      });
    }
    if (String(url) === 'https://api.resend.com/emails') {
      resendCalled = true;
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await syncKindleForItem(
    { id: 'pdf-2', url: 'https://example.com/not-a-pdf.pdf', title: 'Not PDF' },
    {
      RESEND_API_KEY: 'test-key',
      KINDLE_TO_EMAIL: 'kindle@example.com',
      KINDLE_FROM_EMAIL: 'sender@example.com'
    }
  );

  assert.equal(result.kindle.status, 'failed');
  assert.equal(result.kindle.errorCode, 'pdf_invalid_content_type');
  assert.equal(result.kindle.retryable, false);
  assert.equal(resendCalled, false);
});

test('syncKindleForItem generates PDF cover and prepends it to Kindle attachment', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const sourceDocument = await PDFDocument.create();
  sourceDocument.addPage([300, 400]);
  const pdfBytes = new Uint8Array(await sourceDocument.save());
  const { assetStore, coverStore } = createMockReadLaterStores();
  const resendPayloads = [];
  const openAiPayloads = [];

  globalThis.fetch = async (url, options = {}) => {
    if (String(url) === 'https://example.com/covered.pdf') {
      return new Response(pdfBytes, {
        status: 200,
        headers: {
          'content-type': 'application/pdf',
          'content-length': String(pdfBytes.length)
        }
      });
    }

    if (String(url) === 'https://api.openai.com/v1/responses') {
      openAiPayloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({
        output: [
          {
            type: 'image_generation_call',
            result: COVER_PNG_BASE64
          }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (String(url) === 'https://api.resend.com/emails') {
      resendPayloads.push(JSON.parse(options.body));
      return new Response(JSON.stringify({ id: 'email-1' }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await syncKindleForItem(
    { id: 'pdf-covered', url: 'https://example.com/covered.pdf', title: 'Covered PDF' },
    {
      OPENAI_API_KEY: 'openai-key',
      RESEND_API_KEY: 'test-key',
      KINDLE_TO_EMAIL: 'kindle@example.com',
      KINDLE_FROM_EMAIL: 'sender@example.com'
    },
    { assetStore, log: () => {} }
  );

  assert.equal(result.kindle.status, 'synced');
  assert.equal(result.reader, null);
  assert.equal(Boolean(result.cover?.createdAt), true);
  assert.equal(coverStore.get('pdf-covered')?.base64, COVER_PNG_BASE64);
  assert.equal(openAiPayloads.length, 1);
  assert.equal(openAiPayloads[0].model, 'gpt-5.5');
  assert.equal(openAiPayloads[0].tools[0].type, 'image_generation');
  assert.equal(openAiPayloads[0].tools[0].model, 'gpt-image-2');
  assert.equal(openAiPayloads[0].tools[0].size, '1024x1536');
  assert.equal(openAiPayloads[0].input[0].content[0].type, 'input_file');
  assert.equal(openAiPayloads[0].input[0].content[0].file_url, 'https://example.com/covered.pdf');
  assert.equal(openAiPayloads[0].input[0].content[1].type, 'input_text');
  assert.match(openAiPayloads[0].input[0].content[1].text, /attached PDF/);

  assert.equal(resendPayloads.length, 1);
  assert.match(resendPayloads[0].subject, /^Covered PDF covered \d{8}-\d{6}Z$/);
  const [attachment] = resendPayloads[0].attachments;
  assert.match(attachment.filename, /^covered-pdf-covered-\d{8}-\d{6}Z\.pdf$/);
  assert.equal(attachment.contentType, 'application/pdf');
  const sentBytes = Buffer.from(attachment.content, 'base64');
  assert.notDeepEqual(sentBytes, Buffer.from(pdfBytes));
  const sentDocument = await PDFDocument.load(sentBytes);
  assert.equal(sentDocument.getPageCount(), 2);
  assert.equal(result.kindle.pdfAttachment.coverEmbedded, true);
  assert.equal(result.kindle.pdfAttachment.originalBytes, pdfBytes.length);
  assert.equal(result.kindle.pdfAttachment.generatedBytes, sentBytes.length);
  assert.equal(result.kindle.pdfAttachment.originalPageCount, 1);
  assert.equal(result.kindle.pdfAttachment.generatedPageCount, 2);
  assert.equal(result.kindle.pdfAttachment.filename, attachment.filename);
  assert.equal(result.kindle.pdfAttachment.subject, resendPayloads[0].subject);
  assert.equal(typeof result.kindle.pdfAttachment.generatedSha256, 'string');
});

test('buildPdfAttachmentResult reuses existing cover without calling OpenAI', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const sourceDocument = await PDFDocument.create();
  sourceDocument.addPage([300, 400]);
  const pdfBytes = new Uint8Array(await sourceDocument.save());
  const { assetStore } = createMockReadLaterStores({
    covers: {
      'pdf-existing-cover': {
        base64: COVER_PNG_BASE64,
        contentType: 'image/png',
        createdAt: '2026-02-22T00:02:00.000Z'
      }
    }
  });

  globalThis.fetch = async (url) => {
    if (String(url) === 'https://example.com/existing.pdf') {
      return new Response(pdfBytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      });
    }
    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await buildPdfAttachmentResult(
    { id: 'pdf-existing-cover', url: 'https://example.com/existing.pdf', title: 'Existing Cover' },
    { assetStore, attemptedAt: '2026-02-22T00:03:04.000Z' }
  );

  assert.equal(result.coverEmbedded, true);
  assert.equal(result.cover.createdAt, '2026-02-22T00:02:00.000Z');
  assert.equal(result.evidence.coverEmbedded, true);
  assert.equal(result.evidence.originalBytes, pdfBytes.length);
  assert.equal(result.evidence.originalPageCount, 1);
  assert.equal(result.evidence.generatedPageCount, 2);
  assert.equal(result.evidence.filename, 'existing-cover-covered-20260222-000304Z.pdf');
  assert.equal(result.evidence.subject, 'Existing Cover covered 20260222-000304Z');
  assert.equal(typeof result.evidence.originalSha256, 'string');
  assert.equal(typeof result.evidence.generatedSha256, 'string');
  assert.notEqual(result.evidence.originalSha256, result.evidence.generatedSha256);
  const sentDocument = await PDFDocument.load(Buffer.from(result.attachment.content, 'base64'));
  assert.equal(sentDocument.getPageCount(), 2);
});

test('syncKindleForItem fails instead of sending original PDF when existing cover cannot be embedded', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  const sourceDocument = await PDFDocument.create();
  sourceDocument.addPage([300, 400]);
  const pdfBytes = new Uint8Array(await sourceDocument.save());
  const { assetStore } = createMockReadLaterStores({
    covers: {
      'pdf-bad-cover': {
        base64: 'not-a-valid-image',
        contentType: 'image/png',
        createdAt: '2026-02-22T00:02:00.000Z'
      }
    }
  });

  let resendCalled = false;
  globalThis.fetch = async (url) => {
    if (String(url) === 'https://example.com/bad-cover.pdf') {
      return new Response(pdfBytes, {
        status: 200,
        headers: { 'content-type': 'application/pdf' }
      });
    }

    if (String(url) === 'https://api.resend.com/emails') {
      resendCalled = true;
      return new Response(JSON.stringify({ id: 'email-1' }), { status: 200 });
    }

    throw new Error(`Unexpected fetch ${url}`);
  };

  const result = await syncKindleForItem(
    { id: 'pdf-bad-cover', url: 'https://example.com/bad-cover.pdf', title: 'Bad Cover' },
    {
      RESEND_API_KEY: 'test-key',
      KINDLE_TO_EMAIL: 'kindle@example.com',
      KINDLE_FROM_EMAIL: 'sender@example.com'
    },
    { assetStore, log: () => {} }
  );

  assert.equal(result.kindle.status, 'failed');
  assert.equal(result.kindle.errorCode, 'pdf_cover_embed_failed');
  assert.equal(result.kindle.retryable, true);
  assert.equal(result.cover, null);
  assert.equal(resendCalled, false);
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

test('buildEpubAttachment includes title on cover page', async () => {
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
  const coverPage = files['OEBPS/cover.xhtml'];
  assert.ok(coverPage);
  const coverText = new TextDecoder().decode(coverPage);
  assert.ok(coverText.includes('Cover Title'));
});

test('buildEpubAttachment prefers generated cover image', async () => {
  const item = { url: 'https://example.com', title: 'Generated Cover', id: 'test-3b' };
  const reader = {
    title: 'Generated Cover',
    contentHtml: '<p>Hello.</p><img src="https://example.com/cover.jpg" alt="Cover" />'
  };
  const coverImage = {
    base64: COVER_PNG_BASE64,
    contentType: 'image/png'
  };

  const result = await buildEpubAttachment(item, reader, { coverImage });
  const bytes = Buffer.from(result.attachment.content, 'base64');
  const files = unzipSync(bytes);
  assert.ok(files['OEBPS/images/cover-generated.png']);
  const coverPage = new TextDecoder().decode(files['OEBPS/cover.xhtml']);
  assert.ok(coverPage.includes('cover-generated.png'));
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
