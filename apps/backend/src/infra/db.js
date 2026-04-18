import pg from 'pg';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const { Pool } = pg;

let pool = null;
let inmemInitialized = false;

async function initInMemoryDb() {
  if (inmemInitialized) return;
  inmemInitialized = true;

  const { newDb } = await import('pg-mem');
  const mem = newDb({ autoCreateForeignKeyIndices: true });

  // minimal extensions used by migrations
  mem.public.registerFunction({
    name: 'gen_random_uuid',
    returns: 'uuid',
    implementation: () => crypto.randomUUID(),
    impure: true,
  });

  const adapter = mem.adapters.createPg();
  pool = new adapter.Pool();

  // Apply migrations
  const migrations = [
    './src/migrations/001_pipelines.sql',
    './src/migrations/002_phase2_additions.sql',
    './src/migrations/003_phase3_preview_and_audit.sql',
    './src/migrations/004_phase4_projects.sql',
    './src/migrations/005_app_settings.sql',
    './src/migrations/006_agent_binary_urls.sql',
  ];

  for (const rel of migrations) {
    const abs = path.resolve(rel);
    if (!fs.existsSync(abs)) continue;
    const sql = fs.readFileSync(abs, 'utf8');
    // pg-mem does not support CREATE EXTENSION or plpgsql DO $$ blocks.
    const lines = sql.split('\n');
    const cleanedLines = [];
    let inDoBlock = false;

    for (const line of lines) {
      const t = line.trim().toLowerCase();
      if (t.startsWith('do $$')) {
        inDoBlock = true;
        continue;
      }
      if (inDoBlock) {
        if (t.endsWith('$$;') || t === 'end $$;' || t === 'end$$;' || t === 'end $$') {
          inDoBlock = false;
        }
        continue;
      }
      if (t.startsWith('create extension')) continue;
      cleanedLines.push(line);
    }

    const cleaned = cleanedLines.join('\n');
    await pool.query(cleaned);
  }
}

// Note: crypto.randomUUID() is used for pg-mem gen_random_uuid().

export function getDb() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;
  if (!connectionString) {
    // Return null when no DB is configured; callers must handle gracefully
    return null;
  }

  pool = new Pool({
    connectionString,
    ssl: process.env.PGSSLMODE === 'disable' ? false : process.env.PGSSL === 'false' ? false : undefined,
    max: process.env.PG_POOL_MAX ? Number(process.env.PG_POOL_MAX) : 10,
  });

  return pool;
}

export async function query(text, params) {
  try {
    const db = getDb();
    if (!db) {
      // DB not configured; throw a specific error for upstream to handle
      const err = new Error('DATABASE_NOT_CONFIGURED');
      err.code = 'DATABASE_NOT_CONFIGURED';
      throw err;
    }
    return db.query(text, params);
  } catch (e) {
    if (e && String(e.message) === 'INMEM_DB_PENDING') {
      await initInMemoryDb();
      return pool.query(text, params);
    }
    throw e;
  }
}
