CREATE TABLE IF NOT EXISTS public_save_limits (
  bucket TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
