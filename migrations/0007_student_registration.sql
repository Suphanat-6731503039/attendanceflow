ALTER TABLE accounts ADD COLUMN account_kind TEXT NOT NULL DEFAULT 'staff'
  CHECK (account_kind IN ('staff', 'student'));
ALTER TABLE accounts ADD COLUMN student_code TEXT;
