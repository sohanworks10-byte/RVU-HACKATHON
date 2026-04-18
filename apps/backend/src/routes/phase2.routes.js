import { Router } from 'express';

import * as secretsCtrl from '../controllers/secrets.controller.js';
import * as integrationsCtrl from '../controllers/integrations.controller.js';
import * as artifactsCtrl from '../controllers/artifacts.controller.js';

export function phase2Router({ requireUser }) {
  const router = Router();

  router.post('/secrets', requireUser, secretsCtrl.createSecret);
  router.get('/secrets/:projectId', requireUser, secretsCtrl.listSecrets);

  router.post('/integrations', requireUser, integrationsCtrl.createIntegration);
  router.get('/integrations/:projectId', requireUser, integrationsCtrl.listIntegrations);

  router.get('/artifacts/:id', requireUser, artifactsCtrl.getArtifact);

  return router;
}
