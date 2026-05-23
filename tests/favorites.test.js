import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addFavorite,
  listFavoriteStates,
  removeFavorite
} from '../functions/api/content-library/list-store.js';
import { onRequest as favoriteStateRequest } from '../functions/api/favorites/state.js';
import { onRequest as publicFavoriteStateRequest } from '../functions/api/public/favorites/state.js';
import {
  poemCanonicalKey,
  sharePageCanonicalKey
} from '../functions/api/content-library/resolve.js';
import { onRequest as listIndexRequest } from '../functions/api/lists.js';
import { onRequest as listDetailRequest } from '../functions/api/lists/[slug].js';

test('favorite canonical keys are stable for local content refs', () => {
  assert.equal(sharePageCanonicalKey('p_abc123'), 'share_page:p_abc123');
  assert.equal(poemCanonicalKey('wild-geese'), 'poem:wild-geese');
});

test('addFavorite is idempotent and preserves the original added date', async () => {
  const db = createFavoritesDb();

  const first = await addFavorite({
    db,
    payload: { itemId: 'itm_1' },
    env: {},
    requestUrl: 'https://jeffharr.is/read-later/'
  });
  const firstAddedAt = first.entry.added_at;

  const second = await addFavorite({
    db,
    payload: { itemId: 'itm_1' },
    env: {},
    requestUrl: 'https://jeffharr.is/read-later/'
  });

  assert.equal(first.status, 201);
  assert.equal(second.status, 200);
  assert.equal(second.duplicate, true);
  assert.equal(second.entry.id, first.entry.id);
  assert.equal(second.entry.added_at, firstAddedAt);
  assert.equal(db.entries.size, 1);
});

test('favorite state and removal leave the underlying item intact', async () => {
  const db = createFavoritesDb();
  await addFavorite({
    db,
    payload: { itemId: 'itm_1' },
    env: {},
    requestUrl: 'https://jeffharr.is/read-later/'
  });

  const states = await listFavoriteStates({
    db,
    refs: [{ key: 'example', itemId: 'itm_1' }],
    env: {}
  });
  assert.equal(states[0].favorited, true);
  assert.equal(states[0].itemId, 'itm_1');

  const removed = await removeFavorite({
    db,
    payload: { itemId: 'itm_1' },
    env: {}
  });
  assert.equal(removed.ok, true);
  assert.equal(db.entries.size, 0);
  assert.equal(db.items.has('itm_1'), true);
});

test('favorite state API is public read-only', async () => {
  const db = createFavoritesDb();
  await addFavorite({
    db,
    payload: { itemId: 'itm_1' },
    env: {},
    requestUrl: 'https://jeffharr.is/read-later/'
  });

  const response = await favoriteStateRequest({
    request: new Request('https://jeffharr.is/api/favorites/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refs: [{ key: 'example', itemId: 'itm_1' }] })
    }),
    env: { CONTENT_DB: db }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.authenticated, false);
  assert.equal(body.states[0].favorited, true);
  assert.equal(body.states[0].itemId, 'itm_1');
});

test('public favorite state alias returns read-only state outside protected favorites routes', async () => {
  const db = createFavoritesDb();
  await addFavorite({
    db,
    payload: { itemId: 'itm_1' },
    env: {},
    requestUrl: 'https://jeffharr.is/read-later/'
  });

  const response = await publicFavoriteStateRequest({
    request: new Request('https://jeffharr.is/api/public/favorites/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refs: [{ key: 'example', itemId: 'itm_1' }]
      })
    }),
    env: { CONTENT_DB: db }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal('authenticated' in body, false);
  assert.equal('user' in body, false);
  assert.equal(body.states[0].favorited, true);
  assert.equal(body.states[0].itemId, 'itm_1');
});

test('public favorite state resolves Dharma refs in bulk without static talk lookup', async () => {
  const db = createFavoritesDb();
  db.items.set('itm_dharma_1', {
    id: 'itm_dharma_1',
    kind: 'dharma_talk',
    canonical_key: 'dharma_talk:burbea:Dharma Seed:62457',
    canonical_url: 'https://jeffharr.is/dharma/burbea/talks/dharmaseed-62457/',
    source_url: 'https://dharmaseed.org/talks/62457/',
    title: 'Perfection',
    extra_json: JSON.stringify({ corpus: 'burbea', sourceId: '62457' })
  });
  db.entries.set('lst_starred:itm_dharma_1', {
    id: 'fav_dharma_1',
    list_id: 'lst_starred',
    item_id: 'itm_dharma_1',
    status: 'active',
    added_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  });

  const response = await publicFavoriteStateRequest({
    request: new Request('https://jeffharr.is/api/public/favorites/state', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        refs: [
          {
            key: 'dharma_talk:burbea:dharmaseed-62457',
            ref: { kind: 'dharma_talk', corpus: 'burbea', id: 'dharmaseed-62457' }
          },
          {
            key: 'dharma_talk:burbea:dharmaseed-99999',
            ref: { kind: 'dharma_talk', corpus: 'burbea', id: 'dharmaseed-99999' }
          }
        ]
      })
    }),
    env: { CONTENT_DB: db }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.states[0].favorited, true);
  assert.equal(body.states[1].favorited, false);
});

