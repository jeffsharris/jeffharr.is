import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUrl, normalizeInputUrl, parsePodcastFeed, resolveShareUrl } from '../functions/api/share/podcast-resolver.js';
import { hashText, saveShareItem } from '../functions/api/share/store.js';
import { getQueryParamPreservingPlus } from '../functions/share/new.js';

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
  assert.equal(classifyUrl('https://overcast.fm/+AA8CzMTP1Rc').overcastId, 'AA8CzMTP1Rc');
  assert.equal(classifyUrl('https://itunes.apple.com/us/app/overcast-podcast-player/id888422857?mt=8').platform, 'unknown');
  assert.equal(classifyUrl('https://open.spotify.com/show/abc').spotifyType, 'show');
  assert.equal(classifyUrl('https://youtu.be/abc123').videoId, 'abc123');
});

test('share new URL parsing preserves Overcast plus links', () => {
  const url = new URL('https://jeffharr.is/share/new?url=https://overcast.fm/+AA8CzMTP1Rc');
  assert.equal(getQueryParamPreservingPlus(url, 'url'), 'https://overcast.fm/+AA8CzMTP1Rc');
  assert.equal(normalizeInputUrl('https://overcast.fm/ AA8CzMTP1Rc'), 'https://overcast.fm/+AA8CzMTP1Rc');
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

test('resolveShareUrl resolves an Overcast short episode URL through the feed', async () => {
  const overcastHtml = `<!doctype html>
    <html>
      <head>
        <title>Episode One &mdash; Example Podcast &mdash; Overcast</title>
        <link rel="canonical" href="https://play.prx.org/listen?ge=episode-1&amp;uf=https%3A%2F%2Fexample.com%2Ffeed.xml">
        <meta name="og:title" content="Episode One &mdash; Example Podcast">
        <meta name="og:description" content="Shared from Overcast">
        <meta name="og:image" content="https://example.com/episode.jpg">
      </head>
      <body></body>
    </html>`;

  const fetchImpl = async (url) => {
    const urlString = String(url);
    if (urlString === 'https://overcast.fm/+AA8CzMTP1Rc') {
      return new Response(overcastHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    if (urlString === 'https://example.com/feed.xml') {
      return new Response(SAMPLE_FEED, {
        headers: { 'content-type': 'application/rss+xml' }
      });
    }
    if (urlString.startsWith('https://itunes.apple.com/search?')) {
      return Response.json({
        results: [{
          collectionId: 123,
          collectionName: 'Example Podcast',
          collectionViewUrl: 'https://podcasts.apple.com/us/podcast/example/id123',
          feedUrl: 'https://example.com/feed.xml'
        }]
      });
    }
    return new Response('<html></html>', {
      headers: { 'content-type': 'text/html' }
    });
  };

  const item = await resolveShareUrl('https://overcast.fm/+AA8CzMTP1Rc', { fetchImpl });
  assert.equal(item.type, 'podcast_episode');
  assert.equal(item.title, 'Episode One');
  assert.equal(item.media.episodeGuid, 'episode-1');
  assert.equal(item.platforms.overcast.url, 'https://overcast.fm/+AA8CzMTP1Rc');
  assert.equal(item.platforms.rss.url, 'https://example.com/feed.xml');
  assert.equal(item.platforms.apple.url, 'https://podcasts.apple.com/us/podcast/example/id123');
});

test('resolveShareUrl enriches Overcast episode links from page app links', async () => {
  const overcastHtml = `<!doctype html>
    <html>
      <head>
        <title>Episode One &mdash; Example Podcast &mdash; Overcast</title>
        <link rel="canonical" href="https://example.com/episode-one">
        <meta name="og:title" content="Episode One &mdash; Example Podcast">
        <meta name="og:description" content="Shared from Overcast">
        <meta name="og:image" content="https://example.com/episode.jpg">
      </head>
      <body>
        <a href="https://podcasts.apple.com/podcast/id123">Apple Podcasts</a>
        <a href="https://itunes.apple.com/us/app/overcast-podcast-player/id888422857?mt=8">Overcast app</a>
        <a href="https://feeds.example.com/example">Feed</a>
      </body>
    </html>`;

  const pcstHtml = `<!doctype html>
    <html>
      <body>
        <a href="https://open.spotify.com/show/spotify-show">Spotify</a>
        <a href="https://pca.st/itunes/123">Pocket Casts</a>
      </body>
    </html>`;
  const spotifyHtml = `<!doctype html>
    <html>
      <body>
        <a href="/episode/spotify-episode"><h4 data-testid="episodeTitle">Episode One</h4></a>
      </body>
    </html>`;

  const fetchImpl = async (url) => {
    const urlString = String(url);
    if (urlString === 'https://overcast.fm/+AA8CzMTP1Rc') {
      return new Response(overcastHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    if (urlString === 'https://feeds.example.com/example') {
      return new Response(SAMPLE_FEED, {
        headers: { 'content-type': 'application/rss+xml' }
      });
    }
    if (urlString.startsWith('https://itunes.apple.com/search?')) {
      return Response.json({ results: [] });
    }
    if (urlString === 'https://pc.st/123') {
      return new Response(pcstHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    if (urlString === 'https://open.spotify.com/show/spotify-show') {
      return new Response(spotifyHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    return new Response('<html></html>', {
      headers: { 'content-type': 'text/html' }
    });
  };

  const item = await resolveShareUrl('https://overcast.fm/+AA8CzMTP1Rc', { fetchImpl });
  assert.equal(item.type, 'podcast_episode');
  assert.equal(item.title, 'Episode One');
  assert.equal(item.platforms.apple.url, 'https://podcasts.apple.com/podcast/id123');
  assert.equal(item.platforms.spotify.url, 'https://open.spotify.com/episode/spotify-episode');
  assert.equal(item.platforms.spotify.kind, 'episode');
  assert.equal(item.platforms.pocketCasts.url, 'https://pca.st/itunes/123');
  assert.equal(item.platforms.overcast.url, 'https://overcast.fm/+AA8CzMTP1Rc');
  assert.equal(item.platforms.rss.url, 'https://feeds.example.com/example');
});

test('resolveShareUrl matches YouTube podcast videos by title fragments and upgrades episode links', async () => {
  const metagameFeed = `<?xml version="1.0"?>
  <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
    <channel>
      <title>The Metagame</title>
      <link>https://example.com/metagame</link>
      <description>Interviews about agency and meaning.</description>
      <itunes:author>Daniel Kazandjian</itunes:author>
      <itunes:image href="https://example.com/metagame.jpg" />
      <item>
        <title><![CDATA[#51 - Elena Lake | Nondual Bodywork, Fascia, and Somatic Healing]]></title>
        <guid>episode-51</guid>
        <pubDate>Mon, 11 May 2026 12:00:00 GMT</pubDate>
        <itunes:duration>1:05:00</itunes:duration>
        <description><![CDATA[Elena Lake is a bodyworker and former mathematician.]]></description>
        <enclosure url="https://example.com/51.mp3" type="audio/mpeg" />
      </item>
    </channel>
  </rss>`;
  const pcstHtml = `<!doctype html>
    <html><body><a href="https://open.spotify.com/show/spotify-show">Spotify</a></body></html>`;

  const fetchImpl = async (url, options = {}) => {
    const urlString = String(url);
    if (urlString.startsWith('https://www.youtube.com/oembed?')) {
      return Response.json({
        title: 'Bodyworker Sees Organs with Her Hands | Elena Lake',
        author_name: 'Daniel Kazandjian',
        thumbnail_url: 'https://img.youtube.com/vi/CcP-I5RG0fg/hqdefault.jpg'
      });
    }
    if (urlString.startsWith('https://itunes.apple.com/search?')) {
      return Response.json({
        results: [{
          collectionId: 1634047573,
          collectionName: 'The Metagame',
          artistName: 'Daniel Kazandjian',
          collectionViewUrl: 'https://podcasts.apple.com/us/podcast/the-metagame/id1634047573',
          feedUrl: 'https://example.com/metagame.xml'
        }]
      });
    }
    if (urlString === 'https://example.com/metagame.xml') {
      return new Response(metagameFeed, {
        headers: { 'content-type': 'application/rss+xml' }
      });
    }
    if (urlString === 'https://pc.st/1634047573') {
      return new Response(pcstHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    if (urlString.startsWith('https://itunes.apple.com/lookup?')) {
      return Response.json({
        results: [{
          collectionId: 1634047573,
          collectionName: 'The Metagame',
          wrapperType: 'track'
        }, {
          wrapperType: 'podcastEpisode',
          kind: 'podcast-episode',
          trackName: '#51 - Elena Lake | Nondual Bodywork, Fascia, and Somatic Healing',
          trackViewUrl: 'https://podcasts.apple.com/us/podcast/elena-lake/id1634047573?i=1000000000051',
          releaseDate: '2026-05-11T12:00:00Z',
          trackTimeMillis: 3_900_000
        }]
      });
    }
    if (urlString === 'https://accounts.spotify.com/api/token' && options.method === 'POST') {
      return Response.json({ access_token: 'spotify-token' });
    }
    if (urlString.startsWith('https://api.spotify.com/v1/shows/spotify-show/episodes?')) {
      return Response.json({
        items: [{
          id: 'spotify-episode',
          name: '#51 - Elena Lake | Nondual Bodywork, Fascia, and Somatic Healing',
          release_date: '2026-05-11',
          duration_ms: 3_900_000,
          external_urls: { spotify: 'https://open.spotify.com/episode/spotify-episode' }
        }],
        next: null
      });
    }
    return new Response('<html></html>', {
      headers: { 'content-type': 'text/html' }
    });
  };

  const item = await resolveShareUrl('https://www.youtube.com/watch?v=CcP-I5RG0fg', {
    fetchImpl,
    env: {
      SPOTIFY_CLIENT_ID: 'id',
      SPOTIFY_CLIENT_SECRET: 'secret'
    }
  });

  assert.equal(item.type, 'podcast_episode');
  assert.equal(item.title, '#51 - Elena Lake | Nondual Bodywork, Fascia, and Somatic Healing');
  assert.equal(item.podcast.title, 'The Metagame');
  assert.equal(item.platforms.youtube.url, 'https://www.youtube.com/watch?v=CcP-I5RG0fg');
  assert.equal(item.platforms.apple.url, 'https://podcasts.apple.com/us/podcast/elena-lake/id1634047573?i=1000000000051');
  assert.equal(item.platforms.apple.kind, 'episode');
  assert.equal(item.platforms.spotify.url, 'https://open.spotify.com/episode/spotify-episode');
  assert.equal(item.platforms.spotify.kind, 'episode');
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
