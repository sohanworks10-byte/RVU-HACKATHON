import { query } from '../infra/db.js';

export async function getPipeline(pipelineId) {
  try {
    const res = await query('SELECT * FROM pipelines WHERE id = $1', [pipelineId]);
    return res.rows[0] || null;
  } catch (e) {
    // If pipelines table doesn't exist yet (no DB / no migration), return null gracefully
    if (
      String(e?.message || '').includes('DATABASE_NOT_CONFIGURED') ||
      String(e?.message || '').includes('does not exist')
    ) {
      return null;
    }
    throw e;
  }
}

export async function listPipelines({ projectId, limit = 50 } = {}) {
  try {
    if (projectId) {
      const res = await query(
        'SELECT * FROM pipelines WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2',
        [projectId, limit]
      );
      return res.rows;
    }
    const res = await query('SELECT * FROM pipelines ORDER BY created_at DESC LIMIT $1', [limit]);
    return res.rows;
  } catch (e) {
    if (
      String(e?.message || '').includes('DATABASE_NOT_CONFIGURED') ||
      String(e?.message || '').includes('does not exist')
    ) {
      return [];
    }
    throw e;
  }
}

export async function createPipeline({ projectId, name, definition }) {
  const res = await query(
    `INSERT INTO pipelines (project_id, name, definition)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [projectId, name || 'Untitled Pipeline', definition || {}]
  );
  return res.rows[0];
}

export async function updatePipeline(pipelineId, { name, definition }) {
  const fields = [];
  const values = [pipelineId];
  let idx = 2;

  if (name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(name);
  }
  if (definition !== undefined) {
    fields.push(`definition = $${idx++}`);
    values.push(definition);
  }

  if (fields.length === 0) return getPipeline(pipelineId);

  const sql = `UPDATE pipelines SET ${fields.join(', ')} WHERE id = $1 RETURNING *`;
  const res = await query(sql, values);
  return res.rows[0] || null;
}

export async function deletePipeline(pipelineId) {
  const res = await query('DELETE FROM pipelines WHERE id = $1 RETURNING *', [pipelineId]);
  return res.rows[0] || null;
}
