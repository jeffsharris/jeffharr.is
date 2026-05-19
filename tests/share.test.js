import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyUrl, normalizeInputUrl, parsePodcastFeed, resolveShareUrl } from '../functions/api/share/podcast-resolver.js';
import { hashText } from '../functions/api/content-library/ids.js';
import { getQueryParamPreservingPlus } from '../functions/share/new.js';
import { renderLoadingPage, renderSharePage } from '../functions/share/render.js';

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
  assert.deepEqual(classifyUrl('https://x.com/alice/status/101?s=20'), {
    platform: 'x',
    username: 'alice',
    tweetId: '101'
  });
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

test('resolveShareUrl builds an X share item with previous and subsequent author posts', async () => {
  const tweets = new Map([
    ['100', {
      id: '100',
      author_id: '1',
      text: 'First thought in the thread',
      created_at: '2026-05-12T10:00:00.000Z',
      conversation_id: '100',
      public_metrics: { reply_count: 2, retweet_count: 3, like_count: 40, quote_count: 1 }
    }],
    ['101', {
      id: '101',
      author_id: '1',
      text: 'Second post with a picture https://t.co/pic',
      created_at: '2026-05-12T10:01:00.000Z',
      conversation_id: '100',
      referenced_tweets: [{ type: 'replied_to', id: '100' }],
      entities: {
        urls: [{
          url: 'https://t.co/pic',
          expanded_url: 'https://x.com/alice/status/101/photo/1'
        }]
      },
      attachments: { media_keys: ['m1'] },
      public_metrics: { reply_count: 1, retweet_count: 2, like_count: 30, quote_count: 0 }
    }],
    ['102', {
      id: '102',
      author_id: '1',
      text: 'Third post continues it',
      created_at: '2026-05-12T10:02:00.000Z',
      conversation_id: '100',
      referenced_tweets: [{ type: 'replied_to', id: '101' }],
      public_metrics: { reply_count: 1, retweet_count: 1, like_count: 20, quote_count: 0 }
    }],
    ['103', {
      id: '103',
      author_id: '1',
      text: 'Final post closes the loop',
      created_at: '2026-05-12T10:03:00.000Z',
      conversation_id: '100',
      referenced_tweets: [{ type: 'replied_to', id: '102' }],
      public_metrics: { reply_count: 0, retweet_count: 1, like_count: 10, quote_count: 0 }
    }],
    ['104', {
      id: '104',
      author_id: '1',
      text: 'Same conversation but not in this branch',
      created_at: '2026-05-12T10:04:00.000Z',
      conversation_id: '100',
      referenced_tweets: [{ type: 'replied_to', id: '100' }],
      public_metrics: { reply_count: 0, retweet_count: 0, like_count: 0, quote_count: 0 }
    }]
  ]);
  const users = [{ id: '1', name: 'Alice Example', username: 'alice', profile_image_url: 'https://img.example/alice.jpg', verified: true }];
  const media = [{ media_key: 'm1', type: 'photo', url: 'https://pbs.twimg.com/media/pic.jpg', alt_text: 'A test image' }];

  const fetchImpl = async (url, options = {}) => {
    assert.equal(options.headers.Authorization, 'Bearer test-x-token');
    const parsed = new URL(String(url));
    if (parsed.pathname === '/2/tweets') {
      const ids = parsed.searchParams.get('ids').split(',');
      return Response.json({
        data: ids.map((id) => tweets.get(id)).filter(Boolean),
        includes: { users, media }
      });
    }
    if (parsed.pathname === '/2/tweets/search/recent') {
      assert.match(parsed.searchParams.get('query'), /conversation_id:100/);
      assert.match(parsed.searchParams.get('query'), /from:alice/);
      return Response.json({
        data: ['103', '104', '102'].map((id) => tweets.get(id)),
        includes: { users, media }
      });
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  const item = await resolveShareUrl('https://x.com/alice/status/101?s=20', {
    fetchImpl,
    env: { X_API_BEARER_TOKEN: 'test-x-token' }
  });

  assert.equal(item.type, 'x_post');
  assert.equal(item.identityKey, 'x_post:101');
  assert.equal(item.canonicalUrl, 'https://x.com/alice/status/101');
  assert.equal(item.imageUrl, 'https://pbs.twimg.com/media/pic.jpg');
  assert.deepEqual(item.x.posts.map((post) => post.id), ['100', '101', '102', '103']);
  assert.equal(item.x.posts[1].isShared, true);
  assert.equal(item.x.posts[1].text, 'Second post with a picture');
  assert.equal(item.x.posts[1].media[0].altText, 'A test image');
  assert.ok(item.resolution.sources.includes('x-conversation-search'));
});

test('renderSharePage renders X posts with native share and rich media', () => {
  const item = {
    id: 'x_abc123',
    type: 'x_post',
    title: 'Alice Example: Second post',
    description: '@alice: Second post with a picture',
    imageUrl: 'https://pbs.twimg.com/media/pic.jpg',
    canonicalUrl: 'https://x.com/alice/status/101',
    x: {
      sharedTweetId: '101',
      posts: [{
        id: '100',
        url: 'https://x.com/alice/status/100',
        text: 'First thought',
        author: { name: 'Alice Example', username: 'alice', profileImageUrl: 'https://img.example/alice.jpg' },
        createdAt: '2026-05-12T10:00:00.000Z',
        metrics: {},
        media: []
      }, {
        id: '101',
        url: 'https://x.com/alice/status/101',
        text: 'Second post with a picture',
        author: { name: 'Alice Example', username: 'alice', profileImageUrl: 'https://img.example/alice.jpg', verified: true },
        createdAt: '2026-05-12T10:01:00.000Z',
        isShared: true,
        metrics: { replies: 1, reposts: 2, likes: 30 },
        media: [{ type: 'photo', url: 'https://pbs.twimg.com/media/pic.jpg', altText: 'A test image' }]
      }]
    }
  };

  const html = renderSharePage(item, 'https://jeffharr.is/share/x_abc123');
  assert.match(html, /data-native-share/);
  assert.match(html, /Share thread/);
  assert.match(html, /x-post--shared/);
  assert.match(html, /https:\/\/pbs\.twimg\.com\/media\/pic\.jpg/);
  assert.match(html, /Open on X/);
});

test('renderLoadingPage uses X-specific loading copy for x.com status URLs', () => {
  const html = renderLoadingPage('https://x.com/alice/status/101', 'https://jeffharr.is/share/new?url=x');
  assert.match(html, /data-share-kind="x"/);
  assert.match(html, /Building X share page/);
  assert.match(html, /Following the reply chain/);
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

test('resolveShareUrl finds a YouTube episode via API search when RSS has no video link', async () => {
  const overcastHtml = `<!doctype html>
    <html>
      <head>
        <title>#51 - Elena Lake &mdash; The Metagame &mdash; Overcast</title>
        <link rel="canonical" href="https://play.prx.org/listen?ge=episode-51&amp;uf=https%3A%2F%2Fexample.com%2Fmetagame.xml">
        <meta name="og:title" content="#51 - Elena Lake &mdash; The Metagame">
      </head>
      <body></body>
    </html>`;
  const metagameFeed = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
      <channel>
        <title>The Metagame</title>
        <link>https://example.com/metagame</link>
        <description>Interviews about agency and meaning.</description>
        <itunes:author>Daniel Kazandjian</itunes:author>
        <item>
          <title><![CDATA[#51 - Elena Lake | Nondual Bodywork, Fascia, and Somatic Healing]]></title>
          <guid>episode-51</guid>
          <pubDate>Mon, 11 May 2026 12:00:00 GMT</pubDate>
          <itunes:duration>1:17:17</itunes:duration>
          <description><![CDATA[Elena Lake is a bodyworker and former mathematician.]]></description>
          <enclosure url="https://example.com/51.mp3" type="audio/mpeg" />
        </item>
      </channel>
    </rss>`;

  const fetchImpl = async (url) => {
    const urlString = String(url);
    if (urlString === 'https://overcast.fm/+AA7GZetHsMs') {
      return new Response(overcastHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    if (urlString === 'https://example.com/metagame.xml') {
      return new Response(metagameFeed, {
        headers: { 'content-type': 'application/rss+xml' }
      });
    }
    if (urlString.startsWith('https://itunes.apple.com/search?')) {
      return Response.json({ results: [] });
    }
    if (urlString.startsWith('https://www.googleapis.com/youtube/v3/search?')) {
      const parsed = new URL(urlString);
      assert.equal(parsed.searchParams.get('key'), 'test-youtube-key');
      return Response.json({
        items: [{
          id: { videoId: 'CcP-I5RG0fg' },
          snippet: {
            title: 'Bodyworker Sees Organs with Her Hands | Elena Lake',
            channelTitle: 'Daniel Kazandjian',
            publishedAt: '2026-05-11T18:00:00Z',
            description: 'Elena Lake is a bodyworker and former mathematician.'
          }
        }, {
          id: { videoId: 'wrong-video' },
          snippet: {
            title: 'Metagame tournament recap',
            channelTitle: 'Card Games',
            publishedAt: '2026-05-11T18:00:00Z',
            description: 'Unrelated card game coverage.'
          }
        }]
      });
    }
    if (urlString.startsWith('https://www.googleapis.com/youtube/v3/videos?')) {
      return Response.json({
        items: [{
          id: 'CcP-I5RG0fg',
          snippet: {
            title: 'Bodyworker Sees Organs with Her Hands | Elena Lake',
            channelTitle: 'Daniel Kazandjian',
            publishedAt: '2026-05-11T18:00:00Z',
            description: 'Elena Lake is a bodyworker and former mathematician.'
          },
          contentDetails: { duration: 'PT1H17M17S' }
        }, {
          id: 'wrong-video',
          snippet: {
            title: 'Metagame tournament recap',
            channelTitle: 'Card Games',
            publishedAt: '2026-05-11T18:00:00Z',
            description: 'Unrelated card game coverage.'
          },
          contentDetails: { duration: 'PT12M' }
        }]
      });
    }
    return new Response('<html></html>', {
      headers: { 'content-type': 'text/html' }
    });
  };

  const item = await resolveShareUrl('https://overcast.fm/+AA7GZetHsMs', {
    fetchImpl,
    env: { YOUTUBE_API_KEY: 'test-youtube-key' }
  });

  assert.equal(item.platforms.youtube.url, 'https://www.youtube.com/watch?v=CcP-I5RG0fg');
  assert.equal(item.platforms.youtube.kind, 'episode');
  assert.equal(item.platforms.youtube.confidence, 'verified');
  assert.ok(item.resolution.sources.includes('youtube-search'));
});

test('resolveShareUrl rejects weak YouTube API search matches', async () => {
  const overcastHtml = `<!doctype html>
    <html>
      <head>
        <title>Key Change: Emma Straub &mdash; Song Exploder &mdash; Overcast</title>
        <link rel="canonical" href="https://play.prx.org/listen?ge=emma-straub&amp;uf=https%3A%2F%2Fexample.com%2Fsong-exploder.xml">
      </head>
      <body></body>
    </html>`;
  const songExploderFeed = `<?xml version="1.0"?>
    <rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
      <channel>
        <title>Song Exploder</title>
        <link>https://songexploder.net</link>
        <description>A show about songs.</description>
        <itunes:author>Hrishikesh Hirway</itunes:author>
        <item>
          <title>Key Change: Emma Straub</title>
          <guid>emma-straub</guid>
          <pubDate>Mon, 11 May 2026 12:00:00 GMT</pubDate>
          <itunes:duration>22:35</itunes:duration>
          <description><![CDATA[My guest today is the bestselling author Emma Straub.]]></description>
          <enclosure url="https://example.com/emma.mp3" type="audio/mpeg" />
        </item>
      </channel>
    </rss>`;

  const fetchImpl = async (url) => {
    const urlString = String(url);
    if (urlString === 'https://overcast.fm/+AA8CzMTP1Rc') {
      return new Response(overcastHtml, {
        headers: { 'content-type': 'text/html' }
      });
    }
    if (urlString === 'https://example.com/song-exploder.xml') {
      return new Response(songExploderFeed, {
        headers: { 'content-type': 'application/rss+xml' }
      });
    }
    if (urlString.startsWith('https://itunes.apple.com/search?')) {
      return Response.json({ results: [] });
    }
    if (urlString.startsWith('https://www.googleapis.com/youtube/v3/search?')) {
      return Response.json({
        items: [{
          id: { videoId: 'weak-video' },
          snippet: {
            title: 'Backlash with Brad Thor and Fred Burton on Stratfor Podcast',
            channelTitle: 'RANE',
            publishedAt: '2026-05-11T18:00:00Z',
            description: 'A different podcast.'
          }
        }]
      });
    }
    if (urlString.startsWith('https://www.googleapis.com/youtube/v3/videos?')) {
      return Response.json({
        items: [{
          id: 'weak-video',
          snippet: {
            title: 'Backlash with Brad Thor and Fred Burton on Stratfor Podcast',
            channelTitle: 'RANE',
            publishedAt: '2026-05-11T18:00:00Z',
            description: 'A different podcast.'
          },
          contentDetails: { duration: 'PT28M' }
        }]
      });
    }
    return new Response('<html></html>', {
      headers: { 'content-type': 'text/html' }
    });
  };

  const item = await resolveShareUrl('https://overcast.fm/+AA8CzMTP1Rc', {
    fetchImpl,
    env: { YOUTUBE_API_KEY: 'test-youtube-key' }
  });

  assert.equal(item.platforms.youtube, undefined);
  assert.equal(item.resolution.sources.includes('youtube-search'), false);
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
