function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMockReadLaterRepository({ items = {}, readers = {}, covers = {} } = {}) {
  const itemStore = new Map(Object.entries(items).map(([id, item]) => [id, clone(item)]));
  const readerStore = new Map(Object.entries(readers).map(([id, reader]) => [id, clone(reader)]));
  const coverStore = new Map(Object.entries(covers).map(([id, cover]) => [id, clone(cover)]));

  return {
    items: itemStore,
    readers: readerStore,
    covers: coverStore,

    async getItem(id) {
      return clone(itemStore.get(id) || null);
    },

    async saveItem(item) {
      itemStore.set(item.id, clone(item));
      return true;
    },

    async getReader(id) {
      return clone(readerStore.get(id) || null);
    },

    async saveReader(id, reader) {
      readerStore.set(id, clone(reader));
      return true;
    },

    async getCover(id) {
      return clone(coverStore.get(id) || null);
    },

    async saveCover(id, cover) {
      coverStore.set(id, clone(cover));
      return clone(cover);
    }
  };
}

export { createMockReadLaterRepository };
