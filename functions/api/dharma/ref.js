function normalizeDharmaRef(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeDharmaUrl(value) {
  return String(value || '').trim();
}

function normalizeDharmaCorpusList(corpora) {
  return (Array.isArray(corpora) ? corpora : [corpora])
    .map((value) => normalizeDharmaRef(value))
    .filter(Boolean);
}

function createDharmaRefs() {
  return {
    byCorpus: new Map()
  };
}

function createDharmaIdentity({ corpus, sourceIds = [], safeIds = [], urls = [] } = {}) {
  const identity = {
    corpus: normalizeDharmaRef(corpus),
    sourceIds: new Set(),
    safeIds: new Set(),
    urls: new Set()
  };
  for (const sourceId of sourceIds) addNormalizedRef(identity.sourceIds, sourceId);
  for (const safeId of safeIds) addNormalizedRef(identity.safeIds, safeId);
  for (const url of urls) addUrlRef(identity.urls, url);
  return identity;
}

function collectDharmaIdentities(identities) {
  const refs = createDharmaRefs();
  for (const identity of identities) {
    addDharmaIdentity(refs, identity);
  }
  return refs;
}

function addDharmaIdentity(refs, identity) {
  if (!identity?.corpus) return refs;
  const bucket = bucketForDharmaCorpus(refs, identity.corpus);
  for (const sourceId of identity.sourceIds || []) addNormalizedRef(bucket.sourceIds, sourceId);
  for (const safeId of identity.safeIds || []) addNormalizedRef(bucket.safeIds, safeId);
  for (const url of identity.urls || []) addUrlRef(bucket.urls, url);
  return refs;
}

function bucketForDharmaCorpus(refs, corpus) {
  const key = normalizeDharmaRef(corpus);
  if (!refs.byCorpus.has(key)) {
    refs.byCorpus.set(key, {
      sourceIds: new Set(),
      safeIds: new Set(),
      urls: new Set()
    });
  }
  return refs.byCorpus.get(key);
}

function dharmaIdentityIsStarred(identity, refs) {
  if (!identity?.corpus || !refs?.byCorpus) return false;
  const bucket = refs.byCorpus.get(normalizeDharmaRef(identity.corpus));
  if (!bucket) return false;

  for (const sourceId of identity.sourceIds || []) {
    if (bucket.sourceIds.has(normalizeDharmaRef(sourceId))) return true;
  }
  for (const safeId of identity.safeIds || []) {
    if (bucket.safeIds.has(normalizeDharmaRef(safeId))) return true;
  }
  for (const url of identity.urls || []) {
    if (bucket.urls.has(normalizeDharmaUrl(url))) return true;
  }

  return false;
}

function hasDharmaRefs(refs, corpora = []) {
  const corpusList = normalizeDharmaCorpusList(corpora);
  const buckets = corpusList.length
    ? corpusList.map((corpus) => refs?.byCorpus?.get(corpus)).filter(Boolean)
    : Array.from(refs?.byCorpus?.values() || []);
  return buckets.some((bucket) => (
    bucket.sourceIds.size > 0 || bucket.safeIds.size > 0 || bucket.urls.size > 0
  ));
}

function dharmaStarredRowIdentity(row, extra = {}) {
  return createDharmaIdentity({
    corpus: dharmaCorpusFromRow(row),
    sourceIds: [
      extra?.sourceId,
      dharmaSourceIdFromCanonicalKey(row?.canonical_key)
    ],
    safeIds: [
      dharmaSafeIdFromUrl(row?.canonical_url),
      dharmaSafeIdFromUrl(row?.source_url)
    ],
    urls: [
      row?.canonical_url,
      row?.source_url
    ]
  });
}

function dharmaRefIdentity(ref) {
  const idCandidates = dharmaRefIdCandidates(ref);
  return createDharmaIdentity({
    corpus: ref?.corpus,
    sourceIds: idCandidates,
    safeIds: idCandidates,
    urls: [
      ref?.url,
      ref?.canonicalUrl,
      ref?.sourceUrl
    ]
  });
}

function dharmaTalkIdentity(talk, corpus) {
  return createDharmaIdentity({
    corpus,
    sourceIds: dharmaTalkIdCandidates(talk),
    safeIds: [
      dharmaSafeIdFromUrl(talk?.canonical_url),
      dharmaSafeIdFromUrl(talk?.link)
    ],
    urls: [
      talk?.canonical_url,
      talk?.link
    ]
  });
}

function dharmaFeedItemIdentity({ corpus, guid, link } = {}) {
  return createDharmaIdentity({
    corpus,
    sourceIds: dharmaGuidIdCandidates(guid),
    safeIds: [
      dharmaSafeIdFromUrl(link)
    ],
    urls: [
      link
    ]
  });
}

function dharmaTalkMatchesId(talk, id) {
  const normalizedId = normalizeDharmaRef(id);
  if (!normalizedId) return false;
  const identity = dharmaTalkIdentity(talk, 'match');
  return identity.sourceIds.has(normalizedId) || identity.safeIds.has(normalizedId);
}

function dharmaFavoriteStateKey(ref) {
  const corpus = normalizeDharmaRef(ref?.corpus);
  const id = normalizeDharmaRef(ref?.id || ref?.sourceId || ref?.slug);
  return corpus && id ? `dharma_talk:${corpus}:${id}` : '';
}

function dharmaTalkSourceId(talk) {
  return normalizeDharmaUrl(talk?.source_id) || dharmaSourceIdFromGuid(talk?.id);
}

function dharmaTalkCanonicalKey(corpus, talk) {
  const source = normalizeDharmaUrl(talk?.source);
  const sourceId = dharmaTalkSourceId(talk);
  return `dharma_talk:${normalizeDharmaRef(corpus)}:${source}:${sourceId}`;
}

function dharmaCorpusFromRow(row) {
  return dharmaCorpusFromCanonicalKey(row?.canonical_key)
    || dharmaCorpusFromUrl(row?.canonical_url)
    || dharmaCorpusFromUrl(row?.source_url);
}

function dharmaCorpusFromCanonicalKey(canonicalKey) {
  const parts = String(canonicalKey || '').split(':');
  return parts.length >= 4 && parts[0] === 'dharma_talk'
    ? normalizeDharmaRef(parts[1])
    : '';
}

function dharmaSourceIdFromCanonicalKey(canonicalKey) {
  const parts = String(canonicalKey || '').split(':');
  return parts.length >= 4 ? parts.at(-1) : '';
}

function dharmaCorpusFromUrl(url) {
  const match = String(url || '').match(/\/dharma\/([^/?#]+)(?:\/|$)/);
  return normalizeDharmaRef(match?.[1]);
}

function dharmaSafeIdFromUrl(url) {
  const match = String(url || '').match(/\/talks\/([^/?#]+)\/?/);
  return match?.[1] || '';
}

function dharmaSourceIdFromGuid(guid) {
  const value = normalizeDharmaUrl(guid);
  return value.includes(':') ? value.split(':').slice(1).join(':') : value;
}

function dharmaTalkIdCandidates(talk) {
  return [
    normalizeDharmaUrl(talk?.source_id),
    ...dharmaGuidIdCandidates(talk?.id)
  ].filter(Boolean);
}

function dharmaGuidIdCandidates(guid) {
  const value = normalizeDharmaUrl(guid);
  if (!value) return [];
  const sourceId = dharmaSourceIdFromGuid(value);
  return sourceId && sourceId !== value ? [value, sourceId] : [value];
}

function dharmaRefIdCandidates(ref) {
  const values = new Set();
  for (const value of [ref?.id, ref?.sourceId, ref?.slug]) {
    for (const candidate of dharmaGuidIdCandidates(value)) {
      const normalized = normalizeDharmaRef(candidate);
      if (normalized) values.add(normalized);
    }
  }
  return Array.from(values);
}

function addNormalizedRef(set, value) {
  const normalized = normalizeDharmaRef(value);
  if (normalized) set.add(normalized);
}

function addUrlRef(set, value) {
  const url = normalizeDharmaUrl(value);
  if (url) set.add(url);
}

export {
  addDharmaIdentity,
  collectDharmaIdentities,
  createDharmaIdentity,
  createDharmaRefs,
  dharmaCorpusFromCanonicalKey,
  dharmaCorpusFromRow,
  dharmaCorpusFromUrl,
  dharmaFavoriteStateKey,
  dharmaFeedItemIdentity,
  dharmaIdentityIsStarred,
  dharmaRefIdentity,
  dharmaSafeIdFromUrl,
  dharmaSourceIdFromCanonicalKey,
  dharmaSourceIdFromGuid,
  dharmaStarredRowIdentity,
  dharmaTalkCanonicalKey,
  dharmaTalkIdentity,
  dharmaTalkMatchesId,
  dharmaTalkSourceId,
  hasDharmaRefs,
  normalizeDharmaCorpusList,
  normalizeDharmaRef,
  normalizeDharmaUrl
};
