import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleReadLaterAudio,
  readerHtmlToSpeechText,
  chunkSpeechText
} from '../functions/api/read-later/audio.js';
import { createMockReadLaterStores } from './mock-read-later-stores.js';

function buildWords(count, prefix = 'word') {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`).join(' ');
}

function buildReader(overrides = {}) {
  return {
    title: 'Example Article',
    byline: 'Author',
    excerpt: 'Excerpt',
    siteName: 'Example',
    wordCount: 220,
    contentHtml: `<article>
      <p>${buildWords(80, 'first')}</p>
      <figure><img src="/cover.jpg"><figcaption>Do not read this caption</figcaption></figure>
      <p>${buildWords(90, 'second')}</p>
    </article>`,
    retrievedAt: '2026-06-05T00:00:00.000Z',
    ...overrides
  };
}

test('readerHtmlToSpeechText strips visual and navigation noise', () => {
  const text = readerHtmlToSpeechText(`
    <article>
      <h1>Title</h1>
      <nav>Subscribe</nav>
      <p>Read this paragraph.</p>
      <figure><img src="x.jpg"><figcaption>Caption should not be spoken.</figcaption></figure>
      <p>Read this too.</p>
      <script>bad()</script>
    </article>
  `);

  assert.equal(text.includes('Read this paragraph.'), true);
  assert.equal(text.includes('Read this too.'), true);
  assert.equal(text.includes('Caption should not be spoken.'), false);
  assert.equal(text.includes('Subscribe'), false);
});

test('chunkSpeechText makes a short first chunk and bounded follow-up chunks', () => {
  const paragraphs = [
    buildWords(120, 'intro'),
    buildWords(280, 'body'),
    buildWords(280, 'more')
  ].map((part) => `<p>${part}</p>`).join('');
  const text = readerHtmlToSpeechText(paragraphs);
  const chunks = chunkSpeechText(text);

  assert.equal(chunks.length > 1, true);
  assert.equal(chunks[0].length < chunks.slice(1).reduce((max, chunk) => Math.max(max, chunk.length), 0), true);
  assert.equal(chunks.every((chunk) => chunk.length <= 3200), true);
});

test('audio manifest returns chunk metadata without exposing text', async () => {
  const item = {
    id: 'item-1',
    url: 'https://example.com/a',
    title: 'Example A',
    savedAt: '2026-06-05T00:00:00.000Z'
  };
  const { readLaterStore, assetStore } = createMockReadLaterStores({
    items: { 'item-1': item },
    readers: { 'item-1': buildReader() }
  });

  const response = await handleReadLaterAudio({
    request: new Request('https://jeffharr.is/api/read-later/audio?id=item-1&manifest=1'),
    env: {},
    readLaterStore,
    assetStore,
    log: null
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.item.domain, 'example.com');
  assert.equal(body.audio.model, 'gpt-4o-mini-tts');
  assert.equal(body.audio.voice, 'cedar');
  assert.equal(body.audio.format, 'mp3');
  assert.equal(body.audio.chunkCount, body.audio.chunks.length);
  assert.equal(body.audio.chunks[0].text, undefined);
  assert.equal(Boolean(body.audio.chunks[0].cacheKey), true);
});

test('audio manifest returns a reader text error for unavailable reader content', async () => {
  const item = {
    id: 'item-missing-reader',
    url: 'https://example.com/a',
    title: 'Example A',
    savedAt: '2026-06-05T00:00:00.000Z'
  };
  const { readLaterStore, assetStore } = createMockReadLaterStores({
    items: { 'item-missing-reader': item },
    readers: {
      'item-missing-reader': buildReader({
        contentHtml: '<article><p>Too short.</p></article>',
        wordCount: 2
      })
    }
  });

  const response = await handleReadLaterAudio({
    request: new Request('https://jeffharr.is/api/read-later/audio?id=item-missing-reader&manifest=1'),
    env: {},
    readLaterStore,
    assetStore,
    log: null
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, false);
  assert.equal(body.error, 'Reader text unavailable');
});

test('audio chunk streams OpenAI speech with cedar voice and mp3 format', async (t) => {
  const item = {
    id: 'item-stream',
    url: 'https://example.com/a',
    title: 'Example A',
    savedAt: '2026-06-05T00:00:00.000Z'
  };
  const { readLaterStore, assetStore } = createMockReadLaterStores({
    items: { 'item-stream': item },
    readers: { 'item-stream': buildReader() }
  });
  const originalFetch = globalThis.fetch;
  const calls = [];

  t.after(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'audio/mpeg' }
    });
  };

  const response = await handleReadLaterAudio({
    request: new Request('https://jeffharr.is/api/read-later/audio?id=item-stream&chunk=0'),
    env: { OPENAI_API_KEY: 'test-key' },
    readLaterStore,
    assetStore,
    log: null
  });
  const body = new Uint8Array(await response.arrayBuffer());
  const payload = JSON.parse(calls[0].options.body);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'audio/mpeg');
  assert.deepEqual(Array.from(body), [1, 2, 3]);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(payload.model, 'gpt-4o-mini-tts');
  assert.equal(payload.voice, 'cedar');
  assert.equal(payload.response_format, 'mp3');
  assert.equal(typeof payload.input, 'string');
});
