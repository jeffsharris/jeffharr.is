import test from 'node:test';
import assert from 'node:assert/strict';
import { extractTag } from '../functions/api/goodreads.js';

test('extractTag strips CDATA wrappers from Goodreads links', () => {
  const xml = '<link><![CDATA[https://www.goodreads.com/review/show/8589373718?book_show_action=false]]></link>';
  assert.equal(
    extractTag(xml, 'link'),
    'https://www.goodreads.com/review/show/8589373718?book_show_action=false'
  );
});
