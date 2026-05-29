#!/usr/bin/env node

import { readFile, rename, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  mergeImportedHighlights,
  normalizeState,
  parseKindleNotebookExport,
  parseQuotesMarkdown
} from './lib/kindle-highlights.mjs';

const DEFAULT_INPUT_FILE = '/private/tmp/kindle-notebook-export.json';
const DEFAULT_STATE_FILE = 'notes/quote-review-state.json';
const DEFAULT_LEGACY_STATE_FILE = 'notes/kindle-highlights-state.json';
const DEFAULT_QUOTES_FILE = 'notes/quotes-collection.md';

const options = parseArgs(process.argv.slice(2));
const inputPath = path.resolve(options.input || DEFAULT_INPUT_FILE);
const statePath = path.resolve(options.state || DEFAULT_STATE_FILE);
const legacyStatePath = path.resolve(options.legacyState || DEFAULT_LEGACY_STATE_FILE);
const quotesPath = path.resolve(options.quotes || DEFAULT_QUOTES_FILE);

const payload = JSON.parse(await readFile(inputPath, 'utf8'));
const parsed = parseKindleNotebookExport(payload);
const previous = await loadState({ statePath, legacyStatePath, quotesPath });
const beforeCount = previous.order.length;
const now = new Date().toISOString();
const next = mergeImportedHighlights(previous, parsed.items, now);

await writeJsonAtomic(statePath, next);

const added = Math.max(0, next.order.length - beforeCount);
console.log(JSON.stringify({
  ok: true,
  input: inputPath,
  state: statePath,
  imported: parsed.items.length,
  added,
  skipped: parsed.skipped.length,
  total: next.order.length,
  updatedAt: now
}, null, 2));

async function loadState({ statePath, legacyStatePath, quotesPath }) {
  const stored = await readJsonIfPresent(statePath);
  if (stored) return normalizeState(stored);

  const legacy = await readJsonIfPresent(legacyStatePath);
  if (legacy) return normalizeState(legacy);

  const quotes = await readTextIfPresent(quotesPath, '');
  return normalizeState(null, { seedItems: parseQuotesMarkdown(quotes) });
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
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(tempPath, filePath);
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--input') parsed.input = argv[++index];
    else if (arg === '--state') parsed.state = argv[++index];
    else if (arg === '--legacy-state') parsed.legacyState = argv[++index];
    else if (arg === '--quotes') parsed.quotes = argv[++index];
    else if (!parsed.input) parsed.input = arg;
  }

  return parsed;
}
