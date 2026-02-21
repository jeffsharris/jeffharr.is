import { createLogger } from '../../functions/api/lib/logger.js';
import { processKindleSyncBatch } from '../../functions/api/read-later/sync-service.js';
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
      if (payload?.type === COVER_MESSAGE_TYPE) {
        coverMessages.push(message);
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
