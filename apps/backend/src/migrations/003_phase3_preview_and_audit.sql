-- Phase-3: previews, audit logs, quotas, idempotency

-- Extend existing terraform_workspaces table (Phase-2) for Phase-3 preview and blue/green flows
ALTER TABLE terraform_workspaces
  ADD COLUMN IF NOT EXISTS pipeline_id uuid NULL,
  ADD COLUMN IF NOT EXISTS run_id uuid NULL,
  ADD COLUMN IF NOT EXISTS workspace_name text NULL,
  ADD COLUMN IF NOT EXISTS workspace_mode text NULL,
  ADD COLUMN IF NOT EXISTS git_provider text NULL,
  ADD COLUMN IF NOT EXISTS repo text NULL,
  ADD COLUMN IF NOT EXISTS branch text NULL,
  ADD COLUMN IF NOT EXISTS pr_number integer NULL,
  ADD COLUMN IF NOT EXISTS created_by_uuid uuid NULL,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'created';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'terraform_workspaces' AND column_name = 'name'
  ) THEN
    UPDATE terraform_workspaces
    SET workspace_name = COALESCE(workspace_name, name)
    WHERE workspace_name IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'terraform_workspaces' AND column_name = 'workspace_type'
  ) THEN
    UPDATE terraform_workspaces
    SET workspace_mode = COALESCE(workspace_mode, workspace_type)
    WHERE workspace_mode IS NULL;
  END IF;
END $$;

ALTER TABLE terraform_workspaces
  ALTER COLUMN workspace_mode SET DEFAULT 'persistent';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'terraform_workspaces_workspace_mode_check'
  ) THEN
    ALTER TABLE terraform_workspaces
      ADD CONSTRAINT terraform_workspaces_workspace_mode_check
      CHECK (workspace_mode IN ('persistent','ephemeral','blue-green'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_terraform_workspaces_project ON terraform_workspaces(project_id);
CREATE INDEX IF NOT EXISTS idx_terraform_workspaces_repo_pr ON terraform_workspaces(repo, pr_number);

CREATE TABLE IF NOT EXISTS project_quota_preview (
  project_id uuid PRIMARY KEY,
  max_previews int DEFAULT 10
);

CREATE TABLE IF NOT EXISTS project_roles (
  project_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, user_id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'project_roles_role_check'
  ) THEN
    ALTER TABLE project_roles
      ADD CONSTRAINT project_roles_role_check
      CHECK (role IN ('viewer','editor','executor','admin'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_project_roles_project ON project_roles(project_id);
CREATE INDEX IF NOT EXISTS idx_project_roles_user ON project_roles(user_id);

CREATE TABLE IF NOT EXISTS project_repo_pipelines (
  project_id uuid NOT NULL,
  repo text NOT NULL,
  pipeline_id uuid NOT NULL,
  previews_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, repo)
);

CREATE INDEX IF NOT EXISTS idx_project_repo_pipelines_repo ON project_repo_pipelines(repo);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid NULL,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text NULL,
  before_state jsonb NULL,
  after_state jsonb NULL,
  meta jsonb NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  run_id uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  ttl timestamptz NOT NULL
);
