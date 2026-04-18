import * as secretsService from '../services/secrets.service.js';

export async function createSecret(req, res) {
  const { project_id, name, provider, path } = req.body || {};
  if (!name || !path) {
    return res.status(400).json({ error: 'name and path are required' });
  }

  const created_by = (req.user && (req.user.email || req.user.id)) || null;
  const row = await secretsService.createSecret({ project_id: project_id || null, name, provider: provider || 'vault', path, created_by });
  return res.status(201).json(row);
}

export async function listSecrets(req, res) {
  const { projectId } = req.params;
  const rows = await secretsService.listSecrets({ project_id: projectId || null });
  return res.json({ secrets: rows });
}
