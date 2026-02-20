import { deriveTitleFromUrl, shouldCacheReader } from './reader-utils.js';
import { getYouTubeInfo } from './media-utils.js';
import { buildReaderContent } from './reader.js';
import { buildEpubAttachment } from './epub.js';
import { ensureCoverImage } from './covers.js';
import { formatError, truncateString } from '../lib/logger.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10000;
const KINDLE_DOMAIN_BLOCKLIST = [
  { domain: 'x.com', reason: 'Links from x.com are not sent to Kindle' }
];
const KINDLE_STATUS = {
  SYNCED: 'synced',
  FAILED: 'failed',
  NEEDS_CONTENT: 'needs-content',
  UNSUPPORTED: 'unsupported'
};

class KindleSyncError extends Error {
  constructor(message, { code = null, retryable = true } = {}) {
    super(message);
    this.name = 'KindleSyncError';
    this.code = code;
    this.retryable = retryable;
  }
}

function buildKindleHtml(item, reader) {
  const title = resolveTitle(item, reader);
  const safeTitle = escapeHtml(title);
  const sourceUrl = item?.url || '';
  const safeSourceUrl = escapeHtml(sourceUrl);
  const safeSourceLabel = escapeHtml(sourceUrl);
  const byline = reader?.byline ? escapeHtml(reader.byline) : '';
  const siteName = reader?.siteName ? escapeHtml(reader.siteName) : '';
  const excerpt = reader?.excerpt ? escapeHtml(reader.excerpt) : '';
  const contentHtml = reader?.contentHtml || '';

  const metaLine = [byline, siteName].filter(Boolean).join(' • ');
  const metaHtml = metaLine ? `<p class="meta">${metaLine}</p>` : '';
  const excerptHtml = excerpt ? `<p class="excerpt">${excerpt}</p>` : '';
  const sourceHtml = sourceUrl
    ? `<p class="source">Source: <a href="${safeSourceUrl}">${safeSourceLabel}</a></p>`
    : '';

  const bodyHtml = contentHtml
    ? `<article>${contentHtml}</article>`
    : `<p>Read online: <a href="${safeSourceUrl}">${safeSourceLabel}</a></p>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${safeTitle}</title>
    <style>
      body { font-family: serif; line-height: 1.6; margin: 24px; }
      h1 { font-size: 1.6rem; margin-bottom: 0.25rem; }
      .meta { color: #666; margin-top: 0; }
      .excerpt { color: #555; font-style: italic; }
      .source { margin-top: 1rem; font-size: 0.9rem; }
      img { max-width: 100%; }
    </style>
  </head>
  <body>
    <h1>${safeTitle}</h1>
    ${metaHtml}
    ${excerptHtml}
    ${sourceHtml}
    ${bodyHtml}
  </body>
</html>`;
}

function buildKindleAttachment(item, reader) {
  const title = resolveTitle(item, reader);
  const filename = `${formatFilename(title)}.html`;
  const html = buildKindleHtml(item, reader);

  return {
    filename,
    content: toBase64(html),
    contentType: 'text/html; charset=utf-8'
  };
}

