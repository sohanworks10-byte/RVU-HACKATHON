import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { query } from '../infra/db.js';
import { putObject } from '../infra/s3.js';
import * as artifactsService from './artifacts.service.js';
import { withLock } from './lock-manager.service.js';
import { withLock as withRedlock } from '../infra/redlock.js';
import * as log from './log.service.js';

const WORKSPACE_BASE = process.env.TERRAFORM_WORKSPACE_BASE || '/var/AlphaOps/terraform';
const TF_IMAGE = process.env.TERRAFORM_IMAGE || 'hashicorp/terraform:1.5.0';

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

export function getWorkspacePath(workspaceName) {
  const safeName = workspaceName.replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(WORKSPACE_BASE, safeName);
}

async function uploadPlanArtifact(runId, stageRunId, planPath) {
  const bucket = process.env.ARTIFACTS_BUCKET;
  if (!bucket) return null;

  const key = `runs/${runId}/plans/${stageRunId}/plan.tfplan`;
  const body = fs.readFileSync(planPath);
  const uri = await putObject({ bucket, key, body, contentType: 'application/octet-stream' });

  if (uri) {
    const artifact = await artifactsService.createArtifact({
      run_id: runId,
      stage_run_id: stageRunId,
      type: 'plan',
      uri: `s3://${bucket}/${key}`,
      size: body.length,
    });
    return { uri: `s3://${bucket}/${key}`, artifactId: artifact.id };
  }
  return null;
}

async function uploadPlanText(runId, stageRunId, text) {
  const bucket = process.env.ARTIFACTS_BUCKET;
  if (!bucket) return null;

  const key = `runs/${runId}/plans/${stageRunId}/plan.txt`;
  const body = Buffer.from(text, 'utf8');
  const uri = await putObject({ bucket, key, body, contentType: 'text/plain' });

  if (uri) {
    const artifact = await artifactsService.createArtifact({
      run_id: runId,
      stage_run_id: stageRunId,
      type: 'plan_text',
      uri: `s3://${bucket}/${key}`,
      size: body.length,
    });
    return { uri: `s3://${bucket}/${key}`, artifactId: artifact.id };
  }
  return null;
}

function runDockerTerraform(args, { workspacePath, env = {}, timeoutMs = 10 * 60 * 1000 }) {
  if (process.env.AlphaOps_TEST_FAKE_TERRAFORM) {
    ensureDir(workspacePath);
    const cmd = String(args[0] || '');

    if (cmd === 'plan') {
      // Create dummy plan file where engine expects it
      try {
        fs.writeFileSync(path.join(workspacePath, 'plan.tfplan'), Buffer.from('fake-plan'));
      } catch {}
      return Promise.resolve({ code: 0, stdout: 'fake plan ok', stderr: '' });
    }
    if (cmd === 'show') {
      return Promise.resolve({ code: 0, stdout: 'fake plan show', stderr: '' });
    }
    if (cmd === 'apply') {
      return Promise.resolve({ code: 0, stdout: 'fake apply ok', stderr: '' });
    }
    if (cmd === 'destroy') {
      return Promise.resolve({ code: 0, stdout: 'fake destroy ok', stderr: '' });
    }
    if (cmd === 'output') {
      const payload = {
        preview_url: { value: 'https://example-preview.dev' },
      };
      return Promise.resolve({ code: 0, stdout: JSON.stringify(payload), stderr: '' });
    }
    if (cmd === 'init') {
      return Promise.resolve({ code: 0, stdout: 'fake init ok', stderr: '' });
    }

    return Promise.resolve({ code: 0, stdout: `fake ${cmd} ok`, stderr: '' });
  }

  return new Promise((resolve, reject) => {
    const dockerArgs = [
      'run',
      '--rm',
      '-v', `${workspacePath}:/workspace`,
      '-w', '/workspace',
      ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]),
      TF_IMAGE,
      ...args,
    ];

    const child = spawn('docker', dockerArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Terraform execution timed out'));
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      stdout += d.toString('utf8');
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString('utf8');
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function terraformOutputJson({ workspacePath, env = {} }) {
  const result = await runDockerTerraform(['output', '-json'], { workspacePath, env, timeoutMs: 60 * 1000 });
  if (result.code !== 0) {
    return { success: false, outputs: null, stdout: result.stdout, stderr: result.stderr };
  }
  try {
    const parsed = JSON.parse(result.stdout || '{}');
    const flat = {};
    for (const [k, v] of Object.entries(parsed)) {
      flat[k] = v && typeof v === 'object' && 'value' in v ? v.value : v;
    }
    return { success: true, outputs: flat, stdout: result.stdout, stderr: result.stderr };
  } catch {
    return { success: false, outputs: null, stdout: result.stdout, stderr: result.stderr };
  }
}

export async function terraformDestroy({ workspacePath, env = {} }) {
  const args = ['destroy', '-input=false', '-auto-approve'];
  const result = await runDockerTerraform(args, { workspacePath, env, timeoutMs: 15 * 60 * 1000 });
  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function lockKeyForWorkspace(workspaceName) {
  return `terraform:state:${workspaceName}`;
}

export async function runScriptInDocker({ runId, stageRunId, script, env = {}, timeoutMs = 10 * 60 * 1000, image }) {
  const publish = (line) => log.publish({ runId, stageRunId, line });
  if (!script) return { success: false, stdout: '', stderr: 'missing switch script' };

  if (process.env.AlphaOps_TEST_FAKE_DOCKER) {
    const s = String(script);
    const success = !s.toLowerCase().includes('fail');
    publish(`[FakeDocker] ${success ? 'ok' : 'fail'}: ${s}`);
    return { success, stdout: success ? 'ok' : '', stderr: success ? '' : 'fail' };
  }

  const dockerImage = image || process.env.BLUEGREEN_SWITCH_IMAGE || 'alpine:3.20';
  const args = ['run', '--rm', dockerImage, 'sh', '-lc', script];
  publish(`[Blue/Green] docker ${args.join(' ')}`);

  return new Promise((resolve) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch {}
      resolve({ success: false, stdout, stderr: stderr + '\n' + 'switch timed out' });
    }, timeoutMs);

    child.stdout.on('data', (d) => {
      const s = d.toString('utf8');
      stdout += s;
      publish(s);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString('utf8');
      stderr += s;
      publish(s);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ success: code === 0, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, stdout, stderr: String(err?.message || err) });
    });
  });
}

