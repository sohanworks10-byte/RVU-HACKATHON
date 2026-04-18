import * as log from './log.service.js';
import * as artifactsService from './artifacts.service.js';
import { putObject } from '../infra/s3.js';

// GitHub API base
const GITHUB_API_BASE = 'https://api.github.com';

function getAuthHeaders(integrationConfig) {
  const token = integrationConfig.github_token || integrationConfig.token;
  if (!token) throw new Error('GitHub token not configured');
  return {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubApi({ path, method = 'GET', body, headers = {} }) {
  const url = `${GITHUB_API_BASE}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GitHub API error (${res.status}): ${text || res.statusText}`);
  }

  if (res.status === 204) return null;
  return res.json();
}

export async function triggerWorkflow({ repo, workflowId, ref, inputs, integrationConfig }) {
  const [owner, repoName] = repo.split('/');
  if (!owner || !repoName) throw new Error('Invalid repo format, expected owner/repo');

  const path = `/repos/${owner}/${repoName}/actions/workflows/${workflowId}/dispatches`;

  await githubApi({
    path,
    method: 'POST',
    body: { ref: ref || 'main', inputs: inputs || {} },
    headers: getAuthHeaders(integrationConfig),
  });

  // Find the triggered run - GitHub doesn't return run ID directly
  // We need to poll recent runs to find ours
  await sleep(2000); // Brief delay for GitHub to queue the run

  const runsPath = `/repos/${owner}/${repoName}/actions/runs?branch=${encodeURIComponent(ref || 'main')}&event=workflow_dispatch&per_page=5`;
  const runs = await githubApi({
    path: runsPath,
    headers: getAuthHeaders(integrationConfig),
  });

  // Return the most recent run (likely ours)
  const run = runs?.workflow_runs?.[0];
  return {
    triggered: true,
    runId: run?.id,
    runUrl: run?.html_url,
    status: run?.status,
  };
}

export async function pollWorkflowStatus({ repo, runId, integrationConfig }, options = {}) {
  const { maxAttempts = 60, intervalMs = 10000 } = options;
  const [owner, repoName] = repo.split('/');

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const path = `/repos/${owner}/${repoName}/actions/runs/${runId}`;
    const run = await githubApi({
      path,
      headers: getAuthHeaders(integrationConfig),
    });

    const status = run?.status;
    const conclusion = run?.conclusion;

    if (status === 'completed') {
      return {
        completed: true,
        success: conclusion === 'success',
        conclusion,
        run,
      };
    }

    await sleep(intervalMs);
  }

  return { completed: false, timeout: true };
}

export async function fetchWorkflowArtifacts({ repo, runId, integrationConfig, runIdLocal, stageRunId }) {
  const [owner, repoName] = repo.split('/');
  const path = `/repos/${owner}/${repoName}/actions/runs/${runId}/artifacts`;

  const data = await githubApi({
    path,
    headers: getAuthHeaders(integrationConfig),
  });

  const artifacts = data?.artifacts || [];
  const uploaded = [];

  for (const art of artifacts) {
    if (art.expired) continue;

    // Download artifact
    const downloadPath = `/repos/${owner}/${repoName}/actions/artifacts/${art.id}/zip`;
    const downloadRes = await fetch(`${GITHUB_API_BASE}${downloadPath}`, {
      headers: getAuthHeaders(integrationConfig),
      redirect: 'follow',
    });

    if (!downloadRes.ok) continue;

    const buffer = Buffer.from(await downloadRes.arrayBuffer());

    // Upload to S3/MinIO if configured
    const bucket = process.env.ARTIFACTS_BUCKET;
    if (bucket) {
      const key = `runs/${runIdLocal}/artifacts/${stageRunId}/${art.name}.zip`;
      const uri = await putObject({ bucket, key, body: buffer, contentType: 'application/zip' });

      if (uri) {
        const record = await artifactsService.createArtifact({
          run_id: runIdLocal,
          stage_run_id: stageRunId,
          type: 'workflow_artifact',
          uri: `s3://${bucket}/${key}`,
          size: buffer.length,
        });
        uploaded.push({ name: art.name, artifactId: record.id, uri: `s3://${bucket}/${key}` });
      }
    }
  }

  return uploaded;
}

