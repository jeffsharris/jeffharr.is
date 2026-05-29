import { createHash } from 'node:crypto';

const CATEGORY = Object.freeze({
  ACCEPTED: 'accepted',
  NEEDS_DETAILS: 'needs_details',
  REJECTED: 'rejected',
  UNCATEGORIZED: 'uncategorized'
});

const CATEGORY_VALUES = new Set(Object.values(CATEGORY));
const ENTRY_SEPARATOR = /^={8,}\s*$/m;
const KINDLE_META_PATTERN = /^-\s+Your\s+(.+?)\s+(?:on\s+page\s+([^|]+?)\s+\|\s+)?(?:at\s+)?(?:Location|location)\s+([^|]+?)(?:\s+\|\s+Added\s+on\s+(.+))?$/i;
const KINDLE_META_WITHOUT_LOCATION_PATTERN = /^-\s+Your\s+(.+?)(?:\s+\|\s+Added\s+on\s+(.+))?$/i;

function parseKindleNotebookExport(payload) {
  const source = payload && typeof payload === 'object' ? payload : {};
  const items = [];
  const skipped = [];

  for (const book of source.books || []) {
    const title = cleanOptional(book.title);
    const author = normalizeAuthor(book.author);
    const asin = cleanOptional(book.asin);

    for (const highlight of book.highlights || []) {
      const quote = normalizeQuoteText(highlight.quote);
      if (!quote) {
        skipped.push({ asin, title, reason: 'empty quote' });
        continue;
      }

      const annotationId = cleanOptional(highlight.annotationId);
      const canonical = [
        asin,
        annotationId,
        cleanOptional(highlight.location),
        cleanOptional(highlight.page),
        quote
      ].map(normalizeForIdentity).join('|');

      items.push({
        id: `kh_web_${hashValue(canonical).slice(0, 16)}`,
        quote,
        originalQuote: quote,
        bookTitle: title,
        sourceLabel: title,
        author,
        originalAuthor: author,
        page: cleanOptional(highlight.page),
        location: cleanOptional(highlight.location),
        addedAt: cleanOptional(book.annotatedDate),
        source: 'kindle-notebook',
        notes: cleanOptional(highlight.note)
      });
    }
  }

  return {
    items,
    skipped,
    count: items.length,
    source: 'kindle-notebook'
  };
}

function parseKindleClippings(text) {
  const rawEntries = String(text || '')
    .split(ENTRY_SEPARATOR)
    .map((entry) => entry.trim())
    .filter(Boolean);

  const items = [];
  const skipped = [];

  for (const rawEntry of rawEntries) {
    const parsed = parseKindleEntry(rawEntry);
    if (!parsed) {
      skipped.push(rawEntry);
      continue;
    }
    if (parsed.kind !== 'highlight') continue;
    items.push(parsed);
  }

  return {
    items,
    skipped,
    count: items.length,
    source: 'kindle-clippings'
  };
}

function parseKindleEntry(rawEntry) {
  const lines = String(rawEntry || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 3) return null;

  const { title, author } = parseTitleAuthor(lines[0]);
  const metadata = parseMetadata(lines[1]);
  const text = normalizeQuoteText(lines.slice(2).join(' '));
  if (!title || !text || !metadata) return null;

  const canonical = [
    title,
    author,
    metadata.location || metadata.page || '',
    text
  ].map(normalizeForIdentity).join('|');

  return {
    id: `kh_${hashValue(canonical).slice(0, 16)}`,
    kind: metadata.kind,
    quote: text,
    originalQuote: text,
    bookTitle: title,
    sourceLabel: title,
    author,
    originalAuthor: author,
    page: metadata.page,
    location: metadata.location,
    addedAt: metadata.addedAt,
    source: 'kindle-clippings'
  };
}

