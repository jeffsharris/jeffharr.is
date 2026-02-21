import { parseHTML } from 'linkedom';
import { deriveTitleFromUrl } from './reader-utils.js';
import { formatError, truncateString } from '../lib/logger.js';

const COVER_PREFIX = 'cover:';
const MAX_SNIPPET_WORDS = 1000;
const MIN_SNIPPET_WORDS = 40;
const OPENAI_TIMEOUT_MS = 150000;
const COVER_FETCH_TIMEOUT_MS = 15000;
const MAX_COVER_FETCH_BYTES = 8 * 1024 * 1024;
const OPENAI_ENDPOINT = 'https://api.openai.com/v1/responses';

function getCoverKey(id) {
  return `${COVER_PREFIX}${id}`;
}

async function getCoverImage(kv, id) {
  if (!kv || !id) return null;
  try {
    const payload = await kv.get(getCoverKey(id), { type: 'json' });
    if (!payload?.base64) return null;
    return payload;
  } catch (error) {
    console.warn('Read later cover fetch error:', error);
    return null;
  }
}

async function saveCoverImage(kv, id, cover) {
  if (!kv || !id || !cover?.base64) return null;

  const payload = {
    base64: cover.base64,
    contentType: cover.contentType || 'image/png',
    createdAt: cover.createdAt || new Date().toISOString()
  };

  await kv.put(getCoverKey(id), JSON.stringify(payload));
  return payload;
}

function extractSnippetFromHtml(html, maxWords = MAX_SNIPPET_WORDS) {
  if (!html) return null;

  const { document } = parseHTML(`<!doctype html><html><body>${html}</body></html>`);
  const text = (document.body?.textContent || '').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  const words = text.split(' ');
  const truncated = words.length > maxWords;
  const snippetWords = truncated ? words.slice(0, maxWords) : words;
  if (snippetWords.length < MIN_SNIPPET_WORDS) return null;

  return {
    snippet: snippetWords.join(' '),
    truncated,
    wordCount: snippetWords.length
  };
}

function buildCoverPrompt({ title, url, snippet, truncated }) {
  const summaryLine = truncated
    ? 'The text below is the beginning snippet of the article. Infer the overall theme from it.'
    : 'The text below is the full article.';

  const source = url ? `Source: ${url}` : '';

  return [
    'Design a portrait book cover inspired by the article below.',
    `Title: "${title}".`,
    'Include only the title as text on the cover (no subtitle, byline, or logo).',
    'Make the typography large, clean, and high-contrast for readability on Kindle.',
    'Choose a single evocative visual motif that matches the article’s theme.',
    source,
    summaryLine,
    snippet
  ].filter(Boolean).join('\n\n');
}

async function generateCoverImage({ title, url, snippet, truncated, env, log, itemId }) {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    if (log) {
      log('warn', 'cover_api_key_missing', {
        stage: 'cover_generation',
        itemId: itemId || null,
        url: url || null,
        title: title || null
      });
    }
    return null;
  }

  const prompt = buildCoverPrompt({ title, url, snippet, truncated });
  const payload = {
    model: 'gpt-5',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt }
        ]
      }
    ],
    tool_choice: { type: 'image_generation' },
    tools: [
      {
        type: 'image_generation',
        model: 'gpt-image-1.5',
        size: '1024x1536',
        quality: 'high',
        output_format: 'png'
      }
    ]
  };

  const response = await fetchWithTimeout(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, OPENAI_TIMEOUT_MS);

  if (!response.ok) {
    const details = await readResponseBody(response);
    if (log) {
      log('error', 'cover_response_failed', {
        stage: 'cover_generation',
        itemId: itemId || null,
        url: url || null,
        title: title || null,
        status: response.status,
        response: truncateString(details, 1200)
      });
    }
    throw new Error(`OpenAI cover request failed with ${response.status}${details}`);
  }

  const data = await response.json();
  const imageCall = Array.isArray(data?.output)
    ? data.output.find((item) => item.type === 'image_generation_call' && item.result)
    : null;

  if (!imageCall?.result) {
    if (log) {
      log('warn', 'cover_result_missing', {
        stage: 'cover_generation',
        itemId: itemId || null,
        url: url || null,
        title: title || null
      });
    }
    return null;
  }

  return {
    base64: imageCall.result,
    contentType: 'image/png',
    createdAt: new Date().toISOString()
  };
}

