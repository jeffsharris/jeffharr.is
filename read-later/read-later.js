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

  let toastTimeout = null;
  let undoAction = null;
  const readerCache = new Map();
  const readerRequests = new Map();
  const kindleRequests = new Set();
  const progressTimers = new Map();

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
    const title = node.querySelector('.item__title');
    const meta = node.querySelector('.item__meta');
    const summary = node.querySelector('.item__summary');
    const actionsEl = node.querySelector('.item__actions');
    const readerPane = node.querySelector('.item__reader');

    article.classList.add('is-saving');
    title.textContent = item.title || item.url;
    title.href = item.url;

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
    const title = node.querySelector('.item__title');
    const domain = node.querySelector('.item__domain');
    const time = node.querySelector('.item__time');
    const summary = node.querySelector('.item__summary');
    const toggle = node.querySelector('.item__toggle');
    const remove = node.querySelector('.item__delete');
    const kindleLink = node.querySelector('.item__kindle-link');
    const readerPane = node.querySelector('.item__reader');
    const readerTitle = node.querySelector('.reader__title');
    const readerMeta = node.querySelector('.reader__meta');
    const readerStatus = node.querySelector('.reader__status');
    const readerBody = node.querySelector('.reader__body');
    const readerRefresh = node.querySelector('.reader__refresh');

    if (item.read) {
      article.classList.add('is-read');
    }

    title.textContent = item.title || item.url;
    title.href = item.url;

    domain.textContent = formatDomain(item.url);
    time.textContent = formatDate(item.savedAt);
    renderKindleState(item, kindleLink);

    kindleLink.addEventListener('click', () => {
      syncKindle(item.id);
    });

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
        readerTitle,
        readerMeta,
        readerStatus,
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
    const status = getKindleStatus(item);
    const isSending = kindleRequests.has(item.id);
    const label = getKindleLinkLabel(status, isSending);

    linkEl.textContent = label;
    linkEl.title = getKindleStatusTitle(status, item?.kindle?.lastError || '');
    linkEl.disabled = isSending;
    linkEl.classList.toggle('is-synced', status === 'synced');
    linkEl.classList.toggle('is-failed', status === 'failed');
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
    if (status === 'needs-content') {
      return 'Reader content missing; click to try again';
    }
    return 'Click to send to Kindle';
  }

  async function syncKindle(id) {
    if (!id || kindleRequests.has(id)) return;
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
    const { item, readerPane, readerTitle, readerMeta, readerStatus, readerBody, readerRefresh } = elements;
    attachRefreshListener({ item, readerTitle, readerMeta, readerStatus, readerBody, readerRefresh });

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
      saving: true
    };
    render();

    try {
      const response = await fetch('/api/read-later', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: rawUrl, title: rawTitle })
      });

      const data = await response.json();

      if (!response.ok || !data.ok) {
        throw new Error(data.error || 'Save failed');
      }

      // Clear saving state and reload
      state.savingItem = null;

      // Show appropriate toast message
      if (data.duplicate) {
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

  async function init() {
    const params = new URLSearchParams(window.location.search);
    const hasUrlToSave = params.has('url') || params.has('u');

    if (hasUrlToSave) {
      // Save first, showing placeholder
      await saveFromUrlParams();
      // Then load items (will include the new/updated item)
      await loadItems();
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