async function sendToKindle({ item, reader, env, cover, log }) {
  const apiKey = env?.RESEND_API_KEY;
  const toEmail = env?.KINDLE_TO_EMAIL;
  const fromEmail = env?.KINDLE_FROM_EMAIL;

  if (!apiKey || !toEmail || !fromEmail) {
    if (log) {
      log('error', 'kindle_send_config_missing', {
        stage: 'kindle_send',
        itemId: item?.id || null,
        url: item?.url || null,
        title: item?.title || null,
        missingApiKey: !apiKey,
        missingToEmail: !toEmail,
        missingFromEmail: !fromEmail
      });
    }
    throw new KindleSyncError('Kindle send not configured', {
      code: 'kindle_send_config_missing',
      retryable: false
    });
  }

  const attachment = await buildKindleAttachmentWithFallback(item, reader, cover, log);
  const subject = resolveTitle(item, reader);

  const payload = {
    from: fromEmail,
    to: toEmail,
    subject,
    text: `Sent from jeffharr.is read-later: ${item?.url || ''}`,
    attachments: [attachment]
  };

  const response = await fetchWithTimeout(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  }, RESEND_TIMEOUT_MS);

  if (!response.ok) {
    const details = await readResponseBody(response);
    if (log) {
      log('error', 'kindle_send_response_failed', {
        stage: 'kindle_send',
        itemId: item?.id || null,
        url: item?.url || null,
        title: item?.title || null,
        status: response.status,
        response: truncateString(details, 1200)
      });
    }
    throw new KindleSyncError(`Resend failed with ${response.status} ${details}`, {
      code: `kindle_send_response_${response.status}`,
      retryable: isRetryableStatus(response.status)
    });
  }

  return response.json();
}

async function buildKindleAttachmentWithFallback(item, reader, cover, log) {
  try {
    const epubResult = await buildEpubAttachment(item, reader, { coverImage: cover, log });
    if (epubResult?.attachment) {
      return epubResult.attachment;
    }
  } catch (error) {
    if (log) {
      log('warn', 'epub_build_failed', {
        stage: 'epub_build',
        itemId: item?.id || null,
        url: item?.url || null,
        title: item?.title || null,
        ...formatError(error)
      });
    } else {
      console.warn('EPUB build failed, falling back to HTML:', error);
    }
  }

  return buildKindleAttachment(item, reader);
}

async function syncKindleForItem(item, env, options = {}) {
  const attemptedAt = new Date().toISOString();
  const kv = options.kv;
  const onCoverPartial = options.onCoverPartial;
  const log = options.log;
  const logContext = {
    itemId: item?.id || null,
    url: item?.url || null,
    title: item?.title || null
  };

  if (!item?.url) {
    if (log) {
      log('warn', 'kindle_missing_url', {
        stage: 'kindle_sync',
        ...logContext
      });
    }
    return {
      reader: null,
      kindle: buildKindleState(KINDLE_STATUS.NEEDS_CONTENT, attemptedAt, 'Missing URL', {
        errorCode: 'kindle_missing_url',
        retryable: false
      }),
      cover: null
    };
  }

  const blocklisted = getKindleBlocklistEntry(item.url);
  if (blocklisted) {
    return {
      reader: null,
      kindle: buildKindleState(KINDLE_STATUS.UNSUPPORTED, attemptedAt, blocklisted.reason, {
        errorCode: 'kindle_unsupported_domain',
        retryable: false
      }),
      cover: null
    };
  }

  if (getYouTubeInfo(item.url)) {
    if (log) {
      log('info', 'kindle_unsupported_youtube', {
        stage: 'kindle_sync',
        ...logContext
      });
    }
    return {
      reader: null,
      kindle: buildKindleState(KINDLE_STATUS.UNSUPPORTED, attemptedAt, 'YouTube videos are not sent to Kindle', {
        errorCode: 'kindle_unsupported_youtube',
        retryable: false
      }),
      cover: null
    };
  }

  let reader = null;
  try {
    reader = await buildReaderContent(item.url, item.title, env?.BROWSER, { log, ...logContext });
  } catch (error) {
    if (log) {
      log('error', 'reader_fetch_failed', {
        stage: 'reader_fetch',
        ...logContext,
        ...formatError(error)
      });
    }
    return {
      reader: null,
      kindle: buildKindleState(KINDLE_STATUS.NEEDS_CONTENT, attemptedAt, compactError(error), {
        errorCode: 'reader_fetch_failed',
        retryable: true
      }),
      cover: null
    };
  }

  if (!reader || !shouldCacheKindleReader(reader)) {
    if (log) {
      log('warn', 'reader_unavailable', {
        stage: 'reader_fetch',
        ...logContext,
        wordCount: reader?.wordCount || 0,
        hasContent: Boolean(reader?.contentHtml)
      });
    }
    return {
      reader,
      kindle: buildKindleState(KINDLE_STATUS.NEEDS_CONTENT, attemptedAt, 'Reader unavailable', {
        errorCode: 'reader_unavailable',
        retryable: true
      }),
      cover: null
    };
  }

  let cover = null;
  if (kv) {
    try {
      cover = await ensureCoverImage({
        item,
        reader,
        env,
        kv,
        onPartial: onCoverPartial,
        log
      });
    } catch (error) {
      if (log) {
        log('error', 'cover_generation_failed', {
          stage: 'cover_generation',
          ...logContext,
          ...formatError(error)
        });
      } else {
        console.warn('Cover generation failed:', error);
      }
      cover = null;
    }
  }

  try {
    await sendToKindle({ item, reader, env, cover, log });
    if (log) {
      log('info', 'kindle_send_succeeded', {
        stage: 'kindle_send',
        ...logContext
      });
    }
    return {
      reader,
      kindle: {
        status: KINDLE_STATUS.SYNCED,
        lastAttemptAt: attemptedAt,
        lastSyncedAt: attemptedAt,
        lastError: null,
        errorCode: null,
        retryable: false
      },
      cover
    };
  } catch (error) {
    const errorCode = getKindleErrorCode(error);
    const retryable = isRetryableKindleError(error);
    if (log) {
      log('error', 'kindle_send_failed', {
        stage: 'kindle_send',
        ...logContext,
        errorCode,
        retryable,
        ...formatError(error)
      });
    }
    return {
      reader,
      kindle: buildKindleState(KINDLE_STATUS.FAILED, attemptedAt, compactError(error), {
        errorCode,
        retryable
      }),
      cover
    };
  }
}

