import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPosterUrl, decodeHtmlEntities, parseFilmsHtml } from '../functions/api/letterboxd.js';

test('buildPosterUrl strips year for older film ids', () => {
  const url = buildPosterUrl('999999', 'carol-2015', null);
  assert.ok(url.includes('/9/9/9/9/9/9/999999-carol-0-125-0-187-crop.jpg'));
});

test('buildPosterUrl keeps year for newer film ids', () => {
  const url = buildPosterUrl('1000001', 'the-mastermind-2025', null);
  assert.ok(url.includes('/1/0/0/0/0/0/1/1000001-the-mastermind-2025-0-125-0-187-crop.jpg'));
});

test('decodeHtmlEntities decodes common XML entities', () => {
  const decoded = decodeHtmlEntities('Wall &amp; Gromit &lt;3');
  assert.equal(decoded, 'Wall & Gromit <3');
});

test('parseFilmsHtml extracts film data and ratings', () => {
  const html = `
    <section>
      <div data-component-class="LazyPoster" data-item-name="Bad Santa (2003)" data-item-slug="bad-santa-2003" data-target-link="/film/bad-santa-2003/" data-film-id="123456">
        <div class="rating rated-6"></div>
        <script>var film={cacheBustingKey":"abc123"};</script>
      </div>
      <div data-component-class="LazyPoster" data-item-name="Amelie (2001)" data-item-slug="amelie-2001" data-target-link="/film/amelie-2001/" data-film-id="234567">
        <div class="rating rated-8"></div>
        <script>var film={cacheBustingKey":"def456"};</script>
      </div>
    </section>
  `;

  const items = parseFilmsHtml(html, { includeRating: true });
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Bad Santa');
  assert.equal(items[0].year, '2003');
  assert.equal(items[0].rating, 3);
  assert.ok(items[0].poster.includes('123456-bad-santa-0-125-0-187-crop.jpg'));
  assert.ok(items[0].link.startsWith('https://letterboxd.com/film/bad-santa-2003/'));
});
