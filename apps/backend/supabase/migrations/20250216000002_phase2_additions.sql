CREATE TABLE IF NOT EXISTS secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL,
  name text NOT NULL,
  provider text NOT NULL DEFAULT 'vault',
  path text NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_secrets_project_id_name ON secrets(project_id, name);

CREATE TABLE IF NOT EXISTS artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_runs(id) ON DELETE CASCADE,
  stage_run_id uuid REFERENCES stage_runs(id) ON DELETE CASCADE,
  type text NOT NULL,
  uri text NOT NULL,
  size bigint,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_stage_run_id ON artifacts(stage_run_id);

CREATE TABLE IF NOT EXISTS terraform_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL,
  name text NOT NULL,
  workspace_type text NOT NULL DEFAULT 'persistent',
  state_backend jsonb,
  locked boolean NOT NULL DEFAULT false,
  lock_holder text,
  last_lock_ts timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_terraform_workspaces_project_id_name ON terraform_workspaces(project_id, name);

CREATE TABLE IF NOT EXISTS integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NULL,
  kind text NOT NULL,
  config jsonb NOT NULL,
  created_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_integrations_project_id_kind ON integrations(project_id, kind);
