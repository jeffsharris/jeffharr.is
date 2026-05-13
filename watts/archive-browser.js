(() => {
  const config = window.TALK_ARCHIVE_CONFIG || {};
  const feeds = config.feeds || {};
  const talkList = document.getElementById('talk-list');
  const talkLoader = document.getElementById('talk-loader');
  const archiveSummary = document.getElementById('archive-summary');
  const siteBaseUrl = config.siteBaseUrl || '';
  const feedKeys = Object.keys(feeds);
  const stateByFeed = new Map();
  const talkBatchSize = 12;
  let currentFeed = config.defaultFeed || feedKeys[0] || '';
  let observer = null;

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

  function talkDescription(talk) {
    return talk.podcast_description || talk.short_summary || talk.description || '';
  }

  function talkDate(talk) {
    const value = talk.published_at ? new Date(talk.published_at) : null;
    if (!value || Number.isNaN(value.getTime())) return '';
    return value.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function addText(parent, tagName, className, text) {
    const el = document.createElement(tagName);
    if (className) el.className = className;
    el.textContent = text || '';
    parent.appendChild(el);
    return el;
  }

  function stateFor(key) {
    if (!stateByFeed.has(key)) {
      stateByFeed.set(key, {
        talks: null,
        nextIndex: 0,
        loading: false,
      });
    }
    return stateByFeed.get(key);
  }

  function updateSummary(key) {
    if (!archiveSummary) return;
    const feed = feeds[key] || {};
    const count = Number(feed.count || 0);
    const noun = count === 1 ? 'talk' : 'talks';
    archiveSummary.textContent = count
      ? `${count} ${noun}. Play talks here or download the audio.`
      : 'Play talks here or download the audio.';
  }

  function renderTalkBatch(key = currentFeed) {
    const state = stateFor(key);
    if (!state.talks || !talkList || !talkLoader || key !== currentFeed) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(state.nextIndex + talkBatchSize, state.talks.length);
    for (let index = state.nextIndex; index < end; index += 1) {
      const talk = state.talks[index];
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
    talkLoader.textContent = state.nextIndex >= state.talks.length ? 'End of archive' : 'Loading more talks...';
  }

  async function loadTalkArchive(key = currentFeed) {
    if (!talkList || !talkLoader) return;
    const feed = feeds[key];
    if (!feed) return;
    currentFeed = key;
    updateSummary(key);
    const state = stateFor(key);
    talkList.replaceChildren();
    state.nextIndex = 0;
    talkLoader.textContent = state.loading ? 'Loading talks...' : 'Loading talks...';
    try {
      if (!state.talks) {
        state.loading = true;
        const response = await fetch(feed.url);
        if (!response.ok) throw new Error('Could not load talk archive');
        const talks = await response.json();
        state.talks = talks
          .filter(talk => talk && talk.audio_url)
          .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
      }
      state.loading = false;
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
      if (key === currentFeed) {
        talkLoader.textContent = 'Talks could not be loaded right now.';
      }
    }
  }

  window.talkArchiveBrowser = {
    selectFeed(key) {
      if (feeds[key]) {
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

  if (currentFeed) {
    loadTalkArchive(currentFeed);
  } else if (talkLoader) {
    talkLoader.textContent = 'No talks are available yet.';
  }
})();
