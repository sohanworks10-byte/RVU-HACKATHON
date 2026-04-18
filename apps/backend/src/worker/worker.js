import { query } from '../infra/db.js';
import { isPhase2Enabled, isPhase3Enabled } from '../infra/flags.js';
import { topologicalLayers } from '../services/dag.service.js';
import * as runService from '../services/run.service.js';
import * as log from '../services/log.service.js';
import * as artifactsService from '../services/artifacts.service.js';
import { executeStage, executeTerraformResume } from '../services/executor.service.js';
import { archive } from '../services/log.service.js';
import { reconcileStaleStages } from '../services/recon.service.js';
import { onRunQueued } from '../services/workerQueue.service.js';
import * as workspaceService from '../services/workspace.service.js';
import * as auditService from '../services/audit.service.js';
import { withLock as withRedlock } from '../infra/redlock.js';
import { terraformDestroy, runScriptInDocker, getWorkspacePath } from '../services/terraform-engine.service.js';
import { startPreviewGcLoop, runPreviewGcOnce } from '../jobs/preview-gc.job.js';
import { processBlueGreenSoakOnce } from '../jobs/bluegreen-soak.job.js';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function processPhase3Once() {
  if (!isPhase3Enabled()) return;
  if (process.env.NODE_ENV === 'test') {
    await processWorkspaceTasksOnce();
    await processBlueGreenSoakOnce();
    return;
  }

  await processWorkspaceTasksOnce().catch(() => {});
  await processBlueGreenSoakOnce().catch(() => {});
}

function workspaceLockKey(workspaceName) {
  return `terraform:state:${workspaceName}`;
}

function isSafeWorkspaceName(name) {
  const n = String(name || '');
  return n.startsWith('preview-') || n.startsWith('bg-');
}

async function transitionWorkspace({ id, fromStatuses, toStatus, actorId, action, meta, patchState }) {
  const res = await query(
    `update terraform_workspaces
     set status = $3,
         state = coalesce(state, '{}'::jsonb) || coalesce($4::jsonb, '{}'::jsonb)
     where id = $1 and status = any($2)
     returning *`,
    [id, fromStatuses, toStatus, JSON.stringify(patchState || {})]
  );
  const updated = res.rows[0] || null;
  if (updated) {
    await auditService.writeAuditLog({
      actor_id: actorId || null,
      action,
      resource_type: 'terraform_workspace',
      resource_id: id,
      before_state: null,
      after_state: updated,
      meta: meta || null,
    });
  }
  return updated;
}

async function claimNextWorkspaceByStatus(status) {
  // Claim one row by moving it into a working status atomically
  if (status === 'destroy_queued') {
    if (process.env.NODE_ENV === 'test') {
      const pick = await query(
        `select * from terraform_workspaces
         where status = 'destroy_queued'
         order by expires_at nulls first, created_at asc
         limit 1`
      );
      const row = pick.rows[0];
      if (!row) return null;
      const upd = await query(
        `update terraform_workspaces
         set status = 'destroying'
         where id = $1 and status = 'destroy_queued'
         returning *`,
        [row.id]
      );
      const claimed = upd.rows[0] || null;
      if (claimed) {
        await workspaceService.mergeWorkspaceState(claimed.id, { destroy_started_at: new Date().toISOString() }).catch(() => {});
      }
      return claimed;
    }

    const res = await query(
      `with c as (
         select id from terraform_workspaces
         where status = 'destroy_queued'
         order by expires_at nulls first, created_at asc
         limit 1
         for update skip locked
       )
       update terraform_workspaces tw
       set status = 'destroying',
           state = coalesce(state, '{}'::jsonb) || jsonb_build_object('destroy_started_at', now()::text)
       from c
       where tw.id = c.id
       returning tw.*`
    );
    return res.rows[0] || null;
  }

  if (status === 'switch_approved') {
    if (process.env.NODE_ENV === 'test') {
      const pick = await query(
        `select * from terraform_workspaces
         where status = 'switch_approved'
         order by created_at asc
         limit 1`
      );
      const row = pick.rows[0];
      if (!row) return null;
      const upd = await query(
        `update terraform_workspaces
         set status = 'switching'
         where id = $1 and status = 'switch_approved'
         returning *`,
        [row.id]
      );
      const claimed = upd.rows[0] || null;
      if (claimed) {
        await workspaceService.mergeWorkspaceState(claimed.id, { switch_started_at: new Date().toISOString() }).catch(() => {});
      }
      return claimed;
    }

    const res = await query(
      `with c as (
         select id from terraform_workspaces
         where status = 'switch_approved'
         order by created_at asc
         limit 1
         for update skip locked
       )
       update terraform_workspaces tw
       set status = 'switching',
           state = coalesce(state, '{}'::jsonb) || jsonb_build_object('switch_started_at', now()::text)
       from c
       where tw.id = c.id
       returning tw.*`
    );
    return res.rows[0] || null;
  }

  return null;
}

