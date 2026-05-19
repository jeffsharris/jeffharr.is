import { createLogger } from '../../functions/api/lib/logger.js';
import { processIosPushBatch } from '../../functions/api/push/ios-push-service.js';

export default {
  async fetch() {
    return new Response('push-delivery worker', { status: 200 });
  },

  async queue(batch, env) {
    const logger = createLogger({ source: 'push-delivery-worker' });
    await processIosPushBatch(batch, env, logger.log);
  }
};
