CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY NOT NULL,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'instructor')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_attempts (
  attempt_key TEXT NOT NULL,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_attempts_window ON auth_attempts(attempt_key, attempted_at);

CREATE TABLE IF NOT EXISTS setup_tokens (
  token_hash TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at TEXT,
  claimed_by TEXT
);

CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  claimed_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invitations_expiry ON invitations(expires_at);

CREATE TABLE IF NOT EXISTS attendance_workspace (
  id TEXT PRIMARY KEY NOT NULL CHECK (id = 'shared'),
  data_json TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL REFERENCES accounts(id)
);