async function reconcileWorkspaceTasks() {
  // If a previous worker died mid-operation, re-queue after a threshold.
  // We only use DB state; no in-memory locks.
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  await query(
    `update terraform_workspaces
     set status = 'destroy_queued',
         state = coalesce(state, '{}'::jsonb) || jsonb_build_object('requeued_at', now()::text)
     where status = 'destroying'
       and (state->>'destroy_started_at')::timestamptz < now() - interval '30 minutes'`
  ).catch(() => {});

  await query(
    `update terraform_workspaces
     set status = 'switch_approved',
         state = coalesce(state, '{}'::jsonb) || jsonb_build_object('requeued_at', now()::text)
     where status = 'switching'
       and (state->>'switch_started_at')::timestamptz < now() - interval '30 minutes'`
  ).catch(() => {});
}

async function processWorkspaceDestroy(ws) {
  const workspaceName = ws.workspace_name || ws.name;
  if (!isSafeWorkspaceName(workspaceName)) {
    const failed = await workspaceService.updateWorkspace(ws.id, {
      status: 'destroy_failed',
      state: { ...(ws.state || {}), error: 'unsafe workspace name' },
    });
    await auditService.writeAuditLog({
      actor_id: null,
      action: 'workspace.destroy.failed',
      resource_type: 'terraform_workspace',
      resource_id: ws.id,
      before_state: ws,
      after_state: failed,
      meta: { project_id: String(ws.project_id || '') },
    });
    return;
  }

  await auditService.writeAuditLog({
    actor_id: null,
    action: 'workspace.destroy.start',
    resource_type: 'terraform_workspace',
    resource_id: ws.id,
    before_state: ws,
    after_state: ws,
    meta: { project_id: String(ws.project_id || '') },
  });

  const lockKey = workspaceLockKey(workspaceName);
  await withRedlock(
    { key: lockKey, ttlMs: Number(process.env.REDIS_LOCK_TTL_MS || 60 * 60 * 1000), waitMs: 5 * 60 * 1000 },
    async () => {
      const workspacePath = getWorkspacePath(workspaceName);

      const runId = ws.run_id || 'workspace';
      const stageRunId = ws.run_id || ws.id;
      await log.publish({ runId, stageRunId, line: `[Workspace] Destroying ${workspaceName}` });

      const result = await terraformDestroy({ workspacePath, env: {} });
      if (result.stdout) await log.publish({ runId, stageRunId, line: result.stdout });
      if (result.stderr) await log.publish({ runId, stageRunId, line: result.stderr });

      const after = await workspaceService.updateWorkspace(ws.id, {
        status: result.success ? 'destroyed' : 'destroy_failed',
        state: { ...(ws.state || {}), destroy_finished_at: new Date().toISOString(), destroy_success: result.success },
      });

      await auditService.writeAuditLog({
        actor_id: null,
        action: result.success ? 'workspace.destroy.success' : 'workspace.destroy.failed',
        resource_type: 'terraform_workspace',
        resource_id: ws.id,
        before_state: ws,
        after_state: after,
        meta: { project_id: String(ws.project_id || '') },
      });
    }
  );
}

