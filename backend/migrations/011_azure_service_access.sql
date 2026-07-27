ALTER TABLE api_access_requests
  ADD COLUMN IF NOT EXISTS requested_deployments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS project_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS intended_use text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS estimated_usage text NOT NULL DEFAULT 'starter';

CREATE TABLE IF NOT EXISTS service_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  service_type text NOT NULL CHECK (service_type IN (
    'blob_storage','container_compute','machine_learning','database','functions',
    'document_intelligence','speech_vision','messaging','monitoring'
  )),
  project_name text NOT NULL CHECK (char_length(project_name) BETWEEN 2 AND 120),
  plan_code text NOT NULL CHECK (plan_code IN ('explore','build','scale','custom')),
  requested_quota bigint NOT NULL CHECK (requested_quota > 0),
  requested_unit text NOT NULL,
  use_case text NOT NULL CHECK (char_length(use_case) BETWEEN 10 AND 3000),
  configuration jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  review_notes text NOT NULL DEFAULT '',
  reviewed_by uuid REFERENCES user_profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_access_requests_user_idx ON service_access_requests(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_access_requests_review_idx ON service_access_requests(status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS service_access_requests_one_pending
  ON service_access_requests(user_id, service_type) WHERE status='pending';

CREATE TABLE IF NOT EXISTS service_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES service_access_requests(id),
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  display_name text NOT NULL,
  quota_limit bigint NOT NULL CHECK (quota_limit > 0),
  quota_unit text NOT NULL CHECK (quota_unit IN (
    'bytes','compute_minutes','gpu_minutes','database_mb','executions',
    'requests','pages','minutes','messages','events','log_mb'
  )),
  usage_count bigint NOT NULL DEFAULT 0 CHECK (usage_count >= 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked','expired')),
  resource_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (usage_count <= quota_limit)
);
CREATE INDEX IF NOT EXISTS service_entitlements_user_idx ON service_entitlements(user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS service_quota_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL REFERENCES service_entitlements(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES user_profiles(id),
  action text NOT NULL CHECK (action IN ('initial','top_up','reset','renew')),
  amount bigint NOT NULL CHECK (amount > 0),
  quota_unit text NOT NULL,
  previous_limit bigint,
  previous_usage bigint NOT NULL DEFAULT 0,
  expires_at timestamptz,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_quota_allocations_entitlement_idx
  ON service_quota_allocations(entitlement_id, created_at DESC);

CREATE TABLE IF NOT EXISTS service_usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL REFERENCES service_entitlements(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL UNIQUE,
  operation text NOT NULL,
  quantity bigint NOT NULL CHECK (quantity > 0),
  quota_unit text NOT NULL,
  status text NOT NULL DEFAULT 'succeeded' CHECK (status IN ('succeeded','failed','blocked')),
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_usage_events_entitlement_idx
  ON service_usage_events(entitlement_id, occurred_at DESC);
