(function() {
  'use strict';

  const STORAGE_KEY = 'jeff-admin-presence';
  const SESSION_URL = '/api/admin/session';
  const ADMIN_URL = '/admin/';
  const LOGOUT_URL = '/cdn-cgi/access/logout';

  let session = null;
  let popoverOpen = false;

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
        <span class="admin-presence__label">sign in</span>
      </a>
      <div class="admin-presence__popover" data-admin-popover hidden>
        <p class="admin-presence__eyebrow">Admin</p>
        <p class="admin-presence__message" data-admin-message>Signed out</p>
        <a class="admin-presence__link" data-admin-action href="${signInHref()}">Sign in</a>
      </div>
    `;

    root.addEventListener('click', (event) => {
      const trigger = event.target.closest('[data-admin-toggle]');
      if (!trigger) return;
      event.preventDefault();
      popoverOpen = !popoverOpen;
      setPopover(root, popoverOpen);
    });

    document.addEventListener('click', (event) => {
      if (!popoverOpen || root.contains(event.target)) return;
      popoverOpen = false;
      setPopover(root, false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      popoverOpen = false;
      setPopover(root, false);
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
      label: 'Admin',
      message: `Signed in as ${body.displayName || body.email || 'admin'}`,
      actionLabel: 'Sign out',
      actionHref: LOGOUT_URL,
    });
    document.dispatchEvent(new CustomEvent('jeff-admin:session', { detail: body }));
  }

  function signedOut(root) {
    session = null;
    update(root, {
      state: 'signed-out',
      label: 'sign in',
      message: 'Admin features are locked.',
      actionLabel: 'Sign in with Google',
      actionHref: signInHref(),
    });
    document.dispatchEvent(new CustomEvent('jeff-admin:session', { detail: null }));
  }

  function update(root, { state, label, message, actionLabel, actionHref }) {
    root.dataset.state = state;
    const trigger = root.querySelector('.admin-presence__trigger');
    const labelEl = root.querySelector('.admin-presence__label');
    const messageEl = root.querySelector('[data-admin-message]');
    const actionEl = root.querySelector('[data-admin-action]');

    if (state === 'signed-in') {
      trigger.outerHTML = `
        <button class="admin-presence__trigger" data-admin-toggle type="button" aria-expanded="${popoverOpen ? 'true' : 'false'}">
          <span class="admin-presence__dot" aria-hidden="true"></span>
          <span class="admin-presence__label">${escapeHtml(label || 'Admin')}</span>
        </button>
      `;
    } else if (state === 'checking') {
      trigger.outerHTML = `
        <a class="admin-presence__trigger" data-admin-signin href="${signInHref()}" aria-label="Checking admin session">
          <span class="admin-presence__dot" aria-hidden="true"></span>
          <span class="admin-presence__label">checking</span>
        </a>
      `;
    } else {
      trigger.outerHTML = `
        <a class="admin-presence__trigger" data-admin-signin href="${signInHref()}" aria-label="Sign in as admin">
          <span class="admin-presence__dot" aria-hidden="true"></span>
          <span class="admin-presence__label">${escapeHtml(label || 'sign in')}</span>
        </a>
      `;
    }

    const freshLabel = root.querySelector('.admin-presence__label');
    if (freshLabel && labelEl && state === 'signed-in') {
      freshLabel.textContent = label || 'Admin';
    }
    if (messageEl) messageEl.textContent = message || '';
    if (actionEl) {
      actionEl.textContent = actionLabel || 'Sign in';
      actionEl.href = actionHref || signInHref();
    }
    setPopover(root, popoverOpen && state === 'signed-in');
  }

  function setPopover(root, open) {
    const popover = root.querySelector('[data-admin-popover]');
    const trigger = root.querySelector('[data-admin-toggle]');
    if (!popover) return;
    popover.hidden = !open;
    if (trigger) trigger.setAttribute('aria-expanded', String(open));
  }

  function signInHref() {
    const url = new URL(ADMIN_URL, location.origin);
    url.searchParams.set('returnTo', `${location.pathname}${location.search}${location.hash}`);
    return url.pathname + url.search;
  }

  function injectStyles() {
    if (document.getElementById('admin-presence-styles')) return;
    const style = document.createElement('style');
    style.id = 'admin-presence-styles';
    style.textContent = `
      .admin-presence {
        position: fixed;
        right: max(12px, env(safe-area-inset-right));
        bottom: max(12px, env(safe-area-inset-bottom));
        z-index: 2147483000;
        font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .admin-presence__trigger {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 28px;
        padding: 0 9px;
        border: 1px solid rgba(120, 116, 105, 0.24);
        border-radius: 999px;
        background: color-mix(in srgb, Canvas 78%, transparent);
        color: color-mix(in srgb, CanvasText 72%, transparent);
        box-shadow: 0 8px 28px rgba(0, 0, 0, 0.08);
        cursor: pointer;
        opacity: 0.32;
        text-decoration: none;
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
        transition: opacity 160ms ease, transform 160ms ease, border-color 160ms ease;
      }
      .admin-presence__trigger:hover,
      .admin-presence__trigger:focus-visible,
      .admin-presence[data-state="signed-in"] .admin-presence__trigger {
        opacity: 0.96;
        transform: translateY(-1px);
      }
      .admin-presence__trigger:focus-visible {
        outline: 2px solid color-mix(in srgb, CanvasText 24%, transparent);
        outline-offset: 3px;
      }
      .admin-presence__dot {
        width: 6px;
        height: 6px;
        border-radius: 999px;
        background: color-mix(in srgb, CanvasText 38%, transparent);
      }
      .admin-presence[data-state="checking"] .admin-presence__dot {
        animation: adminPresencePulse 1s ease-in-out infinite;
      }
      .admin-presence[data-state="signed-in"] .admin-presence__dot {
        background: #2d8b68;
        box-shadow: 0 0 0 3px rgba(45, 139, 104, 0.16);
      }
      .admin-presence__label {
        font-weight: 750;
        letter-spacing: 0;
      }
      .admin-presence__popover {
        position: absolute;
        right: 0;
        bottom: calc(100% + 8px);
        width: min(260px, calc(100vw - 24px));
        padding: 13px;
        border: 1px solid rgba(120, 116, 105, 0.22);
        border-radius: 8px;
        background: color-mix(in srgb, Canvas 92%, transparent);
        color: CanvasText;
        box-shadow: 0 18px 54px rgba(0, 0, 0, 0.16);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
      }
      .admin-presence__eyebrow {
        margin: 0 0 4px;
        color: color-mix(in srgb, CanvasText 52%, transparent);
        font-size: 10px;
        font-weight: 850;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      .admin-presence__message {
        margin: 0 0 10px;
        color: color-mix(in srgb, CanvasText 82%, transparent);
        font-size: 13px;
      }
      .admin-presence__link {
        color: CanvasText;
        font-weight: 800;
        text-decoration-thickness: 1px;
        text-underline-offset: 3px;
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
