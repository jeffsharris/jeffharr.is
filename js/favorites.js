(function() {
  'use strict';

  const SESSION_URL = '/api/admin/session';
  const STATE_URL = '/api/favorites/state';
  const FAVORITES_URL = '/api/favorites';
  const STAR_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.74 5.55 6.12.89-4.43 4.32 1.05 6.09L12 17.17l-5.48 2.88 1.05-6.09-4.43-4.32 6.12-.89L12 3.2z"></path></svg>';
  const stateByKey = new Map();
  const boundControls = new WeakSet();
  let sessionPromise = null;
  let archiveObserver = null;
  let poemObserver = null;
  let refreshTimer = null;

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
        headers: { accept: 'application/json' }
      })
        .then(async (response) => {
          if (!response.ok) return { authenticated: false };
          const body = await response.json();
          return body?.authenticated ? body : { authenticated: false };
        })
        .catch(() => ({ authenticated: false }));
    }
    return sessionPromise;
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

    const controls = Array.from(root.querySelectorAll('.favorite-button'));
    if (!controls.length) {
      renderSignIn(false);
      return;
    }

    controls.forEach(prepareControl);
    const session = await getSession();
    if (!session.authenticated) {
      controls.forEach((control) => {
        control.hidden = true;
      });
      renderSignIn(true);
      return;
    }

    renderSignIn(false);
    const refs = controls.map(controlRef).filter(Boolean);
    if (!refs.length) return;

    const response = await fetch(STATE_URL, {
      method: 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ refs: refs.map((entry) => entry.payload) })
    }).catch(() => null);

    if (!response?.ok) return;
    const body = await response.json().catch(() => null);
    for (const state of body?.states || []) {
      stateByKey.set(state.key, state);
    }
    controls.forEach(updateControl);
  }

  function prepareControl(control) {
    if (!control.innerHTML.trim()) control.innerHTML = STAR_ICON;
    control.type = 'button';
    control.classList.add('favorite-button');
    if (!control.hasAttribute('aria-label')) control.setAttribute('aria-label', 'Favorite');
    if (!boundControls.has(control)) {
      control.addEventListener('click', onFavoriteClick);
      boundControls.add(control);
    }
  }

  function updateControl(control) {
    const ref = controlRef(control);
    if (!ref) {
      control.hidden = true;
      return;
    }
    const state = stateByKey.get(ref.key) || { favorited: false };
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
    if (!ref || control.disabled) return;

    const current = stateByKey.get(ref.key) || { favorited: false };
    const next = { ...current, key: ref.key, favorited: !current.favorited };
    stateByKey.set(ref.key, next);
    control.disabled = true;
    updateMatchingControls(ref.key);

    const response = await fetch(FAVORITES_URL, {
      method: current.favorited ? 'DELETE' : 'POST',
      credentials: 'include',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json'
      },
      body: JSON.stringify(ref.payload)
    }).catch(() => null);

    if (!response?.ok) {
      stateByKey.set(ref.key, current);
      updateMatchingControls(ref.key);
      return;
    }

    if (next.favorited) {
      const body = await response.json().catch(() => null);
      if (body?.entry) {
        stateByKey.set(ref.key, {
          ...next,
          itemId: body.entry.item_id || body.item?.id || null,
          entryId: body.entry.id || null,
          addedAt: body.entry.added_at || null,
          updatedAt: body.entry.updated_at || null
        });
      }
    }

    updateMatchingControls(ref.key);
  }

  function updateMatchingControls(key) {
    document.querySelectorAll('.favorite-button').forEach((control) => {
      const ref = controlRef(control);
      if (ref?.key === key) updateControl(control);
    });
  }

  function renderSignIn(show) {
    let link = document.querySelector('.admin-sign-in');
    if (!show) {
      if (link) link.hidden = true;
      return;
    }
    if (!link) {
      link = document.createElement('a');
      link.className = 'admin-sign-in';
      link.setAttribute('aria-label', 'Sign in');
      document.body.appendChild(link);
    }
    const redirect = `${location.pathname}${location.search}${location.hash}`;
    link.href = `${SESSION_URL}?redirect=${encodeURIComponent(redirect)}`;
    link.hidden = false;
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
      const player = document.querySelector('.primary-player');
      if (player) {
        const button = createFavoriteButton({
          kind: 'dharma_talk',
          corpus: talkMatch[1],
          id: talkMatch[2],
          auto: 'dharma-detail'
        });
        button.classList.add('favorite-button--compact');
        player.appendChild(button);
      }
    }

    document.querySelectorAll('.talk-card').forEach((card) => injectDharmaCardControl(card, context.corpus));
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

  function injectDharmaCardControl(card, corpus) {
    if (card.querySelector('[data-favorite-kind="dharma_talk"]')) return;
    const link = card.querySelector('.archive-link[href], a[href*="/talks/"]');
    const id = dharmaIdFromHref(link?.getAttribute('href') || '');
    const actions = card.querySelector('.talk-card-actions');
    if (!id || !actions) return;
    const button = createFavoriteButton({
      kind: 'dharma_talk',
      corpus,
      id,
      auto: 'dharma-card'
    });
    button.classList.add('favorite-button--compact');
    actions.appendChild(button);
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
    button.innerHTML = STAR_ICON;
    prepareControl(button);
    return button;
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
      if (!slug || card.querySelector('[data-favorite-kind="poem"]')) return;
      const button = createFavoriteButton({ kind: 'poem', id: slug, auto: 'poem-card' });
      button.classList.add('favorite-button--card');
      card.appendChild(button);
    });

    const actions = document.querySelector('.modal__actions');
    if (actions) {
      let button = actions.querySelector('[data-favorite-auto="poem-modal"]') ||
        actions.querySelector('[data-favorite-kind="poem"]');
      if (!button) {
        button = createFavoriteButton({ kind: 'poem', id: currentPoemSlug(), auto: 'poem-modal' });
        button.classList.add('modal__action-btn', 'favorite-button--compact');
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
    watchUrlChanges();
    refresh(document);
  });
}());
