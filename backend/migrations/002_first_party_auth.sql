ALTER TABLE user_profiles ALTER COLUMN entra_object_id DROP NOT NULL;
ALTER TABLE user_profiles ALTER COLUMN email DROP NOT NULL;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS academy_id text;

CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_academy_id_unique
  ON user_profiles (lower(academy_id))
  WHERE academy_id IS NOT NULL;

ALTER TABLE admission_invites ADD COLUMN IF NOT EXISTS allowed_academy_id text;
UPDATE admission_invites
SET allowed_academy_id = lower(allowed_email)
WHERE allowed_academy_id IS NULL AND allowed_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(id) ON DELETE CASCADE,
  password_hash text NOT NULL,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  ip_hash char(64),
  user_agent text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  key_hash char(64) PRIMARY KEY,
  attempts integer NOT NULL,
  window_started_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_rate_limits_updated_idx ON auth_rate_limits(updated_at);
