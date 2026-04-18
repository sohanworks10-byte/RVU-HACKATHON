import * as integrationsService from '../services/integrations.service.js';

export async function createIntegration(req, res) {
  const { project_id, kind, config } = req.body || {};
  if (!kind || !config) {
    return res.status(400).json({ error: 'kind and config are required' });
  }

  const created_by = (req.user && (req.user.email || req.user.id)) || null;
  const row = await integrationsService.createIntegration({ project_id: project_id || null, kind, config, created_by });
  return res.status(201).json(row);
}

export async function createProjectIntegration(req, res) {
  const { projectId } = req.params;
  const { kind, config } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!kind || !config) return res.status(400).json({ error: 'kind and config are required' });

  const created_by = (req.user && (req.user.email || req.user.id)) || null;
  const row = await integrationsService.createIntegration({ project_id: String(projectId), kind, config, created_by });
  return res.status(201).json(row);
}

export async function listIntegrations(req, res) {
  const { projectId } = req.params;
  const rows = await integrationsService.listIntegrations({ project_id: projectId || null });
  return res.json({ integrations: rows });
}

export async function listProjectIntegrations(req, res) {
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  const rows = await integrationsService.listIntegrations({ project_id: String(projectId) });
  return res.json({ integrations: rows });
}

export async function deleteProjectIntegration(req, res) {
  const { projectId, integrationId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId is required' });
  if (!integrationId) return res.status(400).json({ error: 'integrationId is required' });

  const deleted = await integrationsService.deleteIntegration({
    project_id: String(projectId),
    integration_id: String(integrationId),
  });
  if (!deleted) return res.status(404).json({ error: 'not found' });
  return res.json({ ok: true });
}
