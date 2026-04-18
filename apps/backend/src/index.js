import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

import { agentConnection } from './agent-connection.js';
import { sshConnection } from './ssh-connection.js';
import { createApp } from './app.js';
import { query } from './infra/db.js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

const supabase = (supabaseUrl && supabaseAnonKey)
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

async function requireUser(req, res, next) {
  try {
    if (!supabase) {
      return res.status(503).json({ error: 'Backend misconfigured: missing SUPABASE_URL or SUPABASE_ANON_KEY' });
    }

    const authHeader = req.get('authorization');
    if (!authHeader) {
      const fallbackToken =
        (req.body && (req.body.access_token || req.body.token)) ||
        (req.query && (req.query.access_token || req.query.token));
      if (!fallbackToken) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      req.accessToken = fallbackToken;
    }

    // Handle token extraction - could be JWT string or Supabase session object
    let rawToken = req.accessToken || authHeader?.replace('Bearer ', '');
    
    // If token looks like a JSON object (Supabase session), extract the access_token
    if (rawToken && rawToken.startsWith('{')) {
      try {
        const sessionObj = JSON.parse(rawToken);
        rawToken = sessionObj.access_token || rawToken;
      } catch (e) {
        // Not valid JSON, use as-is
      }
    }
    if (!rawToken) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(rawToken);

    if (authError || !user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    req.user = user;
    req.accessToken = rawToken;

    return next();
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Request failed' });
  }
}

function validateServerIdOwnership(req, res, serverId) {
  if (!serverId || typeof serverId !== 'string') {
    res.status(400).json({ error: 'serverId is required' });
    return false;
  }

  if (!serverId.startsWith(req.user.id)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
}

const sshStatsCache = new Map();
const SSH_STATS_CACHE_TTL_MS = 2500;

function getConnection(serverId) {
  if (agentConnection.isAgentServerId(serverId)) return agentConnection;
  return sshConnection;
}

let appSettingsCache = null;
let appSettingsCacheTs = 0;
const APP_SETTINGS_CACHE_TTL_MS = 60_000;

async function readAppSettings() {
  const now = Date.now();
  if (appSettingsCache && now - appSettingsCacheTs < APP_SETTINGS_CACHE_TTL_MS) return appSettingsCache;
  try {
    const res = await query('select key, value from app_settings');
    const map = new Map();
    for (const row of res.rows || []) {
      map.set(String(row.key), String(row.value ?? ''));
    }
    appSettingsCache = map;
    appSettingsCacheTs = now;
    return map;
  } catch (e) {
    if (e && e.code === 'DATABASE_NOT_CONFIGURED') {
      // Gracefully degrade when DB is not configured
      return new Map();
    }
    return new Map();
  }
}

async function getAppSetting(key) {
  const map = await readAppSettings();
  return String(map.get(key) || '').trim();
}

function getBackendOrigin(req) {
  // Try Railway's forwarded headers first
  let proto = req.get('x-forwarded-proto');
  let host = req.get('x-forwarded-host') || req.get('host');

  // If headers are missing (common in some proxy setups), fall back to env vars
  if (!host || host === 'localhost' || host === '127.0.0.1' || host.includes(':')) {
    const envUrl = process.env.RAILWAY_PUBLIC_DOMAIN || process.env.RAILWAY_SERVICE_URL || process.env.BACKEND_URL;
    if (envUrl) {
      return envUrl.replace(/\/+$/, '');
    }
  }

  // Default to https for production if proto not specified
  if (!proto && (host && !host.includes('localhost') && !host.includes('127.0.0.1'))) {
    proto = 'https';
  }

  proto = proto || 'http';
  host = host || 'localhost:8080';
  return `${proto}://${host}`;
}

const app = express();

// Serve archived logs
app.use('/archives', express.static(path.resolve('./archives')));

app.use(
  cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json({ limit: '10mb' }));

// New modular API (pipelines/runs). Mounted after body parser so it doesn't break things
app.use(createApp());

app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Configuration endpoints
app.get('/config/base-url', (req, res) => {
  const port = process.env.PORT || 3000;
  res.json({ success: true, url: `http://localhost:${port}` });
});

// Security settings endpoint
app.get('/security/settings', requireUser, async (req, res) => {
  try {
    const settingsRes = await query(
      'SELECT key, value FROM user_settings WHERE user_id = $1 AND key LIKE $2',
      [req.user.id, 'security.%']
    );
    const settings = {};
    settingsRes.rows.forEach(row => {
      settings[row.key.replace('security.', '')] = row.value;
    });
    res.json({ success: true, settings });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auth endpoints for web mode compatibility
app.get('/auth/session', requireUser, async (req, res) => {
  res.json({ success: true, user: req.user });
});

app.get('/auth/token', requireUser, async (req, res) => {
  res.json({ success: true, token: req.token });
});

app.post('/ai/chat', requireUser, async (req, res) => {
  try {
    const apiKey = String(process.env.OPENROUTER_API_KEY || '').trim();
    if (!apiKey) {
      return res.status(503).json({ error: 'Backend misconfigured: missing OPENROUTER_API_KEY' });
    }

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    const primaryModel = String(process.env.OPENROUTER_MODEL || 'z-ai/glm-4.5-air:free').trim();
    const fallbackModelsEnv = String(process.env.OPENROUTER_FALLBACK_MODELS || '').trim();
    const fallbackModels = fallbackModelsEnv
      ? fallbackModelsEnv
          .split(',')
          .map((s) => String(s || '').trim())
          .filter(Boolean)
      : [];
    const modelsToTry = [primaryModel, ...fallbackModels];

    const body = req.body || {};
    const prompt = String(body.prompt || '').trim();
    const mode = String(body.mode || '').trim() || 'command';
    const serverContext = body.serverContext || null;
    const chatHistory = Array.isArray(body.chatHistory) ? body.chatHistory : [];
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });

    const systemParts = [];
    systemParts.push('You are DevAI, an assistant for managing Linux servers.');
    if (mode === 'command') {
      systemParts.push('Return ONLY a single shell command as plain text. No markdown.');
    } else if (mode === 'chat') {
      systemParts.push('Be concise and helpful. If you include a command, put it in a fenced code block.');
    } else if (mode === 'script') {
      systemParts.push('Return ONLY a bash script. No markdown. Start with #!/bin/bash');
    } else if (mode === 'json-command') {
      systemParts.push('Return STRICT JSON with keys: summary, command. No markdown.');
    }
    if (serverContext) {
      systemParts.push('Server context (may be partial):');
      systemParts.push(typeof serverContext === 'string' ? serverContext : JSON.stringify(serverContext));
    }
    const systemPrompt = systemParts.join('\n');

    const messages = [];
    messages.push({ role: 'system', content: systemPrompt });

    for (const m of chatHistory) {
      if (!m) continue;
      const roleRaw = String(m.role || '').toLowerCase();
      const role = roleRaw === 'assistant' || roleRaw === 'ai' ? 'assistant' : 'user';
      const content = String(m.content || m.text || '').trim();
      if (!content) continue;
      messages.push({ role, content });
    }

    messages.push({ role: 'user', content: prompt });

    let lastErrText = '';
    let lastStatus = 0;

    for (const model of modelsToTry) {
      const maxAttempts = 2;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            messages,
            temperature: 0.3,
            stream: false,
          }),
        });

        if (resp.ok) {
          const data = await resp.json();
          const text = data?.choices?.[0]?.message?.content || '';
          return res.json({ success: true, script: String(text || '').trim() });
        }

        lastStatus = resp.status || 0;
        lastErrText = await resp.text();

        let providerMessage = '';
        try {
          const parsed = JSON.parse(lastErrText);
          providerMessage =
            parsed?.error?.metadata?.raw ||
            parsed?.error?.message ||
            parsed?.message ||
            '';
        } catch (e) {
          providerMessage = lastErrText;
        }
        providerMessage = String(providerMessage || '').trim();
        if (providerMessage.length > 300) providerMessage = providerMessage.slice(0, 300) + '…';

        const isRateLimited = lastStatus === 429 || /\b429\b/.test(lastErrText);
        if (isRateLimited) {
          if (attempt < maxAttempts) {
            await sleep(800 * attempt);
            continue;
          }
          break;
        }

        const errMsg = providerMessage ? `OpenRouter error: ${providerMessage}` : 'OpenRouter error';
        return res.status(502).json({ error: errMsg });
      }
    }

    let shortRateLimitMsg = 'AI provider is temporarily rate-limited. Please retry shortly.';
    try {
      const parsed = JSON.parse(lastErrText);
      const raw =
        parsed?.error?.metadata?.raw ||
        parsed?.error?.message ||
        parsed?.message ||
        '';
      if (raw) {
        shortRateLimitMsg = String(raw).trim();
        if (shortRateLimitMsg.length > 300) shortRateLimitMsg = shortRateLimitMsg.slice(0, 300) + '…';
      }
    } catch (e) {
    }
    return res.status(429).json({ error: shortRateLimitMsg });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'AI request failed' });
  }
});

