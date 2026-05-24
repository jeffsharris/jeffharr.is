function getNowIso() {
  return new Date().toISOString();
}

function normalizePushChannels(item, now = getNowIso()) {
  const base = item?.pushChannels && typeof item.pushChannels === 'object' ? item.pushChannels : {};

  const readiness = base.readiness && typeof base.readiness === 'object'
    ? base.readiness
    : {};
  const kindle = base.kindle && typeof base.kindle === 'object'
    ? base.kindle
    : {};
  const ios = base.ios && typeof base.ios === 'object'
    ? base.ios
    : {};

  return {
    readiness: {
      status: readiness.status === 'ready' ? 'ready' : 'pending',
      readyAt: readiness.readyAt || null,
      reason: readiness.status === 'ready'
        ? null
        : (readiness.reason || 'waiting_for_reader_and_cover')
    },
    kindle: {
      status: normalizeChannelStatus(kindle.status),
      updatedAt: kindle.updatedAt || now,
      lastError: kindle.lastError || null
    },
    ios: {
      status: normalizeChannelStatus(ios.status),
      updatedAt: ios.updatedAt || now,
      eventId: ios.eventId || null,
      lastError: ios.lastError || null
    }
  };
}

function normalizeChannelStatus(status) {
  if (status === 'sent' || status === 'failed' || status === 'skipped' || status === 'queued') {
    return status;
  }
  return 'pending';
}

function createInitialPushChannels(now = getNowIso()) {
  return {
    readiness: {
      status: 'pending',
      readyAt: null,
      reason: 'waiting_for_reader_and_cover'
    },
    kindle: {
      status: 'pending',
      updatedAt: now,
      lastError: null
    },
    ios: {
      status: 'pending',
      updatedAt: now,
      eventId: null,
      lastError: null
    }
  };
}

function ensurePushChannels(item, now = getNowIso()) {
  const channels = normalizePushChannels(item, now);
  if (item && typeof item === 'object') {
    item.pushChannels = channels;
  }
  return channels;
}

function mapKindleStatusToChannelStatus(kindleStatus) {
  if (kindleStatus === 'synced') return 'sent';
  if (kindleStatus === 'failed') return 'failed';
  if (kindleStatus === 'unsupported' || kindleStatus === 'needs-content') return 'skipped';
  return 'pending';
}

function recordKindleChannelState(item, kindleState, now = getNowIso()) {
  if (!item || typeof item !== 'object') return item;
  ensurePushChannels(item, now);

  const mappedStatus = mapKindleStatusToChannelStatus(kindleState?.status || null);
  item.pushChannels.kindle = {
    status: mappedStatus,
    updatedAt: now,
    lastError: mappedStatus === 'failed'
      ? (kindleState?.lastError || 'Kindle sync failed')
      : null
  };

  return item;
}

export {
  createInitialPushChannels,
  ensurePushChannels,
  recordKindleChannelState
};
