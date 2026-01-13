const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com'
]);

const VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

function extractVideoId(value) {
  if (!value) return null;
  const candidate = String(value).split(/[?#&/]/)[0];
  return VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
}

function getYouTubeInfo(url) {
  if (typeof url !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (!YOUTUBE_HOSTS.has(hostname)) {
    return null;
  }

  const segments = parsed.pathname.split('/').filter(Boolean);
  let videoId = null;
  let isShort = false;

  if (hostname === 'youtu.be') {
    videoId = extractVideoId(segments[0]);
  } else {
    const first = segments[0] || '';
    if (first === 'shorts') {
      isShort = true;
      videoId = extractVideoId(segments[1]);
    } else if (first === 'embed' || first === 'v' || first === 'live') {
      videoId = extractVideoId(segments[1]);
    } else {
      videoId = extractVideoId(parsed.searchParams.get('v'));
    }
  }

  if (!videoId) return null;
  return { type: 'youtube', videoId, isShort };
}

function isYouTubeUrl(url) {
  return Boolean(getYouTubeInfo(url));
}

export { getYouTubeInfo, isYouTubeUrl };
