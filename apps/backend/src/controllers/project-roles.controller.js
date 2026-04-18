import { query } from '../infra/db.js';

export async function listProjectRoles(req, res) {
  const { projectId } = req.params;
  const rows = await query(
    `select project_id, user_id, role, created_at
     from project_roles
     where project_id = $1
     order by created_at desc`,
    [projectId]
  );
  return res.json({ roles: rows.rows });
}

export async function upsertProjectRole(req, res) {
  const { projectId, userId } = req.params;
  const { role } = req.body || {};
  if (!role) return res.status(400).json({ error: 'role is required' });

  const r = await query(
    `insert into project_roles (project_id, user_id, role)
     values ($1,$2,$3)
     on conflict (project_id, user_id)
     do update set role = excluded.role
     returning project_id, user_id, role, created_at`,
    [projectId, userId, String(role)]
  );

  return res.json({ role: r.rows[0] });
}

export async function deleteProjectRole(req, res) {
  const { projectId, userId } = req.params;
  const r = await query(
    `delete from project_roles
     where project_id = $1 and user_id = $2
     returning project_id, user_id, role, created_at`,
    [projectId, userId]
  );
  const row = r.rows[0] || null;
  if (!row) return res.status(404).json({ error: 'not found' });
  return res.json({ ok: true, role: row });
}
