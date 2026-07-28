CREATE TABLE IF NOT EXISTS academy_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES user_profiles(id) ON DELETE CASCADE,
  key_last_four char(4) NOT NULL,
  encrypted_api_key text NOT NULL,
  credential_hash char(64) NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  revealed_at timestamptz,
  reveal_count integer NOT NULL DEFAULT 0,
  rotated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academy_credential_aliases (
  credential_hash char(64) PRIMARY KEY,
  credential_id uuid NOT NULL REFERENCES academy_credentials(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS academy_credential_scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  credential_id uuid NOT NULL REFERENCES academy_credentials(id) ON DELETE CASCADE,
  scope_type text NOT NULL CHECK (scope_type IN ('model','service')),
  scope_key text NOT NULL,
  source_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('provisioning','active','suspended','revoked','expired','failed')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(credential_id,scope_type,scope_key,source_id)
);
CREATE INDEX IF NOT EXISTS academy_credential_scopes_lookup
  ON academy_credential_scopes(credential_id,scope_type,scope_key,status);

ALTER TABLE api_subscriptions ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES academy_credentials(id);
ALTER TABLE service_entitlements ADD COLUMN IF NOT EXISTS credential_id uuid REFERENCES academy_credentials(id);

INSERT INTO academy_credentials(user_id,key_last_four,encrypted_api_key,credential_hash,status,revealed_at,reveal_count,rotated_at,created_at,updated_at)
SELECT DISTINCT ON (subscription.user_id)
  subscription.user_id,subscription.key_last_four,subscription.encrypted_api_key,subscription.credential_hash,
  CASE WHEN subscription.status='active' THEN 'active' ELSE 'revoked' END,
  subscription.revealed_at,subscription.reveal_count,subscription.rotated_at,subscription.created_at,now()
FROM api_subscriptions subscription
WHERE subscription.credential_kind='academy_gateway'
  AND subscription.encrypted_api_key IS NOT NULL
  AND subscription.credential_hash IS NOT NULL
ORDER BY subscription.user_id,
  CASE WHEN subscription.status='active' THEN 0 ELSE 1 END,
  subscription.created_at DESC
ON CONFLICT(user_id) DO NOTHING;

INSERT INTO academy_credential_aliases(credential_hash,credential_id,status)
SELECT subscription.credential_hash,credential.id,
  CASE WHEN subscription.status='active' THEN 'active' ELSE 'revoked' END
FROM api_subscriptions subscription
JOIN academy_credentials credential ON credential.user_id=subscription.user_id
WHERE subscription.credential_kind='academy_gateway'
  AND subscription.credential_hash IS NOT NULL
  AND subscription.credential_hash<>credential.credential_hash
ON CONFLICT(credential_hash) DO NOTHING;

UPDATE api_subscriptions subscription
SET credential_id=credential.id
FROM academy_credentials credential
WHERE credential.user_id=subscription.user_id
  AND subscription.credential_kind='academy_gateway'
  AND subscription.credential_id IS NULL;

INSERT INTO academy_credential_scopes(credential_id,scope_type,scope_key,source_id,status,expires_at)
SELECT DISTINCT subscription.credential_id,'model',deployment.value,subscription.id,
  CASE subscription.status WHEN 'active' THEN 'active' WHEN 'expired' THEN 'expired' ELSE 'revoked' END,
  subscription.expires_at
FROM api_subscriptions subscription
CROSS JOIN LATERAL jsonb_array_elements_text(subscription.allowed_deployments) deployment(value)
WHERE subscription.credential_id IS NOT NULL
ON CONFLICT(credential_id,scope_type,scope_key,source_id) DO NOTHING;

ALTER TABLE service_entitlements DROP CONSTRAINT IF EXISTS service_entitlements_status_check;
ALTER TABLE service_entitlements ADD CONSTRAINT service_entitlements_status_check
  CHECK (status IN ('provisioning','active','failed','suspended','revoked','expired'));

CREATE TABLE IF NOT EXISTS service_provisioning_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL REFERENCES service_entitlements(id) ON DELETE CASCADE,
  operation text NOT NULL DEFAULT 'provision' CHECK (operation IN ('provision','deprovision')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed')),
  attempt_count integer NOT NULL DEFAULT 0,
  idempotency_key text NOT NULL UNIQUE,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS service_provisioning_jobs_entitlement_idx
  ON service_provisioning_jobs(entitlement_id,created_at DESC);

CREATE TABLE IF NOT EXISTS academy_service_records (
  entitlement_id uuid NOT NULL REFERENCES service_entitlements(id) ON DELETE CASCADE,
  collection text NOT NULL,
  record_key text NOT NULL,
  value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(entitlement_id,collection,record_key)
);

CREATE TABLE IF NOT EXISTS academy_service_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL REFERENCES service_entitlements(id) ON DELETE CASCADE,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'available' CHECK (status IN ('available','acknowledged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz
);
CREATE INDEX IF NOT EXISTS academy_service_messages_available_idx
  ON academy_service_messages(entitlement_id,topic,status,created_at);

CREATE TABLE IF NOT EXISTS academy_service_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entitlement_id uuid NOT NULL REFERENCES service_entitlements(id) ON DELETE CASCADE,
  service_type text NOT NULL,
  operation text NOT NULL,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS academy_service_jobs_entitlement_idx
  ON academy_service_jobs(entitlement_id,created_at DESC);