app.post('/ssh/connect', requireUser, async (req, res) => {
  try {
    const config = req.body;

    const serverId = `${req.user.id}_${config.host}_${Date.now()}`;
    
    console.log(`[backend] SSH connect request for serverId: ${serverId}, host: ${config.host}`);

    const result = await sshConnection.connect(serverId, config);
    
    console.log(`[backend] SSH connect successful for serverId: ${serverId}`);

    return res.json({ ...result, serverId });
  } catch (error) {
    console.error(`[backend] SSH connect failed:`, error.message);
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/disconnect', requireUser, async (req, res) => {
  try {
    const { serverId } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    const result = connection.disconnect(serverId);

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/command', requireUser, async (req, res) => {
  try {
    const { serverId, command } = req.body;
    
    console.log(`[backend] Command request - ServerId: ${serverId}, Command: ${command?.substring(0, 50)}...`);

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      console.log(`[backend] Command execution failed - not connected. ServerId: ${serverId}`);
      return res.status(409).json({ error: 'Not connected' });
    }

    const result = await connection.exec(serverId, command);
    console.log(`[backend] Command executed successfully for serverId: ${serverId}`);

    return res.json(result);
  } catch (error) {
    const errMsg = String(error.message || error);
    console.error(`[backend] Command execution error:`, errMsg);
    
    // If connection is stale, return 409 to trigger reconnection
    if (errMsg.includes('stale') || errMsg.includes('Channel open failure')) {
      return res.status(409).json({ error: 'Connection lost. Please reconnect.' });
    }
    
    // For other errors, return 500 with JSON
    return res.status(500).json({ error: errMsg });
  }
});

app.post('/ssh/stats', requireUser, async (req, res) => {
  try {
    const { serverId } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    const commandMap = {
      df: 'df -h | grep -vE "^Filesystem|tmpfs|cdrom|udev"',
      free: 'free -h',
      uptime: 'uptime',
      os: '(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME") || (lsb_release -ds 2>/dev/null) || uname -s',
      kernel: 'uname -r',
      ip: "hostname -I 2>/dev/null | awk '{print $1}'",
      cpu: `LC_ALL=C top -bn1 2>/dev/null | grep -E 'Cpu\\(s\\)' | sed 's/,/ /g' | awk '{for(i=1;i<=NF;i++) if($i=="id") idle=$(i-1)} END {if(idle!="") printf("%.1f", 100-idle); else print "0"}'`,
      ram: `free 2>/dev/null | awk '/Mem:/ { if ($2>0) printf("%.1f", ($3/$2)*100); else print "0" }'`,
      disk: "df -P / 2>/dev/null | awk 'NR==2{gsub(/%/,\"\",$5); print $5}'",
      topCpu: 'ps aux --sort=-%cpu | head -10',
      topMem: 'ps aux --sort=-%mem | head -10',
      // Enterprise Metrics
      psi_memory: 'cat /proc/pressure/memory 2>/dev/null',
      iostat: 'iostat -x 1 1 2>/dev/null',
      net_dev: 'cat /proc/net/dev 2>/dev/null',
      file_nr: 'cat /proc/sys/fs/file-nr 2>/dev/null',
      failed_services: 'systemctl --failed --no-legend 2>/dev/null',
      docker_ps: 'docker ps --format "{{.Names}} {{.Status}}" 2>/dev/null',
      docker_stats: 'docker stats --no-stream --format "table {{.Names}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}" 2>/dev/null',
      tcp_conns: 'netstat -ant | grep ESTABLISHED | wc -l 2>/dev/null',
      inodes: 'df -i / | awk "NR==2{print \$5}" 2>/dev/null',
    };

    const entries = Object.entries(commandMap);
    const values = await Promise.all(
      entries.map(async ([key, cmd]) => {
        const result = await connection.exec(serverId, cmd);
        return [key, (result.stdout || '').trim()];
      })
    );

    const results = Object.fromEntries(values);
    sshStatsCache.set(serverId, { ts: Date.now(), data: results });
    return res.json({ success: true, data: results, cached: false });
  } catch (error) {
    const errMsg = String(error.message || error);
    
    // If connection is stale, return 409 to trigger reconnection
    if (errMsg.includes('stale') || errMsg.includes('Channel open failure')) {
      return res.status(409).json({ error: 'Connection lost. Please reconnect.' });
    }
    
    return res.status(500).json({ error: errMsg });
  }
});

app.post('/ssh/services', requireUser, async (req, res) => {
  try {
    const { serverId } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    const services = [
      { name: 'nginx', cmd: 'systemctl is-active nginx' },
      { name: 'apache2', cmd: 'systemctl is-active apache2' },
      { name: 'mysql', cmd: 'systemctl is-active mysql' },
      { name: 'postgresql', cmd: 'systemctl is-active postgresql' },
      { name: 'docker', cmd: 'systemctl is-active docker' },
      { name: 'redis', cmd: 'systemctl is-active redis-server' },
      { name: 'ssh', cmd: 'systemctl is-active ssh' },
    ];

    const results = [];
    for (const service of services) {
      try {
        const result = await connection.exec(serverId, service.cmd);
        results.push({
          name: service.name,
          status: result.stdout.trim() || 'inactive',
          enabled: result.stdout.trim() === 'active',
        });
      } catch {
        results.push({
          name: service.name,
          status: 'unknown',
          enabled: false,
        });
      }
    }

    return res.json({ success: true, services: results });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/files', requireUser, async (req, res) => {
  try {
    const { serverId, folderPath = '.' } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    const cmd = `ls -la "${folderPath}" | grep -v "^total"`;
    const result = await connection.exec(serverId, cmd);

    if (result.code !== 0) {
      throw new Error(result.stderr);
    }

    const files = result.stdout
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        const permissions = parts[0];
        const owner = parts[2];
        const group = parts[3];
        const size = parts[4];
        const date = parts[5] + ' ' + parts[6] + ' ' + (parts[7] || '');
        const name = parts.slice(8).join(' ');

        return {
          name,
          permissions,
          owner,
          group,
          size: parseInt(size, 10),
          date,
          isDirectory: permissions.startsWith('d'),
          isFile: !permissions.startsWith('d') && !permissions.startsWith('l'),
          isLink: permissions.startsWith('l'),
        };
      });

    return res.json({ success: true, files });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/ssh/files', requireUser, async (req, res) => {
  try {
    const serverId = req.query.serverId;
    const filePath = req.query.path;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    const content = await connection.readFile(serverId, filePath);

    return res.json({ success: true, content });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.put('/ssh/files', requireUser, async (req, res) => {
  try {
    const { serverId, path, content } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    await connection.writeFile(serverId, path, content);

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/upload', requireUser, async (req, res) => {
  try {
    const { serverId, remotePath, base64 } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    if (!remotePath || typeof remotePath !== 'string') {
      return res.status(400).json({ error: 'remotePath is required' });
    }

    if (!base64 || typeof base64 !== 'string') {
      return res.status(400).json({ error: 'base64 is required' });
    }

    await connection.uploadFile(serverId, remotePath, base64);

    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/users', requireUser, async (req, res) => {
  try {
    const { serverId, action, ...data } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    let result;

    switch (action) {
      case 'list': {
        const usersResult = await connection.exec(
          serverId,
          "cat /etc/passwd | grep -E '^[^:]*:[^:]*:[0-9]{4,}:'"
        );
        const groupsResult = await connection.exec(serverId, 'cat /etc/group');

        const users = usersResult.stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const parts = line.split(':');
            return {
              username: parts[0],
              uid: parseInt(parts[2], 10),
              gid: parseInt(parts[3], 10),
              home: parts[5],
              shell: parts[6],
            };
          });

        const groups = groupsResult.stdout
          .split('\n')
          .filter((line) => line.trim())
          .map((line) => {
            const parts = line.split(':');
            return {
              name: parts[0],
              gid: parseInt(parts[2], 10),
              members: parts[3] ? parts[3].split(',') : [],
            };
          });

        result = { users, groups };
        break;
      }

      case 'create': {
        const { username, password, groups } = data;
        await connection.exec(serverId, `sudo useradd -m -s /bin/bash "${username}"`);
        await connection.exec(serverId, `echo "${username}:${password}" | sudo chpasswd`);

        if (groups && groups.length > 0) {
          for (const group of groups) {
            await connection.exec(serverId, `sudo usermod -aG "${group}" "${username}"`);
          }
        }

        result = { success: true, message: `User ${username} created successfully` };
        break;
      }

      case 'delete': {
        const { username: deleteUsername } = data;
        await connection.exec(serverId, `sudo deluser --remove-home "${deleteUsername}"`);
        result = { success: true, message: `User ${deleteUsername} deleted successfully` };
        break;
      }

      case 'update-password': {
        const { username: updateUsername, password: newPassword } = data;
        await connection.exec(serverId, `echo "${updateUsername}:${newPassword}" | sudo chpasswd`);
        result = { success: true, message: `Password updated for ${updateUsername}` };
        break;
      }

      case 'create-group': {
        const { name } = data;
        await connection.exec(serverId, `sudo groupadd "${name}"`);
        result = { success: true, message: `Group ${name} created successfully` };
        break;
      }

      case 'delete-group': {
        const { name: deleteGroupName } = data;
        await connection.exec(serverId, `sudo delgroup "${deleteGroupName}"`);
        result = { success: true, message: `Group ${deleteGroupName} deleted successfully` };
        break;
      }

      case 'add-to-group': {
        const { username: addUser, group } = data;
        await connection.exec(serverId, `sudo usermod -aG "${group}" "${addUser}"`);
        result = { success: true, message: `User ${addUser} added to group ${group}` };
        break;
      }

      default:
        throw new Error('Invalid action');
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/system', requireUser, async (req, res) => {
  try {
    const { serverId, action, ...data } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    let result;

    switch (action) {
      case 'disks': {
        const disksResult = await connection.exec(serverId, 'lsblk -J -o NAME,SIZE,FSTYPE,MOUNTPOINT,TYPE');
        result = { disks: JSON.parse(disksResult.stdout) };
        break;
      }

      case 'mount': {
        const { device, mountPoint, format } = data;
        await connection.exec(serverId, `sudo mkdir -p ${mountPoint}`);
        if (format) {
          await connection.exec(serverId, `sudo mkfs.${format} ${device}`);
        }
        await connection.exec(serverId, `sudo mount ${device} ${mountPoint}`);
        const fstabEntry = `${device} ${mountPoint} auto defaults 0 0`;
        await connection.exec(serverId, `echo "${fstabEntry}" | sudo tee -a /etc/fstab`);
        result = { success: true, message: `Device ${device} mounted to ${mountPoint}` };
        break;
      }

      case 'install-package': {
        const { package: pkg } = data;
        // Use inline retry script to handle apt lock contention
        const installScript = [
          'sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true',
          'sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true',
          'sudo systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true',
          'for i in 1 2 3 4 5 6 7 8 9 10; do',
          '  if sudo DEBIAN_FRONTEND=noninteractive apt-get update -y && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ' + pkg + '; then',
          '    exit 0',
          '  fi',
          '  if echo "$?" | grep -q "100\\|1"; then',
          '    sudo pkill -9 apt 2>/dev/null || true',
          '    sudo pkill -9 apt-get 2>/dev/null || true',
          '    sudo pkill -9 dpkg 2>/dev/null || true',
          '    sudo rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend',
          '    sudo dpkg --configure -a 2>/dev/null || true',
          '    sleep $((i * 3))',
          '  fi',
          'done',
          'exit 1',
        ].join('\n');
        await connection.exec(serverId, `bash -c '${installScript.replace(/'/g, "'\\''")}' `);
        result = { success: true, message: `Package ${pkg} installed successfully` };
        break;
      }

      case 'remove-package': {
        const { package: removePkg } = data;
        // Use inline retry script to handle apt lock contention
        const removeScript = [
          'for i in 1 2 3 4 5 6 7 8 9 10; do',
          '  if sudo DEBIAN_FRONTEND=noninteractive apt-get remove -y ' + removePkg + '; then',
          '    exit 0',
          '  fi',
          '  sudo pkill -9 apt 2>/dev/null || true',
          '  sudo pkill -9 apt-get 2>/dev/null || true',
          '  sudo rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend',
          '  sudo dpkg --configure -a 2>/dev/null || true',
          '  sleep $((i * 3))',
          'done',
          'exit 1',
        ].join('\n');
        await connection.exec(serverId, `bash -c '${removeScript.replace(/'/g, "'\\''")}' `);
        result = { success: true, message: `Package ${removePkg} removed successfully` };
        break;
      }

      case 'check-installed': {
        const { packages } = data;
        const results = {};
        for (const pkg of packages) {
          try {
            const checkResult = await connection.exec(serverId, `dpkg -l | grep "^ii  ${pkg} "`);
            results[pkg] = checkResult.stdout.trim() !== '';
          } catch {
            results[pkg] = false;
          }
        }
        result = { installed: results };
        break;
      }

      case 'security': {
        const securityCommands = [
          'ufw status',
          'fail2ban-client status',
          'last -n 10',
          'sudo cat /var/log/auth.log | grep "Failed password" | tail -10',
        ];

        const securityResults = {};
        for (const cmd of securityCommands) {
          try {
            const cmdResult = await connection.exec(serverId, cmd);
            const key = cmd.split(' ')[0];
            securityResults[key] = cmdResult.stdout.trim();
          } catch {
            securityResults[cmd.split(' ')[0]] = 'Error retrieving data';
          }
        }

        result = { security: securityResults };
        break;
      }

      default:
        throw new Error('Invalid action');
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/ssh/deploy', requireUser, async (req, res) => {
  try {
    const { serverId, action, ...data } = req.body;

    if (!validateServerIdOwnership(req, res, serverId)) return;

    const connection = getConnection(serverId);
    if (!connection.isConnected(serverId)) {
      return res.status(409).json({ error: 'Not connected' });
    }

    let result;

    const execOrThrow = async (cmd) => {
      const r = await connection.exec(serverId, cmd);
      if (typeof r?.code === 'number' && r.code !== 0) {
        throw new Error(r.stderr || r.stdout || `Command failed: ${cmd}`);
      }
      return r;
    };

    const execNoThrow = async (cmd) => {
      try {
        return await connection.exec(serverId, cmd);
      } catch {
        return { stdout: '', stderr: '', code: 1 };
      }
    };

    const readRegistry = async () => {
      const readRes = await execNoThrow('mkdir -p ~/.devyntra && touch ~/.devyntra/apps.json && cat ~/.devyntra/apps.json');
      const raw = String(readRes.stdout || '').trim();
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };

    const writeRegistry = async (apps) => {
      const jsonStr = JSON.stringify(apps || [], null, 2);
      const escaped = jsonStr.replace(/'/g, "'\"'\"'");
      await execOrThrow(`echo '${escaped}' > ~/.devyntra/apps.json`);
    };

    const upsertRegistry = async (appInfo) => {
      const apps = await readRegistry();
      const idx = apps.findIndex((a) => a && a.id === appInfo.id);
      if (idx >= 0) apps[idx] = { ...apps[idx], ...appInfo };
      else apps.push(appInfo);
      await writeRegistry(apps);
    };

    const removeFromRegistry = async (appId) => {
      const apps = await readRegistry();
      const filtered = apps.filter((a) => a && a.id !== appId);
      await writeRegistry(filtered);
    };

    const getRemoteUser = async () => {
      const who = await execOrThrow('whoami');
      return String(who.stdout || '').trim() || 'root';
    };

    const bestEffortEnableLinger = async (user) => {
      await execNoThrow(`sudo loginctl enable-linger ${user}`);
    };

    const detectHostIp = async () => {
      const ipRes = await execNoThrow("hostname -I 2>/dev/null | awk '{print $1}'");
      return String(ipRes.stdout || '').trim();
    };

    // --- APT LOCK RETRY LOGIC (permanent fix for "Could not get lock" errors) ---
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const isAptLockError = (r) => {
      const msg = String((r && (r.stderr || r.stdout)) || '').toLowerCase();
      return (
        msg.includes('could not get lock') ||
        msg.includes('unable to acquire') ||
        msg.includes('unable to lock directory') ||
        msg.includes('resource temporarily unavailable') ||
        msg.includes('dpkg frontend lock') ||
        msg.includes('apt/lists/lock') ||
        msg.includes('is held by process') ||
        msg.includes('waiting for cache lock')
      );
    };

    // Disable unattended-upgrades & apt-daily timers (the real root cause)
    const disableAptTimers = async () => {
      await execNoThrow(
        'sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true; ' +
        'sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true; ' +
        'sudo systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true'
      );
    };

    // Kill blocking processes and remove stale lock files
    const bustAptLocks = async () => {
      await execNoThrow(
        'sudo pkill -9 -f unattended-upgrade 2>/dev/null || true; ' +
        'sudo pkill -9 apt 2>/dev/null || true; ' +
        'sudo pkill -9 apt-get 2>/dev/null || true; ' +
        'sudo pkill -9 dpkg 2>/dev/null || true; ' +
        'sudo fuser -k /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/cache/apt/archives/lock 2>/dev/null || true; ' +
        'sudo rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend; ' +
        'sudo DEBIAN_FRONTEND=noninteractive dpkg --configure -a 2>/dev/null || true'
      );
    };

    let _aptTimersDisabled = false;

    const execAptWithRetry = async (cmd, { attempts = 15, baseDelayMs = 3000 } = {}) => {
      // Disable background apt services once per deployment
      if (!_aptTimersDisabled) {
        await disableAptTimers();
        _aptTimersDisabled = true;
      }

      let last = null;
      for (let i = 0; i < attempts; i++) {
        // On retries, forcefully bust locks first
        if (i > 0) {
          await bustAptLocks();
          await sleep(1000); // brief pause after lock busting
        }

        try {
          const r = await connection.exec(serverId, `DEBIAN_FRONTEND=noninteractive ${cmd}`);
          last = r;
          if (r && r.code === 0) return r;
          if (!isAptLockError(r)) {
            // Non-lock error, throw immediately
            if (typeof r?.code === 'number' && r.code !== 0) {
              throw new Error(r.stderr || r.stdout || `Command failed: ${cmd}`);
            }
            return r;
          }
        } catch (e) {
          last = { code: -1, stderr: e.message, stdout: '' };
          if (!isAptLockError(last)) throw e;
        }

        // Wait with increasing delay
        const waitMs = baseDelayMs + (i * 2000);
        console.log(`[apt-retry] Attempt ${i + 1}/${attempts} for "${cmd}" - lock held, retrying in ${Math.round(waitMs / 1000)}s...`);
        await sleep(waitMs);
      }

      // All retries exhausted
      throw new Error(
        `apt lock could not be cleared after ${attempts} attempts. ` +
        `Last error: ${last?.stderr || last?.stdout || 'unknown'}`
      );
    };
    // --- END APT LOCK RETRY LOGIC ---

    const ensureAptUpdated = async () => {
      await execAptWithRetry('sudo apt-get update -y');
    };

    const ensurePackageInstalled = async (pkg) => {
      const check = await execNoThrow(`dpkg -s ${pkg} >/dev/null 2>&1; echo $?`);
      if (String(check.stdout || '').trim() === '0') return;
      await ensureAptUpdated();
      await execAptWithRetry(`sudo apt-get install -y ${pkg}`);
    };

    const writeSudoFile = async (targetPath, content) => {
      const tmpPath = `/tmp/devyntra_${Date.now()}_${Math.random().toString(16).slice(2)}.tmp`;
      await connection.writeFile(serverId, tmpPath, String(content ?? ''));
      await execOrThrow(`sudo mv "${tmpPath}" "${targetPath}"`);
    };

    const resolveFullPath = async (appDir) => {
      const pwd = await execOrThrow(`cd ${appDir} && pwd`);
      return String(pwd.stdout || '').trim();
    };

    const detectProjectAndStartCmd = async (fullPath, fallbackStartCommand) => {
      const checkPackage = await execNoThrow(`ls "${fullPath}/package.json" 2>/dev/null`);
      if (checkPackage.code === 0) {
        return { language: 'nodejs', startCmd: fallbackStartCommand || 'npm start' };
      }

      const checkReq = await execNoThrow(`ls "${fullPath}/requirements.txt" 2>/dev/null`);
      if (checkReq.code === 0) {
        return { language: 'python', startCmd: fallbackStartCommand || 'python3 app.py' };
      }

      const checkHtml = await execNoThrow(`ls "${fullPath}/index.html" 2>/dev/null`);
      if (checkHtml.code === 0) {
        return { language: 'static', startCmd: fallbackStartCommand || 'python3 -m http.server $PORT' };
      }

      return { language: 'unknown', startCmd: fallbackStartCommand || '' };
    };

    const setupPm2 = async ({ name, fullPath, port, startCmd, enablePm2Startup }) => {
      await bestEffortEnableLinger(await getRemoteUser());

      const npmCheck = await execNoThrow('command -v npm >/dev/null 2>&1; echo $?');
      if (String(npmCheck.stdout || '').trim() !== '0') {
        throw new Error('npm not found on server. Install Node.js/npm first or choose systemd manager.');
      }

      await ensureAptUpdated();

      const pm2Check = await execNoThrow('pm2 -v');
      if (pm2Check.code !== 0) {
        await execOrThrow('sudo npm install -g pm2');
      }

      await execNoThrow(`pm2 delete "${name}"`);

      let pm2Cmd = '';
      if (startCmd === 'npm start') {
        pm2Cmd = `cd "${fullPath}" && PORT=${port} pm2 start npm --name "${name}" --time -- start`;
      } else {
        pm2Cmd = `cd "${fullPath}" && PORT=${port} pm2 start "${startCmd}" --name "${name}" --time`;
      }

      await execOrThrow(pm2Cmd);

      if (enablePm2Startup) {
        const who = await getRemoteUser();
        const startupRes = await execNoThrow(`pm2 startup systemd -u ${who} --hp /home/${who}`);
        const lines = String(startupRes.stdout || '').split('\n');
        const startupCmd = lines.find((line) => line.trim().startsWith('sudo') && line.includes('pm2 startup'));
        if (startupCmd) {
          await execOrThrow(startupCmd.trim());
        }
      }

      await execOrThrow('pm2 save');
    };

    const setupSystemd = async ({ name, fullPath, port, startCmd }) => {
      const user = await getRemoteUser();

      const wrapperScript = `#!/bin/bash\n\nexport HOME=/home/${user}\nexport PORT=${port}\nexport NODE_ENV=production\n\n[ -s \"$HOME/.nvm/nvm.sh\" ] && . \"$HOME/.nvm/nvm.sh\"\n[ -s \"$HOME/.profile\" ] && . \"$HOME/.profile\"\n[ -s \"$HOME/.bashrc\" ] && . \"$HOME/.bashrc\"\n\nexport PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin\n\ncd ${fullPath}\necho \"Starting app in $(pwd) with command: ${startCmd}\"\n${startCmd}\n`;

      const scriptPath = `${fullPath}/start_service.sh`;
      await connection.writeFile(serverId, scriptPath, wrapperScript);
      await execOrThrow(`chmod +x \"${scriptPath}\"`);

      const serviceContent = `[Unit]\nDescription=Devyntra App - ${name}\nAfter=network.target\n\n[Service]\nType=simple\nUser=${user}\nWorkingDirectory=${fullPath}\nExecStart=${scriptPath}\nRestart=always\nEnvironment=NODE_ENV=production\nEnvironment=PORT=${port}\nStandardOutput=journal\nStandardError=journal\nSyslogIdentifier=${name}\n\n[Install]\nWantedBy=multi-user.target\n`;

      await writeSudoFile(`/etc/systemd/system/${name}.service`, serviceContent);
      await execOrThrow('sudo systemctl daemon-reload');
      await execOrThrow(`sudo systemctl enable \"${name}\"`);
      await execOrThrow(`sudo systemctl start \"${name}\"`);
    };

    const setupNginx = async ({ name, port, domain }) => {
      await ensurePackageInstalled('nginx');

      const serverName = domain && String(domain).trim() ? String(domain).trim() : '_';
      const nginxConfig = `server {\n    listen 80;\n    server_name ${serverName};\n    location / {\n        proxy_pass http://127.0.0.1:${port};\n        proxy_http_version 1.1;\n        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection 'upgrade';\n        proxy_set_header Host $host;\n        proxy_cache_bypass $http_upgrade;\n    }\n}`;

      await writeSudoFile(`/etc/nginx/sites-available/${name}`, nginxConfig);
      await execOrThrow(`sudo ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/${name}`);
      await execNoThrow('sudo nginx -t');
      await execOrThrow('sudo systemctl restart nginx');
    };

    const setupCaddy = async ({ port }) => {
      await ensurePackageInstalled('caddy');
      const caddyConfig = `:80 {\n    reverse_proxy 127.0.0.1:${port}\n}\n`;
      await execOrThrow(`echo '${caddyConfig.replace(/'/g, "'\"'\"'")}' | sudo tee -a /etc/caddy/Caddyfile >/dev/null`);
      await execOrThrow('sudo systemctl reload caddy');
    };

    const openFirewall = async (port) => {
      await execNoThrow(`sudo ufw allow ${port}`);
    };

    switch (action) {
      case 'deploy': {
        const {
          name,
          sourceType,
          repoUrl,
          repo,
          branch,
          serverPath,
          installDeps,
          runUpdate,
          manager,
          webserver,
          startCommand,
          buildCommand,
          envVars,
          port,
          enableFirewall,
          enablePm2Startup,
          domain,
        } = data;

        const appName = String(name || '').trim();
        if (!appName) throw new Error('name is required');

        const resolvedRepo = String(repoUrl || repo || '').trim();
        const resolvedBranch = String(branch || 'main').trim() || 'main';
        const resolvedManager = String(manager || 'systemd').trim();
        const resolvedWeb = String(webserver || 'none').trim();
        const resolvedPort = String(port || '').trim() || '3000';

        if (runUpdate) {
          await ensureAptUpdated();
        }

        let appDir = serverPath;
        const resolvedSource = String(sourceType || '').trim() || (resolvedRepo ? 'github' : 'path');

        if (resolvedSource === 'github') {
          if (!resolvedRepo) throw new Error('repoUrl is required for github source');
          await execOrThrow('mkdir -p ~/apps');
          appDir = `~/apps/${appName}`;
          const exists = await execNoThrow(`ls -d ${appDir} 2>/dev/null`);
          if (exists.code === 0) {
            await execOrThrow(`cd ${appDir} && git pull origin ${resolvedBranch}`);
          } else {
            await execOrThrow(`git clone -b ${resolvedBranch} ${resolvedRepo} ${appDir}`);
          }
        }

        if (!appDir) {
          throw new Error('serverPath is required when source is not github');
        }

        const fullPath = await resolveFullPath(appDir);

        if (envVars && typeof envVars === 'object' && Object.keys(envVars).length > 0) {
          const envContent = Object.entries(envVars)
            .map(([k, v]) => `${k}="${String(v ?? '').replace(/"/g, '\\"')}"`)
            .join('\n');
          await connection.writeFile(serverId, `${fullPath}/.env`, envContent);
        }

        if (buildCommand) {
          await execOrThrow(`cd "${fullPath}" && ${buildCommand}`);
        } else if (installDeps) {
          const checkPackage = await execNoThrow(`ls "${fullPath}/package.json" 2>/dev/null`);
          const checkReq = await execNoThrow(`ls "${fullPath}/requirements.txt" 2>/dev/null`);
          if (checkPackage.code === 0) {
            await execOrThrow(`cd "${fullPath}" && npm install`);
          } else if (checkReq.code === 0) {
            await execOrThrow(`cd "${fullPath}" && pip3 install -r requirements.txt`);
          }
        }

        const detected = await detectProjectAndStartCmd(fullPath, startCommand);
        const resolvedStart = detected.startCmd;
        if (!resolvedStart) throw new Error('startCommand is required (could not detect a default)');

        if (enableFirewall !== false) {
          await openFirewall(resolvedPort);
        }

        if (resolvedManager === 'pm2') {
          await setupPm2({ name: appName, fullPath, port: resolvedPort, startCmd: resolvedStart, enablePm2Startup: !!enablePm2Startup });
        } else if (resolvedManager === 'systemd') {
          await setupSystemd({ name: appName, fullPath, port: resolvedPort, startCmd: resolvedStart });
        } else if (resolvedManager === 'docker') {
          await ensurePackageInstalled('docker.io');
          await execOrThrow(`cd "${fullPath}" && sudo docker build -t ${appName} .`);
          await execNoThrow(`sudo docker rm -f ${appName}`);
          await execOrThrow(`sudo docker run -d -p ${resolvedPort}:${resolvedPort} --name ${appName} --restart unless-stopped ${appName}`);
        }

        if (resolvedWeb === 'nginx') {
          await setupNginx({ name: appName, port: resolvedPort, domain });
          if (enableFirewall !== false) {
            await openFirewall(80);
          }
        } else if (resolvedWeb === 'caddy') {
          await setupCaddy({ port: resolvedPort });
          if (enableFirewall !== false) {
            await openFirewall(80);
          }
        }

        const ip = await detectHostIp();
        const appInfo = {
          id: appName,
          name: appName,
          repo: resolvedRepo || undefined,
          branch: resolvedBranch,
          domain: domain || undefined,
          status: 'running',
          deployedAt: new Date().toISOString(),
          language: detected.language,
          path: fullPath,
          port: resolvedPort,
          manager: resolvedManager,
          webserver: resolvedWeb,
          autostart: resolvedManager === 'systemd' ? true : undefined,
          hostIp: ip || undefined,
        };

        await upsertRegistry(appInfo);

        result = { success: true, message: `App ${appName} deployed successfully`, app: appInfo };
        break;
      }

      case 'list': {
        const apps = await readRegistry();

        for (const app of apps) {
          if (!app || !app.id) continue;
          const id = app.id;

          if (app.manager === 'systemd') {
            const sRes = await execNoThrow(`systemctl is-active "${id}" 2>/dev/null`);
            app.status = String(sRes.stdout || '').trim() === 'active' ? 'running' : 'stopped';
            const eRes = await execNoThrow(`systemctl is-enabled "${id}" 2>/dev/null`);
            app.autostart = String(eRes.stdout || '').trim() === 'enabled';
          } else if (app.manager === 'pm2') {
            const pRes = await execNoThrow('pm2 jlist');
            if (pRes.code === 0) {
              try {
                const list = JSON.parse(String(pRes.stdout || '[]'));
                const pApp = list.find((p) => p && p.name === id);
                app.status = (pApp && pApp.pm2_env && pApp.pm2_env.status === 'online') ? 'running' : 'stopped';
              } catch {
                app.status = 'unknown';
              }
            } else {
              app.status = 'unknown';
            }

            try {
              const who = await getRemoteUser();
              const svcRes = await execNoThrow(`ls /etc/systemd/system/pm2-${who}.service 2>/dev/null`);
              app.autostart = svcRes.code === 0;
            } catch {
              app.autostart = false;
            }
          } else if (app.manager === 'docker') {
            const dRes = await execNoThrow(`sudo docker inspect -f '{{.State.Running}}' ${id} 2>/dev/null`);
            app.status = String(dRes.stdout || '').trim() === 'true' ? 'running' : 'stopped';
          }
        }

        await writeRegistry(apps);
        result = { apps };
        break;
      }

      case 'manage':
      case 'start':
      case 'stop':
      case 'restart':
      case 'delete': {
        const { id, manageAction: providedManageAction, action: legacyManageAction } = data;
        const manageAction = providedManageAction || legacyManageAction || action;

        const apps = await readRegistry();
        const app = apps.find((a) => a && a.id === id);
        if (!app) throw new Error('App not found in registry');

        if (app.manager === 'systemd') {
          if (manageAction === 'start') await execOrThrow(`sudo systemctl start "${id}"`);
          else if (manageAction === 'stop') await execOrThrow(`sudo systemctl stop "${id}"`);
          else if (manageAction === 'restart') await execOrThrow(`sudo systemctl restart "${id}"`);
          else if (manageAction === 'enable-boot') await execOrThrow(`sudo systemctl enable "${id}"`);
          else if (manageAction === 'disable-boot') await execOrThrow(`sudo systemctl disable "${id}"`);
          else if (manageAction === 'delete') {
            await execNoThrow(`sudo systemctl stop "${id}"`);
            await execNoThrow(`sudo systemctl disable "${id}"`);
            await execNoThrow(`sudo rm "/etc/systemd/system/${id}.service"`);
            await execOrThrow('sudo systemctl daemon-reload');
          } else {
            throw new Error('Invalid manage action');
          }
        } else if (app.manager === 'pm2') {
          const pm2Avail = await execNoThrow('command -v pm2 >/dev/null 2>&1; echo $?');
          if (String(pm2Avail.stdout || '').trim() !== '0') {
            throw new Error(
              'This application is configured to use PM2, but PM2 is not installed on the server. ' +
              'Install PM2 (e.g. `sudo npm i -g pm2`) or redeploy the app choosing the `systemd` manager.'
            );
          }

          if (manageAction === 'start') await execOrThrow(`pm2 start "${id}"`);
          else if (manageAction === 'stop') await execOrThrow(`pm2 stop "${id}"`);
          else if (manageAction === 'restart') await execOrThrow(`pm2 restart "${id}"`);
          else if (manageAction === 'enable-boot') {
            const who = await getRemoteUser();
            const pRes = await execNoThrow(`pm2 startup systemd -u ${who} --hp /home/${who}`);
            const lines = String(pRes.stdout || '').split('\n');
            const cmd = lines.find((l) => l.trim().startsWith('sudo'));
            if (cmd) await execOrThrow(cmd.trim());
            await execOrThrow('pm2 save');
          } else if (manageAction === 'disable-boot') {
            await execNoThrow('pm2 unstartup systemd');
          } else if (manageAction === 'delete') {
            await execNoThrow(`pm2 stop "${id}"`);
            await execOrThrow(`pm2 delete "${id}"`);
            await execOrThrow('pm2 save');
          } else {
            throw new Error('Invalid manage action');
          }
        } else if (app.manager === 'docker') {
          if (manageAction === 'start') await execOrThrow(`sudo docker start ${id}`);
          else if (manageAction === 'stop') await execOrThrow(`sudo docker stop ${id}`);
          else if (manageAction === 'restart') await execOrThrow(`sudo docker restart ${id}`);
          else if (manageAction === 'delete') await execOrThrow(`sudo docker rm -f ${id}`);
          else {
            throw new Error('Invalid manage action');
          }
        }

        if (manageAction === 'delete') {
          if (app.webserver === 'nginx') {
            await execNoThrow(`sudo rm -f /etc/nginx/sites-enabled/${id}`);
            await execNoThrow(`sudo rm -f /etc/nginx/sites-available/${id}`);
            await execNoThrow('sudo systemctl restart nginx');
          }
          await removeFromRegistry(id);
        } else {
          await upsertRegistry(app);
        }

        result = { success: true, message: `App ${id} updated` };

        break;
      }

      default:
        throw new Error('Invalid action');
    }

    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/agent/enroll', requireUser, async (req, res) => {
  try {
    const record = agentConnection.createEnrollToken(req.user.id);
    const serverId = `${req.user.id}_agent_${record.agentId}`;
    const origin = getBackendOrigin(req);
    const installUrl = `${origin}/agent/install.sh`;
    const token = record.token;
    const code = record.code;
    const installUrlWithCode = `${installUrl}?code=${encodeURIComponent(code)}`;
    const backendUrl = origin;
    const installCommand = `u="${installUrlWithCode}";curl -fsSL "$u"|sudo bash||wget -qO- "$u"|sudo bash`;
    return res.json({
      agentId: record.agentId,
      token: record.token,
      code,
      serverId,
      expiresAt: record.expiresAt,
      installUrl,
      installCommand,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/agent/token', async (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    const format = String(req.query.format || '').trim().toLowerCase();
    if (!code) return res.status(400).json({ error: 'code is required' });
    const record = agentConnection.consumeEnrollCode(code);
    if (!record) return res.status(404).json({ error: 'Invalid or expired code' });
    if (format === 'plain') {
      res.setHeader('Content-Type', 'text/plain');
      res.setHeader('Cache-Control', 'no-store');
      return res.send(String(record.token));
    }
    return res.json({
      success: true,
      token: record.token,
      agentId: record.agentId,
      userId: record.userId,
      expiresAt: record.expiresAt,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/agent/connect', requireUser, async (req, res) => {
  try {
    const { agentId, serverId } = req.body || {};
    const resolvedAgentId = agentId || (serverId && String(serverId).split('_agent_')[1]);

    console.log('[agent/connect] Request:', { agentId, serverId, resolvedAgentId, userId: req.user.id });

    if (!resolvedAgentId) {
      console.log('[agent/connect] Error: agentId is required');
      return res.status(400).json({ error: 'agentId is required' });
    }

    const derivedServerId = serverId || `${req.user.id}_agent_${resolvedAgentId}`;
    if (!validateServerIdOwnership(req, res, derivedServerId)) return;

    // Check if agent is online first
    const session = agentConnection.getSession(resolvedAgentId);
    if (!session) {
      console.log(`[agent/connect] Error: Agent ${resolvedAgentId} is offline (no session found)`);
      return res.status(400).json({ error: 'Agent is offline. Please ensure the agent is running on your server.' });
    }

    if (session.userId !== req.user.id) {
      console.log(`[agent/connect] Error: Agent ${resolvedAgentId} belongs to different user`);
      return res.status(403).json({ error: 'Not authorized to connect to this agent' });
    }

    const ok = agentConnection.bindServer(derivedServerId, resolvedAgentId, req.user.id);
    if (!ok) {
      console.log(`[agent/connect] Error: bindServer failed for agent ${resolvedAgentId}`);
      return res.status(400).json({ error: 'Failed to bind agent. Please try again.' });
    }

    console.log(`[agent/connect] Success: Connected to agent ${resolvedAgentId} with serverId ${derivedServerId}`);
    return res.json({ success: true, serverId: derivedServerId });
  } catch (error) {
    console.error('[agent/connect] Exception:', error);
    return res.status(500).json({ error: error.message });
  }
});

app.get('/agent/status', requireUser, async (req, res) => {
  try {
    const agentId = req.query.agentId;
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });
    const session = agentConnection.getSession(agentId);
    const online = !!session && session.userId === req.user.id;
    return res.json({ success: true, online });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post('/agent/uninstall', requireUser, async (req, res) => {
  try {
    const { agentId } = req.body || {};
    if (!agentId) return res.status(400).json({ error: 'agentId is required' });

    const session = agentConnection.getSession(agentId);
    if (!session || session.userId !== req.user.id) {
      return res.status(400).json({ error: 'Agent offline or not authorized' });
    }

    const uninstallCmd = `if command -v systemctl >/dev/null 2>&1; then sudo systemctl stop devyntra-agent || true; sudo systemctl disable devyntra-agent || true; sudo rm -f /etc/systemd/system/devyntra-agent.service || true; sudo systemctl daemon-reload || true; fi; sudo pkill -f devyntra-agent || true; sudo rm -rf /opt/devyntra-agent || true; sudo rm -f /var/log/devyntra-agent.log || true`;
    await agentConnection.execAgent(agentId, uninstallCmd);
    return res.json({ success: true });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get('/agent/agent.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`const os = require('os');
const { exec } = require('child_process');
let WebSocketImpl = null;
try {
  WebSocketImpl = require('ws');
} catch (e) {
  WebSocketImpl = globalThis.WebSocket;
}

if (!WebSocketImpl) {
  console.error('Missing WebSocket implementation. Please install "ws" in the agent directory.');
  process.exit(1);
}

const args = process.argv.slice(2);
const getArg = (key) => {
  const idx = args.indexOf(key);
  if (idx === -1) return null;
  return args[idx + 1] || null;
};

const token = getArg('--token') || process.env.DEVYNTRA_AGENT_TOKEN;
const backend = getArg('--backend') || process.env.DEVYNTRA_BACKEND_URL;

if (!token || !backend) {
  console.error('Missing --token or --backend');
  process.exit(1);
}

console.log('[devyntra-agent] starting', { backend, hostname: os.hostname() });

const wsUrl = backend.replace('https://', 'wss://').replace('http://', 'ws://') + '/agent/connect?token=' + encodeURIComponent(token);

let ws = null;
let reconnectDelay = 2000;

function connect() {
  ws = new WebSocketImpl(wsUrl);

  const on = (event, handler) => {
    if (ws && typeof ws.on === 'function') {
      ws.on(event, handler);
      return;
    }
    if (ws && typeof ws.addEventListener === 'function') {
      ws.addEventListener(event, (e) => {
        if (event === 'message') return handler(e.data);
        if (event === 'close') return handler(e.code, e.reason);
        return handler(e);
      });
    }
  };

  on('open', () => {
    reconnectDelay = 2000;
    const hello = {
      type: 'hello',
      hostname: os.hostname(),
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
    };
    console.log('[devyntra-agent] connected');
    ws.send(JSON.stringify(hello));
  });

  on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(String(data));
    } catch (e) {
      return;
    }
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }));
      return;
    }
    if (msg.type === 'exec' && msg.id) {
      exec(msg.command, { shell: '/bin/bash', maxBuffer: 5 * 1024 * 1024 }, (err, stdout, stderr) => {
        const payload = {
          type: 'exec_result',
          id: msg.id,
          stdout: stdout || '',
          stderr: (stderr || '') + (err ? String(err.message || err) : ''),
          code: err && typeof err.code === 'number' ? err.code : 0,
        };
        try {
          ws.send(JSON.stringify(payload));
        } catch (e) {}
      });
    }
  });

  on('close', () => {
    console.log('[devyntra-agent] disconnected; reconnecting');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 15000);
  });

  on('error', (err) => {
    console.log('[devyntra-agent] socket error');
  });
}

connect();
`);
});

app.get('/agent/install.sh', async (req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Cache-Control', 'no-store');

  const defaultCode = String(req.query.code || '').trim();

  // Use environment variables directly - no Supabase dependency to avoid timeouts
  const binAmd64 = String(process.env.DEVYNTRA_AGENT_BINARY_URL_LINUX_AMD64 || '').trim();
  const binArm64 = String(process.env.DEVYNTRA_AGENT_BINARY_URL_LINUX_ARM64 || '').trim();

  res.send(`#!/usr/bin/env bash
set -e

# If executed via sh (e.g. curl ... | sh), re-exec into bash.
[ -n "\${BASH_VERSION:-}" ] || exec bash -s -- "$@"

set -euo pipefail

LOG_DIR="/var/log/devyntra-agent"
LOG_FILE="$LOG_DIR/install.log"
mkdir -p "$LOG_DIR"

BIN_URL_AMD64="${binAmd64.replace(/"/g, '\\"')}"
BIN_URL_ARM64="${binArm64.replace(/"/g, '\\"')}"

TTY=0
if : >/dev/tty 2>/dev/null; then
  TTY=1
  exec 3>/dev/tty
elif [ -t 1 ]; then
  TTY=1
  exec 3>&1
elif [ -t 2 ]; then
  TTY=1
  exec 3>&2
else
  TTY=0
  exec 3>&2
fi

ui_line() {
  printf "%s\n" "$*" >&3
}

ui_line "Starting Devyntra Agent installer..."

exec >"$LOG_FILE" 2>&1

cleanup() {
  if [ -n "$CURRENT_SPINNER_PID" ]; then
    kill -TERM "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    wait "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    CURRENT_SPINNER_PID=""
  fi
  if [ "$TTY" -eq 1 ]; then
    printf "\x1b[?25h\n" >&3 || true
  fi
}
trap cleanup EXIT

CURRENT_SPINNER_PID=""
spinner_start() {
  if [ "$TTY" -ne 1 ]; then
    return
  fi

  if [ -n "$CURRENT_SPINNER_PID" ]; then
    kill -TERM "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    wait "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    CURRENT_SPINNER_PID=""
  fi

  (
    printf "\x1b[?25l" >&3 || true
    local i=0
    local frames='|/-\\'
    while true; do
      local c=\${frames:$i:1}
      printf "\r%s" "$c" >&3 || true
      i=$(( (i + 1) % 4 ))
      sleep 0.12
    done
  ) &
  CURRENT_SPINNER_PID=$!
}

spinner_stop() {
  if [ -n "$CURRENT_SPINNER_PID" ]; then
    kill -TERM "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    wait "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    CURRENT_SPINNER_PID=""
  fi
  if [ "$TTY" -eq 1 ]; then
    printf "\r \r\x1b[?25h" >&3 || true
  fi
}

interrupt() {
  if [ -n "$CURRENT_SPINNER_PID" ]; then
    kill -TERM "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    wait "$CURRENT_SPINNER_PID" >/dev/null 2>&1 || true
    CURRENT_SPINNER_PID=""
  fi
  if [ "$TTY" -eq 1 ]; then
    printf "\x1b[?25h\n" >&3 || true
  fi

  ui_line "Interrupted. Log: $LOG_FILE"
  exit 130
}
trap interrupt INT TERM

STEP_TOTAL=9
STEP_DONE=0

run_with_timeout() {
  if command -v timeout >/dev/null 2>&1; then
    timeout 1800 "$@"
  else
    "$@"
  fi
}

render_bar() {
  local done="$1"
  local total="$2"
  local width=22
  local filled=$(( done * width / total ))
  local empty=$(( width - filled ))
  local f e
  f=$(printf '%*s' "$filled" '' | tr ' ' '#')
  e=$(printf '%*s' "$empty" '' | tr ' ' '-')
  printf "%s%s" "$f" "$e"
}

run_step() {
  local msg="$1"; shift
  STEP_DONE=$((STEP_DONE + 1))
  ui_line "[$STEP_DONE/$STEP_TOTAL] $msg"

  spinner_start

  set +e
  run_with_timeout "$@"
  local rc=$?
  set -e

  spinner_stop

  if [ "$rc" -eq 0 ]; then
    ui_line "[OK] $msg"
  else
    ui_line "[FAIL] $msg"
    ui_line "Install failed. Log: $LOG_FILE"
    if [ "$TTY" -eq 1 ]; then
      ui_line "---- Last 60 lines of log ----"
      tail -n 60 "$LOG_FILE" >&3 || true
      ui_line "---- End log ----"
    fi
    exit "$rc"
  fi
}
BACKEND_URL=""
TOKEN=""
CODE="${defaultCode.replace(/"/g, '\\"')}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend)
      BACKEND_URL="$2"; shift 2;;
    --token)
      TOKEN="$2"; shift 2;;
    --code)
      CODE="$2"; shift 2;;
    *) shift;;
  esac
done

if [[ -z "$BACKEND_URL" ]]; then
  BACKEND_URL="https://devyntra-global-20260203.onrender.com"
fi

if [[ -z "$TOKEN" ]]; then
  if [[ -n "$CODE" ]]; then
    TOKEN_TMP=""
    if command -v curl >/dev/null 2>&1; then
      TOKEN_TMP=$(curl -fsSL "$BACKEND_URL/agent/token?format=plain&code=$(printf %s "$CODE" | sed 's/ /%20/g')" || true)
    elif command -v wget >/dev/null 2>&1; then
      TOKEN_TMP=$(wget -qO- "$BACKEND_URL/agent/token?format=plain&code=$(printf %s "$CODE" | sed 's/ /%20/g')" || true)
    fi
    TOKEN="$TOKEN_TMP"
  fi
fi

if [[ -z "$TOKEN" ]]; then
  echo "Missing --token or invalid --code"; exit 1;
fi

ARCH_RAW="$(uname -m || echo unknown)"
ARCH=""
case "$ARCH_RAW" in
  x86_64|amd64) ARCH="amd64";;
  aarch64|arm64) ARCH="arm64";;
  *) ARCH="unknown";;
