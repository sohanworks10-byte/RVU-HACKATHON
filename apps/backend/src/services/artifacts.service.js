import { query } from '../infra/db.js';

export async function getArtifact(id) {
  const res = await query('select * from artifacts where id = $1', [id]);
  return res.rows[0] || null;
}

export async function createArtifact({ run_id, stage_run_id, type, uri, size }) {
  const res = await query(
    `insert into artifacts (run_id, stage_run_id, type, uri, size)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [run_id || null, stage_run_id || null, String(type), String(uri), size ?? null]
  );
  return res.rows[0];
}

export async function listArtifactsForRun(runId) {
  const res = await query('select * from artifacts where run_id = $1 order by created_at asc', [runId]);
  return res.rows;
}
