import { query } from '../infra/db.js';

export async function writeAuditLog({ actor_id, action, resource_type, resource_id, before_state, after_state, meta }) {
  const res = await query(
    `insert into audit_logs (actor_id, action, resource_type, resource_id, before_state, after_state, meta)
     values ($1,$2,$3,$4,$5,$6,$7)
     returning *`,
    [actor_id || null, action, resource_type, resource_id || null, before_state || null, after_state || null, meta || null]
  );
  return res.rows[0];
}

export async function listAuditLogs({ projectId, limit = 100 } = {}) {
  // projectId is optional; meta may include project_id
  const res = await query(
    `select * from audit_logs
     where ($1::uuid is null or meta->>'project_id' = $1::text)
     order by created_at desc
     limit $2`,
    [projectId || null, limit]
  );
  return res.rows;
}
