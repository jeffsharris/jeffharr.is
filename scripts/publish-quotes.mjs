#!/usr/bin/env node

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildQuotesCollectionMarkdown,
  normalizeState,
  parseQuotesMarkdown,
  serializePublicQuotes
} from './lib/kindle-highlights.mjs';

const DEFAULT_STATE_FILE = 'notes/quote-review-state.json';
const DEFAULT_LEGACY_STATE_FILE = 'notes/kindle-highlights-state.json';
const DEFAULT_QUOTES_FILE = 'notes/quotes-collection.md';
const DEFAULT_PUBLIC_JSON_FILE = 'quotes/quotes.json';
const DEFAULT_PUBLIC_HTML_FILE = 'quotes/index.html';

const options = parseArgs(process.argv.slice(2));
const statePath = path.resolve(options.state || DEFAULT_STATE_FILE);
const legacyStatePath = path.resolve(options.legacyState || DEFAULT_LEGACY_STATE_FILE);
const quotesPath = path.resolve(options.quotes || DEFAULT_QUOTES_FILE);
const publicJsonPath = path.resolve(options.publicJson || DEFAULT_PUBLIC_JSON_FILE);
const publicHtmlPath = path.resolve(options.publicHtml || DEFAULT_PUBLIC_HTML_FILE);

const state = await loadState({ statePath, legacyStatePath, quotesPath });
const publicQuotes = serializePublicQuotes(state);
const payload = {
  version: 1,
  count: publicQuotes.length,
  quotes: publicQuotes
};

await writeTextAtomic(quotesPath, buildQuotesCollectionMarkdown(state));
await writeJsonAtomic(publicJsonPath, payload);
await writeTextAtomic(publicHtmlPath, buildQuotesPage(publicQuotes));

console.log(JSON.stringify({
  ok: true,
  publicQuotes: publicQuotes.length,
  markdown: quotesPath,
  json: publicJsonPath,
  html: publicHtmlPath
}, null, 2));

async function loadState({ statePath, legacyStatePath, quotesPath }) {
  const stored = await readJsonIfPresent(statePath);
  if (stored) return normalizeState(stored);

  const legacy = await readJsonIfPresent(legacyStatePath);
  if (legacy) return normalizeState(legacy);

  const quotes = await readTextIfPresent(quotesPath, '');
  return normalizeState(null, { seedItems: parseQuotesMarkdown(quotes) });
}

