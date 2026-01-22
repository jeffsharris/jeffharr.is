#!/usr/bin/env node
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const USER_AGENT = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';
const FETCH_TIMEOUT_MS = 12000;
const KV_PREFIX = 'item:';
const MAX_TITLE_LENGTH = 220;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const apply = args.apply;
const onlySuspicious = !args.all;
const limit = args.limit;
const delayMs = Number.isFinite(args.delayMs) ? args.delayMs : 150;

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID || process.env.CF_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN || process.env.CF_API_TOKEN;
const namespaceId = args.namespaceId
  || process.env.READ_LATER_NAMESPACE_ID
  || await readNamespaceIdFromWrangler();

if (!accountId || !apiToken || !namespaceId) {
  console.error('Missing required configuration.');
  console.error('Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN.');
  console.error('Optionally set READ_LATER_NAMESPACE_ID or pass --namespace-id.');
  process.exit(1);
}

const keys = await listKeys({
  accountId,
  apiToken,
  namespaceId,
  prefix: KV_PREFIX
});

console.log(`Found ${keys.length} read-later items.`);

let scanned = 0;
let skipped = 0;
let updated = 0;
let unchanged = 0;
let failed = 0;

for (const key of keys) {
  if (limit && scanned >= limit) break;
  scanned += 1;

  let item = null;
  try {
    item = await fetchKvJson({ accountId, apiToken, namespaceId, key: key.name });
  } catch (error) {
    failed += 1;
    console.warn(`[${scanned}/${keys.length}] Failed to load ${key.name}:`, error.message);
    continue;
  }

  if (!item || !item.url) {
    skipped += 1;
    continue;
  }

  if (onlySuspicious && !isSuspiciousTitle(item.title, item.url)) {
    skipped += 1;
    continue;
  }

  try {
    const result = await extractBestTitle(item.url, item.title || '');
    const newTitle = trimTitleLength(result.title);

    if (!newTitle || newTitle === item.title) {
      unchanged += 1;
      continue;
    }

    const nextItem = { ...item, title: newTitle };

    if (apply) {
      await putKvJson({ accountId, apiToken, namespaceId, key: key.name, value: nextItem });
      updated += 1;
      console.log(`[${scanned}/${keys.length}] Updated: "${item.title}" -> "${newTitle}" (${result.source})`);
    } else {
      updated += 1;
      console.log(`[${scanned}/${keys.length}] Would update: "${item.title}" -> "${newTitle}" (${result.source})`);
    }
  } catch (error) {
    failed += 1;
    console.warn(`[${scanned}/${keys.length}] Failed to refresh ${item.url}:`, error.message);
  }

  if (delayMs > 0) {
    await delay(delayMs);
  }
}

console.log('Done.');
console.log(`Scanned: ${scanned}`);
console.log(`Updated: ${updated}`);
console.log(`Unchanged: ${unchanged}`);
console.log(`Skipped: ${skipped}`);
console.log(`Failed: ${failed}`);

function parseArgs(argv) {
  const parsed = {
    apply: false,
    all: false,
    limit: null,
    delayMs: 150,
    namespaceId: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      parsed.apply = true;
      continue;
    }
    if (arg === '--dry-run') {
      parsed.apply = false;
      continue;
    }
    if (arg === '--all') {
      parsed.all = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      parsed.help = true;
      continue;
    }
    if (arg === '--limit' && argv[i + 1]) {
      parsed.limit = toNumber(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--limit=')) {
      parsed.limit = toNumber(arg.split('=')[1]);
      continue;
    }
    if (arg === '--delay-ms' && argv[i + 1]) {
      parsed.delayMs = toNumber(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--delay-ms=')) {
      parsed.delayMs = toNumber(arg.split('=')[1]);
      continue;
    }
    if (arg === '--namespace-id' && argv[i + 1]) {
      parsed.namespaceId = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--namespace-id=')) {
      parsed.namespaceId = arg.split('=')[1];
    }
  }

  return parsed;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function printHelp() {
  console.log(`Refresh read-later titles by refetching source HTML.

Usage:
  node scripts/refresh-read-later-titles.js [--apply] [--all] [--limit 25] [--delay-ms 150] [--namespace-id <id>]

Defaults:
  - Dry-run unless --apply is provided.
  - Only refetches items with suspiciously short titles unless --all is provided.
`);
}

async function readNamespaceIdFromWrangler() {
  try {
    const text = await fs.readFile('wrangler.toml', 'utf8');
    const lines = text.split(/\r?\n/);
    let inReadLater = false;

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('[[')) {
        inReadLater = false;
      }
      if (trimmed.startsWith('binding') && trimmed.includes('READ_LATER')) {
        inReadLater = true;
        continue;
      }
      if (inReadLater && trimmed.startsWith('id')) {
        const match = trimmed.match(/id\s*=\s*"([^"]+)"/);
        if (match) return match[1];
      }
    }
  } catch {
    return null;
  }

  return null;
}

