import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/read-later/progress.js';

class ProgressDb {
  constructor(initialState) {
    this.entries = new Set(['item-1']);
    this.states = new Map(initialState ? [['item-1', {
      entry_id: 'item-1',
      read_at: null,
      kindle_json: null,
      cover_sync_json: null,
      push_channels_json: null,
      ...initialState
    }]] : []);
  }

  prepare(sql) {
    return {
      bind: (...args) => ({
        first: async () => {
          if (sql.includes('FROM list_entries')) {
            return this.entries.has(args[0]) ? { entry_id: args[0] } : null;
          }
          if (sql.includes('FROM read_state')) {
            return this.states.get(args[0]) || null;
          }
          return null;
        },
        run: async () => {
          if (sql.includes('INSERT INTO read_state')) {
            const [
              entryId,
              readAt,
              progressRatio,
              progressJson,
              kindleStatus,
              kindleJson,
              coverSyncJson,
              pushChannelsJson,
              updatedAt
            ] = args;
            this.states.set(entryId, {
              entry_id: entryId,
              read_at: readAt,
              progress_ratio: progressRatio,
              progress_json: progressJson,
              kindle_status: kindleStatus,
              kindle_json: kindleJson,
              cover_sync_json: coverSyncJson,
              push_channels_json: pushChannelsJson,
              updated_at: updatedAt
            });
          }
          return { success: true };
        }
      })
    };
  }
}

test('progress endpoint applies newer scroll updates', async () => {
  const db = new ProgressDb({
    progress_json: JSON.stringify({
      scrollTop: 100,
      scrollRatio: 0.1,
      updatedAt: '2026-02-21T10:00:00.000Z'
    })
  });
  const request = new Request('https://example.com/api/read-later/progress', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'item-1',
      scrollTop: 800,
      scrollRatio: 0.8,
      updatedAt: '2026-02-21T10:05:00.000Z'
    })
  });

  const response = await onRequest({ request, env: { CONTENT_DB: db } });
  assert.equal(response.status, 200);

  const updated = JSON.parse(db.states.get('item-1').progress_json);
  assert.equal(updated.scrollTop, 800);
  assert.equal(updated.scrollRatio, 0.8);
  assert.equal(updated.updatedAt, '2026-02-21T10:05:00.000Z');
});

test('progress endpoint ignores stale scroll updates', async () => {
  const db = new ProgressDb({
    progress_json: JSON.stringify({
      scrollTop: 900,
      scrollRatio: 0.9,
      updatedAt: '2026-02-21T10:10:00.000Z'
    })
  });
  const request = new Request('https://example.com/api/read-later/progress', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'item-1',
      scrollTop: 200,
      scrollRatio: 0.2,
      updatedAt: '2026-02-21T10:02:00.000Z'
    })
  });

  const response = await onRequest({ request, env: { CONTENT_DB: db } });
  assert.equal(response.status, 200);

  const updated = JSON.parse(db.states.get('item-1').progress_json);
  assert.equal(updated.scrollTop, 900);
  assert.equal(updated.scrollRatio, 0.9);
  assert.equal(updated.updatedAt, '2026-02-21T10:10:00.000Z');
});
