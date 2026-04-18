import crypto from 'crypto';

const AGENT_TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 30 * 1000;

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = String(input)
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(String(input).length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function signAgentToken(payload, secret) {
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(
    crypto.createHmac('sha256', String(secret)).update(body).digest()
  );
  return `${body}.${sig}`;
}

function verifyAgentToken(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = base64UrlEncode(
    crypto.createHmac('sha256', String(secret)).update(body).digest()
  );

  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch (e) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (!payload.userId || !payload.agentId || !payload.exp) return null;
  if (Number(payload.exp) < now()) return null;
  return { userId: payload.userId, agentId: payload.agentId, expiresAt: Number(payload.exp) };
}

function now() {
  return Date.now();
}

function randomId() {
  return crypto.randomBytes(16).toString('hex');
}

class AgentConnection {
  constructor() {
    this.pendingTokens = new Map(); // token -> { userId, agentId, expiresAt }
    this.acceptedTokens = new Map(); // token -> { userId, agentId }
    this.enrollCodes = new Map(); // code -> { token, userId, agentId, expiresAt }
    this.sessions = new Map(); // agentId -> { userId, ws, connectedAt, lastSeen, meta }
    this.serverBindings = new Map(); // serverId -> agentId
    this.requests = new Map(); // requestId -> { resolve, reject, timeoutId }

    // Ping agents every 30s to keep connection alive
    setInterval(() => {
      for (const [agentId, session] of this.sessions.entries()) {
        if (now() - session.lastSeen > 90000) {
          try { session.ws.close(); } catch (e) { }
          this.removeSession(agentId);
        } else {
          try { session.ws.send(JSON.stringify({ type: 'ping' })); } catch (e) { }
        }
      }
    }, 30000);
  }

  createEnrollToken(userId) {
    const agentId = randomId();
    const expiresAt = now() + AGENT_TOKEN_TTL_MS;
    const secret = process.env.DEVYNTRA_AGENT_SECRET;
    const token = secret
      ? signAgentToken({ userId, agentId, exp: expiresAt }, secret)
      : randomId() + randomId();

    const code = crypto.randomBytes(3).toString('hex');
    this.enrollCodes.set(code, { token, userId, agentId, expiresAt });

    if (!secret) {
      this.pendingTokens.set(token, { userId, agentId, expiresAt });
    }
    return { agentId, token, code, expiresAt };
  }

  consumeEnrollCode(code) {
    const key = String(code || '').trim();
    if (!key) return null;
    const record = this.enrollCodes.get(key);
    if (!record) return null;
    this.enrollCodes.delete(key);
    if (record.expiresAt < now()) return null;
    return record;
  }

  validateToken(token) {
    const secret = process.env.DEVYNTRA_AGENT_SECRET;
    if (secret) {
      const verified = verifyAgentToken(token, secret);
      if (verified) return verified;
    }

    const accepted = this.acceptedTokens.get(token);
    if (accepted) return { ...accepted, expiresAt: Number.POSITIVE_INFINITY };

    const record = this.pendingTokens.get(token);
    if (!record) return null;
    if (record.expiresAt < now()) {
      this.pendingTokens.delete(token);
      return null;
    }
    this.pendingTokens.delete(token);
    this.acceptedTokens.set(token, { userId: record.userId, agentId: record.agentId });
    return record;
  }

  registerSession(agentId, userId, ws, meta = {}) {
    this.sessions.set(agentId, {
      userId,
      ws,
      connectedAt: now(),
      lastSeen: now(),
      meta,
    });
  }

  updateSession(agentId, patch) {
    const session = this.sessions.get(agentId);
    if (!session) return;
    this.sessions.set(agentId, { ...session, ...patch, lastSeen: now() });
  }

  removeSession(agentId) {
    this.sessions.delete(agentId);
    for (const [serverId, boundAgentId] of this.serverBindings.entries()) {
      if (boundAgentId === agentId) this.serverBindings.delete(serverId);
    }
  }

  getSession(agentId) {
    return this.sessions.get(agentId) || null;
  }

  isAgentOnline(agentId) {
    return this.sessions.has(agentId);
  }

  isAgentServerId(serverId) {
    return typeof serverId === 'string' && serverId.includes('_agent_');
  }

  bindServer(serverId, agentId, userId) {
    const session = this.sessions.get(agentId);
    if (!session) {
      console.log(`[agent-connection] bindServer failed: agent ${agentId} not found in sessions`);
      return false;
    }
    if (session.userId !== userId) {
      console.log(`[agent-connection] bindServer failed: userId mismatch for agent ${agentId}`);
      return false;
    }

    // Remove any existing binding for this serverId to allow rebinding
    const existingAgentId = this.serverBindings.get(serverId);
    if (existingAgentId && existingAgentId !== agentId) {
      console.log(`[agent-connection] Replacing existing binding for serverId ${serverId}: ${existingAgentId} -> ${agentId}`);
    }

    this.serverBindings.set(serverId, agentId);
    console.log(`[agent-connection] Successfully bound serverId ${serverId} to agent ${agentId}`);
    return true;
  }

  isConnected(serverId) {
    const agentId = this.serverBindings.get(serverId);
    if (!agentId) return false;
    return this.sessions.has(agentId);
  }

  disconnect(serverId) {
    this.serverBindings.delete(serverId);
    return { success: true };
  }

  getAgentIdForServer(serverId) {
    return this.serverBindings.get(serverId) || null;
  }

  async exec(serverId, command) {
    const agentId = this.getAgentIdForServer(serverId);
    if (!agentId) throw new Error('Not connected');
    return this.execAgent(agentId, command);
  }

  async execAgent(agentId, command) {
    const session = this.sessions.get(agentId);
    if (!session || !session.ws) throw new Error('Agent offline');

    const requestId = randomId();
    const payload = {
      type: 'exec',
      id: requestId,
      command,
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.requests.delete(requestId);
        reject(new Error('Agent request timed out. The agent might be offline or busy.'));
      }, REQUEST_TIMEOUT_MS);

      this.requests.set(requestId, { resolve, reject, timeoutId });
      try {
        session.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timeoutId);
        this.requests.delete(requestId);
        reject(err);
      }
    });
  }

  async readFile(serverId, path) {
    const safePath = String(path).replace(/"/g, '\\"');
    return this.exec(serverId, `cat "${safePath}"`);
  }

  async writeFile(serverId, path, content) {
    const safePath = String(path).replace(/"/g, '\\"');
    if (content && typeof content === 'object' && content.base64) {
      const b64 = String(content.base64);
      return this.exec(serverId, `echo "${b64}" | base64 -d > "${safePath}"`);
    }
    const text = String(content ?? '').replace(/'/g, "'\"'\"'");
    return this.exec(serverId, `echo '${text}' > "${safePath}"`);
  }

  async uploadFile(serverId, remotePath, base64) {
    return this.writeFile(serverId, remotePath, { base64 });
  }

  handleAgentMessage(agentId, message) {
    try {
      const data = JSON.parse(message);
      if (!data || typeof data !== 'object') return;
      if (data.type === 'hello') {
        this.updateSession(agentId, { meta: data });
        return;
      }
      if (data.type === 'pong') {
        this.updateSession(agentId, { lastSeen: now() });
        return;
      }
      if (data.type === 'exec_result' && data.id) {
        const pending = this.requests.get(data.id);
        if (!pending) return;
        clearTimeout(pending.timeoutId);
        this.requests.delete(data.id);
        pending.resolve({
          stdout: data.stdout || '',
          stderr: data.stderr || '',
          code: typeof data.code === 'number' ? data.code : 0,
        });
      }
    } catch (err) {
      return;
    }
  }
}

export const agentConnection = new AgentConnection();
