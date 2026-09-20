CREATE TABLE IF NOT EXISTS content_versions (
  version varchar(64) PRIMARY KEY,
  seeded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cards (
  id varchar(80) PRIMARY KEY,
  content_version varchar(64) NOT NULL,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS spreads (
  id varchar(80) PRIMARY KEY,
  content_version varchar(64) NOT NULL,
  data jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS readings (
  id uuid PRIMARY KEY,
  session_hash varchar(64) NOT NULL,
  status varchar(32) NOT NULL,
  question_encrypted text NOT NULL,
  clarification_encrypted text,
  result_encrypted text,
  state jsonb NOT NULL,
  content_version varchar(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS readings_session_idx ON readings(session_hash);
CREATE INDEX IF NOT EXISTS readings_expiry_idx ON readings(expires_at);

CREATE TABLE IF NOT EXISTS interpretation_jobs (
  id uuid PRIMARY KEY,
  reading_id uuid NOT NULL UNIQUE REFERENCES readings(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS jobs_poll_idx ON interpretation_jobs(status, available_at);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  reading_id uuid NOT NULL REFERENCES readings(id) ON DELETE CASCADE,
  key varchar(128) NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (reading_id, key)
);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key varchar(64) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

