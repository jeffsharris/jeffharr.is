import assert from 'node:assert/strict';
import test from 'node:test';
import { onRequest } from '../functions/api/dharma.js';

test('Dharma sidebar API returns normalized random talks from all corpora', async () => {
  const response = await onRequest({
    request: new Request('https://jeffharr.is/api/dharma'),
    env: {
      ASSETS: createAssets({
        '/dharma/brensilver/talks.json': [
          {
            id: 'audiodharma:1',
            title: 'Attention',
            speaker: 'Matthew Brensilver',
            canonical_url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/',
            audio_url: 'https://media.example/attention.mp3',
            episode_image_url: 'https://jeffharr.is/dharma/brensilver/artwork/audiodharma-1.jpg',
            podcast_description: 'A clear talk about attention and practice.'
          }
        ],
        '/dharma/burbea/talks.json': [],
        '/dharma/watts/talks.json': []
      })
    }
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=900');
  assert.equal(body.profileUrl, '/dharma/');
  assert.equal(body.talks.length, 1);
  assert.deepEqual(body.talks[0], {
    id: 'brensilver:audiodharma:1',
    corpus: 'brensilver',
    teacher: 'Matthew Brensilver',
    title: 'Attention',
    description: 'A clear talk about attention and practice.',
    url: 'https://jeffharr.is/dharma/brensilver/talks/audiodharma-1/',
    audioUrl: 'https://media.example/attention.mp3',
    image: 'https://jeffharr.is/dharma/brensilver/artwork/audiodharma-1.jpg',
    source: '',
    duration: '',
    publishedAt: null
  });
});

function createAssets(files) {
  return {
    fetch: async (request) => {
      const path = new URL(request.url || request).pathname;
      if (!Object.hasOwn(files, path)) {
        return new Response('Not found', { status: 404 });
      }
      return Response.json(files[path]);
    }
  };
}
