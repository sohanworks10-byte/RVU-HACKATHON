import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { query } from '../infra/db.js';
import { isPhase2Enabled } from '../infra/flags.js';
import * as pipelineService from '../services/pipeline.service.js';
import * as runService from '../services/run.service.js';
import * as artifactsService from '../services/artifacts.service.js';
import { executeTerraformResume } from '../services/executor.service.js';
import { notifyRunQueued } from '../services/workerQueue.service.js';

function computeSignature({ pipelineId, trigger, idempotency_key }) {
  if (idempotency_key) return String(idempotency_key);
  const ts = Math.floor(Date.now() / 1000);
  return `${pipelineId}:${trigger}:${ts}`;
}

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export async function startRun(req, res) {
  const { id } = req.params;
  const { trigger, created_by, idempotency_key } = req.body || {};

  const pipeline = await pipelineService.getPipeline(id);
  if (!pipeline) return res.status(404).json({ error: 'Pipeline not found' });

  const signature = sha256(computeSignature({ pipelineId: id, trigger: trigger || 'manual', idempotency_key }));

  // 5-minute idempotency window
  const existing = await query(
    `select id, status from pipeline_runs
     where pipeline_id = $1 and signature = $2 and created_at > now() - interval '5 minutes'
     order by created_at desc
     limit 1`,
    [id, signature]
  );

  if (existing.rows[0]) {
    return res.status(202).json({ runId: existing.rows[0].id, status: existing.rows[0].status });
  }

  const def = pipeline.definition || {};
  const nodes = def.nodes || [];

  const run = await runService.createRun({ pipelineId: id, signature, trigger: trigger || 'manual', created_by, nodes });

  notifyRunQueued(run.id);

  return res.status(202).json({ runId: run.id, status: run.status });
}

export async function getRun(req, res) {
  const { runId } = req.params;
  const result = await runService.getRun(runId);
  if (!result) return res.status(404).json({ error: 'Not found' });

  let artifacts = [];
  if (isPhase2Enabled()) {
    try {
      artifacts = await artifactsService.listArtifactsForRun(runId);
    } catch {}
  }

  return res.json({ pipeline_run: result.run, stage_runs: result.stages, artifacts });
}

export async function approveStage(req, res) {
  const { runId } = req.params;
  const { stage_run_id, action } = req.body || {};
  if (!stage_run_id) return res.status(400).json({ error: 'stage_run_id is required' });

  const sr = await runService.findStageRun(runId, stage_run_id);
  if (!sr) return res.status(404).json({ error: 'stage run not found' });

  if (sr.status !== 'awaiting_approval') {
    return res.status(409).json({ error: 'stage is not awaiting approval' });
  }

  const outputs = sr.outputs || {};

  // Check if this is a Terraform plan awaiting apply
  if (isPhase2Enabled() && outputs.planUri && action === 'apply') {
    // Resume Terraform apply
    const pipeline = (await runService.loadRunWithPipeline(runId))?.pipeline_definition || {};
    const node = (pipeline.nodes || []).find((n) => String(n.id) === String(sr.stage_id));
    if (!node) return res.status(404).json({ error: 'stage definition not found' });

    const stageDef = {
      type: node.data?.type || 'terraform',
      workspace_name: node.data?.workspace_name,
      backend: node.data?.backend,
      environment: node.data?.environment,
      var_files: node.data?.var_files,
      mode: 'apply_only',
    };

    // Queue the apply
    await runService.updateStageStatus(stage_run_id, 'queued', {
      outputs: { ...outputs, approved_at: new Date().toISOString() },
    });
    await runService.updateRunStatus(runId, 'queued');
    notifyRunQueued(runId);

    return res.json({ ok: true, resumed: 'terraform_apply' });
  }

  // Generic approval (e.g. blue/green traffic switch): action must be provided and match output approval_type when set
  if (action && outputs.approval_type && action !== outputs.approval_type) {
    return res.status(409).json({ error: 'approval action mismatch' });
  }

  // Regular approval
  await runService.updateStageStatus(stage_run_id, 'queued', { outputs: { ...outputs, approved_at: new Date().toISOString() } });
  await runService.updateRunStatus(runId, 'queued');

  notifyRunQueued(runId);

  return res.json({ ok: true });
}

export async function downloadLogs(req, res) {
  const { runId, stageRunId } = req.params;
  const result = await runService.getRun(runId);
  if (!result) return res.status(404).json({ error: 'run not found' });

  const sr = result.stages.find((s) => s.id === stageRunId);
  if (!sr) return res.status(404).json({ error: 'stage run not found' });

  if (sr.logs_uri) {
    return res.json({ logs_uri: sr.logs_uri });
  }

  const archivesPath = path.resolve('./archives', runId, `${stageRunId}.log.gz`);
  if (!fs.existsSync(archivesPath)) {
    return res.status(404).json({ error: 'logs not found' });
  }

  res.setHeader('Content-Type', 'application/gzip');
  return fs.createReadStream(archivesPath).pipe(res);
}
