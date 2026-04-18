import { Router } from 'express';

import * as previewsCtrl from '../controllers/previews.controller.js';
import * as gitwebhookCtrl from '../controllers/gitwebhook.controller.js';
import * as repoMappingsCtrl from '../controllers/repo-mappings.controller.js';
import * as projectRolesCtrl from '../controllers/project-roles.controller.js';
import * as auditCtrl from '../controllers/audit.controller.js';
import * as integrationsCtrl from '../controllers/integrations.controller.js';
import { requireRole } from '../middleware/rbac.js';

export function phase3Router({ requireUser }) {
  const router = Router();

  router.post('/projects/:projectId/previews', requireUser, previewsCtrl.createPreview);
  router.get('/projects/:projectId/previews', requireUser, previewsCtrl.listPreviews);

  router.get('/previews/:workspaceId', requireUser, previewsCtrl.getPreview);
  router.post('/previews/:workspaceId/destroy', requireUser, previewsCtrl.destroyPreview);
  router.post('/previews/:workspaceId/approve-switch', requireUser, previewsCtrl.approveSwitch);

  router.post('/webhooks/git', gitwebhookCtrl.handleGitWebhook);

  router.get('/projects/:projectId/integrations', requireUser, requireRole('viewer'), integrationsCtrl.listProjectIntegrations);
  router.post('/projects/:projectId/integrations', requireUser, requireRole('executor'), integrationsCtrl.createProjectIntegration);
  router.delete('/projects/:projectId/integrations/:integrationId', requireUser, requireRole('executor'), integrationsCtrl.deleteProjectIntegration);

  router.get('/projects/:projectId/repo-mappings', requireUser, repoMappingsCtrl.listRepoMappings);
  router.post('/projects/:projectId/repo-mappings', requireUser, requireRole('executor'), repoMappingsCtrl.createRepoMapping);
  router.patch('/projects/:projectId/repo-mappings/:repo', requireUser, requireRole('executor'), repoMappingsCtrl.updateRepoMapping);
  router.delete('/projects/:projectId/repo-mappings/:repo', requireUser, requireRole('executor'), repoMappingsCtrl.deleteRepoMapping);

  router.get('/projects/:projectId/roles', requireUser, requireRole('admin'), projectRolesCtrl.listProjectRoles);
  router.put('/projects/:projectId/roles/:userId', requireUser, requireRole('admin'), projectRolesCtrl.upsertProjectRole);
  router.delete('/projects/:projectId/roles/:userId', requireUser, requireRole('admin'), projectRolesCtrl.deleteProjectRole);

  router.get('/projects/:projectId/audit', requireUser, requireRole('admin'), auditCtrl.listProjectAudit);

  return router;
}