esac

PKG_MGR=""
if command -v apt-get >/dev/null 2>&1; then
  PKG_MGR="apt"
elif command -v dnf >/dev/null 2>&1; then
  PKG_MGR="dnf"
elif command -v yum >/dev/null 2>&1; then
  PKG_MGR="yum"
elif command -v pacman >/dev/null 2>&1; then
  PKG_MGR="pacman"
elif command -v apk >/dev/null 2>&1; then
  PKG_MGR="apk"
fi

# Wait for apt lock to be released (handles unattended-upgrades, apt-daily, etc.)
wait_for_apt_lock() {
  local max_wait=120
  local waited=0
  while fuser /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/cache/apt/archives/lock >/dev/null 2>&1; do
    if [ "$waited" -ge "$max_wait" ]; then
      ui_line "apt lock held too long — force-clearing..."
      pkill -9 apt 2>/dev/null || true
      pkill -9 apt-get 2>/dev/null || true
      pkill -9 dpkg 2>/dev/null || true
      rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend
      dpkg --configure -a 2>/dev/null || true
      break
    fi
    sleep 2
    waited=$((waited + 2))
  done
}

# Permanently disable background apt services that cause lock contention
disable_apt_timers() {
  systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true
  systemctl disable apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true
  systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true
}

