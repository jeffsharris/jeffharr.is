(function() {
  'use strict';

  const SESSION_URL = '/api/admin/session';
  const LOGOUT_URL = '/cdn-cgi/access/logout';
  const STATE_URL = '/api/public/favorites/state';
  const FAVORITES_URL = '/api/favorites';
  const SIGNED_OUT_NOTICE_KEY = 'jeffharr.adminSignedOut';
  const ADMIN_SESSION_CACHE_KEY = 'jeffharr.adminSession.v1';
  const FAVORITE_STATE_CACHE_KEY = 'jeffharr.favoriteStates.v1';
  const ADMIN_SESSION_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
  const FAVORITE_STATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
  const STAR_OUTLINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.74 5.55 6.12.89-4.43 4.32 1.05 6.09L12 17.17l-5.48 2.88 1.05-6.09-4.43-4.32 6.12-.89L12 3.2z"></path></svg>';
  const STAR_FILLED_SVG = STAR_OUTLINE_SVG;
  const stateByKey = new Map();
  const boundControls = new WeakSet();
  let sessionPromise = null;
  let archiveObserver = null;
  let poemObserver = null;
  let refreshTimer = null;
  let toastTimer = null;
  let favoriteEditAuthorized = false;

  function ready(callback) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', callback, { once: true });
    } else {
      callback();
    }
  }

  function getSession() {
    if (!sessionPromise) {
      sessionPromise = fetch(SESSION_URL, {
        credentials: 'include',
        headers: {
          accept: 'application/json',
          'x-requested-with': 'XMLHttpRequest'
        }
      })
        .then(async (response) => {
          if (!response.ok) {
            clearWarmCaches();
            return { authenticated: false };
          }
          const body = await response.json();
          if (body?.authenticated) {
            rememberAdminSession(body);
            return body;
          }
          clearWarmCaches();
          return { authenticated: false };
        })
        .catch(() => cachedAdminSession() || { authenticated: false });
    }
    return sessionPromise;
  }

  function readLocalJson(key) {
    try {
      const value = localStorage.getItem(key);
      return value ? JSON.parse(value) : null;
    } catch {
      return null;
    }
  }

  function writeLocalJson(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Storage is only a warm-start hint; authenticated APIs remain authoritative.
    }
  }

  function removeLocalValue(key) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Ignore storage failures.
    }
  }

  function cachedAdminSession() {
    const cached = readLocalJson(ADMIN_SESSION_CACHE_KEY);
    if (!cached?.authenticated || cached.expiresAt <= Date.now()) {
      removeLocalValue(ADMIN_SESSION_CACHE_KEY);
      return null;
    }
    return {
      authenticated: true,
      cached: true,
      email: cached.email || null
    };
  }

  function rememberAdminSession(session) {
    writeLocalJson(ADMIN_SESSION_CACHE_KEY, {
      authenticated: true,
      email: session.email || session.user?.email || null,
      expiresAt: Date.now() + ADMIN_SESSION_CACHE_TTL_MS
    });
  }

  function clearWarmCaches() {
    removeLocalValue(ADMIN_SESSION_CACHE_KEY);
    removeLocalValue(FAVORITE_STATE_CACHE_KEY);
  }

  function cachedFavoriteStates() {
    const cached = readLocalJson(FAVORITE_STATE_CACHE_KEY);
    if (!cached?.states || cached.expiresAt <= Date.now()) {
      removeLocalValue(FAVORITE_STATE_CACHE_KEY);
      return {};
    }
    return cached.states;
  }

  function compactFavoriteState(state) {
    return {
      key: state.key,
      itemId: state.itemId || null,
      canonicalKey: state.canonicalKey || null,
      favorited: Boolean(state.favorited),
      entryId: state.entryId || null,
      addedAt: state.addedAt || null,
      updatedAt: state.updatedAt || null
    };
  }

  function rememberFavoriteStates(states) {
    if (!states?.length) return;
    const next = cachedFavoriteStates();
    for (const state of states) {
      if (!state?.key) continue;
      next[state.key] = compactFavoriteState(state);
    }
    writeLocalJson(FAVORITE_STATE_CACHE_KEY, {
      expiresAt: Date.now() + FAVORITE_STATE_CACHE_TTL_MS,
      states: next
    });
  }

  function hydrateFavoriteStates(refs) {
    const cached = cachedFavoriteStates();
    for (const ref of refs) {
      const state = cached[ref.key];
      if (state) stateByKey.set(ref.key, state);
    }
  }

  function controlRef(control) {
    const itemId = control.dataset.favoriteItemId || '';
    if (itemId) {
      return {
        key: `item:${itemId}`,
        payload: { key: `item:${itemId}`, itemId }
      };
    }

    const kind = control.dataset.favoriteKind || '';
    if (kind === 'share_page') {
      const slug = control.dataset.favoriteShareSlug || control.dataset.favoriteId || '';
      if (!slug) return null;
      return {
        key: `share_page:${slug}`,
        payload: { key: `share_page:${slug}`, ref: { kind: 'share_page', slug } }
      };
    }

    if (kind === 'dharma_talk') {
      const corpus = control.dataset.favoriteCorpus || '';
      const id = control.dataset.favoriteDharmaId || control.dataset.favoriteId || '';
      if (!corpus || !id) return null;
      return {
        key: `dharma_talk:${corpus}:${id}`,
        payload: { key: `dharma_talk:${corpus}:${id}`, ref: { kind: 'dharma_talk', corpus, id } }
      };
    }

    if (kind === 'poem') {
      const slug = control.dataset.favoritePoemSlug || control.dataset.favoriteId || '';
      if (!slug) return null;
      return {
        key: `poem:${slug}`,
        payload: { key: `poem:${slug}`, ref: { kind: 'poem', slug } }
      };
    }

    return null;
  }

  async function refresh(root = document) {
    injectDharmaControls();
    observeDharmaArchive();
    injectPoemControls();
    observePoems();
    const buttons = Array.from(root.querySelectorAll('.favorite-button'));
    const indicators = Array.from(root.querySelectorAll('.favorite-indicator'));
    const controls = buttons.concat(indicators);
    if (!controls.length) {
      const session = await getSession();
      renderAdminMarker(session.authenticated ? 'sign-out' : '');
      return;
    }

    buttons.forEach(prepareButton);
    indicators.forEach(prepareIndicator);
    const refs = controls.map(controlRef).filter(Boolean);
    hydrateFavoriteStates(refs);
    controls.forEach(updateControl);
    if (cachedAdminSession()) renderAdminMarker('sign-out');
    if (refs.length) await refreshFavoriteStates(refs, controls);

    const session = await getSession();
    favoriteEditAuthorized = Boolean(session.authenticated);
    if (favoriteEditAuthorized) {
      renderAdminMarker('sign-out');
    } else {
      clearWarmCaches();
      renderAdminMarker('sign-in');
    }
    controls.forEach(updateControl);
  }

  async function refreshFavoriteStates(refs, controls) {
    const response = await fetch(STATE_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: JSON.stringify({ refs: refs.map((entry) => entry.payload) })
    }).catch(() => null);

    if (!response?.ok) return;
    const body = await response.json().catch(() => null);
    for (const state of body?.states || []) {
      stateByKey.set(state.key, state);
    }
    rememberFavoriteStates(body?.states || []);
    controls.forEach(updateControl);
  }

  function prepareButton(control) {
    if (!control.innerHTML.trim()) control.innerHTML = STAR_OUTLINE_SVG;
    control.type = 'button';
    control.classList.add('favorite-button');
    if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', 'Favorite');
    if (!boundControls.has(control)) {
      control.addEventListener('click', onFavoriteClick);
      boundControls.add(control);
    }
  }

  function prepareIndicator(control) {
    if (!control.innerHTML.trim()) control.innerHTML = STAR_FILLED_SVG;
    control.setAttribute('aria-hidden', 'true');
  }

  function updateControl(control) {
    const ref = controlRef(control);
    if (!ref) {
      control.hidden = true;
      return;
    }
    const state = stateByKey.get(ref.key) || { favorited: false };

    if (control.classList.contains('favorite-indicator')) {
      control.hidden = !state.favorited;
      return;
    }

    if (!favoriteEditAuthorized) {
      control.hidden = !state.favorited;
      control.disabled = true;
      control.dataset.favoriteReadOnly = 'true';
      control.classList.toggle('is-favorited', Boolean(state.favorited));
      control.setAttribute('aria-pressed', String(Boolean(state.favorited)));
      control.setAttribute('aria-label', state.favorited ? 'Favorited' : 'Favorite');
      control.title = state.favorited ? 'Favorited' : 'Favorite';
      return;
    }

    delete control.dataset.favoriteReadOnly;
    control.hidden = false;
    control.disabled = false;
    control.classList.toggle('is-favorited', Boolean(state.favorited));
    control.setAttribute('aria-pressed', String(Boolean(state.favorited)));
    control.setAttribute('aria-label', state.favorited ? 'Remove favorite' : 'Favorite');
    control.title = state.favorited ? 'Remove favorite' : 'Favorite';
  }

  async function onFavoriteClick(event) {
    event.preventDefault();
    event.stopPropagation();

    const control = event.currentTarget;
    const ref = controlRef(control);
    if (!ref || control.disabled || !favoriteEditAuthorized) return;

    const current = stateByKey.get(ref.key) || { favorited: false };
    const next = { ...current, key: ref.key, favorited: !current.favorited };
    stateByKey.set(ref.key, next);
    rememberFavoriteStates([next]);
    control.disabled = true;
    updateMatchingControls(ref.key);

    const response = await fetch(FAVORITES_URL, {
      method: current.favorited ? 'DELETE' : 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'x-requested-with': 'XMLHttpRequest'
      },
      body: JSON.stringify(ref.payload)
    }).catch(() => null);

    if (!response?.ok) {
      stateByKey.set(ref.key, current);
      rememberFavoriteStates([{ ...current, key: ref.key }]);
      updateMatchingControls(ref.key);
      return;
    }

    let finalState = next;
    if (next.favorited) {
      const body = await response.json().catch(() => null);
      if (body?.entry) {
        finalState = {
          ...next,
          itemId: body.entry.item_id || body.item?.id || null,
          entryId: body.entry.id || null,
          addedAt: body.entry.added_at || null,
          updatedAt: body.entry.updated_at || null
        };
        stateByKey.set(ref.key, finalState);
      }
    }

    rememberFavoriteStates([finalState]);
    updateMatchingControls(ref.key);
    window.dispatchEvent(new CustomEvent('favorites:changed', {
      detail: { key: ref.key, state: finalState }
    }));
  }

  function updateMatchingControls(key) {
    document.querySelectorAll('.favorite-button, .favorite-indicator').forEach((control) => {
      const ref = controlRef(control);
      if (ref?.key === key) updateControl(control);
    });
  }

  function renderAdminMarker() {
    const link = document.querySelector('.admin-sign-in');
    if (link) link.hidden = true;
  }

  function onAdminSignOut(event) {
    event.preventDefault();
    const link = event.currentTarget;
    link.setAttribute('aria-busy', 'true');
    link.hidden = false;
    sessionPromise = Promise.resolve({ authenticated: false });
    favoriteEditAuthorized = false;
    stateByKey.clear();
    clearWarmCaches();
    document.querySelectorAll('.favorite-button, .favorite-indicator').forEach((control) => {
      control.hidden = true;
    });
    rememberSignedOutNotice();
    showAdminToast(
      'Signed out',
      'Cloudflare is clearing your admin session. When you return, the site will be back in viewer mode.'
    );
    setTimeout(() => {
      location.assign(LOGOUT_URL);
    }, 950);
  }

  function currentPath() {
    return `${location.pathname}${location.search}${location.hash}`;
  }

  function rememberSignedOutNotice() {
    try {
      sessionStorage.setItem(SIGNED_OUT_NOTICE_KEY, '1');
    } catch {
      // Ignore storage failures; logout still works.
    }
  }

  function showStoredSignedOutNotice() {
    let shouldShow = false;
    try {
      shouldShow = sessionStorage.getItem(SIGNED_OUT_NOTICE_KEY) === '1';
      if (shouldShow) sessionStorage.removeItem(SIGNED_OUT_NOTICE_KEY);
    } catch {
      shouldShow = false;
    }
    if (!shouldShow) return;
    showAdminToast(
      'Signed out',
      'You are browsing as a viewer. Cloudflare may take a few seconds to finish revoking old Access tokens.'
    );
  }

  function showAdminToast(title, message) {
    let toast = document.querySelector('.admin-auth-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'admin-auth-toast';
      toast.setAttribute('role', 'status');
      toast.setAttribute('aria-live', 'polite');
      toast.innerHTML = '<strong></strong><span></span>';
      document.body.appendChild(toast);
    }
    toast.querySelector('strong').textContent = title;
    toast.querySelector('span').textContent = message;
    toast.hidden = false;
    requestAnimationFrame(() => {
      toast.classList.add('is-visible');
    });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => {
        if (!toast.classList.contains('is-visible')) toast.hidden = true;
      }, 220);
    }, 6200);
  }

  function scheduleRefresh(root = document) {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => refresh(root), 50);
  }

  function dharmaContext() {
    const match = location.pathname.match(/^\/dharma\/([^/]+)(?:\/|$)/);
    return match ? { corpus: match[1] } : null;
  }

  function injectDharmaControls() {
    const context = dharmaContext();
    if (!context) return;

    const talkMatch = location.pathname.match(/^\/dharma\/([^/]+)\/talks\/([^/]+)\/?$/);
    if (talkMatch && !document.querySelector('[data-favorite-auto="dharma-detail"]')) {
      const meta = document.querySelector('.hero .meta') || document.querySelector('.meta');
      if (meta) {
        const button = createFavoriteButton({
          kind: 'dharma_talk',
          corpus: talkMatch[1],
          id: talkMatch[2],
          auto: 'dharma-detail'
        });
        meta.appendChild(button);
      }
    }

    document.querySelectorAll('.talk-card').forEach((card) => injectDharmaCardIndicator(card, context.corpus));
  }

  function observeDharmaArchive() {
    const context = dharmaContext();
    const list = document.getElementById('talk-list');
    if (!context || !list || archiveObserver) return;

    archiveObserver = new MutationObserver(() => {
      injectDharmaControls();
      scheduleRefresh(list);
    });
    archiveObserver.observe(list, { childList: true, subtree: true });
  }

  function injectDharmaCardIndicator(card, corpus) {
    if (card.querySelector('.favorite-indicator[data-favorite-kind="dharma_talk"]')) return;
    const titleLink = card.querySelector('h3 a[href*="/talks/"], h2 a[href*="/talks/"]') ||
      card.querySelector('h3 a, h2 a');
    const link = titleLink || card.querySelector('.archive-link[href], a[href*="/talks/"]');
    const id = dharmaIdFromHref(link?.getAttribute('href') || '');
    if (!id) return;
    const heading = titleLink?.closest('h2, h3') || card.querySelector('h3') || card.querySelector('h2');
    if (!heading) return;
    const indicator = createFavoriteIndicator({
      kind: 'dharma_talk',
      corpus,
      id,
      variant: 'title-prefix'
    });
    const target = titleLink && heading.contains(titleLink) ? titleLink : heading.firstChild;
    heading.insertBefore(indicator, target);
    heading.insertBefore(document.createTextNode(' '), target);
  }

  function createFavoriteButton({ kind, corpus, id, auto }) {
    const button = document.createElement('button');
    button.className = 'favorite-button';
    button.hidden = true;
    button.dataset.favoriteKind = kind;
    button.dataset.favoriteId = id;
    if (corpus) button.dataset.favoriteCorpus = corpus;
    if (kind === 'dharma_talk') button.dataset.favoriteDharmaId = id;
    if (kind === 'poem') button.dataset.favoritePoemSlug = id;
    if (auto) button.dataset.favoriteAuto = auto;
    button.setAttribute('aria-label', 'Favorite');
    button.innerHTML = STAR_OUTLINE_SVG;
    prepareButton(button);
    return button;
  }

  function createFavoriteIndicator({ kind, corpus, id, variant }) {
    const span = document.createElement('span');
    span.className = 'favorite-indicator' + (variant ? ` favorite-indicator--${variant}` : '');
    span.hidden = true;
    span.dataset.favoriteKind = kind;
    span.dataset.favoriteId = id;
    if (corpus) span.dataset.favoriteCorpus = corpus;
    if (kind === 'dharma_talk') span.dataset.favoriteDharmaId = id;
    if (kind === 'poem') span.dataset.favoritePoemSlug = id;
    span.innerHTML = STAR_FILLED_SVG;
    prepareIndicator(span);
    return span;
  }

  function dharmaIdFromHref(href) {
    try {
      const parsed = new URL(href, location.href);
      const match = parsed.pathname.match(/\/talks\/([^/]+)\/?$/);
      return match?.[1] || '';
    } catch {
      const match = href.match(/\/?talks\/([^/]+)\/?$/);
      return match?.[1] || '';
    }
  }

  function injectPoemControls() {
    if (!location.pathname.startsWith('/poems')) return;

    document.querySelectorAll('.card[data-slug]').forEach((card) => {
      const slug = card.dataset.slug || '';
      if (!slug) return;
      if (card.querySelector('.favorite-indicator[data-favorite-kind="poem"]')) return;
      const indicator = createFavoriteIndicator({ kind: 'poem', id: slug, variant: 'corner' });
      card.appendChild(indicator);
    });

    const actions = document.querySelector('.modal__actions');
    if (actions) {
      let button = actions.querySelector('[data-favorite-auto="poem-modal"]') ||
        actions.querySelector('[data-favorite-kind="poem"]');
      if (!button) {
        button = createFavoriteButton({ kind: 'poem', id: currentPoemSlug(), auto: 'poem-modal' });
        actions.insertBefore(button, actions.querySelector('.modal__feedback') || null);
      }
      button.dataset.favoriteAuto = 'poem-modal';
      button.dataset.favoritePoemSlug = currentPoemSlug();
      button.dataset.favoriteId = currentPoemSlug();
    }
  }

  function observePoems() {
    if (!location.pathname.startsWith('/poems') || poemObserver) return;
    const grid = document.getElementById('grid');
    if (!grid) return;

    poemObserver = new MutationObserver(() => {
      injectPoemControls();
      scheduleRefresh(document);
    });
    poemObserver.observe(grid, { childList: true, subtree: true });
  }

  function currentPoemSlug() {
    return new URLSearchParams(location.search).get('poem') || location.hash.replace('#', '').trim() || '';
  }

  function watchUrlChanges() {
    if (window.__favoritesHistoryPatched) return;
    window.__favoritesHistoryPatched = true;
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function(...args) {
        const result = original.apply(this, args);
        window.dispatchEvent(new Event('favorites:urlchange'));
        return result;
      };
    }
    window.addEventListener('popstate', () => {
      window.dispatchEvent(new Event('favorites:urlchange'));
    });
    window.addEventListener('favorites:urlchange', () => {
      injectPoemControls();
      scheduleRefresh(document);
    });
  }

  window.Favorites = {
    refresh,
    scheduleRefresh
  };

  ready(() => {
    showStoredSignedOutNotice();
    watchUrlChanges();
    refresh(document);
  });
}());
