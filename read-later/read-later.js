(() => {
  'use strict';

  const listEl = document.getElementById('list');
  const statusEl = document.getElementById('status');
  const template = document.getElementById('item-template');
  const filterButtons = Array.from(document.querySelectorAll('.filter-btn'));
  const sortSelect = document.getElementById('sort-select');
  const refreshBtn = document.getElementById('refresh-btn');
  const countUnreadEl = document.getElementById('count-unread');
  const countReadEl = document.getElementById('count-read');

  const state = {
    items: [],
    filter: 'unread',
    sort: 'saved-desc',
    loading: false,
    error: ''
  };

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

      if (item.read) {
        article.classList.add('is-read');
      }

      title.textContent = item.title || item.url;
      title.href = item.url;

      domain.textContent = formatDomain(item.url);
      time.textContent = formatDate(item.savedAt);
      toggle.textContent = item.read ? 'Mark unread' : 'Mark read';
      toggle.addEventListener('click', () => updateReadStatus(item.id, !item.read, toggle));

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

  async function updateReadStatus(id, read, button) {
    if (!id) return;
    button.disabled = true;
    state.error = '';
    renderStatus();

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
      }
    } catch (error) {
      console.error(error);
      state.error = 'Update failed. Refresh and try again.';
    } finally {
      button.disabled = false;
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

  filterButtons.forEach(button => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  sortSelect.addEventListener('change', (event) => {
    state.sort = event.target.value;
    render();
  });

  refreshBtn.addEventListener('click', () => loadItems());

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadItems);
  } else {
    loadItems();
  }
})();
