/**
 * GitHub API endpoint for Cloudflare Pages Functions
 * Fetches recent activity for jeffsharris
 */

export async function onRequest(context) {
  const username = 'jeffsharris';

  try {
    // Fetch user profile
    const userResponse = await fetch(`https://api.github.com/users/${username}`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'jeffharr.is'
      }
    });

    if (!userResponse.ok) {
      throw new Error('GitHub API error');
    }

    const userData = await userResponse.json();

    // Fetch recent events
    const eventsResponse = await fetch(`https://api.github.com/users/${username}/events/public?per_page=5`, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'jeffharr.is'
      }
    });

    let recentActivity = null;

    if (eventsResponse.ok) {
      const events = await eventsResponse.json();
      const latestEvent = events[0];

      if (latestEvent) {
        const eventDescriptions = {
          'PushEvent': `Pushed to ${latestEvent.repo?.name}`,
          'CreateEvent': `Created ${latestEvent.payload?.ref_type} in ${latestEvent.repo?.name}`,
          'WatchEvent': `Starred ${latestEvent.repo?.name}`,
          'ForkEvent': `Forked ${latestEvent.repo?.name}`,
          'IssuesEvent': `${latestEvent.payload?.action} issue in ${latestEvent.repo?.name}`,
          'PullRequestEvent': `${latestEvent.payload?.action} PR in ${latestEvent.repo?.name}`,
          'IssueCommentEvent': `Commented on ${latestEvent.repo?.name}`,
        };

        recentActivity = eventDescriptions[latestEvent.type] || `Activity on ${latestEvent.repo?.name}`;
      }
    }

    const data = {
      name: userData.name || username,
      bio: userData.bio || `${userData.public_repos} public repos`,
      recentActivity,
      followers: userData.followers,
      publicRepos: userData.public_repos
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      }
    });

  } catch (error) {
    console.error('GitHub API error:', error);

    // Return fallback data
    return new Response(JSON.stringify({
      name: 'Jeff Harris',
      bio: 'Check out my projects on GitHub',
      recentActivity: null
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
}
