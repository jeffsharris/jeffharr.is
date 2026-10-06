import { createLogger } from '../../functions/api/lib/logger.js';
import { PUSH_NOTIFICATION_MESSAGE_TYPE } from '../../functions/api/read-later/article-push-service.js';
import { processKindleSyncBatch } from '../../functions/api/read-later/sync-service.js';
import { buildPdfReader } from '../../functions/api/read-later/pdf-reader.js';
import { createReadLaterStores } from '../../functions/api/read-later/stores.js';
import { getReadLaterAssetItemId } from '../../functions/api/read-later/asset-store.js';
import {
  COVER_MESSAGE_TYPE,
  processCoverSyncBatch
} from '../../functions/api/read-later/cover-sync-service.js';

function parseQueueMessageBody(message) {
  if (!message) return null;

  if (typeof message.body === 'string') {
    try {
      return JSON.parse(message.body);
    } catch {
      return null;
    }
  }

  if (message.body && typeof message.body === 'object') {
    return message.body;
  }

  return null;
}

export default {
  async fetch() {
    return new Response('read-later-sync worker', { status: 200 });
  },

  async queue(batch, env) {
    const logger = createLogger({ source: 'read-later-sync-worker' });
    const kindleMessages = [];
    const coverMessages = [];

    for (const message of batch.messages || []) {
      const payload = parseQueueMessageBody(message);
      if (payload?.type === 'pdf-reader') {
        try {
          const stores = createReadLaterStores(env, { requireAssets: true });
          if (!stores) throw new Error('PDF storage unavailable');
          const item = await stores.readLaterStore.getItem(payload.itemId);
          if (!item) continue;
          const itemId = getReadLaterAssetItemId(item);
          const reader = await buildPdfReader({ url: item.url, title: item.title, itemId, assetStore: stores.assetStore, env, log: logger.log });
          await stores.assetStore.saveReader(itemId, reader);
          const latest = await stores.readLaterStore.getItem(item.id);
          if (latest) await stores.readLaterStore.saveItem({ ...latest, title: reader.title });
        } catch (error) {
          logger.log('warn', 'pdf_reader_retry_failed', { itemId: payload.itemId, message: error.message });
          if (error.retryable !== false) message.retry({ delaySeconds: 60 });
        }
        continue;
      }
      if (payload?.type === COVER_MESSAGE_TYPE) {
        coverMessages.push(message);
        continue;
      }
      if (payload?.type === PUSH_NOTIFICATION_MESSAGE_TYPE) {
        logger.log('warn', 'push_message_received_on_read_later_queue', {
          stage: 'queue',
          type: payload?.type || null
        });
        continue;
      }
      kindleMessages.push(message);
    }

    if (kindleMessages.length > 0) {
      await processKindleSyncBatch({ messages: kindleMessages }, env, logger.log);
    }

    if (coverMessages.length > 0) {
      await processCoverSyncBatch({ messages: coverMessages }, env, logger.log);
    }
  }
};