async function processWorkspaceSwitch(ws) {
  const workspaceName = ws.workspace_name || ws.name;
  if (!isSafeWorkspaceName(workspaceName)) {
    const failed = await workspaceService.updateWorkspace(ws.id, {
      status: 'switch_failed',
      state: { ...(ws.state || {}), error: 'unsafe workspace name' },
    });
    await auditService.writeAuditLog({
      actor_id: null,
      action: 'workspace.switch.failed',
      resource_type: 'terraform_workspace',
      resource_id: ws.id,
      before_state: ws,
      after_state: failed,
      meta: { project_id: String(ws.project_id || '') },
    });
    return;
  }

  const switchScript = ws.state?.switch_script;
  if (!switchScript) {
    const failed = await workspaceService.updateWorkspace(ws.id, {
      status: 'switch_failed',
      state: { ...(ws.state || {}), error: 'missing switch_script in workspace state' },
    });
    await auditService.writeAuditLog({
      actor_id: null,
      action: 'workspace.switch.failed',
      resource_type: 'terraform_workspace',
      resource_id: ws.id,
      before_state: ws,
      after_state: failed,
      meta: { project_id: String(ws.project_id || '') },
    });
    return;
  }

  await auditService.writeAuditLog({
    actor_id: null,
    action: 'workspace.switch.start',
    resource_type: 'terraform_workspace',
    resource_id: ws.id,
    before_state: ws,
    after_state: ws,
    meta: { project_id: String(ws.project_id || '') },
  });

  const lockKey = workspaceLockKey(workspaceName);
  await withRedlock(
    { key: lockKey, ttlMs: Number(process.env.REDIS_LOCK_TTL_MS || 60 * 60 * 1000), waitMs: 5 * 60 * 1000 },
    async () => {
      const runId = ws.run_id || 'workspace';
      const stageRunId = ws.run_id || ws.id;
      const result = await runScriptInDocker({ runId, stageRunId, script: switchScript, env: {}, timeoutMs: 10 * 60 * 1000 });

      const after = await workspaceService.updateWorkspace(ws.id, {
        status: result.success ? 'soaking' : 'switch_failed',
        state: {
          ...(ws.state || {}),
          switch_finished_at: new Date().toISOString(),
          switch_success: result.success,
          soak_started_at: new Date().toISOString(),
          // optional scripts are stored in state by pipeline/worker
        },
      });

      await auditService.writeAuditLog({
        actor_id: null,
        action: result.success ? 'workspace.switch.success' : 'workspace.switch.failed',
        resource_type: 'terraform_workspace',
        resource_id: ws.id,
        before_state: ws,
        after_state: after,
        meta: { project_id: String(ws.project_id || '') },
      });
    }
  );
}

async function processWorkspaceTasksOnce() {
  if (!isPhase3Enabled()) return;

  const toDestroy = await claimNextWorkspaceByStatus('destroy_queued');
  if (toDestroy) {
    await processWorkspaceDestroy(toDestroy);
    return;
  }

  const toSwitch = await claimNextWorkspaceByStatus('switch_approved');
  if (toSwitch) {
    await processWorkspaceSwitch(toSwitch);
    return;
  }
}

async function tryMarkRunRunning(runId) {
  const res = await query(
    `update pipeline_runs
     set status = 'running'
     where id = $1 and status in ('queued','awaiting_approval')
     returning *`,
    [runId]
  );
  return res.rows[0] || null;
}

async function setRunStatus(runId, status) {
  await runService.updateRunStatus(runId, status);
  await log.publishRunStatus({ runId, status });
}

async function setStageStatus(runId, stageRunId, status, extras) {
  await runService.updateStageStatus(stageRunId, status, extras);
  await log.publishStatus({ runId, stageRunId, status });
}

