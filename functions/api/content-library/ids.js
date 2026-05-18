const MAX_URL_LENGTH = 2048;

function getNowIso() {
  return new Date().toISOString();
}

function createRandomId(prefix = 'id') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function createStableId(prefix, value, length = 16) {
  const hash = await hashText(value);
  return `${prefix}_${hash.slice(0, length)}`;
}

async function hashText(text) {
  const input = new TextEncoder().encode(String(text || ''));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function normalizeHttpUrl(input) {
  if (typeof input !== 'string') return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const parsed = tryParseUrl(trimmed) || tryParseUrl(`https://${trimmed}`);
  if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  const normalized = parsed.toString();
  if (normalized.length > MAX_URL_LENGTH) return null;
  return normalized;
}

function canonicalUrlKey(url) {
  const normalized = normalizeHttpUrl(url);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  parsed.hash = '';
  if (parsed.pathname === '/') parsed.pathname = '/';
  return parsed.toString();
}

function canonicalKeyForUrl(url, kind = 'url') {
  const keyUrl = canonicalUrlKey(url);
  return keyUrl ? `${kind}:url:${keyUrl}` : null;
}

function tryParseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function safeJsonParse(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

export {
  canonicalKeyForUrl,
  canonicalUrlKey,
  createRandomId,
  createStableId,
  getNowIso,
  hashText,
  normalizeHttpUrl,
  safeJsonParse,
  stringifyJson
};
