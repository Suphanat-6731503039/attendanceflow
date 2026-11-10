ALTER TABLE accounts ADD COLUMN google_subject TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_google_subject ON accounts(google_subject) WHERE google_subject IS NOT NULL;

CREATE TABLE IF NOT EXISTS google_oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  redirect_uri TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS google_oauth_states_expiry ON google_oauth_states(expires_at);