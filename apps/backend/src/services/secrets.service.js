import { query } from '../infra/db.js';

export async function createSecret({ project_id, name, provider, path, created_by }) {
  const res = await query(
    `insert into secrets (project_id, name, provider, path, created_by)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [project_id || null, String(name), String(provider || 'vault'), String(path), created_by || null]
  );
  return res.rows[0];
}

export async function listSecrets({ project_id }) {
  const res = await query(
    `select id, project_id, name, provider, path, created_by, created_at
     from secrets
     where ($1::uuid is null and project_id is null) or project_id = $1
     order by created_at desc`,
    [project_id || null]
  );
  return res.rows;
}
