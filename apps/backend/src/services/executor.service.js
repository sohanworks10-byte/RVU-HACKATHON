import { spawn } from 'child_process';

import { sshConnection } from '../ssh-connection.js';
import { agentConnection } from '../agent-connection.js';
import { isPhase2Enabled } from '../infra/flags.js';
import * as log from './log.service.js';
import { runTerraformPersistent, resumeTerraformApply } from './terraform-engine.service.js';
import { runGitHubActionsStage } from './github-actions.service.js';
import { runJenkinsStage } from './jenkins.service.js';

function nowIso() {
  return new Date().toISOString();
}

function withTimeout(promise, timeoutMs, onTimeout) {
  if (!timeoutMs || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        if (onTimeout) onTimeout();
      } catch {}
      reject(new Error('Stage timed out'));
    }, timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function runDockerStage({ runId, stageRunId, stageDef, ctx }) {
  const image = stageDef.image || 'alpine:3.20';
  const script = stageDef.script || stageDef.command || 'echo "no script"';

  // Keep Phase 1 small: run docker CLI.
  const args = [
    'run',
    '--rm',
    '--name',
    `run-${stageRunId}`,
    '--network',
    'bridge',
    image,
    'sh',
    '-lc',
    script,
  ];

  await log.publish({ runId, stageRunId, line: `[${nowIso()}] docker ${args.join(' ')}` });

  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => log.publish({ runId, stageRunId, line: d.toString('utf8') }));
    child.stderr.on('data', (d) => log.publish({ runId, stageRunId, line: d.toString('utf8') }));
    child.on('close', (code) => {
      resolve({ success: code === 0, outputs: { exitCode: code } });
    });
    child.on('error', (err) => {
      log.publish({ runId, stageRunId, line: String(err?.message || err) });
      resolve({ success: false, outputs: { error: String(err?.message || err) } });
    });
  });
}

async function runSshStage({ runId, stageRunId, stageDef }) {
  const serverId = stageDef.server_id;
  const command = stageDef.command || stageDef.script;
  if (!serverId) throw new Error('ssh stage missing server_id');
  if (!command) throw new Error('ssh stage missing command');

  if (!sshConnection.isConnected(serverId)) {
    throw new Error('SSH not connected for serverId');
  }

  const result = await sshConnection.exec(serverId, command);
  if (result.stdout) await log.publish({ runId, stageRunId, line: result.stdout });
  if (result.stderr) await log.publish({ runId, stageRunId, line: result.stderr });

  return { success: result.code === 0, outputs: { exitCode: result.code } };
}

async function runAgentStage({ runId, stageRunId, stageDef }) {
  const serverId = stageDef.server_id;
  const command = stageDef.command || stageDef.script;
  if (!serverId) throw new Error('agent stage missing server_id');
  if (!command) throw new Error('agent stage missing command');

  if (!agentConnection.isConnected(serverId)) {
    throw new Error('Agent not connected for serverId');
  }

  const result = await agentConnection.exec(serverId, command);
  if (result.stdout) await log.publish({ runId, stageRunId, line: result.stdout });
  if (result.stderr) await log.publish({ runId, stageRunId, line: result.stderr });

  return { success: result.code === 0, outputs: { exitCode: result.code } };
}

export async function executeStage({ runId, stageRunId, stageDef, ctx }) {
  const type = String(stageDef.type || stageDef.kind || 'script');
  const timeoutMs = stageDef.timeout_ms ? Number(stageDef.timeout_ms) : 30 * 60 * 1000;

  if (type === 'approval') {
    return { success: true, outputs: { awaiting_approval: true } };
  }

  const execPromise = (async () => {
    if (type === 'docker' || type === 'script') {
      return runDockerStage({ runId, stageRunId, stageDef, ctx });
    }
    if (type === 'ssh') {
      return runSshStage({ runId, stageRunId, stageDef, ctx });
    }
    if (type === 'agent') {
      return runAgentStage({ runId, stageRunId, stageDef, ctx });
    }
    if (isPhase2Enabled() && type === 'terraform') {
      return runTerraformStage({ runId, stageRunId, stageDef, ctx });
    }
    if (isPhase2Enabled() && type === 'github_actions') {
      return runGitHubActionsStage({ runId, stageRunId, stageDef, ctx });
    }
    if (isPhase2Enabled() && type === 'jenkins') {
      return runJenkinsStage({ runId, stageRunId, stageDef, ctx });
    }

    throw new Error(`Unsupported stage type: ${type}`);
  })();

  return withTimeout(execPromise, timeoutMs);
}

async function runTerraformStage({ runId, stageRunId, stageDef, ctx }) {
  const result = await runTerraformPersistent({ runId, stageRunId, stageDef, ctx });
  return result;
}

export async function executeTerraformResume({ runId, stageRunId, stageDef, ctx, planUri }) {
  if (!isPhase2Enabled()) {
    throw new Error('Terraform resume requires Phase-2 to be enabled');
  }
  const result = await resumeTerraformApply({ runId, stageRunId, stageDef, ctx, planUri });
  return result;
}
