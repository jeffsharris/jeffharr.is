import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildQuotesCollectionMarkdown,
  mergeImportedHighlights,
  normalizeState,
  parseKindleClippings,
  parseQuotesMarkdown,
  serializeQuotesMarkdown
} from '../scripts/lib/kindle-highlights.mjs';

const SAMPLE_CLIPPINGS = `The Creative Act (Rick Rubin)
- Your Highlight on page 12 | Location 181-183 | Added on Monday, January 1, 2024 8:00:00 PM

The object isn't to make art, it's to be in that wonderful state which makes art inevitable.
==========
The Creative Act (Rick Rubin)
- Your Note on page 12 | Location 184 | Added on Monday, January 1, 2024 8:02:00 PM

This is a note, not a highlight.
==========
Letters to a Young Poet (Rainer Maria Rilke)
- Your Highlight at Location 221-222 | Added on Tuesday, January 2, 2024 7:00:00 PM

A work of art is good if it has grown out of necessity.
==========`;

const SAMPLE_QUOTES_MARKDOWN = `# Quotes Collection

## Quotes

> Laughter is carbonated holiness.

Author: Anne Lamott

## Needs Attribution Review

> Computer science is no more about computers than astronomy is about telescopes.

Author: Unknown; often attributed to Edsger W. Dijkstra
`;

test('parseKindleClippings imports highlights and ignores notes', () => {
  const result = parseKindleClippings(SAMPLE_CLIPPINGS);

  assert.equal(result.count, 2);
  assert.equal(result.items[0].bookTitle, 'The Creative Act');
  assert.equal(result.items[0].author, 'Rick Rubin');
  assert.equal(result.items[0].page, '12');
  assert.equal(result.items[0].location, '181-183');
  assert.equal(result.items[0].quote, "The object isn't to make art, it's to be in that wonderful state which makes art inevitable.");
  assert.equal(result.items[1].bookTitle, 'Letters to a Young Poet');
  assert.equal(result.items[1].author, 'Rainer Maria Rilke');
});

test('mergeImportedHighlights places new Kindle highlights in Inbox and preserves decisions', () => {
  const parsed = parseKindleClippings(SAMPLE_CLIPPINGS);
  const first = mergeImportedHighlights(null, parsed.items, '2026-05-28T00:00:00.000Z');
  const id = parsed.items[0].id;
  first.items[id].status = 'needs_details';
  first.items[id].quote = 'Edited quote.';

  const second = mergeImportedHighlights(first, parsed.items, '2026-05-28T01:00:00.000Z');

  assert.equal(first.items[parsed.items[1].id].status, 'uncategorized');
  assert.equal(second.order.length, 2);
  assert.equal(second.items[id].status, 'needs_details');
  assert.equal(second.items[id].quote, 'Edited quote.');
});

test('parseQuotesMarkdown seeds accepted and needs refinement categories', () => {
  const items = parseQuotesMarkdown(SAMPLE_QUOTES_MARKDOWN);
  const state = normalizeState(null, { seedItems: items });

  assert.equal(state.order.length, 2);
  assert.equal(state.items[state.order[0]].status, 'accepted');
  assert.equal(state.items[state.order[1]].status, 'needs_details');
});

test('normalizeState migrates legacy highlight review statuses', () => {
  const state = normalizeState({
    version: 1,
    items: {
      a: { quote: 'Accepted quote.', author: 'A', status: 'included', attributionConfirmed: true },
      b: { quote: 'Needs details quote.', author: 'B', status: 'included' },
      c: { quote: 'Rejected quote.', author: 'C', status: 'skipped' },
      d: { quote: 'Inbox quote.', author: 'D', status: 'unreviewed' }
    },
    order: ['a', 'b', 'c', 'd']
  });

  assert.equal(state.items.a.status, 'accepted');
  assert.equal(state.items.b.status, 'needs_details');
  assert.equal(state.items.c.status, 'rejected');
  assert.equal(state.items.d.status, 'uncategorized');
});

test('serializeQuotesMarkdown exports only accepted and needs refinement quotes', () => {
  const parsed = parseKindleClippings(SAMPLE_CLIPPINGS);
  const state = mergeImportedHighlights(null, parsed.items, '2026-05-28T00:00:00.000Z');
  const [acceptedId, needsId] = state.order;
  state.items[acceptedId].status = 'accepted';
  state.items[needsId].status = 'needs_details';
  state.items[needsId].author = '';

  const markdown = serializeQuotesMarkdown(state);

  assert.equal(markdown.acceptedCount, 1);
  assert.equal(markdown.needsDetailsCount, 1);
  assert.match(markdown.accepted, /Author: Rick Rubin/);
  assert.doesNotMatch(markdown.accepted, /Rainer Maria Rilke/);
  assert.match(markdown.needsDetails, /Author: Unknown/);
});

test('buildQuotesCollectionMarkdown writes the tracked collection shape', () => {
  const seedItems = parseQuotesMarkdown(SAMPLE_QUOTES_MARKDOWN);
  const state = normalizeState(null, { seedItems });
  const markdown = buildQuotesCollectionMarkdown(state);

  assert.match(markdown, /^# Quotes Collection/);
  assert.match(markdown, /## Quotes/);
  assert.match(markdown, /Author: Anne Lamott/);
  assert.match(markdown, /## Needs Additional Details/);
  assert.match(markdown, /Edsger W\. Dijkstra/);
});
