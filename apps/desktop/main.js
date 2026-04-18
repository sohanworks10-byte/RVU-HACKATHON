const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');

const path = require('path');

const fs = require('fs');

const os = require('os');

const https = require('https');

const DEFAULT_SECURITY_SETTINGS = {
    devai: {
        storageMode: 'minimal_cloud', // 'minimal_cloud' | 'local_only'
        retentionDays: 14,
        redactSecrets: true,
        readOnlyMode: true,
        requireManualApproval: true,
        allowlist: [],
        denylist: [
            'rm -rf /',
            'mkfs',
            'dd if=',
            'curl | bash',
            'wget | sh',
            'chmod 777',
            'chown -R',
            'useradd',
            'passwd',
            'iptables',
            'ufw disable',
        ],
    },
    selfHost: {
        enabled: false,
        supabaseUrl: '',
        supabaseAnonKey: '',
    },
    meta: {
        schemaVersion: 1,
        acceptedDisclaimer: false,
    },
};

function getUserDataPaths() {
    const base = app.getPath('userData');
    return {
        base,
        securitySettingsPath: path.join(base, 'security-settings.json'),
        devaiHistoryPath: path.join(base, 'devai-history.jsonl'),
        devaiAuditPath: path.join(base, 'devai-audit.jsonl'),
    };
}

