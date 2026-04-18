import { Client } from 'ssh2';
import net from 'net';

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (err, result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (e) {}
      if (err) reject(err);
      else resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once('connect', () => {
      done(null, { ok: true });
    });

    socket.once('timeout', () => {
      done(new Error('TCP connection timed out'));
    });

    socket.once('error', (err) => {
      done(err);
    });

    try {
      socket.connect(port, host);
    } catch (e) {
      done(e);
    }
  });
}

class SSHConnection {
  constructor() {
    this.connections = new Map();
    this.executionQueues = new Map(); // Queue for serializing commands per connection
    this.maxConcurrentCommands = 5; // Limit concurrent commands per connection
  }

  getConnection(serverId) {
    return this.connections.get(serverId);
  }

  setConnection(serverId, conn) {
    this.connections.set(serverId, conn);
  }

  removeConnection(serverId) {
    const conn = this.connections.get(serverId);
    if (conn) {
      try {
        conn.removeAllListeners();
        conn.end();
      } catch (e) {
        console.error('[ssh] error removing connection:', e);
      }
      this.connections.delete(serverId);
    }
    
    // Clean up execution queue
    if (this.executionQueues.has(serverId)) {
      const queueInfo = this.executionQueues.get(serverId);
      // Reject all queued commands
      queueInfo.queue.forEach(item => {
        item.reject(new Error('Connection closed'));
      });
      this.executionQueues.delete(serverId);
    }
  }

  async connect(serverId, config) {
    const host = config.host;
    const port = config.port || 22;
    
    console.log(`[ssh] Attempting to connect to ${host}:${port} with serverId: ${serverId}`);
    
    try {
      await probeTcp(host, port, 8000);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      throw new Error(
        `Connection failed: Unable to reach ${host}:${port} from the backend (TCP check: ${msg}). ` +
        'This usually means the SSH port is blocked by a firewall/security group or the server only allows specific source IPs.'
      );
    }

    return new Promise((resolve, reject) => {
      const conn = new Client();

      const connConfig = {
        host: host,
        port: port,
        username: config.username,
        readyTimeout: (typeof config.readyTimeout === 'number' && Number.isFinite(config.readyTimeout)) ? config.readyTimeout : 120000,
        timeout: (typeof config.timeout === 'number' && Number.isFinite(config.timeout)) ? config.timeout : 30000,
        keepaliveInterval: (typeof config.keepaliveInterval === 'number' && Number.isFinite(config.keepaliveInterval)) ? config.keepaliveInterval : 10000,
        keepaliveCountMax: (typeof config.keepaliveCountMax === 'number' && Number.isFinite(config.keepaliveCountMax)) ? config.keepaliveCountMax : 3,
      };

      if (config.privateKey && config.privateKey.trim()) {
        try {
          connConfig.privateKey = config.privateKey;
          if (config.passphrase) {
            connConfig.passphrase = config.passphrase;
          }
        } catch (err) {
          return reject(new Error(`Failed to process private key: ${err.message}`));
        }
      } else if (config.password && config.password.trim()) {
        connConfig.password = config.password;
      } else {
        return reject(
          new Error('No authentication method provided. Please provide either a private key or password.')
        );
      }

      conn
        .on('banner', (message) => {
          try {
            console.log('[ssh] banner:', String(message || '').trim());
          } catch (e) {}
        })
        .on('ready', () => {
          console.log(`[ssh] Connection ready for serverId: ${serverId}`);
          this.setConnection(serverId, conn);
          
          // Monitor connection health
          conn.on('close', () => {
            console.log('[ssh] connection closed for', serverId);
            this.removeConnection(serverId);
          });
          
          conn.on('end', () => {
            console.log('[ssh] connection ended for', serverId);
            this.removeConnection(serverId);
          });
          
          resolve({ status: 'connected', message: 'SSH connection established successfully.' });
        })
        .on('error', (err) => {
          try {
            console.error('[ssh] connection error:', err);
          } catch (e) {}
          this.removeConnection(serverId);
          const msg = String(err && err.message ? err.message : err);
          if (msg.toLowerCase().includes('timed out while waiting for handshake')) {
            reject(
              new Error(
                'Connection failed: Timed out while waiting for handshake. This usually means the SSH port is blocked or the server only allows specific source IPs. If you can SSH from your PC but not from the app, allow inbound SSH (port 22) from the internet or host the backend on a network that can reach this server.'
              )
            );
            return;
          }
          reject(new Error(`Connection failed: ${msg}`));
        })
        .on('end', () => {
          this.removeConnection(serverId);
        })
        .connect(connConfig);
    });
  }

