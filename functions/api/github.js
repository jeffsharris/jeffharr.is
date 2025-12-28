/**
 * GitHub API endpoint for Cloudflare Pages Functions
 * Fetches recent commits across all public repositories
 */

export async function onRequest(context) {
  const username = 'jeffsharris';
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jeffharr.is'
  };

  try {
    // First, get user's recently updated repos
    const reposResponse = await fetch(
      `https://api.github.com/users/${username}/repos?sort=pushed&per_page=10`,
      { headers }
    );

    if (!reposResponse.ok) {
      throw new Error('GitHub API error fetching repos');
    }

    const repos = await reposResponse.json();

    // Fetch commits from each repo in parallel
    const commitPromises = repos.slice(0, 5).map(async (repo) => {
      try {
        const commitsResponse = await fetch(
          `https://api.github.com/repos/${username}/${repo.name}/commits?per_page=10`,
          { headers }
        );

        if (!commitsResponse.ok) return [];

        const commits = await commitsResponse.json();
        return commits.map(c => ({
          repo: repo.name,
          message: c.commit?.message?.split('\n')[0] || 'No message',
          sha: c.sha?.substring(0, 7),
          date: c.commit?.author?.date,
          url: c.html_url
        }));
      } catch {
        return [];
      }
    });

    const allCommitArrays = await Promise.all(commitPromises);
    const allCommits = allCommitArrays.flat();

    // Sort by date (newest first) and take top 20
    allCommits.sort((a, b) => new Date(b.date) - new Date(a.date));
    const recentCommits = allCommits.slice(0, 20);

    return new Response(JSON.stringify({
      commits: recentCommits,
      profileUrl: `https://github.com/${username}`
    }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=300'
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
