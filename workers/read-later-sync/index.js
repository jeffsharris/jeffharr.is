import { createLogger } from '../../functions/api/lib/logger.js';
import { processKindleSyncBatch } from '../../functions/api/read-later/sync-service.js';

export default {
  async queue(batch, env) {
    const logger = createLogger({ source: 'read-later-sync-worker' });
    await processKindleSyncBatch(batch, env, logger.log);
  }
};
