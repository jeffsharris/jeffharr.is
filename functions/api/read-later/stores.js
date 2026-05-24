import { getContentDb } from '../content-library/db.js';
import { createReadLaterItemStore } from '../content-library/read-later-store.js';
import { createReadLaterAssetStore } from './asset-store.js';

function createReadLaterStores(env, { requireAssets = false } = {}) {
  const readLaterStore = env?.READ_LATER_ITEM_STORE || createReadLaterItemStore(getContentDb(env));
  const assetStore = env?.READ_LATER_ASSET_STORE || createReadLaterAssetStore(env, { requireAssets });

  if (!readLaterStore) return null;
  if (requireAssets && !assetStore) return null;

  return {
    readLaterStore,
    assetStore
  };
}

export {
  createReadLaterStores
};
