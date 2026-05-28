import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeImportedHighlights,
  parseKindleClippings,
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

test('mergeImportedHighlights preserves review state on reimport', () => {
  const parsed = parseKindleClippings(SAMPLE_CLIPPINGS);
  const first = mergeImportedHighlights(null, parsed.items, '2026-05-28T00:00:00.000Z');
  const id = parsed.items[0].id;
  first.items[id].status = 'included';
  first.items[id].quote = 'Edited quote.';
  first.items[id].attributionConfirmed = true;

  const second = mergeImportedHighlights(first, parsed.items, '2026-05-28T01:00:00.000Z');

  assert.equal(second.order.length, 2);
  assert.equal(second.items[id].status, 'included');
  assert.equal(second.items[id].quote, 'Edited quote.');
  assert.equal(second.items[id].attributionConfirmed, true);
});

test('serializeQuotesMarkdown separates confirmed and review-needed selections', () => {
  const parsed = parseKindleClippings(SAMPLE_CLIPPINGS);
  const state = mergeImportedHighlights(null, parsed.items, '2026-05-28T00:00:00.000Z');
  const [confirmedId, reviewId] = state.order;
  state.items[confirmedId].status = 'included';
  state.items[confirmedId].attributionConfirmed = true;
  state.items[reviewId].status = 'included';

  const markdown = serializeQuotesMarkdown(state);

  assert.match(markdown.confirmed, /Author: Rick Rubin/);
  assert.doesNotMatch(markdown.confirmed, /Rainer Maria Rilke/);
  assert.match(markdown.needsReview, /Author: Rainer Maria Rilke/);
});
