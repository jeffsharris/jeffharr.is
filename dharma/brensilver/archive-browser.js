(() => {
  const config = window.TALK_ARCHIVE_CONFIG || {};
  const scopes = config.scopes || {};
  const talkList = document.getElementById('talk-list');
  const talkLoader = document.getElementById('talk-loader');
  const archiveSummary = document.getElementById('archive-summary');
  const archiveSearch = document.getElementById('archive-search');
  const archiveSearchStatus = document.getElementById('archive-search-status');
  const starredToggle = document.querySelector('[data-starred-toggle]');
  const copyStatus = document.getElementById('copy-status');
  const feedCopy = document.getElementById('feed-copy');
  const siteBaseUrl = config.siteBaseUrl || '';
  const scopeKeys = Object.keys(scopes);
  const stateByScope = new Map();
  const favoriteStateByKey = new Map();
  const favoriteRequests = new Set();
  const talkBatchSize = 12;
  let currentScope = config.defaultScope || scopeKeys[0] || '';
  let searchQuery = '';
  let starredOnly = false;
  let observer = null;

  function initialStateFromUrl() {
    const params = new URLSearchParams(location.search);
    const requestedScope = params.get('scope') || currentScope;
    return {
      scope: scopes[requestedScope] ? requestedScope : currentScope,
      query: params.get('q') || '',
      starred: params.get('starred') === '1',
    };
  }

  function mediaUrl(url) {
    if (!url) return '';
    if (siteBaseUrl && url.startsWith(siteBaseUrl)) {
      try {
        return new URL(url).pathname;
      } catch (error) {
        return url;
      }
    }
    return url;
  }

  function talkHref(talk) {
    const url = talk.canonical_url || '';
    if (siteBaseUrl && url.startsWith(siteBaseUrl)) {
      try {
        return new URL(url).pathname;
      } catch (error) {
        return url;
      }
    }
    return url || (config.talkPathPrefix || 'talks/') + String(talk.id || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '/';
  }

  function talkSafeId(talk) {
    const href = talkHref(talk);
    try {
      const parsed = new URL(href, location.href);
      return parsed.pathname.match(/\/talks\/([^/]+)\/?$/)?.[1] || '';
    } catch (error) {
      return String(href || '').match(/\/?talks\/([^/]+)\/?$/)?.[1] || '';
    }
  }

  function talkDescription(talk) {
    return talk.podcast_description || talk.short_summary || talk.description || '';
  }

  function talkDate(talk) {
    const value = talk.published_at ? new Date(talk.published_at) : null;
    if (!value || Number.isNaN(value.getTime())) return '';
    return value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  function chapterSearchText(talk) {
    const chapters = Array.isArray(talk.chapters) ? talk.chapters : [];
    return chapters
      .map(chapter => [chapter.title, chapter.description].filter(Boolean).join(' '))
      .join(' ');
  }

  function talkSearchText(talk) {
    if (!talk.__archiveSearchText) {
      talk.__archiveSearchText = normalizeSearch([
        talk.title,
        talkDescription(talk),
        chapterSearchText(talk),
        talk.speaker,
        talk.source,
        talk.venue,
        talk.series,
        ...(Array.isArray(talk.tags) ? talk.tags : []),
      ].filter(Boolean).join(' '));
    }
    return talk.__archiveSearchText;
  }

  function addText(parent, tagName, className, text) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text || '';
    parent.appendChild(el);
    return el;
  }

  function stateFor(key) {
    if (!stateByScope.has(key)) {
      stateByScope.set(key, {
        talks: null,
        filteredTalks: null,
        nextIndex: 0,
        loading: false,
      });
    }
    return stateByScope.get(key);
  }

  function activeTalks(state) {
    return state.filteredTalks || state.talks || [];
  }

  async function applyFilters(state) {
    if (!state.talks) {
      state.filteredTalks = null;
      state.nextIndex = 0;
      return;
    }
    const terms = normalizeSearch(searchQuery).split(/\s+/).filter(Boolean);
    let talks = terms.length
      ? state.talks.filter(talk => terms.every(term => talkSearchText(talk).includes(term)))
      : state.talks;
    if (starredOnly) {
      await ensureFavoriteStates(state.talks);
      talks = talks.filter(isTalkFavorited);
    } else {
      ensureFavoriteStates(state.talks).catch(() => {});
    }
    state.filteredTalks = talks;
    state.nextIndex = 0;
  }

  function updateSearchStatus(key) {
    if (!archiveSearchStatus) return;
    const state = stateFor(key);
    if (!state.talks) {
      archiveSearchStatus.textContent = '';
      return;
    }
    const matches = activeTalks(state).length;
    const total = state.talks.length;
    const noun = matches === 1 ? 'match' : 'matches';
    archiveSearchStatus.textContent = (searchQuery.trim() || starredOnly)
      ? `${matches} of ${total} ${noun}`
      : '';
  }

  function updateSummary(key) {
    if (!archiveSummary) return;
    const scope = scopes[key] || {};
    const state = stateFor(key);
    const count = activeTalks(state).length || Number(scope.count || 0);
    const noun = count === 1 ? 'recording' : 'recordings';
    archiveSummary.textContent = count
      ? `${count} ${noun}. Play talks here or download the audio.`
      : 'Play talks here or download the audio.';
    updateSearchStatus(key);
    updateSubscribeLinks();
  }

  function renderTalkBatch(key = currentScope) {
    const state = stateFor(key);
    if (!state.talks || !talkList || !talkLoader || key !== currentScope) return;
    const fragment = document.createDocumentFragment();
    const talks = activeTalks(state);
    if (!talks.length) {
      talkLoader.textContent = searchQuery.trim() || starredOnly ? 'No recordings match this search.' : 'No recordings are available yet.';
      updateSearchStatus(key);
      updateSubscribeLinks();
      return;
    }
    const end = Math.min(state.nextIndex + talkBatchSize, talks.length);
    for (let index = state.nextIndex; index < end; index += 1) {
      const talk = talks[index];
      const card = document.createElement('article');
      card.className = 'talk-card';

      const img = document.createElement('img');
      img.alt = '';
      img.loading = 'lazy';
      img.src = mediaUrl(talk.episode_image_url || talk.image_url);
      card.appendChild(img);

      const body = document.createElement('div');
      const title = addText(body, 'h3', '', '');
      const titleLink = document.createElement('a');
      titleLink.href = talkHref(talk);
      titleLink.textContent = talk.title || 'Untitled talk';
      title.appendChild(titleLink);

      const meta = document.createElement('div');
      meta.className = 'talk-card-meta';
      [talkDate(talk), talk.duration, talk.source].filter(Boolean).forEach(value => {
        addText(meta, 'span', '', value);
      });
      body.appendChild(meta);
      addText(body, 'p', 'talk-card-description', talkDescription(talk));

      const player = document.createElement('div');
      player.className = 'talk-card-player';
      const itemAudio = document.createElement('audio');
      itemAudio.controls = true;
      itemAudio.preload = 'none';
      itemAudio.src = talk.audio_url || '';
      player.appendChild(itemAudio);
      const actions = document.createElement('div');
      actions.className = 'talk-card-actions';
      const details = document.createElement('a');
      details.className = 'archive-link';
      details.href = talkHref(talk);
      details.textContent = 'Details';
      actions.appendChild(details);
      const download = document.createElement('a');
      download.className = 'download-link';
      download.href = talk.audio_url || '#';
      download.download = '';
      download.textContent = 'Download';
      actions.appendChild(download);
      player.appendChild(actions);
      body.appendChild(player);
      card.appendChild(body);
      fragment.appendChild(card);
    }
    state.nextIndex = end;
    talkList.appendChild(fragment);
    talkLoader.textContent = state.nextIndex >= talks.length
      ? (searchQuery.trim() || starredOnly ? 'End of matches' : 'End of archive')
      : 'Loading more talks...';
    updateSearchStatus(key);
    updateSubscribeLinks();
  }

  async function loadTalkArchive(key = currentScope) {
    if (!talkList || !talkLoader) return;
    const scope = scopes[key];
    if (!scope) return;
    currentScope = key;
    updateControls();
    updateSummary(key);
    const state = stateFor(key);
    talkList.replaceChildren();
    state.nextIndex = 0;
    talkLoader.textContent = 'Loading talks...';
    try {
      if (!state.talks) {
        state.loading = true;
        const response = await fetch(scope.url, { cache: 'no-cache' });
        if (!response.ok) throw new Error('Could not load talk archive');
        const talks = await response.json();
        state.talks = talks
          .filter(talk => talk && talk.audio_url)
          .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
      }
      state.loading = false;
      await applyFilters(state);
      updateSummary(key);
      renderTalkBatch(key);
      if (!observer) {
        observer = new IntersectionObserver(entries => {
          if (entries.some(entry => entry.isIntersecting)) {
            renderTalkBatch();
          }
        }, { rootMargin: '800px 0px' });
        observer.observe(talkLoader);
      }
    } catch (error) {
      state.loading = false;
      if (key === currentScope) {
        talkLoader.textContent = 'Talks could not be loaded right now.';
      }
    }
  }

  function favoriteKeyForTalk(talk) {
    const corpus = config.corpus || location.pathname.match(/^\/dharma\/([^/]+)/)?.[1] || '';
    const id = talkSafeId(talk);
    return corpus && id ? `dharma_talk:${corpus}:${id}` : '';
  }

  function favoritePayloadForTalk(talk) {
    const corpus = config.corpus || location.pathname.match(/^\/dharma\/([^/]+)/)?.[1] || '';
    const id = talkSafeId(talk);
    if (!corpus || !id) return null;
    const key = `dharma_talk:${corpus}:${id}`;
    return { key, ref: { kind: 'dharma_talk', corpus, id } };
  }

  function isTalkFavorited(talk) {
    const key = favoriteKeyForTalk(talk);
    return Boolean(key && favoriteStateByKey.get(key)?.favorited);
  }

  async function ensureFavoriteStates(talks) {
    const refs = talks
      .map(favoritePayloadForTalk)
      .filter(Boolean)
      .filter(ref => !favoriteStateByKey.has(ref.key) && !favoriteRequests.has(ref.key));
    if (!refs.length) return;
    refs.forEach(ref => favoriteRequests.add(ref.key));
    try {
      for (let index = 0; index < refs.length; index += 500) {
        const chunk = refs.slice(index, index + 500);
        const response = await fetch('/api/favorites/state', {
          method: 'POST',
          credentials: 'include',
          headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: JSON.stringify({ refs: chunk })
        });
        if (!response.ok) continue;
        const body = await response.json().catch(() => null);
        for (const state of body?.states || []) {
          if (state?.key) favoriteStateByKey.set(state.key, state);
        }
      }
    } finally {
      refs.forEach(ref => favoriteRequests.delete(ref.key));
    }
  }

  function currentFeedUrl() {
    const endpoint = config.feedEndpoint || '/api/feeds/dharma.xml';
    const url = new URL(endpoint, location.origin);
    url.searchParams.set('corpus', config.corpus || location.pathname.match(/^\/dharma\/([^/]+)/)?.[1] || '');
    url.searchParams.set('scope', currentScope || 'all');
    if (searchQuery.trim()) url.searchParams.set('q', searchQuery.trim());
    if (starredOnly) url.searchParams.set('starred', '1');
    return url.href;
  }

  function updateSubscribeLinks() {
    const feedUrl = currentFeedUrl();
    document.querySelectorAll('[data-subscribe-target]').forEach(link => {
      if (link.dataset.subscribeTarget === 'overcast') {
        link.href = `overcast://x-callback-url/add?url=${encodeURIComponent(feedUrl)}`;
      }
      if (link.dataset.subscribeTarget === 'pocket') {
        link.href = `pktc://subscribe/${feedUrl.replace(/^https?:\/\//, '')}`;
      }
    });
    if (feedCopy) {
      const state = stateFor(currentScope);
      const count = activeTalks(state).length || Number(scopes[currentScope]?.count || 0);
      const noun = count === 1 ? 'recording' : 'recordings';
      feedCopy.textContent = `${count} ${noun} in this RSS feed.`;
    }
  }

  async function copyCurrentFeed(button) {
    const feedUrl = currentFeedUrl();
    try {
      await navigator.clipboard.writeText(feedUrl);
      if (copyStatus) copyStatus.textContent = button?.dataset?.copyMessage || 'RSS URL copied.';
    } catch (error) {
      if (copyStatus) copyStatus.textContent = feedUrl;
    }
  }

  function updateControls() {
    document.querySelectorAll('[data-scope]').forEach(button => {
      const selected = button.dataset.scope === currentScope;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', String(selected));
    });
    if (starredToggle) {
      starredToggle.classList.toggle('is-active', starredOnly);
      starredToggle.setAttribute('aria-pressed', String(starredOnly));
    }
    if (archiveSearch && archiveSearch.value !== searchQuery) {
      archiveSearch.value = searchQuery;
    }
    if (copyStatus) copyStatus.textContent = '';
    updateSubscribeLinks();
  }

  function writeUrl({ replace = true } = {}) {
    const url = new URL(location.href);
    if (currentScope && currentScope !== (config.defaultScope || 'all')) {
      url.searchParams.set('scope', currentScope);
    } else {
      url.searchParams.delete('scope');
    }
    if (searchQuery.trim()) {
      url.searchParams.set('q', searchQuery.trim());
    } else {
      url.searchParams.delete('q');
    }
    if (starredOnly) {
      url.searchParams.set('starred', '1');
    } else {
      url.searchParams.delete('starred');
    }
    history[replace ? 'replaceState' : 'pushState'](null, '', url);
  }

  archiveSearch?.addEventListener('input', () => {
    searchQuery = archiveSearch.value || '';
    writeUrl({ replace: true });
    loadTalkArchive(currentScope);
  });

  document.querySelectorAll('[data-scope]').forEach(button => {
    button.addEventListener('click', () => {
      if (!scopes[button.dataset.scope]) return;
      currentScope = button.dataset.scope;
      writeUrl({ replace: false });
      loadTalkArchive(currentScope);
    });
  });

  starredToggle?.addEventListener('click', () => {
    starredOnly = !starredOnly;
    writeUrl({ replace: false });
    loadTalkArchive(currentScope);
  });

  document.querySelectorAll('[data-copy-current-feed]').forEach(button => {
    button.addEventListener('click', () => copyCurrentFeed(button));
  });

  window.addEventListener('popstate', () => {
    const state = initialStateFromUrl();
    currentScope = state.scope;
    searchQuery = state.query;
    starredOnly = state.starred;
    loadTalkArchive(currentScope);
  });

  window.addEventListener('favorites:changed', event => {
    const state = event.detail?.state;
    if (event.detail?.key && state) favoriteStateByKey.set(event.detail.key, state);
    if (starredOnly) loadTalkArchive(currentScope);
  });

  window.talkArchiveBrowser = {
    selectScope(key) {
      if (scopes[key]) {
        loadTalkArchive(key);
      }
    },
  };

  document.addEventListener('play', event => {
    if (event.target instanceof HTMLAudioElement) {
      document.querySelectorAll('audio').forEach(player => {
        if (player !== event.target) player.pause();
      });
    }
  }, true);

  const initial = initialStateFromUrl();
  currentScope = initial.scope;
  searchQuery = initial.query;
  starredOnly = initial.starred;
  updateControls();
  if (archiveSearch) archiveSearch.value = searchQuery;

  if (currentScope) {
    loadTalkArchive(currentScope);
  } else if (talkLoader) {
    talkLoader.textContent = 'No recordings are available yet.';
  }
})();
