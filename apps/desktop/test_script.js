
            const { ipcRenderer, shell } = require('electron');

            // DEBUG: catch global errors
            window.onerror = function (message, source, lineno, colno, error) {
                alert('JS Error: ' + message + '\nLine: ' + lineno);
            };

            // DEBUG: confirm script start
            // alert('Script Started');

            window.ipcRenderer = ipcRenderer;

            window.shell = shell;

            // SSH Command Bridge: Handle commands from monitoring iframe
            window.addEventListener('message', async (event) => {
                const msg = event.data;

                // Handle stats update from monitoring page
                if (msg && msg.type === 'monitoring-stats-update') {
                    console.log('[main] ✓ Received stats update from monitoring page');

                    // Update dashboard with monitoring page data
                    if (msg.stats) {
                        updateDashboardFromMonitoring(msg.stats);
                        updateTopBarFromMonitoring(msg.stats);
                    }
                    return;
                }

                // Only process remaining messages from our iframe
                const monFrame = document.getElementById('monitoring-modern-frame');
                if (event.source !== monFrame?.contentWindow) return;

                // Handle close monitoring request
                if (msg && msg.type === 'close-monitoring') {
                    console.log('[main] Closing monitoring view');
                    navigate('dashboard');
                    return;
                }

                // Handle config request from monitoring iframe
                if (msg && msg.type === 'monitoring-request-config') {
                    console.log('[main] Monitoring iframe requested config, sending...');
                    pushMonitoringConfigToIframe();
                    return;
                }

                // Handle SSH command execution
                if (msg && msg.type === 'ssh-exec-request') {
                    try {
                        const result = await ipcRenderer.invoke('ssh:execute', msg.command);
                        monFrame.contentWindow.postMessage({
                            type: 'ssh-exec-response',
                            id: msg.id,
                            result: result.success ? result.data.stdout : null
                        }, '*');
                    } catch (e) {
                        monFrame.contentWindow.postMessage({
                            type: 'ssh-exec-response',
                            id: msg.id,
                            result: null
                        }, '*');
                    }
                }
            });

            // Update dashboard from monitoring page data
            function updateDashboardFromMonitoring(stats) {
                if (!stats) return;

                // Convert monitoring stats format to dashboard format
                const dashStats = {
                    cpu: stats.cpu,
                    ram: stats.memory,
                    disk: stats.disk,
                    load1: stats.load1,
                    load5: stats.load5,
                    load15: stats.load15,
                    memUsed: stats.memUsed,
                    memFree: stats.memFree,
                    networkRx: stats.networkRx / 1024, // Convert to MB/s
                    networkTx: stats.networkTx / 1024, // Convert to MB/s
                };

                // Use existing updateDashboardUI function
                updateDashboardUI(dashStats);

                console.log('[main] ✓ Dashboard updated from monitoring data');
            }

            // Update top bar from monitoring page data
            function updateTopBarFromMonitoring(stats) {
                if (!stats) return;

                // Update header stats
                const hCpu = document.getElementById('header-cpu');
                const hRam = document.getElementById('header-ram');
                const hDisk = document.getElementById('header-disk');

                if (hCpu) hCpu.innerText = `${Math.round(stats.cpu)}%`;
                if (hRam) hRam.innerText = `${Math.round(stats.memory)}%`;
                if (hDisk) hDisk.innerText = `${Math.round(stats.disk)}%`;

                console.log('[main] ✓ Top bar updated from monitoring data');
            }

            // Listen for log events from main process (Command Logger)

            ipcRenderer.on('ssh:log-event', (event, { cmd, success }) => {

                const actor = connectedServerData?.username || 'system';

                console.log(`[Activity Log] ${actor}:`, cmd, success);



                // Pass actor to logs

                if (typeof addToGlobalLog === 'function') {

                    addToGlobalLog(cmd, success, actor);

                }

            });



            let isConnected = false;
            let statsInterval = null;
            let editingServerId = null;
            let currentFilesPath = '~';
            let currentView = 'servers';
            let connectedServerData = null;
            let connectionMode = 'agent';
            let dashboardInterval = null; // Moved up
            const POLLING_INTERVAL_KEY = 'devyntra-monitoring-refresh-interval';
            let dashboardPollingInterval = 5000; // Default 5 seconds
            let agentsTableAvailable = false; // Disabled - agents table not used

            const { createClient } = require('@supabase/supabase-js');
            const SUPABASE_URL = 'https://psnrofnlgpqkfprjrbnm.supabase.co';
            const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBzbnJvZm5sZ3Bxa2ZwcmpyYm5tIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwNDYyMzksImV4cCI6MjA4MzYyMjIzOX0.oYlLKiEI7cO03H4IGyMV0r2HqJYo30tadfnl-XZZZMI';
            try {
                console.log('[supabase] dashboard config', {
                    url: SUPABASE_URL,
                    anonKeyPrefix: String(SUPABASE_ANON_KEY || '').slice(0, 24),
                });
            } catch (e) { }
            const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

            // --- SESSION RESTORATION FOR ELECTRON ---
            // Restore session from main process (set by auth-renderer before navigation)
            async function restoreSessionFromMain() {
                try {
                    const result = await ipcRenderer.invoke('auth:get-session');
                    if (result?.success && result?.session?.access_token) {
                        const { access_token, refresh_token } = result.session;
                        const { error } = await supabase.auth.setSession({
                            access_token,
                            refresh_token
                        });
                        if (error) {
                            console.error('[index] Failed to set session:', error);
                        } else {
                            console.log('[index] Session restored from main process');
                        }
                    }
                } catch (e) {
                    console.error('[index] Failed to restore session:', e);
                }
            }

            // Restore session immediately
            restoreSessionFromMain();

            async function pushMonitoringConfigToIframe() {
                const frame = document.getElementById('monitoring-modern-frame');
                if (!frame || !frame.contentWindow) return;

                let token = window.__DEVYNTRA_ACCESS_TOKEN;
                if (!token) {
                    try {
                        token = await ipcRenderer.invoke('auth:get-token');
                    } catch (e) { }
                }

                const backendUrl = (window.__DEVYNTRA_BACKEND_URL || '').toString().replace(/\/+$/, '');
                const serverId = connectedServerData?.id || '';

                frame.contentWindow.postMessage({
                    type: 'devyntra-monitoring-config',
                    backendUrl,
                    token,
                    serverId
                }, '*');
            }

            // LOCAL KEYPAIR STORAGE (for when cloud sync is disabled)

            // LOCAL KEYPAIR STORAGE REPLACEMENT

            async function saveLocalKeypair(host, username, sourcePath) {

                try {

                    const res = await ipcRenderer.invoke('ssh:save-local-key', { host, username, sourcePath });

                    if (res.success) {

                        console.log("Key saved locally at:", res.fullPath);

                        return res.fileName; // Return filename to be stored

                    } else {

                        console.error("Failed to save local key:", res.error);

                        return sourcePath; // Fallback to original

                    }

                } catch (e) {

                    console.error("Failed to save local keypair:", e);

                    return sourcePath;

                }

            }



            // Helper to resolve key path

            async function resolveKeyPath(pathOrName) {

                if (!pathOrName) return '';

                // If it looks like a filename (no / or \), try resolved (or simple check)

                if (!pathOrName.includes('/') && !pathOrName.includes('\\')) {

                    const res = await ipcRenderer.invoke('ssh:get-local-key', pathOrName);

                    if (res.success) return res.path;

                }

                return pathOrName;

            }



            // --- 1. CONNECTIVITY LOGIC ---

            const loginForm = document.getElementById('ssh-form');

            const errorMsg = document.getElementById('conn-error');

            const connectBtn = document.getElementById('connect-btn');

            const modal = document.getElementById('connection-modal');

            const pageTitle = document.getElementById('header-server-name');



            let agentPollInterval = null;

            let agentCopiedTimeout = null;

            let agentInstallCommand = '';

            let agentEnrollData = null;



            function closeConnectionModal() {

                if (agentPollInterval) {

                    clearInterval(agentPollInterval);

                    agentPollInterval = null;

                }

                if (agentCopiedTimeout) {

                    clearTimeout(agentCopiedTimeout);

                    agentCopiedTimeout = null;

                }

                modal.classList.add('hidden');

            }



            function setAgentStatus(status, text) {
                const dot = document.getElementById('agent-status-dot');
                const label = document.getElementById('agent-status-text');
                if (dot) {
                    const color = status === 'connected'
                        ? 'bg-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.8)]'
                        : status === 'connecting'
                            ? 'bg-indigo-600 shadow-[0_0_20px_rgba(79,70,229,0.8)]'
                            : 'bg-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.8)]';

                    dot.className = `relative z-10 w-6 h-4 sm:h-6 rounded-full border-2 border-white transition-all duration-700 ease-in-out ${color}`;
                }
                if (label && text) label.innerText = text;
            }



            async function startAgentPolling(agentId, serverName) {

                if (!agentId) return;

                if (agentPollInterval) clearInterval(agentPollInterval);

                setAgentStatus('waiting', 'Waiting for agent to come online...');

                agentPollInterval = setInterval(async () => {

                    try {

                        const status = await ipcRenderer.invoke('agent:status', { agentId });

                        if (status?.success && status.online) {

                            clearInterval(agentPollInterval);

                            agentPollInterval = null;

                            setAgentStatus('connecting', 'Agent online. Securing connection...');

                            const result = await ipcRenderer.invoke('agent:connect', { agentId });

                            if (result.success) {

                                onConnectionSuccess({

                                    host: `agent:${agentId}`,

                                    username: 'agent',

                                    keyPath: '',

                                    isElastic: false,

                                    shouldSaveToCloud: true,

                                    serverName,

                                    id: Date.now().toString(),

                                    mode: 'agent'

                                });

                            } else {

                                showError(result.error || 'Agent connection failed');

                                resetBtn();

                            }

                        }

                    } catch (e) {

                    }

                }, 3000);

            }





            /* 

            function setConnectionMode(mode) {

                // ... removed (duplicate) ...

            }

            */



            async function generateAgentInstall() {
                try {
                    setAgentStatus('waiting', 'Generating secure link...');
                    const genBtn = document.getElementById('agent-generate-btn');
                    if (genBtn) {
                        genBtn.disabled = true;
                        genBtn.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Generating...';
                    }

                    const res = await ipcRenderer.invoke('agent:enroll');
                    if (!res || res.success === false) {
                        showError(res?.error || 'Failed to generate agent command');
                        return;
                    }
                    agentEnrollData = res;
                    const cmdRaw = String(res.installCommand || '');
                    const cmd = cmdRaw.replace(/\\\r?\n/g, '').replace(/\r?\n/g, ' ').trim();

                    agentInstallCommand = cmd;

                    const cmdEl = document.getElementById('agent-install-cmd');
                    if (cmdEl) cmdEl.textContent = cmd;

                    const emptyEl = document.getElementById('agent-command-empty');
                    const boxEl = document.getElementById('agent-command-box');
                    if (emptyEl) emptyEl.classList.add('hidden');
                    if (boxEl) boxEl.classList.remove('hidden');

                    const serverName = document.getElementById('server-name').value.trim();
                    await startAgentPolling(res.agentId, serverName);
                } catch (e) {
                    showError(e.message || 'Failed to generate agent command');
                } finally {
                    const genBtn = document.getElementById('agent-generate-btn');
                    if (genBtn) {
                        genBtn.disabled = false;
                        genBtn.innerHTML = agentInstallCommand ? '<i class="fas fa-sync-alt mr-2"></i> Regenerate' : 'GENERATE COMMAND';
                    }
                }
            }

            function copyAgentInstallCommand() {
                const cmd = String(agentInstallCommand || '').trim();
                if (!cmd) return;
                try {
                    navigator.clipboard.writeText(cmd);
                    const btn = document.querySelector('[onclick="copyAgentInstallCommand()"]');
                    if (btn) {
                        const icon = btn.querySelector('i');
                        const originalClass = icon.className;
                        icon.className = 'fas fa-check text-emerald-500';
                        setTimeout(() => icon.className = originalClass, 1500);
                    }
                } catch (e) {
                    console.error("Copy failed:", e);
                }
            }



            /*

            loginForm.addEventListener('submit', async (e) => {

                 // ... removed (duplicate logic) ...

            });

            */



            function showError(msg) {

                errorMsg.innerText = msg;

                errorMsg.classList.remove('hidden');

            }



            function resetBtn() {

                if (!connectBtn) return;

                connectBtn.disabled = false;

                connectBtn.innerHTML = '<span>Connect</span><i class="fas fa-arrow-right ml-2"></i>';

            }



            function showLoader(title = "Loading...", desc = "Please wait") {

                const loader = document.getElementById('global-loader');

                const titleEl = document.getElementById('loader-title');

                const descEl = document.getElementById('loader-desc');



                if (titleEl) titleEl.innerText = title;

                if (descEl) descEl.innerText = desc;



                loader.classList.remove('hidden');

            }



            function hideLoader() {

                document.getElementById('global-loader').classList.add('hidden');

            }



            // --- 2. REAL-TIME MONITORING ---

            function startMonitoring() {

                // Check if monitoring page is active - if so, don't start separate polling
                const monFrame = document.getElementById('monitoring-modern-frame');
                if (monFrame && monFrame.style.display !== 'none') {
                    console.log('[topbar] Monitoring page is active - using its data feed');
                    return;
                }

                // Initial Fetch

                fetchStats();

                // Load saved interval
                loadDashboardPollingInterval();

                // Poll with saved interval

                statsInterval = setInterval(fetchStats, dashboardPollingInterval);

                console.log('[topbar] Started with interval:', dashboardPollingInterval);

                // Also check for interval changes periodically
                const topBarIntervalChecker = setInterval(() => {
                    const saved = localStorage.getItem(POLLING_INTERVAL_KEY);
                    if (saved) {
                        const interval = parseInt(saved);
                        if (!isNaN(interval) && interval > 0 && interval !== dashboardPollingInterval) {
                            console.log('[topbar] ✓✓✓ Detected interval change:', interval);
                            dashboardPollingInterval = interval;

                            if (statsInterval) {
                                clearInterval(statsInterval);
                                statsInterval = setInterval(fetchStats, interval);
                                console.log('[topbar] ✓ Restarted with new interval:', interval);
                            }
                        }
                    }
                }, 1000);

            }





            function updateConnectionStatus(isOnline) {

                const dot = document.getElementById('status-dot');

                const text = document.getElementById('status-text');

                const headerStats = document.getElementById('header-stats');



                if (dot && text) {

                    if (isOnline) {

                        dot.className = "w-2.5 h-2.5 bg-green-500 rounded-full mr-2 animate-pulse";

                        text.className = "font-medium text-green-700 mr-1";

                        text.innerText = "Active & Secure";

                    } else {

                        dot.className = "w-2.5 h-2.5 bg-red-500 rounded-full mr-2";

                        text.className = "font-medium text-red-700 mr-1";

                        text.innerText = "Offline / Connection Lost";

                    }

                }



                if (headerStats) {

                    if (isOnline) headerStats.classList.remove('hidden');

                    else headerStats.classList.add('hidden');

                }

            }



            async function fetchStats() {

                if (!isConnected) return;



                // If dashboard is active and stats haven't been loaded yet, keep skeletons (handled by template)

                // But if we want to force skeleton on manual refresh:

                // if (currentView === 'dashboard' && isFirstLoad) ...



                const res = await ipcRenderer.invoke('ssh:get-stats');

                if (res.success && res.stats) {

                    updateDashboardUI(res.stats);

                    updateConnectionStatus(true);

                } else {

                    // If stats fail, it's likely a connection issue

                    updateConnectionStatus(false);

                }

            }





            // Dashboard mini-history for sparklines (separate from monitoring page)

            const dashHistory = { cpu: [], ram: [], net: [] };

            const DASH_MAX_PTS = 20;



            function drawDashSparkline(canvasId, data, color, fillColor) {

                const canvas = document.getElementById(canvasId);

                if (!canvas) return;

                const ctx = canvas.getContext('2d');

                const dpr = window.devicePixelRatio || 1;

                const w = canvas.clientWidth * dpr;

                const h = canvas.clientHeight * dpr;

                canvas.width = w; canvas.height = h;

                ctx.clearRect(0, 0, w, h);

                if (data.length < 2) return;

                const max = Math.max(...data, 1);

                const pad = 2 * dpr;

                const uw = w - pad * 2;

                const uh = h - pad * 2;

                ctx.beginPath();

                ctx.moveTo(pad, h - pad - (data[0] / max) * uh);

                for (let i = 1; i < data.length; i++) {

                    const x = pad + (i / (data.length - 1)) * uw;

                    const y = h - pad - (data[i] / max) * uh;

                    ctx.lineTo(x, y);

                }

                ctx.strokeStyle = color;

                ctx.lineWidth = 1.5 * dpr;

                ctx.lineJoin = 'round';

                ctx.stroke();

                ctx.lineTo(pad + uw, h - pad);

                ctx.lineTo(pad, h - pad);

                ctx.closePath();

                const grad = ctx.createLinearGradient(0, 0, 0, h);

                grad.addColorStop(0, fillColor);

                grad.addColorStop(1, 'rgba(255,255,255,0)');

                ctx.fillStyle = grad;

                ctx.fill();

            }



            function getSkeletonHtml(type) {

                // Specialized Monitoring Skeleton

                if (type === 'monitoring') {

                    return `

            <!-- EXECUTIVE PULSE ROW (High-Performance Redesign) -->

            <div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">

                ${Array(6).fill('<div class="skeleton bg-white rounded-[28px] h-[100px] border border-gray-100"></div>').join('')}

            </div>



            <!-- TELEMETRY RADIAL GAUGES (CLEAN PREMIUM LIGHT MODE) -->

            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">

                ${Array(4).fill('<div class="skeleton bg-white rounded-[24px] h-[260px] border border-gray-100"></div>').join('')}

            </div>



            <!-- PRIMARY METRICS WITH GRAPHS - VISIBLE FIRST -->

            <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

                <!-- Tall Cards: Compute, Memory, Hardware, OS -->

                ${Array(4).fill('<div class="skeleton bg-white rounded-[32px] h-[360px] border border-gray-100"></div>').join('')}

                <!-- Shorter Cards: Kernel, Security -->

                ${Array(2).fill('<div class="skeleton bg-white rounded-[32px] h-[240px] border border-gray-100"></div>').join('')}

            </div>



            <!-- SYSTEM INFORMATION CARDS - BENTO GRID -->

            <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">

                ${Array(2).fill('<div class="skeleton bg-white rounded-[32px] h-[240px] border border-gray-100"></div>').join('')}

            </div>



            <!-- CONTAINER OPS & PROCESS SENTINEL -->

            <div class="space-y-6">

                <!-- Container Ops -->

                <div class="skeleton bg-white rounded-[32px] h-[220px] border border-gray-100"></div>

                <!-- Process Sentinel Table -->

                <div class="skeleton bg-white rounded-[32px] h-[600px] border border-gray-100"></div>

            </div>

        `;

                }

                // Generic Card Grid (Apps, Security)

                if (type === 'card-grid') {

                    return Array(6).fill(0).map(() => `

                        <div class="skeleton-card bg-white p-6 rounded-2xl border border-gray-100 space-y-4">

                            <div class="flex justify-between items-start">

                                <div class="skeleton w-12 h-12 rounded-xl"></div>

                                <div class="skeleton w-16 h-4 rounded"></div>

                            </div>

                            <div class="skeleton w-3/4 h-6 rounded mt-2"></div>

                            <div class="skeleton w-1/2 h-4 rounded"></div>

                            <div class="mt-auto pt-4 flex gap-2">

                                <div class="skeleton flex-1 h-10 rounded-xl"></div>

                                <div class="skeleton flex-1 h-10 rounded-xl"></div>

                            </div>

                        </div>

                    `).join('');

                }



                // List Items (Tasks, Users)

                if (type === 'list-items') {

                    return Array(5).fill(0).map(() => `

                        <div class="bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between mb-3">

                            <div class="flex items-center gap-4">

                                <div class="skeleton w-10 h-10 rounded-lg"></div>

                                <div class="space-y-2">

                                    <div class="skeleton w-32 h-4 rounded"></div>

                                    <div class="skeleton w-24 h-3 rounded opacity-50"></div>

                                </div>

                            </div>

                            <div class="skeleton w-20 h-8 rounded-lg"></div>

                        </div>

                    `).join('');

                }



                // Table Rows (Files)

                if (type === 'table-rows') {

                    return Array(6).fill(0).map(() => `

                        <tr class="border-b border-gray-50 last:border-0">

                            <td class="p-4"><div class="skeleton w-5 h-5 rounded"></div></td>

                            <td class="p-4"><div class="skeleton w-48 h-4 rounded"></div></td>

                            <td class="p-4"><div class="skeleton w-20 h-4 rounded"></div></td>

                            <td class="p-4"><div class="skeleton w-24 h-4 rounded"></div></td>

                            <td class="p-4"><div class="skeleton w-8 h-8 rounded-lg ml-auto"></div></td>

                        </tr>

                    `).join('');

                }



                // Small Stats Value (Legacy/Generic)

                if (type === 'stats-value') {

                    return `<div class="skeleton w-12 h-4 rounded bg-gray-100/80"></div>`;

                }



                // Dashboard Large Stat (e.g. 45%)

                if (type === 'dash-stat-lg') {

                    return `<div class="skeleton w-10 h-5 rounded-md bg-gray-100/80 inline-block align-middle"></div>`;

                }



                // Dashboard Small Stat (e.g. 10 KB/s)

                if (type === 'dash-stat-sm') {

                    return `<div class="skeleton w-12 h-2.5 rounded bg-gray-100/80 inline-block align-middle"></div>`;

                }



                return `<div class="skeleton h-32 w-full rounded-xl"></div>`;

            }



            function updateDashboardUI(stats) {

                if (!stats) return;



                // Sync Loading: If showing skeletons, wait for ALL critical data before rendering anything.

                // This prevents "pop-in" effect where some cards show numbers and others show skeletons.

                const checkCpuEl = document.getElementById('dash-cpu');

                const isSkeleton = checkCpuEl && checkCpuEl.innerHTML.includes('skeleton');



                if (isSkeleton) {

                    // We require CPU, RAM, Disk to be present to unveil the dashboard

                    const hasData = stats.cpu !== undefined && stats.ram !== undefined && stats.disk !== undefined;

                    if (!hasData) return; // Wait for next heartbeat

                }



                // 1. HEADER STATS (Realtime Global)

                const hCpu = document.getElementById('header-cpu'); // Keep original variable name

                const hRam = document.getElementById('header-ram');

                const hDisk = document.getElementById('header-disk');



                if (hCpu) hCpu.innerText = `${Math.round(stats.cpu)}%`;

                if (hRam) hRam.innerText = `${Math.round(stats.ram)}%`;

                if (hDisk) hDisk.innerText = `${Math.round(stats.disk)}%`;



                // 2. CARD STATS (Specific Server Card)

                if (connectedServerData && connectedServerData.id) {

                    const cardStats = document.getElementById(`card-stats-${connectedServerData.id}`);

                    if (cardStats) {

                        cardStats.classList.remove('hidden');

                        cardStats.querySelector('.stat-cpu').innerText = `${Math.round(stats.cpu)}%`;

                        cardStats.querySelector('.stat-ram').innerText = `${Math.round(stats.ram)}%`;

                        cardStats.querySelector('.stat-disk').innerText = `${Math.round(stats.disk)}%`;

                    }

                }



                // Sidebar Footer Elements

                const sidebarStats = document.querySelectorAll('.w-72 .w-full.bg-gray-200');

                if (sidebarStats.length >= 2) {

                    const cpuContainer = sidebarStats[0];

                    const cpuFill = cpuContainer.querySelector('div');

                    const cpuText = cpuContainer.previousElementSibling.lastElementChild;

                    if (cpuFill) cpuFill.style.width = `${stats.cpu}%`;

                    if (cpuText) cpuText.innerText = `${Number(stats.cpu).toFixed(1)}%`;

                    const ramContainer = sidebarStats[1];

                    const ramFill = ramContainer.querySelector('div');

                    const ramText = ramContainer.previousElementSibling.lastElementChild;

                    if (ramFill) ramFill.style.width = `${stats.ram}%`;

                    if (ramText) ramText.innerText = `${Number(stats.ram).toFixed(1)}%`;

                }



                // 3. DASHBOARD PERFORMANCE CARDS

                const dCpu = document.getElementById('dash-cpu');

                const dCpuBar = document.getElementById('dash-cpu-bar');

                if (dCpu) dCpu.innerText = `${Math.round(stats.cpu)}%`;

                if (dCpuBar) dCpuBar.style.width = `${stats.cpu}%`;



                const dRam = document.getElementById('dash-ram');

                const dRamBar = document.getElementById('dash-ram-bar');

                if (dRam) dRam.innerText = `${Math.round(stats.ram)}%`;

                if (dRamBar) dRamBar.style.width = `${stats.ram}%`;



                const dDisk = document.getElementById('dash-disk');

                const dDiskBar = document.getElementById('dash-disk-bar');

                if (dDisk) dDisk.innerText = `${Math.round(stats.disk)}%`;

                if (dDiskBar) dDiskBar.style.width = `${stats.disk}%`;



                // Uptime & OS

                const uptimeEl = document.getElementById('dash-uptime');

                if (uptimeEl) uptimeEl.innerText = stats.uptime || 'N/A';



                const osEl = document.getElementById('dash-os');

                if (osEl) {

                    if (stats.os) osEl.innerText = stats.os.replace('Description:', '').trim();

                    else if (osEl.innerHTML.includes('skeleton')) osEl.innerText = 'Linux (Detecting...)';

                }



                const kernelEl = document.getElementById('dash-kernel');

                if (kernelEl) {

                    if (stats.kernel) kernelEl.innerText = stats.kernel;

                    else if (kernelEl.innerHTML.includes('skeleton')) kernelEl.innerText = '--';

                }



                const ipEl = document.getElementById('dash-ip');

                if (ipEl) {

                    if (stats.ip) ipEl.innerText = stats.ip;

                    else if (ipEl.innerHTML.includes('skeleton')) ipEl.innerText = '127.0.0.1';

                }



                // Push to dashboard history for sparklines

                dashHistory.cpu.push(parseFloat(stats.cpu) || 0);

                if (dashHistory.cpu.length > DASH_MAX_PTS) dashHistory.cpu.shift();

                dashHistory.ram.push(parseFloat(stats.ram) || 0);

                if (dashHistory.ram.length > DASH_MAX_PTS) dashHistory.ram.shift();



                // Draw dashboard sparklines

                requestAnimationFrame(() => {

                    drawDashSparkline('dash-cpu-spark', dashHistory.cpu, '#10b981', 'rgba(16,185,129,0.12)');

                    drawDashSparkline('dash-ram-spark', dashHistory.ram, '#6366f1', 'rgba(99,102,241,0.12)');

                    // Network sparkline (use monitoring history if available)

                    if (monHistory && monHistory.netIn && monHistory.netIn.length > 1) {

                        drawDashSparkline('dash-net-spark', monHistory.netIn.slice(-DASH_MAX_PTS), '#3b82f6', 'rgba(59,130,246,0.12)');

                    }

                });



                // Update detail labels if monitoring data is available

                // Update detail labels if monitoring data is available

                // RAM Detail removed

                // CPU Detail removed

                const netIn = document.getElementById('dash-net-in');

                const netOut = document.getElementById('dash-net-out');

                const netDetail = document.getElementById('dash-net-detail');



                // Use latest richer data if available

                const d = window.latestMonData;



                if (netIn && typeof monHistory !== 'undefined' && monHistory.netIn.length > 0) {

                    const lastIn = monHistory.netIn[monHistory.netIn.length - 1] || 0;

                    const lastOut = monHistory.netOut[monHistory.netOut.length - 1] || 0;

                    netIn.innerHTML = `<i class="fas fa-arrow-down mr-0.5"></i>${typeof formatBytesRate === 'function' ? formatBytesRate(lastIn) : '--'}`;

                    netOut.innerHTML = `<i class="fas fa-arrow-up mr-0.5"></i>${typeof formatBytesRate === 'function' ? formatBytesRate(lastOut) : '--'}`;

                }



                // Populate detailed stats if available

                if (d) {

                    // CPU Detail

                    const cpuDetail = document.getElementById('dash-cpu-detail');

                    if (cpuDetail && d.processes) cpuDetail.innerText = `${d.processes.length} processes`;



                    // RAM Detail

                    const ramDetail = document.getElementById('dash-ram-detail');

                    if (ramDetail && d.memTotal && d.memUsed) {

                        ramDetail.innerText = `${formatBytes(d.memUsed)} / ${formatBytes(d.memTotal)}`;

                    }



                    // Disk Detail (Calculate Free)

                    const diskDetail = document.getElementById('dash-disk-detail');

                    if (diskDetail && d.diskUsed && d.diskPct) {

                        try {

                            const total = d.diskUsed / (d.diskPct / 100);

                            const free = total - d.diskUsed;

                            diskDetail.innerText = `${formatBytes(free)} free`;

                        } catch (e) { diskDetail.innerText = '--'; }

                    }



                    // Net Detail

                    if (netDetail && d.netConns) netDetail.innerText = `${d.netConns} connections`;

                }

            }









            // --- GLOBAL LOG STORE ---

            // Store recent logs for the UI

            // --- GLOBAL LOG STORE ---

            // Store recent logs for the UI

            let globalActivityLog = [];

            // globalActivityLog not persisted to localStorage anymore



            function addToGlobalLog(cmd, success) {

                // Deduplicate: Don't add if identical to the very last command (prevents polling spam spam)

                if (globalActivityLog.length > 0 && globalActivityLog[0].cmd === cmd && (Date.now() - globalActivityLog[0].timestamp) < 2000) {

                    return;

                }



                const entry = {

                    cmd: cmd,

                    success: success,

                    time: new Date().toLocaleTimeString(),

                    timestamp: Date.now()

                };

                globalActivityLog.unshift(entry);

                if (globalActivityLog.length > 100) globalActivityLog.pop(); // Increased limit



                // Persist

                // Removed localStorage persistence



                // If dashboard is active, update it

                if (currentView === 'dashboard') updateDashboardLog();

                if (currentView === 'history') updateHistoryLog();

            }



            function updateDashboardLog() {

                const container = document.getElementById('dashboard-activity-log');

                if (!container) return;



                // FILTER: interesting commands only for Dashboard

                const interestingKeywords = ['deploy', 'install', 'delete', 'remove', 'systemctl', 'pm2', 'ssh connect', 'upload', 'zip', 'unzip', 'mv ', 'git '];

                const filteredLogs = globalActivityLog.filter(log => {

                    const c = log.cmd.toLowerCase();

                    // Exclude mundane

                    if (c.startsWith('ls ') || c === 'ls' || c === 'pwd' || c.startsWith('cat ') || c.startsWith('echo ')) return false;

                    // Include if keyword match

                    return interestingKeywords.some(k => c.includes(k));

                });



                if (filteredLogs.length === 0) {

                    container.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No recent important activity.</div>';

                    return;

                }



                container.innerHTML = filteredLogs.slice(0, 5).map(log => `

                 <div class="p-4 flex items-center hover:bg-gray-50 transition-colors">

                    <div class="w-8 h-8 rounded-full bg-${log.success ? 'green' : 'red'}-100 text-${log.success ? 'green' : 'red'}-600 flex items-center justify-center mr-4">

                        <i class="fas ${log.success ? 'fa-terminal' : 'fa-times'}"></i>

                    </div>

                    <div class="flex-1 overflow-hidden">

                        <div class="flex justify-between">

                            <p class="text-sm font-bold text-gray-900 truncate" title="${log.cmd}">${log.cmd}</p>

                            <span class="text-xs text-gray-400 whitespace-nowrap ml-2">${log.time}</span>

                        </div>

                        <p class="text-xs text-gray-500 mt-0.5">${log.success ? 'Command executed' : 'Execution failed'}</p>

                    </div>

                </div>

            `).join('');

            }



            function updateHistoryLog() {

                const container = document.getElementById('full-history-log');

                if (!container) return;



                if (globalActivityLog.length === 0) {

                    container.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">History is empty.</div>';

                    return;

                }



                container.innerHTML = globalActivityLog.map(log => `

                 <div class="p-4 flex items-center hover:bg-gray-50 transition-colors">

                    <div class="w-10 h-10 rounded-full bg-${log.success ? 'green' : 'red'}-100 text-${log.success ? 'green' : 'red'}-600 flex items-center justify-center mr-4">

                        <i class="fas ${log.success ? 'fa-check' : 'fa-times'}"></i>

                    </div>

                    <div class="flex-1">

                        <div class="flex justify-between">

                            <p class="text-sm font-bold text-gray-900 font-mono break-all pr-4">

                                <span class="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded mr-2">${log.actor || 'system'}</span>

                                ${log.cmd}

                            </p>

                            <span class="text-xs text-gray-400 whitespace-nowrap">${log.time}</span>

                        </div>

                        <p class="text-xs text-gray-500 mt-0.5">${log.success ? 'Success' : 'Failed'}</p>

                    </div>

                </div>

            `).join('');

            }



            // Enhanced Add Log

            function addToGlobalLog(cmd, success = true, actor = 'system') {

                const entry = {

                    cmd,

                    success,

                    time: new Date().toLocaleTimeString(),

                    timestamp: Date.now(),

                    actor: actor

                };

                globalActivityLog.unshift(entry);

                if (globalActivityLog.length > 50) globalActivityLog.pop(); // Keep last 50

                // Persist?

            }



            // GLOBAL USER STATE

            let currentUser = { name: 'Admin', email: 'admin@devyntra.io', avatar: 'https://ui-avatars.com/api/?name=Admin&background=random' };



            // GLOBAL SERVERS (loaded from Supabase per user)

            let userServers = [];



            // --- 2. HTML TEMPLATES (VIEWS) ---

            const views = {

                // MAIN DASHBOARD (Global Server Select)

                servers: () => {

                    // Use userServers (loaded from Supabase) instead of localStorage

                    let servers = userServers;



                    // FILTER OUT MOCK/UNWANTED IPs

                    servers = servers.filter(s => s.host !== '104.23.11.89');



                    const totalServers = servers.length;

                    const firstName = currentUser.name.split(' ')[0];



                    return `

                <div class="flex flex-col gap-6 h-full">

                    <!-- Hero Section (Refined Sunset Minimalist) -->

                    <div class="bg-slate-800 rounded-[2rem] p-8 sm:p-10 border border-slate-700 shadow-xl relative overflow-hidden flex-none">

                        <!-- Lighter Muted Gradient Atmosphere -->

                        <div class="absolute inset-0 bg-gradient-to-br from-indigo-900/40 via-transparent to-orange-900/30 pointer-events-none"></div>

                        <div class="absolute top-0 right-0 p-4 opacity-[0.04] pointer-events-none">

                            <i class="fas fa-wave-square text-[15rem] transform rotate-12 translate-x-10 translate-y-10"></i>

                        </div>

                        

                        <div class="relative z-10 flex flex-col lg:flex-row lg:justify-between lg:items-center gap-6">

                            <div class="min-w-0">

                                <h2 class="text-3xl sm:text-4xl font-black text-white tracking-tight mb-2 truncate">Control Center</h2>

                                <p class="text-slate-300 text-sm sm:text-base font-medium">Monitoring <strong class="text-orange-300 font-bold">${totalServers}</strong> enterprise nodes across your secure perimeter.</p>

                            </div>

                                    

                            <div class="flex flex-col sm:flex-row lg:flex-col items-start sm:items-center lg:items-end gap-4 w-full lg:w-auto">

                                <!-- Profile Card (Dark Glass) -->

                                <div class="bg-white/5 backdrop-blur-md border border-white/10 rounded-2xl p-3 flex items-center gap-4 w-full sm:w-auto min-w-[280px] shadow-xl">

                                    <div class="relative">

                                        <img id="dashboard-profile-img" src="${currentUser.avatar}" 

                                             class="w-12 h-12 rounded-xl border border-white/10 object-cover flex-shrink-0 shadow-lg">

                                        <div class="absolute -bottom-1 -right-1 w-3.5 h-3.5 bg-green-500 border-2 border-slate-900 rounded-full"></div>

                                    </div>

                                    <div class="min-w-0 flex-1">

                                        <p class="text-white font-bold text-sm truncate uppercase tracking-tight">${currentUser.name}</p>

                                        <p class="text-slate-400 text-xs truncate overflow-hidden">${currentUser.email}</p>

                                    </div>

                                </div>

                                

                                <!-- Action Buttons -->

                                <div class="flex gap-2 w-full sm:w-auto">

                                    <button onclick="openSettingsModal()" class="flex-1 sm:flex-none bg-white/10 hover:bg-white/20 text-white px-5 py-2.5 rounded-xl transition-all font-bold border border-white/10 flex items-center justify-center shadow-lg text-sm">

                                        <i class="fas fa-cog mr-2 text-slate-400"></i> Settings

                                    </button>

                                    <button onclick="logoutApp()" class="flex-1 sm:flex-none bg-red-500/10 hover:bg-red-500/20 text-red-400 px-5 py-2.5 rounded-xl transition-all font-bold border border-red-500/20 flex items-center justify-center shadow-lg text-sm group">

                                        <i class="fas fa-sign-out-alt mr-2 group-hover:rotate-12 transition-transform opacity-60"></i> Sign Out

                                    </button>

                                </div>

                            </div>

                        </div>

                    </div>

                    <div class="flex flex-col lg:flex-row gap-8 items-stretch flex-1 min-h-0">

                        <!-- LEFT COLUMN: YOUR FLEET -->

                        <div class="premium-dashboard-card rounded-[2.5rem] flex flex-col flex-1 shadow-2xl shadow-slate-200/40 relative overflow-hidden bg-white border border-slate-100">

                            <!-- Highlighted Heading Bar -->

                            <div class="bg-slate-100 border-b border-slate-200/60 px-8 py-6 flex items-center justify-between relative">

                                <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-indigo-500 to-purple-500"></div>

                                <h3 class="text-xl font-extrabold text-gray-900 flex items-center">

                                    <div class="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center text-indigo-600 mr-4 shadow-sm">

                                        <i class="fas fa-server"></i>

                                    </div>

                                    Your Fleet

                                </h3>

                                <button onclick="openConnectionModal()" class="bg-indigo-600 text-white hover:bg-indigo-700 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center transition-all shadow-md active:scale-95">

                                    <i class="fas fa-plus mr-2"></i>Connect Node

                                </button>

                            </div>



                            <div class="flex flex-col min-h-0 p-8 sm:p-10">

                                ${servers.length === 0 ? `

                                    <div class="empty-state-card border-indigo-100/50 flex-1 min-h-[300px]">

                                        <div class="empty-state-icon bg-indigo-50 text-indigo-500 shadow-indigo-100/50">

                                            <i class="fas fa-server"></i>

                                        </div>

                                        <h3 class="text-lg font-bold text-gray-900">No active servers</h3>

                                        <p class="text-gray-500 text-sm mt-1 mb-6 max-w-[280px]">Connect your first server to start managing your infrastructure from the dashboard.</p>

                                        <button onclick="openConnectionModal()" class="bg-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95">Connect Now</button>

                                    </div>

                                ` : `

                                    <div class="grid grid-cols-2 gap-4">

                                        ${servers.slice(0, 3).map(s => `

                                            <div class="bg-white border border-slate-200/60 rounded-[1.5rem] p-5 hover:border-indigo-500/50 hover:shadow-lg transition-all duration-300 group flex flex-col min-w-0 border-b-4 border-b-transparent hover:border-b-indigo-500 cursor-pointer relative overflow-hidden" onclick="connectSavedServer('${s.id}')" data-server-id="${s.id}">
                                                
                                                <div class="flex-1">
                                                    <div class="flex items-center gap-4 w-full min-w-0">
                                                        ${(() => {
                            const mode = s.mode || s.type || 'ssh';
                            let bgClass = 'bg-slate-100';
                            let textClass = 'text-slate-600';
                            let borderClass = 'border-slate-200';
                            let icon = 'fa-terminal';

                            if (mode === 'agent') {
                                bgClass = 'bg-emerald-100';
                                textClass = 'text-emerald-700';
                                borderClass = 'border-emerald-200';
                                icon = 'fa-plug';
                            }
                            else if (mode === 'user') {
                                bgClass = 'bg-blue-100';
                                textClass = 'text-blue-700';
                                borderClass = 'border-blue-200';
                                icon = 'fa-user-lock';
                            }

                            return `<div class="w-12 h-12 rounded-xl ${bgClass} ${textClass} border ${borderClass} flex flex-shrink-0 items-center justify-center text-xl font-bold shadow-sm">
                                <i class="fas ${icon} text-lg"></i>
                            </div>`;
                        })()}
                                                        <div class="min-w-0 flex-1 overflow-hidden">
                                                            <h3 class="font-bold text-gray-900 text-base leading-tight truncate w-full group-hover:text-indigo-600 transition-colors">${s.name || s.host}</h3>
                                                            <p class="text-[11px] text-gray-500 font-mono mt-1 truncate w-full opacity-80 whitespace-nowrap overflow-hidden text-ellipsis bg-gray-50 px-2 py-0.5 rounded border border-gray-100 inline-block">${s.username || (s.mode === 'agent' ? 'agent' : 'root')}@${s.host || 'local'}</p>
                                                        </div>
                                                    </div>

                                                    <!-- Status Labels -->
                                                    ${s.isElasticIP || s.is_elastic ? `
                                                    <div class="flex items-center gap-2 w-full mt-2">
                                                        <span class="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1.5">
                                                            <i class="fas fa-thumbtack text-[7px]"></i> STATIC IP
                                                        </span>
                                                    </div>
                                                    ` : ''}
                                                </div>

                                                <div class="flex flex-row items-center justify-between gap-3 w-full pt-3 border-t border-gray-100 mt-3">
                                                    <div class="flex items-center gap-2 flex-shrink-0">
                                                        <button onclick="event.stopPropagation(); editServer('${s.id}')" title="Settings" class="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-white flex items-center justify-center transition-all shadow-sm">
                                                            <i class="fas fa-cog text-xs"></i>
                                                        </button>
                                                        <button onclick="event.stopPropagation(); deleteServer('${s.id}')" title="Delete" class="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-white flex items-center justify-center transition-all shadow-sm">
                                                            <i class="fas fa-trash-alt text-xs"></i>
                                                        </button>
                                                    </div>
                                                    <button onclick="event.stopPropagation(); connectSavedServer('${s.id}')" class="flex-1 min-w-[70px] bg-indigo-600 text-white font-bold py-2 px-3 rounded-xl transition-all text-[10px] flex items-center justify-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 whitespace-nowrap group-hover:shadow-indigo-500/20 uppercase tracking-wider">
                                                        <span>Manage</span> <i class="fas fa-arrow-right ml-2 text-[8px]"></i>
                                                    </button>
                                                </div>
                                            </div>

                                        `).join('')}

                                        ${servers.length <= 3 ? `
                                            <button onclick="openConnectionModal()" class="w-full border-2 border-dashed border-gray-100 hover:border-indigo-300 hover:bg-indigo-50/20 rounded-[1.5rem] flex flex-col items-center justify-center text-gray-400 hover:text-indigo-600 transition-all group min-h-[180px]">
                                                <div class="w-8 h-8 rounded-full border-2 border-dashed border-gray-200 group-hover:border-indigo-300 flex items-center justify-center mb-2">
                                                    <i class="fas fa-plus text-[10px]"></i>
                                                </div>
                                                <span class="font-bold text-[10px] uppercase tracking-wider">Add New Node</span>
                                            </button>
                                        ` : `
                                            <button onclick="navigate('all-servers')" class="w-full bg-gradient-to-br from-indigo-50 to-purple-50 border-2 border-indigo-200 hover:border-indigo-400 rounded-[1.5rem] flex flex-col items-center justify-center text-indigo-600 hover:text-indigo-700 transition-all group min-h-[180px] hover:shadow-lg">
                                                <div class="w-12 h-12 rounded-full bg-indigo-100 border-2 border-indigo-300 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                                    <i class="fas fa-server text-lg"></i>
                                                </div>
                                                <span class="font-bold text-sm mb-1">View All Servers</span>
                                                <span class="text-[10px] opacity-70">${servers.length} Total</span>
                                            </button>
                                        `}

                                    </div>

                                `}

                            </div>

                        </div>

                    

                        <!-- RIGHT COLUMN: YOUR PIPELINES -->

                        <div class="premium-dashboard-card rounded-[2.5rem] flex flex-col pipeline-section flex-1 shadow-2xl shadow-slate-200/40 relative overflow-hidden bg-white border border-slate-100">

                            <!-- Highlighted Heading Bar -->

                            <div class="bg-slate-100 border-b border-slate-200/60 px-8 py-6 flex items-center justify-between relative">

                                <div class="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-orange-400 to-rose-500"></div>

                                <h3 class="text-xl font-extrabold text-gray-900 flex items-center">

                                    <div class="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-600 mr-4 shadow-sm">

                                        <i class="fas fa-rocket"></i>

                                    </div>

                                    Pipelines

                                </h3>

                                <button onclick="openCreatePipelineView()" class="bg-orange-600 text-white hover:bg-orange-700 px-5 py-2.5 rounded-xl text-sm font-bold flex items-center transition-all shadow-md active:scale-95">

                                    <i class="fas fa-plus mr-2"></i>New Pipeline

                                </button>

                            </div>



                            <div class="flex flex-col min-h-0 p-8 sm:p-10">

                                ${pipelines.length === 0 ? `

                                    <div class="empty-state-card border-orange-100/50 flex-1 min-h-[300px]">

                                        <div class="empty-state-icon bg-orange-50 text-orange-500 shadow-orange-100/50">

                                            <i class="fas fa-code-branch"></i>

                                        </div>

                                        <h3 class="text-lg font-bold text-gray-900">No pipelines created</h3>

                                        <p class="text-gray-500 text-sm mt-1 mb-6 max-w-[280px]">Automate your build and deployment workflows with custom CI/CD pipelines.</p>

                                        <button onclick="window.openCreatePipelineView()" class="bg-orange-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-xl shadow-orange-200 hover:bg-orange-700 transition-all active:scale-95">Create First</button>

                                    </div>

                                ` : `

                                    <div class="grid grid-cols-2 gap-4">

                                        ${pipelines.slice(-3).reverse().map(p => {

                            const lastRunDate = p.lastRun ? new Date(p.lastRun).toLocaleDateString() : 'Never';

                            return `

                                            <div onclick="navigate('cicd')" class="bg-white border border-gray-100 rounded-[1.5rem] p-5 hover:border-orange-500 hover:shadow-lg transition-all cursor-pointer group flex flex-col min-w-0 min-h-[180px]">

                                                <div class="flex-1">
                                                    <div class="flex items-center gap-4 w-full min-w-0">

                                                         <div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex flex-shrink-0 items-center justify-center text-xl font-bold border border-orange-100">

                                                             <i class="fas fa-rocket text-base"></i>

                                                         </div>

                                                         <div class="min-w-0 flex-1 overflow-hidden">

                                                            <h3 class="font-bold text-gray-900 text-base leading-tight truncate w-full group-hover:text-orange-600 transition-colors">${p.name}</h3>

                                                             <div class="flex items-center gap-3 mt-1 overflow-hidden">

                                                                <span class="bg-orange-100 px-2 py-0.5 rounded text-[9px] font-bold text-orange-700 uppercase tracking-wider flex-shrink-0">${p.trigger}</span>

                                                                <span class="text-[10px] text-gray-400 font-medium truncate">Last run: ${lastRunDate}</span>

                                                             </div>

                                                         </div>

                                                    </div>
                                                </div>

                                                <div class="flex flex-row items-center justify-between gap-2 w-full pt-3 border-t border-gray-50 mt-3">

                                                    <span class="text-[10px] text-gray-400 font-bold uppercase tracking-widest group-hover:text-orange-600 transition-colors">View Pipeline</span>

                                                    <div class="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-all transform group-hover:translate-x-1">

                                                        <i class="fas fa-arrow-right text-xs"></i>

                                                    </div>

                                                </div>

                                            </div>

                                            `;

                        }).join('')}

                                        ${pipelines.length <= 3 ? `
                                            <button onclick="window.openCreatePipelineView()" class="w-full border-2 border-dashed border-gray-100 hover:border-orange-300 hover:bg-orange-50/20 rounded-[1.5rem] flex flex-col items-center justify-center text-gray-400 hover:text-orange-600 transition-all group min-h-[180px]">
                                                <div class="w-8 h-8 rounded-full border-2 border-dashed border-gray-200 group-hover:border-orange-300 flex items-center justify-center mb-2">
                                                    <i class="fas fa-plus text-[10px]"></i>
                                                </div>
                                                <span class="font-bold text-[10px] uppercase tracking-wider">Create Pipeline</span>
                                            </button>
                                        ` : `
                                            <button onclick="navigate('all-pipelines')" class="w-full bg-gradient-to-br from-orange-50 to-red-50 border-2 border-orange-200 hover:border-orange-400 rounded-[1.5rem] flex flex-col items-center justify-center text-orange-600 hover:text-orange-700 transition-all group min-h-[180px] hover:shadow-lg">
                                                <div class="w-12 h-12 rounded-full bg-orange-100 border-2 border-orange-300 flex items-center justify-center mb-3 group-hover:scale-110 transition-transform">
                                                    <i class="fas fa-rocket text-lg"></i>
                                                </div>
                                                <span class="font-bold text-sm mb-1">View All Pipelines</span>
                                                <span class="text-[10px] opacity-70">${pipelines.length} Total</span>
                                            </button>
                                        `}

                                    </div>

                                `}

                            </div>

                        </div>

                </div>

            `;

                },

                // ALL SERVERS PAGE (Full List)
                'all-servers': () => {
                    let servers = userServers.filter(s => s.host !== '104.23.11.89');
                    // Already ordered by created_at DESC from database (newest first)

                    return `
                <div class="flex flex-col gap-6 h-full">
                    <!-- Header -->
                    <div class="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-[2rem] p-8 border border-indigo-500 shadow-xl">
                        <div class="flex items-center justify-between mb-6">
                            <div class="flex items-center gap-4">
                                <button onclick="navigate('servers')" class="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center text-white transition-all backdrop-blur-sm">
                                    <i class="fas fa-arrow-left text-lg"></i>
                                </button>
                                <div>
                                    <h2 class="text-4xl font-black text-white tracking-tight drop-shadow-lg">All Servers</h2>
                                    <p class="text-white text-base font-semibold mt-2 drop-shadow">Managing ${servers.length} server${servers.length !== 1 ? 's' : ''} across your infrastructure</p>
                                </div>
                            </div>
                            <button onclick="openConnectionModal()" class="bg-white text-indigo-600 hover:bg-indigo-50 px-6 py-3 rounded-xl text-sm font-bold flex items-center transition-all shadow-lg active:scale-95">
                                <i class="fas fa-plus mr-2"></i>Add Server
                            </button>
                        </div>
                        
                        <!-- Search Bar -->
                        <div class="relative">
                            <i class="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                            <input type="text" id="server-search" placeholder="Search servers by name, host, or username..." 
                                class="w-full bg-white border-2 border-white/30 rounded-2xl pl-12 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:bg-white focus:border-indigo-300 focus:ring-4 focus:ring-indigo-500/20 outline-none transition-all font-medium"
                                oninput="filterServers(this.value)">
                        </div>
                    </div>

                    <!-- Servers Grid -->
                    <div id="servers-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        ${servers.length === 0 ? `
                            <div class="col-span-full empty-state-card border-indigo-100/50 min-h-[300px]">
                                <div class="empty-state-icon bg-indigo-50 text-indigo-500 shadow-indigo-100/50">
                                    <i class="fas fa-server"></i>
                                </div>
                                <h3 class="text-lg font-bold text-gray-900">No servers yet</h3>
                                <p class="text-gray-500 text-sm mt-1 mb-6 max-w-[280px]">Connect your first server to get started</p>
                                <button onclick="openConnectionModal()" class="bg-indigo-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-xl shadow-indigo-200 hover:bg-indigo-700 transition-all active:scale-95">Connect Now</button>
                            </div>
                        ` : servers.map(s => `
                            <div class="bg-white border-2 border-indigo-200 rounded-[1.5rem] p-5 hover:border-indigo-500 hover:shadow-xl transition-all duration-300 group flex flex-col min-w-0 cursor-pointer relative overflow-hidden server-card" 
                                onclick="connectSavedServer('${s.id}')" 
                                data-server-id="${s.id}"
                                data-search-text="${(s.name || s.host || '').toLowerCase()} ${(s.username || '').toLowerCase()} ${(s.host || '').toLowerCase()}">
                                ${s.mode === 'agent' || String(s.host || '').startsWith('agent:') ? `
                                <div class="absolute top-3 right-3 flex items-center gap-2">
                                    <div class="status-indicator w-2.5 h-2.5 rounded-full bg-gray-400 shadow-sm"></div>
                                </div>
                                ` : ''}
                                <div class="flex-1">
                                    <div class="flex items-center gap-4 w-full min-w-0">
                                        ${(() => {
                            const mode = s.mode || s.type || 'ssh';
                            let bgClass = 'bg-slate-100', textClass = 'text-slate-600', borderClass = 'border-slate-200', icon = 'fa-terminal';
                            if (mode === 'agent') { bgClass = 'bg-emerald-100'; textClass = 'text-emerald-700'; borderClass = 'border-emerald-200'; icon = 'fa-plug'; }
                            else if (mode === 'user') { bgClass = 'bg-blue-100'; textClass = 'text-blue-700'; borderClass = 'border-blue-200'; icon = 'fa-user-lock'; }
                            return `<div class="w-12 h-12 rounded-xl ${bgClass} ${textClass} border ${borderClass} flex flex-shrink-0 items-center justify-center text-xl font-bold shadow-sm"><i class="fas ${icon} text-lg"></i></div>`;
                        })()}
                                        <div class="min-w-0 flex-1 overflow-hidden">
                                            <h3 class="font-bold text-gray-900 text-base leading-tight truncate w-full group-hover:text-indigo-600 transition-colors">${s.name || s.host}</h3>
                                            <p class="text-[11px] text-gray-500 font-mono mt-1 truncate w-full opacity-80 whitespace-nowrap overflow-hidden text-ellipsis bg-gray-50 px-2 py-0.5 rounded border border-gray-100 inline-block">${s.username || (s.mode === 'agent' ? 'agent' : 'root')}@${s.host || 'local'}</p>
                                        </div>
                                    </div>
                                    ${s.isElasticIP || s.is_elastic ? `
                                    <div class="flex items-center gap-2 w-full mt-2">
                                        <span class="px-3 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-200 flex items-center gap-1.5">
                                            <i class="fas fa-thumbtack text-[7px]"></i> STATIC IP
                                        </span>
                                    </div>
                                    ` : ''}
                                </div>
                                <div class="flex flex-row items-center justify-between gap-3 w-full pt-3 border-t border-gray-100 mt-3">
                                    <div class="flex items-center gap-2 flex-shrink-0">
                                        <button onclick="event.stopPropagation(); editServer('${s.id}')" title="Settings" class="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 text-gray-400 hover:text-indigo-600 hover:border-indigo-200 hover:bg-white flex items-center justify-center transition-all shadow-sm">
                                            <i class="fas fa-cog text-xs"></i>
                                        </button>
                                        <button onclick="event.stopPropagation(); deleteServer('${s.id}')" title="Delete" class="w-9 h-9 rounded-xl bg-gray-50 border border-gray-100 text-gray-400 hover:text-red-500 hover:border-red-200 hover:bg-white flex items-center justify-center transition-all shadow-sm">
                                            <i class="fas fa-trash-alt text-xs"></i>
                                        </button>
                                    </div>
                                    <button onclick="event.stopPropagation(); connectSavedServer('${s.id}')" class="flex-1 min-w-[70px] bg-indigo-600 text-white font-bold py-2 px-3 rounded-xl transition-all text-[10px] flex items-center justify-center shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 whitespace-nowrap group-hover:shadow-indigo-500/20 uppercase tracking-wider">
                                        <span>Manage</span> <i class="fas fa-arrow-right ml-2 text-[8px]"></i>
                                    </button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
                },

                // ALL PIPELINES PAGE (Full List)
                'all-pipelines': () => {
                    const pipelines = []; // This will be populated from your pipeline data

                    return `
                <div class="flex flex-col gap-6 h-full">
                    <!-- Header -->
                    <div class="bg-gradient-to-r from-orange-600 to-red-600 rounded-[2rem] p-8 border border-orange-500 shadow-xl">
                        <div class="flex items-center justify-between mb-6">
                            <div class="flex items-center gap-4">
                                <button onclick="navigate('servers')" class="w-12 h-12 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center text-white transition-all backdrop-blur-sm">
                                    <i class="fas fa-arrow-left text-lg"></i>
                                </button>
                                <div>
                                    <h2 class="text-4xl font-black text-white tracking-tight drop-shadow-lg">All Pipelines</h2>
                                    <p class="text-white text-base font-semibold mt-2 drop-shadow">Managing ${pipelines.length} pipeline${pipelines.length !== 1 ? 's' : ''} across your projects</p>
                                </div>
                            </div>
                            <button onclick="window.openCreatePipelineView()" class="bg-white text-orange-600 hover:bg-orange-50 px-6 py-3 rounded-xl text-sm font-bold flex items-center transition-all shadow-lg active:scale-95">
                                <i class="fas fa-plus mr-2"></i>Create Pipeline
                            </button>
                        </div>
                        
                        <!-- Search Bar -->
                        <div class="relative">
                            <i class="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
                            <input type="text" id="pipeline-search" placeholder="Search pipelines by name or trigger..." 
                                class="w-full bg-white border-2 border-white/30 rounded-2xl pl-12 pr-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:bg-white focus:border-orange-300 focus:ring-4 focus:ring-orange-500/20 outline-none transition-all font-medium"
                                oninput="filterPipelines(this.value)">
                        </div>
                    </div>

                    <!-- Pipelines Grid -->
                    <div id="pipelines-grid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        ${pipelines.length === 0 ? `
                            <div class="col-span-full empty-state-card border-orange-100/50 min-h-[300px]">
                                <div class="empty-state-icon bg-orange-50 text-orange-500 shadow-orange-100/50">
                                    <i class="fas fa-rocket"></i>
                                </div>
                                <h3 class="text-lg font-bold text-gray-900">No pipelines yet</h3>
                                <p class="text-gray-500 text-sm mt-1 mb-6 max-w-[280px]">Create your first CI/CD pipeline to get started</p>
                                <button onclick="window.openCreatePipelineView()" class="bg-orange-600 text-white px-6 py-3 rounded-xl text-sm font-bold shadow-xl shadow-orange-200 hover:bg-orange-700 transition-all active:scale-95">Create Pipeline</button>
                            </div>
                        ` : pipelines.map(p => {
                        const lastRunDate = p.lastRun ? new Date(p.lastRun).toLocaleDateString() : 'Never';
                        return `
                            <div onclick="navigate('cicd')" 
                                class="bg-white border-2 border-orange-200 rounded-[1.5rem] p-5 hover:border-orange-500 hover:shadow-xl transition-all cursor-pointer group flex flex-col min-w-0 min-h-[180px] pipeline-card"
                                data-search-text="${(p.name || '').toLowerCase()} ${(p.trigger || '').toLowerCase()}">
                                <div class="flex-1">
                                    <div class="flex items-center gap-4 w-full min-w-0">
                                        <div class="w-12 h-12 rounded-xl bg-orange-50 text-orange-600 flex flex-shrink-0 items-center justify-center text-xl font-bold border border-orange-100">
                                            <i class="fas fa-rocket text-base"></i>
                                        </div>
                                        <div class="min-w-0 flex-1 overflow-hidden">
                                            <h3 class="font-bold text-gray-900 text-base leading-tight truncate w-full group-hover:text-orange-600 transition-colors">${p.name}</h3>
                                            <div class="flex items-center gap-3 mt-1 overflow-hidden">
                                                <span class="bg-orange-100 px-2 py-0.5 rounded text-[9px] font-bold text-orange-700 uppercase tracking-wider flex-shrink-0">${p.trigger}</span>
                                                <span class="text-[10px] text-gray-400 font-medium truncate">Last run: ${lastRunDate}</span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="flex flex-row items-center justify-between gap-2 w-full pt-3 border-t border-gray-50 mt-3">
                                    <span class="text-[10px] text-gray-400 font-bold uppercase tracking-widest group-hover:text-orange-600 transition-colors">View Pipeline</span>
                                    <div class="w-8 h-8 rounded-full bg-orange-50 text-orange-600 flex items-center justify-center group-hover:bg-orange-600 group-hover:text-white transition-all transform group-hover:translate-x-1">
                                        <i class="fas fa-arrow-right text-xs"></i>
                                    </div>
                                </div>
                            </div>
                            `;
                    }).join('')}
                    </div>
                </div>
            `;
                },



                // DASHBOARD (CONTROL CENTER)
                dashboard: () => `

                <!-- Action Grid -->

                <h2 class="text-lg font-extrabold text-gray-900 mb-4">What would you like to do?</h2>

                <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">

                    <div onclick="navigate('deploy')" class="action-card bg-white p-5 rounded-xl border border-gray-200 cursor-pointer group relative overflow-hidden flex flex-col h-full shadow-sm hover:shadow-md transition-all">

                        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><i class="fas fa-code-branch text-5xl text-purple-600 transform rotate-12 translate-x-2 -translate-y-2"></i></div>

                        <div class="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center text-purple-600 mb-3 group-hover:bg-purple-600 group-hover:text-white transition-colors shadow-sm"><i class="fas fa-rocket text-lg"></i></div>

                        <h3 class="text-base font-bold text-gray-900 group-hover:text-purple-600 transition-colors">Deploy Application</h3>

                        <p class="text-xs text-gray-500 mt-1 mb-4">Connect GitHub or upload code.</p>

                        <div class="flex items-center text-purple-600 text-xs font-bold mt-auto">Start deployment <i class="fas fa-arrow-right ml-2 group-hover:translate-x-1"></i></div>

                    </div>

                    <div onclick="navigate('files')" class="action-card bg-white p-5 rounded-xl border border-gray-200 cursor-pointer group relative overflow-hidden flex flex-col h-full shadow-sm hover:shadow-md transition-all">

                        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><i class="fas fa-folder-open text-5xl text-indigo-600 transform rotate-12 translate-x-2 -translate-y-2"></i></div>

                        <div class="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 mb-3 group-hover:bg-indigo-600 group-hover:text-white transition-colors shadow-sm"><i class="fas fa-folder text-lg"></i></div>

                        <h3 class="text-base font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">Manage Files</h3>

                        <p class="text-xs text-gray-500 mt-1 mb-4">Browse, upload, and edit server files.</p>

                        <div class="flex items-center text-indigo-600 text-xs font-bold mt-auto">Open File Manager <i class="fas fa-arrow-right ml-2 group-hover:translate-x-1"></i></div>

                    </div>

                    <div onclick="navigate('security')" class="action-card bg-white p-5 rounded-xl border border-gray-200 cursor-pointer group relative overflow-hidden flex flex-col h-full shadow-sm hover:shadow-md transition-all">

                        <div class="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity"><i class="fas fa-user-shield text-5xl text-orange-600 transform rotate-12 translate-x-2 -translate-y-2"></i></div>

                        <div class="w-10 h-10 bg-orange-50 rounded-lg flex items-center justify-center text-orange-600 mb-3 group-hover:bg-orange-600 group-hover:text-white transition-colors shadow-sm"><i class="fas fa-lock text-lg"></i></div>

                        <h3 class="text-base font-bold text-gray-900 group-hover:text-orange-600 transition-colors">Secure Server</h3>

                        <p class="text-xs text-gray-500 mt-1 mb-4">SSL, Firewall, SSH Keys.</p>

                        <div class="flex items-center text-orange-600 text-xs font-bold mt-auto">View security <i class="fas fa-arrow-right ml-2 group-hover:translate-x-1"></i></div>

                    </div>

                </div>



                <!-- Quick AI Action Bar (Centered & Compact) -->

                <div class="mb-16 mt-12">

                     <div class="max-w-3xl mx-auto text-center">

                         <h2 class="text-2xl font-bold text-gray-900 mb-6">Manage your server with DevAI</h2>

                         <div class="relative group text-left">

                             <!-- Glow Effect -->

                             <div class="absolute -inset-0.5 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-2xl opacity-20 group-hover:opacity-40 transition duration-500 blur-lg"></div>

                             

                             <div class="relative bg-white rounded-2xl shadow-xl shadow-indigo-500/10 border border-indigo-50 flex items-center gap-2 p-2 transition-all">

                                 <input type="text" id="quick-action-input" 

                                    class="flex-1 bg-transparent border-0 text-gray-900 rounded-xl px-4 py-3.5 focus:ring-0 focus:outline-none text-base leading-relaxed placeholder-gray-400" 

                                    placeholder="Ask AI or type a command..."

                                    onkeydown="if(event.key === 'Enter') handleQuickAction(this.value)">

                                 <button onclick="handleQuickAction(document.getElementById('quick-action-input').value)" class="h-[48px] w-[48px] flex-shrink-0 flex items-center justify-center bg-gray-900 hover:bg-indigo-600 text-white rounded-xl shadow-lg transition-all transform active:scale-95 hover:shadow-indigo-500/25">

                                     <i class="fas fa-arrow-up text-sm"></i>

                                 </button>

                             </div>

                         </div>

                    </div>

                </div>



                <!-- Server Performance & Health -->

                <div class="space-y-4">

                    <div class="flex items-center justify-between">

                        <h2 class="text-sm font-black text-gray-900 uppercase tracking-wider flex items-center gap-2"><i class="fas fa-heartbeat text-indigo-500"></i>Server Performance & Health</h2>

                        <button onclick="navigate('monitoring')" class="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-colors border border-indigo-100">

                            <i class="fas fa-chart-line text-[9px]"></i>Open Monitoring

                        </button>

                    </div>

                    <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">

                        <!-- CPU -->

                        <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group cursor-pointer" onclick="navigate('monitoring')">

                            <div class="flex items-center gap-3 mb-2">

                                <div class="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center"><i class="fas fa-microchip text-xs"></i></div>

                                <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">CPU</span>

                            </div>

                             <div id="dash-cpu" class="text-3xl font-black text-gray-900 leading-none mt-2"><div class="skeleton w-16 h-8 rounded bg-gray-100"></div></div>

                             <p class="text-[9px] text-gray-400 font-bold mt-2 mb-1" id="dash-cpu-detail">-- processes</p>

                             <canvas id="dash-cpu-spark" class="w-full mt-1" style="height:36px"></canvas>

                             <div class="w-full bg-gray-100 h-1.5 rounded-full mt-auto overflow-hidden">

                                 <div id="dash-cpu-bar" class="bg-emerald-500 h-full transition-all duration-700 rounded-full" style="width: 0%"></div>

                             </div>

                        </div>



                        <!-- Memory -->

                        <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group cursor-pointer" onclick="navigate('monitoring')">

                            <div class="flex items-center gap-3 mb-2">

                                <div class="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center"><i class="fas fa-memory text-xs"></i></div>

                                <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Memory</span>

                            </div>

                             <div id="dash-ram" class="text-3xl font-black text-gray-900 leading-none mt-2"><div class="skeleton w-16 h-8 rounded bg-gray-100"></div></div>

                             <p class="text-[9px] text-gray-400 font-bold mt-2 mb-1" id="dash-ram-detail">-- GB used</p>

                             <canvas id="dash-ram-spark" class="w-full mt-1" style="height:36px"></canvas>

                             <div class="w-full bg-gray-100 h-1.5 rounded-full mt-auto overflow-hidden">

                                 <div id="dash-ram-bar" class="bg-indigo-500 h-full transition-all duration-700 rounded-full" style="width: 0%"></div>

                             </div>

                        </div>



                        <!-- Disk -->

                        <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">

                            <div class="flex items-center gap-3 mb-2">

                                <div class="w-8 h-8 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center"><i class="fas fa-hdd text-xs"></i></div>

                                <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Disk</span>

                            </div>

                            <div class="text-3xl font-black text-gray-900 leading-none mt-2" id="dash-disk"><div class="skeleton w-16 h-8 rounded bg-gray-100"></div></div>

                            <p class="text-[9px] text-gray-400 font-bold mt-2 mb-1" id="dash-disk-detail">-- GB free</p>

                            <div class="w-full bg-gray-100 h-2 rounded-full mt-auto overflow-hidden">

                                <div id="dash-disk-bar" class="bg-gradient-to-r from-amber-400 to-orange-500 h-full transition-all duration-700 rounded-full" style="width: 0%"></div>

                            </div>

                        </div>



                        <!-- Network -->

                        <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow group cursor-pointer" onclick="navigate('monitoring')">

                            <div class="flex items-center gap-3 mb-2">

                                <div class="w-8 h-8 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center"><i class="fas fa-exchange-alt text-xs"></i></div>

                                <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">Network</span>

                            </div>

                            <div class="flex flex-col gap-1 mt-2">

                                <span class="text-xs font-bold text-emerald-600 flex items-center gap-1" id="dash-net-in"><i class="fas fa-arrow-down"></i><div class="skeleton w-10 h-3 rounded bg-gray-100"></div></span>

                                <span class="text-xs font-bold text-blue-600 flex items-center gap-1" id="dash-net-out"><i class="fas fa-arrow-up"></i><div class="skeleton w-10 h-3 rounded bg-gray-100"></div></span>

                            </div>

                            <canvas id="dash-net-spark" class="w-full mt-2" style="height:36px"></canvas>

                            <p class="text-[9px] text-gray-400 font-bold mt-1 text-center w-full" id="dash-net-detail">-- connections</p>

                        </div>



                        <!-- Uptime & Info -->

                        <div class="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">

                            <div class="flex items-center gap-3 mb-2">

                                <div class="w-8 h-8 bg-teal-50 text-teal-600 rounded-lg flex items-center justify-center"><i class="fas fa-clock text-xs"></i></div>

                                <span class="text-[10px] font-black text-gray-400 uppercase tracking-widest">System</span>

                            </div>

                            <div class="space-y-2 mt-3">

                                <div class="flex justify-between items-center"><span class="text-[9px] text-gray-400 font-bold">Uptime</span><span class="text-[10px] font-bold text-gray-800 truncate max-w-[100px]" id="dash-uptime"><div class="skeleton w-14 h-3 rounded bg-gray-100"></div></span></div>

                                <div class="flex justify-between items-center"><span class="text-[9px] text-gray-400 font-bold">OS</span><span class="text-[10px] font-bold text-gray-800 truncate max-w-[100px]" id="dash-os"><div class="skeleton w-14 h-3 rounded bg-gray-100"></div></span></div>

                                <div class="flex justify-between items-center"><span class="text-[9px] text-gray-400 font-bold">Kernel</span><span class="text-[10px] font-bold text-gray-600 truncate max-w-[100px]" id="dash-kernel"><div class="skeleton w-14 h-3 rounded bg-gray-100"></div></span></div>

                                <div class="flex justify-between items-center"><span class="text-[9px] text-gray-400 font-bold">IP</span><span class="text-[10px] font-mono font-bold text-indigo-600 truncate max-w-[100px]" id="dash-ip"><div class="skeleton w-20 h-3 rounded bg-gray-100"></div></span></div>

                            </div>

                        </div>





                    </div>

                </div>

            `,





                // MANAGED APPS VIEW

                // MANAGED APPS VIEW

                // MANAGED APPS VIEW

                'manage-apps': () => `

                <div class="flex items-center justify-between mb-6">

                    <div>

                         <h2 class="text-xl font-bold text-gray-900">Deployed Applications</h2>

                         <p class="text-sm text-gray-500">Manage apps running on Systemd or PM2.</p>

                    </div>

                    <button onclick="openAIAppsModal()" class="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-sm font-bold shadow-sm hover:from-purple-700 hover:to-indigo-700"><i class="fas fa-robot mr-2"></i>AI Manager</button>

                </div>

                <!-- App List Container -->

                <div id="app-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                    ${getSkeletonHtml('card-grid')}

                </div>

            `,



                // DEPLOY APPS VIEW (WIZARD)

                deploy: () => `
                <div class="absolute inset-0 flex flex-col bg-[#f8fafc]">
                    <div class="flex-1 overflow-y-auto px-6 py-10" id="deploy-scroll-area">
                        <div id="deploy-main-content" class="max-w-4xl mx-auto w-full">
                                    <div class="fade-in text-center mb-12">
                                        <h2 class="text-3xl font-black text-slate-900 mb-3 tracking-tight">How do you want to deploy?</h2>
                                        <p class="text-slate-500 font-medium">Select a source to begin automated setup</p>
                                        <div class="grid grid-cols-1 md:grid-cols-3 gap-6 mt-10">
                                            <!-- Git -->
                                            <div onclick="selectDeploySource('github')" class="group cursor-pointer bg-white border border-slate-200 hover:border-indigo-500 rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 relative overflow-hidden flex flex-col items-center">
                                                <div class="w-16 h-16 rounded-2xl bg-slate-900 text-white flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <i class="fab fa-git-alt text-3xl"></i>
                                                </div>
                                                <h3 class="font-bold text-slate-900 mb-1">Git</h3>
                                                <p class="text-[11px] text-slate-500 leading-relaxed">Remote repositories (GitLab/Hub)</p>
                                                <div class="absolute inset-x-0 bottom-0 h-1 bg-indigo-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
                                            </div>
                                            <!-- Path -->
                                            <div onclick="selectDeploySource('path')" class="group cursor-pointer bg-white border border-slate-200 hover:border-emerald-500 rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 relative overflow-hidden flex flex-col items-center">
                                                <div class="w-16 h-16 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <i class="fas fa-folder-tree text-3xl"></i>
                                                </div>
                                                <h3 class="font-bold text-slate-900 mb-1">Server Path</h3>
                                                <p class="text-[11px] text-slate-500 leading-relaxed">Code already on node</p>
                                                <div class="absolute inset-x-0 bottom-0 h-1 bg-emerald-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
                                            </div>
                                            <!-- Upload -->
                                            <div onclick="selectDeploySource('upload')" class="group cursor-pointer bg-white border border-slate-200 hover:border-amber-500 rounded-3xl p-6 shadow-sm hover:shadow-xl transition-all duration-300 hover:-translate-y-1 relative overflow-hidden flex flex-col items-center">
                                                <div class="w-16 h-16 rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                                                    <i class="fas fa-cloud-upload-alt text-3xl"></i>
                                                </div>
                                                <h3 class="font-bold text-slate-900 mb-1">Upload</h3>
                                                <p class="text-[11px] text-slate-500 leading-relaxed">ZIP or folder from desktop</p>
                                                <div class="absolute inset-x-0 bottom-0 h-1 bg-amber-500 transform scale-x-0 group-hover:scale-x-100 transition-transform origin-left"></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>`,



                // STORAGE VIEW

                storage: () => {

                    setTimeout(loadStorage, 100);

                    return `

                <div class="max-w-4xl mx-auto fade-in">

                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">

                         <div>

                            <h2 class="text-xl font-bold text-gray-900 tracking-tight">Disk & Storage Management</h2>

                            <p class="text-xs text-gray-500 mt-0.5">View, mount, unmount, and manage your server's block devices and partitions.</p>

                         </div>

                         <div class="flex items-center gap-2">

                             <button onclick="toggleStorageLoopDevices()" id="toggle-loop-btn" class="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-[10px] font-bold shadow-sm hover:bg-gray-50 transition-all"><i class="fas fa-circle-notch mr-1.5"></i>Loop Devices</button>

                             <button onclick="loadStorage()" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-[10px] font-bold shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"><i class="fas fa-sync-alt mr-1.5"></i>Rescan Devices</button>

                         </div>

                    </div>



                    <!-- Storage Overview Cards -->

                    <div id="storage-overview" class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">

                        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

                            <div class="flex items-center gap-3 mb-3">

                                <div class="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600"><i class="fas fa-hdd"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Disks</p>

                                    <p id="storage-total-disks" class="text-lg font-black text-gray-900 leading-tight">--</p>

                                </div>

                            </div>

                        </div>

                        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

                            <div class="flex items-center gap-3 mb-3">

                                <div class="w-9 h-9 bg-emerald-50 rounded-lg flex items-center justify-center text-emerald-600"><i class="fas fa-check-circle"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Mounted</p>

                                    <p id="storage-mounted-count" class="text-lg font-black text-gray-900 leading-tight">--</p>

                                </div>

                            </div>

                        </div>

                        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

                            <div class="flex items-center gap-3 mb-3">

                                <div class="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600"><i class="fas fa-exclamation-triangle"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Unmounted</p>

                                    <p id="storage-unmounted-count" class="text-lg font-black text-gray-900 leading-tight">--</p>

                                </div>

                            </div>

                        </div>

                    </div>

                    

                    <!-- Main Physical Disks -->

                    <div class="mb-6">

                        <h3 class="text-xs font-black text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="fas fa-server text-indigo-500"></i> Physical Disks & Volumes</h3>

                        <div id="storage-physical-container" class="space-y-4">

                             ${getSkeletonHtml('card-grid')}

                        </div>

                    </div>



                    <!-- Loop Devices (Hidden by default) -->

                    <div id="storage-loop-section" class="hidden">

                        <h3 class="text-xs font-black text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2"><i class="fas fa-circle-notch text-gray-400"></i> Loop Devices (Snap / System)</h3>

                        <div id="storage-loop-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">

                        </div>

                    </div>

                </div>

            `;

                },



                // USERS & GROUPS VIEW

                'users-groups': () => {

                    setTimeout(loadUsersGroups, 100);

                    return `

                    <div class="h-full flex flex-col fade-in">

                        <!-- Header -->

                        <div class="flex-none mb-6 flex justify-between items-center">

                            <div>

                                <h2 class="text-2xl font-bold text-gray-900 tracking-tight flex items-center gap-3">

                                    <div class="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center text-lg shadow-sm">

                                        <i class="fas fa-users-cog"></i>

                                    </div>

                                    User & Access Management

                                </h2>

                                <p class="text-sm text-gray-500 mt-1 ml-14">Control system access, manage user accounts, and configure group memberships.</p>

                            </div>

                            <div class="flex gap-3">

                                <button onclick="loadUsersGroups()" class="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm hover:bg-gray-50 transition-all flex items-center gap-2">

                                    <i class="fas fa-sync-alt"></i> Refresh Data

                                </button>

                            </div>

                        </div>



                        <!-- 2-Column Layout -->

                        <div class="flex-1 min-h-0 flex flex-col lg:flex-row gap-6">

                            

                            <!-- LEFT COLUMN: USERS -->

                            <div class="flex-1 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

                                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">

                                    <div class="flex items-center gap-3">

                                        <div class="w-8 h-8 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center">

                                            <i class="fas fa-user"></i>

                                        </div>

                                        <div>

                                            <h3 class="text-sm font-bold text-gray-900">System Users</h3>

                                            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Accounts & Permissions</p>

                                        </div>

                                    </div>

                                    <button onclick="openUserModal()" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider shadow hover:bg-blue-700 transition-all active:scale-95 flex items-center gap-2">

                                        <i class="fas fa-plus"></i> New User

                                    </button>

                                </div>

                                <div class="overflow-y-auto custom-scrollbar max-h-[450px]">

                                    <table class="w-full text-left text-sm">

                                        <thead class="bg-gray-50 text-gray-500 font-medium text-xs uppercase tracking-wider border-b border-gray-200 sticky top-0 z-10">

                                            <tr>

                                                <th class="px-6 py-3 bg-gray-50">Identity</th>

                                                <th class="px-6 py-3 bg-gray-50">Details</th>

                                                <th class="px-6 py-3 bg-gray-50 text-right">Actions</th>

                                            </tr>

                                        </thead>

                                        <tbody id="users-table-body" class="divide-y divide-gray-100">

                                            ${getSkeletonHtml('table-rows')}

                                        </tbody>

                                    </table>

                                </div>

                            </div>



                            <!-- RIGHT COLUMN: GROUPS -->

                            <div class="flex-1 flex flex-col min-h-0 bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">

                                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">

                                    <div class="flex items-center gap-3">

                                        <div class="w-8 h-8 rounded-lg bg-purple-100 text-purple-600 flex items-center justify-center">

                                            <i class="fas fa-users"></i>

                                        </div>

                                        <div>

                                            <h3 class="text-sm font-bold text-gray-900">Security Groups</h3>

                                            <p class="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Roles & Access</p>

                                        </div>

                                    </div>

                                    <button onclick="openGroupModal()" class="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-[10px] font-bold uppercase tracking-wider shadow hover:bg-purple-700 transition-all active:scale-95 flex items-center gap-2">

                                        <i class="fas fa-plus"></i> New Group

                                    </button>

                                </div>

                                <div class="overflow-y-auto custom-scrollbar max-h-[450px]">

                                    <table class="w-full text-left text-sm">

                                        <thead class="bg-gray-50 text-gray-500 font-medium text-xs uppercase tracking-wider border-b border-gray-200 sticky top-0 z-10">

                                            <tr>

                                                <th class="px-6 py-3 bg-gray-50">Group Name</th>

                                                <th class="px-6 py-3 bg-gray-50">Members</th>

                                                <th class="px-6 py-3 bg-gray-50 text-right">Actions</th>

                                            </tr>

                                        </thead>

                                        <tbody id="groups-table-body" class="divide-y divide-gray-100">

                                            ${getSkeletonHtml('table-rows')}

                                        </tbody>

                                    </table>

                                </div>

                            </div>

                        </div>



                        <!-- MODALS (Hidden by default) -->

                        <!-- User Modal -->

                        <div id="user-modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">

                            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg border border-gray-100 flex flex-col max-h-[90vh]">

                                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">

                                    <h3 class="font-bold text-gray-900" id="user-modal-title">Create New User</h3>

                                    <button onclick="closeUserModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>

                                </div>

                                <div class="p-6 overflow-y-auto custom-scrollbar space-y-4">

                                    <input type="hidden" id="user-modal-mode" value="create">

                                    <input type="hidden" id="user-modal-original-username">

                                    

                                    <div>

                                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Username</label>

                                        <input type="text" id="user-input-name" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all" placeholder="jdoe">

                                    </div>

                                    

                                    <div>

                                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Password</label>

                                        <div class="relative">

                                            <input type="password" id="user-input-pass" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/10 transition-all font-mono" placeholder="">

                                            <button type="button" onclick="const i=document.getElementById('user-input-pass'); i.type=i.type==='password'?'text':'password'" class="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><i class="fas fa-eye text-xs"></i></button>

                                        </div>

                                        <p class="text-[10px] text-gray-400 mt-1 hidden" id="user-pass-hint">Leave blank to keep existing password</p>

                                    </div>



                                    <div class="grid grid-cols-2 gap-4">

                                        <div>

                                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Shell</label>

                                            <select id="user-input-shell" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white">

                                                <option value="/bin/bash">/bin/bash</option>

                                                <option value="/bin/sh">/bin/sh</option>

                                                <option value="/usr/sbin/nologin">/usr/sbin/nologin</option>

                                            </select>

                                        </div>

                                        <div>

                                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Home Directory</label>

                                            <input type="text" id="user-input-home" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500" placeholder="/home/username">

                                        </div>

                                    </div>



                                    <div>

                                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Primary Group</label>

                                        <select id="user-input-group" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500 bg-white">

                                            <!-- Populated dynamically -->

                                        </select>

                                    </div>



                                    <div>

                                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Additional Groups</label>

                                        <div class="border border-gray-200 rounded-lg p-2 max-h-32 overflow-y-auto custom-scrollbar grid grid-cols-2 gap-2" id="user-input-groups-list">

                                            <!-- Checkboxes -->

                                        </div>

                                    </div>

                                </div>

                                <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">

                                    <button onclick="closeUserModal()" class="px-4 py-2 text-gray-500 hover:bg-gray-200 rounded-lg font-bold text-xs transition-colors">Cancel</button>

                                    <button onclick="submitUserForm()" class="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-xs shadow-lg shadow-blue-200 transition-all">Save Changes</button>

                                </div>

                            </div>

                        </div>



                        <!-- Group Modal -->

                        <div id="group-modal" class="hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">

                            <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100 flex flex-col">

                                <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">

                                    <h3 class="font-bold text-gray-900" id="group-modal-title">Create New Group</h3>

                                    <button onclick="closeGroupModal()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>

                                </div>

                                <div class="p-6 space-y-4">

                                    <input type="hidden" id="group-modal-mode" value="create">

                                    <input type="hidden" id="group-modal-original-name">



                                    <div>

                                        <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-1.5">Group Name</label>

                                        <input type="text" id="group-input-name" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-2 focus:ring-purple-500/10 transition-all" placeholder="developers">

                                    </div>

                                </div>

                                <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">

                                    <button onclick="closeGroupModal()" class="px-4 py-2 text-gray-500 hover:bg-gray-200 rounded-lg font-bold text-xs transition-colors">Cancel</button>

                                    <button onclick="submitGroupForm()" class="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-xs shadow-lg shadow-purple-200 transition-all">Save Group</button>

                                </div>

                            </div>

                        </div>



                    </div>

                    `;

                },



                // GLOBAL APPS STORE

                'global-apps': () => `

                <div class="space-y-6 fade-in">

                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">

                        <div>

                           <h2 class="text-xl font-bold text-gray-900 tracking-tight">App Store</h2>

                           <p class="text-xs text-gray-500 mt-0.5">Click to install software globally.</p>

                        </div>

                        <div class="relative w-full sm:w-64">

                            <i class="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 text-xs"></i>

                            <input type="text" placeholder="Search catalog..." class="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-xs focus:ring-1 focus:ring-indigo-500 outline-none shadow-sm" oninput="filterApps(this.value)">

                        </div>

                    </div>

                    

                    <div id="apps-grid-container" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">

                         ${getSkeletonHtml('card-grid')}

                    </div>

                </div>

            `,




                // FILES VIEW

                files: () => `

                <div class="flex flex-col h-[calc(100vh-180px)]">

                    <!-- Fixed Header -->

                    <div class="flex-none flex items-center justify-between mb-4">

                        <div class="flex-1 mr-4">

                            <form onsubmit="event.preventDefault(); navigateManual();" class="flex items-center">

                                <span class="text-gray-500 mr-2"><i class="fas fa-folder-open"></i></span>

                                <input type="text" id="path-input" 

                                    class="w-full bg-white border border-gray-300 text-gray-700 text-sm rounded-lg focus:ring-indigo-500 focus:border-indigo-500 block p-2.5 font-mono" 

                                    placeholder="/path/to/directory" value="${currentFilesPath}">

                            </form>

                        </div>

                        <div class="flex space-x-2 shrink-0">

                            <!-- AI Create Button -->

                            <button onclick="openAICreateFileModal()" class="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-xs font-bold hover:from-purple-700 hover:to-indigo-700 shadow-sm border border-transparent"><i class="fas fa-magic mr-2"></i>AI Create</button>

                            

                            <!-- Standard Create Actions -->

                            <button onclick="createNewFile()" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50 shadow-sm"><i class="fas fa-file mr-2"></i>New File</button>

                            <button onclick="createNewFolder()" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50 shadow-sm"><i class="fas fa-folder-plus mr-2"></i>New Folder</button>



                            <input type="file" id="upload-input" class="hidden" onchange="handleFileUploads(this.files)">

                            <button onclick="document.getElementById('upload-input').click()" class="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-sm"><i class="fas fa-upload mr-2"></i>Upload</button>

                            <button onclick="navigateUp()" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50"><i class="fas fa-level-up-alt mr-2"></i>Up</button>

                            <button onclick="loadFiles(currentFilesPath)" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50"><i class="fas fa-sync-alt"></i></button>

                        </div>

                    </div>



                    <!-- Selection Toolbar -->

                    <div id="selection-toolbar" class="hidden flex-none flex items-center justify-between mb-3 px-4 py-3 bg-indigo-50 border border-indigo-200 rounded-lg">

                        <div class="flex items-center">

                            <span class="text-indigo-700 font-medium text-sm"><i class="fas fa-check-square mr-2"></i><span id="selection-count">0</span> selected</span>

                            <button onclick="clearSelection()" class="ml-3 text-xs text-indigo-600 hover:text-indigo-800 underline">Clear</button>

                        </div>

                        <div class="flex space-x-2">

                            <button onclick="downloadSelectedFiles()" class="px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700">

                                <i class="fas fa-download mr-1"></i>Download

                            </button>

                            <!-- AI Edit Button -->

                            <button onclick="openAIEditFileModal()" class="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-bold hover:bg-purple-700 border border-transparent">

                                <i class="fas fa-magic mr-1"></i>AI Edit

                            </button>

                            <button onclick="copySelectedFiles()" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50">

                                <i class="fas fa-copy mr-1"></i>Copy

                            </button>

                            <button onclick="cutSelectedFiles()" class="px-3 py-1.5 bg-white border border-gray-300 text-gray-700 rounded-lg text-xs font-bold hover:bg-gray-50">

                                <i class="fas fa-cut mr-1"></i>Cut

                            </button>

                            <button onclick="moveSelectedFiles()" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-bold hover:bg-blue-700">

                                <i class="fas fa-arrows-alt mr-1"></i>Move to...

                            </button>

                            <button onclick="deleteSelectedFiles()" class="px-3 py-1.5 bg-red-600 text-white rounded-lg text-xs font-bold hover:bg-red-700">

                                <i class="fas fa-trash mr-1"></i>Delete

                            </button>

                        </div>

                    </div>



                    <!-- Paste Bar (shown when clipboard has items) -->

                    <div id="paste-toolbar" class="hidden flex-none flex items-center justify-between mb-3 px-4 py-3 bg-green-50 border border-green-200 rounded-lg">

                        <div class="flex items-center">

                            <span class="text-green-700 font-medium text-sm"><i class="fas fa-clipboard mr-2"></i><span id="clipboard-count">0</span> items in clipboard (<span id="clipboard-mode">copy</span>)</span>

                            <button onclick="clearClipboard()" class="ml-3 text-xs text-green-600 hover:text-green-800 underline">Clear</button>

                        </div>

                        <div class="flex space-x-2">

                            <button onclick="pasteFiles()" class="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-bold hover:bg-green-700">

                                <i class="fas fa-paste mr-1"></i>Paste Here

                            </button>

                        </div>

                    </div>



                    <!-- Scrollable Table -->

                    <div class="flex-1 overflow-y-auto bg-white border border-gray-200 rounded-xl shadow-sm relative">

                        <table class="w-full text-left text-sm">

                            <thead class="bg-gray-50 border-b border-gray-200 sticky top-0 z-10 shadow-sm">

                                <tr>

                                    <th class="px-3 py-3 w-10">

                                        <input type="checkbox" id="select-all-checkbox" onchange="toggleSelectAll(this.checked)" 

                                            class="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer">

                                    </th>

                                    <th class="px-4 py-3 font-medium text-gray-500 w-10">Type</th>

                                    <th class="px-4 py-3 font-medium text-gray-500">Name</th>

                                    <th class="px-4 py-3 font-medium text-gray-500">Size</th>

                                    <th class="px-4 py-3 font-medium text-gray-500">Modified</th>

                                </tr>

                            </thead>

                            <tbody class="divide-y divide-gray-100" id="files-table-body">

                                ${getSkeletonHtml('table-rows')}

                            </tbody>

                        </table>

                    </div>

                </div>

            `,



                // SECURITY VIEW

                security: () => `

                <div class="space-y-6 fade-in">

                    <!-- Header -->

                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">

                        <div>

                            <h2 class="text-xl font-bold text-gray-900 tracking-tight">Security Center</h2>

                            <p class="text-xs text-gray-500 mt-0.5">Manage firewall rules, SSL certificates, and security configurations.</p>

                        </div>

                        <button onclick="loadSecurity()" class="px-3 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"><i class="fas fa-sync-alt mr-1.5"></i>Rescan</button>

                    </div>

                    <div id="security-container" class="space-y-6">

                         ${getSkeletonHtml('card-grid')}

                    </div>

                </div>

                `,



                // CI/CD PIPELINES VIEW

                cicd: () => `
                <div id="cicd-main-container" class="fade-in">
                    <div id="pipeline-backend-banner" class="hidden mb-6 bg-rose-600 text-white px-5 py-3 rounded-2xl text-sm font-bold flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <i class="fas fa-exclamation-triangle"></i>
                            <span>Backend unavailable. Check Railway deployment.</span>
                        </div>
                        <button onclick="loadPipelines()" class="bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all">Retry</button>
                    </div>
                    <div class="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-10">
                        <div class="flex items-center gap-5">
                            <button onclick="navigate('servers')" class="w-12 h-12 rounded-2xl bg-white border border-slate-200 text-slate-400 hover:text-indigo-600 hover:border-indigo-200 flex items-center justify-center transition-all shadow-sm group">
                                <i class="fas fa-arrow-left text-sm group-hover:-translate-x-0.5 transition-transform"></i>
                            </button>
                            <div>
                                <h2 class="text-3xl font-black text-slate-900 tracking-tight">CI/CD Pipelines</h2>
                                <p class="text-sm text-slate-500 font-medium">Global automation and deployment engine.</p>
                            </div>
                        </div>

                        <div class="flex items-center gap-3">
                            <button onclick="openCreatePipelineView()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-2xl font-black shadow-lg shadow-indigo-100 transition-all active:scale-95 flex items-center group">
                                <i class="fas fa-plus mr-2 group-hover:rotate-90 transition-transform"></i>
                                New Pipeline
                            </button>
                        </div>
                    </div>

                    <!-- Filter / Stats Bar -->
                    <div class="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
                         <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                             <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Total Pipelines</span>
                             <span class="text-xl font-black text-slate-900" id="total-pipelines-count">0</span>
                         </div>
                         <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                             <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Active Runs</span>
                             <span class="text-xl font-black text-emerald-600">0</span>
                         </div>
                         <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                             <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Success Rate</span>
                             <span class="text-xl font-black text-indigo-600">--%</span>
                         </div>
                         <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                             <span class="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Avg. Duration</span>
                             <span class="text-xl font-black text-slate-700">--s</span>
                         </div>
                    </div>

                    <!-- Pipelines List -->
                    <div id="pipelines-list-container" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        <div class="col-span-full py-20 text-center bg-white border-2 border-dashed border-slate-200 rounded-[32px]">
                            <i class="fas fa-circle-notch fa-spin text-3xl text-indigo-500 mb-4"></i>
                            <p class="text-slate-500 font-bold">Initializing Pipeline Engine...</p>
                        </div>
                    </div>
                </div>

                <div id="cicd-builder-container" class="hidden fixed inset-0 z-[100] bg-slate-50">
                    <div id="devyntra-pipeline-root" class="w-full h-full"></div>
                </div>
            `,



                // MONITORING VIEW

                monitoring: () => `

                <div class="fade-in" id="monitoring-page" style="margin: 0; padding: 0;">
                    <div class="w-full overflow-hidden" style="height: calc(100vh - 60px); margin: 0; padding: 0;">
                        <iframe
                            id="monitoring-modern-frame"
                            src="monitoring-modern.html"
                            class="w-full h-full"
                            frameborder="0"
                            style="border: none; display: block; margin: 0; padding: 0;"
                        ></iframe>
                    </div>
                </div>

                `,




                // SCHEDULED TASKS VIEW

                tasks: () => `

                <div class="space-y-6 fade-in">

                    <!-- Header -->

                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">

                        <div>

                            <h2 class="text-xl font-bold text-gray-900 tracking-tight">Scheduled Tasks</h2>

                            <p class="text-xs text-gray-500 mt-0.5">Create, edit, and manage cron jobs to automate scripts and commands.</p>

                        </div>

                        <div class="flex items-center gap-2">

                            <button onclick="loadTasks()" class="px-3 py-2 bg-white border border-gray-200 text-gray-700 rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm hover:bg-gray-50 transition-all"><i class="fas fa-sync-alt mr-1.5"></i>Refresh</button>

                            <button id="btn-create-task-header" class="px-3 py-2 bg-indigo-600 text-white rounded-lg text-[10px] font-black uppercase tracking-wider shadow-md shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95"><i class="fas fa-plus mr-1.5"></i>New Task</button>

                        </div>

                    </div>

                    <div id="tasks-container" class="space-y-6">

                         ${getSkeletonHtml('list-items')}

                    </div>

                </div>

                `,



                // HISTORY VIEW

                history: () => `

                <h2 class="text-xl font-bold text-gray-900 mb-6">Activity History</h2>

                <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">

                    <div class="divide-y divide-gray-100" id="full-history-log">

                        <div class="p-4 text-center text-gray-400 text-sm">Loading history...</div>

                    </div>

                </div>

            `,



                // TERMINAL VIEW

                terminal: () => `

                <div class="flex flex-col h-[calc(100vh-160px)] bg-black rounded-xl shadow-2xl overflow-hidden border border-gray-800">

                    <div class="flex-1 p-4 font-mono text-sm relative overflow-hidden flex flex-col bg-black" onclick="document.getElementById('terminal-input').focus()">

                        <style>

                            .term-cursor { display: inline-block; width: 10px; height: 18px; background-color: #0f0; animation: blink 1s step-end infinite; vertical-align: middle; margin-bottom: 2px; }

                            @keyframes blink { 50% { opacity: 0; } }

                            .scrollbar-hide::-webkit-scrollbar { display: none; }

                            #terminal-input { position: absolute; opacity: 0; top: -1000px; }

                        </style>

                        <div id="terminal-output" class="flex-1 overflow-y-auto scrollbar-hide" style="font-family: 'Consolas', 'Menlo', monospace;">

                            <div class="text-gray-400 mb-2">Devyntra SSH Client v2.0 - Authenticated</div>

                            <div class="text-gray-400 mb-4">Last login: ${new Date().toLocaleString()}</div>

                            <div id="term-history"></div>

                            <div id="active-line" class="flex flex-wrap items-center">

                                <span class="text-green-500 font-bold mr-0">ubuntu@${connectedServerData?.name || connectedServerData?.host || 'server'}</span>

                                <span class="text-white mr-1">:</span>

                                <span class="text-blue-500 font-bold mr-1">~</span>

                                <span class="text-white mr-2">$</span>

                                <span id="term-text-display" class="text-white whitespace-pre-wrap break-all"></span><span class="term-cursor"></span>

                            </div>

                        </div>

                        <input type="text" id="terminal-input" oninput="updateTerminalDisplay(this.value)" onkeydown="handleTerminalKeydown(event)" autocomplete="off" spellcheck="false" autofocus>

                    </div>

                    <div class="bg-gray-900 border-t border-gray-800 p-2 flex gap-2 items-center z-10 relative shadow-sm">

                        <div class="bg-gradient-to-r from-indigo-500 to-purple-600 rounded-lg w-8 h-8 flex items-center justify-center shrink-0 shadow-glow"><i class="fas fa-magic text-white text-xs"></i></div>

                        <input type="text" id="ai-command-input" placeholder="Ask AI..." class="flex-1 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg px-3 py-1.5 outline-none focus:border-indigo-500 font-sans" onkeydown="if(event.key === 'Enter') askAICommand()">

                        <button onclick="askAICommand()" class="bg-white text-indigo-600 hover:bg-indigo-50 px-4 py-1.5 rounded-lg text-xs font-bold shadow-sm transition-colors border border-gray-200">Generate</button>

                    </div>

                </div>

            `,

            };



            // --- CI/CD LOGIC ---

            let pipelines = [];



            function getPipelineApiBase() {

                const base = (window.__DEVYNTRA_BACKEND_URL || '').toString().replace(/\/+$/, '');

                return base;

            }



            function setPipelineBackendBanner(message) {

                const el = document.getElementById('pipeline-backend-banner');

                if (!el) return;

                if (!message) {

                    el.classList.add('hidden');

                    el.textContent = '';

                    return;

                }

                el.textContent = message;

                el.classList.remove('hidden');

            }




            async function apiFetch(path, init = {}) {

                const token = window.__DEVYNTRA_ACCESS_TOKEN;

                const baseUrl = getPipelineApiBase();

                if (!baseUrl) {

                    setPipelineBackendBanner('Backend disconnected. Set window.__DEVYNTRA_BACKEND_URL.');

                    throw new Error('Backend disconnected');

                }

                const controller = new AbortController();

                const timeoutId = setTimeout(() => controller.abort(), 30000);

                let res;
                try {
                    res = await fetch(baseUrl + path, {

                        ...init,

                        signal: controller.signal,

                        headers: {

                            'Content-Type': 'application/json',

                            ...(init.headers || {}),

                            ...(token ? { 'Authorization': `Bearer ${token} ` } : {})

                        }

                    });
                } catch (e) {
                    clearTimeout(timeoutId);
                    if (e && e.name === 'AbortError') {
                        setPipelineBackendBanner('Backend is taking too long to respond. Check Railway deployment.');
                        throw new Error('Request Timeout (30s) - Backend is taking too long.');
                    }
                    setPipelineBackendBanner('Backend offline or connection failed.');
                    throw e;
                }

                clearTimeout(timeoutId);

                const text = await res.text();

                let payload = null;

                try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }

                if (!res.ok) {

                    const msg = payload && typeof payload === 'object' ? payload.error : payload;

                    if (res.status === 502) {

                        setPipelineBackendBanner('Backend unavailable. Check Railway deployment.');

                        throw new Error('Backend unavailable (502). Check Railway deployment.');

                    }

                    throw new Error(msg || 'Request failed');

                }

                setPipelineBackendBanner('');

                return payload;

            }




            // Declare loadPipelines function early to avoid ReferenceError

            async function loadPipelines() {

                const container = document.getElementById('pipelines-list-container');

                if (container) container.innerHTML = getSkeletonHtml('card-grid');



                try {

                    const res = await apiFetch('/api/pipelines', { method: 'GET' });

                    pipelines = (res && res.pipelines) ? res.pipelines : [];

                    if (currentView === 'cicd') renderPipelinesList();

                } catch (e) {

                    console.error("Error loading pipelines:", e);

                    // Still render empty list on error

                    pipelines = [];

                    if (currentView === 'cicd') renderPipelinesList();

                }

            }



            // Global function to open Pipeline Editor (works from any page)

            window.openCreatePipelineView = function () {
                const mainC = document.getElementById('cicd-main-container');
                const buildC = document.getElementById('cicd-builder-container');
                if (mainC && buildC) {
                    mainC.classList.add('hidden');
                    buildC.classList.remove('hidden');
                    if (window.DevyntraPipelineMount) {
                        window.DevyntraPipelineMount();
                    }
                } else {
                    // Fallback if we are not on cicd page
                    navigate('cicd');
                    setTimeout(window.openCreatePipelineView, 100);
                }
            };


            // Modern React Bridge: The entire Pipeline UI is now managed by the React app in /apps_pipeline
            // This eliminates the 5000+ lines of legacy jQuery-style DOM manipulation.



            // End of Modern React Bridge




            // --- CI/CD PIPELINE BUILDER (State & Logic) ---



            // Initialize Global Servers from Storage (Ensures availability for Dropdowns & Runner)

            try {

                // Initialize empty, populated by Supabase

                window.userServers = window.userServers || [];

            } catch (e) {

                console.error("Failed to init user servers:", e);

                window.userServers = [];

            }



            window.runPipeline = async function () {

                if (!window.draftPipeline || !window.draftPipeline.jobs || window.draftPipeline.jobs.length === 0) {

                    alert('Pipeline is empty. Add stages first.');

                    return;

                }



                // 1. Auto-Assign Server to Remote Jobs if missing

                const jobs = window.draftPipeline.jobs;

                const remoteJobs = jobs.filter(j => j.type === 'remote' || j.metaType === 'deploy');



                for (const job of remoteJobs) {

                    if (!job.params || !job.params.serverId) {

                        if (window.userServers.length > 0) {

                            if (!job.params) job.params = {};

                            job.params.serverId = window.userServers[0].id;

                            job.params.target_host = window.userServers[0].host;

                            console.log(`Auto - assigned server ${window.userServers[0].host} to job ${job.name} `);

                        } else {

                            alert(`Stage "${job.name}" requires a target server.Please select one in the stage configuration.`);

                            return;

                        }

                    }

                }



                // 2. Show Logs Modal

                const logsModal = document.getElementById('pipeline-logs-modal');

                if (logsModal) {

                    logsModal.classList.remove('hidden');

                    const content = document.getElementById('pipeline-log-content');

                    if (content) content.innerHTML = '<div class="text-gray-400 italic">Initializing pipeline runner...</div>';



                    const icon = document.getElementById('log-status-icon');

                    if (icon) icon.className = "w-3 h-3 rounded-full bg-yellow-400 animate-pulse shadow-[0_0_10px_rgba(250,204,21,0.5)]";



                    const title = document.getElementById('log-pipeline-name');

                    if (title) title.innerText = `Running: ${window.draftPipeline.name} `;

                }



                // 3. Prepare Runner Config (Default to primary server for runner)

                let runnerConfig = null;

                if (window.userServers.length > 0) {

                    const s = window.userServers[0];

                    runnerConfig = {

                        host: s.host,

                        username: s.username,

                        password: s.password,

                        privateKey: s.privateKey,

                        passphrase: s.passphrase,

                        port: s.port || 22

                    };

                }



                // 4. Execute

                try {

                    // Ensure ipcRenderer is available

                    const { ipcRenderer } = require('electron');



                    const result = await ipcRenderer.invoke('cicd:run-pipeline', {

                        pipeline: window.draftPipeline,

                        serverConfig: runnerConfig

                    });



                    if (result.success) {

                        const icon = document.getElementById('log-status-icon');

                        if (icon) icon.className = "w-3 h-3 rounded-full bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)]";

                        // Update last run time?

                    } else {

                        const icon = document.getElementById('log-status-icon');

                        if (icon) icon.className = "w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]";



                        const content = document.getElementById('pipeline-log-content');

                        if (content) {

                            const errDiv = document.createElement('div');

                            errDiv.className = "text-red-400 font-bold mt-2 border-t border-red-500/30 pt-2";

                            errDiv.textContent = `Error: ${result.error} `;

                            content.appendChild(errDiv);

                        }

                    }

                } catch (e) {

                    alert('Execution Failed: ' + e.message);

                }

            };



            // --- DURABLE PIPELINE DESIGNER ENGINE ---

            window.graphState = {

                panX: 0,

                panY: 0,

                zoom: 1,

                isPanning: false,

                draggingNodeIndex: null,

                dragOffsetX: 0,

                dragOffsetY: 0,

                connectingNodeIndex: null,

                isFullscreen: false,

                lastMouseX: 0,

                lastMouseY: 0

            };



            window.toCanvasCoords = function (x, y) {

                const rect = document.getElementById('designer-viewport').getBoundingClientRect();

                if (!rect) return { x, y };

                return {

                    x: (x - rect.left - window.graphState.panX) / window.graphState.zoom,

                    y: (y - rect.top - window.graphState.panY) / window.graphState.zoom

                };

            };



            window.applyCanvasTransform = function () {

                const canvas = document.getElementById('designer-canvas');

                if (canvas) {

                    canvas.style.transform = `translate(${window.graphState.panX}px, ${window.graphState.panY}px) scale(${window.graphState.zoom})`;

                }

            };



            window.initDesignerCanvas = function () {

                const container = document.getElementById('view-visual');

                if (!container) return;



                container.innerHTML = `

                < !--Floating Toolbar: Meta Information-- >

                             <div class="absolute top-6 left-6 z-50 flex items-center gap-4">

                                 <div class="bg-white/90 backdrop-blur-md border border-slate-200/50 rounded-2xl p-4 shadow-xl shadow-slate-200/50 flex items-center gap-6">

                                     <div class="flex items-center gap-3 pr-6 border-r border-slate-100">

                                         <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-lg shadow-lg shadow-indigo-100">

                                             <i class="fas fa-project-diagram"></i>

                                         </div>

                                         <div class="min-w-[180px]">

                                             <input type="text" id="header-pipeline-name" value="${window.draftPipeline.name}" 

                                                 onchange="window.updateDraftMeta('name', this.value)"

                                                 class="block w-full text-sm font-bold text-slate-900 bg-transparent outline-none focus:text-indigo-600 transition-colors"

                                                 placeholder="Untitled Pipeline">

                                             <div class="flex items-center gap-2 mt-0.5">

                                                 <span class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Workflow</span>

                                                 <span class="w-1 h-1 rounded-full bg-slate-300"></span>

                                                 <select onchange="window.updateDraftMeta('trigger', this.value)" 

                                                     class="text-[10px] font-bold text-indigo-500 bg-transparent outline-none cursor-pointer uppercase tracking-widest hover:text-indigo-600">

                                                     <option value="manual" ${window.draftPipeline.trigger === 'manual' ? 'selected' : ''}>Manual Dispatch</option>

                                                     <option value="git" ${window.draftPipeline.trigger === 'git' ? 'selected' : ''}>Git Hook</option>

                                                 </select>

                                             </div>

                                         </div>

                                     </div>

                                     

                                     <div class="flex items-center gap-2">

                                         <button onclick="window.undoPipelineAction()" class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="Undo (Ctrl+Z)">

                                             <i class="fas fa-undo"></i>

                                         </button>

                                         <button onclick="window.redoPipelineAction()" class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="Redo (Ctrl+Y)">

                                             <i class="fas fa-redo"></i>

                                         </button>

                                         <div class="h-6 w-px bg-slate-100 mx-1"></div>

                                         <button onclick="window.addJob()" class="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all" title="Add New Stage">

                                             <i class="fas fa-plus-circle text-lg"></i>

                                         </button>

                                         <div class="h-6 w-px bg-slate-100 mx-1"></div>

                                         <button onclick="window.toggleFullScreen()" class="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition-all" title="Toggle Fullscreen">

                                             <i class="fas fa-expand"></i>

                                         </button>

                                     </div>

                                 </div>

                             </div>



                             <!--Floating Action Button(Center Bottom)-- >

                             <div class="absolute bottom-10 left-1/2 -translate-x-1/2 z-50">

                                 <button onclick="window.addJob()" class="bg-indigo-600 hover:bg-indigo-700 text-white px-8 py-4 rounded-full flex items-center gap-4 shadow-2xl shadow-indigo-500/30 transition-all hover:scale-105 active:scale-95 group font-bold tracking-wider">

                                     <i class="fas fa-plus text-sm"></i>

                                     <span>ADD PIPELINE STAGE</span>

                                 </button>

                             </div>



                             <!--Instruction Legend(Bottom Left)-- >

                             <div class="absolute bottom-8 left-8 z-50">

                                 <div class="bg-white/95 backdrop-blur-xl border border-slate-200/50 rounded-2xl px-5 py-4 shadow-2xl flex items-center gap-8 translate-y-0 group-hover:-translate-y-2 transition-transform duration-500">

                                     <div class="flex items-center gap-3">

                                         <div class="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-[10px]">MB1</div>

                                         <div class="flex flex-col">

                                             <span class="text-[9px] font-bold text-slate-400 uppercase tracking-widest leading-none mb-1">Select</span>

                                             <span class="text-xs font-extrabold text-slate-700">Drag Stage</span>

                                         </div>

                                     </div>

                                     <div class="flex items-center gap-3">

                                         <div class="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-500 font-bold text-[10px]">MB2</div>

                                         <div class="flex flex-col">

                                             <span class="text-[9px] font-bold text-indigo-400 uppercase tracking-widest leading-none mb-1">Navigate</span>

                                             <span class="text-xs font-extrabold text-slate-700">Pan Canvas</span>

                                         </div>

                                     </div>

                                     <div class="flex items-center gap-3">

                                         <div class="w-8 h-8 rounded-lg bg-orange-50 flex items-center justify-center text-orange-500">

                                             <i class="fas fa-cut text-xs"></i>

                                         </div>

                                         <div class="flex flex-col">

                                             <span class="text-[9px] font-bold text-orange-400 uppercase tracking-widest leading-none mb-1">Hover</span>

                                             <span class="text-xs font-extrabold text-slate-700">Cut Links</span>

                                         </div>

                                     </div>

                                 </div>

                             </div>



                             <!--THE DESIGNER CANVAS-- >

                <div id="designer-viewport"

                    class="w-full h-full relative cursor-grab active:cursor-grabbing select-none overflow-hidden"

                    onmousedown="window.handleCanvasMouseDown(event)"

                    onmousemove="window.handleCanvasMouseMove(event)"

                    onclick="window.handleCanvasClick(event)"

                    onwheel="window.handleCanvasWheel(event)"

                    ondrop="window.handleCanvasDrop(event)"

                    ondragover="event.preventDefault()">



                    <div id="designer-canvas" class="absolute inset-0 origin-top-left" style="transform: translate(0px, 0px) scale(1);">



                        <!-- Dot Grid Background -->

                        <div id="designer-grid"

                            class="absolute top-[-2500px] left-[-2500px] w-[5000px] h-[5000px] pointer-events-none opacity-40"

                            style="background-image: radial-gradient(#cbd5e1 1.5px, transparent 1.5px); background-size: 40px 40px;">

                        </div>



                        <!-- Connections Layer -->

                        <svg id="pipeline-connections"

                            class="absolute inset-0 z-10 overflow-visible pointer-events-none"

                            style="width: 5000px; height: 5000px;"></svg>



                        <!-- Nodes Layer -->

                        <div id="graph-nodes-layer" class="relative z-20">

                            <!-- Nodes will be injected here -->

                        </div>



                        <!-- Cut Controls Layer (HTML) - Must be ABOVE nodes -->

                        <div id="connection-controls-layer"

                            class="absolute inset-0 z-50 pointer-events-none"

                            style="width: 5000px; height: 5000px;"></div>



                    </div>

                </div>

            `;

            };



            window.handleCanvasClick = function (ev) {

                const target = ev.target;

                const cutControl = target.closest('.cut-control');

                if (cutControl) {

                    const idx = parseInt(cutControl.getAttribute('data-index'));

                    const depId = cutControl.getAttribute('data-dep');

                    console.log('Global Canvas Click - Cut Control:', idx, depId);

                    window.disconnectJob(ev, idx, depId);

                    ev.stopPropagation();

                }

            };



            window.handleCanvasMouseDown = function (ev) {

                const target = ev.target;

                // Allow clicks on buttons, inputs, and cut controls to pass through

                if (target.closest('button, input, select, textarea, kbd, .cut-control')) return;



                const nodeEl = target.closest('[id^="node-"]');

                const connector = target.closest('.node-connector');



                if (connector && nodeEl) {

                    const idx = parseInt(nodeEl.id.split('-')[1]);

                    window.graphState.connectingNodeIndex = idx;

                    ev.stopPropagation();

                    return;

                }



                if (nodeEl && ev.button === 0) {

                    const idx = parseInt(nodeEl.id.split('-')[1]);

                    const job = window.draftPipeline.jobs[idx];

                    const canvasPos = window.toCanvasCoords(ev.clientX, ev.clientY);



                    // Save snapshot BEFORE starting drag (for undo)

                    if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();



                    window.graphState.draggingNodeIndex = idx;

                    window.graphState.dragOffsetX = canvasPos.x - job.x;

                    window.graphState.dragOffsetY = canvasPos.y - job.y;

                    ev.stopPropagation();

                    return;

                }



                if (ev.button === 2 || !nodeEl) {

                    window.graphState.isPanning = true;

                    window.graphState.lastMouseX = ev.clientX;

                    window.graphState.lastMouseY = ev.clientY;

                    if (ev.button === 2) ev.preventDefault();

                }

            };



            window.handleCanvasMouseMove = function (ev) {

                const state = window.graphState;

                if (state.isPanning) {

                    const dx = ev.clientX - state.lastMouseX;

                    const dy = ev.clientY - state.lastMouseY;

                    state.panX += dx;

                    state.panY += dy;

                    state.lastMouseX = ev.clientX;

                    state.lastMouseY = ev.clientY;

                    window.applyCanvasTransform();

                    window.updateConnections(); // Update connections during pan

                    return;

                }



                if (state.draggingNodeIndex !== null) {

                    const canvasPos = window.toCanvasCoords(ev.clientX, ev.clientY);

                    const job = window.draftPipeline.jobs[state.draggingNodeIndex];

                    job.x = canvasPos.x - state.dragOffsetX;

                    job.y = canvasPos.y - state.dragOffsetY;

                    const nodeEl = document.getElementById(`node - ${state.draggingNodeIndex} `);

                    if (nodeEl) {

                        nodeEl.style.left = `${job.x} px`;

                        nodeEl.style.top = `${job.y} px`;

                    }

                    window.updateConnections();

                }



                if (state.connectingNodeIndex !== null) {

                    const canvasPos = window.toCanvasCoords(ev.clientX, ev.clientY);

                    window.updateConnections(canvasPos.x, canvasPos.y);

                }

            };



            window.handleCanvasWheel = function (ev) {

                ev.preventDefault();

                const delta = -ev.deltaY;

                const zoomFactor = delta > 0 ? 1.1 : 1 / 1.1;

                const nextZoom = Math.min(Math.max(window.graphState.zoom * zoomFactor, 0.2), 3);

                const rect = document.getElementById('designer-viewport').getBoundingClientRect();

                if (!rect) return;

                const mouseX = ev.clientX - rect.left;

                const mouseY = ev.clientY - rect.top;

                const dx = (mouseX - window.graphState.panX) * (1 - nextZoom / window.graphState.zoom);

                const dy = (mouseY - window.graphState.panY) * (1 - nextZoom / window.graphState.zoom);

                window.graphState.panX += dx;

                window.graphState.panY += dy;

                window.graphState.zoom = nextZoom;

                window.applyCanvasTransform();

                window.updateConnections(); // Update connections after zoom

            };



            window.handleGlobalMouseUp = function (ev) {

                const state = window.graphState;

                if (state.connectingNodeIndex !== null) {

                    const targetNodeEl = ev.target.closest('[id^="node-"]');

                    if (targetNodeEl) {

                        const targetIndex = parseInt(targetNodeEl.id.split('-')[1]);

                        if (targetIndex !== state.connectingNodeIndex) {

                            window.completeConnection(ev, targetIndex);

                        }

                    }

                }

                state.isPanning = false;

                state.draggingNodeIndex = null;

                state.connectingNodeIndex = null;

                window.updateConnections();

            };



            window.completeConnection = function (ev, targetIndex) {

                if (ev) ev.stopPropagation();

                const sourceIdx = window.graphState.connectingNodeIndex;

                const targetJob = window.draftPipeline.jobs[targetIndex];

                const sourceJob = window.draftPipeline.jobs[sourceIdx];

                if (!targetJob.needs) targetJob.needs = [];

                if (!targetJob.needs.includes(sourceJob.id)) {

                    // Save snapshot before making connection (for undo)

                    if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();

                    targetJob.needs.push(sourceJob.id);

                    window.updateConnections();

                    window.generateYamlPreview();

                }

            };



            window.disconnectJob = function (ev, targetIdx, depId) {

                console.log('disconnectJob called:', { targetIdx, depId });

                if (ev) ev.stopPropagation();

                const job = window.draftPipeline.jobs[targetIdx];

                console.log('Job found:', job);

                if (job && job.needs) {

                    // Save snapshot before disconnecting (for undo)

                    if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();

                    console.log('Before removal:', job.needs);

                    job.needs = job.needs.filter(id => id !== depId);

                    console.log('After removal:', job.needs);

                    window.updateConnections();

                    window.generateYamlPreview();

                }

            };



            window.updateConnections = function (mouseX, mouseY) {

                const svg = document.getElementById('pipeline-connections');

                const controlsLayer = document.getElementById('connection-controls-layer');

                if (!svg || !controlsLayer) return;



                const jobs = window.draftPipeline.jobs;

                let paths = '';

                let controlsHtml = '';

                const cardWidth = 320;



                jobs.forEach((job, i) => {

                    if (job.needs && job.needs.length > 0) {

                        job.needs.forEach(depId => {

                            const sIdx = jobs.findIndex(j => j.id === depId);

                            if (sIdx >= 0) {

                                const source = jobs[sIdx];



                                // Get dynamic heights

                                const sourceEl = document.getElementById(`node - ${sIdx} `);

                                const targetEl = document.getElementById(`node - ${i} `);

                                const sH = sourceEl ? sourceEl.offsetHeight : 420;

                                const tH = targetEl ? targetEl.offsetHeight : 420;



                                // Connect to actual connector positions - Output connector is 6px to the right

                                const startX = source.x + cardWidth + 6;

                                const startY = source.y + (sH / 2);

                                // Input connector is 6px to the left of the card

                                const endX = job.x - 6;

                                const endY = job.y + (tH / 2);

                                const cp1X = startX + 80;

                                const cp2X = endX - 80;

                                const midX = 0.125 * startX + 0.375 * cp1X + 0.375 * cp2X + 0.125 * endX;

                                const midY = 0.125 * startY + 0.375 * startY + 0.375 * endY + 0.125 * endY;



                                paths += `< g class="connection-group" >
                                    <path d="M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}" stroke="rgba(99, 102, 241, 0.2)" stroke-width="4" fill="none" />
                                    <path d="M ${startX} ${startY} C ${cp1X} ${startY}, ${cp2X} ${endY}, ${endX} ${endY}" stroke="#6366f1" stroke-width="1.5" fill="none" />
                                </g > `;




                                controlsHtml += `
                < div class="cut-control absolute flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer"
            style = "left: ${midX - 16}px; top: ${midY - 16}px; width: 32px; height: 32px; z-index: 9999; pointer-events: auto !important;"
            onmousedown = "window.handleCutMouseDown(event, ${i}, '${depId}')"
            title = "Disconnect Stage" >


                <div class="w-7 h-7 bg-white border-2 border-red-400 rounded-full flex items-center justify-center shadow-lg hover:scale-110 transition-transform text-red-500">

                    <i class="fas fa-times text-[10px]"></i>

                </div>

                                    </div >
                `;

                            }

                        });

                    }

                });



                if (window.graphState.connectingNodeIndex !== null && mouseX !== undefined) {

                    const source = jobs[window.graphState.connectingNodeIndex];

                    const sourceEl = document.getElementById(`node - ${window.graphState.connectingNodeIndex} `);

                    const sH = sourceEl ? sourceEl.offsetHeight : 420;



                    const startX = source.x + cardWidth;

                    const startY = source.y + (sH / 2);

                    paths += `< path d = "M ${startX} ${startY} C ${startX + 60} ${startY}, ${mouseX - 60} ${mouseY}, ${mouseX} ${mouseY}" stroke = "#6366f1" stroke - width="2" stroke - dasharray="8,8" fill = "none" class="animate-pulse" /> `;

                }

                svg.innerHTML = paths;

                controlsLayer.innerHTML = controlsHtml;

            };



            // New robust handler for immediate action

            window.handleCutMouseDown = function (ev, index, depId) {

                console.log('Immediate Cut Action:', index, depId);

                ev.stopPropagation(); // Stop pan

                ev.preventDefault(); // Stop selection/other

                window.disconnectJob(null, index, depId);

            };



            window.renderGraphNodes = function () {

                const container = document.getElementById('graph-nodes-layer');

                if (!container) return;


                const jobs = window.draftPipeline.jobs;
                const serverOptions = (typeof userServers !== 'undefined' ? userServers : []).map(s => `< option value = "${s.id}" > ${s.name || s.host}</option > `).join('');

                const getJobUI = (job, i) => {
                    const jobName = job.name.toLowerCase();
                    const hasScript = job.script && job.script.trim().length > 0;
                    const scriptLines = hasScript ? job.script.split('\n').length : 0;

                    let category = 'general';
                    let categoryIcon = 'fa-cog';
                    let categoryColor = 'slate';
                    let categoryLabel = 'General Stage';

                    if (jobName.includes('lint')) {
                        category = 'lint'; categoryIcon = 'fa-search'; categoryColor = 'yellow'; categoryLabel = 'Code Linting';
                    } else if (jobName.includes('test')) {
                        category = 'test'; categoryIcon = 'fa-vial'; categoryColor = 'purple'; categoryLabel = 'Testing';
                    } else if (jobName.includes('build')) {
                        category = 'build'; categoryIcon = 'fa-cube'; categoryColor = 'indigo'; categoryLabel = 'Build Process';
                    } else if (jobName.includes('docker')) {
                        category = 'docker'; categoryIcon = 'fa-docker'; categoryColor = 'blue'; categoryLabel = 'Docker Build';
                    } else if (jobName.includes('release')) {
                        category = 'release'; categoryIcon = 'fa-cloud-upload-alt'; categoryColor = 'green'; categoryLabel = 'Release';
                    } else if (jobName.includes('deploy') || job.type === 'remote') {
                        category = 'deploy'; categoryIcon = 'fa-rocket'; categoryColor = 'green'; categoryLabel = 'Deployment';
                    } else if (jobName.includes('source') || jobName.includes('checkout')) {
                        category = 'source'; categoryIcon = 'fa-code-branch'; categoryColor = 'blue'; categoryLabel = 'Source Control';
                    }

                    const depCount = job.needs ? job.needs.length : 0;
                    let paramsHtml = '';
                    let effectiveParams = job.params;
                    if (!effectiveParams || Object.keys(effectiveParams).length === 0) {
                        const typeKey = job.metaType || (category === 'source' ? 'source' : category === 'docker' ? 'docker' : category === 'deploy' ? 'deploy' : category === 'release' ? 'release' : category === 'lint' ? 'lint' : category === 'test' ? 'test' : category === 'build' ? 'build' : jobName.includes('kube') ? 'k8s' : 'custom');
                        const tpl = window.getStageTemplate(typeKey);
                        if (tpl && tpl.params) effectiveParams = tpl.params;
                    }

                    if (effectiveParams && Object.keys(effectiveParams).length > 0) {
                        paramsHtml = `< div class="bg-indigo-50/20 rounded-xl p-3 border border-indigo-100/50" >
                            <div class="text-[9px] font-bold text-indigo-400 uppercase tracking-wider mb-0.5 border-b border-indigo-100 pb-1 flex items-center"><i class="fas fa-sliders-h mr-1.5"></i> Configuration</div>
                            <div class="flex flex-col gap-2">`;
                        for (const [key, val] of Object.entries(effectiveParams)) {
                            const label = key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
                            const inputType = (key.includes('token') || key.includes('password')) ? 'password' : 'text';
                            let isRequired = (key !== 'token' && key !== 'pre_cmd' && key !== 'post_cmd');
                            if (!isRequired) continue;
                            paramsHtml += `<div>
                                <div class="flex items-center mb-0.5 ml-0.5">
                                    <label class="block text-[9px] font-bold text-gray-500">${label}<span class="text-red-500 ml-0.5">*</span></label>
                                </div>
                                <input type="${inputType}" value="${val}" 
                                    onchange="window.updateJobParam(${i}, '${key}', this.value)"
                                    class="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-[10px] font-medium text-gray-700 outline-none focus:border-indigo-500 transition-all placeholder-gray-300 shadow-sm focus:shadow-md h-7"
                                    placeholder="Required">
                            </div>`;
                        }
                        paramsHtml += '</div></div > ';
                    }

                    return `<div class="h-full flex flex-col">
                        <div class="flex items-center justify-between mb-4">
                            <span class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-${categoryColor}-50 text-${categoryColor}-600 border border-${categoryColor}-100">
                                <i class="fas ${categoryIcon}"></i>
                                ${categoryLabel}
                            </span>
                            <span class="text-[10px] text-gray-400 font-mono">#${i + 1}</span>
                        </div>
                        <div class="flex-1 relative">
                            <div id="job-info-${i}" class="space-y-3">
                                ${paramsHtml}
                                <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                    <div class="flex items-center justify-between">
                                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                            <i class="fas fa-project-diagram mr-1 text-indigo-400"></i> Dependencies
                                        </span>
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${depCount > 0 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}">
                                            ${depCount > 0 ? depCount + ' job' + (depCount > 1 ? 's' : '') : 'None (Start)'}
                                        </span>
                                    </div>
                                </div>
                                <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                    <div class="flex items-center justify-between">
                                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                            <i class="fas fa-server mr-1 text-green-400"></i> Execution
                                        </span>
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${job.type === 'remote' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}">
                                            ${job.type === 'remote' ? 'Remote Server' : 'CI Runner'}
                                        </span>
                                    </div>
                                </div>
                                <div class="bg-gray-50 rounded-xl p-3 border border-gray-100">
                                    <div class="flex items-center justify-between">
                                        <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                            <i class="fas fa-terminal mr-1 text-purple-400"></i> Script
                                        </span>
                                        <span class="px-2 py-0.5 rounded-full text-[10px] font-bold ${hasScript ? 'bg-purple-100 text-purple-600' : 'bg-gray-100 text-gray-500'}">
                                            ${hasScript ? scriptLines + ' line' + (scriptLines > 1 ? 's' : '') : 'Not defined'}
                                        </span>
                                    </div>
                                </div>
                                ${job.type === 'remote' && job.metaType === 'deploy' ? `
                                <div class="bg-green-50/50 rounded-xl p-3 border border-green-100">
                                    <label class="block text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                                        <i class="fas fa-server mr-1 text-green-500"></i> Target Server
                                    </label>
                                    <select onchange="window.updatePipelineJob(${i}, 'serverId', this.value)"
                                        class="w-full bg-white border border-gray-200 rounded-lg text-xs p-2 outline-none focus:border-green-500 font-medium text-gray-700">
                                        <option value="">Select Server...</option>
                                        ${serverOptions}
                                    </select>
                                </div>` : ''}
                            </div>
                            <div id="script-panel-${i}" class="hidden h-full">
                                <div class="flex items-center justify-between mb-2">
                                    <span class="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
                                        <i class="fas fa-terminal mr-1 text-purple-400"></i> Execution Script
                                    </span>
                                    <span class="text-[9px] bg-purple-100 text-purple-600 px-2 py-0.5 rounded font-bold">${scriptLines} lines</span>
                                </div>
                                <textarea onchange="window.updateJobConfig(${i}, 'script', this.value)"
                                    class="w-full h-[180px] bg-[#1e1e2e] text-green-400 border border-gray-700 rounded-xl text-[11px] font-mono p-3 outline-none focus:border-indigo-500 shadow-inner resize-none leading-relaxed" 
                                    placeholder="echo 'Hello World'"
                                    spellcheck="false">${job.script || ''}</textarea>
                            </div>
                        </div>
                        <div class="mt-4 pt-3 border-t border-gray-100">
                            <button onclick="window.toggleJobScript(${i})"
                                class="w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all
                                        ${hasScript ? 'bg-gradient-to-r from-gray-900 to-gray-800 text-white hover:from-gray-800 hover:to-gray-700' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}"
                                ${!hasScript ? 'disabled' : ''}>
                                <i class="fas fa-code"></i>
                                <span id="script-btn-text-${i}">${hasScript ? 'View Script' : 'No Script Defined'}</span>
                            </button>
                        </div>
                    </div>`;
                };




                container.innerHTML = jobs.map((job, i) => `
                <div id="node-${i}" class="absolute w-80 pointer-events-auto group/node" style="left: ${job.x}px; top: ${job.y}px;">
                    <!--Input Connector-->


                                <div class="node-connector absolute top-1/2 -left-6 -translate-y-1/2 w-12 h-12 flex items-center justify-center z-50 cursor-crosshair group/connector"

                                     onmouseup="window.completeConnection(event, ${i})" title="Drop to link">

                                    <div class="w-5 h-5 bg-white border-[3px] border-indigo-500 rounded-full group-hover/connector:scale-125 group-hover/connector:bg-indigo-50 transition-all shadow-sm"></div>

                                </div>



                                <div class="w-full h-auto min-h-[300px] bg-white border border-gray-200 rounded-2xl p-5 shadow-sm group-hover/node:shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] transition-all relative flex flex-col pb-8">

                                    <div class="flex justify-between items-start mb-6 cursor-move shrink-0">

                                        <div class="flex items-center gap-4">

                                            <div class="w-11 h-11 rounded-xl bg-${job.color}-50 text-${job.color}-600 flex items-center justify-center text-xl shadow-inner border border-${job.color}-100">

                                                <i class="fas ${job.icon}"></i>

                                            </div>

                                            <div>

                                                <div class="flex items-center gap-1">

                                                    <span id="node-name-display-${i}" 

                                                        class="block text-sm font-extrabold text-gray-900 max-w-[120px] truncate">${job.name}</span>

                                                    <button onclick="window.enableNodeNameEdit(${i})" 

                                                        class="w-5 h-5 rounded text-gray-300 hover:text-indigo-500 hover:bg-indigo-50 flex items-center justify-center transition-all" 

                                                        title="Edit name">

                                                        <i class="fas fa-pencil-alt text-[9px]"></i>

                                                    </button>

                                                </div>

                                                <input id="node-name-input-${i}" type="text" value="${job.name}" 

                                                    onchange="window.saveNodeName(${i}, this.value)" 

                                                    onblur="window.saveNodeName(${i}, this.value)"

                                                    onkeydown="if(event.key==='Enter') this.blur();"

                                                    class="hidden w-32 text-sm font-extrabold text-gray-900 border-b-2 border-indigo-500 outline-none bg-transparent px-0 py-0.5 transition-all" 

                                                    placeholder="Stage Name">

                                                <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">Pipeline Stage</p>

                                            </div>

                                        </div>

                                        <div class="flex items-center gap-1 opacity-0 group-hover/node:opacity-100 transition-opacity">

                                            <button onclick="window.toggleNodeConfig(${i})" class="w-8 h-8 rounded-lg text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 flex items-center justify-center transition-all" title="Full Config">

                                                <i class="fas fa-cog text-xs"></i>

                                            </button>

                                            <button onclick="window.removePipelineStage(${i})" class="w-8 h-8 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 flex items-center justify-center transition-all">

                                                <i class="fas fa-times text-xs"></i>

                                            </button>

                                        </div>

                                    </div>

                                    

                                    <div class="flex-1 mt-2">

                                        ${getJobUI(job, i)}

                                    </div>

                                </div>



                                <!--Output Connector-- >

                                < !--Output Connector-- >

                <div class="node-connector absolute top-1/2 -right-6 -translate-y-1/2 w-12 h-12 flex items-center justify-center z-50 cursor-crosshair group/connector"

                    onmousedown="window.startConnection(event, ${i})" title="Drag to link">

                    <div class="w-5 h-5 bg-indigo-500 border-[3px] border-white rounded-full ring-2 ring-indigo-200 group-hover/connector:scale-125 group-hover/connector:ring-indigo-400 transition-all shadow-md shadow-indigo-200"></div>

                </div>

                        </div>


                `).join('');




                window.updateConnections();
                // Draw connections immediately
                setTimeout(window.updateConnections, 0);
                setTimeout(() => {
                    window.updateConnections();
                }, 100);
            };




            // Toggle script visibility in node card (swaps with info cards)

            window.toggleJobScript = function (index) {
                const panel = document.getElementById(`script-panel-${index}`);
                const info = document.getElementById(`job-info-${index}`);
                const btn = document.getElementById(`script-btn-text-${index}`);
                if (!panel || !info) return;

                if (panel.classList.contains('hidden')) {
                    panel.classList.remove('hidden');
                    info.classList.add('hidden');
                    if (btn) btn.textContent = 'Hide Script';
                } else {
                    panel.classList.add('hidden');
                    info.classList.remove('hidden');
                    if (btn) btn.textContent = 'View Script';
                }
            };




            // Enable name editing mode

            window.enableNodeNameEdit = function (index) {

                const display = document.getElementById(`node - name - display - ${index} `);

                const input = document.getElementById(`node - name - input - ${index} `);

                if (!display || !input) return;



                display.classList.add('hidden');

                display.parentElement.querySelector('button').classList.add('hidden');

                input.classList.remove('hidden');

                input.focus();

                input.select();

            };



            // Save node name and exit edit mode

            window.saveNodeName = function (index, value) {

                const display = document.getElementById(`node - name - display - ${index} `);

                const input = document.getElementById(`node - name - input - ${index} `);

                if (!display || !input) return;



                // Update the name

                if (value && value.trim()) {

                    window.updatePipelineJob(index, 'name', value.trim());

                    display.textContent = value.trim();

                }



                // Exit edit mode

                input.classList.add('hidden');

                display.classList.remove('hidden');

                display.parentElement.querySelector('button').classList.remove('hidden');

            };





            window.updateDraftMeta = function (field, value) {

                window.draftPipeline[field] = value;

                window.generateYamlPreview();

            };



            window.updateJobConfig = function (index, field, value) {

                if (window.draftPipeline.jobs[index]) {

                    if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();

                    window.draftPipeline.jobs[index][field] = value;

                    window.generateYamlPreview();

                }

            };



            window.updateJobProfile = function (index, profile) {

                const job = window.draftPipeline.jobs[index];

                if (!job) return;



                // Get template defaults for the selected profile

                const template = window.getStageTemplate(profile);

                if (template) {

                    if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();



                    job.icon = template.icon;

                    job.color = template.color;

                    job.metaType = template.metaType;

                    // Initialize params if missing

                    if (!job.params && template.params) {

                        job.params = JSON.parse(JSON.stringify(template.params));

                    }



                    // Only overwrite script if it's empty or user confirms? 

                    // For now, let's keep existing script unless it's empty

                    if (!job.script || job.script.trim() === '') {

                        job.script = template.script;

                    }



                    window.renderGraphNodes();

                    window.generateYamlPreview();

                }

            };



            // --- STAGE LIBRARY & DRAG DROP ---



            window.rebuildJobScript = function (job) {

                const p = job.params || {};

                const type = job.metaType || 'custom';

                let script = '';



                if (type === 'source') {

                    const repo = p.repo_url || '';

                    const branch = p.branch || 'main';

                    let url = repo;

                    // Inject token if present and not already in URL

                    if (p.token && repo.startsWith('https://') && !repo.includes('@')) {

                        url = repo.replace('https://', `https://${p.token}@`);

                    }

                    script = `# Clone Source Code\ngit init\ngit remote add origin ${repo}\ngit fetch origin\ngit checkout -f ${branch}`;

                    if (p.token) script = `# Clone Source Code (Authenticated)\ngit init\ngit remote add origin ${url}\ngit fetch origin\ngit checkout -f ${branch}`;

                }

                else if (type === 'docker') {

                    script = `# Build Docker Image\ndocker build -t ${p.image_name || 'app'}:${p.tag || 'latest'} -f ${p.dockerfile || 'Dockerfile'} .`;

                }

                else if (type === 'release') {

                    const img = `${p.registry || 'docker.io'}/${p.image_name || 'app'}:${p.tag || 'latest'}`;

                    script = `# Push to Registry\ndocker login ${p.registry || 'docker.io'} -u $REGISTRY_USER -p $REGISTRY_PASS\ndocker tag ${p.image_name || 'app'}:${p.tag || 'latest'} ${img}\ndocker push ${img}`;

                }

                else if (type === 'deploy') {

                    script = `# Remote Deployment via SSH\ncd ${p.target_dir || '/var/www'}\n${p.pre_cmd || ''}\ngit pull origin main\n${p.post_cmd || 'pm2 reload all'}`;

                }

                else if (type === 'test') {

                    script = `# Run Tests\n${p.pkg_mgr || 'npm'} install\n${p.pkg_mgr || 'npm'} run ${p.script_name || 'test'}`;

                }

                else if (type === 'build') {

                    script = `# Build Project\n${p.pkg_mgr || 'npm'} install\n${p.pkg_mgr || 'npm'} run ${p.build_cmd || 'build'}`;

                }

                else if (type === 'lint') {

                    script = `# Run Linting\n${p.pkg_mgr || 'npm'} install\n${p.pkg_mgr || 'npm'} run ${p.script_name || 'lint'}`;

                }

                else if (type === 'k8s') {

                    script = `# Kubernetes Apply\nkubectl apply -f ${p.manifest_path || 'k8s/'} -n ${p.namespace || 'default'}`;

                }



                if (script) job.script = script;

            };



            window.updateJobParam = function (index, key, value) {

                const job = window.draftPipeline.jobs[index];

                if (!job) return;

                if (!job.params) job.params = {};

                job.params[key] = value;

                window.rebuildJobScript(job);

                window.renderGraphNodes(); // Update UI to reflect changes if needed

                window.generateYamlPreview();

            };



            window.getStageTemplate = function (type) {

                const defaults = {

                    source: {

                        name: 'Source Code',

                        icon: 'fa-code-branch',

                        color: 'blue',

                        metaType: 'source',

                        params: { repo_url: 'https://github.com/user/repo.git', branch: 'main', token: '' },

                        paramSchema: { required: ['repo_url', 'branch'], optional: ['token'] },

                        script: '# Clone Source Code\ngit init\ngit remote add origin https://github.com/user/repo.git\ngit fetch origin\ngit checkout -f main'

                    },

                    lint: {

                        name: 'Linting',

                        icon: 'fa-search',

                        color: 'yellow',

                        metaType: 'lint',

                        params: { pkg_mgr: 'npm', script_name: 'lint' },

                        paramSchema: { required: ['pkg_mgr', 'script_name'], optional: [] },

                        script: '# Run Linting\nnpm install\nnpm run lint'

                    },

                    test: {

                        name: 'Unit Tests',

                        icon: 'fa-vial',

                        color: 'purple',

                        metaType: 'test',

                        params: { pkg_mgr: 'npm', script_name: 'test' },

                        paramSchema: { required: ['pkg_mgr', 'script_name'], optional: [] },

                        script: '# Run Tests\nnpm install\nnpm test'

                    },

                    build: {

                        name: 'Build',

                        icon: 'fa-cube',

                        color: 'indigo',

                        metaType: 'build',

                        params: { pkg_mgr: 'npm', build_cmd: 'build', output_dir: 'dist' },

                        paramSchema: { required: ['pkg_mgr', 'build_cmd'], optional: ['output_dir'] },

                        script: '# Build Project\nnpm install\nnpm run build'

                    },

                    k8s: {

                        name: 'K8s Deploy',

                        icon: 'fa-dharmachakra',

                        color: 'blue',

                        metaType: 'k8s',

                        params: { manifest_path: 'k8s/', namespace: 'default' },

                        paramSchema: { required: ['manifest_path'], optional: ['namespace'] },

                        script: 'kubectl apply -f k8s/ -n default'

                    },

                    docker: {

                        name: 'Docker Build',

                        icon: 'fa-docker',

                        color: 'cyan',

                        metaType: 'docker',

                        params: { image_name: 'my-app', tag: 'latest', dockerfile: 'Dockerfile' },

                        paramSchema: { required: ['image_name', 'tag'], optional: ['dockerfile'] },

                        script: 'docker build -t my-app:latest -f Dockerfile .'

                    },

                    release: {

                        name: 'Release',

                        icon: 'fa-cloud-upload-alt',

                        color: 'green',

                        metaType: 'release',

                        params: { registry: 'docker.io', image_name: 'my-app', tag: 'latest' },

                        paramSchema: { required: ['registry', 'image_name', 'tag'], optional: [] },

                        script: 'docker login docker.io -u $REGISTRY_USER -p $REGISTRY_PASS\ndocker tag my-app:latest docker.io/my-app:latest\ndocker push docker.io/my-app:latest'

                    },

                    deploy: {

                        name: 'Deploy',

                        icon: 'fa-rocket',

                        color: 'green',

                        type: 'remote',

                        metaType: 'deploy',

                        params: { target_dir: '/var/www/app', pre_cmd: 'npm install', post_cmd: 'pm2 reload app' },

                        paramSchema: { required: ['target_dir'], optional: ['pre_cmd', 'post_cmd'] },

                        script: 'cd /var/www/app\nnpm install\ngit pull origin main\npm2 reload app'

                    },

                    k8s: {

                        name: 'K8s Deploy',

                        icon: 'fa-dharmachakra',

                        color: 'blue',

                        metaType: 'k8s',

                        script: 'kubectl apply -f k8s/'

                    },

                    custom: {

                        name: 'Custom Stage',

                        icon: 'fa-terminal',

                        color: 'slate',

                        metaType: 'custom',

                        script: '# Add your custom script here\necho "Running custom stage"'

                    }

                };

                return defaults[type] || defaults.custom;

            };



            window.handleCanvasDrop = function (ev) {

                ev.preventDefault();

                const type = ev.dataTransfer.getData('text/plain') || ev.dataTransfer.getData('jobType');

                if (type) {

                    const canvasPos = window.toCanvasCoords(ev.clientX, ev.clientY);

                    window.addPipelineStage(type, canvasPos.x - 160, canvasPos.y - 40);

                }

            };



            window.dragLibStart = function (ev, type) {

                ev.dataTransfer.setData('text/plain', type);

                ev.dataTransfer.setData('jobType', type);

                ev.dataTransfer.effectAllowed = 'copy';



                // Close panel on drag start? No, let's keep it open for multiple adds

            };



            window.addPipelineStage = function (type, x, y) {

                if (!type || typeof type !== 'string') {

                    const lib = document.getElementById('component-library');

                    if (lib) lib.classList.toggle('open');

                    return;

                }



                // If dropping on canvas, coordinates are passed. If clicking button, defaulting to center.

                const posX = x || 150 + ((window.draftPipeline.jobs.length || 0) * 200);

                const posY = y || 150;



                const template = window.getStageTemplate(type);



                // Deep copy params

                const params = template.params ? JSON.parse(JSON.stringify(template.params)) : {};



                window.draftPipeline.jobs.push({

                    id: 'job-' + Date.now() + Math.floor(Math.random() * 1000),

                    name: template.name,

                    icon: template.icon,

                    color: template.color,

                    type: template.type || 'local',

                    metaType: template.metaType || 'custom',

                    params: params,

                    script: template.script,

                    path: template.path || '',

                    x: posX,

                    y: posY,

                    needs: []

                });



                window.renderGraphNodes();

                window.generateYamlPreview();

            };





            window.removePipelineStage = function (index) {

                if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();

                const id = window.draftPipeline.jobs[index].id;

                window.draftPipeline.jobs.splice(index, 1);

                window.draftPipeline.jobs.forEach(j => { if (j.needs) j.needs = j.needs.filter(n => n !== id); });

                window.renderGraphNodes();

                window.generateYamlPreview();

            };



            window.addJob = window.addPipelineStage;

            window.removeJob = window.removePipelineStage;





            window.toggleFullScreen = function () {

                // Use the visual view container

                const el = document.getElementById('view-visual') || document.getElementById('designer-viewport');

                if (!el) return;



                if (!document.fullscreenElement) {

                    el.requestFullscreen().catch(err => console.log('Fullscreen Error:', err));

                    window.graphState.isFullscreen = true;

                } else {

                    document.exitFullscreen();

                    window.graphState.isFullscreen = false;

                }

                setTimeout(() => window.renderGraphNodes(), 100); // Re-render to apply fullscreen class

            };



            window.zoom = function (amount) {

                const nextZoom = Math.min(Math.max(window.graphState.zoom + amount, 0.2), 3);

                const rect = document.getElementById('designer-viewport').getBoundingClientRect();

                if (!rect) return;

                const centerX = rect.width / 2;

                const centerY = rect.height / 2;

                const dx = (centerX - window.graphState.panX) * (1 - nextZoom / window.graphState.zoom);

                const dy = (centerY - window.graphState.panY) * (1 - nextZoom / window.graphState.zoom);

                window.graphState.panX += dx;

                window.graphState.panY += dy;

                window.graphState.zoom = nextZoom;

                window.applyCanvasTransform();

                window.updateConnections();

            };



            window.resetZoom = function () {

                window.graphState.panX = 0;

                window.graphState.panY = 0;

                window.graphState.zoom = 1;

                window.applyCanvasTransform();

                window.updateConnections();

            };



            window.startConnection = function (ev, sourceIndex) {

                ev.stopPropagation();

                window.graphState.connectingNodeIndex = sourceIndex;

            };



            window.updatePipelineJob = function (index, field, value) {

                if (window.draftPipeline.jobs[index]) {

                    if (typeof window.savePipelineSnapshot === 'function') window.savePipelineSnapshot();

                    window.draftPipeline.jobs[index][field] = value;

                    window.generateYamlPreview();

                }

            };



            window.initDesigner = function () {

                window.initDesignerCanvas();

                window.renderGraphNodes();

                window.applyCanvasTransform();

                window.addEventListener('mouseup', window.handleGlobalMouseUp);

                document.addEventListener('contextmenu', e => { if (e.target.closest('#designer-viewport')) e.preventDefault(); });

            };



            window.toggleNodeConfig = function (index) {

                const panel = document.getElementById('node-config-panel');

                const content = document.getElementById('config-panel-content');

                if (!panel || !content) return;



                if (index === null) {

                    panel.classList.add('translate-x-full');

                    setTimeout(() => panel.classList.add('hidden'), 300);

                    return;

                }



                const job = window.draftPipeline.jobs[index];

                if (!job) return;



                document.getElementById('config-panel-title').innerText = job.name || 'Stage Config';

                document.getElementById('config-panel-icon').className = `w-10 h-10 rounded-xl bg-${job.color || 'indigo'}-50 text-${job.color || 'indigo'}-600 flex items-center justify-center border border-${job.color || 'indigo'}-100`;



                // Helper to render current job UI inside the panel

                content.innerHTML = `

                    <div class="space-y-6">

                        <div>

                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Stage Identity</label>

                            <div class="grid grid-cols-2 gap-3">

                                <div>

                                    <label class="block text-[9px] text-gray-500 mb-1">Display Name</label>

                                    <input type="text" value="${job.name}" onchange="window.updatePipelineJob(${index}, 'name', this.value); document.getElementById('config-panel-title').innerText=this.value" class="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500">

                                </div>

                                <div>

                                    <label class="block text-[9px] text-gray-500 mb-1">Internal ID</label>

                                    <div class="w-full bg-gray-100 border border-gray-200 rounded-lg px-3 py-2 text-[10px] text-gray-400 font-mono truncate">${job.id}</div>

                                </div>

                            </div>

                        </div>



                        <div class="pt-4 border-t border-gray-100">

                             <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Configuration</label>

                             <div class="bg-indigo-50/30 rounded-2xl p-4 border border-indigo-100/50">

                                 ${getJobUI(job, index)}

                             </div>

                        </div>



                        <div class="pt-4 border-t border-gray-100">

                            <label class="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">Manual Script Override</label>

                            <textarea onchange="window.updateJobConfig(${index}, 'script', this.value)" class="w-full h-32 bg-gray-900 text-green-400 font-mono text-[10px] p-4 rounded-xl resize-none outline-none border border-gray-800 focus:border-indigo-500" placeholder="# Enter manual script...">${job.script || ''}</textarea>

                        </div>

                    </div>

                    `;



                panel.classList.remove('hidden');

                setTimeout(() => panel.classList.remove('translate-x-full'), 10);

            };



            // Aliases for compatibility

            window.addJob = window.addPipelineStage;

            window.removeJob = window.removePipelineStage;



            window.generateYamlPreview = function () {

                const pipeline = window.draftPipeline;

                if (!pipeline || !pipeline.jobs) return;



                let yaml = `# DEVYNTRA WORKFLOW GENERATED PREVIEW\n`;

                yaml += `# Policy Mode: ${Object.values(pipeline.constraints).some(v => v) ? 'RELAXED (Unsafe)' : 'LOCKED (Safe)'} \n\n`;

                yaml += `name: ${pipeline.name} \non: \n  ${pipeline.trigger}: { } \n\n`;

                yaml += `policy_constraints: \n`;

                Object.entries(pipeline.constraints).forEach(([k, v]) => {

                    yaml += `  ${k}: ${v} \n`;

                });



                yaml += `\njobs: \n`;

                pipeline.jobs.forEach((job, i) => {

                    const jobKey = job.name.toLowerCase().replace(/\s+/g, '_') || `job_${i + 1}`;

                    yaml += `  ${jobKey}:\n`;

                    if (job.needs && job.needs.length > 0) {

                        yaml += `    needs: [${job.needs.map(id => {

                            const neededJob = pipeline.jobs.find(j => j.id === id);

                            return neededJob ? neededJob.name.toLowerCase().replace(/\s+/g, '_') : '';

                        }).filter(Boolean).join(', ')

                            }]\n`;

                    }

                    yaml += `    runs-on: ${pipeline.executionEnv === 'remote' ? 'remote-server' : (pipeline.executionEnv === 'sandbox' ? 'sandbox-container' : 'self-hosted')}\n`;

                    yaml += `    steps:\n`;



                    // Generate preview script from config if raw script is empty

                    let runScript = job.script || '';

                    if (!runScript) {

                        const jn = job.name.toLowerCase();

                        if (jn.includes('source')) runScript = `git clone --branch ${job.branch || 'main'} ${job.repoUrl || '<repo-url>'}\n${job.runLint ? 'npm run lint' : ''}`;

                        else if (jn.includes('build')) runScript = `${job.packageManager || 'npm'} install\n${job.packageManager || 'npm'} run ${job.buildCommand || 'build'}\n${job.buildDocker ? `docker build -t ${job.imageName}:latest .` : ''}`;

                        else if (jn.includes('unit')) runScript = `${job.testFramework === 'pytest' ? 'pytest' : 'npm run test'}${job.codeCoverage ? ' --coverage' : ''}`;

                        else if (jn.includes('integration')) runScript = `${job.testEnv === 'docker-compose' ? 'docker-compose up -d' : ''}\nnpm run test:e2e`;

                        else if (jn.includes('release')) runScript = `docker push ${job.registry || 'docker.io'}/${job.imageName || 'app'}:${job.tagStrategy || 'latest'}`;

                        else if (job.customCommand) runScript = job.customCommand;

                    }



                    if (job.type === 'local' || !job.serverId) {

                        yaml += `      - name: Execute\n        run: |\n          ${runScript.trim().replace(/\n/g, '\n          ')}\n`;

                    } else {

                        yaml += `      - name: Deploy Artifacts\n        uses: devyntra/ssh-deploy\n        with:\n          server_id: ${job.serverId || 'undefined'}\n          target: ${job.path || '/tmp'}\n`;

                    }

                    yaml += `\n`;

                });



                // Update YAML Editor textarea (if visible/exists)

                const yamlEditor = document.getElementById('yaml-editor-input');

                if (yamlEditor && !yamlEditor.matches(':focus')) {

                    yamlEditor.value = yaml;

                }



                // Update HCL preview if needed

                window.syncHclPreview();

            };



            // Sync HCL/Terraform preview based on pipeline state

            window.syncHclPreview = function () {

                const pipeline = window.draftPipeline;

                if (!pipeline) return;



                const hclEditor = document.getElementById('hcl-editor-input');

                if (!hclEditor || hclEditor.matches(':focus')) return;



                // Generate basic HCL from pipeline jobs (for remote deployments)

                let hcl = `# Auto-generated Terraform configuration from Pipeline\n`;

                hcl += `# Pipeline: ${pipeline.name}\n\n`;



                const remoteJobs = pipeline.jobs.filter(j => j.type === 'remote');

                if (remoteJobs.length > 0) {

                    hcl += `# Remote Deployment Resources\n`;

                    remoteJobs.forEach((job, i) => {

                        hcl += `resource "null_resource" "${job.name.toLowerCase().replace(/\s+/g, '_')}" {\n`;

                        hcl += `  provisioner "remote-exec" {\n`;

                        hcl += `    connection {\n`;

                        hcl += `      type = "ssh"\n`;

                        hcl += `      host = var.server_${i}_host\n`;

                        hcl += `    }\n`;

                        hcl += `    inline = ["cd ${job.path || '/tmp'} && echo 'Deployed'"]\n`;

                        hcl += `  }\n`;

                        hcl += `}\n\n`;

                    });

                } else {

                    hcl += `# No remote deployment jobs configured yet.\n`;

                    hcl += `# Add remote jobs in the Designer to generate Terraform resources.\n`;

                }



                hclEditor.value = hcl;

            };



            // Master sync function - call this whenever pipeline state changes

            window.syncAllViews = function () {

                window.renderGraphNodes();  // Updates Designer view

                window.generateYamlPreview(); // Updates YAML Editor

                window.updateSafetyUI(); // Updates safety badge and feature tabs

                window.renderPipelineVariables(); // Update variables list

            };



            // --- Variables Logic ---

            window.renderPipelineVariables = function () {

                const list = document.getElementById('pipeline-variables-list');

                if (!list) return;



                if (!window.draftPipeline.variables) window.draftPipeline.variables = [];



                list.innerHTML = window.draftPipeline.variables.map((v, i) => `

                    <div class="flex gap-2 group">

                        <input type="text" value="${v.key}" onchange="window.updatePipelineVariable(${i}, 'key', this.value)" placeholder="KEY" class="w-1/3 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs font-mono outline-none focus:border-indigo-500 uppercase">

                        <input type="text" value="${v.value}" onchange="window.updatePipelineVariable(${i}, 'value', this.value)" placeholder="Value" class="flex-1 bg-white border border-gray-200 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-500">

                        <button onclick="window.removePipelineVariable(${i})" class="px-3 py-2 bg-gray-50 text-gray-400 hover:text-red-500 rounded-lg text-xs hover:bg-red-50 transition-colors"><i class="fas fa-trash-alt"></i></button>

                    </div>

                `).join('');



                if (window.draftPipeline.variables.length === 0) {

                    list.innerHTML = '<div class="text-center py-4 text-xs text-gray-400 italic">No variables defined.</div>';

                }

            };



            window.addPipelineVariable = function () {

                if (!window.draftPipeline.variables) window.draftPipeline.variables = [];

                window.draftPipeline.variables.push({ key: '', value: '' });

                window.renderPipelineVariables();

            };



            window.removePipelineVariable = function (index) {

                window.draftPipeline.variables.splice(index, 1);

                window.renderPipelineVariables();

            };



            window.updatePipelineVariable = function (index, field, value) {

                if (window.draftPipeline.variables[index]) {

                    window.draftPipeline.variables[index][field] = value;

                }

            };





            window.closePipelineBuilder = function () {

                const mainC = document.getElementById('cicd-main-container');

                const buildC = document.getElementById('cicd-builder-container');



                // Ensure Component Library is hidden

                const lib = document.getElementById('component-library');

                if (lib) lib.classList.remove('open');



                if (mainC && buildC) {

                    mainC.classList.remove('hidden');

                    buildC.classList.add('hidden');

                }

            };







            // YAML Validation Helper

            window.validateYaml = function () {

                const input = document.getElementById('yaml-editor-input');

                const result = document.getElementById('yaml-validation-result');

                if (!input || !result) return;



                const yaml = input.value.trim();

                result.classList.remove('hidden');



                if (!yaml) {

                    result.innerHTML = '<span class="text-yellow-500"><i class="fas fa-exclamation-triangle mr-2"></i>Empty YAML - nothing to validate</span>';

                    return;

                }



                // Basic YAML structure validation and parse to Designer

                // Basic YAML structure validation and parse to Designer

                try {

                    // Always attempt to parse, even if "required" fields like name/jobs are missing

                    window.parseYamlToDesigner(yaml);



                    if (yaml.includes('jobs:')) {

                        result.innerHTML = '<span class="text-green-500"><i class="fas fa-check-circle mr-2"></i>YAML Synced to Designer</span>';

                    } else {

                        result.innerHTML = '<span class="text-blue-400"><i class="fas fa-info-circle mr-2"></i>YAML Synced (No jobs defined)</span>';

                    }

                } catch (e) {

                    result.innerHTML = '<span class="text-red-500"><i class="fas fa-times-circle mr-2"></i>Parse Error: ' + e.message + '</span>';

                }

            };



            // Parse YAML and update Designer (two-way sync)

            window.parseYamlToDesigner = function (yamlText) {

                try {

                    // Extract pipeline name

                    const nameMatch = yamlText.match(/^name:\s*(.+)$/m);

                    if (nameMatch) {

                        window.draftPipeline.name = nameMatch[1].trim();

                    }



                    // Extract trigger

                    const triggerMatch = yamlText.match(/^on:\s*\n\s+(\w+):/m);

                    if (triggerMatch) {

                        window.draftPipeline.trigger = triggerMatch[1] === 'push' ? 'git' : 'manual';

                    }



                    // Extract jobs

                    const jobsSectionMatch = yamlText.split(/^jobs:\s*$/m)[1];

                    if (jobsSectionMatch) {

                        // Split by indentation to separate jobs (basic heuristic)

                        // Heuristic: Job keys start with 2 spaces

                        const jobBlocks = jobsSectionMatch.split('\n').reduce((acc, line) => {

                            if (line.match(/^\s{2}[\w-]+:/)) {

                                acc.push([line]);

                            } else if (acc.length > 0) {

                                acc[acc.length - 1].push(line);

                            }

                            return acc;

                        }, []);



                        const newJobs = [];

                        const nameToIdMap = {};



                        // First pass: Create Job Nodes

                        jobBlocks.forEach(block => {

                            const blockText = block.join('\n');

                            const keyMatch = blockText.match(/^\s{2}([\w-]+):/);

                            if (!keyMatch) return;



                            const jobKey = keyMatch[1];

                            const isRemote = blockText.includes('remote-server') || blockText.includes('ssh-deploy');

                            const scriptMatch = blockText.match(/run:\s*\|?\s*([\s\S]*?)(?=\n\s{2,}\w+:|\n\s*$)/) || blockText.match(/run:\s*(.+)/);

                            const pathMatch = blockText.match(/target:\s*(.+)/);



                            // Parse needs (Inline array or Multiline list)

                            let needsRaw = [];

                            const needsArrayMatch = blockText.match(/needs:\s*\[(.*?)\]/);

                            const needsSimpleMatch = blockText.match(/needs:\s*([a-zA-Z_][\w-]*)\s*$/m);

                            const needsMultilineMatch = blockText.match(/needs:\s*\n((?:\s+-\s*[\w-]+\s*\n?)+)/);



                            if (needsArrayMatch) {

                                // Array format: needs: [job1, job2]

                                needsRaw = needsArrayMatch[1].split(',').map(s => s.trim());

                            } else if (needsMultilineMatch) {

                                // Multiline format: needs:\n  - job1\n  - job2

                                needsRaw = needsMultilineMatch[1].split('\n').map(l => l.replace(/^\s*-\s*/, '').trim()).filter(Boolean);

                            } else if (needsSimpleMatch) {

                                // Simple format: needs: job_name

                                needsRaw.push(needsSimpleMatch[1].trim());

                            } else if (i > 0) {

                                // Default: Connect to previous job if no needs specified

                                needsRaw.push(jobIndices[i - 1].key);

                            }



                            const isRemoteAlt = blockText.includes('server_id:') || blockText.includes('ssh-deploy') || blockText.includes('appleboy/ssh-action');
                            const newId = 'job_' + Date.now() + Math.floor(Math.random() * 10000) + i;
                            nameToIdMap[jobKey] = newId;

                            newJobs.push({
                                id: newId,
                                _key: jobKey,
                                _needsRaw: needsRaw,
                                name: jobKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
                                type: isRemoteAlt ? 'remote' : 'local',
                                script: scriptMatch ? (scriptMatch[1] || scriptMatch[0].replace('run: ', '')).trim() : '',
                                path: pathMatch ? pathMatch[1].trim() : '',
                                icon: isRemoteAlt ? 'fa-server' : 'fa-terminal',
                                color: isRemoteAlt ? 'green' : 'slate'
                            });

                        });



                        // Resolve Dependencies & Visuals

                        newJobs.forEach(job => {

                            job.needs = job._needsRaw.map(rawName => nameToIdMap[rawName]).filter(Boolean);

                            const ln = job.name.toLowerCase();

                            if (ln.includes('lint')) { job.icon = 'fa-search'; job.color = 'yellow'; }

                            else if (ln.includes('build')) { job.icon = 'fa-cube'; job.color = 'indigo'; }

                            else if (ln.includes('test')) { job.icon = 'fa-vial'; job.color = 'purple'; }

                            else if (ln.includes('docker')) { job.icon = 'fa-docker'; job.color = 'blue'; }

                            else if (ln.includes('deploy')) { job.icon = 'fa-rocket'; job.color = 'green'; }

                        });



                        // --- HORIZONTAL AUTO LAYOUT (Based on Dependency Rank) ---

                        const getRank = (job, visited = new Set()) => {

                            if (visited.has(job.id)) return 0; // Cycle

                            if (!job.needs || !job.needs.length) return 0;

                            visited.add(job.id);

                            return Math.max(...job.needs.map(nid => {

                                const parent = newJobs.find(j => j.id === nid);

                                return parent ? getRank(parent, new Set(visited)) : -1;

                            })) + 1;

                        };



                        // Group jobs by rank (column)

                        const layers = {};

                        newJobs.forEach(job => {

                            const rank = getRank(job);

                            if (!layers[rank]) layers[rank] = [];

                            layers[rank].push(job);

                        });



                        // Position nodes: X based on rank (column), Y based on position in column

                        const CARD_WIDTH = 320;

                        const CARD_HEIGHT = 450; // cards are ~420px + some margin

                        const H_GAP = 80; // horizontal gap between columns

                        const V_GAP = 50; // vertical gap between cards in same column



                        Object.keys(layers).sort((a, b) => a - b).forEach(rankStr => {

                            const rank = parseInt(rankStr);

                            const jobsInColumn = layers[rank];

                            const columnX = 100 + rank * (CARD_WIDTH + H_GAP);



                            // Center jobs vertically in their column

                            const totalHeight = jobsInColumn.length * CARD_HEIGHT + (jobsInColumn.length - 1) * V_GAP;

                            const startY = Math.max(50, 200 - totalHeight / 2);



                            jobsInColumn.forEach((job, idx) => {

                                job.x = columnX;

                                job.y = startY + idx * (CARD_HEIGHT + V_GAP);

                            });

                        });



                        if (newJobs.length > 0) {

                            // Check if state actually changed before saving

                            if (window.draftPipeline.jobs && JSON.stringify(window.draftPipeline.jobs.map(j => ({ id: j.id, needs: j.needs }))) !== JSON.stringify(newJobs.map(j => ({ id: j.id, needs: j.needs })))) {

                                window.savePipelineSnapshot();

                            } else if (!window.draftPipeline.jobs) {

                                window.savePipelineSnapshot();

                            }

                            window.draftPipeline.jobs = newJobs;

                        }

                    }



                    window.renderGraphNodes();

                    window.updateConnections();

                    window.updateSafetyUI();



                    const resEl = document.getElementById('yaml-validation-result');

                    if (resEl) resEl.innerHTML = '<span class="text-green-500"><i class="fas fa-check"></i> Synced</span>';

                } catch (e) {

                    console.error("Sync Error", e);

                    const resEl = document.getElementById('yaml-validation-result');

                    if (resEl) resEl.innerHTML = '<span class="text-red-500">' + e.message + '</span>';

                }

            };



            window.formatYaml = function () {

                const input = document.getElementById('yaml-editor-input');

                const result = document.getElementById('yaml-validation-result');



                if (!input) {

                    console.error('YAML editor not found');

                    return;

                }



                let yaml = input.value;



                // Format YAML

                // 1. Replace tabs with 2 spaces

                yaml = yaml.replace(/\t/g, '  ');



                // 2. Trim trailing whitespace from each line

                yaml = yaml.split('\n').map(line => line.trimEnd()).join('\n');



                // 3. Remove multiple consecutive blank lines

                yaml = yaml.replace(/\n{3,}/g, '\n\n');



                // 4. Ensure file ends with single newline

                yaml = yaml.trim() + '\n';



                input.value = yaml;



                // Show confirmation

                if (result) {

                    result.classList.remove('hidden');

                    result.innerHTML = '<span class="text-blue-500"><i class="fas fa-magic mr-2"></i>YAML formatted successfully!</span>';

                    setTimeout(() => result.classList.add('hidden'), 3000);

                }



                console.log('YAML formatted');

            };



            // Debounced auto-sync for YAML editor (syncs after 500ms pause)

            let yamlSyncTimeout = null;

            window.debouncedYamlSync = function () {

                if (yamlSyncTimeout) clearTimeout(yamlSyncTimeout);



                yamlSyncTimeout = setTimeout(() => {

                    const input = document.getElementById('yaml-editor-input');

                    if (!input) return;



                    const yaml = input.value.trim();

                    if (yaml && yaml.includes('name:') && yaml.includes('jobs:')) {

                        try {

                            window.parseYamlToDesigner(yaml);



                            // Show subtle sync indicator

                            const result = document.getElementById('yaml-validation-result');

                            if (result) {

                                result.classList.remove('hidden');

                                result.innerHTML = '<span class="text-green-500"><i class="fas fa-sync mr-2"></i>Auto-synced to Designer</span>';

                                setTimeout(() => result.classList.add('hidden'), 2000);

                            }

                        } catch (e) {

                            // Silent fail on auto-sync, user can click manual sync

                        }

                    }

                }, 500);

            };



            // Execution Environment Switching

            window.setExecutionEnv = function (env) {

                // Store in pipeline state

                window.draftPipeline.executionEnv = env;



                // Update button styles

                const envs = ['sandbox', 'remote'];

                envs.forEach(e => {

                    const btn = document.getElementById('env-' + e);

                    if (btn) {

                        if (e === env) {

                            btn.className = 'px-4 py-3 bg-indigo-600 text-white rounded-xl text-xs font-bold flex flex-col items-center gap-1 transition-all';

                        } else {

                            btn.className = 'px-4 py-3 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-bold flex flex-col items-center gap-1 hover:border-indigo-300 transition-all';

                        }

                    }

                });



                // Show/hide settings

                const sandboxSettings = document.getElementById('sandbox-settings');

                const remoteSettings = document.getElementById('remote-server-selection');



                if (env === 'sandbox') {

                    if (sandboxSettings) sandboxSettings.classList.remove('hidden');

                    if (remoteSettings) remoteSettings.classList.add('hidden');

                } else if (env === 'remote') {

                    if (sandboxSettings) sandboxSettings.classList.add('hidden');

                    if (remoteSettings) {

                        remoteSettings.classList.remove('hidden');

                        // Populate servers if empty

                        const select = document.getElementById('execution-server-select');

                        if (select && select.options.length <= 1) {

                            window.userServers.forEach(s => {

                                const opt = document.createElement('option');

                                opt.value = s.id;

                                opt.innerText = `${s.name} (${s.host})`;

                                if (window.draftPipeline.executionServerId === s.id) opt.selected = true;

                                select.appendChild(opt);

                            });

                        }

                    }

                }

            };



            // SSH Command Execution

            window.executeSshCommand = async function () {

                const input = document.getElementById('ssh-command-input');

                const output = document.getElementById('ssh-terminal-output');

                if (!input || !output) return;



                const cmd = input.value.trim();

                if (!cmd) return;



                // Add command to output

                const cmdLine = document.createElement('div');

                cmdLine.className = 'text-cyan-400 mb-1';

                cmdLine.innerHTML = 'root@pipeline-runner:~$ <span class="text-white">' + cmd + '</span>';

                output.appendChild(cmdLine);



                // Try to execute via SSH if connected

                if (typeof ipcRenderer !== 'undefined') {

                    try {

                        const res = await ipcRenderer.invoke('ssh:execute', cmd);

                        const resultLine = document.createElement('div');

                        if (res.success) {

                            resultLine.className = 'text-gray-300 mb-2 whitespace-pre-wrap';

                            resultLine.textContent = res.data.stdout || '(no output)';

                        } else {

                            resultLine.className = 'text-red-400 mb-2';

                            resultLine.textContent = 'Error: ' + res.error;

                        }

                        output.appendChild(resultLine);

                    } catch (e) {

                        const errLine = document.createElement('div');

                        errLine.className = 'text-red-400 mb-2';

                        errLine.textContent = 'Execution failed: ' + e.message;

                        output.appendChild(errLine);

                    }

                } else {

                    const mockLine = document.createElement('div');

                    mockLine.className = 'text-gray-500 mb-2';

                    mockLine.textContent = '[Mock] Command queued for pipeline execution';

                    output.appendChild(mockLine);

                }



                // Add new prompt

                const newPrompt = document.createElement('div');

                newPrompt.className = 'text-cyan-400';

                newPrompt.innerHTML = 'root@pipeline-runner:~$ <span class="text-white animate-pulse">_</span>';

                output.appendChild(newPrompt);



                // Clear input and scroll

                input.value = '';

                output.scrollTop = output.scrollHeight;

            };



            const policyRisks = {

                allow_yaml_pipelines: "Enabling the YAML editor allows you to write pipeline definitions as raw code. This is recommended for advanced users."

            };



            window.requestPolicyChange = function (key, checkbox) {

                // If turning OFF, just do it

                if (!checkbox.checked) {

                    window.draftPipeline.constraints[key] = false;

                    window.updateSafetyUI();

                    return;

                }



                // If turning ON, show Risk Modal

                checkbox.checked = false; // Reset until confirmed

                const modal = document.getElementById('policy-risk-modal');

                const desc = document.getElementById('policy-risk-desc');

                const confirmBtn = document.getElementById('confirm-policy-btn');



                if (desc) desc.innerText = policyRisks[key];

                if (modal) modal.classList.remove('hidden');



                confirmBtn.onclick = () => {

                    window.draftPipeline.constraints[key] = true;

                    checkbox.checked = true;

                    if (modal) modal.classList.add('hidden');

                    window.updateSafetyUI();

                };

            };



            window.updateSafetyUI = function () {

                const constraints = window.draftPipeline.constraints;

                const isUnsafe = Object.values(constraints).some(v => v === true);

                const badge = document.getElementById('safety-status-badge');

                const warning = document.getElementById('unsafe-warning-banner');



                if (isUnsafe) {

                    if (badge) {

                        badge.innerHTML = `<i class="fas fa-exclamation-triangle mr-1"></i> Governed / Relaxed`;

                        badge.className = "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-red-100 text-red-700 border border-red-200";

                    }

                    if (warning) warning.classList.remove('hidden');

                } else {

                    if (badge) {

                        badge.innerHTML = `<i class="fas fa-shield-alt mr-1"></i> Locked Box`;

                        badge.className = "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-green-100 text-green-700 border border-green-200";

                    }

                    if (warning) warning.classList.add('hidden');

                }



                // Update feature tabs based on enabled policies

                window.updateFeatureTabs();

                window.generateYamlPreview();

            };



            window.switchBuilderView = function (viewId) {

                const views = ['visual', 'policy', 'yaml'];

                views.forEach(v => {

                    const el = document.getElementById(`view-${v}`);

                    const btn = document.getElementById(`btn-view-${v}`);

                    if (el) {

                        if (v === viewId) {

                            el.classList.remove('hidden');

                        } else {

                            el.classList.add('hidden');

                        }

                    }

                    if (btn) {

                        if (v === viewId) {

                            btn.className = "px-4 py-1.5 rounded-md text-xs font-bold bg-white text-indigo-600 shadow-sm transition-all";

                        } else {

                            btn.className = "px-4 py-1.5 rounded-md text-xs font-bold text-gray-500 hover:text-gray-900 transition-all";

                        }

                    }

                });



                if (viewId === 'visual') {

                    window.renderGraphNodes();

                } else if (viewId === 'yaml') {

                    window.generateYamlPreview();

                }

            };



            window.updateFeatureTabs = function () {

                const tabsContainer = document.getElementById('builder-tabs');

                if (!tabsContainer) return;



                const constraints = window.draftPipeline.constraints;



                // Base tab (Designer always visible first)

                let tabsHtml = `

                    <button onclick="window.switchBuilderView('visual')" id="btn-view-visual" class="px-4 py-1.5 rounded-md text-xs font-bold bg-white text-indigo-600 shadow-sm transition-all">Designer</button>

                `;



                // Conditionally add YAML Editor tab

                if (constraints.allow_yaml_pipelines) {

                    tabsHtml += `<button onclick="window.switchBuilderView('yaml')" id="btn-view-yaml" class="px-4 py-1.5 rounded-md text-xs font-bold text-gray-500 hover:text-gray-900 transition-all"><i class="fas fa-file-code mr-1 text-yellow-500"></i>YAML Editor</button>`;

                }



                // Settings tab always at the end

                tabsHtml += `<button onclick="window.switchBuilderView('policy')" id="btn-view-policy" class="px-4 py-1.5 rounded-md text-xs font-bold text-gray-500 hover:text-gray-900 transition-all"><i class="fas fa-cog mr-1"></i>Settings</button>`;



                tabsContainer.innerHTML = tabsHtml;

            };



            window.submitPipelineForm = function () {

                const e = { preventDefault: () => { } };

                window.handleCreatePipeline(e);

            };



            window.handleCreatePipeline = async function (e) {

                if (e && e.preventDefault) e.preventDefault();



                const pipelineData = window.draftPipeline;

                const isUnsafe = Object.values(pipelineData.constraints).some(v => v === true);



                // Construct pipeline object

                const pipeline = {

                    name: pipelineData.name,

                    trigger: pipelineData.trigger,

                    constraints: pipelineData.constraints,

                    governance_mode: isUnsafe ? 'relaxed' : 'locked',

                    jobs: pipelineData.jobs, // Save full job data

                    executionEnv: pipelineData.executionEnv || 'sandbox',

                    sandboxImage: pipelineData.sandboxImage,

                    executionServerId: pipelineData.executionServerId,

                    stages: pipelineData.jobs // For compatibility

                };



                // Final Check

                if (pipeline.executionEnv === 'remote' && !pipeline.executionServerId) {

                    // Check if an individual job has serverId? No, unified execution needs server.

                    // But maybe we should allow it if we only have individual deploy jobs?

                    // Let's stick to strict: if Remote Exec, need Server.

                    // But wait, user might have mixed local/remote jobs.

                    // The requirement is "Sandbox Execution in Remote Server".

                    // So we require executionServerId if env is remote.

                    if (!pipeline.executionServerId) {

                        alert("ValidationError: Remote Execution Environment selected but no Target Server specified.");

                        return;

                    }

                }



                try {

                    const nodes = (pipeline.jobs || []).map(j => ({

                        id: String(j.id),

                        position: { x: Number(j.x || 0), y: Number(j.y || 0) },

                        data: {

                            label: j.name,

                            type: 'script',

                            script: j.script || ''

                        }

                    }));

                    const edges = [];

                    (pipeline.jobs || []).forEach(j => {

                        (j.needs || []).forEach(dep => {

                            edges.push({ id: `${dep}-${j.id}`, source: String(dep), target: String(j.id) });

                        });

                    });



                    await apiFetch('/api/pipelines', {

                        method: 'POST',

                        body: JSON.stringify({

                            name: pipeline.name,

                            project_id: null,

                            definition: { nodes, edges },

                            created_by: currentUser && currentUser.email ? currentUser.email : null

                        })

                    });



                    window.closePipelineBuilder();

                    loadPipelines();

                } catch (err) {

                    alert('EngineError: Could not commit pipeline state: ' + (err.message || err));

                }

            };



            async function deletePipeline(id) {

                if (!confirm('Delete this pipeline?')) return;

                try {

                    await apiFetch(`/api/pipelines/${encodeURIComponent(id)}`, { method: 'DELETE' });

                    loadPipelines();

                } catch (e) {

                    alert('Failed to delete pipeline: ' + e.message);

                }

            }



            async function runPipeline(id) {

                if (!confirm("Start pipeline execution?")) return;



                const pipeline = pipelines.find(p => p.id === id);

                if (!pipeline) return;



                try {

                    const started = await apiFetch(`/api/pipelines/${encodeURIComponent(id)}/runs`, {

                        method: 'POST',

                        body: JSON.stringify({ trigger: 'manual', created_by: currentUser && currentUser.email ? currentUser.email : null })

                    });



                    const definition = pipeline.definition;

                    if (window.DevyntraPipelineOpenRun && definition) {

                        window.DevyntraPipelineOpenRun({ runId: started.runId, pipelineId: id, definition });

                    }

                } catch (e) {

                    alert('Failed to start run: ' + e.message);

                }

            }



            // Real-time Logs Listener

            ipcRenderer.on('cicd:log', (event, { text, type }) => {

                const container = document.getElementById('pipeline-log-content');

                if (!container || document.getElementById('pipeline-logs-modal').classList.contains('hidden')) return;



                const colorClass = type === 'error' ? 'text-red-400' : (type === 'success' ? 'text-green-400' : 'text-gray-300');

                const div = document.createElement('div');

                div.className = `${colorClass} py-0.5 border-b border-gray-900/50`;

                div.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;

                container.appendChild(div);

                container.scrollTop = container.scrollHeight;



                if (text.includes("Pipeline Failed")) document.getElementById('log-status-icon').className = "w-3 h-3 rounded-full bg-red-500";

                if (text.includes("Pipeline Completed Successfully")) {

                    document.getElementById('log-status-icon').className = "w-3 h-3 rounded-full bg-green-500";

                    loadPipelines(); // Update 'Last Run'

                }

            });



            function renderPipelinesList() {

                const container = document.getElementById('pipelines-list-container');

                if (!container) return;



                if (pipelines.length === 0) {

                    container.innerHTML = `

                    <div class="col-span-full py-16 text-center bg-white border border-dashed border-gray-300 rounded-2xl">

                        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">

                            <i class="fas fa-code-branch text-2xl"></i>

                        </div>

                        <h3 class="text-gray-900 font-bold mb-1">No Pipelines Yet</h3>

                        <p class="text-gray-500 text-sm mb-6">Create your first pipeline to automate deployments.</p>

                        <button onclick="openCreatePipelineView()" class="text-indigo-600 font-bold hover:underline">Get Started</button>

                    </div>`;

                    return;

                }



                container.innerHTML = pipelines.map(p => {
                    let serverName = 'Global Engine';
                    if (Array.isArray(p.stages) && p.stages.length > 0) {
                        const stage = p.stages.find(s => s && s.serverId);
                        if (stage) {
                            const server = userServers.find(s => s.id === stage.serverId);
                            if (server) {
                                serverName = server.name || server.host || serverName;
                            }
                        }
                    }

                    const lastRunDate = p.lastRun ? new Date(p.lastRun).toLocaleDateString() : 'Never';

                    return `
                    <div class="bg-white/90 backdrop-blur-md border border-slate-200 rounded-[24px] p-6 hover:shadow-xl transition-all group relative overflow-hidden flex flex-col h-full ring-0 hover:ring-2 hover:ring-indigo-500/20">
                         <div class="flex justify-between items-start mb-6">
                             <div class="flex items-center gap-4">
                                 <div class="w-12 h-12 rounded-[18px] bg-gradient-to-br from-indigo-50 to-violet-50 text-indigo-600 flex items-center justify-center text-xl shadow-sm border border-indigo-100 group-hover:scale-110 transition-transform">
                                     <i class="fas fa-rocket"></i>
                                 </div>
                                 <div class="min-w-0">
                                     <h3 class="font-black text-slate-900 truncate text-base" title="${p.name}">${p.name}</h3>
                                     <div class="flex items-center gap-2 mt-1">
                                         <span class="bg-slate-100 px-2 py-0.5 rounded-md text-[9px] font-black text-slate-500 uppercase tracking-widest border border-slate-200">${p.trigger}</span>
                                         <span class="text-[10px] text-slate-400 font-mono truncate max-w-[120px]" title="${serverName}"><i class="fas fa-server mr-1"></i>${serverName}</span>
                                     </div>
                                 </div>
                             </div>
                             <button onclick="deletePipeline('${p.id}')" class="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-rose-500 hover:bg-rose-50 transition-all opacity-0 group-hover:opacity-100"><i class="fas fa-trash-alt text-xs"></i></button>
                         </div>
                         
                         <!-- Workflow Preview -->
                         <div class="flex items-center gap-2 mb-8 bg-slate-50/50 p-3 rounded-2xl border border-slate-100">
                             <div class="flex flex-col gap-1">
                                <span class="text-[8px] font-black text-slate-400 uppercase tracking-[0.2em] leading-none mb-1">Stages</span>
                                <div class="flex items-center gap-2">
                                     <div class="flex items-center gap-1.5 text-[10px] font-bold text-slate-600"><i class="fas fa-code text-indigo-400"></i> Build</div>
                                     <div class="w-2 h-[2px] bg-slate-200 rounded-full"></div>
                                     <div class="flex items-center gap-1.5 text-[10px] font-bold text-slate-600"><i class="fas fa-cloud-upload-alt text-emerald-400"></i> Deployment</div>
                                </div>
                             </div>
                         </div>

                         <div class="flex items-center justify-between mt-auto pt-5 border-t border-slate-50">
                             <div class="flex flex-col">
                                 <span class="text-[8px] font-black text-slate-400 uppercase tracking-widest leading-none mb-1">Last Execution</span>
                                 <span class="text-[11px] font-bold text-slate-500">${lastRunDate}</span>
                             </div>
                             <button onclick="runPipeline('${p.id}')" class="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2 rounded-xl text-[11px] font-black shadow-lg shadow-indigo-100 transition-all flex items-center hover:scale-105 active:scale-95 group/btn">
                                 <i class="fas fa-play mr-2 text-[10px] transition-transform group-hover/btn:translate-x-0.5"></i> Launch
                             </button>
                         </div>
                    </div>
                `;
                }).join('');

            }



            // --- 5. APPS LOGIC ---

            async function loadAppsList() {

                if (!isConnected) return;

                const container = document.getElementById('app-list-container');

                if (!container) return; // Not in view



                container.innerHTML = getSkeletonHtml('card-grid');



                try {

                    // Get raw list first - currently using pm2

                    // We can reuse listApps() logic or call it directly.

                    // Ideally we have a 'loadApps()' function. Let's create/use one 

                    // It seems existing code might have had 'loadApps()', let's define it here properly as loadAppsList()

                    const res = await ipcRenderer.invoke('ssh:list-apps');

                    if (res.success) {

                        renderAppsList(res.apps);

                    } else {

                        container.innerHTML = `<div class="p-10 text-center text-red-500 bg-red-50 rounded-xl border border-red-100">

                        <i class="fas fa-exclamation-triangle text-2xl mb-3"></i>

                        <p class="font-bold">Failed to load apps</p>

                        <p class="text-xs mt-1">${res.error}</p>

                     </div>`;

                    }

                } catch (e) {

                    container.innerHTML = `<div class="p-10 text-center text-red-500">System Error: ${e.message}</div>`;

                }

            }



            function renderAppsList(apps) {

                const container = document.getElementById('app-list-container');

                if (!container) return;



                if (!apps || apps.length === 0) {

                    container.innerHTML = `

                    <div class="p-12 text-center border-dashed border-2 border-gray-200 rounded-xl">

                        <div class="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4 text-gray-400">

                             <i class="fas fa-cubes text-2xl"></i>

                        </div>

                        <h3 class="text-gray-900 font-bold mb-1">No Active Applications</h3>

                        <p class="text-gray-500 text-sm mb-6">Deploy your first app to see it here.</p>

                        <button onclick="navigate('deploy')" class="px-5 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-indigo-700">Deploy New App</button>

                    </div>`;

                    return;

                }



                // App data structure: { id, name, port, manager, path, status, deployedAt, autostart, language }

                container.innerHTML = apps.map(app => {

                    const isOnline = app.status === 'running';

                    const managerIcon = app.manager === 'pm2' ? 'fas fa-rocket' : 'fas fa-cog';

                    const managerLabel = app.manager === 'pm2' ? 'PM2' : 'Systemd';

                    const deployedDate = app.deployedAt ? new Date(app.deployedAt).toLocaleDateString() : 'N/A';

                    const isAutostart = app.autostart === true;

                    const host = connectedServerData ? connectedServerData.host : 'localhost';

                    const appUrl = `http://${host}:${app.port}`;



                    // Language Icon Logic

                    let langIcon = 'fas fa-cube';

                    let iconColor = isOnline ? 'text-green-600' : 'text-gray-400';

                    let iconBg = isOnline ? 'bg-green-50' : 'bg-gray-50';



                    const lang = (app.language || '').toLowerCase();

                    if (lang === 'nodejs') {

                        langIcon = 'fab fa-node-js';

                        if (isOnline) { iconColor = 'text-green-600'; iconBg = 'bg-green-50'; }

                    } else if (lang === 'python') {

                        langIcon = 'fab fa-python';

                        if (isOnline) { iconColor = 'text-blue-600'; iconBg = 'bg-blue-50'; }

                    } else if (lang === 'static' || lang === 'html') {

                        langIcon = 'fas fa-code';

                        if (isOnline) { iconColor = 'text-indigo-600'; iconBg = 'bg-indigo-50'; }

                    } else if (lang === 'php') {

                        langIcon = 'fab fa-php';

                        if (isOnline) { iconColor = 'text-purple-600'; iconBg = 'bg-purple-50'; }

                    }



                    return `

                    <div class="bg-white border border-gray-200 rounded-2xl p-6 hover:shadow-xl transition-all group flex flex-col relative overflow-hidden">

                        <!-- Status Glow -->

                        <div class="absolute -top-12 -right-12 w-24 h-24 blur-3xl rounded-full ${isOnline ? 'bg-green-500/10' : 'bg-gray-500/10'}"></div>

                        

                        <div class="flex items-start justify-between mb-6">

                            <div class="w-12 h-12 rounded-xl flex items-center justify-center ${iconBg} ${iconColor} shadow-sm group-hover:scale-110 transition-transform">

                                <i class="${langIcon} text-xl"></i>

                            </div>

                            <div class="flex flex-col items-end">

                                <span class="px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-widest ${isOnline ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">

                                    ${app.status}

                                </span>

                                <span class="text-[10px] text-gray-400 mt-1 font-medium"><i class="${managerIcon} mr-1"></i>${managerLabel}</span>

                            </div>

                        </div>



                        <div class="mb-4">

                            <h3 class="text-lg font-bold text-gray-900 group-hover:text-indigo-600 transition-colors truncate" title="${app.name}">${app.name}</h3>

                            <div class="flex items-center gap-2 mt-1">

                                <span class="text-xs text-indigo-600 font-bold bg-indigo-50 px-2 py-0.5 rounded">Port ${app.port || 'Auto'}</span>

                                <span class="text-[11px] text-gray-400 font-medium">Deployed ${deployedDate}</span>

                            </div>

                        </div>



                        <!-- App Link (External) -->

                        <div class="mb-5">

                            <a href="#" onclick="openExternalUrl('${appUrl}'); return false;" class="inline-flex items-center text-[10px] font-bold text-indigo-600 hover:text-indigo-800 transition-colors bg-indigo-50/50 hover:bg-indigo-100 px-2 py-1.5 rounded-lg border border-indigo-100/50">

                                <i class="fas fa-external-link-alt mr-2"></i>Open Application

                            </a>

                        </div>



                        <!-- Reboot Settings -->

                        <div class="px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-100 flex items-center justify-between mb-6">

                            <div class="flex items-center gap-2">

                                <i class="fas fa-power-off text-[10px] text-gray-400"></i>

                                <span class="text-[10px] font-bold text-gray-500 uppercase tracking-tight">Auto-start</span>

                            </div>

                            <label class="relative inline-flex items-center cursor-pointer">

                                <input type="checkbox" ${isAutostart ? 'checked' : ''} class="sr-only peer" onchange="toggleAutostart('${app.name}', this.checked)">

                                <div class="w-7 h-4 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-green-500"></div>

                            </label>

                        </div>



                        <div class="mt-auto pt-4 border-t border-gray-100 grid grid-cols-2 gap-3">

                            <button onclick="controlApp('${app.name}', 'restart')" class="flex items-center justify-center p-2.5 bg-white hover:bg-indigo-50 text-gray-600 hover:text-indigo-600 rounded-xl border border-gray-200 hover:border-indigo-100 transition-all font-bold text-xs shadow-sm">

                                <i class="fas fa-sync-alt mr-2"></i>Restart

                            </button>

                            

                            ${isOnline ? `

                            <button onclick="controlApp('${app.name}', 'stop')" class="flex items-center justify-center p-2.5 bg-white hover:bg-red-50 text-gray-600 hover:text-red-600 rounded-xl border border-gray-200 hover:border-red-100 transition-all font-bold text-xs shadow-sm">

                                <i class="fas fa-stop mr-2"></i>Stop

                            </button>

                            ` : `

                            <button onclick="controlApp('${app.name}', 'start')" class="flex items-center justify-center p-2.5 bg-white hover:bg-green-50 text-gray-600 hover:text-green-600 rounded-xl border border-gray-200 hover:border-green-100 transition-all font-bold text-xs shadow-sm">

                                <i class="fas fa-play mr-2"></i>Start

                            </button>

                            `}



                            <button onclick="deleteApp('${app.name}')" class="col-span-2 flex items-center justify-center p-2.5 bg-gray-900 hover:bg-red-600 text-white rounded-xl transition-all font-bold text-xs shadow-lg shadow-gray-200 hover:shadow-red-200">

                                <i class="fas fa-trash-alt mr-2"></i>Delete Application

                            </button>

                        </div>

                    </div>`;

                }).join('');

            }



            async function controlApp(name, action) {

                if (!confirm(`Are you sure you want to ${action} ${name}?`)) return;



                // Optimistic UI update could go here

                try {

                    const res = await ipcRenderer.invoke('ssh:manage-app', { id: name, action });

                    if (res.success) {

                        loadAppsList(); // Reload list

                    } else {

                        alert(`Failed to ${action} app: ${res.error}`);

                    }

                } catch (e) {

                    alert(`Error: ${e.message}`);

                }

            }



            async function deleteApp(name) {

                if (!confirm(`CRITICAL: Are you sure you want to delete ${name}? This will stop the app and remove its configuration.`)) return;



                try {

                    const res = await ipcRenderer.invoke('ssh:manage-app', { id: name, action: 'delete' });

                    if (res.success) {

                        loadAppsList(); // Reload list

                    } else {

                        alert(`Failed to delete app: ${res.error}`);

                    }

                } catch (e) {

                    alert(`Error: ${e.message}`);

                }

            }



            async function toggleAutostart(name, enable) {

                const action = enable ? 'enable-boot' : 'disable-boot';

                try {

                    const res = await ipcRenderer.invoke('ssh:manage-app', { id: name, action });

                    if (res.success) {

                        loadAppsList(); // Refresh to confirm state

                    } else {

                        alert(`Failed to update autostart: ${res.error}`);

                        loadAppsList(); // Reset UI

                    }

                } catch (e) {

                    alert(`Error: ${e.message}`);

                    loadAppsList();

                }

            }



            function openExternalUrl(url) {

                shell.openExternal(url);

            }



            // --- 6. SECURITY LOGIC ---

            function loadSecurity() {

                // Placeholder for security dashboard logic

                // Will update stats real-time

            }



            // --- 7. TASKS LOGIC ---

            function loadTasks() {

                // Placeholder for tasks logic

            }



            // --- DASHBOARD POLLING ---

            // Load saved polling interval from localStorage
            function loadDashboardPollingInterval() {
                try {
                    const saved = localStorage.getItem(POLLING_INTERVAL_KEY);
                    if (saved) {
                        const interval = parseInt(saved);
                        if (!isNaN(interval) && interval > 0) {
                            dashboardPollingInterval = interval;
                            console.log('[dashboard] Loaded polling interval from localStorage:', dashboardPollingInterval);
                            return true;
                        }
                    }
                } catch (error) {
                    console.error('[dashboard] Failed to load polling interval:', error);
                }
                return false;
            }

            // Check for polling interval changes periodically
            function checkPollingIntervalChange() {
                const saved = localStorage.getItem(POLLING_INTERVAL_KEY);
                if (saved) {
                    const interval = parseInt(saved);
                    if (!isNaN(interval) && interval > 0 && interval !== dashboardPollingInterval) {
                        console.log('[dashboard] ✓✓✓ Detected interval change in localStorage:', interval);
                        dashboardPollingInterval = interval;

                        // Restart dashboard polling
                        if (dashboardInterval) {
                            console.log('[dashboard] ✓ Restarting dashboard polling');
                            stopDashboardStats();
                            startDashboardStats();
                        }

                        // Restart top bar stats polling
                        if (statsInterval) {
                            console.log('[dashboard] ✓ Restarting top bar stats polling');
                            clearInterval(statsInterval);
                            statsInterval = setInterval(fetchStats, interval);
                        }
                    }
                }
            }

            // Check for changes every second
            setInterval(checkPollingIntervalChange, 1000);

            function startDashboardStats() {

                stopDashboardStats(); // Clean up any existing

                // Check if monitoring page is active - if so, don't start separate polling
                const monFrame = document.getElementById('monitoring-modern-frame');
                if (monFrame && monFrame.style.display !== 'none') {
                    console.log('[dashboard] Monitoring page is active - using its data feed');
                    return;
                }

                // Load saved interval
                loadDashboardPollingInterval();

                fetchDashboardStats(); // Immediate fetch

                dashboardInterval = setInterval(fetchDashboardStats, dashboardPollingInterval);

                console.log('[dashboard] Started with interval:', dashboardPollingInterval);

            }



            function stopDashboardStats() {

                if (dashboardInterval) {

                    clearInterval(dashboardInterval);

                    dashboardInterval = null;

                }

            }



            async function fetchDashboardStats() {

                if (!isConnected || !connectedServerData) return;



                // Combined Lite Command

                // 1. CPU Usage (via top, 2 iterations for delta)

                // 2. RAM (free -b)

                // 3. Disk (df -B1)

                // 4. Uptime

                // 5. OS Name

                // 6. Network Connections

                // 7. Process Count

                // 8. Kernel

                // 9. IP

                const cmd = [

                    "top -bn2 -d 0.5 | grep 'Cpu(s)' | tail -1 | awk '{print $2 + $4}'",

                    "free -b | grep Mem",

                    "df -B1 / | tail -1",

                    "uptime -p",

                    "cat /etc/os-release | grep PRETTY_NAME | cut -d= -f2 | tr -d '\"'",

                    "ss -tunH | wc -l",

                    "ps -e --no-headers | wc -l",

                    "uname -r",

                    "hostname -I | awk '{print $1}'"

                ].join(' && echo "___DELIM___" && ');



                try {

                    const raw = await monExec(cmd);

                    if (!raw) return;

                    const parts = raw.split('___DELIM___').map(s => s.trim());



                    if (parts.length < 9) return;



                    const stats = {};



                    // 1. CPU

                    stats.cpu = parseFloat(parts[0]) || 0;



                    // 2. RAM

                    const memParts = parts[1].split(/\s+/);

                    const memTotal = parseInt(memParts[1]) || 1;

                    const memUsed = parseInt(memParts[2]) || 0;

                    stats.ram = (memUsed / memTotal) * 100;



                    // 3. Disk

                    const diskParts = parts[2].split(/\s+/);

                    const diskTotal = parseInt(diskParts[1]) || 1;

                    const diskUsed = parseInt(diskParts[2]) || 0;

                    stats.disk = (diskUsed / diskTotal) * 100;



                    // 4. Uptime

                    stats.uptime = parts[3].replace('up ', '');



                    // 5. OS

                    stats.os = parts[4];



                    // 6. Net Conns

                    const netConns = parseInt(parts[5]) || 0;



                    // 7. Processes

                    const procCount = parseInt(parts[6]) || 0;



                    // 8. Kernel

                    stats.kernel = parts[7];



                    // 9. IP

                    stats.ip = parts[8];



                    // Create richer data object for dashboard details

                    const richData = {

                        memTotal: memTotal,

                        memUsed: memUsed,

                        diskUsed: diskUsed,

                        diskPct: stats.disk, // approximate

                        netConns: netConns,

                        processes: { length: procCount } // Mock array struct so existing UI works

                    };



                    // Hack: Inject into window.latestMonData so updateDashboardUI finds it?

                    // Better: Pass it to updateDashboardUI directly

                    // But updateDashboardUI expects 'stats' object for main cards, and 'window.latestMonData' for details.

                    // Let's Update updateDashboardUI to accept 'details' as second arg OR patch window.latestMonData

                    window.latestMonData = richData; // This ensures compatibility with existing render logic



                    // Call UI Update

                    updateDashboardUI(stats);



                } catch (e) {

                    console.warn("Dashboard stats fetch error:", e);

                }

            }



            // --- DASHBOARD LOGIC ---

            function loadDashboard() {

                // Check if user is connected

                if (!connectedServerData) {

                    const osEl = document.getElementById('dash-os');

                    if (osEl) osEl.innerText = 'Disconnect';

                    const upEl = document.getElementById('dash-uptime');

                    if (upEl) upEl.innerText = '--';

                    return;

                }



                // Start Polling Stats

                startDashboardStats();



                // Update static info

                const osEl = document.getElementById('dash-os');

                if (osEl) osEl.innerText = 'Linux (Ubuntu)'; // Will be updated by polling



                updateDashboardActivityLog();

            }



            function updateDashboardActivityLog() {

                const container = document.getElementById('dashboard-activity-log');

                if (!container) return;



                // Use globalActivityLog (real command logs)

                if (globalActivityLog && globalActivityLog.length > 0) {

                    // Filter for interesting commands

                    const interestingKeywords = ['deploy', 'install', 'delete', 'remove', 'systemctl', 'pm2', 'ssh connect', 'upload', 'zip', 'unzip', 'mv ', 'git ', 'npm', 'restart', 'start', 'stop'];

                    const filteredLogs = globalActivityLog.filter(log => {

                        const c = log.cmd.toLowerCase();

                        if (c.startsWith('ls ') || c === 'ls' || c === 'pwd' || c.startsWith('cat ') || c.startsWith('echo ')) return false;

                        return interestingKeywords.some(k => c.includes(k)) || log.cmd.length > 20;

                    });



                    if (filteredLogs.length === 0) {

                        container.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No recent important activity.</div>';

                        return;

                    }



                    container.innerHTML = filteredLogs.slice(0, 5).map(log => `

                    <div class="p-4 flex items-center hover:bg-gray-50 transition-colors">

                        <div class="w-8 h-8 rounded-full bg-${log.success ? 'green' : 'red'}-100 text-${log.success ? 'green' : 'red'}-600 flex items-center justify-center mr-4">

                            <i class="fas ${log.success ? 'fa-terminal' : 'fa-times'}"></i>

                        </div>

                        <div class="flex-1 overflow-hidden">

                            <div class="flex justify-between">

                                <p class="text-sm font-bold text-gray-900 truncate" title="${escapeHtml(log.cmd)}">${escapeHtml(log.cmd.substring(0, 50))}${log.cmd.length > 50 ? '...' : ''}</p>

                                <span class="text-xs text-gray-400 whitespace-nowrap ml-2">${log.time}</span>

                            </div>

                            <p class="text-xs text-gray-500 mt-0.5">${log.success ? 'Command executed' : 'Execution failed'}</p>

                        </div>

                    </div>

                `).join('');

                } else {

                    container.innerHTML = '<div class="p-4 text-center text-gray-400 text-sm">No recent activity.</div>';

                }

            }



            function navigate(viewName, params = null) {

                if (viewName === 'chat') {
                    if (typeof toggleDevAI === 'function') toggleDevAI();
                    return;
                }

                currentView = viewName; // Track view

                const sidebar = document.getElementById('app-sidebar');

                const header = document.getElementById('app-header');



                // GLOBAL VIEW: SERVERS LIST

                if (viewName === 'servers' || viewName === 'all-servers' || viewName === 'all-pipelines' || viewName === 'cicd') {
                    if (sidebar) {
                        sidebar.classList.add('hidden');
                        sidebar.classList.remove('md:flex');
                    }
                    if (header) header.classList.add('hidden');

                    if (viewName === 'cicd') {
                        loadPipelines();
                    }
                }
                // SERVER SPECIFIC VIEWS
                else {
                    if (sidebar) {
                        sidebar.classList.remove('hidden');
                        sidebar.classList.add('md:flex');
                    }
                    if (header) header.classList.remove('hidden');
                }



                // 1. Stop any running monitoring

                if (typeof stopMonitoring === 'function') stopMonitoring();

                if (viewName !== 'dashboard' && typeof stopDashboardStats === 'function') stopDashboardStats();

                // Stop old polling when entering monitoring page (will use monitoring page data feed)
                if (viewName === 'monitoring') {
                    console.log('[main] Entering monitoring page - stopping old polling mechanisms');
                    if (typeof stopMonitoring === 'function') stopMonitoring();
                    if (typeof stopDashboardStats === 'function') stopDashboardStats();
                }

                // Restart polling when leaving monitoring page
                if (viewName !== 'monitoring' && currentView === 'monitoring') {
                    console.log('[main] Leaving monitoring page - restarting old polling mechanisms');
                    if (viewName === 'dashboard' && typeof startDashboardStats === 'function') {
                        setTimeout(() => startDashboardStats(), 100);
                    }
                    if (isConnected && typeof startMonitoring === 'function') {
                        setTimeout(() => startMonitoring(), 100);
                    }
                }



                // 1. Update Sidebar UI

                document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active', 'bg-indigo-50', 'text-indigo-700', 'font-medium'));

                document.querySelectorAll('.nav-item').forEach(el => el.classList.add('text-gray-600'));



                const activeNav = document.getElementById(`nav-${viewName}`);

                if (activeNav) {

                    activeNav.classList.add('active');

                    activeNav.classList.remove('text-gray-600');

                }



                // 2. Render Content

                const container = document.getElementById('content-container');

                const scrollParent = document.getElementById('scroll-container') || container.parentElement;



                if (['files', 'terminal', 'cicd', 'monitoring'].includes(viewName)) {

                    scrollParent.classList.remove('overflow-y-auto');

                    scrollParent.classList.add('overflow-hidden');

                } else {

                    scrollParent.classList.add('overflow-y-auto');

                    scrollParent.classList.remove('overflow-hidden');

                }



                // 2. Render Content (with stretching support)

                if (viewName === 'cicd') {

                    container.className = 'w-full h-full min-h-[100vh] flex flex-col flex-1 fade-in p-0 max-w-none overflow-hidden';

                } else if (viewName === 'monitoring') {

                    container.className = 'w-full h-full min-h-[100vh] flex flex-col flex-1 fade-in p-0 m-0 max-w-none overflow-hidden';

                } else {

                    // Ultra-wide support for server management page

                    const maxWidth = viewName === 'servers' ? 'max-w-[1700px]' : 'max-w-7xl';

                    // Reduced pt to 6 to move content up slightly per user feedback

                    container.className = `px-6 md:px-10 pt-6 pb-10 ${maxWidth} mx-auto fade-in min-h-full flex flex-col flex-1 w-full`;

                    container.style.gap = '0'; // We use internal gaps now

                }



                // VIEW CACHING LOGIC

                // Hide all existing cached views

                Array.from(container.children).forEach(child => {

                    if (child.id && child.id.startsWith('view-cache-')) {

                        child.classList.add('hidden');

                    }

                });



                // Check if view already exists

                let viewWrapper = document.getElementById(`view-cache-${viewName}`);



                if (viewWrapper) {

                    // RESUME EXISTING VIEW

                    viewWrapper.classList.remove('hidden');



                    if (viewName === 'files' || viewName === 'terminal') {

                        viewWrapper.className = 'w-full h-full';

                    } else if (viewName === 'servers' || viewName === 'cicd') {

                        viewWrapper.className = 'w-full flex-1 flex flex-col h-full';

                        // REMOVED: viewWrapper.innerHTML = views[viewName]();
                        // Instead, just clear and re-mount if it's CICD, or let servers handle itself
                        if (viewName === 'cicd') {
                            viewWrapper.innerHTML = views[viewName]();
                            setTimeout(() => {
                                if (window.DevyntraPipelineMount) window.DevyntraPipelineMount();
                            }, 50);
                        } else {
                            viewWrapper.innerHTML = views[viewName]();
                        }

                    }



                    // Specific Resume Logic

                    if (viewName === 'monitoring') {

                        // Modern monitoring uses an iframe. Do NOT run the legacy monitoring engine.
                        setTimeout(() => { pushMonitoringConfigToIframe(); }, 150);

                    }

                    if (viewName === 'dashboard') startDashboardStats();

                    if (viewName === 'files' && params && params.path) {

                        loadFiles(params.path);

                    }

                } else {

                    // CREATE NEW VIEW

                    viewWrapper = document.createElement('div');

                    viewWrapper.id = `view-cache-${viewName}`;



                    // Apply space-y-8 HERE appropriately

                    if (viewName === 'files' || viewName === 'terminal') {

                        viewWrapper.className = 'w-full h-full';

                    } else if (viewName === 'servers' || viewName === 'cicd') {

                        viewWrapper.className = 'w-full flex-1 flex flex-col h-full';

                    } else {

                        viewWrapper.className = 'w-full space-y-8'; // Add spacing here for internal elements

                    }



                    if (views[viewName]) {

                        viewWrapper.innerHTML = views[viewName]();

                    } else {

                        viewWrapper.innerHTML = `<div class="p-10 text-center text-gray-500">View Not Found: ${viewName}</div>`;

                    }

                    container.appendChild(viewWrapper);



                    // INITIALIZATION LOGIC (Only run once on creation)

                    if (viewName === 'dashboard') loadDashboard();

                    if (viewName === 'monitoring') {
                        setTimeout(() => { pushMonitoringConfigToIframe(); }, 150);
                    }

                    if (viewName === 'terminal') {

                        // Some builds/pages may not include terminal init code; don't crash navigation.

                        if (typeof initTerminalView === 'function') {

                            initTerminalView();

                        } else {

                            console.warn('[terminal] initTerminalView is not defined; skipping terminal init.');

                        }

                    }

                    if (viewName === 'deploy') loadDeployView();

                    if (viewName === 'manage-apps' || viewName === 'apps') loadAppsList();

                    if (viewName === 'security') loadSecurity();

                    if (viewName === 'tasks') loadTasks();

                    if (viewName === 'history') updateHistoryLog();

                    if (viewName === 'files') {

                        if (params && params.path) {

                            loadFiles(params.path);

                        } else {

                            loadFiles(currentFilesPath);

                        }

                    }
                    if (viewName === 'global-apps') loadGlobalApps();

                    if (viewName === 'cicd') {
                        // Mount the React Pipeline App
                        setTimeout(() => {
                            if (window.DevyntraPipelineMount) {
                                window.DevyntraPipelineMount();
                            } else {
                                console.error('DevyntraPipelineMount not found. Pipeline app may not be loaded.');
                            }
                        }, 50);
                    }


                }



                // Mobile menu close

                document.getElementById('mobile-backdrop')?.classList.add('hidden');

                if (sidebar) sidebar.classList.add('-translate-x-full');

            }



            function getSkeletonHtml(type) {

                if (type === 'card-grid') {

                    return Array(6).fill(`

                        <div class="skeleton-card flex flex-col p-6 space-y-4">

                            <div class="flex justify-between items-start">

                                <div class="skeleton w-12 h-12 rounded-xl"></div>

                                <div class="skeleton w-16 h-4 rounded"></div>

                            </div>

                            <div class="skeleton w-3/4 h-6 rounded mt-2"></div>

                            <div class="skeleton w-1/2 h-4 rounded"></div>

                            <div class="mt-auto pt-4 flex gap-2">

                                <div class="skeleton flex-1 h-10 rounded-xl"></div>

                                <div class="skeleton flex-1 h-10 rounded-xl"></div>

                            </div>

                        </div>

                    `).join('');

                }

                if (type === 'table-rows') {

                    return Array(8).fill(`

                        <tr>

                            <td class="px-3 py-4"><div class="skeleton w-4 h-4 rounded mx-auto"></div></td>

                            <td class="px-4 py-4"><div class="skeleton w-6 h-6 rounded mx-auto"></div></td>

                            <td class="px-4 py-4"><div class="skeleton w-40 h-4 rounded"></div></td>

                            <td class="px-4 py-4"><div class="skeleton w-16 h-4 rounded"></div></td>

                            <td class="px-4 py-4"><div class="skeleton w-24 h-4 rounded"></div></td>

                        </tr>

                    `).join('');

                }

                if (type === 'list-items') {

                    return Array(5).fill(`

                        <div class="p-4 flex items-center justify-between">

                            <div class="flex items-center gap-3">

                                <div class="skeleton w-10 h-10 rounded-full"></div>

                                <div class="space-y-2">

                                    <div class="skeleton w-32 h-4 rounded"></div>

                                    <div class="skeleton w-20 h-3 rounded"></div>

                                </div>

                            </div>

                            <div class="skeleton w-20 h-8 rounded-lg"></div>

                        </div>

                    `).join('');

                }

                if (type === 'stats-value') {

                    return `<div class="skeleton w-16 h-8 rounded mt-1"></div>`;

                }

                return `<div class="skeleton h-32 w-full rounded-xl"></div>`;

            }



            // SIDEBAR TOGGLE LOGIC

            function openSidebar() {

                document.getElementById('app-sidebar').classList.remove('-translate-x-full');

                document.getElementById('mobile-backdrop').classList.remove('hidden');

            }



            function closeSidebar() {

                document.getElementById('app-sidebar').classList.add('-translate-x-full');

                document.getElementById('mobile-backdrop').classList.add('hidden');

            }



            // Initialize default view

            window.addEventListener('DOMContentLoaded', () => {
                navigate('servers');
                console.log('[main] ✓ App initialized - using localStorage polling for refresh rate sync');

                // Start background agent monitoring
                startBackgroundAgentMonitoring();
            });

            // Background agent monitoring - checks all saved agents and auto-reconnects
            let agentMonitoringInterval = null;

            async function startBackgroundAgentMonitoring() {
                // Check every 10 seconds
                agentMonitoringInterval = setInterval(async () => {
                    try {
                        // Only monitor if not currently connected
                        if (isConnected) return;

                        // Find all agent connections in saved servers
                        const agentServers = userServers.filter(s =>
                            String(s.host || '').startsWith('agent:')
                        );

                        if (agentServers.length === 0) return;

                        // Check each agent's status
                        for (const server of agentServers) {
                            const agentId = String(server.host).replace(/^agent:/, '').trim();

                            try {
                                const status = await ipcRenderer.invoke('agent:status', { agentId });

                                if (status?.success && status.online) {
                                    console.log(`[agent-monitor] Agent ${agentId} is online and ready`);

                                    // Update server card to show online status
                                    const cardEl = document.querySelector(`[data-server-id="${server.id}"]`);
                                    if (cardEl) {
                                        const statusDot = cardEl.querySelector('.status-indicator');
                                        if (statusDot) {
                                            statusDot.classList.remove('bg-gray-400', 'bg-red-500');
                                            statusDot.classList.add('bg-green-500');
                                        }
                                    }
                                } else {
                                    // Agent offline - update UI
                                    const cardEl = document.querySelector(`[data-server-id="${server.id}"]`);
                                    if (cardEl) {
                                        const statusDot = cardEl.querySelector('.status-indicator');
                                        if (statusDot) {
                                            statusDot.classList.remove('bg-green-500', 'bg-red-500');
                                            statusDot.classList.add('bg-gray-400');
                                        }
                                    }
                                }
                            } catch (e) {
                                console.warn(`[agent-monitor] Error checking agent ${agentId}:`, e);
                            }
                        }
                    } catch (e) {
                        console.warn('[agent-monitor] Monitoring error:', e);
                    }
                }, 10000); // Check every 10 seconds
            }

            // Stop monitoring when app closes
            window.addEventListener('beforeunload', () => {
                if (agentMonitoringInterval) {
                    clearInterval(agentMonitoringInterval);
                }
            });



            // --- 4. SERVER LIST LOGIC ---

            function openConnectionModal() {

                if (typeof hideLoader === 'function') hideLoader();

                editingServerId = null;

                document.getElementById('connection-modal').classList.remove('hidden');

                document.getElementById('ssh-form').reset();

                document.getElementById('server-name').value = ''; // Clear server name

                document.getElementById('host').focus();



                const cmdEl = document.getElementById('agent-install-cmd');

                if (cmdEl) cmdEl.textContent = '';

                agentInstallCommand = '';



                const emptyEl = document.getElementById('agent-command-empty');

                const boxEl = document.getElementById('agent-command-box');

                if (emptyEl) emptyEl.classList.remove('hidden');

                if (boxEl) boxEl.classList.add('hidden');



                agentEnrollData = null;

                setConnectionMode('agent');

                setAgentStatus('waiting', 'Click "Generate Command" to get your install command.');




                const genBtn = document.getElementById('agent-generate-btn');

                if (genBtn) {

                    genBtn.disabled = false;

                    genBtn.innerText = 'Generate Command';

                    genBtn.className = 'bg-indigo-600 text-white w-full px-6 py-4 rounded-2xl text-sm font-black shadow-lg shadow-indigo-100 hover:bg-indigo-700 active:scale-95 transition-all';

                }




                // Reset Button Text

                resetBtn();

            }



            function editServer(id) {

                if (typeof hideLoader === 'function') hideLoader();

                editingServerId = id; // Set edit mode

                const server = userServers.find(s => s.id === id);

                if (!server) return;



                document.getElementById('connection-modal').classList.remove('hidden');

                document.getElementById('server-name').value = server.name || ''; // Populate server name

                document.getElementById('host').value = server.host;

                document.getElementById('username').value = server.username;



                if (String(server.host || '').startsWith('agent:')) {

                    setConnectionMode('agent');

                } else {

                    setConnectionMode('ssh');

                }



                // Display appropriate key information

                if (server.private_key) {

                    document.getElementById('key-display').value = '?? Stored in Cloud (Encrypted)';

                    document.getElementById('key-display').disabled = true;

                    document.getElementById('save-key-pair').checked = true;

                } else {

                    document.getElementById('key-display').value = server.keyPath || '';

                    document.getElementById('key-display').disabled = false;

                    document.getElementById('save-key-pair').checked = server.keyStoredInCloud || false;

                }



                document.getElementById('password').value = '';

                document.getElementById('is-elastic-ip').checked = server.isElasticIP || false;



                // Change Button Text

                const btn = document.getElementById('connect-btn');

                btn.innerHTML = '<span>Save Changes</span><i class="fas fa-save ml-2"></i>';

            }



            // Filter Servers Function
            function filterServers(searchText) {
                const cards = document.querySelectorAll('.server-card');
                const search = searchText.toLowerCase().trim();

                cards.forEach(card => {
                    const searchData = card.getAttribute('data-search-text') || '';
                    if (search === '' || searchData.includes(search)) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            }

            // Filter Pipelines Function
            function filterPipelines(searchText) {
                const cards = document.querySelectorAll('.pipeline-card');
                const search = searchText.toLowerCase().trim();

                cards.forEach(card => {
                    const searchData = card.getAttribute('data-search-text') || '';
                    if (search === '' || searchData.includes(search)) {
                        card.style.display = '';
                    } else {
                        card.style.display = 'none';
                    }
                });
            }

            // Delete Server Function
            async function deleteServer(id) {
                if (typeof hideLoader === 'function') hideLoader();

                const server = userServers.find(s => s.id === id);
                if (!server) return;

                // Confirm deletion
                const confirmed = confirm(`Are you sure you want to delete "${server.name || server.host}"?\n\nThis action cannot be undone.`);
                if (!confirmed) return;

                // Find and animate out the card
                const cardElement = document.querySelector(`[data-server-id="${id}"]`);
                if (cardElement) {
                    cardElement.style.transition = 'all 0.3s ease-out';
                    cardElement.style.opacity = '0';
                    cardElement.style.transform = 'scale(0.8)';
                }

                try {
                    // Delete from Supabase
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                        const { error } = await supabase
                            .from('servers')
                            .delete()
                            .eq('id', id)
                            .eq('user_id', user.id);

                        if (error) throw error;
                    }

                    // Remove from local array
                    userServers = userServers.filter(s => s.id !== id);

                    // Remove card from DOM after animation
                    setTimeout(() => {
                        if (cardElement) {
                            cardElement.remove();
                        }
                        // If no servers left, refresh to show empty state
                        if (userServers.length === 0) {
                            loadDashboard();
                        }
                    }, 300);

                } catch (error) {
                    console.error('Error deleting server:', error);
                    // Restore card if deletion failed
                    if (cardElement) {
                        cardElement.style.opacity = '1';
                        cardElement.style.transform = 'scale(1)';
                    }
                    alert('Failed to delete server: ' + error.message);
                }
            }



            // Consolidating Connection Logic




            async function connectSavedServer(id) {

                const server = userServers.find(s => s.id === id);

                if (!server) return;



                showLoader("Connecting...", `Establishing secure connection to ${server.host}`);



                try {

                    if (String(server.host || '').startsWith('agent:')) {

                        const agentId = String(server.host).replace(/^agent:/, '').trim();

                        const result = await ipcRenderer.invoke('agent:connect', { agentId });

                        if (result.success) {

                            onConnectionSuccess({

                                host: server.host,

                                username: 'agent',

                                keyPath: '',

                                id: server.id,

                                serverName: server.name,

                                mode: server.mode || 'agent'

                            });

                        } else {

                            alert('Connection Failed: ' + result.error);

                        }

                        return;

                    }



                    let connectionConfig = {

                        host: server.host,

                        username: server.username

                    };



                    if (server.private_key) {

                        connectionConfig.privateKey = server.private_key;

                    } else if (server.keyPath) {

                        const resolvedKeyPath = await resolveKeyPath(server.keyPath);

                        connectionConfig.privateKeyPath = resolvedKeyPath;

                    }



                    const result = await ipcRenderer.invoke('ssh:connect', connectionConfig);



                    if (result.success) {

                        onConnectionSuccess({

                            host: server.host,

                            username: result.username || server.username,

                            keyPath: server.keyPath,

                            id: server.id,

                            serverName: server.name,

                            mode: server.mode || 'ssh'

                        });

                    } else {

                        alert('Connection Failed: ' + result.error);

                    }

                } catch (e) {

                    alert('System Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function connectToServer(e) {
                if (e) e.preventDefault();

                const btn = document.getElementById('connect-btn');
                const errDiv = document.getElementById('conn-error');
                const originalText = btn ? btn.innerHTML : '';

                if (connectionMode === 'agent' && !window.editingServerId) {
                    return;
                }

                // Fields
                const name = document.getElementById('server-name').value.trim() || (connectionMode === 'agent' ? "Devyntra Agent" : "SSH Server");
                const host = document.getElementById('host') ? document.getElementById('host').value.trim() : '';
                const username = document.getElementById('username') ? document.getElementById('username').value.trim() : '';
                const password = document.getElementById('password') ? document.getElementById('password').value : '';
                const keyPath = document.getElementById('key-display') ? document.getElementById('key-display').value : '';
                const isElastic = document.getElementById('is-elastic-ip') ? document.getElementById('is-elastic-ip').checked : false;
                const shouldSaveToCloud = document.getElementById('save-key-pair') ? document.getElementById('save-key-pair').checked : false;



                // --- HANDLE EDIT MODE ---
                if (window.editingServerId) {
                    const idx = userServers.findIndex(s => s.id === editingServerId);
                    if (idx !== -1) {
                        const updated = {
                            ...userServers[idx],
                            name,
                            host,
                            username,
                            keyPath,
                            isElasticIP: isElastic,
                            keyStoredInCloud: shouldSaveToCloud,
                            mode: connectionMode
                        };
                        if (!shouldSaveToCloud) updated.private_key = null;
                        userServers[idx] = updated;
                        saveServerToSupabase(updated);
                        closeConnectionModal();
                        showLoader("Saved", "Server configuration updated");
                        setTimeout(hideLoader, 1000);

                        if (typeof renderServers === 'function') renderServers();
                    }
                    return;
                }

                // --- HANDLE CONNECT MODE ---
                if (errDiv) { errDiv.classList.add('hidden'); errDiv.innerText = ''; }
                if (btn) {
                    btn.disabled = true;
                    btn.innerHTML = `<i class="fas fa-circle-notch fa-spin mr-2"></i> CONNECTING...`;
                }

                try {
                    let res;
                    if (connectionMode === 'agent') {
                        res = await ipcRenderer.invoke('agent:connect', { name });
                    } else {
                        if (!host || !username) throw new Error("Host and Username are required");
                        if (connectionMode === 'ssh' && !keyPath) throw new Error("Authentication key is required for SSH (Root)");

                        showLoader("Establishing Secure Link", `Authenticating as ${username}@${host}...`);
                        res = await ipcRenderer.invoke('ssh:connect', { host, username, password, privateKeyPath: keyPath });
                    }

                    if (res && res.success) {
                        await onConnectionSuccess({
                            host,
                            username,
                            keyPath: keyPath || '',
                            id: Date.now().toString(),
                            serverName: name,
                            shouldSaveToCloud,
                            isElastic,
                            mode: connectionMode
                        });

                        // Permissions
                        if (connectionMode === 'user' && typeof applyUserPermissions === 'function') {
                            applyUserPermissions(username);
                        } else if (typeof resetSidebarPermissions === 'function') {
                            resetSidebarPermissions();
                        }
                        return;
                    } else {
                        throw new Error(res?.error || "Connection failed");
                    }
                } catch (error) {
                    console.error("Connection Failed:", error);
                    if (errDiv) {
                        errDiv.innerText = error.message;
                        errDiv.classList.remove('hidden');
                    }
                } finally {
                    if (btn) {
                        btn.disabled = false;
                        btn.innerHTML = originalText;
                    }
                    hideLoader();
                }
            }

            function setConnectionMode(mode) {
                connectionMode = mode;

                // Button Styles
                ['agent', 'ssh', 'user'].forEach(m => {
                    const btn = document.getElementById(`mode-${m}-btn`);
                    if (btn) {
                        if (m === mode) {
                            btn.classList.remove('bg-transparent', 'text-slate-500');
                            btn.classList.add('bg-white', 'text-indigo-600', 'shadow-sm', 'border', 'border-slate-200/50');
                        } else {
                            btn.classList.add('bg-transparent', 'text-slate-500');
                            btn.classList.remove('bg-white', 'text-indigo-600', 'shadow-sm', 'border', 'border-slate-200/50');
                        }
                    }
                });

                // Content Visibility
                const agentMode = document.getElementById('agent-mode');
                const sshMode = document.getElementById('ssh-mode');
                const keyFieldContainer = document.getElementById('key-field-container');
                const sshCheckboxes = document.getElementById('ssh-checkboxes');
                const passwordFieldContainer = document.getElementById('password-field-container');
                const passwordLabel = document.getElementById('password-label');
                const authOptionalText = document.getElementById('auth-optional-text');
                const keyFile = document.getElementById('keyfile');

                if (mode === 'agent') {
                    agentMode.classList.remove('hidden');
                    sshMode.classList.add('hidden');
                    document.getElementById('server-name').placeholder = "e.g. Production Cluster";
                } else if (mode === 'user') {
                    agentMode.classList.add('hidden');
                    sshMode.classList.remove('hidden');
                    // User mode: Show key field (as per request), hide checkboxes
                    if (keyFieldContainer) keyFieldContainer.classList.remove('hidden');
                    if (sshCheckboxes) sshCheckboxes.classList.add('hidden');
                    if (passwordFieldContainer) passwordFieldContainer.classList.remove('hidden');
                    if (passwordLabel) passwordLabel.innerText = 'Password (Optional)';
                    if (authOptionalText) authOptionalText.classList.remove('hidden');
                    if (keyFile) keyFile.required = false;
                    document.getElementById('server-name').placeholder = "e.g. Personal Server";
                    document.getElementById('host').placeholder = "192.168.1.100";
                    document.getElementById('username').placeholder = "ubuntu";
                    document.getElementById('username').value = "";
                } else {
                    // SSH Root mode
                    agentMode.classList.add('hidden');
                    sshMode.classList.remove('hidden');
                    // SSH mode: show key field, show checkboxes
                    if (keyFieldContainer) keyFieldContainer.classList.remove('hidden');
                    if (sshCheckboxes) sshCheckboxes.classList.remove('hidden');
                    if (passwordFieldContainer) passwordFieldContainer.classList.add('hidden');
                    if (passwordLabel) passwordLabel.innerText = 'Password';
                    if (authOptionalText) authOptionalText.classList.add('hidden');
                    if (keyFile) keyFile.required = true;
                    document.getElementById('server-name').placeholder = "e.g. Root Controller";
                    document.getElementById('username').value = "root";
                }
            }



            async function connectSavedServer(id) {

                const server = userServers.find(s => s.id === id);

                if (!server) return;



                // USE GLOBAL LOADER

                showLoader("Connecting...", `Establishing secure connection to ${server.host}`);



                try {

                    if (String(server.host || '').startsWith('agent:')) {

                        const agentId = String(server.host).replace(/^agent:/, '').trim();

                        const result = await ipcRenderer.invoke('agent:connect', { agentId });

                        if (result.success) {

                            onConnectionSuccess({

                                host: server.host,

                                username: 'agent',

                                keyPath: '',

                                id: server.id,

                                serverName: server.name,

                                mode: server.mode || 'agent'

                            });

                        } else {

                            alert('Connection Failed: ' + result.error);

                        }

                        return;

                    }



                    let connectionConfig = {

                        host: server.host,

                        username: server.username

                    };



                    // Use stored private_key if available (cloud storage), otherwise resolve keyPath

                    if (server.private_key) {

                        connectionConfig.privateKey = server.private_key;

                    } else if (server.keyPath) {

                        const resolvedKeyPath = await resolveKeyPath(server.keyPath);

                        connectionConfig.privateKeyPath = resolvedKeyPath;

                    }



                    // IPC Call DIRECTLY

                    const result = await ipcRenderer.invoke('ssh:connect', connectionConfig);



                    if (result.success) {

                        onConnectionSuccess({

                            host: server.host,

                            username: result.username || server.username,

                            keyPath: server.keyPath, // Pass original keyPath for reference

                            id: server.id, // PASS ID to prevent copy

                            serverName: server.name,

                            mode: server.mode || 'ssh'

                        });

                    } else {

                        alert('Connection Failed: ' + result.error);

                    }

                } catch (e) {

                    alert('System Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }



            // End of consolidated functions




            function applyUserPermissions(username) {

                const key = `permissions_${username}`;

                const stored = localStorage.getItem(key);

                let allowed = [];



                try {

                    if (stored) allowed = JSON.parse(stored);

                    else {

                        // Fallback defaults for unknown restricted users

                        allowed = ['dashboard', 'terminal', 'files'];

                    }

                } catch (e) { allowed = ['dashboard']; }



                console.log(`Applying permissions for ${username}:`, allowed);



                // Hide all sidebar nav items first

                const navItems = document.querySelectorAll('.nav-item, #nav-servers, #nav-cicd');

                navItems.forEach(el => {

                    // Check if element has an ID that matches one of our permission IDs

                    // Our IDs: nav-dashboard, nav-servers, etc.

                    // Permission IDs: dashboard, servers, etc.

                    const id = el.id.replace('nav-', '');



                    if (allowed.includes(id)) {

                        el.classList.remove('hidden');

                    } else {

                        el.classList.add('hidden');

                    }

                });




                // Always show 'Disconnect' (Logo)

            }


            function resetSidebarPermissions() {

                // Show all

                const navItems = document.querySelectorAll('.nav-item, #nav-servers, #nav-cicd');

                navItems.forEach(el => el.classList.remove('hidden'));
            }


            // Shared Success Handler

            async function onConnectionSuccess(details) {
                console.log("onConnectionSuccess called", details);
                // DEBUG: Uncomment line below to confirm this function is reached
                // alert("DEBUG: onConnectionSuccess reached");

                isConnected = true;
                connectedServerData = details;
                currentFilesPath = '~';

                // Notify monitoring iframe of connection
                const monFrame = document.getElementById('monitoring-modern-frame');
                if (monFrame && monFrame.contentWindow) {
                    monFrame.contentWindow.postMessage({ type: 'server-connected', serverId: details.id }, '*');
                }

                try {
                    if (String(details?.host || '').startsWith('agent:')) {
                        const homeCandidate = await ipcRenderer.invoke('ssh:exec', 'test -d /home/ubuntu && echo /home/ubuntu');
                        const homeUbuntu = String(homeCandidate?.stdout || '').trim();
                        if (homeCandidate?.success && homeUbuntu) {
                            currentFilesPath = homeUbuntu;
                        } else {
                            const homeRes = await ipcRenderer.invoke('ssh:exec', 'echo $HOME');
                            const homeDir = String(homeRes?.stdout || '').trim();
                            if (homeRes?.success && homeDir) {
                                currentFilesPath = homeDir;
                            }
                        }
                    }
                } catch (e) {
                }

                modal.classList.add('hidden');

                if (pageTitle) {
                    const displayName = details.serverName || details.host;
                    pageTitle.innerText = displayName.length > 25 ? displayName.substring(0, 22) + '...' : displayName;
                }

                document.getElementById('disconnect-btn')?.classList.remove('hidden');

                let existsIndex = userServers.findIndex(s => s.host === details.host && s.username === details.username);
                if (existsIndex === -1 && details.id) {
                    existsIndex = userServers.findIndex(s => s.id === details.id);
                }

                if (existsIndex === -1) {
                    const newServer = {
                        id: details.id || Date.now().toString(),
                        host: details.host,
                        username: details.username,
                        keyPath: details.keyPath,
                        keyStoredInCloud: details.shouldSaveToCloud || false,
                        isElasticIP: details.isElastic || false,
                        name: details.serverName || `Server ${userServers.length + 1}`,
                        mode: details.mode || 'ssh'
                    };
                    userServers.push(newServer);

                    if (!details.shouldSaveToCloud && details.keyPath) {
                        const savedName = await saveLocalKeypair(details.host, details.username, details.keyPath);
                        newServer.keyPath = savedName;
                    }

                    const cloudPayload = { ...newServer };
                    if (!details.shouldSaveToCloud) {
                        cloudPayload.keyPath = "";
                        cloudPayload.private_key = null;
                        cloudPayload.keyStoredInCloud = false;
                    } else if (details.keyPath) {
                        cloudPayload.keyPath = "";
                        const fileRes = await ipcRenderer.invoke('ssh:read-local-file', details.keyPath);
                        if (fileRes.success) {
                            cloudPayload.private_key = fileRes.content;
                        }
                    }

                    await saveServerToSupabase(cloudPayload);
                } else {
                    if (!details.shouldSaveToCloud && details.keyPath) {
                        const savedName = await saveLocalKeypair(details.host, details.username, details.keyPath);
                        userServers[existsIndex].keyPath = savedName;
                    } else {
                        userServers[existsIndex].keyPath = details.keyPath;
                    }

                    userServers[existsIndex].keyStoredInCloud = details.shouldSaveToCloud || false;
                    if (details.isElastic !== undefined) {
                        userServers[existsIndex].isElasticIP = details.isElastic;
                    }
                    // Update mode if provided
                    if (details.mode) {
                        userServers[existsIndex].mode = details.mode;
                    }

                    const cloudPayload = { ...userServers[existsIndex] };
                    if (!details.shouldSaveToCloud) {
                        cloudPayload.private_key = null;
                        cloudPayload.keyStoredInCloud = false;
                    } else {
                        cloudPayload.keyPath = "";
                        if (details.keyPath) {
                            const fileRes = await ipcRenderer.invoke('ssh:read-local-file', details.keyPath);
                            if (fileRes.success) {
                                cloudPayload.private_key = fileRes.content;
                            }
                        }
                    }

                    await saveServerToSupabase(cloudPayload);
                }

                try {
                    const groupsRes = await ipcRenderer.invoke('ssh:exec', 'groups');
                    const isSudoer = groupsRes.stdout.includes('sudo') || groupsRes.stdout.includes('root') || details.username === 'root';
                    connectedServerData.role = isSudoer ? 'admin' : 'user';
                    console.log(`User Role Detected: ${connectedServerData.role}`);
                } catch (e) {
                    console.warn("Failed to check groups, defaulting to user");
                    connectedServerData.role = 'user';
                }

                startMonitoring();
                updateSidebarPermissions();
                navigate('dashboard');
            }

            function updateSidebarPermissions() {
                const role = connectedServerData?.role || 'user';
                const adminItems = document.querySelectorAll('[data-role="admin"]');

                adminItems.forEach(el => {
                    if (role === 'admin') {
                        el.classList.remove('hidden');
                    } else {
                        el.classList.add('hidden');
                    }
                });
            }

            async function saveServerToSupabase(server) {
                console.log("saveServerToSupabase called with:", server);

                try {
                    let session = null;
                    let sessionError = null;
                    try {
                        const sessionRes = await supabase.auth.getSession();
                        session = sessionRes?.data?.session || null;
                        sessionError = sessionRes?.error || null;
                        console.log("[saveServerToSupabase] getSession result:", { hasSession: !!session, hasError: !!sessionError });
                    } catch (e) {
                        console.error("[saveServerToSupabase] getSession threw:", e);
                        session = null;
                    }

                    if (!session?.access_token) {
                        console.error("[saveServerToSupabase] No access_token in session:", session);
                        alert("Authentication missing (no session). Please login again.");
                        return;
                    }

                    let user = null;
                    let userError = null;
                    try {
                        const userRes = await supabase.auth.getUser(session.access_token);
                        user = userRes?.data?.user || null;
                        userError = userRes?.error || null;
                        console.log("[saveServerToSupabase] getUser result:", { hasUser: !!user, hasError: !!userError });

                        if (!user && session?.refresh_token) {
                            console.log("[saveServerToSupabase] Trying to refresh session...");
                            try {
                                const refreshed = await supabase.auth.refreshSession();
                                const nextSession = refreshed?.data?.session || null;
                                console.log("[saveServerToSupabase] refreshSession result:", { hasNextSession: !!nextSession });
                                if (nextSession?.access_token) {
                                    session = nextSession;
                                    const retryUserRes = await supabase.auth.getUser(session.access_token);
                                    user = retryUserRes?.data?.user || null;
                                    console.log("[saveServerToSupabase] getUser after refresh:", { hasUser: !!user });
                                }
                            } catch (refreshErr) {
                                console.error("[saveServerToSupabase] refreshSession failed:", refreshErr);
                            }
                        }
                    } catch (e) {
                        console.error("[saveServerToSupabase] getUser threw:", e);
                        user = null;
                    }

                    if (!user) {
                        console.error("[saveServerToSupabase] Could not get user. Session present but user null.");
                        alert("Authentication failed (session invalid). Please login again.");
                        return;
                    }

                    const payload = {
                        user_id: user.id,
                        host: server.host,
                        username: server.username,
                        key_path: server.keyPath || "",
                        private_key: server.private_key || null,
                        key_stored_in_cloud: server.keyStoredInCloud || (server.private_key ? true : false),
                        is_elastic: server.isElasticIP || false,
                        name: server.name || server.host,
                        mode: server.mode || 'ssh',
                        updated_at: new Date().toISOString()
                    };

                    console.log("Supabase payload:", payload);

                    const { data: existing, error: selectError } = await supabase
                        .from('servers')
                        .select('id')
                        .eq('user_id', user.id)
                        .eq('host', server.host)
                        .maybeSingle();

                    if (selectError) {
                        console.error("Select error:", selectError);
                        alert("Cloud Query Failed: " + selectError.message);
                        return;
                    }

                    let result;
                    if (existing && existing.id) {
                        result = await supabase
                            .from('servers')
                            .update(payload)
                            .eq('id', existing.id);
                    } else {
                        result = await supabase
                            .from('servers')
                            .insert(payload);
                    }

                    if (result.error) {
                        console.warn("Cloud Sync Warning:", result.error);
                        alert("Cloud Save Failed: " + (result.error.message || JSON.stringify(result.error)));
                    } else {
                        console.log("Server synced to Supabase successfully");
                        showLoader("Saved", "Server synced to cloud.");
                        setTimeout(hideLoader, 1000);
                    }
                } catch (e) {
                    console.error("Cloud Sync Error:", e);
                    alert("Sync Error: " + e.message);
                }
            }


            // --- AUTH & PROFILE LOGIC ---

            // Local Profile Cache Key




            // Local Profile Cache Key

            const PROFILE_CACHE_KEY = 'devyntra_profile_cache';



            async function initProfile() {

                // BACKGROUND FETCH: Get latest from Supabase

                try {

                    const { data: { session } } = await supabase.auth.getSession();

                    if (!session) {

                        // Not authenticated, redirect

                        // Only redirect if no cache? Or always?

                        // Safe to always redirect if session is invalid.

                        window.location.href = 'auth.html';

                        return;

                    }



                    try {

                        await ipcRenderer.invoke('auth:set-token', session.access_token);

                    } catch (e) {

                        console.warn('Failed to sync auth token to main process:', e);

                    }



                    try {

                        window.__DEVYNTRA_ACCESS_TOKEN = session.access_token;

                    } catch (e) { }



                    try {

                        const base = await ipcRenderer.invoke('backend:get-base-url');

                        if (base && base.success && base.baseUrl) {

                            window.__DEVYNTRA_BACKEND_URL = String(base.baseUrl);

                        }

                    } catch (e) { }



                    const user = session.user;

                    const email = user.email;

                    const name = user.user_metadata?.full_name || user.user_metadata?.name || email.split('@')[0];

                    const avatar = user.user_metadata?.avatar_url || user.user_metadata?.picture || `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`;



                    // Update Globals

                    currentUser.name = name;

                    currentUser.email = email;

                    currentUser.avatar = avatar;



                    // Update UI

                    updateProfileUI(name, email, avatar);



                    // Force update dashboard avatar after a short delay to ensure DOM is ready

                    setTimeout(() => {

                        const dashboardAvatar = document.getElementById('dashboard-profile-img');

                        if (dashboardAvatar) {

                            dashboardAvatar.src = avatar;

                            console.log('Dashboard avatar updated to:', avatar);

                        }

                    }, 100);



                    // Update Cache

                    // Update Cache? No, we removed localStorage.

                    // Just update UI.



                    // 3. LOAD USER'S SERVERS from Supabase

                    await loadServersFromSupabase();



                    // Clean up old localStorage servers (migration)

                    localStorage.removeItem('devyntra_servers');



                } catch (e) {
                    console.error("Profile Init Error:", e);
                } finally {
                    hideLoader();
                }
            }




            async function loadServersFromSupabase() {
                let allData = [];
                let serverError = null;
                try {
                    const { data: servers, error: sErr } = await supabase.from('servers').select('*');
                    let agents = [];
                    let aErr = null;
                    if (agentsTableAvailable) {
                        const res = await supabase.from('agents').select('*');
                        agents = res?.data || [];
                        aErr = res?.error || null;
                    }
                    if (sErr) serverError = sErr.message;

                    // If agents table/view doesn't exist in this Supabase project, treat it as optional
                    const agentsOptionalNotFound = !!(aErr && (aErr.status === 404 || /not found/i.test(String(aErr.message || ''))));
                    if (agentsOptionalNotFound) {
                        agentsTableAvailable = false;
                    }
                    if (aErr && !agentsOptionalNotFound) {
                        console.warn('Agents load warning:', aErr);
                    }

                    allData = [...(servers || []), ...((agentsOptionalNotFound ? [] : (agents || [])))];

                    if (allData.length === 0 && (serverError || "")) {

                        // Only alert if both failed significantly and empty

                        console.warn("No servers or agents found.");

                    }



                    // Map Supabase columns to app format

                    userServers = allData.map(s => {

                        return {

                            id: s.id || `${s.host || s.ip}-${s.username || 'root'}`,

                            host: s.host || s.ip,   // Agents might use 'ip'

                            username: s.username || 'root', // Agents default to root usually

                            keyPath: s.key_path || "",

                            private_key: s.private_key || null,

                            keyStoredInCloud: s.key_stored_in_cloud || false,

                            isElasticIP: s.is_elastic || false,

                            name: s.name || s.hostname || s.host || s.ip,

                            params: s.params || {},  // Preserve agent params if any

                            type: s.agent_version ? 'agent' : 'ssh', // Distinguish type

                            mode: s.mode || (s.agent_version ? 'agent' : 'ssh'), // Load mode from DB

                            created_at: s.created_at || s.updated_at || new Date().toISOString() // Preserve timestamp

                        };

                    });

                    // Sort by created_at or updated_at descending (newest first)
                    userServers.sort((a, b) => {
                        const dateA = new Date(a.created_at || a.updated_at || 0);
                        const dateB = new Date(b.created_at || b.updated_at || 0);
                        return dateB - dateA; // Descending order (newest first)
                    });

                    console.log('Servers after sorting:', userServers.map(s => ({
                        name: s.name,
                        created_at: s.created_at,
                        updated_at: s.updated_at
                    })));



                    console.log(`Loaded ${userServers.length} servers/agents.`);



                    // Refresh the dashboard view if we're on it

                    if (currentView === 'dashboard') {

                        navigate('dashboard');

                    }



                    // Refresh the servers view if we're on it

                    if (currentView === 'servers') {

                        // Re-render the view wrapper to show new data, preserving cache structure

                        const wrapper = document.getElementById('view-cache-servers');

                        if (wrapper && views['servers']) {

                            wrapper.innerHTML = views['servers']();

                        } else if (!wrapper) {

                            // Fallback: If for some reason cache wrapper isn't there yet, navigate triggers it

                            navigate('servers');

                        }

                    }

                } catch (e) {

                    console.error("Critical error in loadServersFromSupabase:", e);

                    userServers = [];

                }

            }



            supabase.auth.onAuthStateChange(async (event, session) => {

                try {

                    await ipcRenderer.invoke('auth:set-token', session?.access_token || null);

                } catch (e) {

                    console.warn('Failed to sync auth token to main process:', e);

                }

            });



            function updateProfileUI(name, email, avatar) {

                const profileImg = document.getElementById('sidebar-profile-img');

                const profileName = document.getElementById('sidebar-profile-name');

                const profileEmail = document.getElementById('sidebar-profile-email');



                if (profileImg) profileImg.src = avatar;

                if (profileName) profileName.innerText = name || email; // Prefer name

                if (profileEmail) profileEmail.innerText = email || "Pro Plan";



                // Update dashboard profile image if exists

                const dashboardAvatar = document.getElementById('dashboard-profile-img');

                if (dashboardAvatar) dashboardAvatar.src = avatar;



                // Update Welcome Title if present (DOM check)

                const welcomeTitle = document.querySelector('#content-container h2.text-3xl');

                if (welcomeTitle && welcomeTitle.innerText.includes('Welcome Back')) {

                    welcomeTitle.innerText = `Welcome Back, ${name}`;

                }

            }



            async function logoutApp() {

                if (confirm("Sign out of Devyntra?")) {

                    try {

                        // Attempt proper sign out

                        await supabase.auth.signOut();

                    } catch (e) {

                        console.error("Logout Error (continuing cleanup):", e);

                    }



                    // Force clear any potential local data Supabase missed

                    localStorage.removeItem('sb-psnrofnlgpqkfprjrbnm-auth-token');



                    // FORCE REDIRECT

                    window.location.replace('auth.html');

                }

            }



            // Initialize Profile on Load

            document.addEventListener('DOMContentLoaded', initProfile);



            // --- SETTINGS MODAL LOGIC ---

            function openSettingsModal() {

                // Get current values from Sidebar (or fetch from Supabase if stored differently)

                const name = document.getElementById('sidebar-profile-name').innerText;

                const email = document.getElementById('sidebar-profile-email').innerHTML.includes('@') ? document.getElementById('sidebar-profile-email').innerText : "";

                const avatar = document.getElementById('sidebar-profile-img').src;



                // Better way is to fetch directly from session again to be safe

                supabase.auth.getUser().then(({ data: { user } }) => {

                    if (user) {

                        document.getElementById('settings-name-input').value = user.user_metadata?.full_name || user.user_metadata?.name || '';

                        document.getElementById('settings-email-input').value = user.email;

                        document.getElementById('settings-avatar').src = user.user_metadata?.avatar_url || user.user_metadata?.picture || document.getElementById('sidebar-profile-img').src;

                    }

                });



                const savedDownloadPath = localStorage.getItem('devyntra:downloadPath') || '';

                const downloadInput = document.getElementById('settings-download-path');

                if (downloadInput) downloadInput.value = savedDownloadPath;



                document.getElementById('settings-modal').classList.remove('hidden');

            }



            async function changeDownloadFolder() {

                try {

                    const res = await ipcRenderer.invoke('local:choose-folder');

                    if (res && res.success && res.path) {

                        localStorage.setItem('devyntra:downloadPath', res.path);

                        const downloadInput = document.getElementById('settings-download-path');

                        if (downloadInput) downloadInput.value = res.path;

                    }

                } catch (e) {

                    alert('Failed to choose folder: ' + e.message);

                }

            }



            let avatarFile = null;



            async function uploadAvatar(input) {

                if (input.files && input.files[0]) {

                    const file = input.files[0];



                    // Validate file size (2MB limit)

                    if (file.size > 2 * 1024 * 1024) {

                        alert("File size must be less than 2MB");

                        input.value = '';

                        return;

                    }



                    // Validate file type

                    if (!file.type.match(/^image\/(jpeg|jpg|png|gif)$/)) {

                        alert("Only JPG, PNG, and GIF files are allowed");

                        input.value = '';

                        return;

                    }



                    avatarFile = file;



                    // Preview the image

                    const reader = new FileReader();

                    reader.onload = function (e) {

                        document.getElementById('settings-avatar').src = e.target.result;

                    };

                    reader.readAsDataURL(file);

                }

            }



            async function saveUserProfile() {

                const btn = document.getElementById('btn-save-profile');

                const newName = document.getElementById('settings-name-input').value.trim();



                if (!newName) {

                    alert("Name cannot be empty");

                    return;

                }



                // UI Loading

                const originalText = btn.innerHTML;

                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i> Saving...';

                btn.disabled = true;



                try {

                    // Get current user

                    const { data: { user } } = await supabase.auth.getUser();

                    if (!user) {

                        throw new Error("User not authenticated");

                    }



                    let avatarUrl = null;



                    // Upload avatar if a new one was selected

                    if (avatarFile) {

                        const fileExt = avatarFile.name.split('.').pop();

                        const fileName = `${user.id}/avatar.${fileExt}`;



                        const { data: uploadData, error: uploadError } = await supabase.storage

                            .from('avatars')

                            .upload(fileName, avatarFile, {

                                upsert: true,

                                contentType: avatarFile.type

                            });



                        if (uploadError) throw uploadError;



                        // Get public URL

                        const { data: { publicUrl } } = supabase.storage

                            .from('avatars')

                            .getPublicUrl(fileName);



                        avatarUrl = publicUrl;

                    }



                    // Update user metadata

                    const updateData = { full_name: newName };

                    if (avatarUrl) {

                        updateData.avatar_url = avatarUrl;

                    }



                    const { data, error } = await supabase.auth.updateUser({

                        data: updateData

                    });



                    if (error) throw error;



                    // Update global user state

                    currentUser.name = newName;

                    if (avatarUrl) {

                        currentUser.avatar = avatarUrl;

                    }



                    // Update UI Immediately

                    const nameEl = document.getElementById('sidebar-profile-name');

                    if (nameEl) nameEl.innerText = newName;



                    // Update avatar in sidebar if exists

                    const sidebarAvatar = document.getElementById('sidebar-profile-img');

                    if (sidebarAvatar && avatarUrl) {

                        sidebarAvatar.src = avatarUrl;

                    }



                    // Update avatar in dashboard if exists

                    const dashboardAvatar = document.getElementById('dashboard-profile-img');

                    if (dashboardAvatar && avatarUrl) {

                        dashboardAvatar.src = avatarUrl;

                    }



                    // Update Welcome Message if visible

                    const welcomeTitle = document.querySelector('#content-container h2.text-3xl');

                    if (welcomeTitle && welcomeTitle.innerText.includes('Welcome Back')) {

                        welcomeTitle.innerText = `Welcome Back, ${newName}`;

                    }



                    // Update settings modal avatar

                    const settingsAvatar = document.getElementById('settings-avatar');

                    if (settingsAvatar && avatarUrl) {

                        settingsAvatar.src = avatarUrl;

                    }



                    alert("Profile updated successfully!");

                    document.getElementById('settings-modal').classList.add('hidden');



                    // Clear avatar file after successful upload

                    avatarFile = null;



                } catch (e) {

                    alert("Error updating profile: " + e.message);

                } finally {

                    btn.innerHTML = originalText;

                    btn.disabled = false;

                }

            }



            async function disconnectServer() {

                await ipcRenderer.invoke('ssh:disconnect');

                isConnected = false;

                connectedServerData = null; // Clear details

                clearInterval(statsInterval);

                if (pageTitle) pageTitle.innerText = 'serve_rname.';

                document.getElementById('disconnect-btn')?.classList.add('hidden');



                navigate('servers');

            }



            // --- RESPONSIVE SIDEBAR LOGIC ---

            function toggleSidebar() {

                const sidebar = document.getElementById('app-sidebar');

                const backdrop = document.getElementById('mobile-backdrop');



                // Toggle Translate

                if (sidebar.classList.contains('-translate-x-full')) {

                    sidebar.classList.remove('-translate-x-full');

                    backdrop.classList.remove('hidden');

                } else {

                    sidebar.classList.add('-translate-x-full');

                    backdrop.classList.add('hidden');

                }

            }



            function closeSidebar() {

                const sidebar = document.getElementById('app-sidebar');

                const backdrop = document.getElementById('mobile-backdrop');



                sidebar.classList.add('-translate-x-full');

                backdrop.classList.add('hidden');

            }



            // --- 5. FILES LOGIC ---

            async function loadFiles(path) {

                if (!isConnected) return;



                // Clean path

                path = path.trim();

                // Default to user home directory if path is empty or root

                if (!path || path === '.') path = '~';



                // Agent connections: resolve '~' to an absolute home directory before listing

                if (path === '~' && String(connectedServerData?.host || '').startsWith('agent:')) {

                    try {

                        const homeRes = await ipcRenderer.invoke('ssh:exec', 'bash -lc "echo $HOME"');



                        let homeDir = String(homeRes?.stdout || '').trim();

                        if (!homeDir) {

                            const homeFallback = await ipcRenderer.invoke('ssh:exec', 'echo $HOME');

                            homeDir = String(homeFallback?.stdout || '').trim();

                        }

                        if (homeDir) {

                            path = homeDir;

                        }

                    } catch (e) {

                    }

                }



                // update UI

                const tbody = document.getElementById('files-table-body');

                const pathInput = document.getElementById('path-input');



                if (tbody) tbody.innerHTML = getSkeletonHtml('table-rows');

                if (pathInput) pathInput.value = path;



                currentFilesPath = path;



                const res = await ipcRenderer.invoke('ssh:list-files', path);



                if (!tbody) return; // Switched view?



                if (res.success) {

                    // If the path was resolved to absolute by backend, update UI

                    if (res.path && res.path !== path) {

                        currentFilesPath = res.path;

                        if (pathInput) pathInput.value = currentFilesPath;

                        path = res.path; // Update local ref

                    }



                    if (res.files.length === 0) {

                        tbody.innerHTML = '<tr><td colspan="5" class="py-10 text-center text-gray-400">Directory is empty</td></tr>';

                        return;

                    }



                    // Helper to detect if file is likely binary (interactive edit)

                    const isBinary = (name) => {

                        const ext = name.split('.').pop().toLowerCase();

                        // Block specific binary types, allow everything else

                        return ['png', 'jpg', 'jpeg', 'gif', 'ico', 'webp', 'pdf', 'zip', 'tar', 'gz', 'rar', '7z', 'exe', 'dll', 'so', 'bin', 'iso', 'dmg'].includes(ext);

                    };



                    tbody.innerHTML = res.files.map(f => `

                    <tr class="hover:bg-gray-50 group cursor-pointer transition-colors border-b border-transparent hover:border-indigo-100 ${f.isDirectory ? 'droppable-row' : ''}" 

                        data-filename="${f.name.replace(/"/g, '&quot;')}"

                        data-is-directory="${f.isDirectory}"

                        ondblclick="${f.isDirectory ? `loadFiles('${path === '/' ? '' : path}/${f.name}')` : ''}"

                        oncontextmenu="handleContextMenu(event, '${f.name.replace(/'/g, "\\'")}', ${f.isDirectory}, ${isBinary(f.name)})"

                        ondragenter="handleRowDragEnter(event, this)"

                        ondragleave="handleRowDragLeave(event, this)"

                        ondrop="handleRowDrop(event, '${f.name}')"

                        ondragover="event.preventDefault()">

                         <td class="px-3 py-4" onclick="event.stopPropagation()">

                             <input type="checkbox" class="file-checkbox w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer" 

                                 data-filename="${f.name.replace(/"/g, '&quot;')}"

                                 data-is-directory="${f.isDirectory}"

                                 onchange="toggleFileSelection(this)">

                         </td>

                         <td class="px-4 py-4 text-gray-400">

                             <i class="fas ${f.isDirectory ? 'fa-folder text-yellow-400' : 'fa-file-code text-gray-400'}"></i>

                         </td>

                         <td class="px-4 py-4 font-medium text-gray-900">${f.name}</td>

                         <td class="px-4 py-4 text-gray-500">${f.size}</td>

                         <td class="px-4 py-4 text-gray-500">${f.modified}</td>

                    </tr>

                `).join('');



                    // Update paste toolbar visibility

                    updatePasteToolbar();

                } else {

                    tbody.innerHTML = `<tr><td colspan="5" class="py-10 text-center text-red-500">Error: ${res.error}</td></tr>`;

                }

            }



            function navigateManual() {

                const input = document.getElementById('path-input');

                if (input) loadFiles(input.value);

            }



            function navigateUp() {

                if (currentFilesPath === '/') return;

                const parts = currentFilesPath.split('/');

                parts.pop();

                const newPath = parts.join('/') || '/';

                loadFiles(newPath);

            }



            // EDITOR LOGIC

            async function openEditor(path, name) {

                try {

                    showLoader("Loading File...", "Reading content from server");



                    // Set UI state before having content

                    document.getElementById('editor-modal').classList.remove('hidden');

                    document.getElementById('editor-filename').innerText = name;

                    document.getElementById('editor-path').innerText = path;

                    document.getElementById('file-editor-content').value = "";

                    document.getElementById('file-editor-content').disabled = true;



                    const res = await ipcRenderer.invoke('ssh:read-file', path);



                    document.getElementById('file-editor-content').disabled = false;



                    if (res.success) {

                        document.getElementById('file-editor-content').value = res.content;

                    } else {

                        document.getElementById('file-editor-content').value = "Error reading file: " + res.error;

                    }

                } catch (e) {

                    alert("Critical error opening editor: " + e.message);

                    closeEditor();

                } finally {

                    hideLoader();

                }

            }



            function closeEditor() {

                document.getElementById('editor-modal').classList.add('hidden');

            }



            let cachedPermissionUsers = [];

            let cachedPermissionGroups = [];



            async function ctxPermissions() {

                const { name, isDir } = contextMenuTarget;

                const path = `${currentFilesPath === '/' ? '' : currentFilesPath}/${name}`;



                // Set initial values in modal

                document.getElementById('perm-file-name').innerText = name;

                document.getElementById('perm-path').value = path;

                document.getElementById('perm-recursive-container').style.display = isDir ? 'flex' : 'none';

                document.getElementById('perm-recursive').checked = false;



                // Clear and load dropdowns

                document.getElementById('perm-owner-select').innerHTML = '<option value="">Loading...</option>';

                document.getElementById('perm-group-select').innerHTML = '<option value="">Loading...</option>';



                // Show modal

                document.getElementById('permissions-modal').classList.remove('hidden');

                hideContextMenu();



                // Fetch Users/Groups

                try {

                    const res = await ipcRenderer.invoke('ssh:get-system-users');

                    if (res.success) {

                        cachedPermissionUsers = res.users;

                        cachedPermissionGroups = res.groups;

                        loadPermissionOptions();

                    } else {

                        console.error(res.error);

                    }

                } catch (e) { console.error(e); }

            }



            function loadPermissionOptions() {

                const showSystem = document.getElementById('perm-show-system').checked;

                const userSelect = document.getElementById('perm-owner-select');

                const groupSelect = document.getElementById('perm-group-select');



                const users = cachedPermissionUsers.filter(u => showSystem || !u.isSystem);

                const groups = cachedPermissionGroups.filter(g => showSystem || !g.isSystem);



                userSelect.innerHTML = `<option value="">-- No Change --</option>` +

                    users.map(u => `<option value="${u.username}">${u.username}</option>`).join('');



                groupSelect.innerHTML = `<option value="">-- No Change --</option>` +

                    groups.map(g => `<option value="${g.name}">${g.name}</option>`).join('');

            }



            async function submitPermissions() {

                const path = document.getElementById('perm-path').value;

                const mode = document.getElementById('perm-mode').value.trim();



                const userVal = document.getElementById('perm-owner-select').value;

                const groupVal = document.getElementById('perm-group-select').value;

                const recursive = document.getElementById('perm-recursive').checked;



                let owner = "";

                if (userVal || groupVal) {

                    if (userVal && groupVal) owner = `${userVal}:${groupVal}`;

                    else if (userVal) owner = userVal;

                    else if (groupVal) owner = `:${groupVal}`;

                }



                if (!mode && !owner) {

                    alert("Please specify permissions or select an owner/group change.");

                    return;

                }



                document.getElementById('permissions-modal').classList.add('hidden');

                showLoader("Applying Permissions...", "Updating system attributes");



                try {

                    // Update chmod if provided

                    if (mode) {

                        const res = await ipcRenderer.invoke('ssh:chmod', { path, mode, recursive });

                        if (!res.success) throw new Error("Chmod Failed: " + res.error);

                    }

                    // Update chown if provided

                    if (owner) {

                        const res = await ipcRenderer.invoke('ssh:chown', { path, owner, recursive });

                        if (!res.success) throw new Error("Chown Failed: " + res.error);

                    }



                    alert("Attributes updated successfully.");

                    loadFiles(currentFilesPath);

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            function closePermissionsModal() {

                document.getElementById('permissions-modal').classList.add('hidden');

            }



            function hideContextMenu() {

                const contextMenu = document.getElementById('context-menu');

                if (contextMenu) contextMenu.classList.add('hidden');

            }



            async function saveFile() {

                const path = document.getElementById('editor-path').innerText;

                const content = document.getElementById('file-editor-content').value;



                // Show saving...

                const btn = document.querySelector('#editor-modal button[onclick="saveFile()"]');

                const originalText = btn.innerText;

                btn.innerText = "Saving...";

                btn.disabled = true;



                try {

                    const res = await ipcRenderer.invoke('ssh:write-file', { path, content });



                    if (res.success) {

                        alert('File saved successfully!');

                        closeEditor();

                        loadFiles(currentFilesPath);

                    } else {

                        alert('Failed to save: ' + res.error);

                    }

                } catch (e) {

                    alert("Error saving file: " + e.message);

                } finally {

                    btn.innerText = originalText;

                    btn.disabled = false;

                }

            }



            async function performUpload(input) {

                if (input.files.length === 0) return;

                handleFileUploads(input.files, currentFilesPath);

            }



            async function handleFileUploads(fileList, targetDirectory = null) {

                if (fileList.length === 0) return;



                const targetPath = targetDirectory || currentFilesPath;

                const confirmMsg = fileList.length === 1

                    ? `Upload ${fileList[0].name} to ${targetPath}?`

                    : `Upload ${fileList.length} files to ${targetPath}?`;



                if (!confirm(confirmMsg)) {

                    // reset input if it came from input

                    const inp = document.getElementById('upload-input');

                    if (inp) inp.value = '';

                    return;

                }



                showLoader("Uploading...", "Starting transfer...");



                try {

                    let successCount = 0;

                    let failCount = 0;



                    const cleanTarget = targetPath === '/' ? '/' : targetPath.replace(/\/$/, '');



                    for (let i = 0; i < fileList.length; i++) {

                        const file = fileList[i];

                        const localPath = file.path;



                        let remotePath = '';

                        if (cleanTarget === '/' || cleanTarget === '.' || cleanTarget === '') {

                            remotePath = file.name;

                        } else {

                            remotePath = `${cleanTarget}/${file.name}`;

                        }



                        // Update loader text

                        showLoader(`Uploading (${i + 1}/${fileList.length})`, `Transferring ${file.name}...`);



                        const res = await ipcRenderer.invoke('ssh:upload-file', { localPath, remotePath });

                        if (res.success) successCount++;

                        else failCount++;

                    }



                    // Clear input

                    const inp = document.getElementById('upload-input');

                    if (inp) inp.value = '';



                    if (failCount > 0) {

                        alert(`Upload complete. Success: ${successCount}, Failed: ${failCount}`);

                    }



                    loadFiles(currentFilesPath);

                } catch (e) {

                    alert("Start Upload Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function deleteFile(path) {

                if (!confirm(`Are you sure you want to PERMANENTLY delete:\n${path}`)) return;



                try {

                    showLoader("Deleting...", "Removing item from server");

                    const res = await ipcRenderer.invoke('ssh:delete-file', path);



                    if (res.success) {

                        loadFiles(currentFilesPath);

                    } else {

                        alert("Failed to delete: " + res.error);

                    }

                } catch (e) {

                    alert("Delete Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function renameFile(oldPath, oldName) {

                // DEPRECATED: Using Modal

            }



            // RENAME MODAL LOGIC

            let renameTarget = { path: '', name: '' };



            function openRenameModal(oldPath, oldName) {

                renameTarget = { path: oldPath, name: oldName };

                document.getElementById('rename-modal').classList.remove('hidden');

                document.getElementById('rename-input').value = oldName;

                document.getElementById('rename-input').focus();

            }



            function closeRenameModal() {

                document.getElementById('rename-modal').classList.add('hidden');

            }



            async function submitRename() {

                const newName = document.getElementById('rename-input').value.trim();

                const { path: oldPath, name: oldName } = renameTarget;



                if (!newName || newName === oldName) {

                    closeRenameModal();

                    return;

                }



                closeRenameModal();



                try {

                    // Construct new path

                    const parts = oldPath.split('/');

                    parts.pop();

                    const cleanParts = parts.filter(p => p !== '');



                    let basePath = cleanParts.length > 0 ? '/' + cleanParts.join('/') : '';

                    if (!oldPath.startsWith('/')) basePath = cleanParts.join('/');



                    const newPath = basePath ? `${basePath}/${newName}` : newName;



                    showLoader("Renaming...", "Updating file name");

                    const res = await ipcRenderer.invoke('ssh:rename-file', { oldPath, newPath });



                    if (res.success) {

                        loadFiles(currentFilesPath);

                    } else {

                        alert("Failed to rename: " + res.error);

                    }

                } catch (e) {

                    alert("Rename Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            // GENERIC INPUT MODAL LOGIC (Replaces prompt())

            let inputCallback = null;



            function openInputModal(title, placeholder, callback) {

                document.getElementById('input-modal-title').innerText = title;

                document.getElementById('input-modal-input').placeholder = placeholder;

                document.getElementById('input-modal-input').value = '';

                document.getElementById('input-modal').classList.remove('hidden');

                setTimeout(() => document.getElementById('input-modal-input').focus(), 50);

                inputCallback = callback;

            }



            function closeInputModal() {

                document.getElementById('input-modal').classList.add('hidden');

                inputCallback = null;

            }



            function submitInputModal() {

                const val = document.getElementById('input-modal-input').value.trim();

                if (!val) return;



                if (inputCallback) inputCallback(val);

                closeInputModal();

            }



            function handleInputKeydown(e) {

                if (e.key === 'Enter') submitInputModal();

                if (e.key === 'Escape') closeInputModal();

            }



            async function createNewFile() {

                if (!isConnected) return;



                openInputModal('Create New File', 'Enter file name (e.g. script.js)', async (name) => {

                    const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + name;



                    try {

                        showLoader("Creating...", "Creating empty file");

                        const res = await ipcRenderer.invoke('ssh:write-file', { path: fullPath, content: "" });



                        if (res.success) {

                            loadFiles(currentFilesPath);

                        } else {

                            alert("Failed to create file: " + res.error);

                        }

                    } catch (e) {

                        alert("Error creating file: " + e.message);

                    } finally {

                        hideLoader();

                    }

                });

            }



            async function createNewFolder() {

                if (!isConnected) return;



                openInputModal('Create New Folder', 'Enter folder name', async (name) => {

                    const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + name;



                    try {

                        showLoader("Creating...", "Creating new directory");

                        const res = await ipcRenderer.invoke('ssh:execute', `mkdir -p "${fullPath}"`);



                        if (res.success) {

                            loadFiles(currentFilesPath);

                        } else {

                            alert("Failed to create folder: " + (res.error || res.data?.stderr));

                        }

                    } catch (e) {

                        alert("Error creating folder: " + e.message);

                    } finally {

                        hideLoader();

                    }

                });

            }



            // Helper functions for global loader





            // --- CONTEXT MENU LOGIC ---

            let contextMenuTarget = null; // { name, isDir, isBinary }



            function handleContextMenu(e, name, isDir, isBinary) {

                e.preventDefault();

                e.stopPropagation();

                contextMenuTarget = { name, isDir, isBinary };



                const contextMenu = document.getElementById('context-menu');

                if (!contextMenu) return;



                // Show menu first (hidden but in DOM) to get dimensions

                contextMenu.style.visibility = 'hidden';

                contextMenu.classList.remove('hidden');



                const menuWidth = contextMenu.offsetWidth;

                const menuHeight = contextMenu.offsetHeight;

                const windowWidth = window.innerWidth;

                const windowHeight = window.innerHeight;



                // Calculate position with boundary checks

                let posX = e.clientX;

                let posY = e.clientY;



                // If menu would go off right edge, flip to left side of cursor

                if (posX + menuWidth > windowWidth - 10) {

                    posX = windowWidth - menuWidth - 10;

                }



                // If menu would go off bottom edge, flip to above cursor

                if (posY + menuHeight > windowHeight - 10) {

                    posY = windowHeight - menuHeight - 10;

                }



                // Ensure never negative

                if (posX < 10) posX = 10;

                if (posY < 10) posY = 10;



                // Apply position and show

                contextMenu.style.top = `${posY}px`;

                contextMenu.style.left = `${posX}px`;

                contextMenu.style.visibility = 'visible';



                // Determine file type

                const isArchive = /\.(zip|tar\.gz|tgz|gz|rar|7z|tar)$/i.test(name);



                // Toggle Edit Option (hide for directories and binary files)

                const editOption = document.getElementById('ctx-edit');

                if (isDir || isBinary || isArchive) {

                    editOption.classList.add('hidden');

                } else {

                    editOption.classList.remove('hidden');

                }



                // Toggle Compress Option (show for folders and regular non-archive files)

                const zipOption = document.getElementById('ctx-zip');

                if (isArchive) {

                    // Archives should NOT show compress

                    zipOption.classList.add('hidden');

                } else {

                    // Folders and regular files can be compressed

                    zipOption.classList.remove('hidden');

                }



                // Toggle Extract Option (only show for archive files)

                const unzipOption = document.getElementById('ctx-unzip');

                if (isArchive && !isDir) {

                    unzipOption.classList.remove('hidden');

                } else {

                    unzipOption.classList.add('hidden');

                }

            }



            // Close menu on click anywhere

            // --- MULTI-SELECT FILE OPERATIONS ---

            let selectedFiles = new Set(); // Set of selected file names

            let selectedFilesMeta = new Map(); // filename -> { isDirectory: boolean }

            let clipboard = { files: [], mode: null, sourcePath: null }; // { files: [names], mode: 'copy'|'cut', sourcePath: '/path' }



            function toggleFileSelection(checkbox) {

                const filename = checkbox.dataset.filename;

                const isDir = checkbox.dataset.isDirectory === 'true';

                if (checkbox.checked) {

                    selectedFiles.add(filename);

                    selectedFilesMeta.set(filename, { isDirectory: isDir });

                } else {

                    selectedFiles.delete(filename);

                    selectedFilesMeta.delete(filename);

                }

                updateSelectionToolbar();

            }



            function toggleSelectAll(checked) {

                const checkboxes = document.querySelectorAll('.file-checkbox');

                checkboxes.forEach(cb => {

                    cb.checked = checked;

                    const filename = cb.dataset.filename;

                    const isDir = cb.dataset.isDirectory === 'true';

                    if (checked) {

                        selectedFiles.add(filename);

                        selectedFilesMeta.set(filename, { isDirectory: isDir });

                    } else {

                        selectedFiles.delete(filename);

                        selectedFilesMeta.delete(filename);

                    }

                });

                updateSelectionToolbar();

            }



            function clearSelection() {

                selectedFiles.clear();

                selectedFilesMeta.clear();

                const checkboxes = document.querySelectorAll('.file-checkbox');

                checkboxes.forEach(cb => cb.checked = false);

                const selectAll = document.getElementById('select-all-checkbox');

                if (selectAll) selectAll.checked = false;

                updateSelectionToolbar();

            }



            async function downloadSelectedFiles() {

                if (selectedFiles.size === 0) return;

                const localDir = localStorage.getItem('devyntra:downloadPath') || '';

                if (!localDir) {

                    alert('Please set a Download Folder in Settings first.');

                    return;

                }



                const items = Array.from(selectedFiles).map((name) => {

                    const meta = selectedFilesMeta.get(name) || { isDirectory: false };

                    const fullPath = currentFilesPath === '/' ? `/${name}` : `${currentFilesPath}/${name}`;

                    return { name, path: fullPath, isDirectory: !!meta.isDirectory };

                });



                showLoader('Downloading...', `Saving to ${localDir}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:download-items', { localDir, items });

                    if (res && res.success) {

                        alert('Downloaded to: ' + (res.files || []).join(', '));

                        clearSelection();

                    } else {

                        alert('Download failed: ' + (res?.error || 'Unknown error'));

                    }

                } catch (e) {

                    alert('Download error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }



            function updateSelectionToolbar() {

                const toolbar = document.getElementById('selection-toolbar');

                const countEl = document.getElementById('selection-count');

                if (!toolbar) return;



                if (selectedFiles.size > 0) {

                    toolbar.classList.remove('hidden');

                    if (countEl) countEl.innerText = selectedFiles.size;

                } else {

                    toolbar.classList.add('hidden');

                }

            }



            function updatePasteToolbar() {

                const toolbar = document.getElementById('paste-toolbar');

                const countEl = document.getElementById('clipboard-count');

                const modeEl = document.getElementById('clipboard-mode');

                if (!toolbar) return;



                if (clipboard.files.length > 0) {

                    toolbar.classList.remove('hidden');

                    if (countEl) countEl.innerText = clipboard.files.length;

                    if (modeEl) modeEl.innerText = clipboard.mode;

                } else {

                    toolbar.classList.add('hidden');

                }

            }



            function copySelectedFiles() {

                if (selectedFiles.size === 0) return;

                clipboard = {

                    files: Array.from(selectedFiles),

                    mode: 'copy',

                    sourcePath: currentFilesPath

                };

                clearSelection();

                updatePasteToolbar();

            }



            function cutSelectedFiles() {

                if (selectedFiles.size === 0) return;

                clipboard = {

                    files: Array.from(selectedFiles),

                    mode: 'cut',

                    sourcePath: currentFilesPath

                };

                clearSelection();

                updatePasteToolbar();

            }



            function clearClipboard() {

                clipboard = { files: [], mode: null, sourcePath: null };

                updatePasteToolbar();

            }



            async function pasteFiles() {

                if (clipboard.files.length === 0) return;



                const destDir = currentFilesPath;

                const sourceDir = clipboard.sourcePath;

                const mode = clipboard.mode;

                const files = clipboard.files;



                showLoader(`${mode === 'copy' ? 'Copying' : 'Moving'} files...`, `Processing ${files.length} items`);



                try {

                    for (const filename of files) {

                        const sourcePath = sourceDir === '/' ? `/${filename}` : `${sourceDir}/${filename}`;

                        const destPath = destDir === '/' ? `/${filename}` : `${destDir}/${filename}`;



                        if (mode === 'copy') {

                            await ipcRenderer.invoke('ssh:execute', `cp -r "${sourcePath}" "${destPath}"`);

                        } else {

                            await ipcRenderer.invoke('ssh:execute', `mv "${sourcePath}" "${destPath}"`);

                        }

                    }



                    // Clear clipboard after move (not after copy)

                    if (mode === 'cut') {

                        clearClipboard();

                    }



                    loadFiles(currentFilesPath);

                } catch (e) {

                    alert(`Paste Error: ${e.message}`);

                } finally {

                    hideLoader();

                }

            }



            async function deleteSelectedFiles() {

                if (selectedFiles.size === 0) return;



                const count = selectedFiles.size;

                if (!confirm(`Are you sure you want to delete ${count} item(s)? This cannot be undone.`)) return;



                showLoader("Deleting...", `Removing ${count} items`);



                try {

                    for (const filename of selectedFiles) {

                        const fullPath = currentFilesPath === '/' ? `/${filename}` : `${currentFilesPath}/${filename}`;

                        await ipcRenderer.invoke('ssh:execute', `rm -rf "${fullPath}"`);

                    }



                    clearSelection();

                    loadFiles(currentFilesPath);

                } catch (e) {

                    alert(`Delete Error: ${e.message}`);

                } finally {

                    hideLoader();

                }

            }



            function moveSelectedFiles() {

                if (selectedFiles.size === 0) return;



                // Open move modal

                document.getElementById('move-files-list').innerText = Array.from(selectedFiles).join(', ');

                document.getElementById('move-dest-input').value = currentFilesPath;

                document.getElementById('move-modal').classList.remove('hidden');

            }



            function closeMoveModal() {

                document.getElementById('move-modal').classList.add('hidden');

            }



            async function submitMove() {

                const destDir = document.getElementById('move-dest-input').value.trim();

                if (!destDir) {

                    alert('Please enter a destination path');

                    return;

                }



                const files = Array.from(selectedFiles);

                closeMoveModal();



                showLoader("Moving files...", `Moving ${files.length} items to ${destDir}`);



                try {

                    // Create destination if it doesn't exist

                    await ipcRenderer.invoke('ssh:execute', `mkdir -p "${destDir}"`);



                    for (const filename of files) {

                        const sourcePath = currentFilesPath === '/' ? `/${filename}` : `${currentFilesPath}/${filename}`;

                        const destPath = destDir === '/' ? `/${filename}` : `${destDir}/${filename}`;

                        await ipcRenderer.invoke('ssh:execute', `mv "${sourcePath}" "${destPath}"`);

                    }



                    clearSelection();

                    loadFiles(currentFilesPath);

                } catch (e) {

                    alert(`Move Error: ${e.message}`);

                } finally {

                    hideLoader();

                }

            }



            // --- TERMINAL LOGIC ---

            // Cache context to speed up requests

            let cachedServerContext = null;

            let terminalHistory = [];

            let historyIndex = -1;

            let currentWorkingDir = '/home/ubuntu';



            function escapeHtml(text) {

                if (!text) return text;

                return text

                    .replace(/&/g, "&amp;")

                    .replace(/</g, "&lt;")

                    .replace(/>/g, "&gt;")

                    .replace(/"/g, "&quot;")

                    .replace(/'/g, "&#039;");

            }



            function updateTerminalDisplay(val) {

                const display = document.getElementById('term-text-display');

                if (display) display.innerText = val;

                const out = document.getElementById('terminal-output');

                if (out) out.scrollTop = out.scrollHeight;

            }



            async function askAICommand() {

                const input = document.getElementById('ai-command-input');

                const btn = document.getElementById('btn-ask-ai');

                const prompt = input.value.trim();



                if (!prompt) return;



                // UI Loading State

                const originalIcon = btn.innerHTML;

                btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';

                btn.disabled = true;

                input.disabled = true;



                try {

                    // Load History

                    let chatHistory = [];

                    // Removed localStorage persistence for AI command history



                    // Fetch context only if we don't have it

                    if (!cachedServerContext) {

                        try {

                            const ctxRes = await ipcRenderer.invoke('ssh:get-server-context');

                            if (ctxRes.success) cachedServerContext = ctxRes.context;

                        } catch (e) { console.warn("AI context fetch failed", e); }

                    }



                    const res = await ipcRenderer.invoke('ssh:ai-command', {

                        prompt,

                        serverContext: cachedServerContext,

                        chatHistory: chatHistory

                    });



                    if (res.success && res.command) {

                        // Save History

                        chatHistory.push({ role: 'user', text: prompt });

                        chatHistory.push({ role: 'ai', text: res.command });

                        if (chatHistory.length > 40) chatHistory = chatHistory.slice(chatHistory.length - 40);

                        if (chatHistory.length > 40) chatHistory = chatHistory.slice(chatHistory.length - 40);

                        // Removed localStorage.setItem



                        input.value = ''; // Clear input on success

                        showAIConfirmModal(res.command);

                    } else {

                        alert('AI could not generate a command: ' + (res.error || 'Unknown error'));

                    }



                } catch (e) {

                    alert("AI Error: " + e.message);

                } finally {

                    btn.innerHTML = originalIcon;

                    btn.disabled = false;

                    input.disabled = false;

                }

            }



            function showAIConfirmModal(command) {

                const existing = document.getElementById('ai-confirm-modal');

                if (existing) existing.remove();



                const modal = document.createElement('div');

                modal.id = 'ai-confirm-modal';

                modal.className = "fixed inset-0 bg-black/80 z-[100] flex items-center justify-center backdrop-blur-sm fade-in";

                modal.innerHTML = `

                <div class="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden transform scale-100 transition-all">

                    <div class="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex justify-between items-center">

                        <div class="flex items-center gap-3">

                            <div class="bg-white p-2 rounded-lg text-indigo-600 shadow-sm"><i class="fas fa-robot"></i></div>

                            <h3 class="text-indigo-900 font-bold text-lg">AI Suggested Command</h3>

                        </div>

                        <button onclick="this.closest('#ai-confirm-modal').remove()" class="text-gray-400 hover:text-gray-600 transition-colors"><i class="fas fa-times"></i></button>

                    </div>

                    

                    <div class="p-6">

                        <label class="block text-gray-500 text-xs uppercase font-bold mb-2">Command to Run</label>

                        <textarea id="ai-suggested-cmd" readonly class="w-full bg-gray-50 border border-gray-300 text-gray-900 font-mono text-sm rounded-lg p-4 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none h-32 resize-none" spellcheck="false">${command}</textarea>

                        

                        <div class="flex gap-3 mt-6">

                            <button onclick="this.innerHTML = '<i class=\'fas fa-pen mr-2\'></i> Editing...'; const el = document.getElementById('ai-suggested-cmd'); el.removeAttribute('readonly'); el.focus();" class="flex-1 bg-white hover:bg-gray-50 text-gray-700 py-3 rounded-xl font-bold transition-colors border border-gray-300 shadow-sm">

                                <i class="fas fa-edit mr-2 text-gray-500"></i> Edit

                            </button>

                            <button onclick="runAICommand()" class="flex-[2] bg-indigo-600 hover:bg-indigo-700 text-white py-3 rounded-xl font-bold shadow-lg shadow-indigo-200 transition-all active:scale-95">

                                <i class="fas fa-play mr-2"></i> Run Command

                            </button>

                        </div>

                    </div>

                </div>

            `;

                document.body.appendChild(modal);

                setTimeout(() => document.getElementById('ai-suggested-cmd').focus(), 50);

            }



            function runAICommand() {

                const cmd = document.getElementById('ai-suggested-cmd').value.trim();

                const modal = document.getElementById('ai-confirm-modal');

                if (modal) modal.remove();



                if (cmd) {

                    // Determine if we need to switch view

                    if (currentView !== 'terminal') {

                        navigate('terminal');

                        // Small delay to allow DOM to render

                        setTimeout(() => executeTerminalCommand(cmd), 100);

                    } else {

                        executeTerminalCommand(cmd);

                    }

                }

            }



            function handleTerminalKeydown(event) {

                const input = document.getElementById('terminal-input');



                if (event.key === 'Enter') {

                    event.preventDefault();

                    executeTerminalCommand();

                } else if (event.key === 'ArrowUp') {

                    event.preventDefault();

                    if (historyIndex < terminalHistory.length - 1) {

                        historyIndex++;

                        input.value = terminalHistory[terminalHistory.length - 1 - historyIndex];

                        updateTerminalDisplay(input.value);

                    }

                } else if (event.key === 'ArrowDown') {

                    event.preventDefault();

                    if (historyIndex > 0) {

                        historyIndex--;

                        input.value = terminalHistory[terminalHistory.length - 1 - historyIndex];

                        updateTerminalDisplay(input.value);

                    } else if (historyIndex === 0) {

                        historyIndex = -1;

                        input.value = '';

                        updateTerminalDisplay('');

                    }

                }

            }



            async function executeTerminalCommand(cmdArgument = null) {

                const input = document.getElementById('terminal-input');

                // Logic: Use argument if provided (AI), otherwise use input value

                const command = cmdArgument !== null ? cmdArgument : input.value;

                const trimmedCommand = command.trim();



                if (!trimmedCommand) return;



                // Add to history

                terminalHistory.push(trimmedCommand);

                historyIndex = -1;



                // 1. Commit the active line to history (Visual)

                // Note: We use the raw command to show exactly what was typed (spaces etc)

                let serverName = 'server';

                if (connectedServerData) {

                    // For agent connections, host starts with "agent:", so use name instead

                    if (connectedServerData.mode === 'agent' || (connectedServerData.host && connectedServerData.host.startsWith('agent:'))) {

                        serverName = connectedServerData.name || 'server';

                    } else {

                        // For SSH connections, use host or name

                        serverName = connectedServerData.host || connectedServerData.name || 'server';

                    }

                }

                const userHost = `ubuntu@${serverName}`;

                const promptHTML = `

                <div class="flex flex-wrap break-all items-center mb-0">

                    <span class="text-green-500 font-bold mr-0">${userHost}</span>

                    <span class="text-white mr-1">:</span>

                    <span class="text-blue-500 font-bold mr-1">~</span>

                    <span class="text-white mr-2">$</span>

                    <span class="text-white whitespace-pre-wrap">${escapeHtml(command)}</span>

                </div>`;

                appendToTerminal(promptHTML);



                // 2. Clear Input & Display (Reset active line)

                if (input) input.value = '';

                if (typeof updateTerminalDisplay === 'function') updateTerminalDisplay('');



                // Handle built-in commands

                if (trimmedCommand === 'clear') {

                    clearTerminal();

                    return;

                }

                // Handle 'history' command locally

                if (trimmedCommand === 'history') {

                    const historyHtml = terminalHistory.map((c, i) =>

                        `<div class="pl-2"><span class="text-gray-500 w-8 inline-block text-right mr-4">${i + 1}</span><span class="text-gray-300 whitespace-pre-wrap">${escapeHtml(c)}</span></div>`

                    ).join('');

                    const outHtml = `<div class="text-gray-300 font-mono text-sm mt-1 whitespace-pre-wrap pl-4 border-l-2 border-gray-800 ml-1">${historyHtml}</div>`;

                    appendToTerminal(outHtml);

                    return;

                }



                try {

                    // Execute command

                    // We chain: cd currentDir && command && pwd

                    let fullCommand = `cd "${currentWorkingDir}" && ${trimmedCommand}`;



                    if (trimmedCommand.startsWith('cd')) {

                        fullCommand = `cd "${currentWorkingDir}" && ${trimmedCommand} && pwd`;

                    }



                    const res = await ipcRenderer.invoke('ssh:execute', fullCommand);



                    if (res.success) {

                        // Update current working directory if it was a cd command

                        if (trimmedCommand.startsWith('cd') && res.data.stdout) {

                            const lines = res.data.stdout.trim().split('\n');

                            const newPath = lines[lines.length - 1].trim();

                            if (newPath.startsWith('/')) {

                                currentWorkingDir = newPath;

                                // Real terminals show nothing on successful cd

                            }

                        } else if (res.data.stdout) {

                            // Standard Output

                            const outHtml = `<div class="text-gray-300 whitespace-pre-wrap break-all">${escapeHtml(res.data.stdout)}</div>`;

                            appendToTerminal(outHtml);

                        }



                        if (res.data.stderr) {

                            const errHtml = `<div class="text-yellow-400 whitespace-pre-wrap break-all">${escapeHtml(res.data.stderr)}</div>`;

                            appendToTerminal(errHtml);

                        }

                    } else {

                        const errHtml = `<div class="text-red-400 whitespace-pre-wrap break-all">Error: ${escapeHtml(res.error)}</div>`;

                        appendToTerminal(errHtml);

                    }



                    // Refresh files view if proper

                    if (['rm', 'mkdir', 'touch', 'cp', 'mv', 'tar', 'unzip', 'git'].some(cmd => trimmedCommand.startsWith(cmd))) {

                        if (currentView === 'files') {

                            loadFiles(currentFilesPath);

                        }

                    }



                } catch (e) {

                    appendToTerminal(`<div class="text-red-400 whitespace-pre-wrap">Exception: ${e.message}</div>`);

                }

            }



            function appendToTerminal(html) {

                const history = document.getElementById('term-history');

                const output = document.getElementById('terminal-output');



                if (history) {

                    const line = document.createElement('div');

                    // No bottom margin for tight terminal feel

                    line.className = "mb-0";

                    line.innerHTML = html;

                    history.appendChild(line);



                    if (output) output.scrollTop = output.scrollHeight;

                }

            }



            function clearTerminal() {

                const history = document.getElementById('term-history');

                if (history) history.innerHTML = '';

            }



            function initTerminalView() {

                // Update the terminal prompt with the correct server name

                const activeLine = document.getElementById('active-line');

                if (activeLine && connectedServerData) {

                    let serverName = 'server';



                    // For agent connections, host starts with "agent:", so use name instead

                    if (connectedServerData.mode === 'agent' || (connectedServerData.host && connectedServerData.host.startsWith('agent:'))) {

                        serverName = connectedServerData.name || 'server';

                    } else {

                        // For SSH connections, use host or name

                        serverName = connectedServerData.host || connectedServerData.name || 'server';

                    }



                    activeLine.innerHTML = `

                        <span class="text-green-500 font-bold mr-0">ubuntu@${serverName}</span>

                        <span class="text-white mr-1">:</span>

                        <span class="text-blue-500 font-bold mr-1">~</span>

                        <span class="text-white mr-2">$</span>

                        <span id="term-text-display" class="text-white whitespace-pre-wrap break-all"></span><span class="term-cursor"></span>

                    `;

                }

            }

            window.initTerminalView = initTerminalView;



            function escapeHtml(text) {

                if (!text) return text;

                return text

                    .replace(/&/g, "&amp;")

                    .replace(/</g, "&lt;")

                    .replace(/>/g, "&gt;")

                    .replace(/"/g, "&quot;")

                    .replace(/'/g, "&#039;");

            }



            document.addEventListener('click', () => {

                const contextMenu = document.getElementById('context-menu');

                if (contextMenu) contextMenu.classList.add('hidden');

            });



            // Context Menu Actions

            function ctxOpen() {

                if (!contextMenuTarget) return;

                const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + contextMenuTarget.name;

                if (contextMenuTarget.isDir) {

                    loadFiles(fullPath);

                } else {

                    if (!contextMenuTarget.isBinary) openEditor(fullPath, contextMenuTarget.name);

                }

            }



            function ctxRename() {

                if (!contextMenuTarget) return;

                const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + contextMenuTarget.name;

                openRenameModal(fullPath, contextMenuTarget.name);

            }



            function ctxDelete() {

                if (!contextMenuTarget) return;

                const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + contextMenuTarget.name;

                deleteFile(fullPath);

            }



            // --- COMPRESS MODAL LOGIC ---

            let compressTarget = null; // { sourcePath, sourceName }



            function ctxZip() {

                if (!contextMenuTarget) return;

                const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + contextMenuTarget.name;



                compressTarget = {

                    sourcePath: fullPath,

                    sourceName: contextMenuTarget.name

                };



                // Set default values

                document.getElementById('compress-source').innerText = contextMenuTarget.name;

                document.getElementById('compress-dest-input').value = currentFilesPath;

                document.getElementById('compress-filename').value = contextMenuTarget.name + '.tar.gz';

                document.getElementById('compress-modal').classList.remove('hidden');

            }



            function closeCompressModal() {

                document.getElementById('compress-modal').classList.add('hidden');

                compressTarget = null;

            }



            async function submitCompress() {

                if (!compressTarget) return;



                const destDir = document.getElementById('compress-dest-input').value.trim();

                const zipName = document.getElementById('compress-filename').value.trim() || (compressTarget.sourceName + '.tar.gz');

                const outputPath = destDir === '/' ? `/${zipName}` : `${destDir}/${zipName}`;

                const sourcePath = compressTarget.sourcePath; // Save before closing



                closeCompressModal();



                try {

                    showLoader("Compressing...", `Creating ${zipName}`);



                    // Always create destination folder if it doesn't exist

                    await ipcRenderer.invoke('ssh:execute', `mkdir -p "${destDir}"`);



                    const res = await ipcRenderer.invoke('ssh:zip-file', {

                        targetPath: sourcePath,

                        outputPath

                    });



                    if (res.success) {

                        loadFiles(destDir);

                    } else {

                        alert("Compression failed: " + res.error);

                    }

                } catch (e) {

                    alert("Zip Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            // --- EXTRACT MODAL LOGIC ---

            let extractTarget = null; // { archivePath, archiveName }



            function ctxUnzip() {

                if (!contextMenuTarget) return;

                const fullPath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + contextMenuTarget.name;



                extractTarget = {

                    archivePath: fullPath,

                    archiveName: contextMenuTarget.name

                };



                // Set default destination to current path

                document.getElementById('extract-dest-input').value = currentFilesPath;

                document.getElementById('extract-filename').innerText = contextMenuTarget.name;

                document.getElementById('extract-modal').classList.remove('hidden');

            }



            function closeExtractModal() {

                document.getElementById('extract-modal').classList.add('hidden');

                extractTarget = null;

            }



            async function submitExtract() {

                if (!extractTarget) return;



                const destDir = document.getElementById('extract-dest-input').value.trim();

                const archivePath = extractTarget.archivePath; // Save before closing



                closeExtractModal();



                try {

                    showLoader("Extracting...", `Extracting to ${destDir}`);



                    // Always create destination folder if it doesn't exist

                    await ipcRenderer.invoke('ssh:execute', `mkdir -p "${destDir}"`);



                    const res = await ipcRenderer.invoke('ssh:unzip-file', {

                        archivePath: archivePath,

                        destDir

                    });



                    if (res.success) {

                        loadFiles(destDir);

                    } else {

                        alert("Extraction failed: " + res.error);

                    }

                } catch (e) {

                    alert("Unzip Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }
