import { Router } from 'express';

import * as ctrl from '../controllers/runs.controller.js';

export function runsRouter({ requireUser }) {
  const router = Router();

  router.post('/pipelines/:id/runs', requireUser, ctrl.startRun);
  router.get('/runs/:runId', requireUser, ctrl.getRun);
  router.post('/runs/:runId/approve', requireUser, ctrl.approveStage);
  router.get('/runs/:runId/stage_runs/:stageRunId/logs', requireUser, ctrl.downloadLogs);

  return router;
}
