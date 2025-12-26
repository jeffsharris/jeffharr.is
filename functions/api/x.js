/**
 * X (Twitter) API endpoint for Cloudflare Pages Functions
 * Returns profile info and featured content
 *
 * Note: X API is expensive, so this uses curated content
 * Update the recentTweets array manually to feature specific posts
 */

export async function onRequest(context) {
  // Curated content - update manually as desired
  // These could be quotes, thoughts, or actual tweet text
  const data = {
    handle: '@jeffintime',
    bio: 'Building things, raising humans, tending my inner and outer worlds.',
    // Add notable tweets or thoughts here
    recentTweets: [
      "The best products I've built came from paying attention to what frustrated me, not what I thought would succeed.",
      "Meditation is debugging for the mind.",
      "Fatherhood: where you learn that patience is not a virtue you have, but one you practice."
    ],
    followersCount: null, // Would need API access
    profileUrl: 'https://x.com/jeffintime'
  };

  return new Response(JSON.stringify(data), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400' // Cache for 24 hours
    }
  });
}