export async function prepareWorkspace({ workspaceName, projectId, backendConfig }) {
  const workspacePath = getWorkspacePath(workspaceName);
  ensureDir(workspacePath);

  // Check if workspace exists in DB
  const existing = await query(
    'SELECT * FROM terraform_workspaces WHERE project_id = $1 AND name = $2',
    [projectId || null, workspaceName]
  );

  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO terraform_workspaces (project_id, name, workspace_type, state_backend, locked)
       VALUES ($1, $2, $3, $4, false)`,
      [projectId || null, workspaceName, 'persistent', JSON.stringify(backendConfig || {})]
    );
  }

  return { workspacePath, workspaceName };
}

export async function terraformInit({ workspacePath, backendConfig, env = {} }) {
  const backendArgs = [];
  if (backendConfig) {
    if (backendConfig.bucket) backendArgs.push(`-backend-config=bucket=${backendConfig.bucket}`);
    if (backendConfig.key) backendArgs.push(`-backend-config=key=${backendConfig.key}`);
    if (backendConfig.region) backendArgs.push(`-backend-config=region=${backendConfig.region}`);
    if (backendConfig.dynamodb_table) backendArgs.push(`-backend-config=dynamodb_table=${backendConfig.dynamodb_table}`);
  }

  const result = await runDockerTerraform(['init', '-input=false', ...backendArgs], {
    workspacePath,
    env,
    timeoutMs: 5 * 60 * 1000,
  });

  return { success: result.code === 0, stdout: result.stdout, stderr: result.stderr };
}

export async function terraformPlan({ runId, stageRunId, workspacePath, varFiles = [], env = {} }) {
  const planFile = path.join(workspacePath, 'plan.tfplan');
  const args = ['plan', '-input=false', '-out=plan.tfplan'];

  for (const vf of varFiles) {
    args.push(`-var-file=${vf}`);
  }

  const result = await runDockerTerraform(args, { workspacePath, env, timeoutMs: 10 * 60 * 1000 });

  let planUri = null;
  let artifactId = null;

  if (result.code === 0 && fs.existsSync(planFile)) {
    const upload = await uploadPlanArtifact(runId, stageRunId, planFile);
    if (upload) {
      planUri = upload.uri;
      artifactId = upload.artifactId;
    }

    // Also upload plan text for UI viewing
    const showResult = await runDockerTerraform(['show', '-no-color', 'plan.tfplan'], { workspacePath, env, timeoutMs: 60 * 1000 });
    if (showResult.code === 0) {
      await uploadPlanText(runId, stageRunId, showResult.stdout);
    }
  }

  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
    planUri,
    artifactId,
  };
}

export async function terraformApply({ runId, stageRunId, workspacePath, planUri, env = {} }) {
  // If planUri is s3://, we need to download it first
  let planFile = 'plan.tfplan';

  if (planUri && planUri.startsWith('s3://')) {
    // For now, assume plan.tfplan exists in workspace (it should from previous plan step)
    // In production, you'd download from S3 here
    planFile = 'plan.tfplan';
  }

  const args = ['apply', '-input=false', '-auto-approve', planFile];

  const result = await runDockerTerraform(args, { workspacePath, env, timeoutMs: 15 * 60 * 1000 });

  return {
    success: result.code === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

export async function runTerraformPersistent({ runId, stageRunId, stageDef, ctx }) {
  const workspaceName = stageDef.workspace_name || `project_${ctx.projectId || 'default'}_env_${stageDef.environment || 'prod'}`;
  const backendConfig = stageDef.backend || {};
  const varFiles = stageDef.var_files || [];
  const mode = stageDef.mode || 'plan_apply'; // 'plan_only', 'plan_apply', 'apply_only', 'ephemeral', 'blue_green'

  const holder = `run:${runId}:stage:${stageRunId}`;

  if (mode === 'ephemeral') {
    // Auto plan + apply, capture outputs
    return await withRedlock(
      { key: lockKeyForWorkspace(workspaceName), ttlMs: Number(process.env.REDIS_LOCK_TTL_MS || 60 * 60 * 1000), waitMs: 5 * 60 * 1000 },
      async () => {
        const { workspacePath } = await prepareWorkspace({ workspaceName, projectId: ctx.projectId, backendConfig });
        const publish = (line) => log.publish({ runId, stageRunId, line });

        publish(`[Terraform] (ephemeral) init ${workspaceName}`);
        const initResult = await terraformInit({ workspacePath, backendConfig, env: ctx.env || {} });
        if (initResult.stdout) publish(initResult.stdout);
        if (initResult.stderr) publish(initResult.stderr);
        if (!initResult.success) return { success: false, outputs: { error: 'Terraform init failed' } };

        publish(`[Terraform] (ephemeral) plan`);
        const planResult = await terraformPlan({ runId, stageRunId, workspacePath, varFiles, env: ctx.env || {} });
        if (planResult.stdout) publish(planResult.stdout);
        if (planResult.stderr) publish(planResult.stderr);
        if (!planResult.success) return { success: false, outputs: { error: 'Terraform plan failed' } };

        publish(`[Terraform] (ephemeral) apply`);
        const applyResult = await terraformApply({ runId, stageRunId, workspacePath, planUri: planResult.planUri, env: ctx.env || {} });
        if (applyResult.stdout) publish(applyResult.stdout);
        if (applyResult.stderr) publish(applyResult.stderr);
        if (!applyResult.success) return { success: false, outputs: { error: 'Terraform apply failed' } };

        const out = await terraformOutputJson({ workspacePath, env: ctx.env || {} });
        if (out.stdout) publish(out.stdout);
        if (out.stderr) publish(out.stderr);

        return {
          success: true,
          outputs: {
            applied: true,
            workspaceName,
            mode,
            planUri: planResult.planUri,
            outputs: out.outputs || null,
          },
        };
      }
    );
  }

  if (mode === 'blue_green') {
    // Auto apply new infra, run smoke test script (optional), then await approval for traffic switch
    const smokeScript = stageDef.smoke_test_script;
    const switchScript = stageDef.switch_script;
    const autoSwitch = Boolean(stageDef.auto_switch);

    return await withRedlock(
      { key: lockKeyForWorkspace(workspaceName), ttlMs: Number(process.env.REDIS_LOCK_TTL_MS || 60 * 60 * 1000), waitMs: 5 * 60 * 1000 },
      async () => {
        const { workspacePath } = await prepareWorkspace({ workspaceName, projectId: ctx.projectId, backendConfig });
        const publish = (line) => log.publish({ runId, stageRunId, line });

        publish(`[Terraform] (blue-green) init ${workspaceName}`);
        const initResult = await terraformInit({ workspacePath, backendConfig, env: ctx.env || {} });
        if (initResult.stdout) publish(initResult.stdout);
        if (initResult.stderr) publish(initResult.stderr);
        if (!initResult.success) return { success: false, outputs: { error: 'Terraform init failed' } };

        publish(`[Terraform] (blue-green) plan`);
        const planResult = await terraformPlan({ runId, stageRunId, workspacePath, varFiles, env: ctx.env || {} });
        if (planResult.stdout) publish(planResult.stdout);
        if (planResult.stderr) publish(planResult.stderr);
        if (!planResult.success) return { success: false, outputs: { error: 'Terraform plan failed' } };

        publish(`[Terraform] (blue-green) apply`);
        const applyResult = await terraformApply({ runId, stageRunId, workspacePath, planUri: planResult.planUri, env: ctx.env || {} });
        if (applyResult.stdout) publish(applyResult.stdout);
        if (applyResult.stderr) publish(applyResult.stderr);
        if (!applyResult.success) return { success: false, outputs: { error: 'Terraform apply failed' } };

        if (smokeScript) {
          publish('[Blue/Green] smoke tests...');
          const smoke = await runScriptInDocker({ runId, stageRunId, script: smokeScript, env: ctx.env || {}, timeoutMs: 10 * 60 * 1000 });
          if (!smoke.success) {
            return { success: false, outputs: { error: 'smoke tests failed' } };
          }
        }

        if (autoSwitch && switchScript) {
          publish('[Blue/Green] auto switch...');
          const sw = await runScriptInDocker({ runId, stageRunId, script: switchScript, env: ctx.env || {}, timeoutMs: 10 * 60 * 1000 });
          return {
            success: sw.success,
            outputs: {
              applied: true,
              switched: sw.success,
              workspaceName,
              mode,
            },
          };
        }

        return {
          success: true,
          outputs: {
            awaiting_approval: true,
            approval_type: 'switch',
            workspaceName,
            mode,
            planUri: planResult.planUri,
          },
        };
      }
    );
  }

  return await withLock(
    workspaceName,
    holder,
    async () => {
      // Prepare workspace
      const { workspacePath } = await prepareWorkspace({ workspaceName, projectId: ctx.projectId, backendConfig });

      // Stream logs
      const publish = (line) => log.publish({ runId, stageRunId, line });

      publish(`[Terraform] Initializing workspace: ${workspaceName}`);

      // Init
      const initResult = await terraformInit({ workspacePath, backendConfig, env: ctx.env || {} });
      if (initResult.stdout) publish(initResult.stdout);
      if (initResult.stderr) publish(initResult.stderr);

      if (!initResult.success) {
        return { success: false, outputs: { error: 'Terraform init failed' } };
      }

      // Plan phase
      publish(`[Terraform] Running plan...`);
      const planResult = await terraformPlan({ runId, stageRunId, workspacePath, varFiles, env: ctx.env || {} });
      if (planResult.stdout) publish(planResult.stdout);
      if (planResult.stderr) publish(planResult.stderr);

      if (!planResult.success) {
        return { success: false, outputs: { error: 'Terraform plan failed' } };
      }

      publish(`[Terraform] Plan artifact: ${planResult.planUri || 'local'}`);

      // For persistent mode with approval gating
      if (mode === 'plan_apply' || mode === 'plan_only') {
        // Return awaiting_approval status with plan artifact
        return {
          success: true,
          outputs: {
            awaiting_approval: true,
            planUri: planResult.planUri,
            planArtifactId: planResult.artifactId,
            workspaceName,
            mode,
          },
        };
      }

      // Apply only mode (no approval gate)
      if (mode === 'apply_only') {
        publish(`[Terraform] Running apply...`);
        const applyResult = await terraformApply({ runId, stageRunId, workspacePath, planUri: planResult.planUri, env: ctx.env || {} });
        if (applyResult.stdout) publish(applyResult.stdout);
        if (applyResult.stderr) publish(applyResult.stderr);

        return {
          success: applyResult.success,
          outputs: {
            applied: applyResult.success,
            workspaceName,
          },
        };
      }

      return { success: false, outputs: { error: `Unknown mode: ${mode}` } };
    },
    { ttlSeconds: 600 }
  );
}

export async function resumeTerraformApply({ runId, stageRunId, stageDef, ctx, planUri }) {
  const workspaceName = stageDef.workspace_name || `project_${ctx.projectId || 'default'}_env_${stageDef.environment || 'prod'}`;
  const holder = `run:${runId}:stage:${stageRunId}:resume`;

  return await withLock(
    workspaceName,
    holder,
    async () => {
      const { workspacePath } = await prepareWorkspace({ workspaceName, projectId: ctx.projectId, backendConfig: stageDef.backend || {} });

      const publish = (line) => log.publish({ runId, stageRunId, line });
      publish(`[Terraform] Resuming apply for workspace: ${workspaceName}`);

      const applyResult = await terraformApply({ runId, stageRunId, workspacePath, planUri, env: ctx.env || {} });
      if (applyResult.stdout) publish(applyResult.stdout);
      if (applyResult.stderr) publish(applyResult.stderr);

      return {
        success: applyResult.success,
        outputs: {
          applied: applyResult.success,
          workspaceName,
        },
      };
    },
    { ttlSeconds: 900 }
  );
}
