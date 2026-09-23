CREATE TABLE IF NOT EXISTS client_credentials (
  token_hash TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('sukha', 'save')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS client_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  challenge TEXT NOT NULL,
  owner_email TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
