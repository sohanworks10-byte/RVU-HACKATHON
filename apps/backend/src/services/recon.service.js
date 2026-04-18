import { query } from '../infra/db.js';

export async function reconcileStaleStages({ staleMs = 3 * 60 * 1000 } = {}) {
  const cutoff = new Date(Date.now() - staleMs).toISOString();

  // Mark stale running stages as failed (crashed).
  const res = await query(
    `update stage_runs
     set status = 'failed', finished_at = now()
     where status = 'running'
       and (last_heartbeat is null or last_heartbeat < $1)
     returning id, pipeline_run_id`,
    [cutoff]
  );

  // Any run with at least one failed stage should be failed.
  const runIds = Array.from(new Set(res.rows.map((r) => r.pipeline_run_id)));
  for (const runId of runIds) {
    await query(
      `update pipeline_runs
       set status = 'failed'
       where id = $1 and status in ('running','queued','awaiting_approval')`,
      [runId]
    );
  }

  return { crashedStageRunIds: res.rows.map((r) => r.id), affectedRunIds: runIds };
}
