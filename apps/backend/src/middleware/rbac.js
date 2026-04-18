import { query } from '../infra/db.js';

const ROLE_ORDER = {
  viewer: 1,
  editor: 2,
  executor: 3,
  admin: 4,
};

export async function getUserProjectRole({ projectId, userId }) {
  if (!projectId || projectId === 'null') return 'admin';
  const res = await query('select role from project_roles where project_id = $1 and user_id = $2', [projectId, userId]);
  return res.rows[0]?.role || null;
}

export function requireRole(minRole) {
  return async (req, res, next) => {
    try {
      const projectId = req.params.projectId || req.body?.project_id || null;
      const userId = req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const role = await getUserProjectRole({ projectId, userId });
      req.projectRole = role;

      if (!role) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      const have = ROLE_ORDER[role] || 0;
      const need = ROLE_ORDER[minRole] || 999;

      if (have < need) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      return next();
    } catch (e) {
      return res.status(500).json({ error: e?.message || 'RBAC failed' });
    }
  };
}
