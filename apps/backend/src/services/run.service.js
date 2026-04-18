import { query } from '../infra/db.js';

export async function createRun({ pipelineId, signature, trigger, created_by, nodes }) {
  const runRes = await query(
    `insert into pipeline_runs (pipeline_id, status, signature, trigger, created_by)
     values ($1, 'queued', $2, $3, $4)
     returning *`,
    [pipelineId, signature || null, trigger || null, created_by || null]
  );

  const run = runRes.rows[0];

  for (const n of nodes) {
    await query(
      `insert into stage_runs (pipeline_run_id, stage_id, stage_label, status)
       values ($1, $2, $3, 'queued')`,
      [run.id, String(n.id), n.data && n.data.label ? String(n.data.label) : null]
    );
  }

  return run;
}

export async function getRun(runId) {
  const runRes = await query('select * from pipeline_runs where id = $1', [runId]);
  const run = runRes.rows[0] || null;
  if (!run) return null;

  const stagesRes = await query(
    'select * from stage_runs where pipeline_run_id = $1 order by stage_id asc',
    [runId]
  );

  return { run, stages: stagesRes.rows };
}

export async function updateRunStatus(runId, status) {
  const res = await query('update pipeline_runs set status = $2 where id = $1 returning *', [runId, status]);
  return res.rows[0] || null;
}

export async function updateStageStatus(stageRunId, status, extras = {}) {
  const fields = [];
  const values = [stageRunId, status];
  let idx = 3;

  if (Object.prototype.hasOwnProperty.call(extras, 'logs_uri')) {
    fields.push(`logs_uri = $${idx++}`);
    values.push(extras.logs_uri);
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'outputs')) {
    fields.push(`outputs = $${idx++}`);
    values.push(extras.outputs);
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'started_at')) {
    fields.push(`started_at = $${idx++}`);
    values.push(extras.started_at);
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'finished_at')) {
    fields.push(`finished_at = $${idx++}`);
    values.push(extras.finished_at);
  }
  if (Object.prototype.hasOwnProperty.call(extras, 'last_heartbeat')) {
    fields.push(`last_heartbeat = $${idx++}`);
    values.push(extras.last_heartbeat);
  }

  const sql = `update stage_runs set status = $2${fields.length ? ', ' + fields.join(', ') : ''} where id = $1 returning *`;
  const res = await query(sql, values);
  return res.rows[0] || null;
}

export async function findStageRun(runId, stageRunId) {
  const res = await query('select * from stage_runs where id = $1 and pipeline_run_id = $2', [stageRunId, runId]);
  return res.rows[0] || null;
}

export async function findStageRunById(stageRunId) {
  const res = await query('select * from stage_runs where id = $1', [stageRunId]);
  return res.rows[0] || null;
}

export async function listQueuedRuns(limit = 5) {
  const res = await query(
    `select id from pipeline_runs
     where status = 'queued'
     order by created_at asc
     limit $1`,
    [limit]
  );
  return res.rows.map((r) => r.id);
}

export async function loadRunWithPipeline(runId) {
  const res = await query(
    `select pr.*, p.definition as pipeline_definition
     from pipeline_runs pr
     join pipelines p on p.id = pr.pipeline_id
     where pr.id = $1`,
    [runId]
  );
  return res.rows[0] || null;
}

export async function listStageRuns(runId) {
  const res = await query('select * from stage_runs where pipeline_run_id = $1', [runId]);
  return res.rows;
}
