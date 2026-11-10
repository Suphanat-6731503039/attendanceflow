ALTER TABLE attendance_workspace ADD COLUMN last_operation_id TEXT;
CREATE INDEX IF NOT EXISTS attendance_workspace_operation ON attendance_workspace(last_operation_id);
