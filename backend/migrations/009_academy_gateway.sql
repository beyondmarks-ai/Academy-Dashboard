ALTER TABLE api_subscriptions
  ADD COLUMN IF NOT EXISTS credential_hash char(64),
  ADD COLUMN IF NOT EXISTS credential_kind text NOT NULL DEFAULT 'legacy_provider',
  ADD COLUMN IF NOT EXISTS allowed_deployments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE api_subscriptions DROP CONSTRAINT IF EXISTS api_subscriptions_credential_kind_check;
ALTER TABLE api_subscriptions ADD CONSTRAINT api_subscriptions_credential_kind_check
  CHECK (credential_kind IN ('legacy_provider','academy_gateway'));

CREATE UNIQUE INDEX IF NOT EXISTS api_subscriptions_credential_hash_unique
  ON api_subscriptions(credential_hash) WHERE credential_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS api_quota_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES api_subscriptions(id) ON DELETE CASCADE,
  actor_id uuid NOT NULL REFERENCES user_profiles(id),
  action text NOT NULL CHECK (action IN ('initial','top_up','reset','renew')),
  amount bigint NOT NULL CHECK (amount > 0),
  quota_unit text NOT NULL CHECK (quota_unit IN ('requests','tokens','images','minutes')),
  previous_limit bigint,
  previous_usage bigint NOT NULL DEFAULT 0,
  expires_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_quota_allocations_subscription_idx
  ON api_quota_allocations(subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_gateway_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES api_subscriptions(id) ON DELETE CASCADE,
  reserved_units bigint NOT NULL CHECK (reserved_units > 0),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_gateway_reservations_subscription_idx
  ON api_gateway_reservations(subscription_id, expires_at);

CREATE TABLE IF NOT EXISTS api_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL REFERENCES api_subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  request_id text NOT NULL,
  deployment text NOT NULL,
  operation text NOT NULL,
  quota_unit text NOT NULL CHECK (quota_unit IN ('requests','tokens','images','minutes')),
  units_charged bigint NOT NULL DEFAULT 0 CHECK (units_charged >= 0),
  input_tokens bigint NOT NULL DEFAULT 0 CHECK (input_tokens >= 0),
  output_tokens bigint NOT NULL DEFAULT 0 CHECK (output_tokens >= 0),
  total_tokens bigint NOT NULL DEFAULT 0 CHECK (total_tokens >= 0),
  status_code integer NOT NULL,
  latency_ms integer NOT NULL DEFAULT 0 CHECK (latency_ms >= 0),
  upstream_request_id text,
  usage_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api_usage_events_request_unique
  ON api_usage_events(request_id);
CREATE INDEX IF NOT EXISTS api_usage_events_subscription_created_idx
  ON api_usage_events(subscription_id, created_at DESC);
