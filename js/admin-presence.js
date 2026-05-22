(function() {
  'use strict';

  const STORAGE_KEY = 'jeff-admin-presence';
  const SESSION_URL = '/api/admin/session';
  const LOGOUT_URL = '/cdn-cgi/access/logout';

  let session = null;

  function init() {
    injectStyles();
    const root = renderShell();
    document.body.appendChild(root);
    update(root, { state: 'signed-out' });

    const shouldCheck = hasAdminHint();
    if (shouldCheck) {
      checkSession(root);
    } else {
      window.setTimeout(() => checkSession(root, { quiet: true }), 900);
    }

    window.jeffAdmin = {
      refresh: () => checkSession(root),
      getSession: () => session,
      isSignedIn: () => Boolean(session && session.admin),
    };
  }

  function hasAdminHint() {
    try {
      if (localStorage.getItem(STORAGE_KEY) === '1') return true;
    } catch {}
    return new URLSearchParams(location.search).has('admin');
  }

  function renderShell() {
    const root = document.createElement('div');
    root.className = 'admin-presence';
    root.setAttribute('data-admin-presence', '');
    root.innerHTML = `
      <a class="admin-presence__trigger" data-admin-signin href="${signInHref()}" aria-label="Sign in as admin">
        <span class="admin-presence__dot" aria-hidden="true"></span>
      </a>
    `;

    root.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-admin-signout]');
      if (!trigger) return;
      event.preventDefault();
      signOut(root);
    });

    return root;
  }

  async function checkSession(root, { quiet = false } = {}) {
    if (!quiet) update(root, { state: 'checking' });

    try {
      const response = await fetch(SESSION_URL, {
        cache: 'no-store',
        credentials: 'include',
        redirect: 'manual',
        headers: { accept: 'application/json' },
      });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok || !contentType.includes('application/json')) {
        signedOut(root);
        return;
      }

      const body = await response.json();
      if (body && body.authenticated && body.admin) {
        signedIn(root, body);
        return;
      }
      signedOut(root);
    } catch {
      signedOut(root);
    }
  }

  function signedIn(root, body) {
    session = body;
    try {
      localStorage.setItem(STORAGE_KEY, '1');
    } catch {}
    update(root, {
      state: 'signed-in',
      label: 'Sign out',
    });
    document.dispatchEvent(new CustomEvent('jeff-admin:session', { detail: body }));
  }

  function signedOut(root) {
    session = null;
    update(root, {
      state: 'signed-out',
      label: 'Sign in as admin',
    });
    document.dispatchEvent(new CustomEvent('jeff-admin:session', { detail: null }));
  }

  function signOut(root) {
    session = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem('jeffharr.adminSession.v1');
      localStorage.removeItem('jeffharr.favoriteStates.v1');
    } catch {}
    update(root, {
      state: 'signed-out',
      label: 'Signing out',
    });
    document.dispatchEvent(new CustomEvent('jeff-admin:session', { detail: null }));
    location.assign(LOGOUT_URL);
  }

  function update(root, { state, label }) {
    root.dataset.state = state;
    const trigger = root.querySelector('.admin-presence__trigger');

    if (state === 'signed-in') {
      trigger.outerHTML = `
        <a class="admin-presence__trigger" data-admin-signout href="${LOGOUT_URL}" aria-label="${escapeHtml(label || 'Sign out')}" title="${escapeHtml(label || 'Sign out')}">
          <span class="admin-presence__dot" aria-hidden="true"></span>
        </a>
      `;
    } else if (state === 'checking') {
      trigger.outerHTML = `
        <a class="admin-presence__trigger" data-admin-signin href="${signInHref()}" aria-label="Checking admin session" title="Checking admin session">
          <span class="admin-presence__dot" aria-hidden="true"></span>
        </a>
      `;
    } else {
      trigger.outerHTML = `
        <a class="admin-presence__trigger" data-admin-signin href="${signInHref()}" aria-label="${escapeHtml(label || 'Sign in as admin')}" title="${escapeHtml(label || 'Sign in as admin')}">
          <span class="admin-presence__dot" aria-hidden="true"></span>
        </a>
      `;
    }
  }

  function signInHref() {
    const url = new URL(SESSION_URL, location.origin);
    url.searchParams.set('redirect', `${location.pathname}${location.search}${location.hash}`);
    return url.pathname + url.search;
  }

  function injectStyles() {
    if (document.getElementById('admin-presence-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-presence-styles';
    style.textContent = `
      .admin-presence {
        position: fixed;
        right: max(6px, env(safe-area-inset-right));
        bottom: max(6px, env(safe-area-inset-bottom));
        z-index: 2147483000;
        font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .admin-presence__trigger {
        display: grid;
        place-items: center;
        width: 34px;
        height: 34px;
        padding: 0;
        border: 0;
        border-radius: 999px;
        background: transparent;
        color: color-mix(in srgb, CanvasText 52%, transparent);
        box-shadow: none;
        cursor: pointer;
        opacity: 0.16;
        text-decoration: none;
        transition: opacity 160ms ease, transform 160ms ease;
        -webkit-tap-highlight-color: transparent;
      }
      .admin-presence__trigger:hover,
      .admin-presence__trigger:focus-visible {
        opacity: 0.42;
        transform: translateY(-1px);
      }
      .admin-presence__trigger:focus-visible {
        outline: 2px solid color-mix(in srgb, CanvasText 24%, transparent);
        outline-offset: 3px;
      }
      .admin-presence__dot {
        width: 4px;
        height: 4px;
        border-radius: 999px;
        background: currentColor;
      }
      .admin-presence[data-state="checking"] .admin-presence__dot {
        animation: adminPresencePulse 1s ease-in-out infinite;
      }
      .admin-presence[data-state="signed-in"] .admin-presence__trigger {
        opacity: 0.26;
      }
      .admin-presence[data-state="signed-in"] .admin-presence__dot {
        background: #2d8b68;
      }
      @keyframes adminPresencePulse {
        0%, 100% { opacity: 0.38; }
        50% { opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
