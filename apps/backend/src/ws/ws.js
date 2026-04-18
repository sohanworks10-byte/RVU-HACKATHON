import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';

import { getRedisSub } from '../infra/redis.js';
import { query } from '../infra/db.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

async function requireWsUser(token) {
  if (!supabase) return null;
  if (!token) return null;
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser(String(token));
    return user || null;
  } catch {
    return null;
  }
}

async function canAccessRun(user, runId) {
  if (!user || !runId) return false;
  
  // Check if user is the creator of the run or has project access
  try {
    const res = await query(
      `SELECT pr.created_by, p.project_id 
       FROM pipeline_runs pr
       JOIN pipelines p ON p.id = pr.pipeline_id
       WHERE pr.id = $1`,
      [runId]
    );
    
    if (res.rows.length === 0) return false;
    
    const row = res.rows[0];
    const userId = user.id || user.email;
    
    // User is the creator
    if (row.created_by === userId || row.created_by === user.email) {
      return true;
    }
    
    // TODO: Check project membership via project_id
    // For now, allow if same creator or if no project (public runs)
    if (!row.project_id) return true;
    
    return false;
  } catch {
    return false;
  }
}

async function canAccessStage(user, stageRunId) {
  if (!user || !stageRunId) return false;
  
  try {
    const res = await query(
      `SELECT pr.created_by, p.project_id 
       FROM stage_runs sr
       JOIN pipeline_runs pr ON pr.id = sr.pipeline_run_id
       JOIN pipelines p ON p.id = pr.pipeline_id
       WHERE sr.id = $1`,
      [stageRunId]
    );
    
    if (res.rows.length === 0) return false;
    
    const row = res.rows[0];
    const userId = user.id || user.email;
    
    if (row.created_by === userId || row.created_by === user.email) {
      return true;
    }
    
    if (!row.project_id) return true;
    
    return false;
  } catch {
    return false;
  }
}

export async function attachPipelineWs({ server, path = '/ws' }) {
  const wss = new WebSocketServer({ noServer: true });

  if (server) {
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url, 'http://localhost');
        const pathname = url.pathname || '';
        if (pathname !== path && pathname !== `${path}/`) {
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit('connection', ws, req);
        });
      } catch {
        return;
      }
    });
  }

  wss.on('connection', async (ws, req) => {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    const user = await requireWsUser(token);
    if (!user) {
      ws.close(1008, 'Invalid authentication');
      return;
    }

    const runId = url.searchParams.get('runId');
    const stageRunId = url.searchParams.get('stageRunId');

    // Authorization check
    if (runId && !(await canAccessRun(user, runId))) {
      ws.close(1008, 'Access denied');
      return;
    }
    
    if (stageRunId && !(await canAccessStage(user, stageRunId))) {
      ws.close(1008, 'Access denied');
      return;
    }

    const sub = await getRedisSub();
    if (!sub) {
      ws.send(JSON.stringify({ type: 'error', error: 'Redis not configured' }));
      ws.close();
      return;
    }

    const channels = [];
    if (stageRunId) {
      channels.push(`logs:stageRun:${stageRunId}`);
      channels.push(`status:stageRun:${stageRunId}`);
    }
    if (runId) {
      channels.push(`status:run:${runId}`);
    }

    const handler = (message) => {
      try {
        ws.send(message);
      } catch {
        try {
          ws.close();
        } catch {}
      }
    };

    try {
      for (const ch of channels) {
        await sub.subscribe(ch, handler);
      }
    } catch {
      ws.close();
      return;
    }

    ws.on('close', async () => {
      try {
        for (const ch of channels) {
          await sub.unsubscribe(ch);
        }
      } catch {}
    });
  });

  return wss;
}