function parseQuotesMarkdown(text) {
  const lines = String(text || '').split(/\r?\n/);
  const items = [];
  let sectionStatus = '';
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      pushCurrent();
      sectionStatus = statusForMarkdownHeading(heading[1]);
      continue;
    }

    if (!sectionStatus) continue;

    if (line.startsWith('>')) {
      if (!current) current = { quoteLines: [], author: '', status: sectionStatus };
      current.quoteLines.push(line.replace(/^>\s?/, ''));
      continue;
    }

    const author = line.match(/^Author:\s*(.+?)\s*$/i);
    if (author && current) {
      current.author = normalizeAuthor(author[1]);
      pushCurrent();
    }
  }

  pushCurrent();
  return items;

  function pushCurrent() {
    if (!current) return;
    const quote = normalizeQuoteText(current.quoteLines.join(' '));
    const author = normalizeAuthor(current.author);
    if (quote) {
      items.push(normalizeItem({
        id: `q_${hashValue(`${quote}|${author}`).slice(0, 16)}`,
        quote,
        originalQuote: quote,
        author,
        originalAuthor: author,
        source: 'manual',
        sourceLabel: 'Quotes collection',
        status: current.status
      }));
    }
    current = null;
  }
}

function mergeImportedHighlights(state, importedItems, now = new Date().toISOString()) {
  const next = normalizeState(state);
  next.updatedAt = now;
  next.lastImportedAt = now;

  for (const item of importedItems || []) {
    if (!item?.id) continue;
    const existing = next.items[item.id];
    next.items[item.id] = normalizeItem({
      id: item.id,
      quote: existing?.quote || item.quote,
      originalQuote: existing?.originalQuote || item.originalQuote || item.quote,
      author: existing?.author || item.author || '',
      originalAuthor: existing?.originalAuthor || item.originalAuthor || item.author || '',
      bookTitle: item.bookTitle || existing?.bookTitle || '',
      sourceLabel: existing?.sourceLabel || item.sourceLabel || item.bookTitle || 'Kindle highlights',
      page: item.page || existing?.page || '',
      location: item.location || existing?.location || '',
      addedAt: item.addedAt || existing?.addedAt || '',
      source: item.source || existing?.source || 'kindle-clippings',
      status: existing?.status || CATEGORY.UNCATEGORIZED,
      notes: existing?.notes || item.notes || '',
      attributionConfirmed: Boolean(existing?.attributionConfirmed),
      firstImportedAt: existing?.firstImportedAt || now,
      updatedAt: existing?.updatedAt || now
    });
    if (!next.order.includes(item.id)) next.order.push(item.id);
  }

  return next;
}

function normalizeState(state, { seedItems = [] } = {}) {
  const source = state && typeof state === 'object' ? state : {};
  const rawItems = source.items && typeof source.items === 'object' ? source.items : {};
  const items = {};

  for (const [id, item] of Object.entries(rawItems)) {
    const normalized = normalizeItem({ id, ...item });
    if (normalized.id) items[normalized.id] = normalized;
  }

  for (const seedItem of seedItems || []) {
    const normalized = normalizeItem(seedItem);
    if (normalized.id && !items[normalized.id]) items[normalized.id] = normalized;
  }

  const order = Array.isArray(source.order)
    ? source.order.filter((id) => typeof id === 'string' && items[id])
    : [];

  for (const item of seedItems || []) {
    if (item?.id && items[item.id] && !order.includes(item.id)) order.push(item.id);
  }

  for (const id of Object.keys(items)) {
    if (!order.includes(id)) order.push(id);
  }

  return {
    version: 2,
    items,
    order,
    updatedAt: source.updatedAt || '',
    lastImportedAt: source.lastImportedAt || ''
  };
}

function normalizeItem(item) {
  const source = item && typeof item === 'object' ? item : {};
  const quote = normalizeQuoteText(source.quote || source.originalQuote || '');
  const author = normalizeAuthor(source.author);
  const bookTitle = cleanOptional(source.bookTitle);
  const sourceLabel = cleanOptional(source.sourceLabel) || bookTitle || cleanOptional(source.sourceTitle);
  const id = cleanOptional(source.id) || `q_${hashValue(`${quote}|${author}`).slice(0, 16)}`;

  return {
    id,
    quote,
    originalQuote: normalizeQuoteText(source.originalQuote || quote),
    author,
    originalAuthor: normalizeAuthor(source.originalAuthor || author),
    status: normalizeStatus(source.status, source),
    source: cleanOptional(source.source) || 'manual',
    sourceLabel: sourceLabel || 'Quotes collection',
    bookTitle,
    page: cleanOptional(source.page),
    location: cleanOptional(source.location),
    addedAt: cleanOptional(source.addedAt),
    notes: cleanOptional(source.notes),
    attributionConfirmed: Boolean(source.attributionConfirmed),
    firstImportedAt: cleanOptional(source.firstImportedAt),
    updatedAt: cleanOptional(source.updatedAt)
  };
}

