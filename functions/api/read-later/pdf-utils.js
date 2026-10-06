import { publicFetch } from '../lib/public-fetch.js';

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

async function fetchPdfBytes(itemOrUrl, { log, assetStore, itemId } = {}) {
  const url = typeof itemOrUrl === 'string' ? itemOrUrl : itemOrUrl?.url;
  const assetItemId = itemId || itemOrUrl?.itemId || itemOrUrl?.id;
  if (assetItemId && assetStore?.getOriginalPdf) {
    const stored = await assetStore.getOriginalPdf(assetItemId);
    if (stored?.bytes) return { ...stored, bytes: new Uint8Array(stored.bytes) };
  }
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
      url: new URL(url).origin + new URL(url).pathname,
      title: itemOrUrl?.title || null,
      bytes: bytes.length
    });
  }

  const filename = pdfFilename(response.headers.get('content-disposition'), url);
  if (assetItemId && assetStore?.saveOriginalPdf) {
    await assetStore.saveOriginalPdf(assetItemId, { bytes, filename });
  }
  return {
    bytes,
    filename,
    contentType: contentType || 'application/pdf'
  };
}

function pdfFilename(disposition, url) {
  let name = '';
  const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition || '');
  const ordinary = /filename\s*=\s*(?:"([^"]+)"|([^;]+))/i.exec(disposition || '');
  try {
    name = extended ? decodeURIComponent(extended[1]) : ordinary?.[1] || ordinary?.[2] || '';
    if (!name && url) {
      const parsed = new URL(url);
      const downloadDisposition = parsed.searchParams.get('response-content-disposition');
      if (downloadDisposition) return pdfFilename(downloadDisposition, null);
      name = decodeURIComponent(parsed.pathname.split('/').pop() || '');
    }
  } catch { /* Use a safe filename when source headers are malformed. */ }
  return name.replace(/[\\/\u0000-\u001f\u007f]/g, '').trim().slice(0, 180) || 'document.pdf';
}

function hasPdfMagic(bytes) {
  return bytes?.[0] === 0x25
    && bytes?.[1] === 0x50
    && bytes?.[2] === 0x44
    && bytes?.[3] === 0x46
    && bytes?.[4] === 0x2d;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = PDF_FETCH_TIMEOUT_MS) {
  return publicFetch(url, options, { timeoutMs, maxBytes: PDF_MAX_BYTES });
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
  isLikelyPdfUrl,
  pdfFilename
};
