/**
 * Twitter/X API endpoint for Cloudflare Pages Functions
 * Returns a featured tweet (static, since X API is expensive)
 *
 * To update: Change the tweet content below
 */

export async function onRequest(context) {
  // Static featured content - update manually as needed
  // X API is prohibitively expensive for personal sites
  const data = {
    handle: '@jeffintime',
    bio: 'Building things, raising humans, tending my inner and outer worlds.',
    tweet: 'Follow along for thoughts on building, parenting, and the inner life.',
    // You can update this with a specific tweet you want to feature
    featuredTweet: null
  };

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400' // Cache for 24 hours (it's static anyway)
    }
  });
}
