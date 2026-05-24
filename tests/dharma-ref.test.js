import assert from 'node:assert/strict';
import test from 'node:test';
import {
  collectDharmaIdentities,
  dharmaFavoriteStateKey,
  dharmaFeedItemIdentity,
  dharmaIdentityIsStarred,
  dharmaRefIdentity,
  dharmaStarredRowIdentity,
  dharmaTalkCanonicalKey,
  dharmaTalkMatchesId,
  dharmaTalkSourceId
} from '../functions/api/dharma/ref.js';

test('Dharma ref helper matches favorite state refs by source id and safe id', () => {
  const refs = collectDharmaIdentities([
    dharmaStarredRowIdentity({
      canonical_key: 'dharma_talk:burbea:Dharma Seed:62457',
      canonical_url: 'https://jeffharr.is/dharma/burbea/talks/dharmaseed-62457/',
      source_url: 'https://dharmaseed.org/talks/62457/'
    }, {
      sourceId: '62457'
    })
  ]);

  assert.equal(dharmaIdentityIsStarred(dharmaRefIdentity({
    kind: 'dharma_talk',
    corpus: 'burbea',
    id: 'dharmaseed-62457'
  }), refs), true);
  assert.equal(dharmaIdentityIsStarred(dharmaRefIdentity({
    kind: 'dharma_talk',
    corpus: 'burbea',
    sourceId: '62457'
  }), refs), true);
  assert.equal(dharmaIdentityIsStarred(dharmaRefIdentity({
    kind: 'dharma_talk',
    corpus: 'brensilver',
    id: 'dharmaseed-62457'
  }), refs), false);
});

test('Dharma ref helper matches RSS feed items through guid or canonical URL', () => {
  const refs = collectDharmaIdentities([
    dharmaStarredRowIdentity({
      canonical_key: 'dharma_talk:watts:KPFA Archive:bb0654',
      canonical_url: 'https://jeffharr.is/dharma/watts/talks/watts-bb0654/',
      source_url: null
    }, {
      sourceId: 'bb0654'
    })
  ]);

  assert.equal(dharmaIdentityIsStarred(dharmaFeedItemIdentity({
    corpus: 'watts',
    guid: 'watts:bb0654',
    link: 'https://jeffharr.is/dharma/watts/talks/watts-bb0654/'
  }), refs), true);
});

test('Dharma talk identity centralizes canonical key and static talk lookup ids', () => {
  const talk = {
    id: 'dharmaseed:62457',
    source: 'Dharma Seed',
    source_id: '62457',
    canonical_url: 'https://jeffharr.is/dharma/burbea/talks/dharmaseed-62457/'
  };

  assert.equal(dharmaTalkSourceId(talk), '62457');
  assert.equal(dharmaTalkCanonicalKey('burbea', talk), 'dharma_talk:burbea:Dharma Seed:62457');
  assert.equal(dharmaFavoriteStateKey({ corpus: 'burbea', id: 'dharmaseed-62457' }), 'dharma_talk:burbea:dharmaseed-62457');
  assert.equal(dharmaTalkMatchesId(talk, 'dharmaseed:62457'), true);
  assert.equal(dharmaTalkMatchesId(talk, '62457'), true);
  assert.equal(dharmaTalkMatchesId(talk, 'dharmaseed-62457'), true);
});
