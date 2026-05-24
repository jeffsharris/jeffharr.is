function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createMockReadLaterStores({ items = {}, readers = {}, covers = {} } = {}) {
  const itemStore = new Map(Object.entries(items).map(([id, item]) => [id, clone(item)]));
  const readerStore = new Map(Object.entries(readers).map(([id, reader]) => [id, clone(reader)]));
  const coverStore = new Map(Object.entries(covers).map(([id, cover]) => [id, clone(cover)]));

  const readLaterStore = {
    async getItem(id) {
      return clone(itemStore.get(id) || null);
    },

    async saveItem(item) {
      itemStore.set(item.id, clone(item));
      return true;
    }
  };

  const assetStore = {
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

    async getCoverBytes(id) {
      const cover = coverStore.get(id);
      if (!cover?.base64) return null;
      return {
        bytes: decodeBase64(cover.base64),
        contentType: cover.contentType || 'image/png',
        createdAt: cover.createdAt || null
      };
    },

    async saveCover(id, cover) {
      coverStore.set(id, clone(cover));
      return clone(cover);
    }
  };

  return {
    readLaterStore,
    assetStore,
    itemStore,
    readerStore,
    coverStore
  };
}

function decodeBase64(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export { createMockReadLaterStores };
