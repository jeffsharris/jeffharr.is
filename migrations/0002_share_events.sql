CREATE TABLE IF NOT EXISTS share_events (
  id TEXT PRIMARY KEY,
  share_slug TEXT NOT NULL,
  item_id TEXT NOT NULL,
  source_url TEXT,
  title TEXT,
  summary TEXT,
  image_url TEXT,
  creator TEXT,
  publisher TEXT,
  shared_at TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_share_events_shared_at ON share_events(shared_at);
CREATE INDEX IF NOT EXISTS idx_share_events_share_slug ON share_events(share_slug);
