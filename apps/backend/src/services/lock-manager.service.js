import { getRedisPub } from '../infra/redis.js';

const DEFAULT_LOCK_TTL_SECONDS = 300; // 5 minutes

export class LockManager {
  constructor(redisClient) {
    this.redis = redisClient;
  }

  static async create() {
    const client = await getRedisPub();
    if (!client) throw new Error('Redis not available for locking');
    return new LockManager(client);
  }

  lockKey(workspaceId) {
    return `terraform:lock:${workspaceId}`;
  }

  async acquire(workspaceId, holder, ttlSeconds = DEFAULT_LOCK_TTL_SECONDS) {
    const key = this.lockKey(workspaceId);
    const now = Date.now();
    const expiry = now + ttlSeconds * 1000;
    const value = JSON.stringify({ holder, expiry });

    // Use SET NX EX for atomic acquire
    const acquired = await this.redis.set(key, value, { NX: true, EX: ttlSeconds });
    if (acquired === 'OK') {
      return { acquired: true, holder, expiry };
    }

    // Check if existing lock expired
    const existing = await this.redis.get(key);
    if (existing) {
      try {
        const parsed = JSON.parse(existing);
        if (parsed.expiry < now) {
          // Lock expired, take over
          await this.redis.set(key, value, { EX: ttlSeconds });
          return { acquired: true, holder, expiry, previous: parsed };
        }
        return { acquired: false, holder: parsed.holder, expiry: parsed.expiry };
      } catch {
        return { acquired: false };
      }
    }

    return { acquired: false };
  }

  async release(workspaceId, holder) {
    const key = this.lockKey(workspaceId);
    const existing = await this.redis.get(key);
    if (!existing) return true;

    try {
      const parsed = JSON.parse(existing);
      if (parsed.holder === holder) {
        await this.redis.del(key);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async extend(workspaceId, holder, additionalSeconds) {
    const key = this.lockKey(workspaceId);
    const existing = await this.redis.get(key);
    if (!existing) return false;

    try {
      const parsed = JSON.parse(existing);
      if (parsed.holder !== holder) return false;

      const newExpiry = Date.now() + additionalSeconds * 1000;
      const value = JSON.stringify({ holder, expiry: newExpiry });
      await this.redis.set(key, value, { EX: additionalSeconds });
      return true;
    } catch {
      return false;
    }
  }

  async getLockInfo(workspaceId) {
    const key = this.lockKey(workspaceId);
    const existing = await this.redis.get(key);
    if (!existing) return null;

    try {
      const parsed = JSON.parse(existing);
      if (parsed.expiry < Date.now()) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}

export async function withLock(workspaceId, holder, fn, options = {}) {
  const { ttlSeconds = DEFAULT_LOCK_TTL_SECONDS, onExtend } = options;
  const manager = await LockManager.create();

  const result = await manager.acquire(workspaceId, holder, ttlSeconds);
  if (!result.acquired) {
    throw new Error(`Workspace ${workspaceId} is locked by ${result.holder || 'unknown'}`);
  }

  let extended = false;
  const extendInterval = setInterval(async () => {
    if (!extended) {
      extended = true;
      try {
        await manager.extend(workspaceId, holder, ttlSeconds);
        if (onExtend) onExtend();
      } finally {
        extended = false;
      }
    }
  }, (ttlSeconds * 1000) / 2);

  try {
    return await fn(manager);
  } finally {
    clearInterval(extendInterval);
    await manager.release(workspaceId, holder);
  }
}
