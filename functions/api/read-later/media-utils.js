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

function getYouTubeThumbnailUrl(input) {
  const info = typeof input === 'string' ? getYouTubeInfo(input) : input;
  if (!info?.videoId) return null;
  return `https://img.youtube.com/vi/${encodeURIComponent(info.videoId)}/hqdefault.jpg`;
}

function isYouTubeUrl(url) {
  return Boolean(getYouTubeInfo(url));
}

export function directVideo(url) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return null;
    const extension = parsed.pathname.split('.').pop().toLowerCase();
    const types = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', m3u8: 'application/x-mpegURL', webm: 'video/webm' };
    return types[extension] ? { url: parsed.href, contentType: types[extension], provider: 'direct' } : null;
  } catch { return null; }
}

export function isVideoUrl(url) {
  if (getYouTubeInfo(url) || directVideo(url)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    return (['vimeo.com', 'player.vimeo.com'].includes(host) && /\/\d+/.test(parsed.pathname))
      || (host === 'tiktok.com' && /\/video\/\d+/.test(parsed.pathname))
      || (host === 'dailymotion.com' && parsed.pathname.startsWith('/video/'));
  } catch { return false; }
}

export { getYouTubeInfo, getYouTubeThumbnailUrl, isYouTubeUrl };
