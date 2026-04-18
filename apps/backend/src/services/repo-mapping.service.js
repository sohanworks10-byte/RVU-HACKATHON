import { query } from '../infra/db.js';

export async function resolvePreviewPipelineForRepo({ repo }) {
  const res = await query(
    `select prp.*
     from project_repo_pipelines prp
     where prp.repo = $1 and prp.previews_enabled = true
     order by prp.created_at desc
     limit 1`,
    [repo]
  );
  return res.rows[0] || null;
}
