PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  canonical_key TEXT NOT NULL UNIQUE,
  canonical_url TEXT,
  source_url TEXT,
  title TEXT NOT NULL,
  subtitle TEXT,
  summary TEXT,
  creator TEXT,
  publisher TEXT,
  published_at TEXT,
  language TEXT,
  thumbnail_asset_id TEXT,
  primary_asset_id TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_kind ON items(kind);
CREATE INDEX IF NOT EXISTS idx_items_published_at ON items(published_at);
CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  r2_key TEXT,
  mime_type TEXT,
  width INTEGER,
  height INTEGER,
  duration_seconds REAL,
  byte_size INTEGER,
  alt_text TEXT,
  content_sha256 TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assets_item_role ON assets(item_id, role);
CREATE INDEX IF NOT EXISTS idx_assets_r2_key ON assets(r2_key);

CREATE TABLE IF NOT EXISTS lists (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT,
  visibility TEXT NOT NULL,
  kind TEXT NOT NULL,
  sort_mode TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS list_entries (
  id TEXT PRIMARY KEY,
  list_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  status TEXT NOT NULL,
  position REAL,
  note TEXT,
  added_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  extra_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (list_id) REFERENCES lists(id) ON DELETE CASCADE,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  UNIQUE (list_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_list_entries_list_added ON list_entries(list_id, added_at);
CREATE INDEX IF NOT EXISTS idx_list_entries_item ON list_entries(item_id);
CREATE INDEX IF NOT EXISTS idx_list_entries_status ON list_entries(status);

CREATE TABLE IF NOT EXISTS entry_tags (
  entry_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, tag),
  FOREIGN KEY (entry_id) REFERENCES list_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS item_sources (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_id TEXT,
  source_url TEXT,
  storage_kind TEXT,
  storage_key TEXT,
  source_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_item_sources_item ON item_sources(item_id);
CREATE INDEX IF NOT EXISTS idx_item_sources_source ON item_sources(source_kind, source_id);

CREATE TABLE IF NOT EXISTS article_details (
  item_id TEXT PRIMARY KEY,
  word_count INTEGER,
  reading_time_minutes INTEGER,
  reader_asset_id TEXT,
  site_name TEXT,
  byline TEXT,
  excerpt TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (reader_asset_id) REFERENCES assets(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dharma_talk_details (
  item_id TEXT PRIMARY KEY,
  corpus TEXT NOT NULL,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  speaker TEXT,
  duration_seconds REAL,
  audio_asset_id TEXT,
  artwork_asset_id TEXT,
  chapters_asset_id TEXT,
  transcript_asset_id TEXT,
  venue TEXT,
  series TEXT,
  extra_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  FOREIGN KEY (audio_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY (artwork_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY (chapters_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  FOREIGN KEY (transcript_asset_id) REFERENCES assets(id) ON DELETE SET NULL,
  UNIQUE (corpus, source, source_id)
);

CREATE TABLE IF NOT EXISTS share_details (
  item_id TEXT PRIMARY KEY,
  share_slug TEXT NOT NULL UNIQUE,
  share_url TEXT,
  render_kind TEXT NOT NULL,
  share_count INTEGER NOT NULL DEFAULT 0,
  visibility TEXT NOT NULL DEFAULT 'unlisted',
  extra_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  rendered_at TEXT,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS read_state (
  entry_id TEXT PRIMARY KEY,
  read_at TEXT,
  progress_ratio REAL,
  progress_json TEXT NOT NULL DEFAULT '{}',
  kindle_status TEXT,
  kindle_json TEXT NOT NULL DEFAULT '{}',
  cover_sync_json TEXT NOT NULL DEFAULT '{}',
  push_channels_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES list_entries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS migration_audit (
  id TEXT PRIMARY KEY,
  source_kind TEXT NOT NULL,
  source_key TEXT NOT NULL,
  target_kind TEXT NOT NULL,
  target_id TEXT,
  checksum TEXT,
  status TEXT NOT NULL,
  error TEXT,
  migrated_at TEXT NOT NULL,
  UNIQUE (source_kind, source_key, target_kind)
);

CREATE INDEX IF NOT EXISTS idx_migration_audit_source ON migration_audit(source_kind, source_key);
CREATE INDEX IF NOT EXISTS idx_migration_audit_status ON migration_audit(status);

INSERT INTO lists (
  id,
  slug,
  title,
  description,
  visibility,
  kind,
  sort_mode,
  created_at,
  updated_at
) VALUES
  (
    'lst_starred',
    'starred',
    'Starred',
    'Default saved favorites across content types.',
    'private',
    'system',
    'added_desc',
    '2026-05-18T00:00:00.000Z',
    '2026-05-18T00:00:00.000Z'
  ),
  (
    'lst_read_later',
    'read-later',
    'Read Later',
    'Items saved for reading, watching, or listening later.',
    'public',
    'system',
    'added_desc',
    '2026-05-18T00:00:00.000Z',
    '2026-05-18T00:00:00.000Z'
  )
ON CONFLICT(slug) DO NOTHING;
