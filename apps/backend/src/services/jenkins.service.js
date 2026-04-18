import * as log from './log.service.js';
import * as artifactsService from './artifacts.service.js';
import { putObject } from '../infra/s3.js';

function getJenkinsBaseUrl(config) {
  return (config.base_url || config.jenkins_url || '').replace(/\/+$/, '');
}

function getAuth(config) {
  const username = config.username || config.jenkins_user;
  const token = config.token || config.api_token || config.jenkins_token;
  if (!username || !token) throw new Error('Jenkins credentials not configured');
  return { username, token };
}

function makeAuthHeader(config) {
  const { username, token } = getAuth(config);
  const encoded = Buffer.from(`${username}:${token}`).toString('base64');
  return `Basic ${encoded}`;
}

async function jenkinsApi({ url, method = 'GET', body, config }) {
  const res = await fetch(url, {
    method,
    headers: {
      'Authorization': makeAuthHeader(config),
      'Accept': 'application/json',
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: body || undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jenkins API error (${res.status}): ${text || res.statusText}`);
  }

  // Jenkins sometimes returns empty body for POSTs
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json();
  }
  return null;
}

async function getCrumb(config) {
  try {
    const baseUrl = getJenkinsBaseUrl(config);
    const crumbUrl = `${baseUrl}/crumbIssuer/api/json`;
    const crumbData = await jenkinsApi({ url: crumbUrl, config });
    return crumbData ? { crumb: crumbData.crumb, field: crumbData.crumbRequestField } : null;
  } catch {
    return null;
  }
}

export async function triggerBuild({ jobName, parameters, config }) {
  const baseUrl = getJenkinsBaseUrl(config);
  const crumb = await getCrumb(config);

  let url;
  let body = null;

  if (parameters && Object.keys(parameters).length > 0) {
    // Build with parameters
    url = `${baseUrl}/job/${encodeURIComponent(jobName)}/buildWithParameters`;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(parameters)) {
      params.append(k, String(v));
    }
    body = params.toString();
  } else {
    // Build without parameters
    url = `${baseUrl}/job/${encodeURIComponent(jobName)}/build`;
  }

  const headers = {
    'Authorization': makeAuthHeader(config),
    ...(crumb ? { [crumb.field]: crumb.crumb } : {}),
    ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
  };

  // Jenkins returns 201 Created on success with Location header to queue item
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Jenkins trigger failed (${res.status}): ${text || res.statusText}`);
  }

  // Get queue item URL from Location header
  const queueUrl = res.headers.get('location');
  return { triggered: true, queueUrl };
}

export async function getBuildNumberFromQueue(queueUrl, config, options = {}) {
  const { maxAttempts = 30, intervalMs = 2000 } = options;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const queueData = await jenkinsApi({ url: `${queueUrl}/api/json`, config });

    if (queueData?.executable?.number) {
      return {
        buildNumber: queueData.executable.number,
        buildUrl: queueData.executable.url,
      };
    }

    if (!queueData?.blocked && !queueData?.buildable) {
      // Queue item no longer exists or was cancelled
      return null;
    }

    await sleep(intervalMs);
  }

  return { timeout: true };
}

export async function pollBuildStatus({ jobName, buildNumber, config }, options = {}) {
  const { maxAttempts = 60, intervalMs = 10000 } = options;
  const baseUrl = getJenkinsBaseUrl(config);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const url = `${baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json`;
    const data = await jenkinsApi({ url, config });

    if (data?.result) {
      return {
        completed: true,
        success: data.result === 'SUCCESS',
        result: data.result,
        duration: data.duration,
        timestamp: data.timestamp,
      };
    }

    await sleep(intervalMs);
  }

  return { completed: false, timeout: true };
}

export async function streamConsoleLogs({ jobName, buildNumber, config, runId, stageRunId }, options = {}) {
  const baseUrl = getJenkinsBaseUrl(config);
  let start = 0;
  const { maxEmptyPolls = 3, intervalMs = 5000 } = options;
  let emptyPolls = 0;

  while (emptyPolls < maxEmptyPolls) {
    const url = `${baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/logText/progressiveText?start=${start}`;

    const res = await fetch(url, {
      headers: { 'Authorization': makeAuthHeader(config) },
    });

    if (!res.ok) {
      await sleep(intervalMs);
      continue;
    }

    const text = await res.text();
    const moreDataHeader = res.headers.get('x-more-data');
    const textSizeHeader = res.headers.get('x-text-size');

    if (text && text.length > 0) {
      // Publish each line
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.trim()) {
          await log.publish({ runId, stageRunId, line: `[Jenkins] ${line}` });
        }
      }
    }

    // Update start position for next poll
    if (textSizeHeader) {
      start = parseInt(textSizeHeader, 10);
    } else {
      start += text.length;
    }

    // Check if build is done logging
    if (moreDataHeader !== 'true') {
      emptyPolls++;
    } else {
      emptyPolls = 0;
    }

    await sleep(intervalMs);
  }

  return { streamed: true };
}