function resolveTitle(item, reader) {
  return reader?.title || item?.title || deriveTitleFromUrl(item?.url || '');
}

function getKindleBlocklistEntry(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  return (
    KINDLE_DOMAIN_BLOCKLIST.find(({ domain }) => hostname === domain || hostname.endsWith(`.${domain}`)) ||
    null
  );
}

function formatFilename(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || 'read-later';
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toBase64(value) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(value, 'utf-8').toString('base64');
  }

  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  throw new Error('Base64 encoding unavailable');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = RESEND_TIMEOUT_MS) {
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
    return text ? `- ${text}` : '';
  } catch {
    return '';
  }
}

function shouldCacheKindleReader(reader) {
  return shouldCacheReader(reader);
}

function buildKindleState(status, attemptedAt, error, options = {}) {
  const errorCode = options.errorCode || null;
  const retryable = options.retryable !== false;

  return {
    status,
    lastAttemptAt: attemptedAt,
    lastSyncedAt: status === KINDLE_STATUS.SYNCED ? attemptedAt : null,
    lastError: error || null,
    errorCode,
    retryable: status === KINDLE_STATUS.SYNCED || status === KINDLE_STATUS.UNSUPPORTED
      ? false
      : retryable
  };
}

function compactError(error) {
  if (!error) return 'Unknown error';
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 240) || 'Unknown error';
}

function isRetryableStatus(status) {
  if (!Number.isFinite(status)) return true;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function isRetryableKindleError(error) {
  if (error && typeof error.retryable === 'boolean') {
    return error.retryable;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  if (/abort|timeout|network/i.test(message)) {
    return true;
  }

  return false;
}

function getKindleErrorCode(error) {
  if (error && typeof error.code === 'string' && error.code) {
    return error.code;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  if (/timeout|abort/i.test(message)) {
    return 'kindle_send_timeout';
  }
  return 'kindle_send_failed';
}

export {
  KINDLE_STATUS,
  buildKindleHtml,
  buildKindleAttachment,
  sendToKindle,
  syncKindleForItem,
  formatFilename,
  shouldCacheKindleReader
};
