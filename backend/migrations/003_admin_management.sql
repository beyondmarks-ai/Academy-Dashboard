ALTER TABLE admission_invites
  ADD COLUMN IF NOT EXISTS assigned_role text NOT NULL DEFAULT 'student'
  CHECK (assigned_role IN ('student', 'admin', 'developer'));
