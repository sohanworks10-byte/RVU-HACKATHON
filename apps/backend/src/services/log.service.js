import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

import { getRedisPub } from '../infra/redis.js';
import { putObject } from '../infra/s3.js';

const TMP_DIR = path.resolve('./tmp/logs');
const ARCHIVES_DIR = path.resolve('./archives');

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

function maskSecrets(input) {
  const raw = String(input ?? '');
  const patterns = [];

  if (process.env.AlphaOps_LOG_MASK_REGEX) {
    try {
      patterns.push(new RegExp(process.env.AlphaOps_LOG_MASK_REGEX, 'gi'));
    } catch {}
  }

  if (process.env.AlphaOps_SECRET_MASK && String(process.env.AlphaOps_SECRET_MASK).trim()) {
    const secrets = String(process.env.AlphaOps_SECRET_MASK)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const s of secrets) {
      patterns.push(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'));
    }
  }

  // Basic token-like masking
  patterns.push(/(Bearer\s+)[A-Za-z0-9\-_.=]+/g);
  patterns.push(/(api[_-]?key\s*[:=]\s*)[^\s]+/gi);
  patterns.push(/(token\s*[:=]\s*)[^\s]+/gi);
  patterns.push(/(password\s*[:=]\s*)[^\s]+/gi);

  let out = raw;
  for (const re of patterns) {
    out = out.replace(re, '$1***');
  }
  return out;
}

export async function publish({ runId, stageRunId, line }) {
  const ts = new Date().toISOString();
  const masked = maskSecrets(line);

  ensureDir(TMP_DIR);
  const filePath = path.join(TMP_DIR, `${stageRunId}.log`);
  fs.appendFileSync(filePath, `${masked}\n`);

  const pub = await getRedisPub();
  if (!pub) return;

  const payload = {
    type: 'stage_log',
    runId,
    stageRunId,
    line: masked,
    ts,
  };

  await pub.publish(`logs:stageRun:${stageRunId}`, JSON.stringify(payload));
}

export async function publishStatus({ runId, stageRunId, status }) {
  const pub = await getRedisPub();
  if (!pub) return;

  const payload = {
    type: 'stage_status',
    runId,
    stageRunId,
    status,
    ts: new Date().toISOString(),
  };

  await pub.publish(`status:stageRun:${stageRunId}`, JSON.stringify(payload));
}

export async function publishRunStatus({ runId, status }) {
  const pub = await getRedisPub();
  if (!pub) return;

  const payload = {
    type: 'run_status',
    runId,
    status,
    ts: new Date().toISOString(),
  };

  await pub.publish(`status:run:${runId}`, JSON.stringify(payload));
}

export function getTempLogPath(stageRunId) {
  return path.join(TMP_DIR, `${stageRunId}.log`);
}

export async function archive({ runId, stageRunId }) {
  ensureDir(ARCHIVES_DIR);

  const src = getTempLogPath(stageRunId);
  const input = fs.existsSync(src) ? fs.readFileSync(src) : Buffer.from('');
  const gz = zlib.gzipSync(input);

  // Phase-2: prefer S3/MinIO if configured.
  try {
    const bucket = process.env.ARTIFACTS_BUCKET;
    if (bucket) {
      const key = `runs/${runId}/logs/${stageRunId}.log.gz`;
      const uploadedUrl = await putObject({ bucket, key, body: gz, contentType: 'application/gzip' });
      if (uploadedUrl) {
        return `s3://${bucket}/${key}`;
      }
    }
  } catch {}

  const runDir = path.join(ARCHIVES_DIR, runId);
  ensureDir(runDir);

  const dest = path.join(runDir, `${stageRunId}.log.gz`);
  fs.writeFileSync(dest, gz);

  return `/archives/${runId}/${stageRunId}.log.gz`;
}
