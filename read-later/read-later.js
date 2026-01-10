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

  const state = {
    items: [],
    filter: 'unread',
    sort: 'saved-desc',
    loading: false,
    error: ''
  };

  const REFRESH_INTERVAL_MS = 60000;
  const TOAST_DURATION_MS = 5000;

  let toastTimeout = null;
  let undoAction = null;

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
    const items = getFilteredItems();

    items.forEach(item => {
      const node = template.content.cloneNode(true);
      const article = node.querySelector('.item');
      const title = node.querySelector('.item__title');
      const domain = node.querySelector('.item__domain');
      const time = node.querySelector('.item__time');
      const toggle = node.querySelector('.item__toggle');
      const remove = node.querySelector('.item__delete');

      if (item.read) {
        article.classList.add('is-read');
      }

      title.textContent = item.title || item.url;
      title.href = item.url;

      domain.textContent = formatDomain(item.url);
      time.textContent = formatDate(item.savedAt);
      toggle.innerHTML = item.read ? ICON_MARK_UNREAD : ICON_MARK_READ;
      toggle.setAttribute('aria-label', item.read ? 'Mark unread' : 'Mark read');
      toggle.title = item.read ? 'Mark unread' : 'Mark read';
      toggle.addEventListener('click', () => updateReadStatus(item.id, !item.read));

      remove.innerHTML = ICON_DELETE;
      remove.classList.add('is-danger');
      remove.title = 'Delete';
      remove.addEventListener('click', () => deleteItem(item.id));

      listEl.appendChild(node);
    });
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
      const response = await fetch('/api/read-later', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: item.url, title: item.title, read: item.read })
      });

      if (!response.ok) {
        throw new Error('Failed to restore item');
      }

      const data = await response.json();
      if (data.item) {
        const index = state.items.findIndex(i => i.url === item.url);
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
    if (!document.hidden && !state.loading) {
      loadItems();
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadItems);
  } else {
    loadItems();
  }

  setInterval(() => {
    if (!document.hidden && !state.loading) {
      loadItems();
    }
  }, REFRESH_INTERVAL_MS);
})();
