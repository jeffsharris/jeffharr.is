import { authenticateAdminRequest } from '../api/lib/admin-auth.js';

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const returnTo = safeReturnTo(url.searchParams.get('returnTo'), url);

  let auth;
  try {
    auth = await authenticateAdminRequest(request, env);
  } catch {
    auth = {
      authenticated: false,
      status: 500,
      error: 'session_check_failed',
    };
  }

  if (!auth.authenticated) {
    if (auth.error === 'not_authenticated') {
      return Response.redirect(adminSessionUrl(url, returnTo), 302);
    }
    return htmlResponse(renderSignedOut(returnTo, auth.error), auth.status || 401);
  }

  return htmlResponse(renderSignedIn(returnTo), 200);
}

function safeReturnTo(value, currentUrl) {
  if (!value) return '/';
  try {
    const target = new URL(value, currentUrl.origin);
    if (target.origin !== currentUrl.origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function adminSessionUrl(currentUrl, returnTo) {
  const target = new URL('/api/admin/session', currentUrl.origin);
  target.searchParams.set('redirect', returnTo || '/');
  return target.href;
}

function htmlResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex',
    },
  });
}

function renderSignedIn(returnTo) {
  const destination = JSON.stringify(returnTo);
  return documentShell({
    title: 'Admin Unlocked',
    body: `
      <main class="auth-card auth-card--ready">
        <p class="eyebrow">Admin</p>
        <h1>Signed in</h1>
        <p class="copy">Admin UI is unlocked.</p>
        <a class="button" href="${escapeAttribute(returnTo)}">Return to site</a>
      </main>
      <script>
        try { localStorage.setItem('jeff-admin-presence', '1'); } catch {}
        setTimeout(() => { location.replace(${destination}); }, 650);
      </script>
    `,
  });
}

function renderSignedOut(returnTo, error) {
  const message = error === 'access_not_configured'
    ? 'Cloudflare Access is not configured for this deployment yet.'
    : 'Cloudflare Access could not verify an admin session.';
  return documentShell({
    title: 'Admin Sign In',
    body: `
      <main class="auth-card">
        <p class="eyebrow">Admin</p>
        <h1>Sign in unavailable</h1>
        <p class="copy">${escapeHtml(message)}</p>
        <p class="note">Cloudflare Access needs to be configured for the admin routes before admin features can unlock.</p>
        <a class="button" href="${escapeAttribute(returnTo)}">Return to site</a>
      </main>
    `,
  });
}

function documentShell({ title, body }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>${escapeHtml(title)} | Jeff Harris</title>
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
  <meta name="apple-mobile-web-app-title" content="Jeff Harris">
  <style>
    :root {
      color-scheme: light dark;
      --bg: #f8f6f3;
      --panel: #ffffff;
      --ink: #24231f;
      --muted: #68645c;
      --line: rgba(36, 35, 31, 0.12);
      --accent: #285f52;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #111816;
        --panel: #18211e;
        --ink: #eef2ed;
        --muted: #aeb8b1;
        --line: rgba(238, 242, 237, 0.14);
        --accent: #8ec7ba;
      }
    }
    * { box-sizing: border-box; }
    body {
      min-height: 100vh;
      margin: 0;
      display: grid;
      place-items: center;
      padding: 24px;
      background: var(--bg);
      color: var(--ink);
      font: 16px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .auth-card {
      width: min(100%, 420px);
      padding: 30px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: color-mix(in srgb, var(--panel) 88%, var(--bg));
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.12);
    }
    .eyebrow {
      margin: 0 0 8px;
      color: var(--accent);
      font-size: 0.75rem;
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0 0 10px;
      font-size: clamp(2rem, 8vw, 3.4rem);
      line-height: 0.96;
      letter-spacing: 0;
    }
    .copy, .note {
      color: var(--muted);
    }
    code {
      color: var(--ink);
      overflow-wrap: anywhere;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 42px;
      margin-top: 12px;
      padding: 0 16px;
      border-radius: 6px;
      background: var(--accent);
      color: #ffffff;
      font-weight: 800;
      text-decoration: none;
    }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, '&#39;');
}