export async function postPRComment({ repo, prNumber, body, integrationConfig }) {
  const [owner, repoName] = repo.split('/');
  const path = `/repos/${owner}/${repoName}/issues/${prNumber}/comments`;

  await githubApi({
    path,
    method: 'POST',
    body: { body },
    headers: getAuthHeaders(integrationConfig),
  });

  return { posted: true };
}

export async function runGitHubActionsStage({ runId, stageRunId, stageDef, ctx }) {
  const publish = (line) => log.publish({ runId, stageRunId, line });

  const { repo, workflow_id, ref, inputs, integration_id } = stageDef;

  if (!repo || !workflow_id) {
    return { success: false, outputs: { error: 'Missing repo or workflow_id' } };
  }

  // Get integration config
  const integration = integration_id
    ? await getIntegrationById(integration_id)
    : await getDefaultGitHubIntegration(ctx.projectId);

  if (!integration) {
    return { success: false, outputs: { error: 'GitHub integration not found' } };
  }

  publish(`[GitHub Actions] Triggering workflow ${workflow_id} on ${repo}@${ref || 'main'}`);

  try {
    // Trigger workflow
    const trigger = await triggerWorkflow({
      repo,
      workflowId: workflow_id,
      ref: ref || 'main',
      inputs: inputs || {},
      integrationConfig: integration.config,
    });

    publish(`[GitHub Actions] Triggered: run ${trigger.runId}, status: ${trigger.status}`);

    if (!trigger.runId) {
      return { success: false, outputs: { error: 'Failed to get workflow run ID' } };
    }

    // Poll for completion
    const pollResult = await pollWorkflowStatus(
      { repo, runId: trigger.runId, integrationConfig: integration.config },
      { maxAttempts: 60, intervalMs: 10000 }
    );

    if (pollResult.timeout) {
      return { success: false, outputs: { error: 'Workflow polling timed out', runId: trigger.runId } };
    }

    publish(`[GitHub Actions] Completed: ${pollResult.conclusion}`);

    // Fetch artifacts
    const artifacts = await fetchWorkflowArtifacts({
      repo,
      runId: trigger.runId,
      integrationConfig: integration.config,
      runIdLocal: runId,
      stageRunId,
    });

    if (artifacts.length > 0) {
      publish(`[GitHub Actions] Captured ${artifacts.length} artifacts`);
    }

    // Post PR comment if this is a PR preview
    if (ctx.triggerMetadata?.pr_number && stageDef.post_preview_comment) {
      const previewUrl = stageDef.preview_url || ctx.outputs?.preview_url;
      if (previewUrl) {
        const commentBody = `🚀 **Preview Environment Ready**\n\nURL: ${previewUrl}\n\nWorkflow: ${trigger.runUrl}`;
        await postPRComment({
          repo,
          prNumber: ctx.triggerMetadata.pr_number,
          body: commentBody,
          integrationConfig: integration.config,
        });
        publish(`[GitHub Actions] Posted preview comment to PR #${ctx.triggerMetadata.pr_number}`);
      }
    }

    return {
      success: pollResult.success,
      outputs: {
        runId: trigger.runId,
        conclusion: pollResult.conclusion,
        artifacts: artifacts.map((a) => ({ name: a.name, artifactId: a.artifactId })),
      },
    };
  } catch (e) {
    publish(`[GitHub Actions] Error: ${e.message}`);
    return { success: false, outputs: { error: e.message } };
  }
}

// Helper functions for integration lookup
async function getIntegrationById(id) {
  const { query } = await import('../infra/db.js');
  const res = await query('SELECT * FROM integrations WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function getDefaultGitHubIntegration(projectId) {
  const { query } = await import('../infra/db.js');
  const res = await query(
    "SELECT * FROM integrations WHERE (project_id = $1 OR project_id IS NULL) AND kind = 'github' ORDER BY created_at DESC LIMIT 1",
    [projectId || null]
  );
  return res.rows[0] || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
