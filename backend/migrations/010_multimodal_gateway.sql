ALTER TABLE api_subscriptions DROP CONSTRAINT IF EXISTS api_subscriptions_quota_unit_check;
ALTER TABLE api_subscriptions ADD CONSTRAINT api_subscriptions_quota_unit_check
  CHECK (quota_unit IN ('requests','tokens','images','minutes','seconds'));

ALTER TABLE api_quota_allocations DROP CONSTRAINT IF EXISTS api_quota_allocations_quota_unit_check;
ALTER TABLE api_quota_allocations ADD CONSTRAINT api_quota_allocations_quota_unit_check
  CHECK (quota_unit IN ('requests','tokens','images','minutes','seconds'));

ALTER TABLE api_usage_events DROP CONSTRAINT IF EXISTS api_usage_events_quota_unit_check;
ALTER TABLE api_usage_events ADD CONSTRAINT api_usage_events_quota_unit_check
  CHECK (quota_unit IN ('requests','tokens','images','minutes','seconds'));

CREATE TABLE IF NOT EXISTS api_video_jobs (
  job_id text PRIMARY KEY,
  subscription_id uuid NOT NULL REFERENCES api_subscriptions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  deployment text NOT NULL,
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 1 AND 20),
  variants integer NOT NULL CHECK (variants BETWEEN 1 AND 5),
  status text NOT NULL DEFAULT 'queued',
  generations jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_video_jobs_subscription_idx
  ON api_video_jobs(subscription_id, created_at DESC);

CREATE TABLE IF NOT EXISTS api_video_generations (
  generation_id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES api_video_jobs(job_id) ON DELETE CASCADE,
  subscription_id uuid NOT NULL REFERENCES api_subscriptions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS api_video_generations_subscription_idx
  ON api_video_generations(subscription_id, created_at DESC);
