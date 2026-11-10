CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expiry ON idempotency_keys(expires_at);

CREATE TABLE IF NOT EXISTS webhook_outbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  locked_until INTEGER,
  last_error TEXT,
  last_response_code INTEGER,
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX IF NOT EXISTS webhook_outbox_due ON webhook_outbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS webhook_inbox (
  event_id TEXT PRIMARY KEY NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'processed', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  locked_until INTEGER,
  last_error TEXT,
  received_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE INDEX IF NOT EXISTS webhook_inbox_due ON webhook_inbox(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS reconciliation_queue (
  id TEXT PRIMARY KEY NOT NULL,
  event_id TEXT NOT NULL,
  course_code TEXT NOT NULL,
  section_number TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('pending', 'reconciled', 'failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at INTEGER NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  reconciled_at TEXT
);
CREATE INDEX IF NOT EXISTS reconciliation_queue_due ON reconciliation_queue(status, next_attempt_at);
