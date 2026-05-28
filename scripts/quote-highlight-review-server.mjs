#!/usr/bin/env node

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildQuotesCollectionMarkdown,
  mergeImportedHighlights,
  normalizeState,
  parseKindleClippings,
  parseQuotesMarkdown,
  serializeQuotesMarkdown
} from './lib/kindle-highlights.mjs';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 8767;
const MAX_BODY_BYTES = 24 * 1024 * 1024;

const STATE_FILE = 'notes/quote-review-state.json';
const LEGACY_STATE_FILE = 'notes/kindle-highlights-state.json';
const QUOTES_FILE = 'notes/quotes-collection.md';
const REVIEW_PAGE = '/notes/quote-highlight-review.html';

const MIME_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.gif', 'image/gif'],
  ['.html', 'text/html; charset=utf-8'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp']
]);

export function createQuoteHighlightReviewServer({
  root = process.cwd(),
  stateFile = STATE_FILE,
  legacyStateFile = LEGACY_STATE_FILE,
  quotesFile = QUOTES_FILE
} = {}) {
  const repoRoot = path.resolve(root);
  const files = {
    state: path.join(repoRoot, stateFile),
    legacyState: path.join(repoRoot, legacyStateFile),
    quotes: path.join(repoRoot, quotesFile)
  };

  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://local.quote-highlights');

      if (url.pathname === '/api/quote-highlights/state') {
        await handleStateApi(request, response, files);
        return;
      }

      if (url.pathname === '/api/quote-highlights/import') {
        await handleImportApi(request, response, files);
        return;
      }

      if (url.pathname === '/api/quote-highlights/export') {
        await handleExportApi(request, response, files);
        return;
      }

      if (request.method !== 'GET' && request.method !== 'HEAD') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }

      if (url.pathname === '/') {
        response.writeHead(302, { Location: REVIEW_PAGE });
        response.end();
        return;
      }

      await serveStatic(request, response, repoRoot, url.pathname);
    } catch (error) {
      console.error(error);
      sendJson(response, 500, { error: error?.message || 'Internal server error' });
    }
  });
}

async function handleStateApi(request, response, files) {
  if (request.method === 'GET') {
    const state = await loadState(files);
    sendJson(response, 200, { state, files });
    return;
  }

  if (request.method === 'PUT') {
    const payload = await readJsonBody(request);
    const state = normalizeState(payload.state || payload);
    state.updatedAt = new Date().toISOString();
    await writeJsonAtomic(files.state, state);
    sendJson(response, 200, { ok: true, state, savedAt: state.updatedAt, files });
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed' });
}

async function handleImportApi(request, response, files) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const payload = await readJsonBody(request);
  const parsed = parseKindleClippings(payload.text || '');
  const now = new Date().toISOString();
  const previous = await loadState(files);
  const beforeCount = previous.order.length;
  const next = mergeImportedHighlights(previous, parsed.items, now);
  await writeJsonAtomic(files.state, next);

  sendJson(response, 200, {
    ok: true,
    imported: parsed.items.length,
    added: Math.max(0, next.order.length - beforeCount),
    skipped: parsed.skipped.length,
    state: next,
    files
  });
}

async function handleExportApi(request, response, files) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const state = await loadState(files);
  const markdown = serializeQuotesMarkdown(state);
  await writeTextAtomic(files.quotes, buildQuotesCollectionMarkdown(state));

  sendJson(response, 200, {
    ok: true,
    acceptedCount: markdown.acceptedCount,
    needsDetailsCount: markdown.needsDetailsCount,
    files
  });
}

async function loadState(files, { seedIfMissing = true } = {}) {
  const stored = await readJsonIfPresent(files.state);
  if (stored) {
    const normalized = normalizeState(stored);
    if (normalized.order.length || !seedIfMissing) return normalized;
  }

  const legacy = await readJsonIfPresent(files.legacyState);
  if (legacy) {
    const normalized = normalizeState(legacy);
    if (normalized.order.length || !seedIfMissing) return normalized;
  }

  if (!seedIfMissing) return normalizeState(null);

  const quotes = await readTextIfPresent(files.quotes, '');
  return normalizeState(null, { seedItems: parseQuotesMarkdown(quotes) });
}

async function serveStatic(request, response, repoRoot, requestPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(requestPath);
  } catch {
    sendJson(response, 400, { error: 'Bad request path' });
    return;
  }

  const normalized = path.normalize(decodedPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(repoRoot, normalized);
  const resolved = path.resolve(filePath);
  if (resolved !== repoRoot && !resolved.startsWith(`${repoRoot}${path.sep}`)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }

  let stats;
  try {
    stats = await stat(resolved);
  } catch {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  if (!stats.isFile()) {
    sendJson(response, 404, { error: 'Not found' });
    return;
  }

  response.writeHead(200, {
    'Content-Type': MIME_TYPES.get(path.extname(resolved).toLowerCase()) || 'application/octet-stream',
    'Content-Length': stats.size,
    'Cache-Control': 'no-store'
  });

  if (request.method === 'HEAD') {
    response.end();
    return;
  }

  createReadStream(resolved).pipe(response);
}

async function readJsonBody(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
      throw new Error('Request body too large');
    }
  }
  return JSON.parse(body || '{}');
}

async function readJsonIfPresent(filePath) {
  try {
    return JSON.parse(await readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function readTextIfPresent(filePath, fallback = '') {
  try {
    return await readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeTextAtomic(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(tempPath, text);
  await rename(tempPath, filePath);
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  response.end(JSON.stringify(payload, null, 2));
}

function parseArgs(argv) {
  const options = {
    host: process.env.HOST || DEFAULT_HOST,
    port: Number(process.env.PORT || DEFAULT_PORT),
    root: process.cwd()
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--host') options.host = argv[++index] || options.host;
    if (arg === '--port') options.port = Number(argv[++index] || options.port);
    if (arg === '--root') options.root = argv[++index] || options.root;
  }

  return options;
}

if (import.meta.url === pathToFileURL(fileURLToPath(import.meta.url)).href && process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  const server = createQuoteHighlightReviewServer({ root: options.root });
  server.listen(options.port, options.host, () => {
    console.log(`Quote review server: http://${options.host}:${options.port}${REVIEW_PAGE}`);
    console.log(`State file: ${path.resolve(options.root, STATE_FILE)}`);
    console.log(`Legacy state file: ${path.resolve(options.root, LEGACY_STATE_FILE)}`);
    console.log(`Quotes file: ${path.resolve(options.root, QUOTES_FILE)}`);
  });
}
