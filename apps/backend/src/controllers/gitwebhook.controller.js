import crypto from 'crypto';

import { query } from '../infra/db.js';
import * as workspaceService from '../services/workspace.service.js';
import * as runService from '../services/run.service.js';
import * as pipelineService from '../services/pipeline.service.js';
import { notifyRunQueued } from '../services/workerQueue.service.js';
import * as auditService from '../services/audit.service.js';
import { postPRComment } from '../services/github-actions.service.js';
import { resolvePreviewPipelineForRepo } from '../services/repo-mapping.service.js';

function verifyGitHubSignature({ secret, rawBody, signature }) {
  if (!secret) return false;
  if (!rawBody) return false;
  if (!signature) return false;

  const expected =
    'sha256=' +
    crypto
      .createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(String(signature)));
  } catch {
    return false;
  }
}

async function recordIdempotencyKey({ key, ttlMinutes = 60 }) {
  const ttl = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
  try {
    const res = await query(
      'insert into idempotency_keys (key, ttl) values ($1,$2) on conflict do nothing returning key',
      [key, ttl]
    );
    return res.rows.length > 0;
  } catch {
    return false;
  }
}

export async function handleGitWebhook(req, res) {
  const provider = (req.get('x-git-provider') || 'github').toLowerCase();
  if (provider !== 'github') {
    return res.status(400).json({ error: 'unsupported provider' });
  }

  if (process.env.NODE_ENV === 'test' && !req.rawBody && req.body) {
    try {
      req.rawBody = Buffer.from(JSON.stringify(req.body));
    } catch {}
  }

  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  const sig = req.get('x-hub-signature-256');

  if (!verifyGitHubSignature({ secret, rawBody: req.rawBody, signature: sig })) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  const deliveryId = req.get('x-github-delivery');
  if (deliveryId) {
    const inserted = await recordIdempotencyKey({ key: `gh_delivery:${deliveryId}`, ttlMinutes: 24 * 60 });
    if (!inserted) {
      return res.json({ ok: true, duplicate: true });
    }
  }

  const event = req.get('x-github-event');
  const payload = req.body || {};

  if (event !== 'pull_request') {
    return res.json({ ok: true, ignored: true });
  }

  const action = payload.action;
  const pr = payload.pull_request;
  if (!pr) return res.json({ ok: true });

  const repo = payload.repository?.full_name;
  const branch = pr.head?.ref;
  const pr_number = pr.number;
  const headSha = pr.head?.sha;

  // For now we only mark workspaces for destroy on close.
  if (action === 'closed' || action === 'merged') {
    const matches = await workspaceService.listWorkspaces({ projectId: null, repo, pr_number, limit: 50 });
    for (const ws of matches) {
      if (ws.workspace_mode !== 'ephemeral') continue;
      await workspaceService.updateWorkspace(ws.id, { status: 'destroy_queued' });
      await auditService.writeAuditLog({
        actor_id: null,
        action: 'preview.destroy.webhook',
        resource_type: 'terraform_workspace',
        resource_id: ws.id,
        before_state: ws,
        after_state: { ...ws, status: 'destroy_queued' },
        meta: { repo, pr_number, branch, project_id: String(ws.project_id || '') },
      });
    }
    return res.json({ ok: true, action: 'destroy_queued', count: matches.length });
  }

  if (action === 'opened' || action === 'synchronize' || action === 'edited' || action === 'reopened') {
    if (!repo || !pr_number || !headSha) {
      return res.status(400).json({ error: 'missing repo/pr/sha' });
    }

    const idemKey = `gh_pr:${repo}:${pr_number}:${headSha}`;
    const inserted = await recordIdempotencyKey({ key: idemKey, ttlMinutes: 7 * 24 * 60 });
    if (!inserted) {
      return res.json({ ok: true, duplicate: true, action: 'noop' });
    }

    const mapping = await resolvePreviewPipelineForRepo({ repo });
    if (!mapping?.pipeline_id) {
      return res.status(404).json({ error: 'no preview pipeline mapping for repo' });
    }
    const pipelineId = mapping.pipeline_id;

    const pipeline = await pipelineService.getPipeline(pipelineId);
    if (!pipeline) return res.status(404).json({ error: 'pipeline not found' });

    const def = pipeline.definition || {};
    const nodes = def.nodes || [];

    // Reuse existing workspace for this PR if present
    let ws = await workspaceService.findActiveWorkspaceForPr({ repo, pr_number });

    if (ws && ws.state && ws.state.head_sha === headSha && ['creating', 'applied', 'running'].includes(String(ws.status))) {
      return res.json({ ok: true, action: 'noop', reason: 'already_processed', workspace_id: ws.id });
    }

    const signature = crypto.createHash('sha256').update(String(idemKey)).digest('hex');
    const run = await runService.createRun({
      pipelineId: pipelineId,
      signature,
      trigger: 'preview',
      created_by: null,
      nodes,
    });

    if (ws) {
      const before = ws;
      ws = await workspaceService.setWorkspaceRun({ workspaceId: ws.id, run_id: run.id, status: 'creating' });
      await workspaceService.mergeWorkspaceState(ws.id, { head_sha: headSha });
      await auditService.writeAuditLog({
        actor_id: null,
        action: 'preview.update.webhook',
        resource_type: 'terraform_workspace',
        resource_id: ws.id,
        before_state: before,
        after_state: ws,
        meta: { repo, pr_number, branch, headSha, project_id: String(ws.project_id || '') },
      });
    } else {
      // Create new workspace record
      const shortId = crypto.createHash('sha256').update(String(idemKey)).digest('hex').slice(0, 8);
      const workspace_name = workspaceService.buildPreviewWorkspaceName({ pr_number, branch, shortId });
      const ttlMin = Number(process.env.PREVIEW_DEFAULT_TTL_MINUTES || 1440);
      const expiresAt = new Date(Date.now() + ttlMin * 60 * 1000).toISOString();

      ws = await workspaceService.createWorkspace({
        project_id: pipeline.project_id,
        pipeline_id: pipelineId,
        run_id: run.id,
        workspace_name,
        workspace_mode: 'ephemeral',
        git_provider: 'github',
        repo,
        branch,
        pr_number,
        created_by_uuid: null,
        expires_at: expiresAt,
        state: { head_sha: headSha },
        status: 'creating',
      });

      await auditService.writeAuditLog({
        actor_id: null,
        action: 'preview.create.webhook',
        resource_type: 'terraform_workspace',
        resource_id: ws.id,
        before_state: null,
        after_state: ws,
        meta: { repo, pr_number, branch, headSha, project_id: String(ws.project_id || '') },
      });
    }

    notifyRunQueued(run.id);

    // Post PR comment
    const baseUrl = process.env.PUBLIC_BASE_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || ''}`;
    const previewUrl = `${baseUrl}/previews/${ws.id}`;

    try {
      const fresh = await workspaceService.getWorkspace(ws.id);
      if (fresh && fresh.state && fresh.state.last_commented_sha === headSha) {
        return res.json({ ok: true, action: 'preview_create', workspace_id: ws.id, run_id: run.id, commented: false });
      }

      const integration = await (async () => {
        const r = await query(
          "SELECT * FROM integrations WHERE kind = 'github' ORDER BY created_at DESC LIMIT 1"
        );
        return r.rows[0] || null;
      })();
      if (integration?.config) {
        await postPRComment({
          repo,
          prNumber: pr_number,
          body: `Preview ready: ${previewUrl}\nWorkspace: ${ws.workspace_name || ws.name}`,
          integrationConfig: integration.config,
        });
        await workspaceService.mergeWorkspaceState(ws.id, { last_commented_sha: headSha });
      }
    } catch {}

    return res.json({ ok: true, action: ws ? 'preview_update' : 'preview_create', workspace_id: ws.id, run_id: run.id });
  }

  return res.json({ ok: true, ignored: true, action });
}
