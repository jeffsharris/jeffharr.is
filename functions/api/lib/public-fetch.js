// External content is untrusted, including each redirect and the response body.
export function publicUrl(value) {
  const url = new URL(value);
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) || !host.includes('.') ||
      host.includes(':') || /^[\d.]+$/.test(host) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host) ||
      host === 'metadata.google.internal') {
    throw new Error('Only public HTTP(S) URLs are supported');
  }
  return url;
}

export async function publicFetch(value, options = {}, {
  fetchImpl = globalThis.fetch, timeoutMs = 10000, maxBytes = 8 * 1024 * 1024,
  maxRedirects = 5
} = {}) {
  let url = publicUrl(value);
  let init = { ...options, headers: new Headers(options.headers) };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('External fetch timed out')), timeoutMs);
  const abort = () => controller.abort(options.signal.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener('abort', abort, { once: true });
  try {
    for (let redirects = 0; ; redirects += 1) {
      const response = await fetchImpl(url.href, { ...init, redirect: 'manual', signal: controller.signal });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel();
        if (redirects >= maxRedirects) throw new Error('Too many redirects');
        const location = response.headers.get('location');
        if (!location) throw new Error('Redirect missing location');
        const next = publicUrl(new URL(location, url));
        if (next.origin !== url.origin) {
          for (const name of ['authorization', 'cookie', 'proxy-authorization']) init.headers.delete(name);
        }
        if (response.status === 303 || ([301, 302].includes(response.status) && init.method === 'POST')) {
          init = { ...init, method: 'GET', body: undefined };
          init.headers.delete('content-type');
        }
        url = next;
        continue;
      }
      if (Number(response.headers.get('content-length')) > maxBytes) {
        await response.body?.cancel();
        throw new Error('External response too large');
      }
      if (!response.body) return response;
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      const cancel = () => { reader.cancel(controller.signal.reason).catch(() => {}); };
      controller.signal.addEventListener('abort', cancel, { once: true });
      try {
        while (true) {
          controller.signal.throwIfAborted();
          const { done, value: chunk } = await reader.read();
          controller.signal.throwIfAborted();
          if (done) break;
          size += chunk.byteLength;
          if (size > maxBytes) { await reader.cancel(); throw new Error('External response too large'); }
          chunks.push(chunk);
        }
      } finally {
        controller.signal.removeEventListener('abort', cancel);
        reader.releaseLock();
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const result = new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperty(result, 'url', { value: response.url || url.href });
      return result;
    }
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
