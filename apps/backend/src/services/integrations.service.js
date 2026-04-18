import { query } from '../infra/db.js';

export async function createIntegration({ project_id, kind, config, created_by }) {
  const res = await query(
    `insert into integrations (project_id, kind, config, created_by)
     values ($1, $2, $3, $4)
     returning *`,
    [project_id || null, String(kind), config, created_by || null]
  );
  return res.rows[0];
}

export async function listIntegrations({ project_id }) {
  const res = await query(
    `select * from integrations
     where ($1::uuid is null and project_id is null) or project_id = $1
     order by created_at desc`,
    [project_id || null]
  );
  return res.rows;
}

export async function deleteIntegration({ project_id, integration_id }) {
  const res = await query(
    `delete from integrations
     where id = $1 and project_id = $2
     returning *`,
    [integration_id, project_id]
  );
  return res.rows[0] || null;
}
