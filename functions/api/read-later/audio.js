import { parseHTML } from 'linkedom';
import { createLogger, formatError } from '../lib/logger.js';
import { jsonResponse } from '../content-library/serialize.js';
import { createReadLaterStores } from './stores.js';
import { getReadLaterAssetItemId } from './asset-store.js';
import { fetchAndCacheReader } from './reader.js';

const OPENAI_SPEECH_URL = 'https://api.openai.com/v1/audio/speech';
const OPENAI_SPEECH_MODEL = 'gpt-4o-mini-tts';
const OPENAI_SPEECH_VOICE = 'cedar';
const OPENAI_SPEECH_FORMAT = 'mp3';
const FIRST_CHUNK_TARGET_CHARS = 900;
const CHUNK_TARGET_CHARS = 2400;
const MAX_CHUNK_CHARS = 3200;
const MIN_SPEECH_WORDS = 40;
const SPEECH_INSTRUCTIONS = [
  'Read this saved article in a calm, natural audiobook style.',
  'Keep a steady pace and avoid dramatizing links, captions, or punctuation.'
].join(' ');

export async function onRequest(context) {
  const { request, env } = context;
  const stores = createReadLaterStores(env, { requireAssets: true });
  const logger = createLogger({ request, source: 'read-later-audio' });
  const log = logger.log;

  if (!stores) {
    log('error', 'storage_unavailable', { stage: 'init' });
    return jsonResponse(
      { ok: false, error: 'Storage unavailable' },
      { status: 500, cache: 'no-store' }
    );
  }

  return handleReadLaterAudio({ request, env, ...stores, log });
}

async function handleReadLaterAudio({ request, env, readLaterStore, assetStore, log }) {
  const url = new URL(request.url);
  const id = (url.searchParams.get('id') || '').trim();
  const manifestRequested = url.searchParams.get('manifest') === '1';
  const chunkIndex = Number.parseInt(url.searchParams.get('chunk') || '', 10);

  if (!id) {
    log('warn', 'audio_missing_id', { stage: 'request' });
    return jsonResponse({ ok: false, error: 'Missing id' }, { status: 400, cache: 'no-store' });
  }

  try {
    const prepared = await prepareSpeechChunks({
      id,
      env,
      readLaterStore,
      assetStore,
      log
    });

    if (!prepared.ok) {
      return jsonResponse(
        { ok: false, error: prepared.error },
        { status: prepared.status || 200, cache: 'no-store' }
      );
    }

    if (manifestRequested) {
      return jsonResponse(
        buildManifestResponse(prepared),
        { status: 200, cache: 'no-store' }
      );
    }

    if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex >= prepared.chunks.length) {
      return jsonResponse({ ok: false, error: 'Invalid chunk' }, { status: 400, cache: 'no-store' });
    }

    if (!env.OPENAI_API_KEY) {
      log?.('error', 'audio_api_key_missing', { stage: 'speech', itemId: id });
      return jsonResponse(
        { ok: false, error: 'Audio generation is not configured' },
        { status: 503, cache: 'no-store' }
      );
    }

    return streamSpeechChunk({
      apiKey: env.OPENAI_API_KEY,
      item: prepared.item,
      chunk: prepared.chunks[chunkIndex],
      log
    });
  } catch (error) {
    log?.('error', 'audio_request_failed', {
      stage: 'request',
      itemId: id,
      ...formatError(error)
    });
    return jsonResponse(
      { ok: false, error: 'Audio unavailable' },
      { status: 200, cache: 'no-store' }
    );
  }
}

async function prepareSpeechChunks({ id, env, readLaterStore, assetStore, log }) {
  const item = await readLaterStore.getItem(id);
  if (!item) {
    log?.('warn', 'audio_item_missing', { stage: 'lookup', itemId: id });
    return { ok: false, status: 404, error: 'Item not found' };
  }

  const assetItemId = getReadLaterAssetItemId(item);
  let reader = await assetStore.getReader(assetItemId);
  if (!reader?.contentHtml) {
    reader = await fetchAndCacheReader({
      assetStore,
      entryId: id,
      itemId: assetItemId,
      url: item.url,
      title: item.title,
      browser: env.BROWSER,
      xBearerToken: env.X_API_BEARER_TOKEN,
      forceRefresh: false,
      log
    });
  }

  if (!reader?.contentHtml) {
    log?.('warn', 'audio_reader_unavailable', {
      stage: 'reader',
      itemId: id,
      url: item.url,
      title: item.title
    });
    return { ok: false, status: 200, error: 'Reader text unavailable' };
  }

  const speechText = readerHtmlToSpeechText(reader.contentHtml);
  const wordCount = countWords(speechText);
  if (wordCount < MIN_SPEECH_WORDS) {
    log?.('warn', 'audio_reader_text_too_short', {
      stage: 'reader',
      itemId: id,
      wordCount
    });
    return { ok: false, status: 200, error: 'Reader text unavailable' };
  }

  const chunks = chunkSpeechText(speechText).map((text, index) => ({
    index,
    text,
    cacheKey: buildCacheKey({
      itemId: id,
      readerRetrievedAt: reader.retrievedAt || '',
      index,
      text
    }),
    characterCount: text.length,
    wordCount: countWords(text)
  }));

  return {
    ok: true,
    item,
    reader,
    chunks,
    wordCount
  };
}

