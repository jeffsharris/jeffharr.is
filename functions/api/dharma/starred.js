import { safeJsonParse } from '../content-library/ids.js';

async function loadStarredDharmaRefs(db, corpora = []) {
  const corpusSet = new Set(normalizeCorpusList(corpora));
  const result = await db.prepare(
    `SELECT i.canonical_key, i.canonical_url, i.source_url, i.extra_json
     FROM list_entries le
     JOIN lists l ON l.id = le.list_id
     JOIN items i ON i.id = le.item_id
     WHERE l.slug = 'starred'
       AND le.status = 'active'
       AND i.kind = 'dharma_talk'
       AND i.canonical_key LIKE 'dharma_talk:%'`
  ).all();

  return collectDharmaRefs(
    (result.results || []).filter((row) => {
      if (!corpusSet.size) return true;
      return corpusSet.has(corpusFromRow(row));
    })
  );
}

function normalizeCorpusList(corpora) {
  return (Array.isArray(corpora) ? corpora : [corpora])
    .map((value) => normalizeRef(value))
    .filter(Boolean);
}

function collectDharmaRefs(rows) {
  const refs = {
    byCorpus: new Map()
  };

  for (const row of rows) {
    const corpus = corpusFromRow(row);
    if (!corpus) continue;
    const bucket = bucketForCorpus(refs, corpus);
    const extra = safeJsonParse(row.extra_json, {});
    addRef(bucket.sourceIds, extra?.sourceId);
    addRef(bucket.sourceIds, sourceIdFromCanonicalKey(row.canonical_key));
    addSafeIdFromUrl(bucket, row.canonical_url);
    addSafeIdFromUrl(bucket, row.source_url);
    addUrlRef(bucket, row.canonical_url);
    addUrlRef(bucket, row.source_url);
  }

  return refs;
}

function bucketForCorpus(refs, corpus) {
  const key = normalizeRef(corpus);
  if (!refs.byCorpus.has(key)) {
    refs.byCorpus.set(key, {
      sourceIds: new Set(),
      safeIds: new Set(),
      urls: new Set()
    });
  }
  return refs.byCorpus.get(key);
}

function corpusFromRow(row) {
  return corpusFromCanonicalKey(row?.canonical_key)
    || corpusFromUrl(row?.canonical_url)
    || corpusFromUrl(row?.source_url);
}

function corpusFromCanonicalKey(canonicalKey) {
  const parts = String(canonicalKey || '').split(':');
  return parts.length >= 4 && parts[0] === 'dharma_talk' ? normalizeRef(parts[1]) : '';
}

function sourceIdFromCanonicalKey(canonicalKey) {
  const parts = String(canonicalKey || '').split(':');
  return parts.length >= 4 ? parts.at(-1) : '';
}

function corpusFromUrl(url) {
  const match = String(url || '').match(/\/dharma\/([^/?#]+)(?:\/|$)/);
  return normalizeRef(match?.[1]);
}

function safeIdFromUrl(url) {
  const match = String(url || '').match(/\/talks\/([^/?#]+)\/?/);
  return match?.[1] || '';
}

function addSafeIdFromUrl(bucket, url) {
  addRef(bucket.safeIds, safeIdFromUrl(url));
}

function addUrlRef(bucket, url) {
  const value = String(url || '').trim();
  if (value) bucket.urls.add(value);
}

function addRef(set, value) {
  const normalized = normalizeRef(value);
  if (normalized) set.add(normalized);
}

function normalizeRef(value) {
  return String(value || '').trim().toLowerCase();
}

function hasStarredRefs(refs, corpora = []) {
  const corpusList = normalizeCorpusList(corpora);
  const buckets = corpusList.length
    ? corpusList.map((corpus) => refs.byCorpus.get(corpus)).filter(Boolean)
    : Array.from(refs.byCorpus.values());
  return buckets.some((bucket) => (
    bucket.sourceIds.size > 0 || bucket.safeIds.size > 0 || bucket.urls.size > 0
  ));
}

function talkIsStarred(talk, corpus, refs) {
  const bucket = refs.byCorpus.get(normalizeRef(corpus));
  if (!bucket) return false;

  if (bucket.sourceIds.has(normalizeRef(talk?.source_id))) return true;
  const talkGuid = String(talk?.id || '');
  const guidSourceId = talkGuid.includes(':') ? talkGuid.split(':').slice(1).join(':') : talkGuid;
  if (bucket.sourceIds.has(normalizeRef(guidSourceId))) return true;

  const safeId = safeIdFromUrl(talk?.canonical_url || talk?.link || '');
  if (bucket.safeIds.has(normalizeRef(safeId))) return true;

  return bucket.urls.has(String(talk?.canonical_url || '').trim())
    || bucket.urls.has(String(talk?.link || '').trim());
}

function feedItemIsStarred(itemXml, refs, corpus) {
  const bucket = refs.byCorpus.get(normalizeRef(corpus));
  if (!bucket) return false;

  const guid = xmlText(itemXml, 'guid');
  const sourceId = guid.includes(':') ? guid.split(':').slice(1).join(':') : guid;
  if (bucket.sourceIds.has(normalizeRef(sourceId))) return true;

  const link = xmlText(itemXml, 'link');
  const safeId = safeIdFromUrl(link);
  if (bucket.safeIds.has(normalizeRef(safeId))) return true;

  return bucket.urls.has(link);
}

function xmlText(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`));
  return decodeXmlEntities(match?.[1] || '').trim();
}

function decodeXmlEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

export {
  feedItemIsStarred,
  hasStarredRefs,
  loadStarredDharmaRefs,
  normalizeRef,
  talkIsStarred
};
