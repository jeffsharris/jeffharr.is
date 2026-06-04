const PDF_FETCH_TIMEOUT_MS = 10000;
const PDF_MAX_BYTES = 35 * 1024 * 1024;

class PdfFetchError extends Error {
  constructor(message, { code = null, retryable = true } = {}) {
    super(message);
    this.name = 'PdfFetchError';
    this.code = code;
    this.retryable = retryable;
  }
}

function isLikelyPdfUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.toLowerCase().endsWith('.pdf');
  } catch {
    return false;
  }
}

async function fetchPdfBytes(itemOrUrl, { log } = {}) {
  const url = typeof itemOrUrl === 'string' ? itemOrUrl : itemOrUrl?.url;
  if (!url) {
    throw new PdfFetchError('Missing PDF URL', {
      code: 'pdf_missing_url',
      retryable: false
    });
  }

  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)',
      'Accept': 'application/pdf'
    }
  }, PDF_FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new PdfFetchError(`PDF fetch failed with ${response.status}`, {
      code: `pdf_fetch_${response.status}`,
      retryable: isRetryableStatus(response.status)
    });
  }

  const contentLength = Number.parseInt(response.headers.get('content-length') || '', 10);
  if (Number.isFinite(contentLength) && contentLength > PDF_MAX_BYTES) {
    throw new PdfFetchError('PDF is too large to send to Kindle', {
      code: 'pdf_too_large',
      retryable: false
    });
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length) {
    throw new PdfFetchError('PDF response was empty', {
      code: 'pdf_empty',
      retryable: false
    });
  }

  if (bytes.length > PDF_MAX_BYTES) {
    throw new PdfFetchError('PDF is too large to send to Kindle', {
      code: 'pdf_too_large',
      retryable: false
    });
  }

  const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType && contentType !== 'application/pdf' && !hasPdfMagic(bytes)) {
    throw new PdfFetchError('PDF URL did not return a PDF', {
      code: 'pdf_invalid_content_type',
      retryable: false
    });
  }

  if (!hasPdfMagic(bytes)) {
    throw new PdfFetchError('PDF response did not contain PDF bytes', {
      code: 'pdf_invalid_bytes',
      retryable: false
    });
  }

  if (log && typeof itemOrUrl !== 'string') {
    log('info', 'pdf_fetched', {
      stage: 'pdf_fetch',
      itemId: itemOrUrl?.id || null,
      url: itemOrUrl?.url || null,
      title: itemOrUrl?.title || null,
      bytes: bytes.length
    });
  }

  return {
    bytes,
    contentType: contentType || 'application/pdf'
  };
}

function hasPdfMagic(bytes) {
  return bytes?.[0] === 0x25
    && bytes?.[1] === 0x50
    && bytes?.[2] === 0x44
    && bytes?.[3] === 0x46
    && bytes?.[4] === 0x2d;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PDF_FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isRetryableStatus(status) {
  if (!Number.isFinite(status)) return true;
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export {
  PDF_MAX_BYTES,
  PdfFetchError,
  fetchPdfBytes,
  hasPdfMagic,
  isLikelyPdfUrl
};