async function listKeys({ accountId, apiToken, namespaceId, prefix }) {
  const keys = [];
  let cursor = null;

  while (true) {
    const params = new URLSearchParams({
      prefix,
      limit: '1000'
    });
    if (cursor) params.set('cursor', cursor);

    const payload = await cfRequest({
      apiToken,
      path: `/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/keys?${params}`
    });

    const batch = Array.isArray(payload.result) ? payload.result : [];
    keys.push(...batch);

    const nextCursor = payload.result_info?.cursor;
    if (!nextCursor || nextCursor === cursor || batch.length === 0) break;
    cursor = nextCursor;
  }

  return keys;
}

async function fetchKvJson({ accountId, apiToken, namespaceId, key }) {
  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      headers: {
        Authorization: `Bearer ${apiToken}`
      }
    }
  );

  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `HTTP ${response.status}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function putKvJson({ accountId, apiToken, namespaceId, key, value }) {
  const response = await fetch(
    `${API_BASE}/accounts/${accountId}/storage/kv/namespaces/${namespaceId}/values/${encodeURIComponent(key)}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(value)
    }
  );

  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map((error) => error.message).join('; ')
      || payload?.messages?.join('; ')
      || `HTTP ${response.status}`;
    throw new Error(message);
  }
}

async function cfRequest({ apiToken, path, method = 'GET', body = null }) {
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : null
  });

  const payload = await response.json();
  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map((error) => error.message).join('; ')
      || payload?.messages?.join('; ')
      || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

async function extractBestTitle(url, fallbackTitle) {
  const html = await fetchHtml(url);
  const { document } = parseHTML(html);

  try {
    document.URL = url;
    document.baseURI = url;
  } catch {
    // Ignore if not supported.
  }

  let readabilityTitle = '';
  try {
    const reader = new Readability(document).parse();
    readabilityTitle = normalizeTitleValue(reader?.title || '');
  } catch {
    readabilityTitle = '';
  }

  const ogTitle = normalizeTitleValue(getMetaContent(document, 'property', 'og:title'));
  const twitterTitle = normalizeTitleValue(getMetaContent(document, 'name', 'twitter:title'));
  const docTitle = normalizeTitleValue(document.title || '');

  const candidates = [
    { title: readabilityTitle, source: 'readability' },
    { title: ogTitle, source: 'og:title' },
    { title: twitterTitle, source: 'twitter:title' },
    { title: docTitle, source: 'title' }
  ].filter((entry) => entry.title);

  let resolved = normalizeTitleValue(fallbackTitle);
  let source = 'current';

  for (const candidate of candidates) {
    const updated = preferReaderTitle(resolved, candidate.title, url);
    if (updated && updated !== resolved) {
      resolved = updated;
      source = candidate.source;
    }
  }

  return { title: resolved || fallbackTitle, source };
}

function getMetaContent(document, attr, name) {
  if (!document) return '';
  const element = document.querySelector(`meta[${attr}="${name}"]`);
  if (!element) return '';
  return element.getAttribute('content') || '';
}

async function fetchHtml(url) {
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml'
    }
  }, FETCH_TIMEOUT_MS);

  if (!response.ok) {
    throw new Error(`Fetch failed with ${response.status}`);
  }

  return response.text();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isSuspiciousTitle(title, url) {
  const normalized = normalizeTitleValue(title);
  if (!normalized) return true;

  const fallback = normalizeTitleValue(deriveTitleFromUrl(url || ''));
  if (fallback && normalized.toLowerCase() === fallback.toLowerCase()) {
    return true;
  }

  const wordCount = normalized.split(' ').filter(Boolean).length;
  return wordCount <= 1;
}

function preferReaderTitle(currentTitle, readerTitle, url) {
  const current = normalizeTitleValue(currentTitle);
  const candidate = normalizeTitleValue(readerTitle);

  if (!candidate) return current;
  if (!current) return candidate;

  if (current.toLowerCase() === candidate.toLowerCase()) {
    return current;
  }

  const fallback = normalizeTitleValue(deriveTitleFromUrl(url || ''));
  if (fallback && current.toLowerCase() === fallback.toLowerCase()) {
    return candidate;
  }

  const currentWords = current.split(' ').filter(Boolean);
  const candidateWords = candidate.split(' ').filter(Boolean);

  if (currentWords.length === 1 && candidateWords.length > 1) {
    if (candidate.toLowerCase().startsWith(current.toLowerCase())) {
      return candidate;
    }
  }

  return current;
}

function normalizeTitleValue(value) {
  if (typeof value !== 'string') return '';
  return decodeHtmlEntities(value).replace(/\s+/g, ' ').trim();
}

function trimTitleLength(value) {
  if (typeof value !== 'string') return '';
  if (value.length <= MAX_TITLE_LENGTH) return value;
  return value.slice(0, MAX_TITLE_LENGTH).trim();
}

function deriveTitleFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || url;
  } catch {
    return url || 'Untitled';
  }
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
