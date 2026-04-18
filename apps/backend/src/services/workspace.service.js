import { query } from '../infra/db.js';

export function slugify(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

export async function findActiveWorkspaceForPr({ repo, pr_number }) {
  const res = await query(
    `select * from terraform_workspaces
     where repo = $1 and pr_number = $2
       and workspace_mode = 'ephemeral'
       and status not in ('destroyed')
     order by created_at desc
     limit 1`,
    [repo, pr_number]
  );
  return res.rows[0] || null;
}

export async function setWorkspaceRun({ workspaceId, run_id, status }) {
  const res = await query(
    `update terraform_workspaces
     set run_id = $2,
         status = coalesce($3, status)
     where id = $1
     returning *`,
    [workspaceId, run_id || null, status || null]
  );
  return res.rows[0] || null;
}

export async function mergeWorkspaceState(id, statePatch = {}) {
  if (process.env.NODE_ENV === 'test') {
    const cur = await getWorkspace(id);
    const merged = { ...(cur?.state || {}), ...(statePatch || {}) };
    const res = await query(
      `update terraform_workspaces
       set state = $2
       where id = $1
       returning *`,
      [id, JSON.stringify(merged)]
    );
    return res.rows[0] || null;
  }

  const res = await query(
    `update terraform_workspaces
     set state = coalesce(state, '{}'::jsonb) || $2::jsonb
     where id = $1
     returning *`,
    [id, JSON.stringify(statePatch || {})]
  );
  return res.rows[0] || null;
}

export function buildPreviewWorkspaceName({ pr_number, branch, shortId }) {
  const b = slugify(branch || 'branch');
  const pr = pr_number ? `pr-${pr_number}` : b;
  return `preview-${pr}-${shortId}`.slice(0, 63);
}

export async function getProjectPreviewQuota(projectId) {
  const res = await query('select max_previews from project_quota_preview where project_id = $1', [projectId]);
  return res.rows[0]?.max_previews ?? 10;
}

export async function countActivePreviews(projectId) {
  const res = await query(
    `select count(*)::int as c
     from terraform_workspaces
     where project_id = $1 and workspace_mode = 'ephemeral' and status in ('created','creating','applied','running')`,
    [projectId]
  );
  return res.rows[0]?.c ?? 0;
}

export async function createWorkspace({
  project_id,
  pipeline_id,
  run_id,
  workspace_name,
  workspace_mode,
  git_provider,
  repo,
  branch,
  pr_number,
  created_by_uuid,
  expires_at,
  state,
  status,
}) {
  const res = await query(
    `insert into terraform_workspaces (
      project_id, pipeline_id, run_id,
      name,
      workspace_name, workspace_mode,
      git_provider, repo, branch, pr_number,
      created_by_uuid, expires_at,
      state, status
    ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
    returning *`,
    [
      project_id,
      pipeline_id || null,
      run_id || null,
      workspace_name,
      workspace_name,
      workspace_mode,
      git_provider || null,
      repo || null,
      branch || null,
      pr_number || null,
      created_by_uuid || null,
      expires_at || null,
      state || {},
      status || 'created',
    ]
  );
  return res.rows[0];
}

export async function getWorkspace(id) {
  const res = await query('select * from terraform_workspaces where id = $1', [id]);
  return res.rows[0] || null;
}

export async function listWorkspaces({ projectId, repo, pr_number, limit = 50 } = {}) {
  const res = await query(
    `select * from terraform_workspaces
     where ($1::uuid is null or project_id = $1)
       and ($2::text is null or repo = $2)
       and ($3::int is null or pr_number = $3)
     order by created_at desc
     limit $4`,
    [projectId || null, repo || null, pr_number ?? null, limit]
  );
  return res.rows;
}

export async function updateWorkspace(id, patch = {}) {
  const fields = [];
  const values = [id];
  let idx = 2;

  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k} = $${idx++}`);
    values.push(v);
  }

  if (!fields.length) return getWorkspace(id);

  const res = await query(`update terraform_workspaces set ${fields.join(', ')} where id = $1 returning *`, values);
  return res.rows[0] || null;
}

export async function markWorkspaceDestroyed(id) {
  return updateWorkspace(id, { status: 'destroyed' });
}