export async function fetchBuildArtifacts({ jobName, buildNumber, config, runId, stageRunId }) {
  const baseUrl = getJenkinsBaseUrl(config);
  const url = `${baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/api/json?tree=artifacts[*]`;

  const data = await jenkinsApi({ url, config });
  const artifacts = data?.artifacts || [];
  const uploaded = [];

  for (const art of artifacts) {
    const artUrl = `${baseUrl}/job/${encodeURIComponent(jobName)}/${buildNumber}/artifact/${encodeURIComponent(art.relativePath)}`;

    const res = await fetch(artUrl, {
      headers: { 'Authorization': makeAuthHeader(config) },
    });

    if (!res.ok) continue;

    const buffer = Buffer.from(await res.arrayBuffer());

    // Upload to S3/MinIO if configured
    const bucket = process.env.ARTIFACTS_BUCKET;
    if (bucket) {
      const key = `runs/${runId}/artifacts/${stageRunId}/${art.fileName}`;
      const uri = await putObject({ bucket, key, body: buffer, contentType: art.contentType || 'application/octet-stream' });

      if (uri) {
        const record = await artifactsService.createArtifact({
          run_id: runId,
          stage_run_id: stageRunId,
          type: 'jenkins_artifact',
          uri: `s3://${bucket}/${key}`,
          size: buffer.length,
        });
        uploaded.push({ name: art.fileName, artifactId: record.id, uri: `s3://${bucket}/${key}` });
      }
    }
  }

  return uploaded;
}

export async function runJenkinsStage({ runId, stageRunId, stageDef, ctx }) {
  const publish = (line) => log.publish({ runId, stageRunId, line });

  const { job_name, parameters, jenkins_config, integration_id } = stageDef;

  if (!job_name) {
    return { success: false, outputs: { error: 'Missing job_name' } };
  }

  // Get integration config
  const integration = integration_id
    ? await getIntegrationById(integration_id)
    : await getDefaultJenkinsIntegration(ctx.projectId);

  if (!integration) {
    return { success: false, outputs: { error: 'Jenkins integration not found' } };
  }

  const config = jenkins_config ? { ...integration.config, ...jenkins_config } : integration.config;

  publish(`[Jenkins] Triggering build: ${job_name}`);

  try {
    // Trigger build
    const trigger = await triggerBuild({ jobName: job_name, parameters: parameters || {}, config });
    publish(`[Jenkins] Build queued: ${trigger.queueUrl}`);

    // Wait for build number
    const buildInfo = await getBuildNumberFromQueue(trigger.queueUrl, config, { maxAttempts: 30, intervalMs: 2000 });

    if (!buildInfo) {
      return { success: false, outputs: { error: 'Build was cancelled or failed to start' } };
    }

    if (buildInfo.timeout) {
      return { success: false, outputs: { error: 'Timeout waiting for build to start' } };
    }

    publish(`[Jenkins] Build started: #${buildInfo.buildNumber}`);

    // Stream console logs in background (don't await)
    const streamingPromise = streamConsoleLogs(
      { jobName: job_name, buildNumber: buildInfo.buildNumber, config, runId, stageRunId },
      { maxEmptyPolls: 3, intervalMs: 5000 }
    );

    // Poll for build completion
    const pollResult = await pollBuildStatus(
      { jobName: job_name, buildNumber: buildInfo.buildNumber, config },
      { maxAttempts: 60, intervalMs: 10000 }
    );

    // Wait for streaming to finish
    await streamingPromise.catch(() => {});

    if (pollResult.timeout) {
      return { success: false, outputs: { error: 'Build polling timed out', buildNumber: buildInfo.buildNumber } };
    }

    publish(`[Jenkins] Build completed: ${pollResult.result}`);

    // Fetch artifacts
    const artifacts = await fetchBuildArtifacts({
      jobName: job_name,
      buildNumber: buildInfo.buildNumber,
      config,
      runId,
      stageRunId,
    });

    if (artifacts.length > 0) {
      publish(`[Jenkins] Captured ${artifacts.length} artifacts`);
    }

    return {
      success: pollResult.success,
      outputs: {
        buildNumber: buildInfo.buildNumber,
        result: pollResult.result,
        duration: pollResult.duration,
        artifacts: artifacts.map((a) => ({ name: a.name, artifactId: a.artifactId })),
      },
    };
  } catch (e) {
    publish(`[Jenkins] Error: ${e.message}`);
    return { success: false, outputs: { error: e.message } };
  }
}

// Helper functions for integration lookup
async function getIntegrationById(id) {
  const { query } = await import('../infra/db.js');
  const res = await query('SELECT * FROM integrations WHERE id = $1', [id]);
  return res.rows[0] || null;
}

async function getDefaultJenkinsIntegration(projectId) {
  const { query } = await import('../infra/db.js');
  const res = await query(
    "SELECT * FROM integrations WHERE (project_id = $1 OR project_id IS NULL) AND kind = 'jenkins' ORDER BY created_at DESC LIMIT 1",
    [projectId || null]
  );
  return res.rows[0] || null;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
