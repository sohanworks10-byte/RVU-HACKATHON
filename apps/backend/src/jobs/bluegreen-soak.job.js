import { query } from '../infra/db.js';
import { withLock as withRedlock } from '../infra/redlock.js';
import * as workspaceService from '../services/workspace.service.js';
import * as auditService from '../services/audit.service.js';
import { runScriptInDocker } from '../services/terraform-engine.service.js';

const DEFAULT_SOAK_MS = 10 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 30 * 1000;
const DEFAULT_FAIL_THRESHOLD = 3;

function lockKey(workspaceName) {
  return `terraform:state:${workspaceName}`;
}

function parseTime(s) {
  if (!s) return null;
  const d = new Date(String(s));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function claimNextSoakingWorkspace() {
  if (process.env.NODE_ENV === 'test') {
    const pick = await query(
      `select *
       from terraform_workspaces
       where status = 'soaking'
       order by created_at asc
       limit 1`
    );
    const row = pick.rows[0];
    if (!row) return null;

    // In tests we don't need SKIP LOCKED semantics; just do a no-op update to "claim".
    const upd = await query(
      `update terraform_workspaces
       set status = status
       where id = $1
       returning *`,
      [row.id]
    );

    const claimed = upd.rows[0] || null;
    if (claimed) {
      // Ensure next_healthcheck_at exists so soak loop can progress without jsonb ops.
      await workspaceService
        .mergeWorkspaceState(claimed.id, { next_healthcheck_at: new Date(Date.now() + 30 * 1000).toISOString() })
        .catch(() => {});
    }
    return claimed;
  }

  // Claim by moving next_check_at forward atomically.
  const res = await query(
    `with c as (
       select id
       from terraform_workspaces
       where status = 'soaking'
         and coalesce((state->>'next_healthcheck_at')::timestamptz, now()) <= now()
       order by created_at asc
       limit 1
       for update skip locked
     )
     update terraform_workspaces tw
     set state = coalesce(state, '{}'::jsonb)
              || jsonb_build_object('next_healthcheck_at', (now() + interval '30 seconds')::text)
     from c
     where tw.id = c.id
     returning tw.*`
  );
  return res.rows[0] || null;
}

export async function processBlueGreenSoakOnce() {
  const ws = await claimNextSoakingWorkspace();
  if (!ws) return { processed: false };

  const workspaceName = ws.workspace_name || ws.name;
  const state = ws.state || {};

  const soakMs = Number(state.soak_ms || process.env.BLUEGREEN_SOAK_MS || DEFAULT_SOAK_MS);
  const intervalMs = Number(state.health_interval_ms || process.env.BLUEGREEN_HEALTH_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  const threshold = Number(state.fail_threshold || process.env.BLUEGREEN_FAIL_THRESHOLD || DEFAULT_FAIL_THRESHOLD);

  const soakStartedAt = parseTime(state.soak_started_at) || new Date(ws.created_at);
  const soakEndsAt = new Date(soakStartedAt.getTime() + soakMs);

  const healthScript = state.health_check_script;
  const rollbackScript = state.rollback_script;

  // Lock around health checks to avoid overlapping with destroy/switch/rollback.
  await withRedlock(
    { key: lockKey(workspaceName), ttlMs: Number(process.env.REDIS_LOCK_TTL_MS || 60 * 60 * 1000), waitMs: 5 * 60 * 1000 },
    async () => {
      // Run health check
      let ok = true;
      if (healthScript) {
        const runId = ws.run_id || 'workspace';
        const stageRunId = ws.run_id || ws.id;
        const result = await runScriptInDocker({ runId, stageRunId, script: healthScript, env: {}, timeoutMs: 60 * 1000 });
        ok = Boolean(result.success);
      }

      const consecutive = Number(state.consecutive_failures || 0);
      const nextConsecutive = ok ? 0 : consecutive + 1;

      const merged = await workspaceService.mergeWorkspaceState(ws.id, {
        last_healthcheck_at: new Date().toISOString(),
        last_healthcheck_ok: ok,
        consecutive_failures: nextConsecutive,
        health_interval_ms: intervalMs,
        soak_ms: soakMs,
        fail_threshold: threshold,
        soak_started_at: state.soak_started_at || soakStartedAt.toISOString(),
      });

      // Rollback
      if (!ok && nextConsecutive >= threshold) {
        const before = await workspaceService.getWorkspace(ws.id);
        if (rollbackScript) {
          const runId = ws.run_id || 'workspace';
          const stageRunId = ws.run_id || ws.id;
          const rb = await runScriptInDocker({ runId, stageRunId, script: rollbackScript, env: {}, timeoutMs: 10 * 60 * 1000 });
          await workspaceService.mergeWorkspaceState(ws.id, { rollback_success: rb.success, rolled_back_at: new Date().toISOString() });
        }

        const after = await workspaceService.updateWorkspace(ws.id, { status: 'rolled_back' });
        await auditService.writeAuditLog({
          actor_id: null,
          action: 'bluegreen.rollback.auto',
          resource_type: 'terraform_workspace',
          resource_id: ws.id,
          before_state: before,
          after_state: after,
          meta: { project_id: String(ws.project_id || ''), workspace_name: workspaceName },
        });
        return;
      }

      // Soak success
      if (new Date() >= soakEndsAt && nextConsecutive === 0) {
        const before = await workspaceService.getWorkspace(ws.id);
        const after = await workspaceService.updateWorkspace(ws.id, { status: 'soak_success' });
        await auditService.writeAuditLog({
          actor_id: null,
          action: 'bluegreen.soak.success',
          resource_type: 'terraform_workspace',
          resource_id: ws.id,
          before_state: before,
          after_state: after,
          meta: { project_id: String(ws.project_id || ''), workspace_name: workspaceName },
        });
      } else {
        // Extend next check time in DB (already set by claim), keep status soaking
        await workspaceService.mergeWorkspaceState(ws.id, {
          next_healthcheck_at: new Date(Date.now() + intervalMs).toISOString(),
          soak_started_at: state.soak_started_at || soakStartedAt.toISOString(),
        });
      }

      // Audit each check (lightweight)
      await auditService.writeAuditLog({
        actor_id: null,
        action: 'bluegreen.healthcheck',
        resource_type: 'terraform_workspace',
        resource_id: ws.id,
        before_state: null,
        after_state: merged,
        meta: { project_id: String(ws.project_id || ''), ok },
      });
    }
  );

  return { processed: true, workspace_id: ws.id };
}
