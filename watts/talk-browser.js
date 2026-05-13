(() => {
  const config = window.TALK_PAGE || {};
  const audio = document.getElementById('audio');
  const talkList = document.getElementById('talk-list');
  const talkLoader = document.getElementById('talk-loader');
  const currentTalkId = config.currentTalkId;
  const siteBaseUrl = config.siteBaseUrl || '';
  let talkArchive = [];
  let nextTalkIndex = 0;
  const talkBatchSize = 12;

  function seekFromLocation() {
    if (!audio) return;
    const value = new URLSearchParams(location.search).get('t');
    const seconds = Number(value || 0);
    if (Number.isFinite(seconds) && seconds > 0) {
      audio.currentTime = seconds;
    }
  }

  document.querySelectorAll('[data-start]').forEach(link => {
    link.addEventListener('click', event => {
      if (!audio) return;
      event.preventDefault();
      const seconds = Number(link.dataset.start || 0);
      history.replaceState(null, '', '?t=' + Math.round(seconds));
      audio.currentTime = seconds;
      audio.play().catch(() => {});
    });
  });
  audio?.addEventListener('loadedmetadata', seekFromLocation, { once: true });

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
    return url || '../../talks/' + String(talk.id || '').replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '/';
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

  function renderTalkBatch() {
    if (!talkArchive.length || !talkList || !talkLoader) return;
    const fragment = document.createDocumentFragment();
    const end = Math.min(nextTalkIndex + talkBatchSize, talkArchive.length);
    for (let index = nextTalkIndex; index < end; index += 1) {
      const talk = talkArchive[index];
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
      const download = document.createElement('a');
      download.className = 'download-link';
      download.href = talk.audio_url || '#';
      download.download = '';
      download.textContent = 'Download';
      player.appendChild(download);
      body.appendChild(player);
      card.appendChild(body);
      fragment.appendChild(card);
    }
    nextTalkIndex = end;
    talkList.appendChild(fragment);
    talkLoader.textContent = nextTalkIndex >= talkArchive.length ? 'End of archive' : 'Loading more talks...';
  }

  async function loadTalkArchive() {
    if (!talkList || !talkLoader) return;
    try {
      const response = await fetch('../../talks.json');
      if (!response.ok) throw new Error('Could not load talks.json');
      const talks = await response.json();
      talkArchive = talks
        .filter(talk => talk && talk.id !== currentTalkId)
        .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
      renderTalkBatch();
      const observer = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          renderTalkBatch();
        }
      }, { rootMargin: '700px 0px' });
      observer.observe(talkLoader);
    } catch (error) {
      talkLoader.textContent = 'More talks could not be loaded right now.';
    }
  }

  document.addEventListener('play', event => {
    if (event.target instanceof HTMLAudioElement) {
      document.querySelectorAll('audio').forEach(player => {
        if (player !== event.target) player.pause();
      });
    }
  }, true);

  loadTalkArchive();
})();
