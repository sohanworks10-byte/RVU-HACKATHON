import * as pipelineService from '../services/pipeline.service.js';
import { query } from '../infra/db.js';

export async function listRepoMappings(req, res) {
  const { projectId } = req.params;
  const rows = await query(
    `select project_id, repo, pipeline_id, previews_enabled, created_at
     from project_repo_pipelines
     where project_id = $1
     order by created_at desc`,
    [projectId]
  );
  return res.json({ mappings: rows.rows });
}

export async function createRepoMapping(req, res) {
  const { projectId } = req.params;
  const { repo, pipeline_id, previews_enabled } = req.body || {};
  if (!repo) return res.status(400).json({ error: 'repo is required' });
  if (!pipeline_id) return res.status(400).json({ error: 'pipeline_id is required' });

  const pipeline = await pipelineService.getPipeline(pipeline_id);
  if (!pipeline || String(pipeline.project_id || '') !== String(projectId)) {
    return res.status(400).json({ error: 'pipeline_id must belong to project' });
  }

  try {
    const r = await query(
      `insert into project_repo_pipelines (project_id, repo, pipeline_id, previews_enabled)
       values ($1,$2,$3,$4)
       returning project_id, repo, pipeline_id, previews_enabled, created_at`,
      [projectId, String(repo), pipeline_id, previews_enabled == null ? true : Boolean(previews_enabled)]
    );
    return res.status(201).json({ mapping: r.rows[0] });
  } catch (e) {
    if (String(e?.message || '').toLowerCase().includes('duplicate') || String(e?.message || '').toLowerCase().includes('unique')) {
      return res.status(409).json({ error: 'repo mapping already exists for this project' });
    }
    throw e;
  }
}

export async function updateRepoMapping(req, res) {
  const { projectId, repo } = req.params;
  const { pipeline_id, previews_enabled } = req.body || {};

  if (pipeline_id) {
    const pipeline = await pipelineService.getPipeline(pipeline_id);
    if (!pipeline || String(pipeline.project_id || '') !== String(projectId)) {
      return res.status(400).json({ error: 'pipeline_id must belong to project' });
    }
  }

  const r = await query(
    `update project_repo_pipelines
     set pipeline_id = coalesce($3, pipeline_id),
         previews_enabled = coalesce($4, previews_enabled)
     where project_id = $1 and repo = $2
     returning project_id, repo, pipeline_id, previews_enabled, created_at`,
    [projectId, String(repo), pipeline_id ?? null, previews_enabled == null ? null : Boolean(previews_enabled)]
  );

  const row = r.rows[0] || null;
  if (!row) return res.status(404).json({ error: 'not found' });
  return res.json({ mapping: row });
}

export async function deleteRepoMapping(req, res) {
  const { projectId, repo } = req.params;
  const r = await query(
    `delete from project_repo_pipelines
     where project_id = $1 and repo = $2
     returning project_id, repo, pipeline_id, previews_enabled, created_at`,
    [projectId, String(repo)]
  );
  const row = r.rows[0] || null;
  if (!row) return res.status(404).json({ error: 'not found' });
  return res.json({ ok: true, mapping: row });
}
