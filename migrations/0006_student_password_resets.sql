CREATE TABLE IF NOT EXISTS student_password_resets (
  id TEXT PRIMARY KEY NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  student_id TEXT NOT NULL,
  created_by TEXT NOT NULL REFERENCES accounts(id),
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at TEXT,
  claimed_by TEXT
);

CREATE INDEX IF NOT EXISTS student_password_resets_account ON student_password_resets(account_id, used_at);
