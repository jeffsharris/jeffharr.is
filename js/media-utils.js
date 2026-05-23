(function() {
  'use strict';

  const YOUTUBE_THUMB_BASE = 'https://i.ytimg.com/vi/';
  const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;
  const YOUTUBE_HOSTS = ['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'];

  function getYouTubeInfo(url) {
    if (typeof url !== 'string') return null;
    const parsed = tryParseUrl(url) || tryParseUrl(`https://${url}`);
    if (!parsed) return null;

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!YOUTUBE_HOSTS.includes(hostname)) return null;

    const segments = parsed.pathname.split('/').filter(Boolean);
    let videoId = null;
    let isShort = false;

    if (hostname === 'youtu.be') {
      videoId = extractYouTubeId(segments[0]);
    } else {
      const first = segments[0] || '';
      if (first === 'shorts') {
        isShort = true;
        videoId = extractYouTubeId(segments[1]);
      } else if (first === 'embed' || first === 'v' || first === 'live') {
        videoId = extractYouTubeId(segments[1]);
      } else {
        videoId = extractYouTubeId(parsed.searchParams.get('v'));
      }
    }

    if (!videoId) return null;
    return { type: 'youtube', videoId, isShort };
  }

  function getYouTubeThumbnailUrl(infoOrUrl) {
    const info = typeof infoOrUrl === 'string' ? getYouTubeInfo(infoOrUrl) : infoOrUrl;
    return info?.videoId ? `${YOUTUBE_THUMB_BASE}${info.videoId}/hqdefault.jpg` : null;
  }

  function tryParseUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function extractYouTubeId(value) {
    if (!value) return null;
    const candidate = String(value).split(/[?#&/]/)[0];
    return YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
  }

  window.JeffMedia = {
    getYouTubeInfo,
    getYouTubeThumbnailUrl
  };
})();
