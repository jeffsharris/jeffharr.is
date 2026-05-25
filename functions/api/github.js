/**
 * GitHub API endpoint for Cloudflare Pages Functions
 * Fetches recent commits and the public contributions calendar.
 */

import { createLogger, formatError } from './lib/logger.js';

const FETCH_TIMEOUT_MS = 8000;

export async function onRequest(context) {
  const logger = createLogger({ request: context.request, source: 'github' });
  const log = logger.log;
  const username = 'jeffsharris';
  const apiHeaders = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'jeffharr.is'
  };

  const [commitsResult, contributionsResult] = await Promise.allSettled([
    fetchRecentCommits(username, apiHeaders, log),
    fetchContributions(username, log)
  ]);

  const commits = commitsResult.status === 'fulfilled' ? commitsResult.value : [];
  const contributions = contributionsResult.status === 'fulfilled' ? contributionsResult.value : null;

  return new Response(JSON.stringify({
    commits,
    contributions,
    profileUrl: `https://github.com/${username}`
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300'
    }
  });
}

async function fetchRecentCommits(username, headers, log) {
  try {
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
      return [];
    }

    const repos = await reposResponse.json();

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

    allCommits.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    return allCommits.slice(0, 20);
  } catch (error) {
    log('error', 'github_commits_request_failed', {
      stage: 'commits_request',
      username,
      ...formatError(error)
    });
    return [];
  }
}

async function fetchContributions(username, log) {
  try {
    const response = await fetchWithTimeout(
      `https://github.com/users/${encodeURIComponent(username)}/contributions`,
      {
        headers: {
          'Accept': 'text/html',
          'User-Agent': 'jeffharr.is'
        }
      },
      FETCH_TIMEOUT_MS
    );

    if (!response.ok) {
      log('warn', 'github_contributions_failed', {
        stage: 'contributions_fetch',
        username,
        status: response.status
      });
      return null;
    }

    const html = await response.text();
    return parseContributionsHtml(html);
  } catch (error) {
    log('error', 'github_contributions_error', {
      stage: 'contributions_fetch',
      username,
      ...formatError(error)
    });
    return null;
  }
}

function parseContributionsHtml(html) {
  const days = [];
  const dayRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*data-level="(\d+)"/g;
  let match;
  while ((match = dayRegex.exec(html)) !== null) {
    days.push({ date: match[1], level: Number(match[2]) });
  }

  if (!days.length) return null;

  days.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let totalContributions = null;
  const totalMatch = html.match(/contribution-activity-description[^>]*>\s*([\d,]+)\s*contributions?/i);
  if (totalMatch) {
    const parsed = Number(totalMatch[1].replace(/,/g, ''));
    if (Number.isFinite(parsed)) totalContributions = parsed;
  }

  return {
    days,
    totalContributions,
    rangeStart: days[0].date,
    rangeEnd: days[days.length - 1].date
  };
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

export { parseContributionsHtml };
