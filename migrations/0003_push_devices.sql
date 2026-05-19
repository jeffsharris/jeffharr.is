CREATE TABLE IF NOT EXISTS push_devices (
  owner_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  token TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  platform TEXT NOT NULL,
  environment TEXT NOT NULL,
  bundle_id TEXT,
  app_version TEXT,
  build_number TEXT,
  registered_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_push_devices_owner ON push_devices(owner_id);
CREATE INDEX IF NOT EXISTS idx_push_devices_updated_at ON push_devices(updated_at);
