/**
 * GitHub API endpoint for Cloudflare Pages Functions
 * Fetches recent commits across all repositories
 */

export async function onRequest(context) {
  const username = 'jeffsharris';
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jeffharr.is'
  };

  try {
    // Fetch recent events (includes push events with commits)
    const eventsResponse = await fetch(
      `https://api.github.com/users/${username}/events/public?per_page=100`,
      { headers }
    );

    if (!eventsResponse.ok) {
      throw new Error('GitHub API error');
    }

    const events = await eventsResponse.json();

    // Extract commits from PushEvents
    const commits = [];
    for (const event of events) {
      if (event.type === 'PushEvent' && event.payload?.commits) {
        const repoName = event.repo?.name?.replace(`${username}/`, '') || event.repo?.name;

        for (const commit of event.payload.commits) {
          // Skip merge commits and commits by others
          if (commit.author?.email && commit.message && !commit.message.startsWith('Merge')) {
            commits.push({
              repo: repoName,
              message: commit.message.split('\n')[0], // First line only
              sha: commit.sha?.substring(0, 7),
              date: event.created_at,
              url: `https://github.com/${event.repo?.name}/commit/${commit.sha}`
            });
          }
        }
      }
    }

    // Limit to most recent 20 commits
    const recentCommits = commits.slice(0, 20);

    const data = {
      commits: recentCommits,
      profileUrl: `https://github.com/${username}`
    };

    return new Response(JSON.stringify(data), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      }
    });

  } catch (error) {
    console.error('GitHub API error:', error);

    return new Response(JSON.stringify({
      commits: [],
      profileUrl: `https://github.com/${username}`
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
}
