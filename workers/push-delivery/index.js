import { createLogger } from '../../functions/api/lib/logger.js';
import { processIosPushBatch } from '../../functions/api/push/ios-push-service.js';
import {
  createSyncStorage,
  withReadLaterStorage
} from '../../functions/api/content-library/kv-adapter.js';

export default {
  async fetch() {
    return new Response('push-delivery worker', { status: 200 });
  },

  async queue(batch, env) {
    const logger = createLogger({ source: 'push-delivery-worker' });
    const storage = createSyncStorage(env);
    await processIosPushBatch(batch, withReadLaterStorage(env, storage), logger.log);
  }
};
