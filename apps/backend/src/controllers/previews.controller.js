import crypto from 'crypto';

import * as runService from '../services/run.service.js';
import * as pipelineService from '../services/pipeline.service.js';
import { notifyRunQueued } from '../services/workerQueue.service.js';
import * as workspaceService from '../services/workspace.service.js';
import * as auditService from '../services/audit.service.js';
import { requireRole } from '../middleware/rbac.js';

function sha256(input) {
  return crypto.createHash('sha256').update(String(input)).digest('hex');
}

export async function createPreview(req, res) {
  const { projectId } = req.params;
  const { pipeline_id, git_provider, repo, branch, pr_number, expires_in_minutes } = req.body || {};
  if (!pipeline_id) return res.status(400).json({ error: 'pipeline_id is required' });

  const pipeline = await pipelineService.getPipeline(pipeline_id);
  if (!pipeline) return res.status(404).json({ error: 'pipeline not found' });

  // Quota enforcement
  const quota = await workspaceService.getProjectPreviewQuota(projectId);
  const active = await workspaceService.countActivePreviews(projectId);
  if (active >= quota) {
    return res.status(429).json({ error: 'preview quota exceeded', quota, active });
  }

  const shortId = sha256(`${repo || ''}:${branch || ''}:${pr_number || ''}:${Date.now()}`).slice(0, 8);
  const workspace_name = workspaceService.buildPreviewWorkspaceName({ pr_number, branch, shortId });

  const expiresAt = expires_in_minutes ? new Date(Date.now() + Number(expires_in_minutes) * 60 * 1000) : null;

  // Create a run (Phase-1 startRun logic without idempotency window)
  const signature = sha256(`preview:${projectId}:${repo || ''}:${pr_number || ''}:${branch || ''}`);
  const def = pipeline.definition || {};
  const nodes = def.nodes || [];

  const run = await runService.createRun({
    pipelineId: pipeline_id,
    signature,
    trigger: 'preview',
    created_by: req.user?.id,
    nodes,
  });

  const ws = await workspaceService.createWorkspace({
    project_id: projectId,
    pipeline_id,
    run_id: run.id,
    workspace_name,
    workspace_mode: 'ephemeral',
    git_provider,
    repo,
    branch,
    pr_number,
    created_by_uuid: req.user?.id,
    expires_at: expiresAt ? expiresAt.toISOString() : null,
    state: {},
    status: 'creating',
  });

  await auditService.writeAuditLog({
    actor_id: req.user?.id,
    action: 'preview.create',
    resource_type: 'terraform_workspace',
    resource_id: ws.id,
    before_state: null,
    after_state: ws,
    meta: { project_id: String(projectId), repo, pr_number, branch },
  });

  notifyRunQueued(run.id);

  return res.status(201).json({
    workspace_id: ws.id,
    workspace_name: ws.workspace_name,
    status: ws.status,
    run_id: run.id,
    preview_url: `${process.env.PUBLIC_BASE_URL || ''}/previews/${ws.id}`,
  });
}

export async function listPreviews(req, res) {
  const { projectId } = req.params;
  const { repo, pr_number } = req.query || {};

  const previews = await workspaceService.listWorkspaces({
    projectId,
    repo: repo || null,
    pr_number: pr_number != null ? Number(pr_number) : null,
    limit: 50,
  });

  return res.json({ previews });
}

export async function getPreview(req, res) {
  const { workspaceId } = req.params;
  const ws = await workspaceService.getWorkspace(workspaceId);
  if (!ws) return res.status(404).json({ error: 'not found' });
  return res.json({ preview: ws });
}

export const destroyPreview = [
  requireRole('executor'),
  async (req, res) => {
    const { workspaceId } = req.params;
    const { confirm } = req.body || {};
    if (!confirm) return res.status(400).json({ error: 'confirm=true required' });

    const ws = await workspaceService.getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'not found' });

    if (ws.workspace_mode === 'persistent') {
      return res.status(409).json({ error: 'cannot destroy persistent workspace' });
    }

    const name = ws.workspace_name || ws.name;
    if (!String(name || '').startsWith('preview-') && !String(name || '').startsWith('bg-')) {
      return res.status(409).json({ error: 'unsafe workspace name' });
    }

    const updated = await workspaceService.updateWorkspace(workspaceId, { status: 'destroy_queued' });

    await auditService.writeAuditLog({
      actor_id: req.user?.id,
      action: 'preview.destroy.request',
      resource_type: 'terraform_workspace',
      resource_id: ws.id,
      before_state: ws,
      after_state: updated,
      meta: { project_id: String(ws.project_id) },
    });

    // Worker integration will pick this up in Phase-3 worker updates
    return res.json({ ok: true, preview: updated });
  },
];

export const approveSwitch = [
  requireRole('executor'),
  async (req, res) => {
    const { workspaceId } = req.params;
    const ws = await workspaceService.getWorkspace(workspaceId);
    if (!ws) return res.status(404).json({ error: 'not found' });

    const updated = await workspaceService.updateWorkspace(workspaceId, { status: 'switch_approved' });

    await auditService.writeAuditLog({
      actor_id: req.user?.id,
      action: 'bluegreen.switch.approve',
      resource_type: 'terraform_workspace',
      resource_id: ws.id,
      before_state: ws,
      after_state: updated,
      meta: { project_id: String(ws.project_id) },
    });

    return res.json({ ok: true, preview: updated });
  },
];
