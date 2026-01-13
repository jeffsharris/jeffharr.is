(() => {
  'use strict';

  const listEl = document.getElementById('list');
  const statusEl = document.getElementById('status');
  const template = document.getElementById('item-template');
  const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));
  const sortSelect = document.getElementById('sort-select');
  const countUnreadEl = document.getElementById('count-unread');
  const countReadEl = document.getElementById('count-read');
  const toastEl = document.getElementById('toast');
  const toastMessageEl = document.getElementById('toast-message');
  const toastUndoBtn = document.getElementById('toast-undo');

  const ICON_MARK_READ = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M9 12l2 2 4-4"></path>
      <path d="M12 21a9 9 0 1 0-9-9 9 9 0 0 0 9 9z"></path>
    </svg>
  `;

  const ICON_MARK_UNREAD = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 7v6h6"></path>
      <path d="M21 17a8 8 0 0 0-13.66-5.66L3 13"></path>
    </svg>
  `;

  const ICON_DELETE = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <polyline points="3 6 5 6 21 6"></polyline>
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    </svg>
  `;

  const ICON_REFRESH = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-2.64-6.36"></path>
      <polyline points="21 3 21 9 15 9"></polyline>
    </svg>
  `;

  const ICON_LOADING = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
    </svg>
  `;

  const state = {
    items: [],
    filter: 'unread',
    sort: 'saved-desc',
    loading: false,
    error: '',
    openId: null,
    savingItem: null  // Placeholder item while saving
  };

  const REFRESH_INTERVAL_MS = 60000;
  const TOAST_DURATION_MS = 5000;
  const PROGRESS_DEBOUNCE_MS = 800;
  const VIDEO_PROGRESS_DEBOUNCE_MS = 1500;
  const VIDEO_PROGRESS_INTERVAL_MS = 8000;
  const VIDEO_PROGRESS_MIN_SECONDS = 300;
  const YOUTUBE_THUMB_BASE = 'https://i.ytimg.com/vi/';
  const YOUTUBE_VIDEO_ID_PATTERN = /^[a-zA-Z0-9_-]{11}$/;

  let toastTimeout = null;
  let undoAction = null;
  const readerCache = new Map();
  const readerRequests = new Map();
  const kindleRequests = new Set();
  const progressTimers = new Map();
  const videoPlayers = new Map();
  const videoDurations = new Map();
  const videoIntervals = new Map();
  const videoProgressTimers = new Map();
  let youtubeApiPromise = null;

  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium'
  });

  async function loadItems() {
    state.loading = true;
    state.error = '';
    renderStatus();

    try {
      const response = await fetch('/api/read-later');
      if (!response.ok) {
        throw new Error('Failed to load items');
      }
      const data = await response.json();
      state.items = Array.isArray(data.items) ? data.items : [];
    } catch (error) {
      console.error(error);
      state.error = 'Could not load the list. Try again shortly.';
    } finally {
      state.loading = false;
      render();
    }
  }

  function render() {
    renderCounts();
    renderList();
    renderStatus();
  }

  function renderCounts() {
    const unreadCount = state.items.filter(item => !item.read).length;
    const readCount = state.items.filter(item => item.read).length;
    countUnreadEl.textContent = unreadCount;
    countReadEl.textContent = readCount;
  }

  function renderList() {
    teardownVideoPlayers();
    listEl.innerHTML = '';

    // Render saving item first if exists
    if (state.savingItem && state.filter === 'unread') {
      renderSavingItem(state.savingItem);
    }

    const items = getFilteredItems();
    const hasOpenItem = items.some(item => item.id === state.openId);

    if (state.openId && !hasOpenItem) {
      state.openId = null;
    }

    items.forEach(item => {
      renderItem(item);
    });
  }

  function renderSavingItem(item) {
    const node = template.content.cloneNode(true);
    const article = node.querySelector('.item');
    const thumb = node.querySelector('.item__thumb');
    const thumbImg = node.querySelector('.item__thumb-img');
    const title = node.querySelector('.item__title');
    const meta = node.querySelector('.item__meta');
    const summary = node.querySelector('.item__summary');
    const actionsEl = node.querySelector('.item__actions');
    const readerPane = node.querySelector('.item__reader');

    article.classList.add('is-saving');
    title.textContent = item.title || item.url;
    title.href = item.url;
    renderCoverThumb(item, thumb, thumbImg);

    // Replace meta content with saving indicator
    meta.innerHTML = `<span class="item__saving-indicator">${ICON_LOADING} Saving...</span>`;

    // Disable interaction
    summary.removeAttribute('role');
    summary.removeAttribute('tabindex');
    summary.style.cursor = 'default';
    actionsEl.innerHTML = '';
    readerPane.remove();

    listEl.appendChild(node);
  }

  function renderItem(item) {
    const node = template.content.cloneNode(true);
    const article = node.querySelector('.item');
    const thumb = node.querySelector('.item__thumb');
    const thumbImg = node.querySelector('.item__thumb-img');
    const thumbRegenerate = node.querySelector('.item__thumb-regenerate');
    const title = node.querySelector('.item__title');
    const domain = node.querySelector('.item__domain');
    const time = node.querySelector('.item__time');
    const summary = node.querySelector('.item__summary');
    const toggle = node.querySelector('.item__toggle');
    const remove = node.querySelector('.item__delete');
    const kindleLink = node.querySelector('.item__kindle-link');
    const readerPane = node.querySelector('.item__reader');
    const readerKicker = node.querySelector('.reader__kicker');
    const readerTitle = node.querySelector('.reader__title');
    const readerMeta = node.querySelector('.reader__meta');
    const readerStatus = node.querySelector('.reader__status');
    const readerMedia = node.querySelector('.reader__media');
    const readerBody = node.querySelector('.reader__body');
    const readerRefresh = node.querySelector('.reader__refresh');

    if (item.read) {
      article.classList.add('is-read');
    }

    title.textContent = item.title || item.url;
    title.href = item.url;
    renderCoverThumb(item, thumb, thumbImg);

    domain.textContent = formatDomain(item.url);
    time.textContent = formatDate(item.savedAt);
    renderKindleState(item, kindleLink);

    kindleLink.addEventListener('click', () => {
      syncKindle(item.id);
    });

    // Regenerate cover button (only visible on hover for items without covers)
    if (thumbRegenerate) {
      thumbRegenerate.addEventListener('click', (event) => {
        event.stopPropagation();
        regenerateCover(item.id, thumbRegenerate, thumb, thumbImg);
      });
    }

    const isOpen = state.openId === item.id;
    const readerId = `reader-${item.id}`;
    readerPane.id = readerId;
    summary.setAttribute('aria-controls', readerId);
    summary.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    summary.addEventListener('click', (event) => {
      if (!shouldToggleReader(event, summary)) {
        return;
      }
      event.preventDefault();
      toggleReader(item.id);
    });
    summary.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }
      if (!shouldToggleReader(event, summary)) {
        return;
      }
      event.preventDefault();
      toggleReader(item.id);
    });

    toggle.innerHTML = item.read ? ICON_MARK_UNREAD : ICON_MARK_READ;
    toggle.setAttribute('aria-label', item.read ? 'Mark unread' : 'Mark read');
    toggle.title = item.read ? 'Mark unread' : 'Mark read';
    toggle.addEventListener('click', () => updateReadStatus(item.id, !item.read));

    remove.innerHTML = ICON_DELETE;
    remove.classList.add('is-danger');
    remove.title = 'Delete';
    remove.addEventListener('click', () => deleteItem(item.id));

    if (isOpen) {
      readerPane.hidden = false;
      article.classList.add('is-open');
      openReader({
        item,
        readerPane,
        readerKicker,
        readerTitle,
        readerMeta,
        readerStatus,
        readerMedia,
        readerBody,
        readerRefresh
      });
    } else {
      readerPane.hidden = true;
      article.classList.remove('is-open');
    }

    listEl.appendChild(node);
  }

  function renderStatus() {
    if (state.loading) {
      statusEl.textContent = 'Loading your list...';
      return;
    }

    if (state.error) {
      statusEl.textContent = state.error;
      return;
    }

    const items = getFilteredItems();
    if (state.items.length === 0) {
      statusEl.textContent = 'Nothing saved yet. Share a link to start your list.';
      return;
    }

    if (items.length === 0) {
      statusEl.textContent = state.filter === 'read'
        ? 'No finished items yet.'
        : 'All caught up. No unread items.';
      return;
    }

    statusEl.textContent = `${items.length} item${items.length === 1 ? '' : 's'} shown.`;
  }

  function renderKindleState(item, linkEl) {
    if (!linkEl) return;
    if (getYouTubeInfoFromItem(item)) {
      linkEl.textContent = 'YouTube video';
      linkEl.title = 'YouTube videos are not sent to Kindle';
      linkEl.disabled = true;
      linkEl.classList.remove('is-synced', 'is-failed');
      return;
    }
    const status = getKindleStatus(item);
    const isSending = kindleRequests.has(item.id);
    const label = getKindleLinkLabel(status, isSending);

    linkEl.textContent = label;
    linkEl.title = getKindleStatusTitle(status, item?.kindle?.lastError || '');
    linkEl.disabled = isSending;
    linkEl.classList.toggle('is-synced', status === 'synced');
    linkEl.classList.toggle('is-failed', status === 'failed');
  }

  function renderCoverThumb(item, thumbEl, imgEl) {
    if (!thumbEl || !imgEl) return;

    imgEl.removeAttribute('src');
    thumbEl.classList.add('is-empty');
    thumbEl.classList.toggle('is-loading', Boolean(item?.saving));
    thumbEl.classList.remove('is-video');

    const youtubeInfo = getYouTubeInfoFromItem(item);
    if (youtubeInfo) {
      const thumbUrl = getYouTubeThumbnailUrl(youtubeInfo);
      if (!thumbUrl) {
        return;
      }
      thumbEl.classList.add('is-video');
      imgEl.onload = () => {
        thumbEl.classList.remove('is-empty');
        thumbEl.classList.remove('is-loading');
      };
      imgEl.onerror = () => {
        thumbEl.classList.add('is-empty');
        thumbEl.classList.remove('is-loading');
        imgEl.removeAttribute('src');
      };
      imgEl.src = thumbUrl;
      return;
    }

    const preview = item?.coverPreview;
    if (preview) {
      thumbEl.classList.remove('is-empty');
      thumbEl.classList.remove('is-loading');
      imgEl.src = `data:image/png;base64,${preview}`;
      return;
    }

    const updatedAt = item?.cover?.updatedAt;
    if (!updatedAt || !item?.id) {
      return;
    }

    const url = new URL('/api/read-later/cover', window.location.origin);
    url.searchParams.set('id', item.id);
    url.searchParams.set('v', updatedAt);

    imgEl.onload = () => {
      thumbEl.classList.remove('is-empty');
      thumbEl.classList.remove('is-loading');
    };
    imgEl.onerror = () => {
      thumbEl.classList.add('is-empty');
      thumbEl.classList.remove('is-loading');
      imgEl.removeAttribute('src');
    };

    imgEl.src = url.toString();
  }

  function getKindleStatus(item) {
    return item?.kindle?.status || 'unsynced';
  }

  function getKindleLinkLabel(status, isSending) {
    if (isSending) {
      return 'Syncing...';
    }
    switch (status) {
      case 'needs-content':
        return 'Send to Kindle';
      case 'failed':
        return 'Retry Kindle';
      case 'synced':
        return 'Kindle synced';
      case 'unsupported':
        return 'Not for Kindle';
      default:
        return 'Send to Kindle';
    }
  }

  function getKindleStatusTitle(status, errorMessage) {
    if (status === 'synced') {
      return 'Click to resend to Kindle';
    }
    if (status === 'failed') {
      return errorMessage ? `Last error: ${errorMessage}` : 'Click to retry';
    }
    if (status === 'unsupported') {
      return 'This link is not sent to Kindle';
    }
    if (status === 'needs-content') {
      return 'Reader content missing; click to try again';
    }
    return 'Click to send to Kindle';
  }

  async function syncKindle(id) {
    if (!id || kindleRequests.has(id)) return;
    const item = state.items.find(entry => entry.id === id);
    if (item && getYouTubeInfoFromItem(item)) return;
    kindleRequests.add(id);
    render();

    try {
      const response = await fetch('/api/read-later/kindle-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json().catch(() => null);
      const updated = data?.item;

      if (updated) {
        const index = state.items.findIndex(item => item.id === id);
        if (index >= 0) {
          state.items[index] = updated;
        }
      }
    } catch (error) {
      console.error(error);
    } finally {
      kindleRequests.delete(id);
      render();
    }
  }

  const coverRequests = new Set();

  async function regenerateCover(id, button, thumbEl, imgEl) {
    if (!id || coverRequests.has(id)) return;
    coverRequests.add(id);
    button.classList.add('is-loading');

    try {
      const response = await fetch('/api/read-later/regenerate-cover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });
      const data = await response.json().catch(() => null);

      if (data?.ok && data?.item) {
        const index = state.items.findIndex(item => item.id === id);
        if (index >= 0) {
          state.items[index] = data.item;
        }

        // Update the thumbnail immediately
        if (data.item.cover?.updatedAt && imgEl && thumbEl) {
          const url = new URL('/api/read-later/cover', window.location.origin);
          url.searchParams.set('id', id);
          url.searchParams.set('v', data.item.cover.updatedAt);
          imgEl.onload = () => {
            thumbEl.classList.remove('is-empty');
          };
          imgEl.src = url.toString();
        }

        showToast('Cover generated', null);
      } else if (data?.coverExists) {
        showToast('Cover already exists', null);
        render();
      } else {
        showToast('Could not generate cover', null);
      }
    } catch (error) {
      console.error('Cover regeneration error:', error);
      showToast('Could not generate cover', null);
    } finally {
      coverRequests.delete(id);
      button.classList.remove('is-loading');
    }
  }

  function toggleReader(id) {
    state.openId = state.openId === id ? null : id;
    render();
  }

  function shouldToggleReader(event, summary) {
    if (!event || !summary) return false;
    const target = event.target;
    if (!(target instanceof Element)) return false;
    if (target.closest('button')) return false;

    if (event.type === 'keydown') {
      return !target.closest('.item__title');
    }

    const title = summary.querySelector('.item__title');
    if (title && isEventOnTitle(event, title)) {
      return false;
    }

    return true;
  }

  function isEventOnTitle(event, title) {
    if (!title) return false;
    const { clientX, clientY } = event;
    if (typeof clientX !== 'number' || typeof clientY !== 'number') {
      return true;
    }
    const rects = getTextClientRects(title);
    if (rects.length === 0) {
      return title.contains(event.target);
    }
    return rects.some((rect) => (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ));
  }

  function getTextClientRects(element) {
    const rects = [];
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);

    while (walker.nextNode()) {
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      rects.push(...Array.from(range.getClientRects()));
    }

    return rects;
  }

  function getFilteredItems() {
    const filtered = state.items.filter(item => (
      state.filter === 'read' ? item.read : !item.read
    ));

    const sorted = [...filtered].sort((a, b) => {
      const aTime = new Date(a.savedAt || 0).getTime();
      const bTime = new Date(b.savedAt || 0).getTime();
      return state.sort === 'saved-desc' ? bTime - aTime : aTime - bTime;
    });

    return sorted;
  }

  function setFilter(filter) {
    state.filter = filter;
    filterButtons.forEach(button => {
      const isActive = button.dataset.filter === filter;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
    render();
  }

  async function updateReadStatus(id, read) {
    if (!id) return;
    state.error = '';

    const index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;

    const previousState = state.items[index].read;
    state.items[index] = { ...state.items[index], read };
    render();

    const message = read ? 'Marked as read' : 'Marked as unread';
    showToast(message, async () => {
      state.items[index] = { ...state.items[index], read: previousState };
      render();
      await syncReadStatus(id, previousState);
    });

    await syncReadStatus(id, read);
  }

  async function syncReadStatus(id, read) {
    try {
      const response = await fetch('/api/read-later', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, read })
      });

      if (!response.ok) {
        throw new Error('Failed to update item');
      }

      const data = await response.json();
      const updated = data.item;
      const index = state.items.findIndex(item => item.id === id);

      if (updated && index >= 0) {
        state.items[index] = updated;
        render();
      }
    } catch (error) {
      console.error(error);
      state.error = 'Sync failed. Please refresh.';
      render();
    }
  }

  async function openReader(elements) {
    const {
      item,
      readerKicker,
      readerTitle,
      readerMeta,
      readerStatus,
      readerMedia,
      readerBody,
      readerRefresh
    } = elements;

    const youtubeInfo = getYouTubeInfoFromItem(item);
    if (youtubeInfo) {
      await openYouTubeReader({
        item,
        youtubeInfo,
        readerKicker,
        readerTitle,
        readerMeta,
        readerStatus,
        readerMedia,
        readerBody,
        readerRefresh
      });
      return;
    }

    attachRefreshListener({ item, readerTitle, readerMeta, readerStatus, readerBody, readerRefresh });
    setReaderKicker(readerKicker, 'Reader view');
    resetReaderMedia(readerMedia, readerBody);

    const cached = readerCache.get(item.id);
    if (cached) {
      renderReaderContent({ item, readerTitle, readerMeta, readerStatus, readerBody }, cached);
      restoreProgress(item, readerBody);
      attachProgressListener(item, readerBody);
      return;
    }

    readerStatus.textContent = 'Loading reader...';
    readerBody.innerHTML = '';

    try {
      const reader = await fetchReader(item.id);
      if (!reader) {
        throw new Error('Reader unavailable');
      }

      readerCache.set(item.id, reader);
      renderReaderContent({ item, readerTitle, readerMeta, readerStatus, readerBody }, reader);
      restoreProgress(item, readerBody);
      attachProgressListener(item, readerBody);
    } catch (error) {
      console.error(error);
      renderReaderError(item, readerStatus, readerBody);
    }
  }

  async function fetchReader(id, { refresh = false } = {}) {
    if (!refresh && readerRequests.has(id)) {
      return readerRequests.get(id);
    }

    const url = new URL('/api/read-later/reader', window.location.origin);
    url.searchParams.set('id', id);
    if (refresh) {
      url.searchParams.set('refresh', '1');
    }

    const request = fetch(url.toString())
      .then(response => response.json())
      .then(data => (data.ok ? data.reader : null))
      .finally(() => {
        if (!refresh) {
          readerRequests.delete(id);
        }
      });

    if (!refresh) {
      readerRequests.set(id, request);
    }
    return request;
  }

  function attachRefreshListener(elements) {
    const { item, readerTitle, readerMeta, readerStatus, readerBody, readerRefresh } = elements;
    if (!readerRefresh) return;
    readerRefresh.hidden = false;
    readerRefresh.disabled = false;
    readerRefresh.innerHTML = ICON_REFRESH;
    readerRefresh.title = 'Refresh reader';
    readerRefresh.onclick = () => {
      refreshReader({ item, readerTitle, readerMeta, readerStatus, readerBody, readerRefresh });
    };
  }

  async function refreshReader(elements) {
    const { item, readerTitle, readerMeta, readerStatus, readerBody, readerRefresh } = elements;
    if (!item?.id) return;
    readerRefresh.disabled = true;
    readerStatus.textContent = 'Refreshing reader...';
    readerBody.innerHTML = '';
    readerCache.delete(item.id);

    try {
      const reader = await fetchReader(item.id, { refresh: true });
      if (!reader) {
        throw new Error('Reader unavailable');
      }
      readerCache.set(item.id, reader);
      renderReaderContent({ item, readerTitle, readerMeta, readerStatus, readerBody }, reader);
      restoreProgress(item, readerBody);
      attachProgressListener(item, readerBody);
    } catch (error) {
      console.error(error);
      renderReaderError(item, readerStatus, readerBody);
    } finally {
      readerRefresh.disabled = false;
    }
  }

  function renderReaderContent(elements, reader) {
    const { item, readerTitle, readerMeta, readerStatus, readerBody } = elements;
    readerTitle.textContent = reader.title || 'Untitled';
    readerMeta.textContent = formatReaderMeta(reader);
    readerStatus.textContent = '';

    // Check for poor extraction (too short or empty content)
    const MIN_WORD_COUNT = 50;
    if (!reader.contentHtml || reader.wordCount < MIN_WORD_COUNT) {
      renderReaderError(item, readerStatus, readerBody);
      return;
    }

    readerBody.innerHTML = reader.contentHtml;
  }

  function renderReaderError(item, readerStatus, readerBody) {
    readerStatus.innerHTML = '';
    readerBody.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'reader__fallback';
    const text = document.createElement('p');
    text.textContent = 'Reader view isn\'t available for this page—some sites load content dynamically.';
    const link = document.createElement('a');
    link.href = item.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.className = 'reader__fallback-link';
    link.textContent = 'Read on ' + formatDomain(item.url) + ' →';
    container.appendChild(text);
    container.appendChild(link);
    readerBody.appendChild(container);
  }

  function setReaderKicker(element, text) {
    if (!element) return;
    element.textContent = text;
  }

  function resetReaderMedia(readerMedia, readerBody) {
    if (readerMedia) {
      readerMedia.innerHTML = '';
      readerMedia.hidden = true;
    }
    if (readerBody) {
      readerBody.classList.remove('is-video');
    }
  }

  async function openYouTubeReader(elements) {
    const {
      item,
      youtubeInfo,
      readerKicker,
      readerTitle,
      readerMeta,
      readerStatus,
      readerMedia,
      readerBody,
      readerRefresh
    } = elements;

    setReaderKicker(readerKicker, 'Video');
    if (readerRefresh) {
      readerRefresh.hidden = true;
      readerRefresh.disabled = true;
    }

    if (readerBody) {
      readerBody.classList.add('is-video');
      readerBody.innerHTML = '';
      const link = document.createElement('a');
      link.href = item.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.className = 'reader__video-link';
      link.textContent = 'Watch on YouTube →';
      readerBody.appendChild(link);
    }

    readerTitle.textContent = item.title || 'Untitled video';
    readerMeta.textContent = 'YouTube video';
    readerStatus.textContent = 'Loading video...';

    await renderYouTubePlayer({ item, youtubeInfo, readerMedia, readerStatus });
  }

  async function renderYouTubePlayer({ item, youtubeInfo, readerMedia, readerStatus }) {
    if (!readerMedia) return;
    destroyVideoPlayer(item.id);

    const playerId = `yt-player-${item.id}`;
    readerMedia.innerHTML = `<div class="reader__video" id="${playerId}"></div>`;
    readerMedia.hidden = false;

    try {
      const player = await createYouTubePlayer(playerId, youtubeInfo.videoId, item, readerStatus);
      videoPlayers.set(item.id, player);
    } catch (error) {
      console.error('YouTube player error:', error);
      readerStatus.textContent = 'Video failed to load.';
    }
  }

  function loadYouTubeApi() {
    if (youtubeApiPromise) return youtubeApiPromise;
    if (window.YT && window.YT.Player) {
      youtubeApiPromise = Promise.resolve(window.YT);
      return youtubeApiPromise;
    }

    youtubeApiPromise = new Promise((resolve) => {
      const existing = document.getElementById('youtube-iframe-api');
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') {
          previous();
        }
        resolve(window.YT);
      };

      if (existing) {
        return;
      }

      const script = document.createElement('script');
      script.id = 'youtube-iframe-api';
      script.src = 'https://www.youtube.com/iframe_api';
      document.head.appendChild(script);
    });

    return youtubeApiPromise;
  }

  async function createYouTubePlayer(elementId, videoId, item, readerStatus) {
    const YT = await loadYouTubeApi();

    return new Promise((resolve) => {
      let player = null;
      player = new YT.Player(elementId, {
        videoId,
        playerVars: {
          modestbranding: 1,
          rel: 0,
          playsinline: 1,
          origin: window.location.origin
        },
        events: {
          onReady: () => {
            handleYouTubeReady(item, player, readerStatus);
            resolve(player);
          },
          onStateChange: (event) => {
            handleYouTubeStateChange(item, player, event);
          }
        }
      });
    });
  }

  function handleYouTubeReady(item, player, readerStatus) {
    if (readerStatus) {
      readerStatus.textContent = '';
    }

    const duration = Number(player?.getDuration?.() ?? 0);
    if (Number.isFinite(duration) && duration > 0) {
      videoDurations.set(item.id, duration);
    }

    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }

    if (duration < VIDEO_PROGRESS_MIN_SECONDS) {
      if (item?.progress?.video) {
        delete item.progress.video;
        clearVideoProgress(item.id, duration);
      }
      return;
    }

    const resume = Number(item?.progress?.video?.currentTime ?? 0);
    if (Number.isFinite(resume) && resume > 0 && resume < duration - 5) {
      player.seekTo(resume, true);
    }
  }

  function handleYouTubeStateChange(item, player, event) {
    if (!item || !player || !event) return;
    const state = event.data;
    if (state === 1) {
      startVideoProgressWatcher(item, player);
      return;
    }
    if (state === 2 || state === 0) {
      stopVideoProgressWatcher(item.id);
      captureVideoProgress(item, player, { immediate: true });
    }
  }

  function startVideoProgressWatcher(item, player) {
    if (!item || !player || videoIntervals.has(item.id)) return;
    const duration = getVideoDuration(item.id, player);
    if (!Number.isFinite(duration) || duration < VIDEO_PROGRESS_MIN_SECONDS) return;

    const interval = setInterval(() => {
      captureVideoProgress(item, player);
    }, VIDEO_PROGRESS_INTERVAL_MS);
    videoIntervals.set(item.id, interval);
  }

  function stopVideoProgressWatcher(id) {
    if (!id) return;
    const interval = videoIntervals.get(id);
    if (interval) {
      clearInterval(interval);
      videoIntervals.delete(id);
    }
  }

  function getVideoDuration(id, player) {
    if (videoDurations.has(id)) {
      return videoDurations.get(id);
    }
    const duration = Number(player?.getDuration?.() ?? 0);
    if (Number.isFinite(duration) && duration > 0) {
      videoDurations.set(id, duration);
      return duration;
    }
    return null;
  }

  function captureVideoProgress(item, player, { immediate = false } = {}) {
    if (!item || !player) return;
    const duration = getVideoDuration(item.id, player);
    if (!Number.isFinite(duration) || duration <= 0) return;

    const currentTime = Number(player?.getCurrentTime?.() ?? 0);
    if (!Number.isFinite(currentTime)) return;

    if (duration < VIDEO_PROGRESS_MIN_SECONDS) {
      if (item?.progress?.video) {
        delete item.progress.video;
        clearVideoProgress(item.id, duration);
      }
      return;
    }

    recordVideoProgress(item.id, currentTime, duration, { immediate });
  }

  function recordVideoProgress(id, currentTime, duration, { immediate = false } = {}) {
    if (!Number.isFinite(currentTime) || !Number.isFinite(duration)) return;
    if (duration < VIDEO_PROGRESS_MIN_SECONDS) return;
    const safeDuration = Math.max(duration, 0);
    const safeTime = clamp(currentTime, 0, safeDuration || 0);
    const progress = {
      currentTime: safeTime,
      duration: safeDuration,
      ratio: safeDuration ? clamp(safeTime / safeDuration, 0, 1) : 0,
      updatedAt: new Date().toISOString()
    };

    const item = state.items.find(entry => entry.id === id);
    if (!item) return;
    const nextProgress = item.progress && typeof item.progress === 'object'
      ? { ...item.progress }
      : {};
    nextProgress.video = progress;
    item.progress = nextProgress;

    scheduleVideoProgressSave(id, progress, { immediate });
  }

  function scheduleVideoProgressSave(id, progress, { immediate = false } = {}) {
    if (!id || !progress) return;
    if (progress.duration < VIDEO_PROGRESS_MIN_SECONDS) return;

    if (videoProgressTimers.has(id)) {
      clearTimeout(videoProgressTimers.get(id));
    }

    const delay = immediate ? 0 : VIDEO_PROGRESS_DEBOUNCE_MS;
    const timer = setTimeout(() => {
      saveVideoProgress(id, progress);
    }, delay);
    videoProgressTimers.set(id, timer);
  }

  async function saveVideoProgress(id, progress) {
    if (!id || !progress) return;
    if (progress.duration < VIDEO_PROGRESS_MIN_SECONDS) return;

    try {
      await fetch('/api/read-later/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          videoCurrentTime: progress.currentTime,
          videoDuration: progress.duration
        })
      });
    } catch (error) {
      console.error('Failed to save video progress:', error);
    }
  }

  async function clearVideoProgress(id, duration) {
    if (!id || !Number.isFinite(duration)) return;

    try {
      await fetch('/api/read-later/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          videoCurrentTime: 0,
          videoDuration: duration
        })
      });
    } catch (error) {
      console.error('Failed to clear video progress:', error);
    }
  }

  function teardownVideoPlayers() {
    for (const [id, player] of videoPlayers.entries()) {
      const item = state.items.find(entry => entry.id === id);
      if (item) {
        captureVideoProgress(item, player, { immediate: true });
      }
      destroyVideoPlayer(id);
    }
  }

  function destroyVideoPlayer(id) {
    if (!id) return;
    const player = videoPlayers.get(id);
    if (player && typeof player.destroy === 'function') {
      try {
        player.destroy();
      } catch {
        // Ignore teardown errors.
      }
    }
    videoPlayers.delete(id);
    videoDurations.delete(id);
    stopVideoProgressWatcher(id);
    if (videoProgressTimers.has(id)) {
      clearTimeout(videoProgressTimers.get(id));
      videoProgressTimers.delete(id);
    }
  }

  function getYouTubeInfoFromItem(item) {
    if (!item?.url) return null;
    return getYouTubeInfo(item.url);
  }

  function getYouTubeInfo(url) {
    if (typeof url !== 'string') return null;
    const parsed = tryParseUrl(url) || tryParseUrl(`https://${url}`);
    if (!parsed) return null;

    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (!['youtube.com', 'm.youtube.com', 'youtu.be', 'youtube-nocookie.com'].includes(hostname)) {
      return null;
    }

    const segments = parsed.pathname.split('/').filter(Boolean);
    let videoId = null;
    let isShort = false;

    if (hostname === 'youtu.be') {
      videoId = extractYouTubeId(segments[0]);
    } else {
      const first = segments[0] || '';
      if (first === 'shorts') {
        isShort = true;
        videoId = extractYouTubeId(segments[1]);
      } else if (first === 'embed' || first === 'v' || first === 'live') {
        videoId = extractYouTubeId(segments[1]);
      } else {
        videoId = extractYouTubeId(parsed.searchParams.get('v'));
      }
    }

    if (!videoId) return null;
    return { type: 'youtube', videoId, isShort };
  }

  function tryParseUrl(value) {
    try {
      return new URL(value);
    } catch {
      return null;
    }
  }

  function extractYouTubeId(value) {
    if (!value) return null;
    const candidate = String(value).split(/[?#&/]/)[0];
    return YOUTUBE_VIDEO_ID_PATTERN.test(candidate) ? candidate : null;
  }

  function getYouTubeThumbnailUrl(info) {
    if (!info?.videoId) return null;
    return `${YOUTUBE_THUMB_BASE}${info.videoId}/hqdefault.jpg`;
  }

  function formatReaderMeta(reader) {
    const parts = [];
    if (reader.siteName) parts.push(reader.siteName);
    if (reader.byline) parts.push(reader.byline);
    if (reader.wordCount) {
      const minutes = Math.max(1, Math.round(reader.wordCount / 200));
      parts.push(`${minutes} min read`);
    }
    return parts.join(' · ');
  }

  function attachProgressListener(item, readerBody) {
    if (readerBody.dataset.progressListener === 'true') {
      return;
    }

    readerBody.dataset.progressListener = 'true';
    readerBody.addEventListener('scroll', () => {
      const maxScroll = readerBody.scrollHeight - readerBody.clientHeight;
      const scrollTop = readerBody.scrollTop;
      const ratio = maxScroll > 0 ? scrollTop / maxScroll : 0;
      updateProgress(item.id, scrollTop, ratio);
    }, { passive: true });
  }

  function updateProgress(id, scrollTop, scrollRatio) {
    const item = state.items.find(entry => entry.id === id);
    if (item) {
      item.progress = {
        scrollTop,
        scrollRatio,
        updatedAt: new Date().toISOString()
      };
    }

    if (progressTimers.has(id)) {
      clearTimeout(progressTimers.get(id));
    }

    const timer = setTimeout(() => {
      saveProgress(id, scrollTop, scrollRatio);
    }, PROGRESS_DEBOUNCE_MS);

    progressTimers.set(id, timer);
  }

  async function saveProgress(id, scrollTop, scrollRatio) {
    try {
      await fetch('/api/read-later/progress', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, scrollTop, scrollRatio })
      });
    } catch (error) {
      console.error('Failed to save progress:', error);
    }
  }

  function restoreProgress(item, readerBody) {
    const progress = item.progress;
    if (!progress) return;

    const ratio = Number.isFinite(progress.scrollRatio) ? progress.scrollRatio : null;
    const scrollTop = Number.isFinite(progress.scrollTop) ? progress.scrollTop : null;

    requestAnimationFrame(() => {
      const maxScroll = readerBody.scrollHeight - readerBody.clientHeight;
      if (maxScroll <= 0) return;
      if (ratio !== null) {
        readerBody.scrollTop = Math.round(maxScroll * ratio);
      } else if (scrollTop !== null) {
        readerBody.scrollTop = Math.min(scrollTop, maxScroll);
      }
    });
  }

  async function deleteItem(id) {
    if (!id) return;
    state.error = '';

    const index = state.items.findIndex(item => item.id === id);
    if (index < 0) return;

    const deletedItem = state.items[index];
    state.items = state.items.filter(item => item.id !== id);
    render();

    showToast('Item deleted', async () => {
      state.items.splice(index, 0, deletedItem);
      render();
      await restoreItem(deletedItem);
    });

    await syncDeleteItem(id);
  }

  async function syncDeleteItem(id) {
    try {
      const response = await fetch('/api/read-later', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      if (!response.ok) {
        throw new Error('Failed to delete item');
      }
    } catch (error) {
      console.error(error);
      state.error = 'Sync failed. Please refresh.';
      render();
    }
  }

  async function restoreItem(item) {
    try {
      const response = await fetch('/api/read-later/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          url: item.url,
          title: item.title,
          savedAt: item.savedAt,
          read: item.read,
          readAt: item.readAt,
          progress: item.progress || null
        })
      });

      if (!response.ok) {
        throw new Error('Failed to restore item');
      }

      const data = await response.json();
      if (data.item) {
        const index = state.items.findIndex(i => i.id === item.id);
        if (index >= 0) {
          state.items[index] = data.item;
        }
        render();
      }
    } catch (error) {
      console.error(error);
      state.error = 'Restore failed. Please refresh.';
      render();
    }
  }

  function formatDomain(url) {
    try {
      const parsed = new URL(url);
      return parsed.hostname.replace(/^www\./, '');
    } catch {
      return 'Unknown source';
    }
  }

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function formatDate(isoString) {
    if (!isoString) return 'Unknown date';
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) return 'Unknown date';
    return dateFormatter.format(date);
  }

  function showToast(message, onUndo) {
    if (toastTimeout) {
      clearTimeout(toastTimeout);
    }

    toastMessageEl.textContent = message;
    undoAction = onUndo;
    toastEl.hidden = false;

    requestAnimationFrame(() => {
      toastEl.classList.add('is-visible');
    });

    toastTimeout = setTimeout(hideToast, TOAST_DURATION_MS);
  }

  function hideToast() {
    toastEl.classList.remove('is-visible');
    setTimeout(() => {
      toastEl.hidden = true;
      undoAction = null;
    }, 300);
  }

  async function handleUndo() {
    if (!undoAction) return;

    hideToast();
    const action = undoAction;
    undoAction = null;

    try {
      await action();
    } catch (error) {
      console.error('Undo failed:', error);
      state.error = 'Undo failed. Please refresh.';
      render();
    }
  }

  toastUndoBtn.addEventListener('click', handleUndo);

  filterButtons.forEach(button => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    render();
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && !state.loading && !state.openId) {
      loadItems();
    }
  });

  async function saveFromUrlParams() {
    const params = new URLSearchParams(window.location.search);
    const rawUrl = params.get('url') || params.get('u');
    const rawTitle = params.get('title') || params.get('t') || '';

    if (!rawUrl) return null;

    // Clean the URL immediately
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('url');
    cleanUrl.searchParams.delete('u');
    cleanUrl.searchParams.delete('title');
    cleanUrl.searchParams.delete('t');
    window.history.replaceState({}, '', cleanUrl.pathname + cleanUrl.search);

    // Create placeholder item and show it
    state.savingItem = {
      url: rawUrl,
      title: rawTitle || rawUrl,
      saving: true,
      coverPreview: null
    };
    render();

    try {
      const streamResult = await saveWithStream(rawUrl, rawTitle);
      const data = streamResult
        ? streamResult.data
        : await saveWithJson(rawUrl, rawTitle);

      if (!data) {
        throw new Error('Save failed');
      }

      if (data.ok === false) {
        throw new Error(data.error || 'Save failed');
      }

      if (data.item) {
        mergeSavedItem(data.item);
      }

      state.savingItem = null;
      render();

      // Show appropriate toast message
      if (data.syncFailed) {
        showToast('Saved — Kindle sync will retry later', null);
      } else if (data.duplicate) {
        if (data.unarchived) {
          showToast('Already saved — restored from archive', null);
        } else {
          showToast('Already saved — bumped to top', null);
        }
      }

      return data;
    } catch (error) {
      console.error('Save error:', error);
      state.savingItem = null;
      showToast('Failed to save', null);
      return null;
    }
  }

  function mergeSavedItem(item) {
    if (!item || !item.id) return;
    const index = state.items.findIndex(existing => existing.id === item.id);
    if (index >= 0) {
      state.items[index] = item;
      return;
    }
    state.items.unshift(item);
  }

  async function saveWithJson(rawUrl, rawTitle) {
    const response = await fetch('/api/read-later', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: rawUrl, title: rawTitle })
    });

    const data = await response.json();

    if (!response.ok || !data.ok) {
      throw new Error(data.error || 'Save failed');
    }

    return data;
  }

  async function saveWithStream(rawUrl, rawTitle) {
    if (!window.ReadableStream) return null;

    const response = await fetch('/api/read-later?stream=1', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'text/event-stream'
      },
      body: JSON.stringify({ url: rawUrl, title: rawTitle })
    });

    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !response.body || !contentType.includes('text/event-stream')) {
      return null;
    }

    const data = await consumeSaveStream(response);
    return { data };
  }

  async function consumeSaveStream(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result = null;
    let savedItem = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split('\n\n');
      buffer = parts.pop() || '';

      parts.forEach((part) => {
        const event = parseEvent(part);
        if (!event?.data || event.data === '[DONE]') return;

        let payload = null;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        if (event.event === 'saved') {
          // Item is now safely persisted - track it
          savedItem = payload.item;
          return;
        }

        if (event.event === 'partial_image') {
          if (state.savingItem) {
            state.savingItem.coverPreview = payload.image;
            render();
          }
          return;
        }

        if (event.event === 'done') {
          result = payload;
          return;
        }

        if (event.event === 'error') {
          // If we have a saved item, return it as success despite the error
          if (savedItem) {
            result = { ok: true, item: savedItem, syncFailed: true };
          } else {
            state.savingItem = null;
            result = payload;
            render();
          }
        }
      });
    }

    // If stream ended without done/error but we have saved item, return it
    if (!result && savedItem) {
      result = { ok: true, item: savedItem, syncFailed: true };
    }

    return result;
  }

  function parseEvent(chunk) {
    const lines = chunk.split('\n').filter(Boolean);
    if (!lines.length) return null;

    let event = 'message';
    const dataLines = [];

    lines.forEach((line) => {
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
        return;
      }
      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trim());
      }
    });

    return { event, data: dataLines.join('\n') };
  }

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const hasUrlToSave = params.has('url') || params.has('u');

    if (hasUrlToSave) {
      // Load existing items in background while saving
      const loadPromise = loadItems();

      // Save the new item (will merge it into state.items and render)
      const saveResult = await saveFromUrlParams();

      // Wait for initial load to complete
      await loadPromise;

      // Only reload if save failed (to get fresh state)
      // If save succeeded, the item is already merged into state
      if (!saveResult?.item) {
        await loadItems();
      }
    } else {
      // Just load items normally
      await loadItems();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  setInterval(() => {
    if (!document.hidden && !state.loading && !state.openId) {
      loadItems();
    }
  }, REFRESH_INTERVAL_MS);
})();