test('list index hides private starred list for anonymous visitors', async () => {
  const db = createListApiDb();
  const response = await listIndexRequest({
    request: new Request('https://jeffharr.is/api/lists'),
    env: { CONTENT_DB: db }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.lists.map((list) => list.slug), ['read-later']);
});

test('private starred list details require authentication', async () => {
  const db = createListApiDb();
  const response = await listDetailRequest({
    request: new Request('https://jeffharr.is/api/lists/starred'),
    env: { CONTENT_DB: db },
    params: { slug: 'starred' }
  });

  assert.equal(response.status, 401);
});

function createFavoritesDb() {
  const db = {
    lists: new Map([
      ['starred', {
        id: 'lst_starred',
        slug: 'starred',
        title: 'Starred',
        visibility: 'private',
        kind: 'system',
        sort_mode: 'added_desc'
      }]
    ]),
    items: new Map([
      ['itm_1', {
        id: 'itm_1',
        kind: 'article',
        canonical_key: 'article:url:https://example.com/',
        canonical_url: 'https://example.com/',
        source_url: 'https://example.com/',
        title: 'Example'
      }]
    ]),
    entries: new Map(),
    prepare(sql) {
      return {
        all: async () => allForSql(db, sql),
        bind: (...args) => ({
          first: async () => firstForSql(db, sql, args),
          run: async () => runForSql(db, sql, args),
          all: async () => allForSql(db, sql)
        })
      };
    }
  };
  return db;
}

function createListApiDb() {
  const lists = new Map([
    ['read-later', {
      id: 'lst_read_later',
      slug: 'read-later',
      title: 'Read Later',
      description: '',
      visibility: 'public',
      kind: 'system',
      sort_mode: 'added_desc',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }],
    ['starred', {
      id: 'lst_starred',
      slug: 'starred',
      title: 'Starred',
      description: '',
      visibility: 'private',
      kind: 'system',
      sort_mode: 'added_desc',
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z'
    }]
  ]);

  return {
    prepare(sql) {
      return {
        all: async () => {
          if (sql.includes('FROM lists') && sql.includes('ORDER BY title')) {
            return { results: Array.from(lists.values()).sort((a, b) => a.title.localeCompare(b.title)) };
          }
          if (sql.includes('FROM list_entries')) {
            return { results: [] };
          }
          throw new Error(`Unhandled all SQL: ${sql}`);
        },
        bind: (...args) => ({
          first: async () => {
            if (sql.includes('FROM lists') && sql.includes('WHERE slug = ?')) {
              return lists.get(args[0]) || null;
            }
            throw new Error(`Unhandled first SQL: ${sql}`);
          }
        })
      };
    }
  };
}

function firstForSql(db, sql, args) {
  if (sql.includes('FROM lists') && sql.includes('WHERE slug = ?')) {
    return db.lists.get(args[0]) || null;
  }
  if (sql.includes('FROM items WHERE id = ?')) {
    return db.items.get(args[0]) || null;
  }
  if (sql.includes('FROM list_entries WHERE list_id = ? AND item_id = ?')) {
    return db.entries.get(`${args[0]}:${args[1]}`) || null;
  }
  if (sql.includes('JOIN items i') && sql.includes('le.item_id = ?')) {
    const entry = db.entries.get(`${args[0]}:${args[1]}`);
    const item = entry ? db.items.get(entry.item_id) : null;
    return entry && item ? { ...entry, canonical_key: item.canonical_key } : null;
  }
  if (sql.includes('JOIN items i') && sql.includes('i.canonical_key = ?')) {
    const item = Array.from(db.items.values()).find((candidate) => candidate.canonical_key === args[1]);
    const entry = item ? db.entries.get(`${args[0]}:${item.id}`) : null;
    return entry && item ? { ...entry, canonical_key: item.canonical_key } : null;
  }
  throw new Error(`Unhandled first SQL: ${sql}`);
}

function allForSql(db, sql) {
  if (sql.includes("i.kind = 'dharma_talk'")) {
    const results = [];
    for (const entry of db.entries.values()) {
      const item = db.items.get(entry.item_id);
      if (entry.list_id !== 'lst_starred' || entry.status !== 'active' || item?.kind !== 'dharma_talk') {
        continue;
      }
      results.push({
        canonical_key: item.canonical_key,
        canonical_url: item.canonical_url,
        source_url: item.source_url,
        extra_json: item.extra_json || '{}'
      });
    }
    return { results };
  }
  return { results: [] };
}

function runForSql(db, sql, args) {
  if (sql.includes('INSERT INTO list_entries')) {
    const [id, listId, itemId, status, position, note, addedAt, updatedAt, extraJson] = args;
    const key = `${listId}:${itemId}`;
    const existing = db.entries.get(key);
    db.entries.set(key, {
      id: existing?.id || id,
      list_id: listId,
      item_id: itemId,
      status,
      position,
      note,
      added_at: addedAt,
      updated_at: updatedAt,
      extra_json: extraJson
    });
    return { success: true };
  }
  if (sql.includes('DELETE FROM list_entries WHERE id = ? AND list_id = ?')) {
    const [id, listId] = args;
    for (const [key, entry] of db.entries) {
      if (entry.id === id && entry.list_id === listId) {
        db.entries.delete(key);
      }
    }
    return { success: true };
  }
  throw new Error(`Unhandled run SQL: ${sql}`);
}
