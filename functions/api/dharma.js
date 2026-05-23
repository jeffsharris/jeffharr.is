const CORPORA = [
  { slug: 'brensilver', name: 'Matthew Brensilver' },
  { slug: 'burbea', name: 'Rob Burbea' },
  { slug: 'watts', name: 'Alan Watts' }
];

export async function onRequest(context) {
  try {
    const groups = await Promise.all(CORPORA.map((corpus) => loadCorpusTalks(context, corpus)));
    const talks = groups.flat().filter((talk) => talk.audioUrl && talk.url);
    return jsonResponse({
      talks: shuffle(talks).slice(0, 10),
      profileUrl: '/dharma/'
    }, {
      cache: 'public, max-age=900'
    });
  } catch (error) {
    console.error('Dharma sidebar API error:', error);
    return jsonResponse({ talks: [], profileUrl: '/dharma/' }, {
      cache: 'public, max-age=300'
    });
  }
}

async function loadCorpusTalks(context, corpus) {
  const response = await context.env.ASSETS.fetch(new URL(`/dharma/${corpus.slug}/talks.json`, context.request.url));
  if (!response.ok) return [];
  const talks = await response.json().catch(() => []);
  if (!Array.isArray(talks)) return [];
  return talks.map((talk) => normalizeTalk(talk, corpus)).filter(Boolean);
}

function normalizeTalk(talk, corpus) {
  const url = talk.canonical_url || '';
  const title = talk.title || 'Untitled talk';
  const description = talk.podcast_description || talk.short_summary || talk.description || '';
  return {
    id: `${corpus.slug}:${talk.id || talk.source_id || title}`,
    corpus: corpus.slug,
    teacher: talk.speaker || corpus.name,
    title,
    description: compactText(description, 180),
    url,
    audioUrl: talk.audio_url || '',
    image: talk.episode_image_url || talk.image_url || '',
    source: talk.source || '',
    duration: talk.duration || '',
    publishedAt: talk.published_at || null
  };
}

function compactText(value, maxLength) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 3).trim()}...`;
}

function shuffle(items = []) {
  const array = [...items];
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [array[index], array[swap]] = [array[swap], array[index]];
  }
  return array;
}

function jsonResponse(body, { cache }) {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache
    }
  });
}
