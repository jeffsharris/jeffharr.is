/**
 * X (Twitter) API endpoint for Cloudflare Pages Functions
 * Returns basic profile info only
 *
 * Note: X API requires paid access, so this just returns profile metadata
 */

export async function onRequest(context) {
  const data = {
    handle: '@jeffintime',
    name: 'Jeff Harris',
    profileUrl: 'https://x.com/jeffintime',
    profileImageUrl: '/images/profile.jpg'
  };

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}