function buildManifestResponse({ item, reader, chunks, wordCount }) {
  return {
    ok: true,
    item: {
      id: item.id,
      url: item.url,
      title: item.title,
      domain: domainFromUrl(item.url)
    },
    reader: {
      title: reader.title || item.title,
      siteName: reader.siteName || '',
      byline: reader.byline || '',
      excerpt: reader.excerpt || '',
      wordCount,
      retrievedAt: reader.retrievedAt || null
    },
    audio: {
      model: OPENAI_SPEECH_MODEL,
      voice: OPENAI_SPEECH_VOICE,
      format: OPENAI_SPEECH_FORMAT,
      chunkCount: chunks.length,
      chunks: chunks.map(({ index, cacheKey, characterCount, wordCount }) => ({
        index,
        cacheKey,
        characterCount,
        wordCount
      }))
    }
  };
}

async function streamSpeechChunk({ apiKey, item, chunk, log }) {
  const response = await fetch(OPENAI_SPEECH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: OPENAI_SPEECH_MODEL,
      voice: OPENAI_SPEECH_VOICE,
      input: chunk.text,
      instructions: SPEECH_INSTRUCTIONS,
      response_format: OPENAI_SPEECH_FORMAT
    })
  });

  if (!response.ok || !response.body) {
    const errorBody = await safeReadText(response);
    log?.('error', 'audio_openai_response_failed', {
      stage: 'speech',
      itemId: item.id,
      chunkIndex: chunk.index,
      status: response.status,
      error: errorBody.slice(0, 500)
    });
    return jsonResponse(
      { ok: false, error: 'Audio generation failed' },
      { status: response.status >= 400 && response.status < 500 ? 502 : 503, cache: 'no-store' }
    );
  }

  return new Response(response.body, {
    status: 200,
    headers: {
      'content-type': 'audio/mpeg',
      'cache-control': 'no-store',
      'x-sukha-audio-cache-key': chunk.cacheKey,
      'x-sukha-audio-chunk': String(chunk.index)
    }
  });
}

function readerHtmlToSpeechText(html) {
  const { document } = parseHTML(`<main>${html || ''}</main>`);
  const root = document.querySelector('main');
  if (!root) return '';

  for (const selector of [
    'script',
    'style',
    'nav',
    'footer',
    'header',
    'aside',
    'form',
    'button',
    'figure',
    'figcaption',
    'img',
    'picture',
    'source',
    'svg',
    'video',
    'audio',
    'iframe',
    'object',
    'embed',
    'table'
  ]) {
    for (const node of root.querySelectorAll(selector)) {
      node.remove();
    }
  }

  const blocks = [];
  for (const node of root.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre')) {
    const text = normalizeSpeechText(node.textContent || '');
    if (text) blocks.push(text);
  }

  if (blocks.length === 0) {
    const text = normalizeSpeechText(root.textContent || '');
    if (text) blocks.push(text);
  }

  return blocks
    .filter((block) => !isLikelyNoiseBlock(block))
    .join('\n\n')
    .trim();
}

function chunkSpeechText(text) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const paragraph of paragraphs) {
    const pieces = paragraph.length > MAX_CHUNK_CHARS
      ? splitLongParagraph(paragraph)
      : [paragraph];

    for (const piece of pieces) {
      const target = chunks.length === 0 ? FIRST_CHUNK_TARGET_CHARS : CHUNK_TARGET_CHARS;
      if (current && current.length + piece.length + 2 > target) {
        chunks.push(current);
        current = piece;
      } else {
        current = current ? `${current}\n\n${piece}` : piece;
      }
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function splitLongParagraph(paragraph) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) || [paragraph];
  const chunks = [];
  let current = '';

  for (const sentence of sentences.map((part) => part.trim()).filter(Boolean)) {
    if (current && current.length + sentence.length + 1 > MAX_CHUNK_CHARS) {
      chunks.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

function normalizeSpeechText(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .trim();
}

function isLikelyNoiseBlock(text) {
  const normalized = text.toLowerCase();
  if (normalized.length <= 2) return true;
  if (/^(share|subscribe|advertisement|recommended|read more|sign in|log in)$/i.test(text)) return true;
  return false;
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function buildCacheKey({ itemId, readerRetrievedAt, index, text }) {
  return [
    sanitizeCachePart(itemId),
    sanitizeCachePart(readerRetrievedAt || 'reader'),
    String(index).padStart(3, '0'),
    hashString(text)
  ].join('-');
}

function sanitizeCachePart(value) {
  return String(value || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'x';
}

function hashString(value) {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function domainFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, '') || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export {
  chunkSpeechText,
  handleReadLaterAudio,
  prepareSpeechChunks,
  readerHtmlToSpeechText
};
