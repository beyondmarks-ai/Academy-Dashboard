ALTER TABLE api_access_requests
  ADD COLUMN IF NOT EXISTS review_notes text NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS api_subscriptions_access_request_unique
  ON api_subscriptions(access_request_id)
  WHERE access_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS api_requests_status_created_idx
  ON api_access_requests(status, created_at DESC);
