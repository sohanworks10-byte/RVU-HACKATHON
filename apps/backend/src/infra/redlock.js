import crypto from 'crypto';

import { getRedisPub } from './redis.js';
import { query } from './db.js';

function randomToken() {
  return crypto.randomBytes(16).toString('hex');
}

async function acquireDbLock({ key, ttlMs, waitMs, retryDelayMs }) {
  const token = randomToken();
  const deadline = Date.now() + waitMs;
  const lockKey = `lock:${key}`;

  while (Date.now() < deadline) {
    const ttl = new Date(Date.now() + ttlMs).toISOString();
    try {
      const res = await query(
        'insert into idempotency_keys (key, ttl) values ($1,$2) on conflict do nothing returning key',
        [lockKey, ttl]
      );
      if (res.rows.length > 0) {
        return { key: lockKey, token, ttlMs, dbLock: true };
      }

      // Cleanup expired locks
      await query('delete from idempotency_keys where key = $1 and ttl < now()', [lockKey]).catch(() => {});
    } catch (e) {
      // Missing table or SQL error should fail fast in tests.
      throw e;
    }

    await new Promise((r) => setTimeout(r, retryDelayMs));
  }

  throw new Error(`Failed to acquire lock for ${key}`);
}

// Minimal single-instance lock (not full Redlock quorum) but provides distributed safety on Railway.
export async function acquireLock({ key, ttlMs = 60 * 60 * 1000, waitMs = 5 * 60 * 1000, retryDelayMs = 250 }) {
  const redis = await getRedisPub();
  if (!redis) {
    if (process.env.NODE_ENV === 'test') {
      const effectiveWaitMs = waitMs === 5 * 60 * 1000 ? 5 * 1000 : waitMs;
      return acquireDbLock({ key, ttlMs, waitMs: effectiveWaitMs, retryDelayMs });
    }
    throw new Error('Redis not available');
  }

  const token = randomToken();
  const deadline = Date.now() + waitMs;

  while (Date.now() < deadline) {
    const ok = await redis.set(key, token, { NX: true, PX: ttlMs });
    if (ok === 'OK') {
      return { key, token, ttlMs };
    }
    await new Promise((r) => setTimeout(r, retryDelayMs));
  }

  throw new Error(`Failed to acquire lock for ${key}`);
}

export async function releaseLock(lock) {
  if (lock && lock.dbLock) {
    try {
      await query('delete from idempotency_keys where key = $1', [lock.key]);
      return true;
    } catch {
      return false;
    }
  }

  const redis = await getRedisPub();
  if (!redis) return false;

  const lua = `
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
  `;

  const res = await redis.eval(lua, {
    keys: [lock.key],
    arguments: [lock.token],
  });

  return Number(res || 0) > 0;
}

export async function withLock({ key, ttlMs, waitMs }, fn) {
  const lock = await acquireLock({ key, ttlMs, waitMs });
  try {
    return await fn();
  } finally {
    await releaseLock(lock).catch(() => {});
  }
}