install_pkgs() {
  case "$PKG_MGR" in
    apt)
      disable_apt_timers
      wait_for_apt_lock
      DEBIAN_FRONTEND=noninteractive apt-get -o Dpkg::Use-Pty=0 update -yqq
      wait_for_apt_lock
      DEBIAN_FRONTEND=noninteractive apt-get -o Dpkg::Use-Pty=0 install -yqq -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" "$@"
      ;;
    dnf)
      dnf -y -q makecache
      dnf -y -q install "$@"
      ;;
    yum)
      yum -y -q makecache
      yum -y -q install "$@"
      ;;
    pacman)
      pacman -Sy --noconfirm --needed "$@"
      ;;
    apk)
      apk add --no-cache "$@"
      ;;
    *)
      return 1
      ;;
  esac
}

download() {
  local url="$1"
  local out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --retry 3 --retry-delay 1 --retry-all-errors --connect-timeout 10 --max-time 300 -fsSL "$url" -o "$out"
    return 0
  fi
  if command -v wget >/dev/null 2>&1; then
    wget -qO "$out" --tries=3 --timeout=20 "$url"
    return 0
  fi
  # Fallback: use Python (almost always available on Ubuntu)
  if command -v python3 >/dev/null 2>&1; then
    python3 -c "import socket, urllib.request; socket.setdefaulttimeout(30); urllib.request.urlretrieve('$url', '$out')"
    return 0
  fi
  return 1
}