  disconnect(serverId) {
    this.removeConnection(serverId);
    return { success: true };
  }

  async exec(serverId, command) {
    const conn = this.getConnection(serverId);
    if (!conn) {
      throw new Error('Not connected');
    }

    // Initialize queue for this connection if it doesn't exist
    if (!this.executionQueues.has(serverId)) {
      this.executionQueues.set(serverId, { running: 0, queue: [] });
    }

    const queueInfo = this.executionQueues.get(serverId);

    // If we're at max concurrent commands, queue this one
    if (queueInfo.running >= this.maxConcurrentCommands) {
      return new Promise((resolve, reject) => {
        queueInfo.queue.push({ command, resolve, reject });
      });
    }

    // Execute immediately
    return this._executeCommand(serverId, conn, command);
  }

  async _executeCommand(serverId, conn, command) {
    const queueInfo = this.executionQueues.get(serverId);
    if (queueInfo) {
      queueInfo.running++;
    }

    try {
      const result = await new Promise((resolve, reject) => {
        conn.exec(command, (err, stream) => {
          if (err) {
            // Check if it's a channel open failure - connection is stale
            const errMsg = String(err.message || err);
            if (errMsg.includes('Channel open failure') || errMsg.includes('channel')) {
              // Remove the stale connection
              this.removeConnection(serverId);
              return reject(new Error('SSH connection is stale. Please reconnect.'));
            }
            return reject(err);
          }
          let stdout = '';
          let stderr = '';
          stream
            .on('close', (code) => {
              resolve({ stdout, stderr, code });
            })
            .on('data', (data) => {
              stdout += data;
            })
            .stderr.on('data', (data) => {
              stderr += data;
            });
        });
      });

      return result;
    } finally {
      // Decrement running count and process queue
      if (queueInfo) {
        queueInfo.running--;
        
        // Process next queued command
        if (queueInfo.queue.length > 0) {
          const next = queueInfo.queue.shift();
          this._executeCommand(serverId, conn, next.command)
            .then(next.resolve)
            .catch(next.reject);
        }
      }
    }
  }

  async readFile(serverId, path) {
    const result = await this.exec(serverId, `cat "${path}"`);
    if (result.code !== 0) {
      throw new Error(result.stderr);
    }
    return result.stdout;
  }

  async writeFile(serverId, path, content) {
    const safePath = String(path).replace(/"/g, '\\"');

    if (content && typeof content === 'object' && content.base64) {
      const b64 = String(content.base64);
      const result = await this.exec(serverId, `echo "${b64}" | base64 -d > "${safePath}"`);
      if (result.code !== 0) {
        throw new Error(result.stderr);
      }
      return result;
    }

    const text = String(content ?? '');
    const escaped = text.replace(/'/g, "'\"'\"'");
    const result = await this.exec(serverId, `echo '${escaped}' > "${safePath}"`);
    if (result.code !== 0) {
      throw new Error(result.stderr);
    }
    return result;
  }

  async uploadFile(serverId, remotePath, base64) {
    return this.writeFile(serverId, remotePath, { base64 });
  }

  isConnected(serverId) {
    const connected = this.connections.has(serverId);
    if (!connected) {
      console.log(`[ssh] Connection check failed for serverId: ${serverId}. Available connections:`, Array.from(this.connections.keys()));
    }
    return connected;
  }
}

export const sshConnection = new SSHConnection();
