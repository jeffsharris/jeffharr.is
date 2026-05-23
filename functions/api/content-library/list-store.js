import {
  getItemById,
  getListBySlug,
  getListEntry,
  upsertListEntry
} from './db.js';
import { createRandomId, getNowIso } from './ids.js';
import { resolveContentInput, resolveContentLookup } from './resolve.js';
import {
  loadStarredDharmaRefs,
  normalizeRef
} from '../dharma/starred.js';

const STARRED_SLUG = 'starred';

async function listFavoriteStates({ db, refs = [], env }) {
  const list = await getListBySlug(db, STARRED_SLUG);
  if (!list) return [];

  const dharmaRefs = refs.filter(isDharmaTalkStateRef);
  const starredDharmaRefs = dharmaRefs.length
    ? await loadStarredDharmaRefs(db, dharmaRefs.map((ref) => ref.ref.corpus))
    : null;

  return Promise.all(refs.map(async (ref) => {
    if (isDharmaTalkStateRef(ref)) {
      return serializeDharmaFavoriteState(ref, starredDharmaRefs);
    }
    const lookup = await resolveContentLookup({ db, payload: ref, env });
    const entry = await getStarredEntryForLookup(db, list.id, lookup);
    return serializeFavoriteState(ref, lookup, entry);
  }));
}

async function addFavorite({ db, payload, env, requestUrl }) {
  const list = await getListBySlug(db, STARRED_SLUG);
  if (!list) {
    return { ok: false, status: 404, error: 'Favorites list not found' };
  }

  const item = await resolveContentInput({
    db,
    payload: { ...payload, requestUrl },
    env
  });
  const existing = await getListEntry(db, list.id, item.id);
  const now = getNowIso();
  const entry = await upsertListEntry(db, {
    id: existing?.id || createRandomId('fav'),
    listId: list.id,
    itemId: item.id,
    status: 'active',
    position: payload?.position ?? null,
    note: typeof payload?.note === 'string' ? payload.note : null,
    addedAt: existing?.added_at || now,
    updatedAt: now,
    extra: payload?.extra || {}
  });

  return {
    ok: true,
    status: existing ? 200 : 201,
    duplicate: Boolean(existing),
    item,
    entry
  };
}

async function removeFavorite({ db, payload, env }) {
  const list = await getListBySlug(db, STARRED_SLUG);
  if (!list) {
    return { ok: false, status: 404, error: 'Favorites list not found' };
  }

  const lookup = await resolveContentLookup({ db, payload, env });
  const entry = await getStarredEntryForLookup(db, list.id, lookup);
  if (!entry) {
    return { ok: false, status: 404, error: 'Favorite not found' };
  }

  await db.prepare(
    `DELETE FROM list_entries WHERE id = ? AND list_id = ?`
  ).bind(entry.id, list.id).run();

  return {
    ok: true,
    status: 200,
    entry
  };
}

async function getStarredEntryForLookup(db, listId, lookup) {
  if (!lookup?.itemId && !lookup?.canonicalKey) return null;

  if (lookup.itemId) {
    const item = await getItemById(db, lookup.itemId);
    if (!item) return null;
    return db.prepare(
      `SELECT le.*, i.canonical_key
       FROM list_entries le
       JOIN items i ON i.id = le.item_id
       WHERE le.list_id = ? AND le.item_id = ?`
    ).bind(listId, item.id).first();
  }

  return db.prepare(
    `SELECT le.*, i.canonical_key
     FROM list_entries le
     JOIN items i ON i.id = le.item_id
     WHERE le.list_id = ? AND i.canonical_key = ?`
  ).bind(listId, lookup.canonicalKey).first();
}

function serializeFavoriteState(ref, lookup, entry) {
  return {
    key: ref?.key || lookup?.canonicalKey || lookup?.itemId || '',
    itemId: entry?.item_id || lookup?.itemId || null,
    canonicalKey: entry?.canonical_key || lookup?.canonicalKey || null,
    favorited: Boolean(entry),
    entryId: entry?.id || null,
    addedAt: entry?.added_at || null,
    updatedAt: entry?.updated_at || null
  };
}

function isDharmaTalkStateRef(ref) {
  return ref?.ref?.kind === 'dharma_talk' && Boolean(ref.ref.corpus);
}

function serializeDharmaFavoriteState(ref, starredRefs) {
  return {
    key: ref?.key || dharmaStateKey(ref.ref),
    itemId: null,
    canonicalKey: null,
    favorited: dharmaStateRefIsStarred(ref.ref, starredRefs),
    entryId: null,
    addedAt: null,
    updatedAt: null
  };
}

function dharmaStateKey(ref) {
  const corpus = normalizeRef(ref?.corpus);
  const id = normalizeRef(ref?.id || ref?.sourceId || ref?.slug);
  return corpus && id ? `dharma_talk:${corpus}:${id}` : '';
}

function dharmaStateRefIsStarred(ref, starredRefs) {
  const bucket = starredRefs?.byCorpus?.get(normalizeRef(ref?.corpus));
  if (!bucket) return false;

  for (const id of dharmaStateIdCandidates(ref)) {
    if (bucket.safeIds.has(id) || bucket.sourceIds.has(id)) return true;
  }

  for (const url of dharmaStateUrlCandidates(ref)) {
    if (bucket.urls.has(url)) return true;
  }

  return false;
}

function dharmaStateIdCandidates(ref) {
  const values = new Set();
  for (const value of [ref?.id, ref?.sourceId, ref?.slug]) {
    const normalized = normalizeRef(value);
    if (!normalized) continue;
    values.add(normalized);
    if (normalized.includes(':')) {
      values.add(normalizeRef(normalized.split(':').slice(1).join(':')));
    }
  }
  return values;
}

function dharmaStateUrlCandidates(ref) {
  return [ref?.url, ref?.canonicalUrl, ref?.sourceUrl]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

export {
  STARRED_SLUG,
  addFavorite,
  listFavoriteStates,
  removeFavorite
};