BIN_URL=""
if [ "$ARCH" = "amd64" ] && [ -n "$BIN_URL_AMD64" ]; then
  BIN_URL="$BIN_URL_AMD64"
elif [ "$ARCH" = "arm64" ] && [ -n "$BIN_URL_ARM64" ]; then
  BIN_URL="$BIN_URL_ARM64"
fi

# FAST PATH: If binaries are configured, skip apt-get entirely
if [ -n "$BIN_URL" ]; then
  ui_line "Fast install: downloading prebuilt binary..."
  INSTALL_BIN="/usr/local/bin/devyntra-agent"
  set +e
  download "$BIN_URL" "$INSTALL_BIN"
  dl_rc=$?
  set -e
  if [ "$dl_rc" -ne 0 ]; then
    if [ -n "$PKG_MGR" ]; then
      ui_line "Download failed; attempting to install ca-certificates and retry..."
      set +e
      install_pkgs ca-certificates >/dev/null 2>&1
      set -e
      run_step "Retrying agent binary download" download "$BIN_URL" "$INSTALL_BIN"
    else
      run_step "Downloading agent binary" false
    fi
  else
    STEP_DONE=$((STEP_DONE + 1))
    ui_line "[$STEP_DONE/$STEP_TOTAL] Downloading agent binary"
    ui_line "[OK] Downloading agent binary"
  fi
  run_step "Setting executable permissions" chmod +x "$INSTALL_BIN"
  run_step "Writing agent configuration" bash -c "mkdir -p /etc/devyntra-agent && cat > /etc/devyntra-agent/config.env <<EOF
