// Web version shim for Electron/Main.js APIs
(function() {
    const listeners = {};
    const ipcRenderer = {
        invoke: async function(channel, ...args) {
            try {
                const response = await fetch('/api/rpc', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, args })
                });
                if (!response.ok) {
                    throw new Error(`HTTP error ${response.status}`);
                }
                const json = await response.json();
                if (json.success) return json.data;
                throw new Error(json.error || 'Unknown RPC error');
            } catch (e) {
                console.error('IPC invoke error', channel, e);
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

    // Event Polling Loop
    setInterval(async () => {
        try {
            const response = await fetch('/api/events');
            if (response.ok) {
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

    // Global exposure to fix direct references in index.html
    window.ipcRenderer = ipcRenderer;
    window.shell = shell;

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
