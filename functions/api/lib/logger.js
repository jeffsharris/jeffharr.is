const DEFAULT_MAX_LENGTH = 1200;

function truncateString(value, maxLength = DEFAULT_MAX_LENGTH) {
  if (typeof value !== 'string') return value;
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength) + '...';
}

function createFallbackId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function getRequestId(request) {
  if (!request || !request.headers) return createFallbackId();
  const headerId = request.headers.get('cf-ray') || request.headers.get('x-request-id');
  return headerId || createFallbackId();
}

function createLogger({ request, source }) {
  const requestId = getRequestId(request);
  const method = request?.method || null;
  let path = null;

  try {
    if (request?.url) {
      path = new URL(request.url).pathname;
    }
  } catch {
    path = null;
  }

  const base = {
    requestId,
    source: source || 'app',
    method,
    path
  };

  const log = (level, event, data = {}) => {
    const payload = {
      level,
      event,
      timestamp: new Date().toISOString(),
      ...base,
      ...data
    };

    let line = '';
    try {
      line = JSON.stringify(payload);
    } catch {
      line = JSON.stringify({
        level: 'error',
        event: 'log_serialize_failed',
        timestamp: new Date().toISOString(),
        ...base
      });
    }

    if (level === 'error') {
      console.error(line);
      return;
    }

    if (level === 'warn') {
      console.warn(line);
      return;
    }

    console.log(line);
  };

  return { requestId, log };
}

function formatError(error, maxLength = 800) {
  if (!error) {
    return { error: null };
  }

  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : null;
  const formatted = {
    error: truncateString(message, maxLength)
  };

  if (name) {
    formatted.errorName = name;
  }

  return formatted;
}

export { createLogger, formatError, truncateString };