DEVYNTRA_AGENT_TOKEN=$TOKEN
DEVYNTRA_BACKEND_URL=$BACKEND_URL
EOF
"

  if command -v systemctl >/dev/null 2>&1; then
    run_step "Installing systemd service" bash -c "cat > /etc/systemd/system/devyntra-agent.service <<EOF
[Unit]
Description=Devyntra Agent
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/devyntra-agent/config.env
ExecStart=/usr/local/bin/devyntra-agent
Restart=always
RestartSec=5
StandardOutput=append:/var/log/devyntra-agent/agent.log
StandardError=append:/var/log/devyntra-agent/agent.log

[Install]
WantedBy=multi-user.target
EOF
"
    run_step "Enabling + starting service" bash -c "systemctl daemon-reload && systemctl enable devyntra-agent >/dev/null 2>&1 && systemctl restart devyntra-agent >/dev/null 2>&1"
    ui_line "Devyntra Agent installed and running."
    ui_line "  Service: devyntra-agent"
    ui_line "  Status: systemctl status devyntra-agent"
    ui_line "  Logs: journalctl -u devyntra-agent -f"
    ui_line "Install log: $LOG_FILE"
    exit 0
  fi

  run_step "Starting agent (nohup)" bash -c "nohup /usr/local/bin/devyntra-agent > /var/log/devyntra-agent/agent.log 2>&1 &"
  ui_line "Devyntra Agent started in background (nohup)."
  ui_line "Install log: $LOG_FILE"
  exit 0