function stageDefForNode(node) {
  const data = node.data || {};
  return {
    type: data.type || data.kind || 'script',
    label: data.label || node.id,
    image: data.image,
    script: data.script,
    command: data.command,
    server_id: data.server_id,
    timeout_ms: data.timeout_ms,
    // Phase-2 additions
    workspace_name: data.workspace_name,
    backend: data.backend,
    environment: data.environment,
    var_files: data.var_files,
    mode: data.mode,
    smoke_test_script: data.smoke_test_script,
    switch_script: data.switch_script,
    rollback_script: data.rollback_script,
    health_check_script: data.health_check_script,
    soak_ms: data.soak_ms,
    health_interval_ms: data.health_interval_ms,
    fail_threshold: data.fail_threshold,
    auto_switch: data.auto_switch,
    // GitHub Actions
    repo: data.repo,
    workflow_id: data.workflow_id,
    ref: data.ref,
    inputs: data.inputs,
    // Jenkins
    job_name: data.job_name,
    jenkins_config: data.jenkins_config,
    parameters: data.parameters,
  };
}

async function processRun(runId) {
  const runRow = await runService.loadRunWithPipeline(runId);
  if (!runRow) return;

  const projectId = runRow.project_id || null;

  const pipeline = runRow.pipeline_definition;
  const nodes = (pipeline && pipeline.nodes) || [];
  const edges = (pipeline && pipeline.edges) || [];

  const stageRuns = await runService.listStageRuns(runId);
  const stageRunByStageId = new Map(stageRuns.map((sr) => [String(sr.stage_id), sr]));

  const layers = topologicalLayers(nodes, edges);

  for (const layer of layers) {
    const layerPromises = layer.map(async (nodeId) => {
      const node = nodes.find((n) => String(n.id) === String(nodeId));
      if (!node) return { ok: true };

      const sr = stageRunByStageId.get(String(node.id));
      if (!sr) return { ok: true };
      if (sr.status === 'success') return { ok: true };
      if (sr.status === 'awaiting_approval') return { ok: false, awaitingApproval: true };
      if (sr.status === 'failed') return { ok: false };

      const stageDef = stageDefForNode(node);

      if (stageDef.type === 'approval') {
        await setStageStatus(runId, sr.id, 'awaiting_approval', { outputs: { requested_at: new Date().toISOString() } });
        await setRunStatus(runId, 'awaiting_approval');
        return { ok: false, awaitingApproval: true };
      }

      await setStageStatus(runId, sr.id, 'running', { started_at: new Date().toISOString(), last_heartbeat: new Date().toISOString() });

      let heartbeatTimer = null;
      heartbeatTimer = setInterval(() => {
        runService.updateStageStatus(sr.id, 'running', { last_heartbeat: new Date().toISOString() }).catch(() => {});
      }, 30 * 1000);

      try {
        let result;
        const priorOutputs = sr.outputs || {};
        if (
          stageDef.type === 'terraform' &&
          sr.status === 'queued' &&
          priorOutputs &&
          priorOutputs.planUri &&
          priorOutputs.approved_at &&
          !priorOutputs.applied
        ) {
          result = await executeTerraformResume({ runId, stageRunId: sr.id, stageDef, ctx: { projectId }, planUri: priorOutputs.planUri });
        } else {
          result = await executeStage({ runId, stageRunId: sr.id, stageDef, ctx: { projectId } });
        }

        const logs_uri = await archive({ runId, stageRunId: sr.id });
        if (isPhase2Enabled()) {
          try {
            await artifactsService.createArtifact({ run_id: runId, stage_run_id: sr.id, type: 'logs', uri: logs_uri, size: null });
          } catch {}
        }
        // Phase-3: persist blue/green scripts + soak params to workspace state for switch + soak + rollback
        if (stageDef.type === 'terraform' && result && result.outputs && result.outputs.awaiting_approval) {
          try {
            const mode = result.outputs.mode || stageDef.mode;
            if (mode === 'blue_green') {
              const wsRes = await query('select * from terraform_workspaces where run_id = $1 limit 1', [runId]);
              const ws = wsRes.rows[0];
              if (ws && stageDef.switch_script) {
                await workspaceService.mergeWorkspaceState(ws.id, {
                  switch_script: stageDef.switch_script,
                  rollback_script: stageDef.rollback_script || null,
                  health_check_script: stageDef.health_check_script || null,
                  soak_ms: stageDef.soak_ms || null,
                  health_interval_ms: stageDef.health_interval_ms || null,
                  fail_threshold: stageDef.fail_threshold || null,
                });
              }
            }
          } catch {}
        }

        if (result && result.outputs && result.outputs.awaiting_approval) {
          await setStageStatus(runId, sr.id, 'awaiting_approval', {
            outputs: result.outputs || null,
            logs_uri,
          });
          await setRunStatus(runId, 'awaiting_approval');
          return { ok: false, awaitingApproval: true };
        }

        // Phase-3: ephemeral terraform success -> sync outputs to workspace
        if (stageDef.type === 'terraform' && result && result.success && result.outputs && result.outputs.mode === 'ephemeral') {
          try {
            const wsRes = await query('select * from terraform_workspaces where run_id = $1 limit 1', [runId]);
            const ws = wsRes.rows[0];
            if (ws) {
              await workspaceService.mergeWorkspaceState(ws.id, { outputs: result.outputs.outputs || null });
              const updated = await workspaceService.updateWorkspace(ws.id, { status: 'applied' });
              await auditService.writeAuditLog({
                actor_id: null,
                action: 'preview.applied',
                resource_type: 'terraform_workspace',
                resource_id: ws.id,
                before_state: ws,
                after_state: updated,
                meta: { project_id: String(ws.project_id || '') },
              });
            }
          } catch {}
        }

        await setStageStatus(runId, sr.id, result.success ? 'success' : 'failed', {
          finished_at: new Date().toISOString(),
          outputs: result.outputs || null,
          logs_uri,
        });

        if (!result.success) {
          return { ok: false };
        }

        return { ok: true };
      } catch (e) {
        const logs_uri = await archive({ runId, stageRunId: sr.id });
        if (isPhase2Enabled()) {
          try {
            await artifactsService.createArtifact({ run_id: runId, stage_run_id: sr.id, type: 'logs', uri: logs_uri, size: null });
          } catch {}
        }
        await log.publish({ runId, stageRunId: sr.id, line: String(e?.message || e) });
        await setStageStatus(runId, sr.id, 'failed', {
          finished_at: new Date().toISOString(),
          outputs: { error: String(e?.message || e) },
          logs_uri,
        });
        return { ok: false };
      } finally {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
      }
    });

    const results = await Promise.all(layerPromises);
    const awaitingApproval = results.some((r) => r && r.awaitingApproval);
    if (awaitingApproval) return;

    const anyFailed = results.some((r) => !r.ok);
    if (anyFailed) {
      await setRunStatus(runId, 'failed');
      return;
    }
  }

  await setRunStatus(runId, 'success');
}

export async function processRunOnce(runId) {
  const marked = await tryMarkRunRunning(runId);
  if (marked) {
    await setRunStatus(runId, 'running');
  }

  await processRun(runId);
}

async function pollLoop() {
  // reconcile first
  await reconcileStaleStages({}).catch(() => {});

  if (isPhase3Enabled()) {
    await reconcileWorkspaceTasks();
    await runPreviewGcOnce().catch(() => {});
  }

  while (true) {
    if (isPhase3Enabled()) {
      await processWorkspaceTasksOnce().catch(() => {});
      await processBlueGreenSoakOnce().catch(() => {});
    }

    const runIds = await runService.listQueuedRuns(3);
    for (const runId of runIds) {
      const marked = await tryMarkRunRunning(runId);
      if (!marked) continue;

      await setRunStatus(runId, 'running');
      await processRun(runId);
    }

    await sleep(1000);
  }
}

export async function startWorker() {
  let wake = null;
  onRunQueued(() => {
    if (wake) wake();
  });

  if (isPhase3Enabled()) {
    startPreviewGcLoop({ intervalMs: 60 * 60 * 1000 });
  }

  // Lightweight wake mechanism: we still poll every 1s.
  pollLoop().catch(() => {});
}
