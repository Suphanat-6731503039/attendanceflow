ALTER TABLE accounts ADD COLUMN student_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_student_id ON accounts(student_id) WHERE student_id IS NOT NULL;

ALTER TABLE invitations ADD COLUMN role TEXT NOT NULL DEFAULT 'instructor'
  CHECK (role IN ('instructor', 'student'));
ALTER TABLE invitations ADD COLUMN student_id TEXT;
ALTER TABLE invitations ADD COLUMN session_id TEXT;
