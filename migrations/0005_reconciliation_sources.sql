ALTER TABLE reconciliation_queue
ADD COLUMN source TEXT NOT NULL DEFAULT 'outbox' CHECK (source IN ('inbox', 'outbox'));
