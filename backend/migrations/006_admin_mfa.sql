CREATE TABLE IF NOT EXISTS admin_mfa (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  encrypted_secret text NOT NULL,
  confirmed_at timestamptz,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_mfa_challenges (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('setup','login')),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_mfa_challenges_user_idx ON auth_mfa_challenges(user_id, created_at DESC);

UPDATE auth_sessions SET revoked_at = now()
WHERE user_id IN (SELECT id FROM user_profiles WHERE role = 'admin')
  AND revoked_at IS NULL;
