import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest as readLaterOnRequest } from '../functions/api/read-later.js';
import { preferReaderTitle } from '../functions/api/read-later/reader-utils.js';
import { normalizeHttpUrl } from '../functions/api/content-library/ids.js';
import {
  listReadLaterItems,
  normalizeTitle
} from '../functions/api/content-library/read-later-store.js';

test('normalizeHttpUrl accepts https URLs', () => {
  const url = normalizeHttpUrl('https://example.com/path');
  assert.equal(url, 'https://example.com/path');
});

test('normalizeHttpUrl adds https scheme when missing', () => {
  const url = normalizeHttpUrl('example.com/path');
  assert.equal(url, 'https://example.com/path');
});

test('normalizeHttpUrl rejects non-http schemes', () => {
  const url = normalizeHttpUrl('javascript:alert(1)');
  assert.equal(url, null);
});

test('normalizeTitle uses hostname when title is empty', () => {
  const title = normalizeTitle('', 'https://www.example.com/path');
  assert.equal(title, 'example.com');
});

test('preferReaderTitle keeps the existing title when it is complete', () => {
  const title = preferReaderTitle(
    'Video Games as Art',
    'Video Games as Art · Gwern.net',
    'https://gwern.net/video-game-art'
  );
  assert.equal(title, 'Video Games as Art');
});

test('preferReaderTitle upgrades single-word prefixes using reader title', () => {
  const title = preferReaderTitle(
    'Claude\'s',
    'Claude\'s new constitution',
    'https://www.anthropic.com/news/claude-new-constitution'
  );
  assert.equal(title, 'Claude\'s new constitution');
});

test('preferReaderTitle replaces hostname fallback with reader title', () => {
  const title = preferReaderTitle(
    'example.com',
    'Example Domain',
    'https://example.com/'
  );
  assert.equal(title, 'Example Domain');
});

test('listReadLaterItems uses one D1 query and preserves read state fields', async () => {
  const rows = [
    {
      entry_id: 'rli_1',
      entry_status: 'done',
      position: null,
      note: null,
      added_at: '2026-01-01T00:00:00.000Z',
      entry_updated_at: '2026-01-02T00:00:00.000Z',
      entry_extra_json: null,
      item_id: 'itm_1',
      item_kind: 'article',
      canonical_key: 'url:https://example.com/a',
      canonical_url: 'https://example.com/a',
      source_url: 'https://example.com/a',
      title: 'Example A',
      subtitle: null,
      summary: 'A short summary',
      creator: 'Author A',
      publisher: 'example.com',
      published_at: null,
      language: null,
      thumbnail_asset_id: null,
      primary_asset_id: null,
      item_extra_json: null,
      read_at: '2026-01-03T00:00:00.000Z',
      progress_json: JSON.stringify({ scrollRatio: 0.5, scrollTop: 120 }),
      kindle_json: JSON.stringify({ status: 'synced' }),
      cover_sync_json: JSON.stringify({ status: 'ready' }),
      push_channels_json: JSON.stringify({ readiness: { status: 'ready' } }),
      cover_updated_at: '2026-01-04T00:00:00.000Z'
    },
    {
      entry_id: 'rli_2',
      entry_status: 'active',
      position: null,
      note: null,
      added_at: '2026-01-05T00:00:00.000Z',
      entry_updated_at: '2026-01-05T00:00:00.000Z',
      entry_extra_json: null,
      item_id: 'itm_2',
      item_kind: 'video',
      canonical_key: 'url:https://youtu.be/abc12345678',
      canonical_url: 'https://youtu.be/abc12345678',
      source_url: 'https://youtu.be/abc12345678',
      title: 'Video B',
      subtitle: null,
      summary: null,
      creator: null,
      publisher: 'youtu.be',
      published_at: null,
      language: null,
      thumbnail_asset_id: null,
      primary_asset_id: null,
      item_extra_json: null,
      read_at: null,
      progress_json: null,
      kindle_json: null,
      cover_sync_json: null,
      push_channels_json: null,
      cover_updated_at: null,
      thumbnail_url: 'https://substackcdn.com/image/fetch/example-cover.png'
    }
  ];
  const db = createFakeD1(rows);

  const items = await listReadLaterItems(db);

  assert.equal(db.calls.length, 1);
  assert.deepEqual(db.calls[0].args, ['lst_read_later', 1000]);
  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'rli_1');
  assert.equal(items[0].read, true);
  assert.equal(items[0].readAt, '2026-01-03T00:00:00.000Z');
  assert.deepEqual(items[0].progress, { scrollRatio: 0.5, scrollTop: 120 });
  assert.deepEqual(items[0].kindle, { status: 'synced' });
  assert.deepEqual(items[0].coverSync, { status: 'ready' });
  assert.deepEqual(items[0].pushChannels, { readiness: { status: 'ready' } });
  assert.deepEqual(items[0].cover, { updatedAt: '2026-01-04T00:00:00.000Z' });
  assert.equal(items[1].read, false);
  assert.equal(items[1].thumbnailUrl, 'https://substackcdn.com/image/fetch/example-cover.png');
});

test('read later list endpoint only requires D1 storage', async () => {
  const db = createFakeD1([
    {
      entry_id: 'rli_endpoint_1',
      entry_status: 'active',
      position: null,
      note: null,
      added_at: '2026-01-01T00:00:00.000Z',
      entry_updated_at: '2026-01-01T00:00:00.000Z',
      entry_extra_json: null,
      item_id: 'itm_endpoint_1',
      item_kind: 'article',
      canonical_key: 'url:https://example.com/endpoint',
      canonical_url: 'https://example.com/endpoint',
      source_url: 'https://example.com/endpoint',
      title: 'Endpoint item',
      subtitle: null,
      summary: null,
      creator: null,
      publisher: 'example.com',
      published_at: null,
      language: null,
      thumbnail_asset_id: null,
      primary_asset_id: null,
      item_extra_json: null,
      read_at: null,
      progress_json: null,
      kindle_json: null,
      cover_sync_json: null,
      push_channels_json: null,
      cover_updated_at: null
    }
  ]);

  const response = await readLaterOnRequest({
    request: new Request('https://example.com/api/read-later'),
    env: { CONTENT_DB: db }
  });

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.count, 1);
  assert.equal(payload.items[0].id, 'rli_endpoint_1');
});

function createFakeD1(rows) {
  return {
    calls: [],
    prepare(sql) {
      const call = { sql, args: [] };
      this.calls.push(call);
      return {
        bind(...args) {
          call.args = args;
          return {
            async all() {
              return { results: rows };
            }
          };
        }
      };
    }
  };
}
