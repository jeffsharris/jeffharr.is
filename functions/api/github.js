/**
 * GitHub API endpoint for Cloudflare Pages Functions
 * Fetches comprehensive activity data for jeffsharris
 */

export async function onRequest(context) {
  const username = 'jeffsharris';
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jeffharr.is'
  };

  try {
    // Fetch user profile, events, and repos in parallel
    const [userResponse, eventsResponse, reposResponse] = await Promise.all([
      fetch(`https://api.github.com/users/${username}`, { headers }),
      fetch(`https://api.github.com/users/${username}/events/public?per_page=15`, { headers }),
      fetch(`https://api.github.com/users/${username}/repos?sort=updated&per_page=10`, { headers })
    ]);

    if (!userResponse.ok) {
      throw new Error('GitHub API error');
    }

    const userData = await userResponse.json();

    // Process events
    let recentEvents = [];
    if (eventsResponse.ok) {
      const events = await eventsResponse.json();

      const eventDescriptions = {
        'PushEvent': (e) => `Pushed ${e.payload?.commits?.length || 1} commit(s)`,
        'CreateEvent': (e) => `Created ${e.payload?.ref_type}${e.payload?.ref ? ` "${e.payload.ref}"` : ''}`,
        'WatchEvent': () => 'Starred',
        'ForkEvent': () => 'Forked',
        'IssuesEvent': (e) => `${capitalize(e.payload?.action)} issue`,
        'PullRequestEvent': (e) => `${capitalize(e.payload?.action)} pull request`,
        'IssueCommentEvent': () => 'Commented on issue',
        'PullRequestReviewEvent': () => 'Reviewed pull request',
        'PullRequestReviewCommentEvent': () => 'Commented on pull request',
        'ReleaseEvent': (e) => `Released ${e.payload?.release?.tag_name || 'new version'}`,
        'DeleteEvent': (e) => `Deleted ${e.payload?.ref_type}`,
      };

      recentEvents = events
        .filter(e => eventDescriptions[e.type])
        .slice(0, 10)
        .map(event => ({
          repo: event.repo?.name?.replace(`${username}/`, '') || event.repo?.name,
          action: eventDescriptions[event.type]?.(event) || 'Activity',
          date: event.created_at,
          type: event.type
        }));
    }

    // Process repos
    let repos = [];
    if (reposResponse.ok) {
      const reposData = await reposResponse.json();
      repos = reposData
        .filter(repo => !repo.fork) // Exclude forks
        .slice(0, 8)
        .map(repo => ({
          name: repo.name,
          description: repo.description,
          language: repo.language,
          stars: repo.stargazers_count,
          url: repo.html_url,
          updatedAt: repo.updated_at
        }));
    }

    const data = {
      name: userData.name || username,
      bio: userData.bio,
      avatarUrl: userData.avatar_url,
      followers: userData.followers,
      following: userData.following,
      publicRepos: userData.public_repos,
      recentEvents,
      repos,
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

    // Return fallback data
    return new Response(JSON.stringify({
      name: 'Jeff Harris',
      bio: 'Check out my projects on GitHub',
      recentEvents: [],
      repos: [],
      profileUrl: `https://github.com/${username}`
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=60'
      }
    });
  }
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}