function buildQuotesPage(quotes) {
  const authors = authorOptions(quotes);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Quotes | Jeff Harris</title>
  <meta name="description" content="Quotes I love">
  <link rel="canonical" href="https://jeffharr.is/quotes/">
  <meta property="og:title" content="Quotes | Jeff Harris">
  <meta property="og:description" content="Quotes I love">
  <meta property="og:type" content="website">
  <meta property="og:url" content="https://jeffharr.is/quotes/">
  <meta property="og:image" content="https://jeffharr.is/images/social/quotes-card.jpg">
  <meta property="og:image:secure_url" content="https://jeffharr.is/images/social/quotes-card.jpg">
  <meta property="og:image:type" content="image/jpeg">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:image:alt" content="A quiet page of favorite quotes">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Quotes | Jeff Harris">
  <meta name="twitter:description" content="Quotes I love">
  <meta name="twitter:image" content="https://jeffharr.is/images/social/quotes-card.jpg">
  <link rel="apple-touch-icon" sizes="180x180" href="/quotes/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-title" content="Quotes">

  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,500;0,600;1,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">

  <link rel="icon" href="/favicon.ico">
  <style>
    :root {
      --bg: #FDFCFA;
      --bg-elev: #FFFFFF;
      --bg-hover: #F8F6F3;
      --text: #2D2A26;
      --text-muted: #6B6560;
      --text-light: #9A9590;
      --accent: #6F5743;
      --accent-soft: rgba(111, 87, 67, 0.10);
      --border: rgba(0, 0, 0, 0.08);
      --font-serif: 'Cormorant Garamond', Georgia, serif;
      --font-sans: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1A1918;
        --bg-elev: #242220;
        --bg-hover: #2D2A28;
        --text: #E8E4DF;
        --text-muted: #A49C94;
        --text-light: #756E68;
        --accent: #C9A877;
        --accent-soft: rgba(201, 168, 119, 0.14);
        --border: rgba(255, 255, 255, 0.10);
      }
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
    }

    body {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .header {
      width: min(720px, 100%);
      margin: 0 auto;
      padding: 32px 24px 24px;
      text-align: center;
    }

    .header__back {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 16px;
      color: var(--text-muted);
      font-size: 13px;
      text-decoration: none;
    }

    .header__back:hover {
      color: var(--accent);
    }

    .header__title {
      margin: 0 0 8px;
      font-family: var(--font-serif);
      font-size: 2.5rem;
      font-weight: 400;
      line-height: 1.1;
      letter-spacing: 0;
    }

    .header__subtitle {
      margin: 0;
      color: var(--text-muted);
      font-size: 14px;
    }

    .tools {
      position: sticky;
      top: 0;
      z-index: 2;
      border-block: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 94%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
    }

    .tools__inner {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(180px, 260px) auto;
      align-items: center;
      gap: 12px;
      width: min(720px, 100%);
      margin: 0 auto;
      padding: 14px 24px;
    }

    .search,
    .author-filter {
      width: 100%;
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--bg-elev);
      color: var(--text);
      font: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    .search {
      padding: 10px 12px;
    }

    .author-filter {
      padding: 10px 34px 10px 12px;
    }

    .search:focus,
    .author-filter:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px var(--accent-soft);
    }

    .tools__count {
      color: var(--text-light);
      font-size: 12px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      white-space: nowrap;
    }

    .quotes {
      width: min(720px, 100%);
      margin: 0 auto;
      padding: 8px 24px 72px;
    }

    .quote {
      margin: 0;
      padding: 30px 0 28px;
      border-top: 1px solid var(--border);
      scroll-margin-top: 92px;
    }

    .quote:first-child {
      border-top: 0;
    }

    .quote.is-hidden {
      display: none;
    }

    .quote__text {
      margin: 0;
      max-width: 64ch;
      color: var(--text);
      font-family: var(--font-serif);
      font-size: 1.28rem;
      font-weight: 400;
      line-height: 1.58;
      letter-spacing: 0;
      overflow-wrap: break-word;
    }

    .quote--short .quote__text {
      font-size: 1.42rem;
      line-height: 1.48;
    }

    .quote__author {
      margin-top: 14px;
      color: var(--text-muted);
      font-size: 13px;
      font-style: normal;
      line-height: 1.45;
    }

    .empty {
      display: none;
      width: min(720px, 100%);
      margin: 0 auto;
      padding: 56px 24px 72px;
      color: var(--text-muted);
      text-align: center;
    }

    .empty.is-visible {
      display: block;
    }

    @media (max-width: 640px) {
      .header {
        padding: 26px 18px 20px;
      }

      .header__title {
        font-size: 2.15rem;
      }

      .tools {
        position: static;
      }

      .tools__inner {
        grid-template-columns: 1fr;
        padding: 12px 18px;
      }

      .tools__count {
        justify-self: start;
      }

      .quotes {
        padding: 4px 18px 56px;
      }

      .quote {
        padding: 25px 0 24px;
      }

      .quote__text,
      .quote--short .quote__text {
        font-size: 1.18rem;
        line-height: 1.6;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <a class="header__back" href="/" aria-label="Back to home">&larr; Home</a>
    <h1 class="header__title">Quotes</h1>
    <p class="header__subtitle">Lines I keep coming back to.</p>
  </header>

  <section class="tools" aria-label="Quote filters">
    <div class="tools__inner">
      <input class="search" id="search" type="search" placeholder="Search quotes or authors..." autocomplete="off">
      <select class="author-filter" id="author-filter" aria-label="Filter by author">
        <option value="">All authors</option>
${authors.map((author) => `        <option value="${escapeAttribute(author.name)}">${escapeHtml(author.name)} (${author.count})</option>`).join('\n')}
      </select>
      <span class="tools__count" id="count">${quotes.length} quotes</span>
    </div>
  </section>

  <main class="quotes" id="quotes" aria-live="polite">
${quotes.map(renderQuote).join('\n')}
  </main>
  <p class="empty" id="empty">No quotes match that filter.</p>

  <script>
    (function() {
      const searchInput = document.getElementById('search');
      const authorFilter = document.getElementById('author-filter');
      const count = document.getElementById('count');
      const empty = document.getElementById('empty');
      const quotes = Array.from(document.querySelectorAll('.quote'));

      function normalize(value) {
        return String(value || '').trim().toLowerCase();
      }

      function renderCount(visible) {
        count.textContent = visible === 1 ? '1 quote' : visible + ' quotes';
      }

      function applyFilters() {
        const query = normalize(searchInput.value);
        const author = normalize(authorFilter.value);
        let visible = 0;

        quotes.forEach((quote) => {
          const matchesQuery = !query || quote.dataset.search.includes(query);
          const matchesAuthor = !author || quote.dataset.author === author;
          const show = matchesQuery && matchesAuthor;
          quote.classList.toggle('is-hidden', !show);
          if (show) visible += 1;
        });

        renderCount(visible);
        empty.classList.toggle('is-visible', visible === 0);
      }

      searchInput.addEventListener('input', applyFilters);
      authorFilter.addEventListener('change', applyFilters);
      applyFilters();
    })();
  </script>
</body>
</html>
`;
}

function renderQuote(quote) {
  const shortClass = quote.quote.length <= 120 ? ' quote--short' : '';
  const search = `${quote.quote} ${quote.author}`.toLowerCase();
  return `    <figure class="quote${shortClass}" id="${escapeAttribute(quote.id)}" data-author="${escapeAttribute(quote.author.toLowerCase())}" data-search="${escapeAttribute(search)}">
      <blockquote class="quote__text">${escapeHtml(quote.quote)}</blockquote>
      <figcaption class="quote__author">&mdash; ${escapeHtml(quote.author)}</figcaption>
    </figure>`;
}

function authorOptions(quotes) {
  const counts = new Map();
  for (const quote of quotes) {
    counts.set(quote.author, (counts.get(quote.author) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
  await writeTextAtomic(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writeTextAtomic(filePath, text) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${Date.now()}.tmp`;
  await writeFile(tempPath, text);
  await rename(tempPath, filePath);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--state') parsed.state = argv[++index];
    else if (arg === '--legacy-state') parsed.legacyState = argv[++index];
    else if (arg === '--quotes') parsed.quotes = argv[++index];
    else if (arg === '--public-json') parsed.publicJson = argv[++index];
    else if (arg === '--public-html') parsed.publicHtml = argv[++index];
  }

  return parsed;
}
