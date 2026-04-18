import { query } from '../infra/db.js';
import * as workspaceService from '../services/workspace.service.js';
import * as auditService from '../services/audit.service.js';

export async function runPreviewGcOnce() {
  // Mark expired ephemeral previews for destroy
  const res = await query(
    `select * from terraform_workspaces
     where workspace_mode = 'ephemeral'
       and status in ('created','creating','applied','running')
       and expires_at is not null
       and expires_at < now()
     order by expires_at asc
     limit 50`
  );

  for (const ws of res.rows) {
    const before = ws;
    const updated = await workspaceService.updateWorkspace(ws.id, { status: 'destroy_queued' });
    await auditService.writeAuditLog({
      actor_id: null,
      action: 'preview.gc.destroy_queued',
      resource_type: 'terraform_workspace',
      resource_id: ws.id,
      before_state: before,
      after_state: updated,
      meta: { project_id: String(ws.project_id || ''), workspace_id: ws.id },
    });
  }

  return { marked: res.rows.length };
}

export function startPreviewGcLoop({ intervalMs = 60 * 60 * 1000 } = {}) {
  const tick = async () => {
    try {
      await runPreviewGcOnce();
    } catch {}
  };

  tick();
  return setInterval(tick, intervalMs);
}
