function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildHtml({ code, state, error, errorDescription, redirectUri }) {
  const heading = error ? 'Authorization Error' : 'Authorization Received';
  const message = error
    ? 'Check the error details below and retry the OAuth flow.'
    : 'Copy the authorization code below and return to the CLI.';

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Schwab OAuth Callback</title>
    <style>
      :root {
        color-scheme: light;
      }
      body {
        font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
        margin: 0;
        padding: 32px;
        background: #f7f6f2;
        color: #1d1a14;
      }
      main {
        max-width: 720px;
        margin: 0 auto;
        background: #fffdf8;
        border: 1px solid #e5e1d7;
        border-radius: 12px;
        padding: 24px 28px;
        box-shadow: 0 10px 30px rgba(29, 26, 20, 0.08);
      }
      h1 {
        margin: 0 0 8px;
        font-size: 24px;
        letter-spacing: -0.02em;
      }
      p {
        margin: 8px 0;
        line-height: 1.5;
      }
      .field {
        margin-top: 16px;
      }
      .label {
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: #6b645a;
      }
      .value {
        margin-top: 6px;
        padding: 12px;
        background: #f0ece3;
        border-radius: 8px;
        font-family: 'SFMono-Regular', Menlo, Consolas, 'Liberation Mono', monospace;
        word-break: break-all;
      }
      .actions {
        margin-top: 16px;
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      button {
        border: none;
        border-radius: 999px;
        padding: 10px 16px;
        font-weight: 600;
        background: #1d1a14;
        color: #fffdf8;
        cursor: pointer;
      }
      button.secondary {
        background: #e7e2d8;
        color: #1d1a14;
      }
      .note {
        margin-top: 16px;
        font-size: 13px;
        color: #6b645a;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(message)}</p>
      <div class="field">
        <div class="label">code</div>
        <div class="value" id="code">${escapeHtml(code)}</div>
      </div>
      <div class="field">
        <div class="label">state</div>
        <div class="value" id="state">${escapeHtml(state)}</div>
      </div>
      <div class="field">
        <div class="label">error</div>
        <div class="value" id="error">${escapeHtml(error)}</div>
      </div>
      <div class="field">
        <div class="label">error_description</div>
        <div class="value" id="error_description">${escapeHtml(errorDescription)}</div>
      </div>
      <div class="actions">
        <button type="button" id="copy-code">Copy code</button>
        <button type="button" class="secondary" id="copy-url">Copy redirect URL</button>
      </div>
      <p class="note">Redirect URI: ${escapeHtml(redirectUri)}</p>
    </main>
    <script>
      (function () {
        function copyText(text) {
          if (!text) return;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).catch(function () {});
            return;
          }
          var textarea = document.createElement('textarea');
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          try { document.execCommand('copy'); } catch (e) {}
          document.body.removeChild(textarea);
        }

        var code = document.getElementById('code').textContent;
        var url = ${JSON.stringify(redirectUri)};
        document.getElementById('copy-code').addEventListener('click', function () {
          copyText(code);
        });
        document.getElementById('copy-url').addEventListener('click', function () {
          copyText(url);
        });
      })();
    </script>
  </body>
</html>`;
}

export async function onRequest({ request }) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const error = url.searchParams.get('error') || '';
  const errorDescription = url.searchParams.get('error_description') || '';

  const html = buildHtml({
    code,
    state,
    error,
    errorDescription,
    redirectUri: url.origin + url.pathname
  });

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}
