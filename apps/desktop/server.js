const express = require('express');
const bodyParser = require('body-parser');
const http = require('http');
const path = require('path');
const fs = require('fs');
const Module = require('module');

// Create data directory if it doesn't exist
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const expressApp = express();
expressApp.use(bodyParser.json({ limit: '50mb' }));
expressApp.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// Request logging and cache busting
expressApp.use((req, res, next) => {
    console.log(`[Web Server] ${req.method} ${req.url}`);
    
    // Disable caching for all responses
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    
    next();
});

// MOCK ELECTRON API for main.js
// MOCK ELECTRON API for main.js
const eventQueue = [];
const mockIpcHandlers = {};

const mockElectron = {
    app: {
        getPath: () => path.join(__dirname, 'data'),
        commandLine: { appendSwitch: () => {} },
        setAsDefaultProtocolClient: () => {},
        requestSingleInstanceLock: () => true,
        quit: () => { console.log('Mock app.quit() called'); process.exit(0); },
        on: (event, handler) => {
            // Instantly resolve ready so main.js continues executing
            if (event === 'ready') setTimeout(handler, 50);
            if (event === 'window-all-closed') {}
            if (event === 'activate') {}
        },
        whenReady: () => Promise.resolve(),
        isQuitting: false,
        disableHardwareAcceleration: () => {},
        setAppUserModelId: () => {}
    },
    BrowserWindow: class {
        constructor() { 
            this.webContents = { 
                send: (channel, ...args) => { 
                    console.log('[Web Server] Pushing EVENT to queue:', channel);
                    eventQueue.push({ channel, args });
                },
                setWindowOpenHandler: () => {},
                on: () => {},
                loadURL: () => {},
                loadFile: () => {}
            }; 
        }
        loadFile() {}
        loadURL() {}
        show() {}
        focus() {}
        maximize() {}
        unmaximize() {}
        minimize() {}
        restore() {}
        close() {}
        hide() {}
        once(ev, cb) { if(ev==='ready-to-show') setTimeout(cb, 50); }
        on() {}
        isDestroyed() { return false; }
    },
    ipcMain: {
        handle: (channel, handler) => {
            console.log('[Web Server] Registered IPC handle:', channel);
            mockIpcHandlers[channel] = handler;
        },
        on: (channel, handler) => {
            console.log('[Web Server] Registered IPC on:', channel);
            mockIpcHandlers[channel] = handler;
        },
        removeHandler: (channel) => {
            console.log('[Web Server] Removed IPC handle:', channel);
            delete mockIpcHandlers[channel];
        }
    },
    shell: {
        openExternal: (...args) => console.log('Mock shell.openExternal', ...args)
    },
    dialog: {
        showOpenDialog: async () => ({ canceled: true }),
        showMessageBox: async () => {}
    }
};

// Hook require BEFORE loading main.js
const originalRequire = Module.prototype.require;
Module.prototype.require = function(mod) {
    if (mod === 'electron') {
        return mockElectron;
    }
    return originalRequire.apply(this, arguments);
};

// Load main.js, this will register all the ipcMain.handle endpoints automatically!
try {
    require('./main.js');
    console.log('[Web Server] main.js loaded successfully. Registered RPC endpoints:', Object.keys(mockIpcHandlers).length);
} catch (e) {
    console.error('[Web Server] Failed to load main.js:', e);
}

// REST route for RPC
expressApp.head('/api/rpc', (req, res) => {
    res.status(200).end();
});

expressApp.post('/api/rpc', async (req, res) => {
    const { channel, args } = req.body;
    if (mockIpcHandlers[channel]) {
        try {
            // We pass a mock 'event' object that can send messages back to the client
            const mockEvent = { 
                sender: { 
                    send: (channel, ...args) => {
                        console.log('[Web Server] RPC callback push:', channel);
                        eventQueue.push({ channel, args });
                    } 
                } 
            };
            // Ensure args is always an array
            const callArgs = Array.isArray(args) ? args : (args ? [args] : []);
            
            const result = await mockIpcHandlers[channel](mockEvent, ...callArgs);
            res.json({ success: true, data: result });
        } catch (e) {
            console.error('[RPC Error]', channel, e);
            res.json({ success: false, error: e.message || String(e) });
        }
    } else {
        res.status(404).json({ success: false, error: `Channel not found: ${channel}` });
    }
});

// Polling endpoint for events (logs, etc)
expressApp.get('/api/events', (req, res) => {
    const events = eventQueue.splice(0, eventQueue.length);
    res.json({ success: true, events });
});

// Serve frontend routing
const staticPublic = path.join(__dirname, '.');

// Custom routes to match HTML files
expressApp.get('/', (req, res) => res.sendFile(path.join(staticPublic, 'splash.html')));
expressApp.get('/dashboard', (req, res) => res.sendFile(path.join(staticPublic, 'index.html')));
expressApp.get('/auth', (req, res) => res.sendFile(path.join(staticPublic, 'auth.html')));
expressApp.get('/monitoring', (req, res) => res.sendFile(path.join(staticPublic, 'monitoring-modern.html')));
expressApp.get('/splash', (req, res) => res.sendFile(path.join(staticPublic, 'splash.html')));

// Serve the rest as static files
expressApp.use(express.static(staticPublic));

// Catch all for single-page app
expressApp.get('*', (req, res) => {
    res.sendFile(path.join(staticPublic, 'index.html'));
});

const server = http.createServer(expressApp);
const port = process.env.PORT || 3000;

server.listen(port, () => {
    console.log(`\n========================================`);
    console.log(`   WEB VERSION RUNNING                  `);
    console.log(`========================================`);
    console.log(`Open http://localhost:${port} in the browser`);
});
