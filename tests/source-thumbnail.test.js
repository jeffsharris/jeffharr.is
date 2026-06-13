import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ensureSourceThumbnail,
  getSourceThumbnailUrl,
  pickReaderThumbnailUrl,
  resolveSourceThumbnail
} from '../functions/api/read-later/source-thumbnail.js';
import { getYouTubeThumbnailUrl } from '../functions/api/read-later/media-utils.js';
import { createMockReadLaterStores } from './mock-read-later-stores.js';

test('getYouTubeThumbnailUrl derives stable thumbnails from YouTube links', () => {
  assert.equal(
    getYouTubeThumbnailUrl('https://www.youtube.com/watch?v=CcP-I5RG0fg'),
    'https://img.youtube.com/vi/CcP-I5RG0fg/hqdefault.jpg'
  );
  assert.equal(
    getYouTubeThumbnailUrl('https://youtu.be/CcP-I5RG0fg?si=test'),
    'https://img.youtube.com/vi/CcP-I5RG0fg/hqdefault.jpg'
  );
});

test('pickReaderThumbnailUrl prefers cover image then inline media', () => {
  assert.equal(
    pickReaderThumbnailUrl({
      coverImageUrl: 'https://pbs.twimg.com/media/cover.jpg',
      imageUrls: ['https://pbs.twimg.com/media/inline.jpg']
    }),
    'https://pbs.twimg.com/media/cover.jpg'
  );
  assert.equal(
    pickReaderThumbnailUrl({
      imageUrls: ['https://pbs.twimg.com/media/inline.jpg']
    }),
    'https://pbs.twimg.com/media/inline.jpg'
  );
});

test('getSourceThumbnailUrl falls back from reader media to YouTube thumbnail', () => {
  assert.equal(
    getSourceThumbnailUrl(
      { url: 'https://www.youtube.com/watch?v=CcP-I5RG0fg' },
      { imageUrls: ['https://example.com/source.jpg'] }
    ),
    'https://example.com/source.jpg'
  );
  assert.equal(
    getSourceThumbnailUrl({ url: 'https://www.youtube.com/watch?v=CcP-I5RG0fg' }),
    'https://img.youtube.com/vi/CcP-I5RG0fg/hqdefault.jpg'
  );
});

test('resolveSourceThumbnail follows t.co redirects to YouTube thumbnails', async () => {
  const result = await resolveSourceThumbnail(
    { url: 'https://t.co/fMiK5ha6Qp?ssr=true' },
    null,
    {
      fetchImpl: async () => ({
        url: 'https://www.youtube.com/watch?v=v1wZwxY3CMg&feature=youtu.be'
      })
    }
  );

  assert.equal(result.thumbnailUrl, 'https://img.youtube.com/vi/v1wZwxY3CMg/hqdefault.jpg');
  assert.equal(result.sourceKind, 'youtube');
  assert.equal(result.sourceUrl, 'https://www.youtube.com/watch?v=v1wZwxY3CMg&feature=youtu.be');
});

test('ensureSourceThumbnail saves source thumbnail through asset store', async () => {
  const item = {
    id: 'CcP-I5RG0fg',
    url: 'https://www.youtube.com/watch?v=CcP-I5RG0fg',
    title: 'Video'
  };
  const { assetStore } = createMockReadLaterStores({
    items: {
      'CcP-I5RG0fg': item
    }
  });

  const result = await ensureSourceThumbnail({ item, assetStore });

  assert.equal(result.saved, true);
  assert.equal(result.thumbnailUrl, 'https://img.youtube.com/vi/CcP-I5RG0fg/hqdefault.jpg');
  assert.equal(item.thumbnailUrl, 'https://img.youtube.com/vi/CcP-I5RG0fg/hqdefault.jpg');
});
