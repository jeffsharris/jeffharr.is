export function safeXVideoUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'video.twimg.com' &&
      !url.username && !url.password && !url.port && /\.mp4$/i.test(url.pathname)
      ? url.href : '';
  } catch { return ''; }
}

export function selectXVideoVariant(media) {
  if (!['video', 'animated_gif'].includes(media?.type)) return null;
  const variants = (Array.isArray(media.variants) ? media.variants : [])
    .filter(variant => variant?.content_type === 'video/mp4' && safeXVideoUrl(variant.url))
    .sort((a, b) => (Number(b.bit_rate) || 0) - (Number(a.bit_rate) || 0));
  return variants[0] ? { videoUrl: safeXVideoUrl(variants[0].url), videoType: 'video/mp4' } : null;
}
