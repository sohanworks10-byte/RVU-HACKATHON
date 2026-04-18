import * as auditService from '../services/audit.service.js';

export async function listProjectAudit(req, res) {
  const { projectId } = req.params;
  const limitRaw = req.query.limit;
  const limit = limitRaw != null ? Number(limitRaw) : 100;
  const rows = await auditService.listAuditLogs({ projectId, limit: Number.isFinite(limit) ? limit : 100 });
  return res.json({ audit: rows });
}
