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
  <script>document.documentElement.className += ' js';</script>
  <style>
    :root {
      --bg: #FDFCFA;
      --bg-card: #FFFFFF;
      --text: #2D2A26;
      --text-muted: #6B6560;
      --text-light: #9A9590;
      --accent: #6F5743;
      --accent-soft: rgba(111, 87, 67, 0.10);
      --border: rgba(0, 0, 0, 0.08);
      --shadow: 0 2px 10px rgba(0, 0, 0, 0.05);
      --shadow-lg: 0 12px 32px rgba(0, 0, 0, 0.10);
      --font-serif: 'Cormorant Garamond', Georgia, serif;
      --font-sans: 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #1A1918;
        --bg-card: #242220;
        --text: #E8E4DF;
        --text-muted: #A49C94;
        --text-light: #756E68;
        --accent: #C9A877;
        --accent-soft: rgba(201, 168, 119, 0.14);
        --border: rgba(255, 255, 255, 0.10);
        --shadow: 0 2px 12px rgba(0, 0, 0, 0.30);
        --shadow-lg: 0 12px 40px rgba(0, 0, 0, 0.50);
      }
    }

    *, *::before, *::after { box-sizing: border-box; }

    html, body {
      margin: 0;
      min-height: 100%;
    }

    body {
      min-height: 100vh;
      background:
        radial-gradient(1100px 540px at 50% -160px, var(--accent-soft), transparent 70%),
        var(--bg);
      color: var(--text);
      font-family: var(--font-sans);
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    .header {
      width: min(720px, 100%);
      margin: 0 auto;
      padding: 36px 24px 6px;
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
      transition: color 0.2s;
    }

    .header__back:hover {
      color: var(--accent);
    }

    .header__title {
      margin: 0 0 8px;
      font-family: var(--font-serif);
      font-size: 2.6rem;
      font-weight: 400;
      line-height: 1.1;
      letter-spacing: 0;
    }

    .header__subtitle {
      margin: 0;
      color: var(--text-muted);
      font-size: 14px;
    }

    .finder {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: min(720px, 100%);
      margin: 0 auto;
      padding: 18px 24px 26px;
    }

    .finder__field {
      position: relative;
      width: min(300px, 100%);
    }

    .finder__icon {
      position: absolute;
      left: 2px;
      top: 50%;
      transform: translateY(-50%);
      color: var(--text-light);
      pointer-events: none;
      transition: color 0.25s;
    }

    .finder__field:focus-within .finder__icon {
      color: var(--accent);
    }

    .search {
      width: 100%;
      padding: 7px 6px 7px 24px;
      border: 0;
      border-bottom: 1px solid var(--border);
      border-radius: 0;
      background: transparent;
      color: var(--text);
      font: inherit;
      font-size: 14px;
      outline: none;
      transition: border-color 0.25s;
    }

    .search::placeholder {
      color: var(--text-light);
      font-style: italic;
    }

    .search:focus {
      border-bottom-color: var(--accent);
    }

    .finder__count {
      min-height: 16px;
      margin-top: 10px;
      color: var(--text-light);
      font-size: 11px;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }

    .mosaic {
      width: min(1280px, 100%);
      margin: 0 auto;
      padding: 0 28px 24px;
      columns: 300px;
      column-gap: 22px;
    }

    .quote {
      position: relative;
      margin: 0 0 22px;
      padding: 24px 24px 22px;
      break-inside: avoid;
      -webkit-column-break-inside: avoid;
      page-break-inside: avoid;
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 16px;
      box-shadow: var(--shadow);
      scroll-margin-top: 24px;
      transition: transform 0.3s ease, box-shadow 0.3s ease, border-color 0.3s ease;
    }

    .quote:nth-child(4n+2) {
      background: color-mix(in srgb, var(--bg-card) 96%, var(--accent));
    }

    .quote:nth-child(7n+5) {
      background: color-mix(in srgb, var(--bg-card) 93%, var(--accent));
    }

    .quote:hover {
      transform: translateY(-3px);
      border-color: color-mix(in srgb, var(--accent) 32%, var(--border));
      box-shadow: var(--shadow-lg);
    }

    .quote.is-hidden {
      display: none;
    }

    .js .quote {
      animation: quote-rise 0.55s ease both;
      animation-delay: var(--d, 0ms);
    }

    @keyframes quote-rise {
      from {
        opacity: 0;
        transform: translateY(14px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .js .quote {
        animation: none;
      }

      .quote,
      .quote:hover {
        transform: none;
      }
    }

    .quote::before {
      content: "\\201C";
      display: block;
      height: 0.45em;
      font-family: var(--font-serif);
      font-size: 2.7rem;
      font-weight: 500;
      line-height: 1;
      color: var(--accent);
      opacity: 0.4;
    }

    .quote__text {
      margin: 10px 0 0;
      color: var(--text);
      font-family: var(--font-serif);
      font-weight: 400;
      letter-spacing: 0;
      overflow-wrap: break-word;
    }

    .quote--display {
      padding: 30px 26px 26px;
      text-align: center;
    }

    .quote--display .quote__text {
      font-size: 1.58rem;
      font-weight: 500;
      line-height: 1.3;
    }

    .quote--lg .quote__text {
      font-size: 1.32rem;
      line-height: 1.42;
    }

    .quote--md .quote__text {
      font-size: 1.16rem;
      line-height: 1.52;
    }

    .quote--sm .quote__text {
      font-size: 1.04rem;
      line-height: 1.6;
    }

    .quote__author {
      margin-top: 16px;
      color: var(--text-light);
      font-size: 10.5px;
      font-style: normal;
      letter-spacing: 0.16em;
      line-height: 1.5;
      text-transform: uppercase;
    }

    .quote__author::before {
      content: "\\2014\\00A0";
    }

    .empty {
      display: none;
      padding: 40px 24px 56px;
      color: var(--text-muted);
      font-family: var(--font-serif);
      font-style: italic;
      font-size: 1.15rem;
      text-align: center;
    }

    .empty.is-visible {
      display: block;
    }

    .coda {
      padding: 12px 0 64px;
      color: var(--text-light);
      font-size: 14px;
      text-align: center;
    }

    @media (max-width: 640px) {
      .header {
        padding: 28px 18px 4px;
      }

      .header__title {
        font-size: 2.2rem;
      }

      .finder {
        padding: 14px 18px 20px;
      }

      .search {
        font-size: 16px;
      }

      .mosaic {
        padding: 0 16px 16px;
        column-gap: 14px;
      }

      .quote {
        margin-bottom: 14px;
        padding: 20px 20px 18px;
      }

      .quote--display {
        padding: 26px 22px 22px;
      }

      .quote--display .quote__text {
        font-size: 1.42rem;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <a class="header__back" href="/" aria-label="Back to home">&larr; Home</a>
    <h1 class="header__title">Quotes</h1>
    <p class="header__subtitle"><em>favorite fragments of other minds</em></p>
  </header>

  <div class="finder">
    <div class="finder__field">
      <svg class="finder__icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <circle cx="11" cy="11" r="8"/>
        <path d="M21 21l-4.35-4.35"/>
      </svg>
      <input class="search" id="search" type="search" placeholder="find a line&hellip;" autocomplete="off" aria-label="Search quotes">
    </div>
    <span class="finder__count" id="count" aria-live="polite"></span>
  </div>

  <main class="mosaic" id="quotes">
${quotes.map(renderQuote).join('\n')}
  </main>
  <p class="empty" id="empty">Nothing matches &mdash; try fewer words.</p>
  <footer class="coda" aria-hidden="true">&#10022;</footer>

  <script>
    (function() {
      const grid = document.getElementById('quotes');
      const searchInput = document.getElementById('search');
      const count = document.getElementById('count');
      const empty = document.getElementById('empty');
      const cards = Array.from(grid.querySelectorAll('.quote'));
      const total = cards.length;

      // Shuffle so each visit lays a fresh mosaic.
      for (let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const swap = cards[i];
        cards[i] = cards[j];
        cards[j] = swap;
      }
      cards.forEach((card, index) => {
        card.style.setProperty('--d', Math.min(index * 35, 650) + 'ms');
        grid.appendChild(card);
      });

      // Re-aim deep links after the shuffle moves their target.
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        const target = document.getElementById(hash);
        if (target) target.scrollIntoView();
      }

      function applyFilter() {
        const query = String(searchInput.value || '').trim().toLowerCase();
        let visible = 0;

        cards.forEach((card) => {
          const show = !query || card.dataset.search.includes(query);
          card.classList.toggle('is-hidden', !show);
          if (show) visible += 1;
        });

        count.textContent = query ? visible + ' of ' + total : '';
        empty.classList.toggle('is-visible', visible === 0);
      }

      searchInput.addEventListener('input', applyFilter);
    })();
  </script>
</body>
</html>
`;
}

function renderQuote(quote) {
  const search = `${quote.quote} ${quote.author}`.toLowerCase();
  return `    <figure class="quote ${sizeClass(quote.quote.length)}" id="${escapeAttribute(quote.id)}" data-search="${escapeAttribute(search)}">
      <blockquote class="quote__text">${escapeHtml(quote.quote)}</blockquote>
      <figcaption class="quote__author">${escapeHtml(quote.author)}</figcaption>
    </figure>`;
}

function sizeClass(length) {
  if (length <= 80) return 'quote--display';
  if (length <= 170) return 'quote--lg';
  if (length <= 330) return 'quote--md';
  return 'quote--sm';
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
