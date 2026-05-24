import { safeJsonParse } from '../content-library/ids.js';
import {
  collectDharmaIdentities,
  dharmaCorpusFromRow,
  dharmaFeedItemIdentity,
  dharmaIdentityIsStarred,
  dharmaStarredRowIdentity,
  dharmaTalkIdentity,
  hasDharmaRefs,
  normalizeDharmaCorpusList,
  normalizeDharmaRef
} from './ref.js';

async function loadStarredDharmaRefs(db, corpora = []) {
  const corpusSet = new Set(normalizeDharmaCorpusList(corpora));
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

  return collectDharmaIdentities(
    (result.results || [])
      .filter((row) => {
        if (!corpusSet.size) return true;
        return corpusSet.has(dharmaCorpusFromRow(row));
      })
      .map((row) => dharmaStarredRowIdentity(row, safeJsonParse(row.extra_json, {})))
  );
}

function hasStarredRefs(refs, corpora = []) {
  return hasDharmaRefs(refs, corpora);
}

function talkIsStarred(talk, corpus, refs) {
  return dharmaIdentityIsStarred(dharmaTalkIdentity(talk, corpus), refs);
}

function feedItemIsStarred(itemXml, refs, corpus) {
  return dharmaIdentityIsStarred(dharmaFeedItemIdentity({
    corpus,
    guid: xmlText(itemXml, 'guid'),
    link: xmlText(itemXml, 'link')
  }), refs);
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
  normalizeDharmaRef as normalizeRef,
  talkIsStarred
};