fi

# SLOW PATH: Only if binaries not configured - ensure curl/wget then use Node.js
ensure_downloader() {
  if command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1; then
    return 0
  fi
  if [ -z "$PKG_MGR" ]; then
    return 1
  fi
  install_pkgs curl >/dev/null 2>&1 && return 0
  install_pkgs wget >/dev/null 2>&1 && return 0
  return 1
}

run_step "Ensuring download tool" ensure_downloader

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  run_step "Installing Node.js + npm" install_pkgs nodejs npm
fi

INSTALL_DIR="/opt/devyntra-agent"
run_step "Preparing install directory" mkdir -p "$INSTALL_DIR"

if command -v curl >/dev/null 2>&1; then
run_step "Downloading agent runtime" curl -fsSL "$BACKEND_URL/agent/agent.js" -o "$INSTALL_DIR/agent.js"
else
run_step "Downloading agent runtime" wget -qO "$INSTALL_DIR/agent.js" "$BACKEND_URL/agent/agent.js"
fi

if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
run_step "Initializing agent package" bash -c 'cd "$1" && npm init -y >/dev/null 2>&1' _ "$INSTALL_DIR"
else
STEP_DONE=$((STEP_DONE + 1))
if [ "$TTY" -eq 1 ]; then
printf "[OK] %s %s (%d/%d)\n" "$(render_bar "$STEP_DONE" "$STEP_TOTAL")" "Agent package already initialized" "$STEP_DONE" "$STEP_TOTAL" >&3
else
ui_line "[$STEP_DONE/$STEP_TOTAL] Agent package already initialized"
fi
fi

