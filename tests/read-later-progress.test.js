import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/read-later/progress.js';

class MemoryKV {
  constructor(initialItem) {
    this.store = new Map();
    if (initialItem) {
      this.store.set(`item:${initialItem.id}`, JSON.stringify(initialItem));
    }
  }

  async get(key, options = {}) {
    const value = this.store.get(key);
    if (!value) return null;
    if (options.type === 'json') {
      return JSON.parse(value);
    }
    return value;
  }

  async put(key, value) {
    this.store.set(key, value);
  }
}

test('progress endpoint applies newer scroll updates', async () => {
  const item = {
    id: 'item-1',
    progress: {
      scrollTop: 100,
      scrollRatio: 0.1,
      updatedAt: '2026-02-21T10:00:00.000Z'
    }
  };
  const kv = new MemoryKV(item);
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

  const response = await onRequest({ request, env: { READ_LATER: kv } });
  assert.equal(response.status, 200);

  const updated = await kv.get('item:item-1', { type: 'json' });
  assert.equal(updated.progress.scrollTop, 800);
  assert.equal(updated.progress.scrollRatio, 0.8);
  assert.equal(updated.progress.updatedAt, '2026-02-21T10:05:00.000Z');
});

test('progress endpoint ignores stale scroll updates', async () => {
  const item = {
    id: 'item-1',
    progress: {
      scrollTop: 900,
      scrollRatio: 0.9,
      updatedAt: '2026-02-21T10:10:00.000Z'
    }
  };
  const kv = new MemoryKV(item);
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

  const response = await onRequest({ request, env: { READ_LATER: kv } });
  assert.equal(response.status, 200);

  const updated = await kv.get('item:item-1', { type: 'json' });
  assert.equal(updated.progress.scrollTop, 900);
  assert.equal(updated.progress.scrollRatio, 0.9);
  assert.equal(updated.progress.updatedAt, '2026-02-21T10:10:00.000Z');
});
