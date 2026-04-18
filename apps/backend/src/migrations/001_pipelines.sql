CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL,
  name text NOT NULL DEFAULT 'Untitled Pipeline',
  definition jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipelines_project_id ON pipelines(project_id);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid REFERENCES pipelines(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued',
  signature text,
  trigger text,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipeline_id ON pipeline_runs(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);

CREATE TABLE IF NOT EXISTS stage_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_run_id uuid REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  stage_id text NOT NULL,
  stage_label text,
  status text NOT NULL DEFAULT 'queued',
  logs_uri text,
  outputs jsonb,
  started_at timestamptz,
  finished_at timestamptz,
  last_heartbeat timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stage_runs_pipeline_run_id ON stage_runs(pipeline_run_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  ttl timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);
