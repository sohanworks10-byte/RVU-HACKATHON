const { contextBridge, ipcRenderer } = require('electron');

// Expose API to the monitoring window
contextBridge.exposeInMainWorld('electronAPI', {
    // Get backend URL from main process
    getBackendUrl: () => ipcRenderer.invoke('monitoring:get-backend-url'),
    
    // Get current auth token
    getToken: () => ipcRenderer.invoke('auth:get-token'),
    
    // Set always on top
    setAlwaysOnTop: (value) => ipcRenderer.invoke('monitoring:set-always-on-top', value),
    
    // Listen for server connection events
    onServerConnected: (callback) => {
        ipcRenderer.on('monitoring:server-connected', (event, serverId) => callback(serverId));
    },
    
    // Listen for stats updates from main process
    onStatsUpdate: (callback) => {
        ipcRenderer.on('monitoring:stats-update', (event, data) => callback(data));
    }
});
