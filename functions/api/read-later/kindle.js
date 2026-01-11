import { deriveTitleFromUrl, shouldCacheReader } from './reader-utils.js';
import { buildReaderContent } from './reader.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESEND_TIMEOUT_MS = 10000;
const KINDLE_STATUS = {
  SYNCED: 'synced',
  FAILED: 'failed',
  NEEDS_CONTENT: 'needs-content'
};

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

async function sendToKindle({ item, reader, env }) {
  const apiKey = env?.RESEND_API_KEY;
  const toEmail = env?.KINDLE_TO_EMAIL;
  const fromEmail = env?.KINDLE_FROM_EMAIL;

  if (!apiKey || !toEmail || !fromEmail) {
    throw new Error('Kindle send not configured');
  }

  const attachment = buildKindleAttachment(item, reader);
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
    throw new Error(`Resend failed with ${response.status} ${details}`);
  }

  return response.json();
}

async function syncKindleForItem(item, env) {
  const attemptedAt = new Date().toISOString();

  if (!item?.url) {
    return {
      reader: null,
      kindle: buildKindleState(KINDLE_STATUS.NEEDS_CONTENT, attemptedAt, 'Missing URL')
    };
  }

  let reader = null;
  try {
    reader = await buildReaderContent(item.url, item.title, env?.BROWSER);
  } catch (error) {
    return {
      reader: null,
      kindle: buildKindleState(KINDLE_STATUS.NEEDS_CONTENT, attemptedAt, compactError(error))
    };
  }

  if (!reader || !shouldCacheKindleReader(reader)) {
    return {
      reader,
      kindle: buildKindleState(KINDLE_STATUS.NEEDS_CONTENT, attemptedAt, 'Reader unavailable')
    };
  }

  try {
    await sendToKindle({ item, reader, env });
    return {
      reader,
      kindle: {
        status: KINDLE_STATUS.SYNCED,
        lastAttemptAt: attemptedAt,
        lastSyncedAt: attemptedAt,
        lastError: null
      }
    };
  } catch (error) {
    return {
      reader,
      kindle: buildKindleState(KINDLE_STATUS.FAILED, attemptedAt, compactError(error))
    };
  }
}

function resolveTitle(item, reader) {
  return reader?.title || item?.title || deriveTitleFromUrl(item?.url || '');
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

function buildKindleState(status, attemptedAt, error) {
  return {
    status,
    lastAttemptAt: attemptedAt,
    lastSyncedAt: status === KINDLE_STATUS.SYNCED ? attemptedAt : null,
    lastError: error || null
  };
}

function compactError(error) {
  if (!error) return 'Unknown error';
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 240) || 'Unknown error';
}

export {
  buildKindleHtml,
  buildKindleAttachment,
  sendToKindle,
  syncKindleForItem,
  formatFilename,
  shouldCacheKindleReader
};
