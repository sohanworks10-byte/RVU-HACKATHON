// Web version shim for Electron/Main.js APIs
(function() {
    const listeners = {};
    let apiAvailable = true;

    // Check if API is available
    async function checkApiAvailable() {
        try {
            const response = await fetch('/api/rpc', { method: 'HEAD' });
            apiAvailable = response.ok;
        } catch (e) {
            apiAvailable = false;
        }
        return apiAvailable;
    }

    // Check on load
    checkApiAvailable();

    const ipcRenderer = {
        invoke: async function(channel, ...args) {
            // First, try to handle certain channels locally
            const localResult = handleLocalChannel(channel, args);
            if (localResult !== undefined) {
                return localResult;
            }

            // If API is not available, throw immediately with a clear error
            if (!apiAvailable) {
                throw new Error(`IPC channel '${channel}' not available in web mode (no backend)`);
            }

            try {
                const response = await fetch('/api/rpc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, args })
                });
                if (!response.ok) {
                    // Mark API as unavailable on 404
                    if (response.status === 404) {
                        apiAvailable = false;
                    }
                    throw new Error(`HTTP error ${response.status}`);
                }
                const json = await response.json();
                if (json.success) return json.data;
                throw new Error(json.error || 'Unknown RPC error');
            } catch (e) {
                console.warn(`IPC invoke error (${channel}):`, e.message);
                throw e;
            }
        },
        on: function(channel, listener) {
            if(!listeners[channel]) listeners[channel] = [];
            listeners[channel].push(listener);
        },
        send: function(channel, ...args) {
            console.log('ipcRenderer.send', channel, args);
        }
    };

    // Handle certain IPC channels locally (without backend)
    function handleLocalChannel(channel, args) {
        // Security settings - stored in localStorage
        if (channel === 'security:get-settings') {
            try {
                const stored = localStorage.getItem('devaiSecuritySettings');
                const settings = stored ? JSON.parse(stored) : {};
                return { success: true, settings };
            } catch (e) {
                console.warn('[web-shim] Failed to read security settings from localStorage:', e);
                return { success: true, settings: {} };
            }
        }

        if (channel === 'security:set-settings') {
            try {
                const newSettings = args[0];
                localStorage.setItem('devaiSecuritySettings', JSON.stringify(newSettings));
                return { success: true };
            } catch (e) {
                console.warn('[web-shim] Failed to save security settings to localStorage:', e);
                return { success: false, error: e.message };
            }
        }

        // Auth tokens - stored in localStorage (synced with Supabase)
        if (channel === 'auth:get-token') {
            try {
                const token = localStorage.getItem('sb-token') || localStorage.getItem('supabase.auth.token');
                return token || null;
            } catch (e) {
                return null;
            }
        }

        if (channel === 'auth:set-token') {
            try {
                const token = args[0];
                if (token) {
                    localStorage.setItem('sb-token', token);
                } else {
                    localStorage.removeItem('sb-token');
                }
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        // Backend URL - stored in localStorage
        if (channel === 'backend:get-base-url') {
            try {
                let url = localStorage.getItem('AlphaOpsBackendUrl');
                // If not set, use default production backend
                if (!url) {
                    url = 'https://AlphaOps-global-20260203.onrender.com';
                    localStorage.setItem('AlphaOpsBackendUrl', url);
                }
                return { success: true, baseUrl: url };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        // DevAI history - stored in localStorage
        if (channel === 'devai:history-append') {
            try {
                const entry = args[0];
                const history = JSON.parse(localStorage.getItem('devaiHistory') || '[]');
                history.push(entry);
                // Keep only last 100 entries
                if (history.length > 100) history.shift();
                localStorage.setItem('devaiHistory', JSON.stringify(history));
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        // Agent enrollment - call backend API directly
        if (channel === 'agent:enroll') {
            return handleAgentEnroll();
        }

        // Agent install - same as enroll for web mode
        if (channel === 'agent:install') {
            return handleAgentEnroll();
        }

        // Agent status check - call backend API
        if (channel === 'agent:status') {
            return handleAgentStatus(args[0]);
        }

        // Agent connect - call backend API
        if (channel === 'agent:connect') {
            return handleAgentConnect(args[0]);
        }

        // Agent exec - call backend API
        if (channel === 'ssh:exec' || channel === 'ssh:execute') {
            return handleAgentExec(args[0]);
        }

        // Agent stats - call backend API
        if (channel === 'ssh:get-stats') {
            return handleAgentStats();
        }

        // Monitoring config helpers
        if (channel === 'monitoring:get-backend-url') {
            try {
                return { url: getBackendUrl() };
            } catch (e) {
                return { url: '' };
            }
        }

        // SSH operations - not available in web mode
        if (channel === 'ssh:connect' || channel === 'ssh:disconnect') {
            console.warn(`[web-shim] SSH operations not available in web mode (${channel})`);
            return { success: false, error: 'SSH requires desktop app' };
        }

        // File operations - not available in web mode
        if (channel === 'files:list' || channel === 'files:read' || channel === 'files:write' ||
            channel === 'files:upload' || channel === 'files:download') {
            console.warn(`[web-shim] File operations not available in web mode (${channel})`);
            return { success: false, error: 'File operations require desktop app' };
        }

        // Monitoring operations - not available in web mode
        if (channel === 'monitoring:start' || channel === 'monitoring:stop') {
            console.warn(`[web-shim] Monitoring operations not available in web mode (${channel})`);
            return { success: false, error: 'Monitoring requires desktop app' };
        }

        // Settings operations - stored in localStorage
        if (channel === 'settings:get') {
            try {
                const key = args[0];
                const value = localStorage.getItem(`setting:${key}`);
                return { success: true, value: value ? JSON.parse(value) : null };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        if (channel === 'settings:set') {
            try {
                const key = args[0];
                const value = args[1];
                localStorage.setItem(`setting:${key}`, JSON.stringify(value));
                return { success: true };
            } catch (e) {
                return { success: false, error: e.message };
            }
        }

        // Return undefined for channels that need backend handling
        return undefined;
    }

    // Get backend URL - uses deployed backend by default, allows override via localStorage
    function getBackendUrl() {
        // Allow user to override via localStorage
        const userOverride = localStorage.getItem('AlphaOpsBackendUrl');
        if (userOverride) return userOverride;
        
        // Default to deployed Render backend
        return 'https://AlphaOps-global-20260203.onrender.com';
    }

    // Handle agent enrollment via backend API
    async function handleAgentEnroll() {
        try {
            // Get backend URL
            const backendUrl = getBackendUrl();
            
            // Get auth token
            const token = await getAuthToken();
            
            if (!token) {
                return { success: false, error: 'Not authenticated. Please sign in first.' };
            }

            // Call the backend API directly
            const response = await fetch(`${backendUrl}/agent/enroll`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[web-shim] Agent enroll failed:', response.status, errorText);
                return { success: false, error: `Backend error: ${response.status} - ${errorText || 'Unknown error'}` };
            }

            const result = await response.json();
            return { success: true, ...result };
        } catch (e) {
            console.error('[web-shim] Agent enroll error:', e);
            // Check if it's a connection refused error
            if (e.message?.includes('Failed to fetch') || e.message?.includes('ECONNREFUSED')) {
                return { 
                    success: false, 
                    error: 'Backend server not available. Please start the backend server (npm run dev in apps/backend) or use SSH connection mode instead.' 
                };
            }
            return { success: false, error: e.message || 'Failed to generate agent install command' };
        }
    }

    // Handle agent status check via backend API
    async function handleAgentStatus(params) {
        try {
            const { agentId } = params || {};
            if (!agentId) {
                return { success: false, error: 'agentId is required' };
            }

            const backendUrl = getBackendUrl();
            const token = await getAuthToken();
            
            if (!token) {
                return { success: false, error: 'Not authenticated' };
            }

            const response = await fetch(`${backendUrl}/agent/status?agentId=${encodeURIComponent(agentId)}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[web-shim] Agent status check failed:', response.status, errorText);
                return { success: false, error: `Backend error: ${response.status}` };
            }

            const result = await response.json();
            return { success: true, ...result };
        } catch (e) {
            console.error('[web-shim] Agent status error:', e);
            // Check if it's a connection refused error
            if (e.message?.includes('Failed to fetch') || e.message?.includes('ECONNREFUSED')) {
                return { 
                    success: false, 
                    online: false,
                    error: 'Backend server not available. Agent status cannot be checked.' 
                };
            }
            return { success: false, online: false, error: e.message || 'Failed to check agent status' };
        }
    }

    // Handle agent connect via backend API
    async function handleAgentConnect(params) {
        try {
            const { agentId } = params || {};
            if (!agentId) {
                return { success: false, error: 'agentId is required' };
            }

            const backendUrl = getBackendUrl();
            const token = await getAuthToken();
            
            if (!token) {
                return { success: false, error: 'Not authenticated' };
            }

            const response = await fetch(`${backendUrl}/agent/connect`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ agentId })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[web-shim] Agent connect failed:', response.status, errorText);
                return { success: false, error: `Backend error: ${response.status} - ${errorText || 'Unknown error'}` };
            }

            const result = await response.json();
            return { success: true, ...result };
        } catch (e) {
            console.error('[web-shim] Agent connect error:', e);
            // Check if it's a connection refused error
            if (e.message?.includes('Failed to fetch') || e.message?.includes('ECONNREFUSED')) {
                return { 
                    success: false, 
                    error: 'Backend server not available. Cannot connect to agent.' 
                };
            }
            return { success: false, error: e.message || 'Failed to connect to agent' };
        }
    }

    // Helper to get auth token from various sources
    async function getAuthToken() {
        // Try direct localStorage keys first
        let token = localStorage.getItem('sb-token') || localStorage.getItem('supabase.auth.token');
        if (token) return token;
        
        // Try to get from Supabase session
        try {
            if (window.supabase && window.supabase.auth) {
                const { data } = await window.supabase.auth.getSession();
                if (data?.session?.access_token) {
                    return data.session.access_token;
                }
            }
        } catch (e) {
            console.warn('[web-shim] Failed to get token from Supabase:', e);
        }
        
        return null;
    }

    // Helper to get current server ID
    function getCurrentServerId() {
        // Try to get from global state
        if (window.connectedServerData && window.connectedServerData.id) {
            return window.connectedServerData.id;
        }
        return null;
    }

    // Handle agent command execution
    async function handleAgentExec(command) {
        try {
            const serverId = getCurrentServerId();
            if (!serverId) {
                return { success: false, error: 'No server connected', stdout: '', stderr: '', code: 1 };
            }

            const backendUrl = getBackendUrl();
            const token = await getAuthToken();
            
            if (!token) {
                return { success: false, error: 'Not authenticated', stdout: '', stderr: '', code: 1 };
            }

            const response = await fetch(`${backendUrl}/agent/exec`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ serverId, command })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[web-shim] Agent exec failed:', response.status, errorText);
                return { 
                    success: false, 
                    error: `Backend error: ${response.status}`,
                    stdout: '',
                    stderr: errorText || 'Unknown error',
                    code: 1
                };
            }

            const result = await response.json();
            return result;
        } catch (e) {
            console.error('[web-shim] Agent exec error:', e);
            return { 
                success: false, 
                error: e.message || 'Failed to execute command',
                stdout: '',
                stderr: e.message || 'Unknown error',
                code: 1
            };
        }
    }

    // Handle agent stats retrieval
    async function handleAgentStats() {
        try {
            const serverId = getCurrentServerId();
            if (!serverId) {
                return { success: false, error: 'No server connected' };
            }

            const backendUrl = getBackendUrl();
            const token = await getAuthToken();
            
            if (!token) {
                return { success: false, error: 'Not authenticated' };
            }

            const response = await fetch(`${backendUrl}/agent/stats`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ serverId })
            });

            if (!response.ok) {
                const errorText = await response.text();
                console.error('[web-shim] Agent stats failed:', response.status, errorText);
                return { 
                    success: false, 
                    error: `Backend error: ${response.status}`
                };
            }

            const result = await response.json();
            return result;
        } catch (e) {
            console.error('[web-shim] Agent stats error:', e);
            return { 
                success: false, 
                error: e.message || 'Failed to get stats'
            };
        }
    }

    // Helper to get auth token from various sources
    async function getAuthToken() {
        // Try direct localStorage keys first
        let token = localStorage.getItem('sb-token') || localStorage.getItem('supabase.auth.token');
        if (token) return token;
        
        // Try to get from Supabase session
        try {
            const supabaseSession = localStorage.getItem('sb-psnrofnlgpqkfprjrbnm-auth-token');
            if (supabaseSession) {
                const session = JSON.parse(supabaseSession);
                token = session?.access_token || session?.provider_token;
                if (token) return token;
            }
        } catch (e) {
            console.warn('[web-shim] Failed to parse Supabase session:', e);
        }
        
        return null;
    }

    // Event Polling Loop (disabled when API not available)
    let pollingEnabled = true;
    setInterval(async () => {
        if (!pollingEnabled || !apiAvailable) return;
        try {
            const response = await fetch('/api/events');
            if (!response.ok) {
                if (response.status === 404) {
                    pollingEnabled = false;
                    apiAvailable = false;
                }
                return;
            }
            const json = await response.json();
            if (json.success && json.events) {
                json.events.forEach(event => {
                    if (listeners[event.channel]) {
                        listeners[event.channel].forEach(cb => {
                            // In Electron, the first arg is 'event'
                            cb({ sender: ipcRenderer }, ...event.args);
                        });
                    }
                });
            }
        } catch (e) {
            // Silently ignore polling errors
        }
    }, 500);

    const shell = {
        openExternal: function(url) { window.open(url, '_blank'); }
    };

    // Mock process for browser
    window.process = {
        env: { NODE_ENV: 'production' },
        platform: 'web',
        nextTick: (cb) => setTimeout(cb, 0),
        versions: { node: '20.0.0' }
    };

    // Expose as window.electronAPI for newer components
    window.electronAPI = {
        getBackendUrl: () => ipcRenderer.invoke('monitoring:get-backend-url'),
        getToken: () => ipcRenderer.invoke('auth:get-token'),
        setAlwaysOnTop: (value) => ipcRenderer.invoke('monitoring:set-always-on-top', value),
        onServerConnected: (callback) => ipcRenderer.on('monitoring:server-connected', (event, serverId) => callback(serverId)),
        onStatsUpdate: (callback) => ipcRenderer.on('monitoring:stats-update', (event, data) => callback(data))
    };

    // Keep window.require for legacy support
    window.require = function(module) {
        if (module === 'electron') {
            return {
                ipcRenderer,
                shell
            };
        }
        
        if (module === '@supabase/supabase-js') {
            // Expose supabase from CDN (injected in head)
            return window.supabase;
        }
        
        // Provide basic functional mocks for common node built-ins requested by client code
        if (module === 'path') return { join: (...args) => args.join('/') };
        if (module === 'fs') return { 
            readFileSync: () => '', 
            writeFileSync: () => {},
            existsSync: () => false,
            appendFileSync: () => {}
        };
        if (module === 'os') return { platform: () => 'web' };
        
        console.warn(`Mock plugin returning empty object for requested module: ${module}`);
        return {};
    };
})();
