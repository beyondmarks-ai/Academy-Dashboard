ALTER TABLE api_subscriptions
  ADD COLUMN IF NOT EXISTS encrypted_api_key text,
  ADD COLUMN IF NOT EXISTS quota_limit bigint,
  ADD COLUMN IF NOT EXISTS quota_unit text NOT NULL DEFAULT 'requests',
  ADD COLUMN IF NOT EXISTS usage_count bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS revealed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reveal_count integer NOT NULL DEFAULT 0;

ALTER TABLE api_subscriptions DROP CONSTRAINT IF EXISTS api_subscriptions_quota_unit_check;
ALTER TABLE api_subscriptions ADD CONSTRAINT api_subscriptions_quota_unit_check
  CHECK (quota_unit IN ('requests','tokens','images','minutes'));

ALTER TABLE api_subscriptions DROP CONSTRAINT IF EXISTS api_subscriptions_quota_values_check;
ALTER TABLE api_subscriptions ADD CONSTRAINT api_subscriptions_quota_values_check
  CHECK (
    (quota_limit IS NULL OR quota_limit > 0)
    AND usage_count >= 0
    AND (quota_limit IS NULL OR usage_count <= quota_limit)
  );

CREATE INDEX IF NOT EXISTS api_subscriptions_user_status_idx
  ON api_subscriptions(user_id, status, created_at DESC);
