import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/feeds/dharma.xml.js';

const BRENSILVER_TALKS = [
  {
    id: 'audiodharma:1',
    source: 'AudioDharma',
    source_id: '1',
    title: 'Metta and Attention',
    speaker: 'Matthew Brensilver',
    published_at: '2026-01-02T00:00:00.000Z',
    canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/',
    link: 'https://example.com/talks/1',
    audio_url: 'https://media.example/metta.mp3',
    audio_type: 'audio/mpeg',
    podcast_description: 'A talk about kindness and attention.',
    duration: '30:00'
  },
  {
    id: 'audiodharma:2',
    source: 'AudioDharma',
    source_id: '2',
    title: 'Equanimity',
    speaker: 'Matthew Brensilver',
    published_at: '2026-01-01T00:00:00.000Z',
    canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-2/',
    link: 'https://example.com/talks/2',
    audio_url: 'https://media.example/equanimity.mp3',
    audio_type: 'audio/mpeg',
    duration: '1:10:00'
  }
];

const BURBEA_TALKS = [
  {
    id: 'dharmaseed:10',
    source: 'Dharma Seed',
    source_id: '10',
    title: 'Imaginal Practice',
    speaker: 'Rob Burbea',
    published_at: '2026-01-03T00:00:00.000Z',
    canonical_url: 'https://jeffharr.is/dharma/burbea/talks/dharmaseed-10/',
    link: 'https://example.com/talks/10',
    audio_url: 'https://media.example/imaginal.mp3',
    audio_type: 'audio/mpeg',
    duration: '50:00'
  }
];

test('dynamic Dharma feed filters by search query', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver&q=metta'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': BRENSILVER_TALKS
      }),
      CONTENT_DB: createStarredDb([])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'application/rss+xml; charset=utf-8');
  assert.match(body, /Metta and Attention/);
  assert.doesNotMatch(body, /Equanimity/);
  assert.match(body, /Matching &quot;Metta&quot;/);
});

test('dynamic Dharma feed filters by maximum duration', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver&q=duration:%3C45m'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': BRENSILVER_TALKS
      }),
      CONTENT_DB: createStarredDb([])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Metta and Attention/);
  assert.doesNotMatch(body, /Equanimity/);
  assert.match(body, /duration:&lt;45m/);
});

test('dynamic Dharma feed combines text and duration range filters', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver&q=metta%20duration:20m..40m'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': BRENSILVER_TALKS
      }),
      CONTENT_DB: createStarredDb([])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Metta and Attention/);
  assert.doesNotMatch(body, /Equanimity/);
  assert.match(body, /Matching &quot;Metta&quot;/);
  assert.match(body, /duration:20m\.\.40m/);
});

test('dynamic Dharma feed supports length alias for duration filters', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver&q=length:%3E1h'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': BRENSILVER_TALKS
      }),
      CONTENT_DB: createStarredDb([])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(body, /Metta and Attention/);
  assert.match(body, /Equanimity/);
  assert.match(body, /duration:&gt;1h/);
});

test('dynamic Dharma feed defaults to Dharma talks when scope is omitted', async () => {
  const guidedTalk = {
    ...BRENSILVER_TALKS[1],
    id: 'audiodharma:guided',
    source_id: 'guided',
    title: 'Guided Body Scan',
    canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-guided/',
    audio_url: 'https://media.example/guided.mp3'
  };
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': [BRENSILVER_TALKS[0], guidedTalk],
        '/dharma/brensilver/dharma-talks.json': [BRENSILVER_TALKS[0]]
      }),
      CONTENT_DB: createStarredDb([])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Metta and Attention/);
  assert.doesNotMatch(body, /Guided Body Scan/);
  assert.match(body, /scope=dharma/);
});

test('dynamic Dharma feed title-cases custom search titles and uses corpus authors', async () => {
  const guidedTalk = {
    id: 'audiodharma:guided',
    source: 'AudioDharma',
    source_id: 'guided',
    title: 'Guided Body Scan',
    speaker: 'Matthew Brensilver, Dana DePalma, MA',
    published_at: '2026-01-04T00:00:00.000Z',
    canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-guided/',
    link: 'https://example.com/talks/guided',
    audio_url: 'https://media.example/guided.mp3',
    audio_type: 'audio/mpeg',
    podcast_description: 'A guided body scan practice.',
    duration: '25:00'
  };
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver&scope=guided&q=guided'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/guided-talks.json': [guidedTalk]
      }),
      CONTENT_DB: createStarredDb([])
    }
  });
  const body = await response.text();
  const authors = [...body.matchAll(/<itunes:author>(.*?)<\/itunes:author>/g)].map((match) => match[1]);

  assert.equal(response.status, 200);
  assert.match(body, /<title>Matthew Brensilver Guided Meditations Matching &quot;Guided&quot;<\/title>/);
  assert.deepEqual(authors, ['Matthew Brensilver', 'Matthew Brensilver']);
});

test('dynamic Dharma feed can span corpora and filter to starred talks', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver,burbea&starred=1'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': BRENSILVER_TALKS,
        '/dharma/burbea/talks.json': BURBEA_TALKS
      }),
      CONTENT_DB: createStarredDb([
        {
          canonical_key: 'dharma_talk:brensilver:AudioDharma:1',
          canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/',
          source_url: null,
          extra_json: JSON.stringify({ sourceId: '1' })
        },
        {
          canonical_key: 'dharma_talk:burbea:Dharma Seed:10',
          canonical_url: 'https://jeffharr.is/dharma/burbea/talks/dharmaseed-10/',
          source_url: null,
          extra_json: JSON.stringify({ sourceId: '10' })
        }
      ])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Metta and Attention/);
  assert.match(body, /Imaginal Practice/);
  assert.doesNotMatch(body, /Equanimity/);
  assert.match(body, /Dharma Archive Starred Dharma Talks/);
});

test('dynamic Dharma feed treats is:starred search as starred filter', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/feeds/dharma.xml?corpus=brensilver&q=is%3Astarred%20metta'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': BRENSILVER_TALKS
      }),
      CONTENT_DB: createStarredDb([
        {
          canonical_key: 'dharma_talk:brensilver:AudioDharma:1',
          canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/',
          source_url: null,
          extra_json: JSON.stringify({ sourceId: '1' })
        }
      ])
    }
  });
  const body = await response.text();

  assert.equal(response.status, 200);
  assert.match(body, /Metta and Attention/);
  assert.doesNotMatch(body, /Equanimity/);
  assert.match(body, /Matching &quot;Metta&quot;/);
  assert.match(body, /starred/);
});

function createAssets(files) {
  return {
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      if (!Object.hasOwn(files, path)) {
        return new Response('Not found', { status: 404 });
      }
      return Response.json(files[path]);
    }
  };
}

function createStarredDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM list_entries le/);
      return {
        all: async () => ({ results: rows })
      };
    }
  };
}