function serializeQuotesMarkdown(state) {
  const normalized = normalizeState(state);
  const items = normalized.order.map((id) => normalized.items[id]).filter(Boolean);
  const accepted = items.filter((item) => item.status === CATEGORY.ACCEPTED);
  const needsDetails = items.filter((item) => item.status === CATEGORY.NEEDS_DETAILS);

  return {
    accepted: serializeQuoteBlocks(accepted),
    needsDetails: serializeQuoteBlocks(needsDetails),
    acceptedCount: accepted.length,
    needsDetailsCount: needsDetails.length
  };
}

function buildQuotesCollectionMarkdown(state) {
  const markdown = serializeQuotesMarkdown(state);
  return [
    '# Quotes Collection',
    '',
    'Draft collection for a future public quotes page. Entries are intentionally',
    'limited to quote text and author attribution.',
    '',
    '## Quotes',
    '',
    markdown.accepted || '_No accepted quotes yet._',
    '',
    '## Needs Additional Details',
    '',
    markdown.needsDetails || '_No quotes need additional details._',
    ''
  ].join('\n');
}

function serializeQuoteBlocks(items) {
  return items.map((item) => {
    const quote = normalizeQuoteText(item.quote || item.originalQuote || '');
    const author = normalizeAuthor(item.author) || 'Unknown';
    return `> ${quote}\n\nAuthor: ${author}`;
  }).join('\n\n');
}

function statusForMarkdownHeading(value) {
  const heading = String(value || '').trim().toLowerCase();
  if (heading === 'quotes' || heading === 'kindle highlight selections') return CATEGORY.ACCEPTED;
  if (
    heading === 'needs attribution review'
    || heading === 'needs additional details'
    || heading === 'needs refinement'
    || heading === 'kindle highlights needing attribution review'
  ) {
    return CATEGORY.NEEDS_DETAILS;
  }
  return '';
}

function normalizeStatus(value, item = {}) {
  const status = String(value || '').trim();
  if (CATEGORY_VALUES.has(status)) return status;
  if (['needs-review', 'needs_review', 'needs-details'].includes(status)) return CATEGORY.NEEDS_DETAILS;
  if (status === 'skipped') return CATEGORY.REJECTED;
  if (status === 'unreviewed') return CATEGORY.UNCATEGORIZED;
  if (status === 'included') {
    return item.attributionConfirmed && normalizeAuthor(item.author)
      ? CATEGORY.ACCEPTED
      : CATEGORY.NEEDS_DETAILS;
  }
  return CATEGORY.UNCATEGORIZED;
}

function parseTitleAuthor(value) {
  const line = String(value || '').trim();
  if (!line) return { title: '', author: '' };

  const match = line.match(/^(.*)\s+\(([^()]+)\)$/);
  if (!match) return { title: line, author: '' };

  return {
    title: match[1].trim(),
    author: normalizeAuthor(match[2])
  };
}

function parseMetadata(value) {
  const line = String(value || '').trim();
  if (!line.startsWith('-')) return null;

  const withLocation = line.match(KINDLE_META_PATTERN);
  if (withLocation) {
    return {
      kind: normalizeKind(withLocation[1]),
      page: cleanOptional(withLocation[2]),
      location: cleanOptional(withLocation[3]),
      addedAt: cleanOptional(withLocation[4])
    };
  }

  const withoutLocation = line.match(KINDLE_META_WITHOUT_LOCATION_PATTERN);
  if (!withoutLocation) return null;
  return {
    kind: normalizeKind(withoutLocation[1]),
    page: '',
    location: '',
    addedAt: cleanOptional(withoutLocation[2])
  };
}

function normalizeQuoteText(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeAuthor(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeKind(value) {
  const kind = String(value || '').trim().toLowerCase();
  if (kind.includes('highlight')) return 'highlight';
  if (kind.includes('note')) return 'note';
  if (kind.includes('bookmark')) return 'bookmark';
  return kind || 'unknown';
}

function cleanOptional(value) {
  return String(value || '').trim();
}

function normalizeForIdentity(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function hashValue(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

export {
  CATEGORY,
  buildQuotesCollectionMarkdown,
  mergeImportedHighlights,
  normalizeState,
  parseKindleClippings,
  parseKindleEntry,
  parseKindleNotebookExport,
  parseQuotesMarkdown,
  serializeQuotesMarkdown
};
