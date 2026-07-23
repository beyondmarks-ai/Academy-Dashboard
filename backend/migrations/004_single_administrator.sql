CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_single_administrator
  ON user_profiles ((role))
  WHERE role = 'admin';

CREATE UNIQUE INDEX IF NOT EXISTS admission_invites_single_unclaimed_administrator
  ON admission_invites ((assigned_role))
  WHERE assigned_role = 'admin' AND claimed_by IS NULL;
