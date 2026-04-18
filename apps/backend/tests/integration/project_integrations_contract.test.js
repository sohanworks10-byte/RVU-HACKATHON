import assert from 'assert';
import { describe, it, before } from 'node:test';

import { query } from '../../src/infra/db.js';
import * as integrationsCtrl from '../../src/controllers/integrations.controller.js';

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

describe('Project integrations contract (integration)', () => {
  const projectA = '00000000-0000-0000-0000-000000000123';
  const projectB = '00000000-0000-0000-0000-000000000124';

  before(async () => {
    process.env.NODE_ENV = 'test';
    await query('delete from integrations');
  });

  it('create + list via project-scoped controllers', async () => {
    const reqCreate = {
      params: { projectId: projectA },
      body: { kind: 'ssh_host', config: { host: 'example.internal', port: 22 } },
      user: { id: 'u1', email: 'u1@example.com' },
    };
    const resCreate = mockRes();
    await integrationsCtrl.createProjectIntegration(reqCreate, resCreate);
    assert.equal(resCreate._out.statusCode, 201);
    assert.ok(resCreate._out.body?.id);
    assert.equal(resCreate._out.body?.project_id, projectA);

    const reqList = { params: { projectId: projectA } };
    const resList = mockRes();
    await integrationsCtrl.listProjectIntegrations(reqList, resList);
    assert.equal(resList._out.statusCode, 200);
    assert.ok(Array.isArray(resList._out.body?.integrations));
    assert.equal(resList._out.body.integrations.length, 1);
    assert.equal(resList._out.body.integrations[0].kind, 'ssh_host');
  });

  it('delete is project-scoped (wrong projectId yields 404)', async () => {
    const ins = await query(
      `insert into integrations (project_id, kind, config, created_by)
       values ($1,$2,$3,$4)
       returning *`,
      [projectB, 'jenkins', JSON.stringify({ base_url: 'https://jenkins.example.com' }), 'tester']
    );
    const integrationId = ins.rows[0].id;

    const reqWrong = { params: { projectId: projectA, integrationId }, user: { id: 'u1' } };
    const resWrong = mockRes();
    await integrationsCtrl.deleteProjectIntegration(reqWrong, resWrong);
    assert.equal(resWrong._out.statusCode, 404);

    const reqRight = { params: { projectId: projectB, integrationId }, user: { id: 'u1' } };
    const resRight = mockRes();
    await integrationsCtrl.deleteProjectIntegration(reqRight, resRight);
    assert.equal(resRight._out.statusCode, 200);
    assert.deepEqual(resRight._out.body, { ok: true });

    const chk = await query('select * from integrations where id = $1', [integrationId]);
    assert.equal(chk.rows.length, 0);
  });
});
