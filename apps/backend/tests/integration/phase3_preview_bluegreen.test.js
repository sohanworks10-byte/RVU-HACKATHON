import assert from 'assert';
import { describe, it, before, after } from 'node:test';
import crypto from 'crypto';

import http from 'http';

import { query } from '../../src/infra/db.js';
import { processRunOnce, processPhase3Once } from '../../src/worker/worker.js';

function sign(secret, body) {
  const h = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${h}`;
}

async function fetchWithTimeout(url, options = {}) {
  const opts = { ...options };
  opts.signal = opts.signal || AbortSignal.timeout(2000);

  const res = await fetch(url, opts);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`HTTP ${res.status} ${url}`);
    console.error(body);
    throw new Error(`HTTP ${res.status} ${url}`);
  }
  return res;
}

describe('Phase-3 Preview + Blue/Green (integration)', () => {
  let server;
  let baseUrl;
  const projectId = '00000000-0000-0000-0000-000000000123';

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PREVIEWS_ENABLED = 'true';
    process.env.FEATURE_PHASE2 = 'true';
    process.env.GITHUB_WEBHOOK_SECRET = 'secret';
    // app.js requires these even if we don't use requireUser in these tests
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
    process.env.AlphaOps_TEST_FAKE_TERRAFORM = '1';
    process.env.AlphaOps_TEST_FAKE_DOCKER = '1';

    // Ensure mapping table exists (migration applied separately)
    await query('delete from project_repo_pipelines');
    await query("delete from terraform_workspaces where repo = 'org/repo' or workspace_name like 'bg-test-%'");
    await query("delete from pipelines where name like 'p3-%'");

    const { createApp } = await import('../../src/app.js');
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
    process.env.PUBLIC_BASE_URL = baseUrl;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it('PR open -> preview created (idempotent) and reused on synchronize', async () => {
    // Create pipeline
    const pipelineRes = await query(
      `insert into pipelines (name, project_id, definition, created_by)
       values ($1, $2, $3, $4)
       returning *`,
      [
        'p3-preview-pipeline',
        projectId,
        JSON.stringify({ nodes: [{ id: '1', data: { label: 'tf', type: 'terraform', mode: 'ephemeral' } }], edges: [] }),
        null,
      ]
    );
    const pipeline = pipelineRes.rows[0];

    await query(
      `insert into project_repo_pipelines (project_id, repo, pipeline_id)
       values ($1,$2,$3)`,
      [projectId, 'org/repo', pipeline.id]
    );

    const payload = {
      action: 'opened',
      pull_request: { number: 1, head: { ref: 'feat/x', sha: 'aaa' } },
      repository: { full_name: 'org/repo' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const req1 = await fetchWithTimeout(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd1',
        'x-hub-signature-256': sign('secret', body),
      },
      body,
    });

    assert.ok(req1.status === 200);

    const ws1 = await query("select * from terraform_workspaces where repo = 'org/repo' and pr_number = 1 order by created_at desc limit 1");
    assert.ok(ws1.rows[0]);

    // synchronize with new sha should create new run but reuse workspace
    const payload2 = { ...payload, action: 'synchronize', pull_request: { ...payload.pull_request, head: { ref: 'feat/x', sha: 'bbb' } } };
    const body2 = Buffer.from(JSON.stringify(payload2));

    const req2 = await fetchWithTimeout(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd2',
        'x-hub-signature-256': sign('secret', body2),
      },
      body: body2,
    });

    assert.ok(req2.status === 200);
    const ws2 = await query("select * from terraform_workspaces where repo = 'org/repo' and pr_number = 1 order by created_at desc limit 1");
    assert.strictEqual(ws1.rows[0].id, ws2.rows[0].id);

    // Drive worker to apply (fake terraform) and sync workspace applied
    const runId = ws2.rows[0].run_id;
    await processRunOnce(runId);
    const applied = await query('select * from terraform_workspaces where id = $1', [ws2.rows[0].id]);
    assert.strictEqual(applied.rows[0].status, 'applied');
  });

  it('PR close -> destroy_queued -> worker -> destroyed', async () => {
    const wsRes = await query("select * from terraform_workspaces where repo = 'org/repo' and pr_number = 1 order by created_at desc limit 1");
    const ws = wsRes.rows[0];
    assert.ok(ws);

    const payload = {
      action: 'closed',
      pull_request: { number: 1, head: { ref: 'feat/x', sha: 'bbb' } },
      repository: { full_name: 'org/repo' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const req = await fetchWithTimeout(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'd3',
        'x-hub-signature-256': sign('secret', body),
      },
      body,
    });
    assert.ok(req.status === 200);

    // Worker should destroy
    for (let i = 0; i < 5; i++) {
      await processPhase3Once();
    }

    const after = await query('select * from terraform_workspaces where id = $1', [ws.id]);
    assert.strictEqual(after.rows[0].status, 'destroyed');
  });

  it('concurrent webhook delivery IDs are idempotent', async () => {
    const payload = {
      action: 'opened',
      pull_request: { number: 2, head: { ref: 'feat/y', sha: 'ccc' } },
      repository: { full_name: 'org/repo' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const h = {
      'content-type': 'application/json',
      'x-git-provider': 'github',
      'x-github-event': 'pull_request',
      'x-github-delivery': 'dup1',
      'x-hub-signature-256': sign('secret', body),
    };

    const r1 = await fetchWithTimeout(`${baseUrl}/api/webhooks/git`, { method: 'POST', headers: h, body });
    const r2 = await fetchWithTimeout(`${baseUrl}/api/webhooks/git`, { method: 'POST', headers: h, body }).catch((e) => e);
    // Second call should be treated as duplicate and return 200.
    if (r2 instanceof Error) throw r2;
    assert.ok(r1.status === 200);
    assert.ok(r2.status === 200);
  });

  it('blue/green switch -> soaking -> soak_success (fake scripts)', async () => {
    process.env.AlphaOps_TEST_FAKE_DOCKER = '1';

    const wsRes = await query(
      `insert into terraform_workspaces (project_id, name, workspace_name, workspace_mode, status, state)
       values ($1,$2,$2,'blue-green','switch_approved',$3)
       returning *`,
      [
        null,
        'bg-test-3',
        JSON.stringify({
          switch_script: 'ok',
          health_check_script: 'ok',
          rollback_script: 'ok',
          soak_ms: 1,
          health_interval_ms: 1,
          fail_threshold: 3,
        }),
      ]
    );
    const ws = wsRes.rows[0];

    await processPhase3Once(); // switch -> soaking
    for (let i = 0; i < 5; i++) await processPhase3Once();

    const after = await query('select * from terraform_workspaces where id = $1', [ws.id]);
    assert.strictEqual(after.rows[0].status, 'soak_success');
  });

  it('blue/green failure -> rollback -> rolled_back (missing rollback_script still marks rolled_back)', async () => {
    process.env.AlphaOps_TEST_FAKE_DOCKER = '1';

    const wsRes = await query(
      `insert into terraform_workspaces (project_id, name, workspace_name, workspace_mode, status, state)
       values ($1,$2,$2,'blue-green','switch_approved',$3)
       returning *`,
      [
        null,
        'bg-test-4',
        JSON.stringify({
          switch_script: 'ok',
          health_check_script: 'fail',
          soak_ms: 600000,
          health_interval_ms: 1,
          fail_threshold: 3,
          consecutive_failures: 2,
        }),
      ]
    );
    const ws = wsRes.rows[0];

    await processPhase3Once(); // switch -> soaking
    for (let i = 0; i < 5; i++) await processPhase3Once();

    const after = await query('select * from terraform_workspaces where id = $1', [ws.id]);
    assert.strictEqual(after.rows[0].status, 'rolled_back');
  });

  it('missing health_check_script -> treated as healthy -> soak_success', async () => {
    process.env.AlphaOps_TEST_FAKE_DOCKER = '1';

    const wsRes = await query(
      `insert into terraform_workspaces (project_id, name, workspace_name, workspace_mode, status, state)
       values ($1,$2,$2,'blue-green','soaking',$3)
       returning *`,
      [null, 'bg-test-5', JSON.stringify({ soak_ms: 1, health_interval_ms: 1, fail_threshold: 3, soak_started_at: new Date(Date.now() - 1000).toISOString() })]
    );
    const ws = wsRes.rows[0];
    await processPhase3Once();
    const after = await query('select * from terraform_workspaces where id = $1', [ws.id]);
    assert.strictEqual(after.rows[0].status, 'soak_success');
  });

  it('unsafe workspace name destroy attempt -> destroy_failed', async () => {
    process.env.AlphaOps_TEST_FAKE_TERRAFORM = '1';

    const wsRes = await query(
      `insert into terraform_workspaces (project_id, name, workspace_name, workspace_mode, status, state)
       values ($1,$2,$2,'ephemeral','destroy_queued',$3)
       returning *`,
      [null, 'prod-main', JSON.stringify({})]
    );
    const ws = wsRes.rows[0];
    await processPhase3Once();
    const after = await query('select * from terraform_workspaces where id = $1', [ws.id]);
    assert.strictEqual(after.rows[0].status, 'destroy_failed');
  });
});
