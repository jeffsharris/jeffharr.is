import { createHash } from 'node:crypto';

const ENTRY_SEPARATOR = /^={8,}\s*$/m;
const KINDLE_META_PATTERN = /^-\s+Your\s+(.+?)\s+(?:on\s+page\s+([^|]+?)\s+\|\s+)?(?:at\s+)?(?:Location|location)\s+([^|]+?)(?:\s+\|\s+Added\s+on\s+(.+))?$/i;
const KINDLE_META_WITHOUT_LOCATION_PATTERN = /^-\s+Your\s+(.+?)(?:\s+\|\s+Added\s+on\s+(.+))?$/i;

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
    author,
    page: metadata.page,
    location: metadata.location,
    addedAt: metadata.addedAt,
    source: 'kindle-clippings'
  };
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

function mergeImportedHighlights(state, importedItems, now = new Date().toISOString()) {
  const next = normalizeState(state);
  next.updatedAt = now;
  next.lastImportedAt = now;

  for (const item of importedItems || []) {
    if (!item?.id) continue;
    const existing = next.items[item.id];
    next.items[item.id] = {
      id: item.id,
      quote: existing?.quote || item.quote,
      originalQuote: existing?.originalQuote || item.originalQuote || item.quote,
      bookTitle: item.bookTitle || existing?.bookTitle || '',
      author: existing?.author || item.author || '',
      page: item.page || existing?.page || '',
      location: item.location || existing?.location || '',
      addedAt: item.addedAt || existing?.addedAt || '',
      source: item.source || existing?.source || 'kindle-clippings',
      status: existing?.status || 'unreviewed',
      attributionConfirmed: Boolean(existing?.attributionConfirmed),
      firstImportedAt: existing?.firstImportedAt || now,
      updatedAt: existing?.updatedAt || now
    };
    if (!next.order.includes(item.id)) next.order.push(item.id);
  }

  return next;
}

function normalizeState(state) {
  const source = state && typeof state === 'object' ? state : {};
  const items = source.items && typeof source.items === 'object' ? source.items : {};
  const order = Array.isArray(source.order)
    ? source.order.filter((id) => typeof id === 'string' && items[id])
    : Object.keys(items);

  return {
    version: 1,
    items,
    order,
    updatedAt: source.updatedAt || '',
    lastImportedAt: source.lastImportedAt || ''
  };
}

function serializeQuotesMarkdown(state) {
  const normalized = normalizeState(state);
  const selected = normalized.order
    .map((id) => normalized.items[id])
    .filter((item) => item?.status === 'included');

  const confirmed = selected.filter((item) => hasConfirmedAttribution(item));
  const needsReview = selected.filter((item) => !hasConfirmedAttribution(item));

  return {
    confirmed: serializeQuoteBlocks(confirmed),
    needsReview: serializeQuoteBlocks(needsReview)
  };
}

function serializeQuoteBlocks(items) {
  return items.map((item) => {
    const quote = normalizeQuoteText(item.quote || item.originalQuote || '');
    const author = normalizeAuthor(item.author) || 'Unknown';
    return `> ${quote}\n\nAuthor: ${author}`;
  }).join('\n\n');
}

function hasConfirmedAttribution(item) {
  return Boolean(normalizeAuthor(item?.author) && item?.attributionConfirmed);
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
  mergeImportedHighlights,
  normalizeState,
  parseKindleClippings,
  parseKindleEntry,
  serializeQuotesMarkdown
};
