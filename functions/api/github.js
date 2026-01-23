/**
 * GitHub API endpoint for Cloudflare Pages Functions
 * Fetches recent commits across all public repositories
 */

import { createLogger, formatError } from './lib/logger.js';

export async function onRequest(context) {
  const logger = createLogger({ request: context.request, source: 'github' });
  const log = logger.log;
  const username = 'jeffsharris';
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jeffharr.is'
  };
  const FETCH_TIMEOUT_MS = 8000;

  try {
    // First, get user's recently updated repos
    const reposResponse = await fetchWithTimeout(
      `https://api.github.com/users/${username}/repos?sort=pushed&per_page=10`,
      { headers },
      FETCH_TIMEOUT_MS
    );

    if (!reposResponse.ok) {
      log('error', 'github_repos_failed', {
        stage: 'repos_fetch',
        username,
        status: reposResponse.status
      });
      throw new Error('GitHub API error fetching repos');
    }

    const repos = await reposResponse.json();

    // Fetch commits from each repo in parallel
    const commitPromises = repos.slice(0, 5).map(async (repo) => {
      try {
        const commitsResponse = await fetchWithTimeout(
          `https://api.github.com/repos/${username}/${repo.name}/commits?per_page=10`,
          { headers },
          FETCH_TIMEOUT_MS
        );

        if (!commitsResponse.ok) {
          log('warn', 'github_commits_failed', {
            stage: 'commits_fetch',
            username,
            repo: repo.name,
            status: commitsResponse.status
          });
          return [];
        }

        const commits = await commitsResponse.json();
        return commits.map(c => ({
          repo: repo.name,
          message: c.commit?.message?.split('\n')[0] || 'No message',
          sha: c.sha?.substring(0, 7),
          date: c.commit?.author?.date,
          url: c.html_url
        }));
      } catch (error) {
        log('error', 'github_commits_error', {
          stage: 'commits_fetch',
          username,
          repo: repo.name,
          ...formatError(error)
        });
        return [];
      }
    });

    const allCommitArrays = await Promise.all(commitPromises);
    const allCommits = allCommitArrays.flat();

    // Sort by date (newest first) and take top 20
    allCommits.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
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
    log('error', 'github_request_failed', {
      stage: 'request',
      username,
      ...formatError(error)
    });

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

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}
