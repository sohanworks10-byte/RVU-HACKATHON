const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let monitoringWindow = null;
let monitoringTmuxSession = null;

// TMUX session name for monitoring
const TMUX_SESSION_NAME = 'devyntra-monitoring';

/**
 * Get the backend base URL - always use Railway production
 */
function getMonitoringBackendUrl() {
    // Always use Railway production backend for monitoring
    return 'https://devyntra-backend-api-production.up.railway.app';
}

/**
 * Create a dedicated monitoring window that loads fast
 */
function createMonitoringWindow() {
    if (monitoringWindow && !monitoringWindow.isDestroyed()) {
        monitoringWindow.focus();
        return monitoringWindow;
    }

    monitoringWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1200,
        minHeight: 700,
        title: 'AlphaOps - Server Monitoring',
        backgroundColor: '#f9fafb',
        show: false, // Start hidden, show when ready
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            preload: path.join(__dirname, 'monitoring-preload.js')
        },
        // Keep window on top for monitoring visibility
        alwaysOnTop: false,
        // Allow minimizing but not accidentally closing
        skipTaskbar: false
    });

    // Load the dedicated monitoring page (lightweight, fast loading)
    monitoringWindow.loadFile('monitoring-standalone.html');

    // Show when ready to prevent white screen
    monitoringWindow.once('ready-to-show', () => {
        monitoringWindow.show();
        monitoringWindow.maximize();
    });

    // Handle window close - hide instead of destroy to keep session alive
    monitoringWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            monitoringWindow.hide();
            console.log('[Monitoring] Window hidden (tmux session keeps running)');
        }
    });

    monitoringWindow.on('closed', () => {
        monitoringWindow = null;
    });

    return monitoringWindow;
}

/**
 * Show/hide monitoring window
 */
function toggleMonitoringWindow() {
    if (!monitoringWindow || monitoringWindow.isDestroyed()) {
        createMonitoringWindow();
    } else if (monitoringWindow.isVisible()) {
        monitoringWindow.hide();
    } else {
        monitoringWindow.show();
        monitoringWindow.focus();
    }
}

/**
 * Initialize monitoring IPC handlers
 */
function initMonitoringIPC() {
    // Get backend URL for monitoring
    ipcMain.handle('monitoring:get-backend-url', () => {
        return { 
            success: true, 
            url: getMonitoringBackendUrl(),
            session: TMUX_SESSION_NAME 
        };
    });

    // Toggle monitoring window visibility
    ipcMain.handle('monitoring:toggle', () => {
        toggleMonitoringWindow();
        return { success: true, visible: monitoringWindow?.isVisible() || false };
    });

    // Show monitoring window
    ipcMain.handle('monitoring:show', () => {
        if (!monitoringWindow || monitoringWindow.isDestroyed()) {
            createMonitoringWindow();
        } else {
            monitoringWindow.show();
            monitoringWindow.focus();
        }
        return { success: true };
    });

    // Hide monitoring window (keeps tmux session alive)
    ipcMain.handle('monitoring:hide', () => {
        if (monitoringWindow && !monitoringWindow.isDestroyed()) {
            monitoringWindow.hide();
        }
        return { success: true };
    });

    // Check if monitoring window is active
    ipcMain.handle('monitoring:status', () => {
        return { 
            success: true, 
            active: !!monitoringWindow && !monitoringWindow.isDestroyed(),
            visible: monitoringWindow?.isVisible() || false,
            session: TMUX_SESSION_NAME
        };
    });
}

/**
 * Cleanup monitoring on app quit
 */
function cleanupMonitoring() {
    app.isQuitting = true;
    if (monitoringWindow && !monitoringWindow.isDestroyed()) {
        monitoringWindow.destroy();
    }
}

module.exports = {
    createMonitoringWindow,
    toggleMonitoringWindow,
    initMonitoringIPC,
    cleanupMonitoring,
    TMUX_SESSION_NAME,
    getMonitoringBackendUrl
};