run_step "Installing WebSocket dependency" bash -c 'cd "$1" && npm install ws@8 --silent --no-progress' _ "$INSTALL_DIR"

run_step "Writing agent configuration" bash -c 'cat > "$1/config.env" <<EOF
DEVYNTRA_AGENT_TOKEN=$TOKEN
DEVYNTRA_BACKEND_URL=$BACKEND_URL
EOF' _ "$INSTALL_DIR"

if command -v systemctl >/dev/null 2>&1; then
run_step "Installing systemd service" bash -c "cat > /etc/systemd/system/devyntra-agent.service <<EOF
[Unit]
Description=Devyntra Agent
After=network.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/config.env
ExecStart=/usr/bin/env node $INSTALL_DIR/agent.js --token \\\$DEVYNTRA_AGENT_TOKEN --backend \\\$DEVYNTRA_BACKEND_URL
Restart=always
RestartSec=5
StandardOutput=append:/var/log/devyntra-agent/agent.log
StandardError=append:/var/log/devyntra-agent/agent.log

[Install]
WantedBy=multi-user.target
EOF
"

run_step "Enabling + starting service" bash -c "systemctl daemon-reload && systemctl enable devyntra-agent >/dev/null 2>&1 && systemctl restart devyntra-agent >/dev/null 2>&1"
ui_line "Devyntra Agent installed and running."
ui_line "  Service: devyntra-agent"
ui_line "  Status: systemctl status devyntra-agent"
ui_line "  Logs: journalctl -u devyntra-agent -f"
ui_line "Install log: $LOG_FILE"
else
run_step "Starting agent (nohup)" bash -c "nohup node \"$INSTALL_DIR/agent.js\" --token \"$TOKEN\" --backend \"$BACKEND_URL\" > /var/log/devyntra-agent/agent.log 2>&1 &"
ui_line "Devyntra Agent started in background (nohup)."
ui_line "Install log: $LOG_FILE"
fi
`);
});

const port = process.env.PORT ? Number(process.env.PORT) : 8080;
const server = http.createServer(app);


const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname || '';
    if (pathname !== '/agent/connect' && pathname !== '/agent/connect/') {
      try {
        console.log('[agent-ws] upgrade ignored', {
          pathname,
          host: req.headers?.host,
        });
      } catch (e) { }
      socket.destroy();
      return;
    }

    try {
      console.log('[agent-ws] upgrade received', {
        pathname,
        host: req.headers?.host,
        hasToken: url.searchParams.has('token'),
      });
    } catch (e) { }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } catch (e) {
    socket.destroy();
  }
});

wss.on('connection', (ws, req) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    const record = token ? agentConnection.validateToken(token) : null;
    if (!record) {
      try {
        console.log('[agent-ws] reject: invalid token', {
          host: req.headers?.host,
          hasToken: !!token,
          tokenPrefix: token ? String(token).slice(0, 12) : null,
        });
      } catch (e) { }
      ws.close();
      return;
    }

    agentConnection.registerSession(record.agentId, record.userId, ws, {});

    ws.on('message', (data) => {
      agentConnection.handleAgentMessage(record.agentId, data);
    });

    ws.on('close', () => {
      agentConnection.removeSession(record.agentId);
    });

    ws.on('error', () => {
      agentConnection.removeSession(record.agentId);
    });
  } catch (e) {
    ws.close();
  }
});

// Import infrastructure services
import { cloudConfigService } from './services/cloud-config.js';
import { infrastructureService } from './services/infrastructure.js';
import { terraformService } from './services/terraform.js';

// CLOUD CONFIGURATION API
app.get('/api/cloud-configs', requireUser, async (req, res) => {
  try {
    const configs = await cloudConfigService.getConfigs(req.user.id);
    res.json({ configs });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cloud-configs', requireUser, async (req, res) => {
  try {
    const { provider, name, region, credentials } = req.body;

    // Validate credentials before saving
    let validation;
    if (provider === 'aws') {
      validation = await cloudConfigService.validateAwsCredentials(
        credentials.accessKeyId, credentials.secretAccessKey, region
      );
    } else if (provider === 'gcp') {
      validation = await cloudConfigService.validateGcpCredentials(
        credentials.serviceAccountKey, credentials.projectId
      );
    } else if (provider === 'azure') {
      validation = await cloudConfigService.validateAzureCredentials(
        credentials.clientId, credentials.clientSecret, credentials.tenantId, credentials.subscriptionId
      );
    }

    if (!validation.valid) {
      return res.status(400).json({ error: 'Invalid credentials: ' + validation.error });
    }

    const config = await cloudConfigService.saveConfig(req.user.id, {
      provider, name, region, credentials
    });

    res.json({ success: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/cloud-configs/:id', requireUser, async (req, res) => {
  try {
    await cloudConfigService.deleteConfig(req.user.id, req.params.id);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/cloud-configs/:id/test', requireUser, async (req, res) => {
  try {
    const result = await cloudConfigService.testConfig(req.user.id, req.params.id);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// INFRASTRUCTURE DISCOVERY API
app.get('/api/infrastructure/discover/:configId', requireUser, async (req, res) => {
  try {
    const result = await infrastructureService.discoverExistingInfrastructure(
      req.user.id, req.params.configId
    );
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// INFRASTRUCTURE PLANNING API
app.post('/api/infrastructure/plan', requireUser, async (req, res) => {
  try {
    const { configId, prompt } = req.body;
    const plan = await infrastructureService.generateInfrastructurePlan(
      req.user.id, configId, prompt
    );
    res.json({ success: true, plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/infrastructure/plans', requireUser, async (req, res) => {
  try {
    const plans = await infrastructureService.getPlans(req.user.id);
    res.json({ plans });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/infrastructure/plans/:id', requireUser, async (req, res) => {
  try {
    const plan = await infrastructureService.getPlanById(req.user.id, req.params.id);
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    res.json({ plan });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// DEPLOYMENT API
app.post('/api/infrastructure/deploy/:planId', requireUser, async (req, res) => {
  try {
    const result = await terraformService.executeDeployment(req.user.id, req.params.planId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/infrastructure/deployments/:deploymentId', requireUser, async (req, res) => {
  try {
    const status = await terraformService.getDeploymentStatus(req.params.deploymentId);
    if (!status) return res.status(404).json({ error: 'Deployment not found' });
    res.json(status);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/infrastructure/destroy/:planId', requireUser, async (req, res) => {
  try {
    const result = await terraformService.destroyDeployment(req.user.id, req.params.planId);
    res.json({ success: true, ...result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// CICD Pipeline API
app.get('/cicd/pipelines', requireUser, async (req, res) => {
  try {
    const pipelinesRes = await query(
      'SELECT * FROM cicd_pipelines WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json({ success: true, pipelines: pipelinesRes.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/cicd/pipeline', requireUser, async (req, res) => {
  try {
    const { name, config } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Pipeline name is required' });
    
    const pipelineRes = await query(
      'INSERT INTO cicd_pipelines (user_id, name, config, status, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *',
      [req.user.id, name, JSON.stringify(config || {}), 'pending']
    );
    res.json({ success: true, pipeline: pipelineRes.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/cicd/pipeline/:id/run', requireUser, async (req, res) => {
  try {
    // Update status to running
    await query(
      'UPDATE cicd_pipelines SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3',
      ['running', req.params.id, req.user.id]
    );
    res.json({ success: true, message: 'Pipeline started' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

server.listen(port, () => {
  console.log(`Devyntra backend listening on ${port}`);
});



app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: err?.message || 'Internal Server Error' });
});
