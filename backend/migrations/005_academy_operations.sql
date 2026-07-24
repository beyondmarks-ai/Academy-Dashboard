ALTER TABLE user_profiles DROP CONSTRAINT IF EXISTS user_profiles_status_check;
ALTER TABLE user_profiles ADD CONSTRAINT user_profiles_status_check
  CHECK (status IN ('active', 'pending', 'rejected', 'suspended'));
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS admission_number text;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES user_profiles(id);
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS rejection_reason text;
CREATE UNIQUE INDEX IF NOT EXISTS user_profiles_admission_number_unique
  ON user_profiles (upper(admission_number)) WHERE admission_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  duration text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  created_by uuid NOT NULL REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS course_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES courses(id),
  student_id uuid NOT NULL REFERENCES user_profiles(id),
  progress smallint NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  status text NOT NULL DEFAULT 'enrolled' CHECK (status IN ('enrolled','in_progress','completed','withdrawn')),
  notes text NOT NULL DEFAULT '',
  enrolled_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id, student_id)
);

CREATE TABLE IF NOT EXISTS certificate_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  blob_name text NOT NULL,
  prompt text NOT NULL DEFAULT '',
  version integer NOT NULL,
  active boolean NOT NULL DEFAULT false,
  uploaded_by uuid NOT NULL REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS certificates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_number text NOT NULL UNIQUE,
  enrollment_id uuid NOT NULL REFERENCES course_enrollments(id),
  template_id uuid REFERENCES certificate_templates(id),
  student_name text NOT NULL,
  admission_number text NOT NULL,
  course_title text NOT NULL,
  completion_date date NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','generating','validation_failed','issued','revoked')),
  image_blob_name text,
  pdf_blob_name text,
  generation_attempts integer NOT NULL DEFAULT 0,
  validation_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  issued_by uuid REFERENCES user_profiles(id),
  issued_at timestamptz,
  revoked_by uuid REFERENCES user_profiles(id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notification_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  message text NOT NULL,
  category text NOT NULL DEFAULT 'Platform update',
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','important','urgent')),
  publish_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  cancelled_at timestamptz,
  created_by uuid NOT NULL REFERENCES user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notification_recipients (
  campaign_id uuid NOT NULL REFERENCES notification_campaigns(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES user_profiles(id) ON DELETE CASCADE,
  read_at timestamptz,
  PRIMARY KEY(campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS notification_recipients_user_idx ON notification_recipients(user_id, campaign_id);
