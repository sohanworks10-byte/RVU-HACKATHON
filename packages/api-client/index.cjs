function getDefaultBaseUrl() {
  if (typeof process !== 'undefined' && process && process.env) {
    const url =
      process.env.NEXT_PUBLIC_BACKEND_URL ||
      process.env.DEVYNTRA_BACKEND_URL ||
      process.env.BACKEND_URL;

    if (url && typeof url === 'string') {
      return String(url).trim();
    }
  }

  return 'https://devyntra-backend-api-production.up.railway.app';
}

function normalizeBaseUrl(baseUrl) {
  if (!baseUrl) return '';
  return String(baseUrl).trim().replace(/\/+$/, '');
}

class ApiClient {
  constructor(options = {}) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl ?? getDefaultBaseUrl());
    this.serverId = null;
    this.token = null;
  }

  setBaseUrl(baseUrl) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
  }

  setToken(token) {
    this.token = token;
  }

  setServerId(serverId) {
    this.serverId = serverId;
  }

  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const retryableStatuses = new Set([502, 503, 504]);
    const maxAttempts = 3;
    let lastErr = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const timeoutMs = 15000;
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      let timeoutId = null;
      let timeoutPromise = null;

      if (controller) {
        timeoutId = setTimeout(() => {
          try {
            controller.abort();
          } catch (e) { }
        }, timeoutMs);
      } else {
        timeoutPromise = new Promise((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
        });
      }

      try {
        const fetchPromise = fetch(url, {
          ...options,
          headers,
          signal: controller ? controller.signal : undefined,
        });

        const response = timeoutPromise
          ? await Promise.race([fetchPromise, timeoutPromise])
          : await fetchPromise;

        const responseText = await response.text();
        let payload = null;

        if (responseText) {
          try {
            payload = JSON.parse(responseText);
          } catch (e) {
            payload = responseText;
          }
        }

        const looksLikeHtml = false;

        if (!response.ok) {
          if ((retryableStatuses.has(response.status) || looksLikeHtml) && attempt < maxAttempts) {
            const backoffMs = 500 * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }

          const message =
            looksLikeHtml
              ? 'Backend is temporarily unavailable. Please try again.'
              : payload && typeof payload === 'object'
                ? payload.error || JSON.stringify(payload)
                : payload;
          throw new Error(message || `Request failed with status ${response.status}`);
        }

        if (looksLikeHtml) {
          if (attempt < maxAttempts) {
            const backoffMs = 500 * Math.pow(2, attempt - 1);
            await new Promise((r) => setTimeout(r, backoffMs));
            continue;
          }
          throw new Error('Backend is temporarily unavailable. Please try again.');
        }

        if (!payload) return {};
        return typeof payload === 'string' ? { message: payload } : payload;
      } catch (err) {
        lastErr = err;
        const msg = String((err && err.message) || err);
        const retryableError =
          msg.toLowerCase().includes('aborted') ||
          msg.toLowerCase().includes('timed out') ||
          msg.toLowerCase().includes('timeout') ||
          msg.toLowerCase().includes('networkerror') ||
          msg.toLowerCase().includes('failed to fetch') ||
          msg.toLowerCase().includes('fetch failed');

        if (retryableError && attempt < maxAttempts) {
          const backoffMs = 500 * Math.pow(2, attempt - 1);
          await new Promise((r) => setTimeout(r, backoffMs));
          continue;
        }

        console.error("API CLIENT FETCH ERROR DETAILS:", msg, err);
        throw new Error(`Connection Error: ${msg}`);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw lastErr || new Error('Request failed');
  }

  async connect(config) {
    const result = await this.request('/ssh/connect', {
      method: 'POST',
      body: JSON.stringify(config),
    });
    this.setServerId(result.serverId);
    return result;
  }

  async enrollAgent() {
    const payload = this.token ? { access_token: this.token } : {};
    return this.request('/agent/enroll', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async connectAgent(agentIdOrServerId) {
    const payload = String(agentIdOrServerId || '').includes('_agent_')
      ? { serverId: agentIdOrServerId }
      : { agentId: agentIdOrServerId };
    const result = await this.request('/agent/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (result && result.serverId) {
      this.setServerId(result.serverId);
    }
    return result;
  }

  async getAgentStatus(agentId) {
    const query = `agentId=${encodeURIComponent(agentId)}`;
    return this.request(`/agent/status?${query}`, {
      method: 'GET',
    });
  }

  async uninstallAgent(agentId) {
    return this.request('/agent/uninstall', {
      method: 'POST',
      body: JSON.stringify({ agentId }),
    });
  }

  async disconnect() {
    if (!this.serverId) return { success: true };

    const result = await this.request('/ssh/disconnect', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId }),
    });
    this.setServerId(null);
    return result;
  }

  async execute(command) {
    return this.request('/ssh/command', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, command }),
    });
  }

  async getStats() {
    return this.request('/ssh/stats', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId }),
    });
  }

  async getServices() {
    return this.request('/ssh/services', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId }),
    });
  }

  async listFiles(folderPath = '.') {
    return this.request('/ssh/files', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, folderPath }),
    });
  }

  async readFile(path) {
    return this.request(`/ssh/files?serverId=${this.serverId}&path=${encodeURIComponent(path)}`, {
      method: 'GET',
    });
  }

  async writeFile(path, content) {
    let payloadContent = content;

    if (typeof content === 'string') {
      let base64;
      if (typeof Buffer !== 'undefined') {
        base64 = Buffer.from(content, 'utf8').toString('base64');
      } else if (typeof btoa !== 'undefined') {
        base64 = btoa(unescape(encodeURIComponent(content)));
      }

      if (base64) {
        payloadContent = { base64 };
      }
    }

    return this.request('/ssh/files', {
      method: 'PUT',
      body: JSON.stringify({ serverId: this.serverId, path, content: payloadContent }),
    });
  }

  async uploadFile(remotePath, base64) {
    return this.request('/ssh/upload', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, remotePath, base64 }),
    });
  }

  async getUsers() {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'list' }),
    });
  }

  async createUser(username, password, groups = []) {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'create', username, password, groups }),
    });
  }

  async deleteUser(username) {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'delete', username }),
    });
  }

  async updateUserPassword(username, password) {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'update-password', username, password }),
    });
  }

  async createGroup(name) {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'create-group', name }),
    });
  }

  async deleteGroup(name) {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'delete-group', name }),
    });
  }

  async addUserToGroup(username, group) {
    return this.request('/ssh/users', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'add-to-group', username, group }),
    });
  }

  async deployApp(config) {
    return this.request('/ssh/deploy', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'deploy', ...config }),
    });
  }

  async listApps() {
    return this.request('/ssh/deploy', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'list' }),
    });
  }

  async manageApp(id, manageAction) {
    return this.request('/ssh/deploy', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'manage', id, manageAction }),
    });
  }

  async getDisks() {
    return this.request('/ssh/system', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'disks' }),
    });
  }

  async mountDisk(device, mountPoint, format) {
    return this.request('/ssh/system', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'mount', device, mountPoint, format }),
    });
  }

  async installPackage(packageName) {
    return this.request('/ssh/system', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'install-package', package: packageName }),
    });
  }

  async removePackage(packageName) {
    return this.request('/ssh/system', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'remove-package', package: packageName }),
    });
  }

  async checkInstalled(packages) {
    return this.request('/ssh/system', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'check-installed', packages }),
    });
  }

  async getSecurityStatus() {
    return this.request('/ssh/system', {
      method: 'POST',
      body: JSON.stringify({ serverId: this.serverId, action: 'security' }),
    });
  }
}

const apiClient = new ApiClient();

module.exports = { ApiClient, apiClient };
module.exports.default = apiClient;
