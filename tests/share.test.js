import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUrl, parsePodcastFeed, resolveShareUrl } from '../functions/api/share/podcast-resolver.js';
import { hashText, saveShareItem } from '../functions/api/share/store.js';

const SAMPLE_FEED = `<?xml version="1.0"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Podcast</title>
    <link>https://example.com/podcast</link>
    <description>Useful conversations.</description>
    <itunes:author>Example Host</itunes:author>
    <itunes:image href="https://example.com/art.jpg" />
    <item>
      <title>Episode One</title>
      <guid>episode-1</guid>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
      <itunes:duration>42:10</itunes:duration>
      <description><![CDATA[Listen on <a href="https://www.youtube.com/watch?v=abc123">YouTube</a>.]]></description>
      <enclosure url="https://example.com/one.mp3" type="audio/mpeg" />
    </item>
  </channel>
</rss>`;

test('classifyUrl recognizes supported podcast platforms', () => {
  assert.deepEqual(classifyUrl('https://podcasts.apple.com/us/podcast/show/id1516093381?i=123'), {
    platform: 'apple',
    appleId: '1516093381',
    episodeId: '123'
  });
  assert.equal(classifyUrl('https://overcast.fm/itunes1516093381').appleId, '1516093381');
  assert.equal(classifyUrl('https://open.spotify.com/show/abc').spotifyType, 'show');
  assert.equal(classifyUrl('https://youtu.be/abc123').videoId, 'abc123');
});

test('parsePodcastFeed extracts show and episode metadata', () => {
  const feed = parsePodcastFeed(SAMPLE_FEED, 'https://example.com/feed.xml');
  assert.equal(feed.title, 'Example Podcast');
  assert.equal(feed.imageUrl, 'https://example.com/art.jpg');
  assert.equal(feed.episodes[0].title, 'Episode One');
  assert.equal(feed.episodes[0].audioUrl, 'https://example.com/one.mp3');
  assert.deepEqual(feed.episodes[0].links, ['https://www.youtube.com/watch?v=abc123']);
});

test('saveShareItem uses stable podcast ids for the same identity', async () => {
  const kv = new MemoryKV();
  const item = {
    type: 'podcast_episode',
    sourceUrl: 'https://example.com/one',
    canonicalUrl: 'https://example.com/one',
    identityKey: 'podcast_episode:rss:https://example.com/feed.xml#episode-1',
    title: 'Episode One',
    platforms: {},
    media: {},
    resolution: { confidence: 'high', sources: ['test'], warnings: [] }
  };

  const first = await saveShareItem({ kv, item, sourceUrl: item.sourceUrl });
  const second = await saveShareItem({ kv, item, sourceUrl: item.sourceUrl });
  assert.equal(first.id, second.id);
  assert.equal(second.shareCount, 2);
  assert.match(first.id, /^p_[a-f0-9]{12}$/);
});

test('resolveShareUrl resolves a raw RSS feed URL', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, 'https://example.com/feed.xml');
    return new Response(SAMPLE_FEED, {
      headers: { 'content-type': 'application/rss+xml' }
    });
  };

  const item = await resolveShareUrl('https://example.com/feed.xml', { fetchImpl });
  assert.equal(item.type, 'podcast_show');
  assert.equal(item.title, 'Example Podcast');
  assert.equal(item.platforms.rss.url, 'https://example.com/feed.xml');
});

test('hashText is deterministic', async () => {
  assert.equal(await hashText('same'), await hashText('same'));
});

class MemoryKV {
  constructor() {
    this.map = new Map();
  }

  async get(key, options = {}) {
    const value = this.map.get(key) || null;
    if (options.type === 'json' && value) return JSON.parse(value);
    return value;
  }

  async put(key, value) {
    this.map.set(key, value);
  }

  async list({ prefix = '' } = {}) {
    const keys = [...this.map.keys()]
      .filter((name) => name.startsWith(prefix))
      .map((name) => ({ name }));
    return { keys, list_complete: true };
  }
}
