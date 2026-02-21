#!/usr/bin/env node
import fs from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const API_BASE = 'https://api.cloudflare.com/client/v4';
const ITEM_PREFIX = 'item:';
const COVER_PREFIX = 'cover:';
const DEFAULT_DELAY_MS = 120;
const FETCH_TIMEOUT_MS = 20000;
const MAX_COVER_BYTES = 8 * 1024 * 1024;
const IMAGE_UA = 'Mozilla/5.0 (compatible; jeffharr.is/1.0; +https://jeffharr.is)';

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  printHelp();
  process.exit(0);
}

const apply = args.apply;
const limit = args.limit;
const delayMs = Number.isFinite(args.delayMs) ? args.delayMs : DEFAULT_DELAY_MS;

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
  prefix: ITEM_PREFIX
});

console.log(`Found ${keys.length} read-later items.`);

let scanned = 0;
let externalItems = 0;
let migrated = 0;
let alreadyStored = 0;
let strippedOnly = 0;
let fetchFailed = 0;
let skipped = 0;
let failed = 0;

for (const key of keys) {
  if (limit && scanned >= limit) break;
  scanned += 1;

  let item = null;
  try {
    item = await fetchKvJson({ accountId, apiToken, namespaceId, key: key.name });
  } catch (error) {
    failed += 1;
    console.warn(`[${scanned}/${keys.length}] Failed to load ${key.name}: ${error.message}`);
    continue;
  }

  if (!item?.id) {
    skipped += 1;
    continue;
  }

  const externalUrl = normalizeUrl(item?.cover?.externalUrl);
  if (!externalUrl) {
    skipped += 1;
    continue;
  }
  externalItems += 1;

  const coverKey = `${COVER_PREFIX}${item.id}`;
  let storedCover = null;
  try {
    storedCover = await fetchKvJson({ accountId, apiToken, namespaceId, key: coverKey });
  } catch {
    storedCover = null;
  }

  const hasStoredCover = Boolean(storedCover?.base64);
  let nextCoverPayload = hasStoredCover ? storedCover : null;

  if (!hasStoredCover) {
    if (!apply) {
      console.log(`[dry-run] Would fetch and store ${coverKey} from ${externalUrl}`);
    } else {
      try {
        nextCoverPayload = await fetchExternalCover(externalUrl);
        await putKvJson({
          accountId,
          apiToken,
          namespaceId,
          key: coverKey,
          value: nextCoverPayload
        });
        migrated += 1;
      } catch (error) {
        fetchFailed += 1;
        console.warn(`[${scanned}/${keys.length}] Failed to fetch cover for ${item.id}: ${error.message}`);
        continue;
      }
    }
  } else {
    alreadyStored += 1;
  }

  const now = new Date().toISOString();
  const updatedAt = nextCoverPayload?.createdAt || item?.cover?.updatedAt || now;
  const nextItem = {
    ...item,
    cover: { updatedAt }
  };
  if (!apply) {
    const action = hasStoredCover ? 'strip externalUrl only' : 'store cover + strip externalUrl';
    console.log(`[dry-run] Would ${action} for ${item.id}`);
    continue;
  }

  try {
    await putKvJson({
      accountId,
      apiToken,
      namespaceId,
      key: key.name,
      value: nextItem
    });
    if (hasStoredCover) {
      strippedOnly += 1;
    }
  } catch (error) {
    failed += 1;
    console.warn(`[${scanned}/${keys.length}] Failed to update ${item.id}: ${error.message}`);
  }

  if (delayMs > 0) {
    await delay(delayMs);
  }
}

console.log('Done.');
console.log(`Scanned: ${scanned}`);
console.log(`External URL items: ${externalItems}`);
console.log(`Migrated (downloaded and stored): ${migrated}`);
console.log(`Already had stored cover: ${alreadyStored}`);
console.log(`Stripped externalUrl only: ${strippedOnly}`);
console.log(`Fetch failures: ${fetchFailed}`);
console.log(`Skipped: ${skipped}`);
console.log(`Failed: ${failed}`);

function parseArgs(argv) {
  const parsed = {
    apply: false,
    limit: null,
    delayMs: DEFAULT_DELAY_MS,
    namespaceId: null,
    help: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      parsed.apply = true;
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
  console.log(`Migrate read-later cover.externalUrl metadata into stored cover blobs.

Usage:
  node scripts/migrate-read-later-external-covers.js [--apply] [--limit 25] [--delay-ms 120] [--namespace-id <id>]

Defaults:
  - Dry-run unless --apply is provided.
`);
}

function normalizeUrl(value) {
  const input = typeof value === 'string' ? value.trim() : '';
  if (!input) return null;
  try {
    const parsed = new URL(input);
    if (!['http:', 'https:'].includes(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
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
        'Content-Type': 'text/plain'
      },
      body: JSON.stringify(value)
    }
  );

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(body || `HTTP ${response.status}`);
  }
}

async function cfRequest({ apiToken, path }) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json'
    }
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const errors = Array.isArray(payload?.errors)
      ? payload.errors.map((entry) => entry?.message).filter(Boolean).join('; ')
      : '';
    throw new Error(errors || `Cloudflare API request failed with HTTP ${response.status}`);
  }
  return payload;
}

async function fetchExternalCover(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'image/*',
        'User-Agent': IMAGE_UA
      }
    });

    if (!response.ok) {
      throw new Error(`External fetch returned ${response.status}`);
    }

    const contentType = (response.headers.get('content-type') || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`Unsupported content type: ${contentType || 'unknown'}`);
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!bytes.length) {
      throw new Error('Empty image response');
    }
    if (bytes.length > MAX_COVER_BYTES) {
      throw new Error(`Image too large (${bytes.length} bytes)`);
    }

    return {
      base64: Buffer.from(bytes).toString('base64'),
      contentType,
      createdAt: new Date().toISOString()
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