async function generateCoverImageStream({
  title,
  url,
  snippet,
  truncated,
  env,
  onPartial,
  log,
  itemId
}) {
  const apiKey = env?.OPENAI_API_KEY;
  if (!apiKey) {
    if (log) {
      log('warn', 'cover_api_key_missing', {
        stage: 'cover_generation',
        itemId: itemId || null,
        url: url || null,
        title: title || null
      });
    }
    return null;
  }

  const prompt = buildCoverPrompt({ title, url, snippet, truncated });
  const payload = {
    model: 'gpt-5',
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: prompt }
        ]
      }
    ],
    stream: true,
    tool_choice: { type: 'image_generation' },
    tools: [
      {
        type: 'image_generation',
        model: 'gpt-image-1.5',
        size: '1024x1536',
        quality: 'high',
        output_format: 'png',
        partial_images: 2
      }
    ]
  };

  const response = await fetchWithTimeout(OPENAI_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, OPENAI_TIMEOUT_MS);

  if (!response.ok) {
    const details = await readResponseBody(response);
    if (log) {
      log('error', 'cover_response_failed', {
        stage: 'cover_generation',
        itemId: itemId || null,
        url: url || null,
        title: title || null,
        status: response.status,
        response: truncateString(details, 1200)
      });
    }
    throw new Error(`OpenAI cover request failed with ${response.status}${details}`);
  }

  let finalResult = null;
  await consumeEventStream(response, (event) => {
    if (!event?.data || event.data === '[DONE]') return;

    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }

    const type = payload.type || event.event;
    if (type === 'response.image_generation_call.partial_image') {
      if (payload.partial_image_b64 && typeof onPartial === 'function') {
        onPartial({
          index: payload.partial_image_index,
          base64: payload.partial_image_b64
        });
      }
      return;
    }

    if (type === 'response.output_item.done') {
      const item = payload.item;
      if (item?.type === 'image_generation_call' && item.result) {
        finalResult = item.result;
      }
      return;
    }

    if (type === 'response.completed') {
      const output = payload.response?.output;
      if (Array.isArray(output)) {
        const imageCall = output.find((entry) => entry.type === 'image_generation_call' && entry.result);
        if (imageCall?.result) {
          finalResult = imageCall.result;
        }
      }
    }
  });

  if (!finalResult) {
    if (log) {
      log('warn', 'cover_stream_missing', {
        stage: 'cover_generation',
        itemId: itemId || null,
        url: url || null,
        title: title || null
      });
    }
    return null;
  }

  return {
    base64: finalResult,
    contentType: 'image/png',
    createdAt: new Date().toISOString()
  };
}

async function ensureCoverImage({ item, reader, env, kv, onPartial, log }) {
  if (!kv || !item?.id || !reader?.contentHtml) return null;

  const existing = await getCoverImage(kv, item.id);
  if (existing) return existing;

  const externalCoverUrl = resolveExternalCoverUrl(reader);
  if (externalCoverUrl) {
    try {
      const externalCover = await fetchExternalCoverImage(externalCoverUrl);
      if (externalCover?.base64) {
        return saveCoverImage(kv, item.id, externalCover);
      }
    } catch (error) {
      if (log) {
        log('warn', 'cover_external_fetch_failed', {
          stage: 'cover_generation',
          itemId: item?.id || null,
          url: item?.url || null,
          title: item?.title || null,
          coverUrl: externalCoverUrl,
          ...formatError(error)
        });
      }
    }
  }

  const snippetInfo = extractSnippetFromHtml(reader.contentHtml);
  if (!snippetInfo) {
    if (log) {
      log('warn', 'cover_snippet_missing', {
        stage: 'cover_generation',
        itemId: item?.id || null,
        url: item?.url || null,
        title: item?.title || null
      });
    }
    return null;
  }

  const title = reader?.title || item?.title || deriveTitleFromUrl(item?.url || '');
  const cover = onPartial
    ? await generateCoverImageStream({
      title,
      url: item?.url || '',
      snippet: snippetInfo.snippet,
      truncated: snippetInfo.truncated,
      env,
      onPartial,
      log,
      itemId: item?.id || null
    })
    : await generateCoverImage({
      title,
      url: item?.url || '',
      snippet: snippetInfo.snippet,
      truncated: snippetInfo.truncated,
      env,
      log,
      itemId: item?.id || null
    });

  if (!cover?.base64) {
    if (log) {
      log('warn', 'cover_missing_result', {
        stage: 'cover_generation',
        itemId: item?.id || null,
        url: item?.url || null,
        title: item?.title || null
      });
    }
    return null;
  }

  try {
    return saveCoverImage(kv, item.id, cover);
  } catch (error) {
    if (log) {
      log('error', 'cover_save_failed', {
        stage: 'cover_generation',
        itemId: item?.id || null,
        url: item?.url || null,
        title: item?.title || null,
        ...formatError(error)
      });
    }
    throw error;
  }
}

function resolveExternalCoverUrl(reader) {
  const url = typeof reader?.coverImageUrl === 'string' ? reader.coverImageUrl.trim() : '';
  if (!url) return null;

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

async function fetchExternalCoverImage(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      Accept: 'image/*'
    }
  }, COVER_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`External cover fetch failed with ${response.status}`);
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!contentType.startsWith('image/')) {
    throw new Error(`External cover returned unsupported content type: ${contentType || 'unknown'}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) {
    throw new Error('External cover response was empty');
  }
  if (bytes.length > MAX_COVER_FETCH_BYTES) {
    throw new Error(`External cover too large (${bytes.length} bytes)`);
  }

  return {
    base64: encodeBase64(bytes),
    contentType,
    createdAt: new Date().toISOString()
  };
}

function encodeBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

async function consumeEventStream(response, onEvent) {
  if (!response?.body) return;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split('\n\n');
    buffer = parts.pop() || '';

    parts.forEach((part) => {
      const event = parseEvent(part);
      if (event) {
        onEvent(event);
      }
    });
  }

  if (buffer.trim()) {
    const event = parseEvent(buffer);
    if (event) onEvent(event);
  }
}

function parseEvent(chunk) {
  const lines = chunk.split('\n').filter(Boolean);
  if (!lines.length) return null;

  let event = 'message';
  const dataLines = [];

  lines.forEach((line) => {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
      return;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  });

  return { event, data: dataLines.join('\n') };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = OPENAI_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseBody(response) {
  try {
    const text = await response.text();
    return text ? ` - ${text}` : '';
  } catch {
    return '';
  }
}

export {
  getCoverImage,
  ensureCoverImage
};
