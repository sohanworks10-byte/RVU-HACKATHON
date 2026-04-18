import assert from 'assert';
import { describe, it, before, after } from 'node:test';
import crypto from 'crypto';
import http from 'http';

import { query } from '../../src/infra/db.js';
import { requireRole } from '../../src/middleware/rbac.js';
import * as repoMappingsCtrl from '../../src/controllers/repo-mappings.controller.js';

function sign(secret, body) {
  const h = crypto.createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${h}`;
}

async function fetchOk(url, options = {}) {
  const opts = { ...options };
  opts.signal = opts.signal || AbortSignal.timeout(2000);
  const res = await fetch(url, opts);
  const txt = await res.text().catch(() => '');
  const json = txt ? JSON.parse(txt) : null;
  return { res, json, txt };
}

function mockRes() {
  const out = {
    statusCode: 200,
    body: null,
  };
  return {
    status(code) {
      out.statusCode = code;
      return this;
    },
    json(obj) {
      out.body = obj;
      return this;
    },
    _out: out,
  };
}

describe('Repo mappings + webhook edge cases (integration)', () => {
  let server;
  let baseUrl;

  const projectA = '00000000-0000-0000-0000-000000000123';
  const projectB = '00000000-0000-0000-0000-000000000124';

  before(async () => {
    process.env.NODE_ENV = 'test';
    process.env.PREVIEWS_ENABLED = 'true';
    process.env.FEATURE_PHASE2 = 'true';
    process.env.GITHUB_WEBHOOK_SECRET = 'secret';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
    process.env.AlphaOps_TEST_FAKE_TERRAFORM = '1';
    process.env.AlphaOps_TEST_FAKE_DOCKER = '1';

    await query('delete from project_repo_pipelines');
    await query("delete from terraform_workspaces where repo like 'org/%'");
    await query("delete from pipelines where name like 'p4-%'");
    await query('delete from project_roles');

    const { createApp } = await import('../../src/app.js');
    const app = createApp();
    server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, resolve));
    const addr = server.address();
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
      server = null;
    }
  });

  it('webhook rejects repo without mapping (404)', async () => {
    const payload = {
      action: 'opened',
      pull_request: { number: 11, head: { ref: 'feat/no-map', sha: 'aaa' } },
      repository: { full_name: 'org/unmapped' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const { res, json } = await fetchOk(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'edge1',
        'x-hub-signature-256': sign('secret', body),
      },
      body,
    });

    assert.strictEqual(res.status, 404);
    assert.ok(json && json.error);
  });

  it('previews_enabled=false mapping causes webhook to reject (404)', async () => {
    const pipelineRes = await query(
      `insert into pipelines (name, project_id, definition, created_by)
       values ($1,$2,$3,$4)
       returning *`,
      ['p4-edge-pipe-disabled', projectA, JSON.stringify({ nodes: [], edges: [] }), null]
    );

    await query(
      `insert into project_repo_pipelines (project_id, repo, pipeline_id, previews_enabled)
       values ($1,$2,$3,$4)`,
      [projectA, 'org/disabled', pipelineRes.rows[0].id, false]
    );

    const payload = {
      action: 'opened',
      pull_request: { number: 12, head: { ref: 'feat/disabled', sha: 'bbb' } },
      repository: { full_name: 'org/disabled' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const { res } = await fetchOk(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'edge2',
        'x-hub-signature-256': sign('secret', body),
      },
      body,
    });

    assert.strictEqual(res.status, 404);
  });

  it('delete mapping prevents new previews; existing previews remain', async () => {
    const pipelineRes = await query(
      `insert into pipelines (name, project_id, definition, created_by)
       values ($1,$2,$3,$4)
       returning *`,
      ['p4-edge-pipe-del', projectA, JSON.stringify({ nodes: [], edges: [] }), null]
    );

    await query(
      `insert into project_repo_pipelines (project_id, repo, pipeline_id, previews_enabled)
       values ($1,$2,$3,$4)`,
      [projectA, 'org/todelete', pipelineRes.rows[0].id, true]
    );

    // First PR event should create a workspace
    const payload = {
      action: 'opened',
      pull_request: { number: 13, head: { ref: 'feat/x', sha: 'ccc' } },
      repository: { full_name: 'org/todelete' },
    };
    const body = Buffer.from(JSON.stringify(payload));

    const r1 = await fetchOk(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'edge3',
        'x-hub-signature-256': sign('secret', body),
      },
      body,
    });

    assert.strictEqual(r1.res.status, 200);

    const existing = await query(
      "select * from terraform_workspaces where repo = 'org/todelete' and pr_number = 13 order by created_at desc limit 1"
    );
    assert.ok(existing.rows[0]);

    // Delete mapping
    await query("delete from project_repo_pipelines where project_id = $1 and repo = $2", [projectA, 'org/todelete']);

    // New PR event should now reject
    const payload2 = {
      action: 'opened',
      pull_request: { number: 14, head: { ref: 'feat/y', sha: 'ddd' } },
      repository: { full_name: 'org/todelete' },
    };
    const body2 = Buffer.from(JSON.stringify(payload2));

    const r2 = await fetchOk(`${baseUrl}/api/webhooks/git`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-git-provider': 'github',
        'x-github-event': 'pull_request',
        'x-github-delivery': 'edge4',
        'x-hub-signature-256': sign('secret', body2),
      },
      body: body2,
    });

    assert.strictEqual(r2.res.status, 404);

    // Existing preview still exists
    const still = await query('select * from terraform_workspaces where id = $1', [existing.rows[0].id]);
    assert.ok(still.rows[0]);
  });

  it('cross-project safety: cannot map repo to pipeline outside project (400)', async () => {
    const pipeB = await query(
      `insert into pipelines (name, project_id, definition, created_by)
       values ($1,$2,$3,$4)
       returning *`,
      ['p4-edge-pipe-projectB', projectB, JSON.stringify({ nodes: [], edges: [] }), null]
    );

    const req = {
      params: { projectId: projectA },
      body: { repo: 'org/cross', pipeline_id: pipeB.rows[0].id, previews_enabled: true },
      user: { id: 'u1' },
    };
    const res = mockRes();

    await repoMappingsCtrl.createRepoMapping(req, res);
    assert.strictEqual(res._out.statusCode, 400);
    assert.ok(String(res._out.body?.error || '').includes('pipeline_id'));
  });

  it('non-executor user gets 403 from requireRole(executor)', async () => {
    const userId = '00000000-0000-0000-0000-00000000u001'.replace('u', '0');
    await query(`insert into project_roles (project_id, user_id, role) values ($1,$2,$3)`, [projectA, userId, 'viewer']);

    const mw = requireRole('executor');
    const req = { params: { projectId: projectA }, body: {}, user: { id: userId } };
    const res = mockRes();
    let nextCalled = false;

    await mw(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(res._out.statusCode, 403);
  });
});
