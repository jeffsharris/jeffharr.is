import test from 'node:test';
import assert from 'node:assert/strict';
import { createExcerpt, parseFrontmatter, parsePoem, slugToTitle } from '../functions/api/poems.js';

test('parseFrontmatter captures keys with colons in values', () => {
  const frontmatter = 'title: The Road: A Choice\nauthor: Robert Frost';
  const parsed = parseFrontmatter(frontmatter);
  assert.equal(parsed.title, 'The Road: A Choice');
  assert.equal(parsed.author, 'Robert Frost');
});

test('parsePoem extracts title, author, and excerpt', () => {
  const markdown = `---\r\ntitle: The Road Not Taken\r\nauthor: Robert Frost\r\n---\r\nLine one\nLine two\nLine three\nLine four`;
  const poem = parsePoem(markdown);
  assert.equal(poem.title, 'The Road Not Taken');
  assert.equal(poem.author, 'Robert Frost');
  assert.equal(poem.excerpt, 'Line one \u00b7 Line two \u00b7 Line three');
});

test('createExcerpt joins the first three non-empty lines', () => {
  const excerpt = createExcerpt('\nFirst\n\nSecond\nThird\nFourth');
  assert.equal(excerpt, 'First \u00b7 Second \u00b7 Third');
});

test('slugToTitle formats slug to title case', () => {
  assert.equal(slugToTitle('i-carry-your-heart-within-me'), 'I Carry Your Heart Within Me');
});