function deepMerge(a, b) {
    if (!b || typeof b !== 'object') return a;
    const out = Array.isArray(a) ? a.slice() : { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
            out[k] = deepMerge(out[k], v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

function loadSecuritySettings() {
    const { securitySettingsPath } = getUserDataPaths();
    try {
        if (!fs.existsSync(securitySettingsPath)) {
            return DEFAULT_SECURITY_SETTINGS;
        }
        const raw = fs.readFileSync(securitySettingsPath, 'utf8');
        const parsed = raw ? JSON.parse(raw) : {};
        return deepMerge(DEFAULT_SECURITY_SETTINGS, parsed);
    } catch (e) {
        console.error('[security] failed to load settings:', e);
        return DEFAULT_SECURITY_SETTINGS;
    }
}

function saveSecuritySettings(next) {
    const { securitySettingsPath } = getUserDataPaths();
    const merged = deepMerge(DEFAULT_SECURITY_SETTINGS, next || {});
    try {
        fs.writeFileSync(securitySettingsPath, JSON.stringify(merged, null, 2), 'utf8');
    } catch (e) {
        console.error('[security] failed to save settings:', e);
        throw e;
    }
    return merged;
}

function jsonlAppend(filePath, obj) {
    const line = JSON.stringify(obj) + '\n';
    fs.appendFileSync(filePath, line, 'utf8');
}

function jsonlReadAll(filePath, maxLines = 5000) {
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf8');
    if (!raw) return [];
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const tail = lines.slice(Math.max(0, lines.length - maxLines));
    const out = [];
    for (const ln of tail) {
        try {
            out.push(JSON.parse(ln));
        } catch (e) {
        }
    }
    return out;
}

function applyRetention(filePath, retentionDays) {
    if (!fs.existsSync(filePath)) return;
    const days = Number(retentionDays);
    if (!Number.isFinite(days) || days <= 0) return;

    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const kept = [];
    for (const ln of lines) {
        try {
            const obj = JSON.parse(ln);
            const ts = new Date(obj.ts || obj.created_at || obj.time || 0).getTime();
            if (Number.isFinite(ts) && ts >= cutoff) kept.push(JSON.stringify(obj));
        } catch (e) {
        }
    }
    fs.writeFileSync(filePath, kept.join('\n') + (kept.length ? '\n' : ''), 'utf8');
}

// Globally bypass strict SSL validation for Electron native fetch (fixes Railway reverse proxy SSL mismatches)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
app.commandLine.appendSwitch('ignore-certificate-errors');

const { ApiClient } = require('@AlphaOps/api-client');

const { COMMANDS } = require('./ssh-client');



let mainWindow;

let splashWindow;



let currentAccessToken = null;

let cachedSupabaseSession = null; // For cross-page session persistence



function getDesktopBackendBaseUrl() {

    const envUrl = process.env.AlphaOps_BACKEND_URL || process.env.BACKEND_URL;

    if (envUrl && typeof envUrl === 'string') {

        const cleaned = String(envUrl).trim().replace(/\/+$/, '');

        if (cleaned.startsWith('http://localhost:')) {

            return cleaned.replace('http://localhost:', 'http://127.0.0.1:');

        }

        if (cleaned === 'http://localhost') {

            return 'http://127.0.0.1';

        }

        return cleaned;

    }



    // Fallbacks (remove or override via AlphaOps_BACKEND_URL env)

    return 'https://AlphaOps-global-20260203.onrender.com';
}



const DESKTOP_BACKEND_BASE_URL = getDesktopBackendBaseUrl();

const apiClient = new ApiClient({ baseUrl: DESKTOP_BACKEND_BASE_URL });

console.log('Desktop backend base URL:', DESKTOP_BACKEND_BASE_URL);

// SSH client
const sshClient = {

    isConnected: false,
    connectionType: null, // 'ssh' or 'agent'
    baseUrl: null, // Store the correct base URL for this connection

    async connect(config) {

        const payload = { ...(config || {}) };

        if (this.isConnected) {

            try {

                apiClient.setToken(currentAccessToken);

                await apiClient.disconnect();

            } catch (e) {

            }

            this.isConnected = false;

        }

        const host = payload && payload.host ? String(payload.host).trim() : '';

        if (host.startsWith('agent:')) {
            const agentId = host.replace(/^agent:/, '').trim();
            if (!agentId) {
                throw new Error('Invalid agent id');
            }
            this.connectionType = 'agent';
            this.baseUrl = DESKTOP_BACKEND_BASE_URL;
            apiClient.setBaseUrl(this.baseUrl);
            apiClient.setToken(currentAccessToken);
            const result = await apiClient.connectAgent(agentId);
            this.isConnected = true;
            return result;
        }

        this.connectionType = 'ssh';
        this.baseUrl = 'http://127.0.0.1:4000';
        apiClient.setBaseUrl(this.baseUrl);

        if (payload.privateKeyPath && !payload.privateKey) {
            try {
                payload.privateKey = fs.readFileSync(payload.privateKeyPath, 'utf8');
            } catch (e) {
                throw new Error(`Failed to read private key: ${e.message}`);
            }
            delete payload.privateKeyPath;
        }



        apiClient.setToken(currentAccessToken);

        const result = await apiClient.connect(payload);

        this.isConnected = true;

        return result;

    },



    async disconnect() {

        apiClient.setToken(currentAccessToken);

        await apiClient.disconnect();

        this.isConnected = false;

        return { success: true };

    },



    async exec(command) {

        if (!this.isConnected) {

            throw new Error('Not connected');

        }

        // Always set the correct base URL before making requests
        if (this.baseUrl) {
            apiClient.setBaseUrl(this.baseUrl);
        }

        apiClient.setToken(currentAccessToken);

        const result = await apiClient.execute(command);

        if (result && result.success === false) {

            throw new Error(result.error || 'Request failed');

        }

        return result;

    },



    async readFile(remotePath) {

        if (!this.isConnected) {

            throw new Error('Not connected');

        }



        apiClient.setToken(currentAccessToken);

        const result = await apiClient.readFile(remotePath);

        if (result && result.success === false) {

            throw new Error(result.error || 'Request failed');

        }

        return result.content;

    },



    async writeFile(remotePath, content) {

        if (!this.isConnected) {

            throw new Error('Not connected');

        }



        apiClient.setToken(currentAccessToken);

        const base64 = Buffer.from(String(content ?? ''), 'utf8').toString('base64');

        const result = await apiClient.writeFile(remotePath, { base64 });

        if (result && result.success === false) {

            throw new Error(result.error || 'Request failed');

        }

        return true;

    },



    async uploadFile(localPath, remotePath) {

        if (!this.isConnected) {

            throw new Error('Not connected');

        }



        const buf = fs.readFileSync(localPath);

        const base64 = buf.toString('base64');

        apiClient.setToken(currentAccessToken);

        const result = await apiClient.uploadFile(remotePath, base64);

        if (result && result.success === false) {

            throw new Error(result.error || 'Request failed');

        }

        return true;

    },

};



const SUPABASE_URL = 'https://psnrofnlgpqkfprjrbnm.supabase.co';

const ICON_URL = 'https://xnlmfbnwyqxownvhsqoz.supabase.co/storage/v1/object/public/files/cropped_circle_image.png';

const ICON_PATH = path.join(__dirname, 'icon.png');



// Download icon function

function downloadIcon() {

    return new Promise((resolve, reject) => {

        if (fs.existsSync(ICON_PATH)) {

            resolve(ICON_PATH);

            return;

        }



        const file = fs.createWriteStream(ICON_PATH);

        https.get(ICON_URL, (response) => {

            response.pipe(file);

            file.on('finish', () => {

                file.close();

                resolve(ICON_PATH);

            });

        }).on('error', (err) => {

            fs.unlink(ICON_PATH, () => { });

            reject(err);

        });

    });

}



// --- CRASH PREVENTION ---

process.on('uncaughtException', (error) => {

    console.error('CRITICAL ERROR (Uncaught):', error);

    // Keep app alive

});



// --- DEEP LINKING CONFIGURATION ---

const PROTOCOL = 'AlphaOps';



// Standard Registration

if (process.defaultApp) {

    if (process.argv.length >= 2) {

        app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);

    }

} else {

    app.setAsDefaultProtocolClient(PROTOCOL);

}



// FORCE REGISTRY FIX FOR WINDOWS (Handles Spaces in Path)

// Electron's setAsDefaultProtocolClient is buggy with spaces in dev mode.

if (process.platform === 'win32' && process.defaultApp) {

    const { exec } = require('child_process');

    const appPath = path.resolve(__dirname);

    const exe = process.execPath;



    // We wait 1s to ensure Electron has finished its attempt, then overwrite it.

    setTimeout(() => {

        // 1. Set Protocol Description (Helpful, though Browser often uses Exe name)

        const keyRoot = `HKCU\\Software\\Classes\\${PROTOCOL}`;

        const cmdRoot = `reg add "${keyRoot}" /ve /d "URL:AlphaOps Application" /f`;

        exec(cmdRoot, (err) => {

            if (err) console.error("Reg Root Error:", err);

        });



        // 2. Set Command Line (Target Value: "electron.exe" "app_path_with_spaces" "%1")

        // We must escape quotes for the 'reg' command

        const keyCommand = `HKCU\\Software\\Classes\\${PROTOCOL}\\shell\\open\\command`;

        // The Value string itself needs escaped quotes: \"path\" \"arg\"

        const val = `\\"${exe}\\" \\"${appPath}\\" \\"%1\\"`;



        const cmd = `reg add "${keyCommand}" /ve /d "${val}" /f`;



        console.log("Applying Registry Fix for Spaces...");

        exec(cmd, (error) => {

            if (error) console.error('Registry Fix Error:', error);

            else console.log('Registry Key Fixed Successfully');

        });

    }, 1000);

}

const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnJvZm5sZ3Bxa2ZwcmpyYm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNDYyMzksImV4cCI6MjA4MzYyMjIzOX0.oYlLKiEI7cO03H4IGyMV0r2HqJYo30tadfnl-XZZZMI';



// Cache for API keys fetched from Supabase

let cachedGeminiKey = null;





// --- COMMAND LOGGING INTERCEPTOR ---

// Wraps sshClient.exec to emit 'ssh:log-event' for every command

// Excludes noisy stats polling commands to prevent log flooding

const originalExec = sshClient.exec.bind(sshClient);

sshClient.exec = async (command) => {

    const normalizedCommand = (typeof command === 'string')

        ? command

        : (command && typeof command.command === 'string')

            ? command.command

            : String(command ?? '');



    // Check for noisy status commands to exclude from logs

    const isStats = (

        normalizedCommand.includes('uptime -p') ||

        normalizedCommand.includes('top -bn2') ||

        normalizedCommand.includes('free -m') ||

        normalizedCommand.includes('df -h /') ||

        normalizedCommand.includes('cat /etc/os-release') ||

        normalizedCommand.includes('systemctl is-active') || // Often polled for app details

        normalizedCommand.includes('systemctl is-enabled') || // Polled for autostart check

        normalizedCommand.includes('pm2 jlist') ||           // Polled for PM2 status

        normalizedCommand.includes('> ~/.AlphaOps/apps.json') // Internal DB save

    );



    try {

        const result = await originalExec(normalizedCommand);



        if (!isStats && mainWindow && !mainWindow.isDestroyed()) {

            // Send log to UI

            mainWindow.webContents.send('ssh:log-event', {

                cmd: normalizedCommand,

                success: (result.code === 0)

            });

        }

        return result;

    } catch (err) {

        if (!isStats && mainWindow && !mainWindow.isDestroyed()) {

            mainWindow.webContents.send('ssh:log-event', {

                cmd: normalizedCommand,

                success: false

            });

        }

        throw err;

    }

};



function createWindow() {

    mainWindow = new BrowserWindow({

        width: 1366,

        height: 768,

        minWidth: 1024,

        minHeight: 700,

        icon: ICON_PATH,

        webPreferences: {

            nodeIntegration: true,

            contextIsolation: false // Allowed for this local tool as per request

        },

        title: "AlphaOps - DevOps Control Center",

        autoHideMenuBar: true,

        backgroundColor: '#f9fafb',

        show: false // Start hidden for splash screen sync

    });



    mainWindow.loadFile('auth.html');



    // Open external links in browser

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {

        if (url.startsWith('http:') || url.startsWith('https:')) {

            shell.openExternal(url);

            return { action: 'deny' };

        }

        return { action: 'allow' };

    });

}



// Single Instance Lock (Essential for Deep Linking on Windows)

const gotTheLock = app.requestSingleInstanceLock();



if (!gotTheLock) {

    app.quit();

} else {

    app.on('second-instance', (event, commandLine, workingDirectory) => {

        // Someone tried to run a second instance, we should focus our window.

        if (mainWindow) {

            if (mainWindow.isMinimized()) mainWindow.restore();

            mainWindow.focus();

        }



        // Handle Deep Link on Windows

        // commandLine looks like: [path_to_exe, "AlphaOps://..."]

        const url = commandLine.find(arg => arg.startsWith(PROTOCOL + '://'));

        if (url) handleDeepLink(url);

    });



    app.whenReady().then(() => {

        createSplashWindow();

        createWindow();



        // High-end Splash logic: Wait for main window to be ready + minimum delay

        setTimeout(() => {

            if (splashWindow && !splashWindow.isDestroyed()) {

                splashWindow.close();

            }

            if (mainWindow && !mainWindow.isDestroyed()) {

                mainWindow.maximize();

                mainWindow.show();

                mainWindow.focus();

                // If it's the dashboard (auto-logged in), the skeletons will play there

                // We notify the renderer that the splash window is done if needed

            }

        }, 5000); // 5 seconds of premium splash



        app.on('activate', function () {

            if (BrowserWindow.getAllWindows().length === 0) createWindow();

        });

    });

}



function createSplashWindow() {

    splashWindow = new BrowserWindow({

        width: 450,

        height: 550,

        frame: false,

        transparent: true,

        alwaysOnTop: true,

        center: true,

        show: false, // Create hidden then show to prevent white flash

        icon: ICON_PATH,

        webPreferences: {

            nodeIntegration: true,

            contextIsolation: false

        }

    });



    splashWindow.loadFile('splash.html');

    splashWindow.once('ready-to-show', () => {

        splashWindow.show();

    });

}



// Handle Deep Link on macOS

app.on('open-url', (event, url) => {

    event.preventDefault();

    handleDeepLink(url);

});



// Deep Link Logic

function handleDeepLink(url) {

    console.log("Received Deep Link:", url);

    if (!mainWindow) return;



    // Parse URL params (Supabase returns access_token in the hash OR query params)

    // Structure: AlphaOps://auth/callback#access_token=...&refresh_token=...

    // Or: AlphaOps://auth/callback?code=... (PKCE)



    // We send the raw URL to renderer to handle parsing using Supabase client or manual regex

    mainWindow.webContents.send('supabase:auth-callback', url);

}



// --- AUTH BRIDGE SERVER (Localhost:3000) ---

// This handles the case where Supabase redirects to localhost:3000 (default/fallback)

// instead of the custom protocol directly.

const http = require('http');



const authServer = http.createServer((req, res) => {

    // We only care about the client-side hash,    // Serves a nice page that triggers the Deep Link

    res.writeHead(200, { 'Content-Type': 'text/html' });

    res.end(`

        <!DOCTYPE html>

        <html>

        <head>

            <title>Redirecting to AlphaOps...</title>

            <style>

                body {

                    background: #0f172a;

                    color: white;

                    display: flex;

                    flex-direction: column;

                    align-items: center;

                    justify-content: center;

                    height: 100vh;

                    font-family: 'Segoe UI', system-ui, sans-serif;

                    margin: 0;

                    text-align: center;

                }

                .card {

                    background: rgba(255, 255, 255, 0.05);

                    backdrop-filter: blur(10px);

                    padding: 40px;

                    border-radius: 24px;

                    border: 1px solid rgba(255, 255, 255, 0.1);

                    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);

                    max-width: 400px;

                    width: 90%;

                }

                .loader {

                    width: 48px;

                    height: 48px;

                    border: 4px solid #4f46e5;

                    border-bottom-color: transparent;

                    border-radius: 50%;

                    display: inline-block;

                    box-sizing: border-box;

                    animation: rotation 1s linear infinite;

                    margin-bottom: 24px;

                }

                @keyframes rotation {

                    0% { transform: rotate(0deg); }

                    100% { transform: rotate(360deg); }

                }

                h1 { font-size: 24px; margin: 0 0 12px 0; font-weight: 600; }

                p { color: #94a3b8; font-size: 15px; line-height: 1.5; margin-bottom: 24px; }

                .btn {

                    background: #4f46e5;

                    color: white;

                    border: none;

                    padding: 12px 24px;

                    border-radius: 12px;

                    font-weight: 600;

                    cursor: pointer;

                    text-decoration: none;

                    display: inline-block;

                    transition: background 0.2s;

                    font-size: 14px;

                }

                .btn:hover { background: #4338ca; }

                .secondary-btn {

                    margin-top: 12px;

                    background: transparent;

                    color: #64748b;

                    border: 1px solid #334155;

                }

                .secondary-btn:hover { border-color: #64748b; color: #94a3b8; }

            </style>

        </head>

        <body>

            <div class="card" id="launch-card">

                <span class="loader"></span>

                <h1>Opening AlphaOps...</h1>

                <p>Please click <strong>Open AlphaOps</strong> or <strong>Open Electron</strong> if prompted by your browser to complete the sign-in.</p>

                

                <a id="launch-btn" href="#" class="btn" onclick="showSuccess()">Launch Application</a>

                <br>

                <button onclick="window.close()" class="btn secondary-btn">Close Page</button>

            </div>



            <div class="card" id="success-card" style="display: none; text-align: center;">

                <div style="width: 60px; height: 60px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px;">

                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">

                        <polyline points="20 6 9 17 4 12"></polyline>

                    </svg>

                </div>

                <h1>Success!</h1>

                <p>Authentication complete. You can now close this tab and return to the application.</p>

                <button onclick="window.close()" class="btn">Close Tab</button>

            </div>



            <script>

                // 1. Get the Hash or Query

                const hash = window.location.hash;

                const search = window.location.search;

                

                // 2. Construct Custom Protocol URL

                const appUrl = 'AlphaOps://auth/callback' + search + hash;

                

                // 3. Set Button Action

                document.getElementById('launch-btn').href = appUrl;



                function showSuccess() {

                    document.getElementById('launch-card').style.display = 'none';

                    document.getElementById('success-card').style.display = 'block';

                    document.title = 'Authentication Successful';

                }



                // 4. Auto-Redirect & Show Success

                setTimeout(() => {

                    window.location.href = appUrl;

                    

                    // Show success message after a short delay to allow the prompt to appear

                    setTimeout(showSuccess, 1000); 

                }, 500);

                

                // 5. Auto-Close (Extended)

                setTimeout(() => {

                    // window.close(); // Browsers often block this, better to leave open or user closes

                }, 120000);

            </script>

        </body>

        </html>

        `);

});



authServer.on('error', (e) => {

    if (e.code === 'EADDRINUSE') {

        console.error('Auth Bridge Error: Port 3456 is busy. Deep linking might fail.');

        // Optional: Try another port or notify user, but we'll stick to logging for now

        // as the redirect URL is hardcoded in the renderer.

    } else {

        console.error('Auth Bridge Server Error:', e);

    }

});



authServer.listen(3456, '127.0.0.1', () => {

    console.log('Auth Bridge Server listening on http://127.0.0.1:3456');

});



// Ensure server closes on app quit

app.on('will-quit', () => {

    authServer.close();

});







app.on('window-all-closed', function () {

    if (process.platform !== 'darwin') app.quit();

});



ipcMain.handle('auth:set-token', async (event, token) => {
    console.log('[main] Updating access token. Length:', token ? token.length : 0);
    currentAccessToken = token || null;
    apiClient.setToken(currentAccessToken);
    return { success: true };
});



let lastSessionStore = null;



ipcMain.handle('auth:store-session', async (event, session) => {

    try {
        console.log('[main] Storing session. Token length:', session?.access_token ? session.access_token.length : 0);
        // Debounce: don't store the same session repeatedly

        const sessionKey = session?.access_token?.slice(0, 20);

        if (sessionKey && lastSessionStore === sessionKey) {

            return { success: true, debounced: true };

        }

        lastSessionStore = sessionKey;



        cachedSupabaseSession = session || null;

        if (session?.access_token) {

            currentAccessToken = session.access_token;

            apiClient.setToken(currentAccessToken);

        }

        console.log('[main] Session stored for cross-page persistence');

        return { success: true };

    } catch (e) {

        console.error('[main] Failed to store session:', e);

        return { success: false, error: e.message };

    }

});



ipcMain.handle('auth:get-session', async () => {

    try {

        if (cachedSupabaseSession?.access_token) {

            return {

                success: true,

                session: cachedSupabaseSession

            };

        }

        return { success: false, session: null };

    } catch (e) {

        console.error('[main] Failed to get session:', e);

        return { success: false, error: e.message };

    }

});



ipcMain.handle('auth:get-token', async () => {

    return currentAccessToken;

});

// --- SECURITY / DEVAI SETTINGS + LOCAL STORAGE ---

ipcMain.handle('security:get-settings', async () => {
    try {
        return { success: true, settings: loadSecuritySettings() };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('security:set-settings', async (event, nextSettings) => {
    try {
        const saved = saveSecuritySettings(nextSettings);
        const { devaiHistoryPath, devaiAuditPath } = getUserDataPaths();
        applyRetention(devaiHistoryPath, saved?.devai?.retentionDays);
        applyRetention(devaiAuditPath, saved?.devai?.retentionDays);
        return { success: true, settings: saved };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('devai:history-append', async (event, entry) => {
    try {
        const settings = loadSecuritySettings();
        const { devaiHistoryPath } = getUserDataPaths();
        jsonlAppend(devaiHistoryPath, {
            ts: new Date().toISOString(),
            ...((entry && typeof entry === 'object') ? entry : { text: String(entry ?? '') }),
        });
        applyRetention(devaiHistoryPath, settings?.devai?.retentionDays);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('devai:audit-append', async (event, entry) => {
    try {
        const settings = loadSecuritySettings();
        const { devaiAuditPath } = getUserDataPaths();
        jsonlAppend(devaiAuditPath, {
            ts: new Date().toISOString(),
            ...((entry && typeof entry === 'object') ? entry : { message: String(entry ?? '') }),
        });
        applyRetention(devaiAuditPath, settings?.devai?.retentionDays);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('devai:history-export', async () => {
    try {
        const { devaiHistoryPath } = getUserDataPaths();
        const data = jsonlReadAll(devaiHistoryPath, 20000);
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('devai:audit-export', async () => {
    try {
        const { devaiAuditPath } = getUserDataPaths();
        const data = jsonlReadAll(devaiAuditPath, 20000);
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message };
    }
});



ipcMain.handle('backend:get-base-url', async () => {

    return { success: true, baseUrl: DESKTOP_BACKEND_BASE_URL };

});



// --- IPC HANDLERS FOR SSH ---



// 1. Connect to Server

ipcMain.handle('ssh:connect', async (event, config) => {

    try {

        console.log(`Attempting connection to ${config.host}...`);

        const result = await sshClient.connect(config);



        // GLOBAL FIX: Enable Linger to prevent apps dying on disconnect

        // This fixes "App stops working when I close AlphaOps"

        try {

            const user = config.username || 'root';

            // We don't await this or catch errors strictly to avoid blocking login, 

            // but it's critical for persistence.

            console.log(`Enabling linger for ${user}...`);

            await sshClient.exec(`sudo loginctl enable-linger ${user}`);

        } catch (e) {

            console.log("Linger enable warning (non-fatal):", e.message);

        }



        return { success: true, ...result };

    } catch (err) {

        console.error('SSH Connection Error:', err);

        return { success: false, error: err.message };

    }

});



// 2. Disconnect

ipcMain.handle('ssh:disconnect', async () => {

    try {

        await sshClient.disconnect();

        return { success: true };

    } catch (e) {

        sshClient.isConnected = false;

        return { success: false, error: e.message };

    }

});



ipcMain.handle('agent:enroll', async () => {
    try {
        apiClient.setBaseUrl(DESKTOP_BACKEND_BASE_URL);
        apiClient.setToken(currentAccessToken);
        const result = await apiClient.enrollAgent();
        return { success: true, ...result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});



const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isAptLockError = (res) => {
    const msg = String((res && (res.stderr || res.stdout)) || '').toLowerCase();
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

const execAptWithRetry = async (cmd, { attempts = 20, baseDelayMs = 4000, onRetry = null } = {}) => {
    let last = null;
    
    // Inject non-interactive flags into EVERY apt command
    let finalCmd = cmd;
    if (cmd.includes('apt-get') || cmd.includes('apt ')) {
        const flags = '-o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold" --force-yes -y';
        if (cmd.includes('install')) {
            finalCmd = cmd.replace(/install\s+(-y\s+)?/, `install ${flags} `);
        } else if (cmd.includes('update')) {
            finalCmd = cmd.replace(/update\s+(-y\s+)?/, `update ${flags} `);
        } else if (cmd.includes('remove')) {
            finalCmd = cmd.replace(/remove\s+(-y\s+)?/, `remove ${flags} `);
        }
    }

    for (let i = 0; i < attempts; i++) {
        // Disable apt timers on the first attempt (proactive fix)
        if (i === 0) {
            const disableTimers = `sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true; ` +
                `sudo systemctl disable apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true; ` +
                `sudo systemctl mask apt-daily.service apt-daily-upgrade.service unattended-upgrades.service 2>/dev/null || true`;
            await sshClient.exec(disableTimers).catch(() => {});
        }

        try {
            // Always try to clear locks BEFORE running the command if we are in a retry loop
            if (i > 0) {
                const buster = `sudo pkill -9 -f unattended-upgrade 2>/dev/null || true; sudo pkill -9 apt || true; sudo pkill -9 apt-get || true; sudo pkill -9 dpkg || true; ` +
                    `sudo fuser -k /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/cache/apt/archives/lock 2>/dev/null || true; ` +
                    `sudo rm -f /var/lib/apt/lists/lock /var/cache/apt/archives/lock /var/lib/dpkg/lock /var/lib/dpkg/lock-frontend; ` +
                    `sudo DEBIAN_FRONTEND=noninteractive dpkg --configure -a 2>/dev/null || true`;
                await sshClient.exec(buster).catch(() => {});
            }

            const res = await sshClient.exec(`DEBIAN_FRONTEND=noninteractive ${finalCmd}`);
            last = res;
            if (res && res.code === 0) return res;
            if (!isAptLockError(res)) return res;
        } catch (e) {
            last = { code: -1, stderr: e.message, stdout: '' };
            if (!isAptLockError(last)) throw e;
        }

        const waitMs = baseDelayMs + (i * 2000);
        if (typeof onRetry === 'function') {
            onRetry(`[Attempt ${i + 1}/${attempts}] Server package manager is locked. Forcing lock removal and retrying in ${Math.round(waitMs / 1000)}s...`);
        }
        await sleep(waitMs);
    }
    return last;
};



ipcMain.handle('agent:connect', async (event, payload) => {
    try {
        apiClient.setBaseUrl(DESKTOP_BACKEND_BASE_URL);
        apiClient.setToken(currentAccessToken);
        const id = payload && (payload.agentId || payload.serverId || payload);
        const result = await apiClient.connectAgent(id);
        sshClient.isConnected = true;
        return { success: true, ...result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});



ipcMain.handle('agent:status', async (event, payload) => {

    try {
        apiClient.setBaseUrl(DESKTOP_BACKEND_BASE_URL);
        apiClient.setToken(currentAccessToken);
        const id = payload && (payload.agentId || payload);
        const result = await apiClient.getAgentStatus(id);
        return { success: true, ...result };
    } catch (e) {
        return { success: false, error: e.message };
    }

});



ipcMain.handle('agent:uninstall', async (event, payload) => {

    try {
        apiClient.setBaseUrl(DESKTOP_BACKEND_BASE_URL);
        apiClient.setToken(currentAccessToken);
        const id = payload && (payload.agentId || payload);
        const result = await apiClient.uninstallAgent(id);
        return { success: true, ...result };
    } catch (e) {
        return { success: false, error: e.message };
    }

});



// 2.5 Select Private Key File

ipcMain.handle('ssh:select-key', async () => {

    const result = await dialog.showOpenDialog(mainWindow, {

        title: 'Select Private Key File',

        properties: ['openFile'],

        filters: [

            { name: 'Keys', extensions: ['pem', 'ppk', 'key', 'txt'] },

            { name: 'All Files', extensions: ['*'] }

        ]

    });



    if (result.canceled || result.filePaths.length === 0) {

        return { canceled: true };

    }



    return { path: result.filePaths[0] };

});



// 3. Run Arbitrary Command

ipcMain.handle('ssh:execute', async (event, command) => {

    try {

        const result = await sshClient.exec(command);

        return { success: true, data: result, output: result.stdout || '' };

    } catch (err) {

        return { success: false, error: err.message };

    }

});



// 4. Get Dashboard Stats (Aggregated)

ipcMain.handle('ssh:get-stats', async () => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };



    try {

        const [os, uptime, cpu, ram, disk, diskIo, kernel, ip] = await Promise.all([



            sshClient.exec(COMMANDS.CHECK_OS).catch(() => ({ stdout: 'Unknown' })),

            sshClient.exec(COMMANDS.GET_UPTIME).catch(() => ({ stdout: 'Unknown' })),

            sshClient.exec(COMMANDS.GET_CPU_USAGE).catch(() => ({ stdout: '0' })),

            sshClient.exec(COMMANDS.GET_RAM_USAGE).catch(() => ({ stdout: '0' })),

            sshClient.exec(COMMANDS.GET_DISK_USAGE).catch(() => ({ stdout: '0%' })),

            sshClient.exec(COMMANDS.GET_DISK_IO).catch(() => ({ stdout: '0 0' })),

            sshClient.exec(COMMANDS.GET_KERNEL).catch(() => ({ stdout: 'Unknown' })),

            sshClient.exec(COMMANDS.GET_IP).catch(() => ({ stdout: 'Unknown' })),

        ]);



        return {

            success: true,

            stats: {

                os: os.stdout,

                uptime: uptime.stdout,

                cpu: parseFloat(cpu.stdout) || 0,

                ram: parseFloat(ram.stdout) || 0,

                disk: disk.stdout.replace('%', ''), // strictly number string

                diskIo: diskIo.stdout || "0 0",

                kernel: kernel.stdout,

                ip: ip.stdout

            }

        };

    } catch (err) {

        return { success: false, error: err.message };

    }

});



// 5. Get Service Status

ipcMain.handle('ssh:get-services', async () => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };



    const services = [

        { name: 'Docker', cmd: COMMANDS.CHECK_DOCKER },

        { name: 'Nginx', cmd: COMMANDS.CHECK_NGINX },

        { name: 'Node.js', cmd: COMMANDS.CHECK_NODE } // Just checks version

    ];



    const results = [];

    for (const s of services) {

        try {

            const res = await sshClient.exec(s.cmd);

            // If exit code is 0, it's generally "active" or "installed"

            results.push({ name: s.name, status: res.code === 0 ? 'Running' : 'Stopped/Not Found', output: res.stdout });

        } catch (e) {

            results.push({ name: s.name, status: 'Error', output: e.message });

        }

    }

    return { success: true, services: results };

});



console.log('Registering File System Handlers...');



// 6. List Files (Updated for Absolute Path)

ipcMain.handle('ssh:list-files', async (event, folderPath = '.') => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };



    try {

        let targetPath = folderPath;



        // Resolve absolute path if asking for Home/Current

        if (targetPath === '.' || targetPath === './') {

            const pwdRes = await sshClient.exec(COMMANDS.pwd_cmd);

            if (pwdRes.code === 0) {

                targetPath = pwdRes.stdout.trim();

            }

        }

        // Resolve Tilde (~) to Home Directory - for agent, default to /home/ubuntu

        else if (targetPath.startsWith('~')) {

            let homeDir = '';



            // For agent connections, try /home/ubuntu first

            const isAgent = await sshClient.exec('test -d /home/ubuntu && echo yes');

            if (isAgent.code === 0 && isAgent.stdout.trim() === 'yes') {

                homeDir = '/home/ubuntu';

            }



            // Fallback to other methods if /home/ubuntu doesn't exist

            if (!homeDir) {

                try {

                    const bashHomeRes = await sshClient.exec('bash -lc "echo ~"');

                    if (bashHomeRes.code === 0) homeDir = String(bashHomeRes.stdout || '').trim();

                } catch (e) { }

            }



            if (!homeDir) {

                try {

                    const shHomeRes = await sshClient.exec('sh -lc "echo ~"');

                    if (shHomeRes.code === 0) homeDir = String(shHomeRes.stdout || '').trim();

                } catch (e) { }

            }



            if (!homeDir) {

                try {

                    const homeRes = await sshClient.exec('echo $HOME');

                    if (homeRes.code === 0) homeDir = String(homeRes.stdout || '').trim();

                } catch (e) { }

            }



            if (homeDir) {

                if (targetPath === '~') {

                    targetPath = homeDir;

                } else {

                    targetPath = homeDir + targetPath.substring(1);

                }

            }

        }



        if (!String(targetPath || '').trim()) {

            targetPath = '.';

        }



        // Run ls command

        let response = await sshClient.exec(COMMANDS.list_dir_cmd(targetPath));



        // Auto-retry with sudo if Permission Denied (common for browsing other user homes)

        if (response.code !== 0 && (response.stderr.includes('Permission denied') || response.stderr.includes('permission denied'))) {

            try {

                // Try sudo non-interactive. Works if user is sudoer with NOPASSWD or authenticated session handles it.

                // Note: sshClient.exec might not handle interactive password prompts, so -n is crucial.

                const sudoResponse = await sshClient.exec(`sudo -n ${COMMANDS.list_dir_cmd(targetPath)}`);

                if (sudoResponse.code === 0) {

                    response = sudoResponse;

                }

            } catch (err) {

                // Ignore sudo error and return original error

                console.warn("Sudo retry failed:", err);

            }

        }



        const { stdout, code, stderr } = response;

        if (code !== 0) throw new Error(stderr || 'Listing failed');



        // Helper to format bytes into human-readable size

        const formatSize = (bytes) => {

            const num = parseInt(bytes, 10);

            if (isNaN(num)) return bytes;

            if (num === 0) return '0 B';

            const k = 1024;

            const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

            const i = Math.floor(Math.log(num) / Math.log(k));

            return parseFloat((num / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];

        };



        // Helper to convert 24h time to 12h AM/PM format

        const formatTime = (dateStr) => {

            // Input format: "2026-01-12_14:30" or "2026-01-12_09:15"

            const [datePart, timePart] = dateStr.split('_');

            if (!timePart) return dateStr;



            const [hours24, minutes] = timePart.split(':').map(Number);

            const period = hours24 >= 12 ? 'PM' : 'AM';

            const hours12 = hours24 % 12 || 12;



            // Format: "Jan 12, 2:30 PM"

            const [year, month, day] = datePart.split('-');

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            const monthName = monthNames[parseInt(month, 10) - 1] || month;



            return `${monthName} ${parseInt(day, 10)}, ${hours12}:${String(minutes).padStart(2, '0')} ${period}`;

        };



        // Parse Output

        const files = stdout.split('\n').slice(1) // Skip "total X"

            .map(line => {

                if (!line.trim()) return null;

                // Expected: drwxr-x--- 5 root root 4096 2026-01-12_01:50 .config

                const parts = line.match(/^(\S+)\s+\d+\s+\S+\s+\S+\s+(\S+)\s+(\S+)\s+(.+)$/);

                if (!parts) return null;



                const isDir = parts[1].startsWith('d');

                return {

                    permissions: parts[1],

                    user: 'root', // Simplified

                    size: isDir ? '-' : formatSize(parts[2]),

                    modified: formatTime(parts[3]),

                    name: parts[4],

                    type: isDir ? 'Directory' : 'File',

                    isDirectory: isDir

                };

            })

            .filter(f => f !== null);



        return { success: true, files, path: targetPath };



    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 7. Read File

ipcMain.handle('ssh:read-file', async (event, path) => {

    try {

        const content = await sshClient.readFile(path);

        return { success: true, content };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



ipcMain.handle('local:choose-folder', async () => {

    try {

        const result = await dialog.showOpenDialog({

            properties: ['openDirectory', 'createDirectory'],

        });

        if (result.canceled) return { success: false, canceled: true };

        const folderPath = Array.isArray(result.filePaths) ? result.filePaths[0] : '';

        if (!folderPath) return { success: false, error: 'No folder selected' };

        return { success: true, path: folderPath };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 8. Write File

ipcMain.handle('ssh:write-file', async (event, { path, content }) => {

    try {

        await sshClient.writeFile(path, content);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 9. Upload File

ipcMain.handle('ssh:upload-file', async (event, { localPath, remotePath }) => {

    try {

        await sshClient.uploadFile(localPath, remotePath);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



ipcMain.handle('ssh:download-items', async (event, payload) => {

    if (!sshClient.isConnected) return { success: false, error: 'Not connected' };

    try {

        const localDir = String(payload?.localDir || '').trim();

        const items = Array.isArray(payload?.items) ? payload.items : [];

        if (!localDir) return { success: false, error: 'localDir is required' };

        if (items.length === 0) return { success: false, error: 'No items selected' };



        fs.mkdirSync(localDir, { recursive: true });



        const escapePath = (p) => String(p ?? '').replace(/"/g, '\\"');



        // Single file: download directly

        if (items.length === 1 && !items[0]?.isDirectory) {

            const remotePath = String(items[0]?.path || '').trim();

            const filename = String(items[0]?.name || path.basename(remotePath) || 'download.bin');

            if (!remotePath) return { success: false, error: 'Remote path is required' };



            const b64Res = await sshClient.exec(`base64 -w0 "${escapePath(remotePath)}"`);

            if (!b64Res || b64Res.code !== 0) throw new Error(b64Res?.stderr || 'Download failed');



            const buf = Buffer.from(String(b64Res.stdout || '').trim(), 'base64');

            const outPath = path.join(localDir, filename);

            fs.writeFileSync(outPath, buf);

            return { success: true, files: [outPath] };

        }



        // Multi or folder: tar.gz then download

        const tmpName = `AlphaOps-download-${Date.now()}.tar.gz`;

        const tmpRemote = `/tmp/${tmpName}`;



        const tarInputs = items

            .map((it) => String(it?.path || '').trim())

            .filter(Boolean)

            .map((p) => `"${escapePath(p)}"`)

            .join(' ');

        if (!tarInputs) return { success: false, error: 'No valid remote paths' };



        const tarRes = await sshClient.exec(`tar -czf "${escapePath(tmpRemote)}" ${tarInputs}`);

        if (!tarRes || tarRes.code !== 0) throw new Error(tarRes?.stderr || 'Archive creation failed');



        const b64Res = await sshClient.exec(`base64 -w0 "${escapePath(tmpRemote)}"`);

        await sshClient.exec(`rm -f "${escapePath(tmpRemote)}"`).catch(() => ({}));

        if (!b64Res || b64Res.code !== 0) throw new Error(b64Res?.stderr || 'Archive download failed');



        const buf = Buffer.from(String(b64Res.stdout || '').trim(), 'base64');

        const outPath = path.join(localDir, tmpName);

        fs.writeFileSync(outPath, buf);

        return { success: true, files: [outPath] };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 10. Delete File/Folder

ipcMain.handle('ssh:delete-file', async (event, path) => {

    try {

        const res = await sshClient.exec(COMMANDS.delete_cmd(path));

        if (res.code !== 0) throw new Error(res.stderr);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 11. Rename

ipcMain.handle('ssh:rename-file', async (event, { oldPath, newPath }) => {

    try {

        const res = await sshClient.exec(COMMANDS.rename_cmd(oldPath, newPath));

        if (res.code !== 0) throw new Error(res.stderr);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 11.1 Close Permissions (chmod)

ipcMain.handle('ssh:chmod', async (event, { path, mode, recursive }) => {

    try {

        const cmd = `sudo chmod ${recursive ? '-R ' : ''}${mode} "${path}"`;

        const res = await sshClient.exec(cmd);

        if (res.code !== 0) throw new Error(res.stderr);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 11.2 Change Ownership (chown)

ipcMain.handle('ssh:chown', async (event, { path, owner, group, recursive }) => {

    try {

        const target = group ? `${owner}:${group}` : owner;

        const cmd = `sudo chown ${recursive ? '-R ' : ''}${target} "${path}"`;

        const res = await sshClient.exec(cmd);

        if (res.code !== 0) throw new Error(res.stderr);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 12. Zip File/Folder

ipcMain.handle('ssh:zip-file', async (event, { targetPath, outputPath }) => {

    try {

        const res = await sshClient.exec(COMMANDS.zip_cmd(targetPath, outputPath));

        if (res.code !== 0) throw new Error(res.stderr || 'Zip command failed');

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 13. Unzip Archive

ipcMain.handle('ssh:unzip-file', async (event, { archivePath, destDir }) => {

    try {

        const res = await sshClient.exec(COMMANDS.unzip_cmd(archivePath, destDir));

        if (res.code !== 0) throw new Error(res.stderr || 'Unzip command failed');

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 14. Get System Users & Groups

ipcMain.handle('ssh:get-system-users', async (event) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };



    try {

        const [usersRes, groupsRes] = await Promise.all([

            sshClient.exec("cat /etc/passwd"),

            sshClient.exec("cat /etc/group")

        ]);



        // Parse Users

        const users = usersRes.stdout.split('\n')

            .filter(line => line.trim())

            .map(line => {

                const parts = line.split(':');

                if (parts.length < 7) return null;

                const [username, x, uidStr, gidStr, comment, home, shell] = parts;

                const uid = parseInt(uidStr);

                const gid = parseInt(gidStr);

                // On most Linux distributions, UIDs < 1000 are system users

                const isSystem = uid < 1000 && uid !== 0; // root is special but usually visible

                return { username, uid, gid, comment, home, shell, isSystem };

            })

            .filter(u => u !== null);



        // Parse Groups

        const groups = groupsRes.stdout.split('\n')

            .filter(line => line.trim())

            .map(line => {

                const parts = line.split(':');

                if (parts.length < 4) return null;

                const [name, x, gidStr, members] = parts;

                const gid = parseInt(gidStr);

                const isSystem = gid < 1000 && name !== 'root';

                return { name, gid, members: members ? members.split(',') : [], isSystem };

            })

            .filter(g => g !== null);



        return { success: true, users, groups };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 15. Create User

ipcMain.handle('ssh:create-user', async (event, { username, password, groups }) => {

    try {

        // 1. Create User

        await sshClient.exec(`sudo useradd -m -s /bin/bash "${username}"`);



        // 2. Set Password

        // echo "username:password" | sudo chpasswd

        await sshClient.exec(`echo "${username}:${password}" | sudo chpasswd`);



        // 3. Add to Groups (if any)

        if (groups && groups.length > 0) {

            for (const group of groups) {

                await sshClient.exec(`sudo usermod -aG "${group}" "${username}"`);

            }

        }



        // 4. Enable Password Authentication for this specific user

        // This ensures they can login with the password we just set, even if global PasswordAuth is no.

        const sshdConfig = "/etc/ssh/sshd_config";

        // Check if already exists to prevent duplicate (though create-user usually implies new)

        const checkMatch = await sshClient.exec(`sudo grep "Match User ${username}" ${sshdConfig}`);



        if (checkMatch.code !== 0) {

            // Append Match block to end of file

            // Note: \n needs to be escaped carefully or handled by shell echo

            const configBlock = `\\nMatch User ${username}\\n    PasswordAuthentication yes\\n`;

            await sshClient.exec(`echo -e "${configBlock}" | sudo tee -a ${sshdConfig}`);



            // Restart SSH service to apply changes

            // Try both common service names

            await sshClient.exec(`sudo service ssh restart || sudo service sshd restart`);

        }



        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 15.1 Delete User

ipcMain.handle('ssh:delete-user', async (event, username) => {

    try {

        await sshClient.exec(`sudo deluser --remove-home "${username}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 15.2 Update User Password

ipcMain.handle('ssh:update-user-password', async (event, { username, password }) => {

    try {

        await sshClient.exec(`echo "${username}:${password}" | sudo chpasswd`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 15.3 Enable Password Authentication for User

ipcMain.handle('ssh:enable-password-auth', async (event, username) => {

    try {

        const sshdConfig = "/etc/ssh/sshd_config";



        // Check if Match block already exists

        const checkMatch = await sshClient.exec(`sudo grep "Match User ${username}" ${sshdConfig}`);



        if (checkMatch.code !== 0) {

            // Append Match block to enable password auth for this user

            const configBlock = `\\nMatch User ${username}\\n    PasswordAuthentication yes\\n`;

            await sshClient.exec(`echo -e "${configBlock}" | sudo tee -a ${sshdConfig}`);



            // Restart SSH service

            await sshClient.exec(`sudo service ssh restart || sudo service sshd restart`);

        }



        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16. Create Group

ipcMain.handle('ssh:create-group', async (event, name) => {

    try {

        await sshClient.exec(`sudo groupadd "${name}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16.1 Delete Group

ipcMain.handle('ssh:delete-group', async (event, name) => {

    try {

        await sshClient.exec(`sudo delgroup "${name}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16.2 Add User to Group

ipcMain.handle('ssh:add-user-to-group', async (event, { username, group }) => {

    try {

        await sshClient.exec(`sudo usermod -aG "${group}" "${username}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16.3 Remove User from Group

ipcMain.handle('ssh:remove-user-from-group', async (event, { username, group }) => {

    try {

        // gpasswd -d user group

        await sshClient.exec(`sudo gpasswd -d "${username}" "${group}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16.4 Change User Shell

ipcMain.handle('ssh:change-user-shell', async (event, { username, shell }) => {

    try {

        await sshClient.exec(`sudo usermod -s "${shell}" "${username}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16.5 Change User Home

ipcMain.handle('ssh:change-user-home', async (event, { username, home }) => {

    try {

        // -m moves the content of the home directory to the new location

        await sshClient.exec(`sudo usermod -m -d "${home}" "${username}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 16.6 Update Group Name

ipcMain.handle('ssh:update-group-name', async (event, { oldName, newName }) => {

    try {

        await sshClient.exec(`sudo groupmod -n "${newName}" "${oldName}"`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 17. Get Disks (LSBLK)

ipcMain.handle('ssh:get-disks', async (event) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // -J = JSON, -o = Columns

        const res = await sshClient.exec("lsblk -J -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE,MODEL");



        let disks = [];

        try {

            const data = JSON.parse(res.stdout);

            disks = data.blockdevices;

        } catch (parseErr) {

            // Fallback parsing if JSON fails

            return { success: false, error: "Failed to parse lsblk output. Ensure 'lsblk' is installed on server." };

        }



        return { success: true, disks };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 18. Mount Disk

ipcMain.handle('ssh:mount-disk', async (event, { device, mountPoint, format }) => {

    const log = (cmd, success = true) => event.sender.send('ssh:log-event', { cmd, success });

    try {

        // 1. Format if requested (DANGEROUS)

        if (format) {

            log(`Formatting ${device} as ext4...`);

            await sshClient.exec(`sudo mkfs.ext4 -F /dev/${device}`);

        }



        // 2. Create Mount Point

        log(`Creating mount point ${mountPoint}...`);

        await sshClient.exec(`sudo mkdir -p "${mountPoint}"`);



        // 3. Mount

        log(`Mounting /dev/${device} to ${mountPoint}...`);

        const mountRes = await sshClient.exec(`sudo mount /dev/${device} "${mountPoint}"`);

        if (mountRes.code !== 0) throw new Error(mountRes.stderr);



        // 4. Persistence (Add to fstab)

        const fstabCheck = await sshClient.exec(`grep "/dev/${device}" /etc/fstab`);

        if (fstabCheck.code !== 0) {

            log('Adding to /etc/fstab for persistence...');

            const fstabLine = `/dev/${device} ${mountPoint} ext4 defaults 0 0`;

            await sshClient.exec(`echo "${fstabLine}" | sudo tee -a /etc/fstab`);

        }



        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 19. Install Global Software

// 19. Install Global Software

ipcMain.handle('ssh:install-package', async (event, pkg) => {

    const log = (cmd, success = true) => event.sender.send('ssh:log-event', { cmd, success });

    try {

        log(`Installing ${pkg}...`);

        // Update package list first to ensure valid candidate

        const updateRes = await execAptWithRetry('sudo apt-get update');
        if (updateRes.code !== 0) throw new Error(updateRes.stderr || updateRes.stdout);



        const res = await execAptWithRetry(`sudo apt-get install -y ${pkg}`);



        if (res.code !== 0) throw new Error(res.stderr);



        log(`Successfully installed ${pkg}`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 19.1 Remove Global Software

ipcMain.handle('ssh:remove-package', async (event, pkg) => {

    const log = (cmd, success = true) => event.sender.send('ssh:log-event', { cmd, success });

    try {

        log(`Uninstalling ${pkg}...`);

        const res = await execAptWithRetry(`sudo apt-get remove -y ${pkg} && sudo apt-get autoremove -y`);



        if (res.code !== 0) throw new Error(res.stderr);



        log(`Successfully removed ${pkg}`);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 19.2 Check Installed Software

ipcMain.handle('ssh:check-installed', async (event, pkgs) => {

    try {

        const results = {};

        for (const pkg of pkgs) {

            // dpkg -s returns 0 if installed, 1 if not

            // We pipe to /dev/null to keep output clean, rely on exit code

            const res = await sshClient.exec(`dpkg -s ${pkg} > /dev/null 2>&1`);

            results[pkg] = (res.code === 0);

        }

        return { success: true, results };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 20. Deploy App

ipcMain.handle('ssh:deploy-app', async (event, config) => {
    const log = (cmd, success = true) => event.sender.send('ssh:deploy-log', { cmd, success });
    try {
        log(`Starting deployment pipeline for ${config.name}...`);
        
        // Surgical Fix: Clear any locks BEFORE starting
        log('Pre-flight: Ensuring server package manager is available...');
        const surgicalFix = `
            sudo systemctl stop apt-daily.timer apt-daily-upgrade.timer unattended-upgrades 2>/dev/null || true;
            sudo pkill -9 -f unattended-upgrade 2>/dev/null || true;
            sudo pkill -9 apt || true;
            sudo pkill -9 apt-get || true;
            sudo pkill -9 dpkg || true;
            sudo fuser -k /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/cache/apt/archives/lock 2>/dev/null || true;
            sudo rm -f /var/lib/dpkg/lock /var/lib/apt/lists/lock /var/lib/dpkg/lock-frontend /var/cache/apt/archives/lock;
            sudo DEBIAN_FRONTEND=noninteractive dpkg --configure -a 2>/dev/null || true;
        `;
        await sshClient.exec(surgicalFix).catch(() => {});
        log('Server package manager ready.');

        let { name, port, manager, webserver, deployMode, sourceType, repoUrl, branch, serverPath, installDeps, runUpdate, enableSsl, enableFirewall, healthPath, healthRestart, zeroDowntime, enablePm2Startup } = config;



        // Auto-assign Port if missing

        if (!port) {

            log('Detecting available port...');

            // Try to get a free random port using python (installed on most linux)

            // Try to get a free standard dev port first, then random

            const getPortCmd = `python3 -c "import socket; 

candidates=[3000, 8080, 8000, 5000, 4000, 8888, 3001, 8081];

found=0;

for p in candidates:

    s=socket.socket(socket.AF_INET, socket.SOCK_STREAM);

    res=s.connect_ex(('127.0.0.1', p));

    s.close();

    if res!=0:

        print(p);

        found=1;

        break;

if found==0:

    s=socket.socket();

    s.bind(('', 0));

    print(s.getsockname()[1]);

    s.close()"`;

            const portRes = await sshClient.exec(getPortCmd);

            if (portRes.code === 0 && portRes.stdout) {

                port = portRes.stdout.trim();

                log(`Port auto-assigned: ${port}`);

            } else {

                // Fallback to random 8000-9000

                port = Math.floor(Math.random() * (9000 - 8000) + 8000);

                log(`Port fallback: ${port}`);

            }

        } else {

            log(`Using configured port: ${port}`);

        }



        // 1. Update System
        // NOTE: apt-get update does not accept -y; keep it simple.
        // User expectation: for PM2 we should always refresh apt cache before installing.
        if (runUpdate || manager === 'pm2' || webserver === 'nginx' || webserver === 'caddy') {
            log('Updating System (sudo apt-get update)...');
            const updateRes = await execAptWithRetry('sudo apt-get update', { onRetry: log });
            if (updateRes.code !== 0) throw new Error(updateRes.stderr || updateRes.stdout);
        }



        // 2. Prepare Source

        let appDir = serverPath;

        if (sourceType === 'github') {

            log(`Preparing directory for ${name}...`);

            // Create apps folder if not exists

            await sshClient.exec('mkdir -p ~/apps');

            appDir = `~/apps/${name}`;



            // Check if exists

            const check = await sshClient.exec(`ls -d ${appDir}`);

            if (check.code === 0) {

                log(`Pulling latest changes from ${branch || 'main'}...`);

                await sshClient.exec(`cd ${appDir} && git pull`);

            } else {

                log(`Cloning repository ${repoUrl}...`);

                const cloneRes = await sshClient.exec(`git clone -b ${branch || 'main'} ${repoUrl} ${appDir}`);

                if (cloneRes.code !== 0) throw new Error(`Git Clone Failed: ${cloneRes.stderr}`);

            }

        }



        // Resolve absolute path for appDir

        const pwd = await sshClient.exec(`cd ${appDir} && pwd`);

        const fullPath = pwd.stdout.trim();

        log(`Application Path: ${fullPath}`);



        // 3. Detect Language & Install Deps & Find Start Command

        let startCmd = '';

        let language = 'unknown';



        // Check Node.js

        const checkPackage = await sshClient.exec(`ls "${fullPath}/package.json"`);

        if (checkPackage.code === 0) {

            if (installDeps) {

                log('Installing Node.js dependencies...');

                await sshClient.exec(`cd "${fullPath}" && npm install`);

            }

            startCmd = 'npm start';

            language = 'nodejs';

            log('Detected Node.js project');

        }

        // Check Python

        else {

            const checkReq = await sshClient.exec(`ls "${fullPath}/requirements.txt"`);

            if (checkReq.code === 0) {

                if (installDeps) {

                    log('Installing Python dependencies...');

                    await sshClient.exec(`cd "${fullPath}" && pip3 install -r requirements.txt`);

                }



                startCmd = 'python3 app.py'; // Default fallback

                // Try to find a logical main file like main.py or server.py

                const findPy = await sshClient.exec(`cd "${fullPath}" && ls *.py | head -n 1`);

                if (findPy.code === 0 && findPy.stdout.trim()) {

                    startCmd = `python3 ${findPy.stdout.trim()}`;

                }



                language = 'python';

                log(`Detected Python project (Start Command: ${startCmd})`);

            }

            // Check Static HTML

            else {

                const checkHtml = await sshClient.exec(`ls "${fullPath}/index.html"`);

                if (checkHtml.code === 0) {

                    startCmd = 'python3 -m http.server "$PORT" --bind 0.0.0.0';

                    language = 'static';

                    log('Detected Static Website (Serving via Python http.server)');

                } else {

                    const ls = await sshClient.exec(`ls -m "${fullPath}"`);
                    const files = ls.stdout.trim().substring(0, 150) + (ls.stdout.length > 150 ? '...' : '');

                    throw new Error(`Could not detect 'package.json', 'requirements.txt', or 'index.html'. Found: ${files || '[Empty]'}`);

                }

            }

        }





        // 4. Setup Service

        log(`Configuring ${manager} service...`);



        // Open Firewall
        if (enableFirewall !== false) {
            log(`Opening port ${port} in Firewall...`);
            await sshClient.exec(`sudo ufw allow ${port}`);
        }



        // Ensure user processes persist after logout (Critical for PM2/Systemd user instances)

        const whoami = await sshClient.exec('whoami');

        const user = whoami.stdout.trim();

        // Best-effort enable linger

        await sshClient.exec(`sudo loginctl enable-linger ${user}`).catch(() => { });



        let nonePid = null;

        if (manager === 'pm2') {

            // Ensure npm exists (pm2 requires npm)
            const npmCheck = await sshClient.exec('command -v npm >/dev/null 2>&1; echo $?');
            if (String(npmCheck.stdout || '').trim() !== '0') {
                log('npm not found. Installing Node.js + npm...');
                const updateRes = await execAptWithRetry('sudo apt-get update', { onRetry: log });
                if (updateRes.code !== 0) throw new Error(updateRes.stderr || updateRes.stdout);
                const nodeRes = await execAptWithRetry('sudo apt-get install -y nodejs npm', { onRetry: log });
                if (nodeRes.code !== 0) throw new Error(`Node/npm install failed: ${nodeRes.stderr || nodeRes.stdout}`);
            }

            // Ensure PM2 installed

            const pm2Check = await sshClient.exec('pm2 -v');

            if (pm2Check.code !== 0) {

                log('Installing PM2...');

                const pm2Res = await sshClient.exec('sudo npm install -g pm2');
                if (pm2Res.code !== 0) throw new Error(`PM2 install failed: ${pm2Res.stderr || pm2Res.stdout}`);

            }



            // Clean previous instance if exists (to avoid duplicate/error)

            await sshClient.exec(`pm2 delete "${name}"`).catch(() => { });



            // Start Command Construction

            let pm2Cmd = '';

            if (startCmd === 'npm start') {

                // User Recommendation: pm2 start npm --name "myapp" -- start

                pm2Cmd = `cd ${fullPath} && HOST=0.0.0.0 PORT=${port} pm2 start npm --name "${name}" --time -- start`;

            } else {

                // Fallback for python/other

                pm2Cmd = `cd ${fullPath} && HOST=0.0.0.0 PORT=${port} pm2 start "${startCmd}" --name "${name}" --time`;

            }



            log(`Starting PM2 process for ${name}...`);

            await sshClient.exec(pm2Cmd);



            // PERSISTENCE (Reboot)

            if (enablePm2Startup) {

                log('Configuring PM2 startup (reboot persistence)...');

                // 1. Generate startup script command

                const startupRes = await sshClient.exec('pm2 startup');

                // 2. Extract the 'sudo' command from output if present

                const lines = startupRes.stdout.split('\n');

                const startupCmd = lines.find(line => line.trim().startsWith('sudo') && line.includes('pm2 startup'));



                if (startupCmd) {

                    log(`Executing startup command: ${startupCmd.trim().substring(0, 30)}...`);

                    await sshClient.exec(startupCmd.trim());

                } else {

                    log('Startup script likely already configured (No output command found).');

                }

            }

            // Save process list

            log('Saving PM2 process list...');

            await sshClient.exec('pm2 save');

            // Add restart support for PM2

            log('Enabling PM2 restart...');

            await sshClient.exec(`pm2 restart "${name}"`);

        }

        else if (manager === 'systemd') {

            // Create a robust start script in the directory

            // This wrapper ensures environmental variables (like NVM/Node path) are loaded correctly

            const wrapperScript = `#!/bin/bash

# Load user environment variables

export HOME=/home/${user}

export PORT=${port}

export HOST=0.0.0.0

export NODE_ENV=production



# Load NVM if present

[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh"



# Load Profile/Bashrc for PATH updates

[ -s "$HOME/.profile" ] && . "$HOME/.profile"

[ -s "$HOME/.bashrc" ] && . "$HOME/.bashrc"



# Fallback path inclusion

export PATH=$PATH:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin



cd ${fullPath}

echo "Starting app in $(pwd) with command: ${startCmd}"

${startCmd}

`;

            const scriptPath = `${fullPath}/start_service.sh`;

            await sshClient.writeFile(scriptPath, wrapperScript);

            await sshClient.exec(`chmod +x ${scriptPath}`);



            // Create Service File Content

            // Following Best Practices & User Request

            const serviceContent = `[Unit]

Description=AlphaOps App - ${name}

After=network.target



[Service]

Type=simple

User=${user}

WorkingDirectory=${fullPath}

ExecStart=${scriptPath}

Restart=always

Environment=NODE_ENV=production

Environment=PORT=${port}

Environment=HOST=0.0.0.0

# Logging

StandardOutput=journal

StandardError=journal

SyslogIdentifier=${name}



[Install]

WantedBy=multi-user.target

`;



            // Write to /tmp then move to /etc/systemd/system

            const tmpPath = `/tmp/${name}.service`;

            await sshClient.writeFile(tmpPath, serviceContent);



            log('Creating systemd service file...');

            const moveRes = await sshClient.exec(`sudo mv ${tmpPath} /etc/systemd/system/${name}.service`);

            if (moveRes.code !== 0) throw new Error(`Sudo Move Failed: ${moveRes.stderr}`);



            await sshClient.exec('sudo systemctl daemon-reload');

            await sshClient.exec(`sudo systemctl enable ${name}`);

            log('Starting service...');

            const startRes = await sshClient.exec(`sudo systemctl start ${name}`);

            if (startRes.code !== 0) throw new Error(`Service Start Failed: ${startRes.stderr}`);

        } else if (manager === 'docker') {
            log('Docker deployment selected...');
            const dockerCheck = await sshClient.exec('docker -v');
            if (dockerCheck.code !== 0) {
                log('Installing Docker...');
                await sshClient.exec('curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh');
            }
            log(`Building Docker image ${name}...`);
            await sshClient.exec(`cd ${fullPath} && sudo docker build -t ${name} .`);
            log(`Running Docker container ${name}...`);
            await sshClient.exec(`sudo docker rm -f ${name}`);
            const runCmd = `sudo docker run -d -p ${port}:${port} --name ${name} --restart unless-stopped ${name}`;
            const dockerRun = await sshClient.exec(runCmd);
            if (dockerRun.code !== 0) throw new Error(`Docker Run Failed: ${dockerRun.stderr}`);
        } else if (manager === 'none') {

            log('Process Manager set to None. Starting app with nohup...');

            const startScriptPath = `${fullPath}/AlphaOps_start_none.sh`;
            const startScript = `#!/bin/bash\n` +
                `export HOST=0.0.0.0\n` +
                `export PORT=${port}\n` +
                `cd "${fullPath}"\n` +
                `${startCmd}\n`;

            await sshClient.writeFile(startScriptPath, startScript);
            await sshClient.exec(`chmod +x "${startScriptPath}"`);

            await sshClient.exec(`bash -lc 'test -f ~/.AlphaOps/${name}.pid && kill -9 $(cat ~/.AlphaOps/${name}.pid) >/dev/null 2>&1 || true'`).catch(() => { });

            const logPath = `~/.AlphaOps/${name}.nohup.log`;
            const pidRes = await sshClient.exec(`bash -lc 'mkdir -p ~/.AlphaOps; nohup "${startScriptPath}" > ${logPath} 2>&1 & echo $!'`);
            const bgPid = String(pidRes.stdout || '').trim();
            if (!bgPid) throw new Error('Failed to start app in background (no PID returned).');
            await sshClient.exec(`bash -lc 'echo "${bgPid}" > ~/.AlphaOps/${name}.pid'`);

            nonePid = bgPid;
        }

        // Layer 4: Web Server / Reverse Proxy
        if (webserver === 'nginx') {
            log('Configuring Nginx Reverse Proxy...');
            const nginxCheck = await sshClient.exec('nginx -v');
            if (nginxCheck.code !== 0) {
                log('Installing Nginx...');
                const nginxRes = await execAptWithRetry('sudo apt-get install -y nginx', { onRetry: log });
                if (nginxRes.code !== 0) throw new Error(`Nginx install failed: ${nginxRes.stderr || nginxRes.stdout}`);
            }

            const nginxConfig = `server {
    listen 80;
    server_name _;
    location / {
        proxy_pass http://127.0.0.1:${port};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}`;
            const tmpNginx = `/tmp/${name}.conf`;
            await sshClient.writeFile(tmpNginx, nginxConfig);
            await sshClient.exec(`sudo mv ${tmpNginx} /etc/nginx/sites-available/${name}`);
            await sshClient.exec(`sudo ln -sf /etc/nginx/sites-available/${name} /etc/nginx/sites-enabled/`);
            await sshClient.exec(`sudo systemctl restart nginx`);
            log('Nginx configured and restarted.');

            // Open port 80 for Nginx
            if (enableFirewall !== false) {
                await sshClient.exec(`sudo ufw allow 80`);
            }
        } else if (webserver === 'caddy') {
            log('Configuring Caddy Reverse Proxy...');
            const caddyCheck = await sshClient.exec('caddy version');
            if (caddyCheck.code !== 0) {
                log('Installing Caddy...');
                await execAptWithRetry('sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https && curl -1sLf \'https://dl.cloudsmith.io/public/caddy/stable/gpg.key\' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg && curl -1sLf \'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt\' | sudo tee /etc/apt/sources.list.d/caddy-stable.list && sudo apt update && sudo apt install -y caddy', { onRetry: log });
            }
            const caddyConfig = `:${port === '80' ? '8080' : '80'} {\n    reverse_proxy 127.0.0.1:${port}\n}\n`;
            const tmpCaddy = `/tmp/${name}.caddy`;
            await sshClient.writeFile(tmpCaddy, caddyConfig);
            await sshClient.exec(`cat ${tmpCaddy} | sudo tee -a /etc/caddy/Caddyfile`);
            await sshClient.exec(`sudo systemctl reload caddy`);
            log('Caddy configured and reloaded.');
        }



        log('Registering application in dashboard...');

        const appInfo = {
            id: name,
            name,
            port,
            manager,
            webserver,
            status: 'running',
            deployedAt: new Date().toISOString(),
            language,
            path: fullPath,
            publicIp: 'localhost', // Placeholder, will update below
            autostart: true,
            healthPath: healthPath || '',
            healthRestart: healthRestart || false,
            startCmd,
            pid: (manager === 'none') ? nonePid : undefined
        };

        // Fetch Public IP for the final success message
        let publicIp = 'localhost';
        try {
            const ipRes = await sshClient.exec('curl -s https://ifconfig.me || curl -s icanhazip.com || hostname -I | awk \'{print $1}\'');
            if (ipRes.code === 0 && ipRes.stdout.trim()) {
                publicIp = ipRes.stdout.trim();
            }
        } catch (e) {
            console.error('Failed to fetch public IP:', e);
        }

        appInfo.publicIp = publicIp;

        // Read existing registry
        const registryCmd = `mkdir -p ~/.AlphaOps && touch ~/.AlphaOps/apps.json && cat ~/.AlphaOps/apps.json`;
        const regRes = await sshClient.exec(registryCmd);
        let apps = [];
        try {
            if (regRes.stdout.trim()) apps = JSON.parse(regRes.stdout);
        } catch (e) {
            apps = [];
        }

        // Update or Add
        const existingIdx = apps.findIndex(a => a.id === name);
        if (existingIdx >= 0) apps[existingIdx] = appInfo;
        else apps.push(appInfo);

        // Save using base64 to avoid shell escaping issues
        const jsonStr = JSON.stringify(apps, null, 2);
        const b64 = Buffer.from(jsonStr).toString('base64');
        await sshClient.exec(`echo "${b64}" | base64 -d > ~/.AlphaOps/apps.json`);

        log('Deployment Complete!', true);

        return { success: true, port, publicIp };

    } catch (e) {

        if (typeof log === 'function') log(`Deployment Error: ${e.message}`, false);

        return { success: false, error: e.message };

    }

});

console.log('Handler Registered: ssh:deploy-app');



// 15. List Deployed Apps

ipcMain.handle('ssh:list-apps', async () => {

    try {

        const res = await sshClient.exec('cat ~/.AlphaOps/apps.json');

        if (res.code !== 0) return { success: true, apps: [] }; // No registry yet

        let apps = JSON.parse(res.stdout);



        // Sync with REAL status

        for (const app of apps) {

            try {

                if (app.manager === 'systemd') {

                    // Check Status

                    // is-active returns non-zero if not active, so we catch needed

                    let activeState = 'stopped';

                    try {

                        const sRes = await sshClient.exec(`systemctl is-active "${app.id}"`);

                        activeState = (sRes.stdout.trim() === 'active') ? 'running' : 'stopped';

                    } catch (e) {

                        activeState = 'stopped';

                    }

                    app.status = activeState;



                    // Check Autostart

                    try {

                        const aRes = await sshClient.exec(`systemctl is-enabled "${app.id}"`);

                        // is-enabled returns 0 if enabled, >0 if disabled/masked

                        app.autostart = (aRes.stdout.trim() === 'enabled');

                    } catch (ignore) {

                        app.autostart = false;

                    }



                } else if (app.manager === 'pm2') {

                    const pRes = await sshClient.exec(`pm2 jlist`);

                    if (pRes.code === 0) {

                        try {

                            const pList = JSON.parse(pRes.stdout);

                            const pApp = pList.find(p => p.name === app.id);

                            app.status = (pApp && pApp.pm2_env.status === 'online') ? 'running' : 'stopped';

                        } catch (parseErr) {

                            app.status = 'stopped';

                        }

                    } else {

                        app.status = 'unknown'; // pm2 command failed

                    }



                    // Check Autostart (PM2)

                    try {

                        const whoami = await sshClient.exec('whoami');

                        const user = whoami.stdout.trim();

                        const checkSvc = await sshClient.exec(`ls /etc/systemd/system/pm2-${user}.service`);

                        app.autostart = (checkSvc.code === 0);

                    } catch (ignore) {

                        app.autostart = false;

                    }

                } else if (app.manager === 'none') {

                    let pid = app.pid;
                    if (!pid) {
                        try {
                            const pidRes = await sshClient.exec(`bash -lc 'test -f ~/.AlphaOps/${app.id}.pid && cat ~/.AlphaOps/${app.id}.pid || true'`);
                            pid = String(pidRes.stdout || '').trim();
                            if (pid) app.pid = pid;
                        } catch (e) {
                        }
                    }

                    if (!pid) {
                        app.status = 'stopped';
                    } else {
                        const aliveRes = await sshClient.exec(`bash -lc 'kill -0 ${pid} >/dev/null 2>&1; echo $?'`);
                        app.status = String(aliveRes.stdout || '').trim() === '0' ? 'running' : 'stopped';
                    }

                }



                // BACKFILL: Detect language if missing (for existing apps)

                if (!app.language) {

                    try {

                        const path = app.path || `~/apps/${app.id}`;

                        const checkNode = await sshClient.exec(`ls "${path}/package.json"`);

                        if (checkNode.code === 0) app.language = 'nodejs';

                        else {

                            const checkPy = await sshClient.exec(`ls "${path}/requirements.txt"`);

                            if (checkPy.code === 0) app.language = 'python';

                            else {

                                const checkHtml = await sshClient.exec(`ls "${path}/index.html"`);

                                if (checkHtml.code === 0) app.language = 'static';

                            }

                        }

                    } catch (langErr) {

                        app.language = 'unknown';

                    }

                }

            } catch (statusErr) {

                console.log(`Error checking status for ${app.id}: ${statusErr.message}`);

                app.status = 'unknown';

            }

        }

        return { success: true, apps };

    } catch (e) {

        return { success: false, error: e.message };

    }

});

console.log('Handler Registered: ssh:list-apps');



// 16. Manage App (Start/Stop/Delete)

ipcMain.handle('ssh:manage-app', async (event, { id, action }) => {

    // Helper to run command and throw on error

    const run = async (cmd) => {

        const res = await sshClient.exec(cmd);

        if (res.code !== 0) throw new Error(`Command failed: ${res.stderr || res.stdout || 'Unknown error'}`);

        return res;

    };

    const ensurePm2Ready = async () => {
        // Ensure npm exists (pm2 requires npm)
        const npmCheck = await sshClient.exec('command -v npm >/dev/null 2>&1; echo $?');
        if (String(npmCheck.stdout || '').trim() !== '0') {
            const updateRes = await execAptWithRetry('sudo apt-get update');
            if (updateRes.code !== 0) throw new Error(updateRes.stderr || updateRes.stdout);
            const nodeRes = await execAptWithRetry('sudo apt-get install -y nodejs npm');
            if (nodeRes.code !== 0) throw new Error(`Node/npm install failed: ${nodeRes.stderr || nodeRes.stdout}`);
        }

        const pm2Check = await sshClient.exec('pm2 -v');
        if (pm2Check.code !== 0) {
            const updateRes = await execAptWithRetry('sudo apt-get update');
            if (updateRes.code !== 0) throw new Error(updateRes.stderr || updateRes.stdout);
            const installRes = await sshClient.exec('sudo npm install -g pm2');
            if (installRes.code !== 0) throw new Error(`PM2 install failed: ${installRes.stderr || installRes.stdout}`);
        }
    };



    try {

        // 1. Read Registry

        const regRes = await sshClient.exec('cat ~/.AlphaOps/apps.json');

        if (regRes.code !== 0) throw new Error("App registry not found");

        let apps = JSON.parse(regRes.stdout);

        const app = apps.find(a => a.id === id);

        if (!app) throw new Error("App not found in registry");



        // 2. Execute Action

        console.log(`Managing App: '${id}' Action: '${action}' Manager: '${app.manager}'`);




        if (app.manager === 'systemd') {

            if (action === 'start') await run(`sudo systemctl start "${id}"`);

            else if (action === 'stop') await run(`sudo systemctl stop "${id}"`);

            else if (action === 'restart') await run(`sudo systemctl restart "${id}"`);

            else if (action === 'delete') {

                // Best effort cleanup

                await sshClient.exec(`sudo systemctl stop "${id}"`);

                await sshClient.exec(`sudo systemctl disable "${id}"`);

                await sshClient.exec(`sudo rm "/etc/systemd/system/${id}.service"`);

                await run(`sudo systemctl daemon-reload`);

            }

            else if (action === 'enable-boot') await run(`sudo systemctl enable "${id}"`);

            else if (action === 'disable-boot') await run(`sudo systemctl disable "${id}"`);

        } else if (app.manager === 'pm2') {

            // Auto-install pm2 (and npm/node) if missing
            await ensurePm2Ready();

            if (action === 'start') await run(`pm2 start "${id}"`);

            else if (action === 'stop') await run(`pm2 stop "${id}"`);

            else if (action === 'restart') await run(`pm2 restart "${id}"`);

            else if (action === 'delete') {

                // Ensure stopped first

                await run(`pm2 stop "${id}"`).catch(() => { });

                await run(`pm2 delete "${id}"`);

                await run(`pm2 save`);

            }

            else if (action === 'enable-boot') {

                // Determine user

                const whoami = await sshClient.exec('whoami');

                const pRes = await sshClient.exec(`pm2 startup systemd -u ${whoami.stdout.trim()} --hp /home/${whoami.stdout.trim()}`);

                // Extract sudo command and run

                const lines = pRes.stdout.split('\n');

                const cmd = lines.find(l => l.trim().startsWith('sudo'));

                if (cmd) await sshClient.exec(cmd.trim());

                await sshClient.exec('pm2 save');

            }

            else if (action === 'disable-boot') {

                await sshClient.exec('pm2 unstartup systemd'); // Simplified

            }

        } else if (app.manager === 'docker') {

            if (action === 'start') await run(`sudo docker start "${id}"`);
            else if (action === 'stop') await run(`sudo docker stop "${id}"`);
            else if (action === 'restart') await run(`sudo docker restart "${id}"`);
            else if (action === 'delete') await run(`sudo docker rm -f "${id}"`);

        } else if (app.manager === 'none') {

            const pidFile = `~/.AlphaOps/${id}.pid`;
            const logFile = `~/.AlphaOps/${id}.nohup.log`;
            const startScriptPath = (app.path ? `${app.path}/AlphaOps_start_none.sh` : `~/apps/${id}/AlphaOps_start_none.sh`);

            try {
                const scriptCheck = await sshClient.exec(`bash -lc 'test -x "${startScriptPath}"; echo $?'`);
                const scriptOk = String(scriptCheck.stdout || '').trim() === '0';
                if (!scriptOk) {
                    if (!app.startCmd) throw new Error('Missing start command for app. Redeploy required.');
                    const targetPath = app.path || `~/apps/${id}`;
                    const script = `#!/bin/bash\n` +
                        `export HOST=0.0.0.0\n` +
                        `export PORT=${app.port}\n` +
                        `cd "${targetPath}"\n` +
                        `${app.startCmd}\n`;
                    await sshClient.writeFile(startScriptPath, script);
                    await sshClient.exec(`chmod +x "${startScriptPath}"`);
                }
            } catch (e) {
                throw new Error(e.message || 'Failed to prepare start script.');
            }

            const readPidRes = await sshClient.exec(`bash -lc 'test -f ${pidFile} && cat ${pidFile} || true'`);
            const pid = String(readPidRes.stdout || '').trim() || String(app.pid || '').trim();

            const killPid = async () => {
                if (!pid) return;
                await sshClient.exec(`bash -lc 'kill -9 ${pid} >/dev/null 2>&1 || true'`);
            };

            if (action === 'stop') {
                await killPid();
            } else if (action === 'start' || action === 'restart') {
                await killPid();
                const pRes = await sshClient.exec(`bash -lc 'mkdir -p ~/.AlphaOps; nohup "${startScriptPath}" > ${logFile} 2>&1 & echo $!'`);
                const newPid = String(pRes.stdout || '').trim();
                if (!newPid) throw new Error('Failed to start app (no PID returned).');
                await sshClient.exec(`bash -lc 'echo "${newPid}" > ${pidFile}'`);
                app.pid = newPid;
            } else if (action === 'delete') {
                await killPid();
                await sshClient.exec(`bash -lc 'rm -f ${pidFile} ${logFile} >/dev/null 2>&1 || true'`);
            } else if (action === 'enable-boot') {
                app.autostart = true;
            } else if (action === 'disable-boot') {
                app.autostart = false;
            }

        } else {

            throw new Error(`Unsupported app manager: '${app.manager}'`);

        }



        // 3. Update Registry

        if (action === 'delete') {

            apps = apps.filter(a => a.id !== id);

        } else {

            // Update status only if starting/stopping

            if (action === 'start') app.status = 'running';

            if (action === 'stop') app.status = 'stopped';

            if (action === 'restart') app.status = 'running';

            if (action === 'enable-boot') app.autostart = true;
            if (action === 'disable-boot') app.autostart = false;

        }



        // Save

        const jsonStr = JSON.stringify(apps, null, 2);

        const b64 = Buffer.from(jsonStr).toString('base64');

        await run(`echo "${b64}" | base64 -d > ~/.AlphaOps/apps.json`);



        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});

console.log('Handler Registered: ssh:manage-app');



// 17. Get Security Status

ipcMain.handle('ssh:get-security-status', async () => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // 1. Firewall (UFW)

        // Parse 'To                         Action      From' ...

        const ufwRes = await sshClient.exec("sudo ufw status");

        let firewallRules = [];

        let firewallStatus = 'inactive';



        if (ufwRes.code === 0) {

            const lines = ufwRes.stdout.split('\n');

            const statusLine = lines.find(l => l.toLowerCase().startsWith('status:'));

            if (statusLine) firewallStatus = statusLine.split(':')[1].trim();



            if (firewallStatus === 'active') {

                // Parse rules

                // Skip header lines until we see "To"

                const startIndex = lines.findIndex(l => l.startsWith('To') && l.includes('Action'));

                if (startIndex > -1) {

                    // 80/tcp                     ALLOW       Anywhere 

                    for (let i = startIndex + 1; i < lines.length; i++) {

                        const line = lines[i].trim();

                        if (!line) continue;

                        // Simple regex for table rows

                        // 80/tcp (v6) ...

                        const parts = line.split(/\s{2,}/); // Split by 2+ spaces

                        if (parts.length >= 2) {

                            firewallRules.push({

                                port: parts[0],

                                action: parts[1],

                                from: parts[2] || 'Anywhere'

                            });

                        }

                    }

                }

            }

        }



        // 2. SSL Certificates (Certbot/LetsEncrypt)

        // List directories in /etc/letsencrypt/live

        const certsRes = await sshClient.exec("sudo ls -F /etc/letsencrypt/live/ | grep / || true");

        let sslCerts = [];



        if (certsRes.code === 0 && certsRes.stdout.trim()) {

            const domains = certsRes.stdout.split('\n').map(d => d.replace('/', '').trim()).filter(d => d && d !== 'README');



            for (const domain of domains) {

                // Check validity using openssl on reference file

                // openssl x509 -enddate -noout -in /etc/letsencrypt/live/<domain>/cert.pem

                const check = await sshClient.exec(`sudo openssl x509 -enddate -noout -in /etc/letsencrypt/live/${domain}/cert.pem`);

                if (check.code === 0) {

                    // notAfter=May 12 12:00:00 2026 GMT

                    const dateStr = check.stdout.replace('notAfter=', '').trim();

                    const expiryDate = new Date(dateStr);

                    const daysLeft = Math.ceil((expiryDate - Date.now()) / (1000 * 60 * 60 * 24));



                    sslCerts.push({

                        domain,

                        expiry: expiryDate.toLocaleDateString(),

                        daysLeft,

                        status: daysLeft > 0 ? 'Active' : 'Expired',

                        color: daysLeft > 14 ? 'green' : (daysLeft > 0 ? 'orange' : 'red')

                    });

                }

            }

        }



        return {

            success: true,

            firewall: { status: firewallStatus, rules: firewallRules },

            ssl: sslCerts

        };



    } catch (e) {

        return { success: false, error: e.message };

    }

});

console.log('Handler Registered: ssh:get-security-status');



// 18. Toggle Firewall

ipcMain.handle('ssh:toggle-firewall', async (event, enable) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        if (enable) {

            // CRITICAL: Always allow SSH before enabling to prevent lockout

            await sshClient.exec('sudo ufw allow 22/tcp');

            await sshClient.exec('sudo ufw allow 80/tcp');

            await sshClient.exec('sudo ufw allow 443/tcp');



            // Enable (echo 'y' answers the "Command may disrupt existing ssh connections" prompt)

            const res = await sshClient.exec('echo "y" | sudo ufw enable');

            if (res.code !== 0) throw new Error(res.stderr || res.stdout);

        } else {

            const res = await sshClient.exec('sudo ufw disable');

            if (res.code !== 0) throw new Error(res.stderr || res.stdout);

        }

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 19. Install SSL (Certbot)

ipcMain.handle('ssh:install-ssl', async (event, domain) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    const log = (cmd, success = true) => event.sender.send('ssh:log-event', { cmd, success });



    try {

        log(`Checking Certbot installation...`);

        // 1. Install Certbot if missing

        const check = await sshClient.exec('which certbot');

        if (check.code !== 0) {

            log('Installing Certbot & Nginx plugin...');
            await execAptWithRetry('sudo apt-get update');
            await execAptWithRetry('sudo apt-get install -y certbot python3-certbot-nginx');

        }



        // 2. Run Certbot

        // Note: This requires an Nginx server block to already exist for this domain

        log(`Requesting SSL certificate for ${domain}...`);

        const cmd = `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --register-unsafely-without-email --redirect`;

        const res = await sshClient.exec(cmd);



        if (res.code !== 0) {

            throw new Error(`Certbot failed. Ensure Nginx is configured for ${domain}.\nOutput: ${res.stdout}\nError: ${res.stderr}`);

        }



        log(`SSL Installed successfully for ${domain}`, true);

        return { success: true };

    } catch (e) {

        log(`SSL Installation failed: ${e.message}`, false);

        return { success: false, error: e.message };

    }

});

console.log('Registered Security Handlers');



// ==================== GENERAL SSH HANDLERS ====================



// Generic SSH exec handler for running arbitrary commands

ipcMain.handle('ssh:exec', async (event, command) => {
    if (!sshClient.isConnected) return { success: false, error: "Not connected", code: -1 };
    try {
        const normalizedCommand = (typeof command === 'string')
            ? command
            : (command && typeof command.command === 'string')
                ? command.command
                : '';
        if (!String(normalizedCommand).trim()) {
            return { success: false, error: 'Command is required', code: -1 };
        }

        // If it's an apt command, use the retry logic
        if (normalizedCommand.includes('apt-get') || normalizedCommand.includes('apt install') || normalizedCommand.includes('apt update')) {
            const res = await execAptWithRetry(normalizedCommand);
            return { success: true, code: res.code, stdout: res.stdout, stderr: res.stderr };
        }

        const res = await sshClient.exec(normalizedCommand);
        return { success: true, code: res.code, stdout: res.stdout, stderr: res.stderr };
    } catch (e) {
        return { success: false, error: e.message, code: -1 };
    }
});

console.log('Registered General SSH Handlers');



// 27. Unmount Disk

ipcMain.handle('ssh:unmount-disk', async (event, deviceOrMountPoint) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // Try unmount by name or path

        const cmd = `sudo umount /dev/${deviceOrMountPoint} || sudo umount ${deviceOrMountPoint}`;

        const res = await sshClient.exec(cmd);



        if (res.code !== 0) throw new Error(res.stderr || "Unmount failed");

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// Get server context for AI script generation

ipcMain.handle('ssh:get-server-context', async () => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        const context = {};



        // Get OS info

        const osInfo = await sshClient.exec('cat /etc/os-release 2>/dev/null | head -5 || uname -a');

        context.os = osInfo.stdout.trim();



        // Get current user

        const userInfo = await sshClient.exec('whoami');

        context.user = userInfo.stdout.trim();



        // Get home directory

        const homeInfo = await sshClient.exec('echo $HOME');

        context.home = homeInfo.stdout.trim();

        // Find standard non-root user (important for agent mode which runs as root)
        if (context.user === 'root') {
            const stdUser = await sshClient.exec("awk -F: '$3 >= 1000 && $3 < 60000 {print $1\":\"$6}' /etc/passwd | head -n 1");
            const stdUserStdout = stdUser.stdout.trim();
            if (stdUserStdout) {
                const parts = stdUserStdout.split(':');
                if (parts.length === 2) {
                    context.standardUser = parts[0];
                    context.standardHome = parts[1];
                }
            }
        }



        // Get installed software (common tools)

        const toolsCheck = await sshClient.exec(`

            echo "=== Installed Tools ===" &&

            which mysql mysqldump 2>/dev/null && echo "MySQL: installed" || echo "MySQL: not found" &&

            which pg_dump psql 2>/dev/null && echo "PostgreSQL: installed" || echo "PostgreSQL: not found" &&

            which mongodump mongo 2>/dev/null && echo "MongoDB: installed" || echo "MongoDB: not found" &&

            which nginx 2>/dev/null && echo "Nginx: installed" || echo "Nginx: not found" &&

            which apache2 httpd 2>/dev/null && echo "Apache: installed" || echo "Apache: not found" &&

            which docker 2>/dev/null && echo "Docker: installed" || echo "Docker: not found" &&

            which node npm 2>/dev/null && echo "Node.js: installed" || echo "Node.js: not found" &&

            which python3 python 2>/dev/null && echo "Python: installed" || echo "Python: not found"

        `);

        context.tools = toolsCheck.stdout.trim();



        // Get directory structure (limited)

        const dirInfo = await sshClient.exec('ls -la ~ 2>/dev/null | head -20');

        context.homeDir = dirInfo.stdout.trim();



        // Get disk space

        const diskInfo = await sshClient.exec('df -h / 2>/dev/null | tail -1');

        context.disk = diskInfo.stdout.trim();



        // Get running services

        const servicesInfo = await sshClient.exec('systemctl list-units --type=service --state=running 2>/dev/null | head -15 || service --status-all 2>/dev/null | grep "+" | head -15');

        context.services = servicesInfo.stdout.trim();



        return { success: true, context };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// ==================== CRON JOB HANDLERS ====================





// Helper: Calculate next cron run time (simple approximation)

function getNextCronRun(schedule) {

    const parts = schedule.split(/\s+/);

    if (parts.length !== 5) return 'Unknown';



    const [min, hour, day, month, weekday] = parts;

    const now = new Date();



    // Simple approximation - show schedule description

    if (min === '*' && hour === '*') return 'Every minute';

    if (min !== '*' && hour === '*') return `Every hour at :${min.padStart(2, '0')}`;

    if (min !== '*' && hour !== '*' && day === '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

    if (day !== '*' && month === '*') return `Monthly on day ${day}`;



    return `${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;

}



// 20. List Cron Jobs with Status

ipcMain.handle('ssh:list-crons', async () => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // Get user crontab

        const res = await sshClient.exec('crontab -l 2>/dev/null || echo ""');

        const lines = res.stdout.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'));



        // Get running processes to check if any cron command is currently executing

        const psRes = await sshClient.exec('ps aux 2>/dev/null | grep -v grep');

        const runningProcesses = psRes.stdout.toLowerCase();



        // Try to get recent cron execution logs

        let cronLogs = '';

        try {

            // Try journalctl first (systemd systems)

            const logRes = await sshClient.exec('journalctl -u cron --since "1 hour ago" 2>/dev/null | tail -50 || grep CRON /var/log/syslog 2>/dev/null | tail -50 || echo ""');

            cronLogs = logRes.stdout.toLowerCase();

        } catch (e) {

            // Ignore log errors

        }



        const crons = lines.map((line, idx) => {

            // Parse cron line: "* * * * * /path/to/script.sh # TaskName"

            const parts = line.split(/\s+/);

            if (parts.length < 6) return null;



            const schedule = parts.slice(0, 5).join(' ');

            const commandParts = parts.slice(5);

            const commentIdx = commandParts.findIndex(p => p.startsWith('#'));



            let command, name;

            if (commentIdx > -1) {

                command = commandParts.slice(0, commentIdx).join(' ');

                name = commandParts.slice(commentIdx).join(' ').replace(/^#\s*/, '');

            } else {

                command = commandParts.join(' ');

                name = `Task ${idx + 1}`;

            }



            // Determine status

            let status = 'scheduled';

            let statusColor = 'gray';

            let lastRun = null;



            // Check if currently running

            const cmdBasename = command.split('/').pop().split(' ')[0].toLowerCase();

            if (cmdBasename && runningProcesses.includes(cmdBasename)) {

                status = 'running';

                statusColor = 'blue';

            }



            // Check logs for recent execution

            if (cronLogs.includes(cmdBasename) || cronLogs.includes(name.toLowerCase())) {

                if (status !== 'running') {

                    status = 'completed';

                    statusColor = 'green';

                }

                lastRun = 'Recently';

            }



            // Get next run description

            const nextRun = getNextCronRun(schedule);



            return {

                id: idx,

                name: name,

                schedule: schedule,

                command: command,

                enabled: true,

                raw: line,

                status: status,

                statusColor: statusColor,

                lastRun: lastRun,

                nextRun: nextRun

            };

        }).filter(Boolean);



        return { success: true, crons };

    } catch (e) {

        return { success: false, error: e.message };

    }

});

// 21. Add Cron Job (with optional stop time)

ipcMain.handle('ssh:add-cron', async (event, { name, schedule, command, stopDateTime }) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // Validate schedule format (5 fields)

        const schedParts = schedule.trim().split(/\s+/);

        if (schedParts.length !== 5) {

            return { success: false, error: "Invalid cron schedule. Must have 5 fields (min hour day month weekday)" };

        }



        // Create the cron entry with a comment for the name

        const cronLine = `${schedule} ${command} # ${name}`;



        // Append to crontab

        const addCmd = `(crontab -l 2>/dev/null; echo "${cronLine}") | crontab -`;

        const res = await sshClient.exec(addCmd);



        if (res.code !== 0) {

            throw new Error(res.stderr || 'Failed to add cron job');

        }



        // If stopDateTime is provided, schedule automatic removal

        if (stopDateTime) {

            // Parse the stop date/time (format: "YYYY-MM-DD HH:MM")

            const [datePart, timePart] = stopDateTime.split(' ');

            const [year, month, day] = datePart.split('-');

            const [hour, minute] = timePart.split(':');



            // Create a removal script

            const cleanName = name.replace(/[^a-zA-Z0-9]/g, '_');

            const removalScript = `~/.AlphaOps/remove_cron_${cleanName}.sh`;

            const escapedCronLine = cronLine.replace(/"/g, '\\"').replace(/\$/g, '\\$');



            // Create the removal script

            const createRemovalScript = `

                mkdir -p ~/.AlphaOps && 

                cat > ${removalScript} << 'REMSCRIPT'

#!/bin/bash

# Auto-removal script for cron job: ${name}

crontab -l 2>/dev/null | grep -vF "${escapedCronLine}" | crontab -

# Self-cleanup

rm -f ${removalScript}

# Remove the scheduled removal cron entry

crontab -l 2>/dev/null | grep -v "# AlphaOps_STOP_${cleanName}" | crontab -

REMSCRIPT

chmod +x ${removalScript}

            `;

            await sshClient.exec(createRemovalScript);



            // Schedule the removal using a one-time cron entry

            // The cron will run the removal script and then self-destruct

            const removalCronLine = `${minute} ${hour} ${day} ${month} * ${removalScript} # AlphaOps_STOP_${cleanName}`;

            const scheduleRemoval = `(crontab -l 2>/dev/null; echo "${removalCronLine}") | crontab -`;

            await sshClient.exec(scheduleRemoval);

        }



        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 22. Delete Cron Job

ipcMain.handle('ssh:delete-cron', async (event, cronLine) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // Escape special characters for sed

        const escapedLine = cronLine.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');



        // Remove the line from crontab

        const delCmd = `crontab -l 2>/dev/null | grep -vF "${cronLine}" | crontab -`;

        const res = await sshClient.exec(delCmd);



        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 23. Call Supabase Edge Function with server context

// 23. Call Supabase Edge Function with server context

async function callGeminiViaEdgeFunction(prompt, serverContext, mode = 'script', chatHistory = []) {

    try {

        const headers = {
            'Content-Type': 'application/json'
        };

        if (currentAccessToken) {
            headers['Authorization'] = `Bearer ${currentAccessToken}`;
        }

        const response = await fetch(`${DESKTOP_BACKEND_BASE_URL}/ai/chat`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ prompt, serverContext, mode, chatHistory })
        });

        if (!response.ok) {
            const err = await response.text();
            return { success: false, error: `AI backend error: ${err}` };
        }

        const data = await response.json();
        if (!data || data.success !== true) {
            return { success: false, error: data?.error || 'AI backend error' };
        }
        return { success: true, script: data.script || '' };

    } catch (e) {

        return { success: false, error: `AI backend not available: ${e.message}` };

    }

}



// 24. Generate Script with Gemini AI (with server context)

ipcMain.handle('ssh:generate-script', async (event, { description, apiKey, serverContext }) => {

    try {

        const prompt = `You are a Linux shell scripting expert. Generate a bash script based on this description:



"${description}"



Requirements:

- Output ONLY the bash script, no explanations

- Start with #!/bin/bash

- Include error handling where appropriate

- Make it production-ready

- Add brief comments for clarity

- Keep it concise but functional`;



        // First, try to use Supabase Edge Function (which has access to GEMINI_API_KEY secret)

        if (!apiKey) {

            const edgeResult = await callGeminiViaEdgeFunction(prompt, serverContext);

            if (edgeResult.success) {

                let script = edgeResult.script;

                script = script.replace(/```bash\n?/g, '').replace(/```\n?/g, '').trim();

                return { success: true, script };

            }

            // If edge function failed and no API key provided, show helpful error

            if (!apiKey) {

                return {

                    success: false,

                    error: `${edgeResult.error}`

                };

            }

        }

        const edgeResult = await callGeminiViaEdgeFunction(prompt, serverContext);

        if (edgeResult.success) {
            let script = edgeResult.script;
            script = script.replace(/```bash\n?/g, '').replace(/```\n?/g, '').trim();
            return { success: true, script };
        }

        return { success: false, error: edgeResult.error || 'AI request failed' };

    } catch (e) {

        return { success: false, error: e.message };

    }

});







// 25. AI Command Generation (Single Line)

ipcMain.handle('ssh:ai-command', async (event, { prompt, serverContext, chatHistory, mode }) => {

    try {

        if (!prompt) return { success: false, error: 'No prompt provided' };



        // Default to 'command' for backward compatibility (single line mode)

        let useMode = mode || 'command';



        let effectivePrompt = prompt;

        // SMART CHAT MODE: 

        if (useMode === 'chat') {
            // Keep it as chat mode, don't force JSON-command yet. 
            // The edge function will handle the conversational instructions.
            effectivePrompt += `\n\nSYSTEM INSTRUCTION: As DevAI, if asked to create, modify, or update a file, ALWAYS use the current user's default folder (e.g., ~/) unless specifically asked to put it in the root directory (/). Do not use /root/ or / unless explicitly instructed by the user. Modify/Read files with appropriate permissions.`;
            if (serverContext && serverContext.user === 'root' && serverContext.standardHome) {
                effectivePrompt += `\nIMPORTANT: You are currently running as 'root', but the primary server user is '${serverContext.standardUser}'. You MUST target '${serverContext.standardHome}' instead of /root/ or ~/ for all basic file creation, folder operations, and app data unless explicitly instructed to use root. Change ownership to ${serverContext.standardUser} if needed.`;
            }
        } else if (useMode === 'command') {
            // Force strict command mode

        }



        // Use Edge Function with specified mode and chatHistory

        const edgeResult = await callGeminiViaEdgeFunction(effectivePrompt, serverContext, useMode, chatHistory);



        if (edgeResult.success) {

            let resultText = edgeResult.script;



            // Parsing Logic

            let message = resultText;

            let action = null;

            let navigateTo = null; // Initialize navigateTo

            let navigatePath = null; // Initialize navigatePath

            let safeToAutoRun = false; // Initialize safeToAutoRun



            if (useMode === 'json-command') {

                try {

                    const jsonMatch = resultText.match(/\{[\s\S]*\}/);

                    const jsonStr = jsonMatch ? jsonMatch[0] : resultText;

                    const parsed = JSON.parse(jsonStr);

                    message = parsed.summary || parsed.explanation || resultText;

                    action = parsed.command;

                    if (action === '""' || action === "null" || !action) action = null;

                } catch (e) {

                    message = resultText;

                }

            }

            else if (mode === 'chat') {

                // Conversational Mode: Keep message as is, but try to extract a command if it looks like one



                console.log("DEBUG: Raw AI Response:", resultText);



                // Extract code block as action if present (Extremely robust regex)

                // Capture anything between ``` and ```

                const codeBlockMatch = resultText.match(/```([\s\S]*?)```/);



                if (codeBlockMatch) {

                    // Group 1 is the content including the language tag line if present

                    let rawContent = codeBlockMatch[1];



                    // Strip the first line if it looks like a language tag (e.g. "bash" or "bash\n")

                    // This removes "bash\n" from the start of the action script

                    action = rawContent.replace(/^[a-zA-Z]*\n/, '').trim();



                    console.log("DEBUG: Code block matched!");



                    // Remove the entire code block from the message

                    message = resultText.replace(codeBlockMatch[0], '').trim();

                }

                // FALLBACK: Look for Shebang if backticks missing

                else if (resultText.includes('#!/bin/')) {

                    console.log("DEBUG: Shebang matched (Fallback)!");

                    const shebangIndex = resultText.indexOf('#!/bin/');



                    // Extract from shebang to the end

                    let scriptContent = resultText.substring(shebangIndex);



                    // We'll clean NAVIGATE_TO later if it's in there

                    action = scriptContent.trim();



                    // Message is everything before the shebang

                    message = resultText.substring(0, shebangIndex).trim();

                }

                else {

                    console.log("DEBUG: No code block match found.");

                    message = resultText;

                }



                // Extract navigation hint (remove it from message too if present)

                const navMatch = message.match(/NAVIGATE_TO:\s*(\w+)/i);

                if (navMatch) {

                    navigateTo = navMatch[1].trim().toLowerCase();

                    message = message.replace(navMatch[0], '').trim();

                }



                // Extract NAVIGATION PATH hint (e.g. NAVIGATE_PATH: /var/www)

                const navPathMatch = message.match(/NAVIGATE_PATH:\s*([^\n]+)/i);

                if (navPathMatch) {

                    navigatePath = navPathMatch[1].trim();

                    message = message.replace(navPathMatch[0], '').trim();

                }



                // Extract SAFE AUTORUN flag

                if (message.includes('SAFE_TO_AUTORUN: true') || resultText.includes('SAFE_TO_AUTORUN: true')) {

                    safeToAutoRun = true;

                    // Clean it up

                    message = message.replace(/SAFE_TO_AUTORUN: true/g, '').trim();

                }

            }

            else {

                // Legacy / Script Mode

                message = resultText.replace(/```bash\n?/g, '').replace(/```\n?/g, '').trim();

                const lines = message.split('\n').map(l => l.trim()).filter(l => l.length > 0);

                const finalCmd = lines.find(l => !l.startsWith('#')) || lines[0];

                if (finalCmd) action = finalCmd.replace(/\n/g, ' ').trim();



                if (mode === 'command') {

                    message = null;

                }

            }



            return { success: true, message, action, raw: resultText, navigateTo: navigateTo, navigatePath: navigatePath, safeToAutoRun: safeToAutoRun };



        } else {

            return { success: false, error: edgeResult.error };

        }

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// 24. Save Script to Server

ipcMain.handle('ssh:save-script', async (event, { filename, content }) => {

    if (!sshClient.isConnected) return { success: false, error: "Not connected" };

    try {

        // Ensure scripts directory exists

        await sshClient.exec('mkdir -p ~/.AlphaOps/scripts');



        // Save script (base64 encode to handle special characters)

        const b64 = Buffer.from(content).toString('base64');

        const saveCmd = `echo "${b64}" | base64 -d > ~/.AlphaOps/scripts/${filename}`;

        let res = await sshClient.exec(saveCmd);



        if (res.code !== 0) throw new Error(res.stderr);



        // Make executable

        res = await sshClient.exec(`chmod +x ~/.AlphaOps/scripts/${filename}`);



        // Return full path

        const pathRes = await sshClient.exec(`echo ~/.AlphaOps/scripts/${filename}`);

        const fullPath = pathRes.stdout.trim();



        return { success: true, path: fullPath };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



console.log('Registered Cron Handlers');



// --- CI/CD HANDLERS ---

const pipelinesPath = path.join(app.getPath('userData'), 'pipelines.json');



function getPipelines() {

    if (!fs.existsSync(pipelinesPath)) return [];

    try {

        return JSON.parse(fs.readFileSync(pipelinesPath));

    } catch { return []; }

}



function savePipelines(list) {

    fs.writeFileSync(pipelinesPath, JSON.stringify(list, null, 2));

}



ipcMain.handle('cicd:get-pipelines', async () => {

    return { success: true, pipelines: getPipelines() };

});



ipcMain.handle('cicd:save-pipeline', async (event, pipeline) => {

    try {

        if (!pipeline.name || !pipeline.stages) throw new Error("Invalid pipeline data");



        const list = getPipelines();

        if (pipeline.id) {

            const idx = list.findIndex(p => p.id === pipeline.id);

            if (idx !== -1) list[idx] = { ...list[idx], ...pipeline, updatedAt: new Date() };

        } else {

            pipeline.id = Date.now().toString();

            pipeline.createdAt = new Date();

            list.push(pipeline);

        }

        savePipelines(list);

        return { success: true };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



ipcMain.handle('cicd:delete-pipeline', async (event, id) => {

    const list = getPipelines().filter(p => p.id !== id);

    savePipelines(list);

    return { success: true };

});







// --- CI/CD PIPELINE EXECUTION ENGINE ---

ipcMain.removeHandler('cicd:run-pipeline'); // Prevent duplicate registration

ipcMain.handle('cicd:run-pipeline', async (event, { pipeline, serverConfig }) => {

    const window = BrowserWindow.fromWebContents(event.sender);

    const sendLog = (text, type = 'info') => {

        if (window && !window.isDestroyed()) {

            window.webContents.send('cicd:log', { text, type });

        }

    };



    try {

        sendLog(`Starting Pipeline: ${pipeline.name}`, 'info');



        // 1. Connect to Server if not already connected (or switch context)

        // For this implementation, we assume we use the active sshClient or connect if provided

        if (serverConfig) {

            sendLog(`Connecting to runner: ${serverConfig.host}...`, 'info');

            try {

                await sshClient.connect(serverConfig);

                sendLog(`Connected to ${serverConfig.host}`, 'success');

            } catch (err) {

                sendLog(`Connection failed: ${err.message}`, 'error');

                return { success: false, error: err.message };

            }

        } else if (!sshClient.isConnected) {

            sendLog(`No active server connection. Aborting.`, 'error');

            return { success: false, error: 'No connection' };

        }



        // 2. Resolve Execution Order (Topological Sort or Simple Sequence)

        // For MVP, we'll execute sequentially as defined in the array, 

        // but ideally we should respect 'needs'.

        // Let's at least respect 'needs' by checking if dependencies succeeded.

        // Since we are running sequentially on one server, we can just run them in order?

        // No, 'needs' defines order. 

        // Simple approach: Identify independent jobs, run them. Then their dependents.

        // For now, let's blindly trust the array order but skip if dependency failed (if we tracked it).

        // BETTER: Linearize the DAG.



        const jobs = pipeline.jobs || [];

        if (jobs.length === 0) {

            sendLog("No stages defined in pipeline.", 'warning');

            return { success: true };

        }



        // Simple topological sort

        const visited = new Set();

        const executionOrder = [];

        const visit = (jobId, ancestors) => {

            if (ancestors.has(jobId)) throw new Error("Circular dependency detected");

            if (visited.has(jobId)) return;



            const job = jobs.find(j => j.id === jobId);

            if (!job) return; // Should not happen



            ancestors.add(jobId);

            if (job.needs && job.needs.length > 0) {

                job.needs.forEach(depId => visit(depId, ancestors));

            }

            visited.add(jobId);

            executionOrder.push(job);

            ancestors.delete(jobId);

        };



        try {

            jobs.forEach(j => {

                if (!visited.has(j.id)) visit(j.id, new Set());

            });

        } catch (e) {

            sendLog(`Pipeline Error: ${e.message}`, 'error');

            return { success: false, error: e.message };

        }



        sendLog(`Resolved execution order: ${executionOrder.map(j => j.name).join(' -> ')}`, 'info');



        // 3. Execute Stages

        const context = {

            WORK_DIR: `/tmp/AlphaOps-builds/${pipeline.name.replace(/\s+/g, '-')}-${Date.now()}`

        };



        // Create workspace

        sendLog(`Creating workspace: ${context.WORK_DIR}`, 'info');

        await sshClient.exec(`mkdir -p ${context.WORK_DIR}`);



        for (const job of executionOrder) {

            sendLog(`\n>>> STAGE: ${job.name}`, 'info');



            if (!job.script || !job.script.trim()) {

                sendLog(`Skipping ${job.name} (No script provided)`, 'warning');

                continue;

            }



            // Prepare Script

            // We wrap it to fail fast

            const scriptPath = `${context.WORK_DIR}/${job.id}.sh`;

            // Add 'set -e' to stop on error

            const scriptContent = `#!/bin/bash\nset -e\ncd ${context.WORK_DIR}\n# User Script\n${job.script}`;



            await sshClient.writeFile(scriptPath, scriptContent);

            await sshClient.exec(`chmod +x ${scriptPath}`);



            sendLog(`Executing script...`, 'info');



            // Stream output? sshClient.exec isn't streaming effectively here, 

            // but we can try to tail a log file or just await result.

            // For now, await result to ensure reliability.



            const result = await sshClient.exec(`${scriptPath}`);



            if (result.stdout) sendLog(result.stdout, 'info');

            if (result.stderr) sendLog(result.stderr, result.code === 0 ? 'warning' : 'error');



            if (result.code !== 0) {

                sendLog(`!!! STAGE FAILED: ${job.name} (Exit Code: ${result.code})`, 'error');

                sendLog(`Pipeline execution stopped.`, 'error');

                return { success: false, error: `Stage ${job.name} failed` };

            }



            sendLog(`>>> STAGE COMPLETED: ${job.name}`, 'success');

        }



        // Cleanup? 

        // await sshClient.exec(`rm -rf ${context.WORK_DIR}`);



        sendLog(`\nPipeline Completed Successfully!`, 'success');

        return { success: true };



    } catch (err) {

        sendLog(`Pipeline System Error: ${err.message}`, 'error');

        return { success: false, error: err.message };

    }

});



// ==================== LOCAL STORAGE REPLACEMENT ====================



// Ensure .AlphaOps/keys exists

const AlphaOps_DIR = path.join(os.homedir(), '.AlphaOps');

const KEYS_DIR = path.join(AlphaOps_DIR, 'keys');



if (!fs.existsSync(AlphaOps_DIR)) {

    try { fs.mkdirSync(AlphaOps_DIR); } catch (e) { console.error("Failed to create .AlphaOps dir", e); }

}

if (!fs.existsSync(KEYS_DIR)) {

    try { fs.mkdirSync(KEYS_DIR); } catch (e) { console.error("Failed to create keys dir", e); }

}



ipcMain.handle('ssh:save-local-key', async (event, { sourcePath, host, username }) => {

    try {

        if (!sourcePath) throw new Error("No source path provided");

        if (!fs.existsSync(sourcePath)) throw new Error("Source key file not found: " + sourcePath);



        // Create a unique filename: host_username.pem (sanitize)

        const safeHost = host.replace(/[^a-zA-Z0-9.-]/g, '_');

        const safeUser = username.replace(/[^a-zA-Z0-9.-]/g, '_');

        const ext = path.extname(sourcePath) || '.pem';

        const fileName = `${safeHost}_${safeUser}${ext}`;

        const destPath = path.join(KEYS_DIR, fileName);



        // Copy file

        fs.copyFileSync(sourcePath, destPath);



        // Set restricted permissions (platform dependent, but good practice)

        try {

            if (process.platform !== 'win32') fs.chmodSync(destPath, 0o600);

        } catch (e) {

            console.warn("Failed to set chmod on key", e);

        }



        return { success: true, fileName, fullPath: destPath };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



ipcMain.handle('ssh:get-local-key', async (event, fileName) => {

    try {

        if (!fileName) return { success: false, error: "No filename provided" };

        const keyPath = path.join(KEYS_DIR, fileName);

        if (fs.existsSync(keyPath)) {

            return { success: true, path: keyPath };

        }

        return { success: false, error: "Key file not found: " + fileName };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



ipcMain.handle('ssh:read-local-file', async (event, filePath) => {

    try {

        if (!filePath) return { success: false, error: "No path provided" };

        if (!fs.existsSync(filePath)) return { success: false, error: "File not found" };



        const content = fs.readFileSync(filePath, 'utf8');

        return { success: true, content };

    } catch (e) {

        return { success: false, error: e.message };

    }

});



// ==================== MONITORING WINDOW IPC HANDLERS ====================

// These handlers support the standalone monitoring window that runs in a separate tmux-like session



let monitoringWindow = null;



ipcMain.handle('monitoring:get-backend-url', async () => {

    return {

        success: true,

        url: DESKTOP_BACKEND_BASE_URL,

        session: 'AlphaOps-monitoring'

    };

});



ipcMain.handle('monitoring:set-always-on-top', async (event, value) => {

    if (monitoringWindow && !monitoringWindow.isDestroyed()) {

        monitoringWindow.setAlwaysOnTop(value);

    }

    return { success: true };

});



// Create or show monitoring window

ipcMain.handle('monitoring:create-window', async () => {

    if (!monitoringWindow || monitoringWindow.isDestroyed()) {

        monitoringWindow = new BrowserWindow({

            width: 1400,

            height: 900,

            minWidth: 1200,

            minHeight: 700,

            title: 'AlphaOps - Server Monitoring',

            backgroundColor: '#f1f5f9',

            show: false,

            webPreferences: {

                nodeIntegration: true,

                contextIsolation: false,

                preload: path.join(__dirname, 'monitoring-preload.js')

            }

        });



        monitoringWindow.loadFile(path.join(__dirname, 'monitoring-modern.html'));



        monitoringWindow.once('ready-to-show', () => {

            monitoringWindow.show();

        });



        monitoringWindow.on('close', (event) => {

            if (!app.isQuitting) {

                event.preventDefault();

                monitoringWindow.hide();

            }

        });



        monitoringWindow.on('closed', () => {

            monitoringWindow = null;

        });

    } else {

        monitoringWindow.show();

        monitoringWindow.focus();

    }



    return { success: true };

});



// Notify monitoring window of server connection

ipcMain.handle('monitoring:notify-connection', async (event, serverId) => {

    if (monitoringWindow && !monitoringWindow.isDestroyed()) {

        monitoringWindow.webContents.send('monitoring:server-connected', serverId);

    }

    return { success: true };

});



// Forward stats updates to monitoring window

ipcMain.handle('monitoring:update-stats', async (event, stats) => {

    if (monitoringWindow && !monitoringWindow.isDestroyed()) {

        monitoringWindow.webContents.send('monitoring:stats-update', stats);

    }

    return { success: true };

});

