
            // --- APPS VIEW LOGIC ---

            async function loadApps() {

                const container = document.getElementById('app-list-container');

                if (!container) return;



                // Loader

                container.innerHTML = getSkeletonHtml('card-grid');



                if (!isConnected) {

                    container.innerHTML = `

    <div class="text-center py-12 bg-white border border-dashed border-gray-300 rounded-xl">

        <div class="text-gray-400 mb-3"><i class="fas fa-plug text-4xl"></i></div>

        <h3 class="text-lg font-medium text-gray-900">Not Connected</h3>

        <p class="text-gray-500 text-sm">Please connect to a server to view applications.</p>

    </div>

    `;

                    return;

                }



                try {

                    const res = await ipcRenderer.invoke('ssh:list-apps');



                    if (!res.success) {

                        container.innerHTML = `

    <div class="p-6 bg-red-50 text-red-600 rounded-xl border border-red-100 text-center">

        Failed to load apps: ${res.error}

    </div>

    `;

                        return;

                    }



                    const apps = res.apps || [];



                    if (apps.length === 0) {

                        container.innerHTML = `

    <div class="text-center py-12 bg-white border border-dashed border-gray-300 rounded-xl">

        <div class="text-gray-400 mb-3"><i class="fas fa-cube text-4xl"></i></div>

        <h3 class="text-lg font-medium text-gray-900">No Apps Found</h3>

        <p class="text-gray-500 text-sm mb-4">No PM2 or Systemd services managed by Devyntra were found.</p>

        <button onclick="navigate('deploy')"

            class="bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2 rounded-lg font-bold shadow-sm transition-colors">

            <i class="fas fa-rocket mr-2"></i>Deploy New App

        </button>

    </div>

    `;

                        return;

                    }



                    // Get Server IP

                    // Get Server IP

                    let host = connectedServerData ? connectedServerData.host : 'localhost';



                    // Resolve actual IP if connected via Agent or Localhost alias

                    if (host.startsWith('agent:') || host === 'localhost' || host === '127.0.0.1') {

                        try {

                            const ipRes = await ipcRenderer.invoke('ssh:execute', "hostname -I | awk '{print $1}'");

                            if (ipRes.success && ipRes.data.stdout) {

                                const resolvedIp = ipRes.data.stdout.trim();

                                if (resolvedIp) host = resolvedIp;

                            }

                        } catch (e) {

                            console.warn('Failed to resolve server IP for app links:', e);

                        }

                    }



                    let html = `<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">`;



                    apps.forEach(app => {

                        const isActive = app.status === 'running' || app.status === 'online';

                        const statusColor = isActive ? 'green' : 'red';

                        const link = `http://${host}:${app.port}`;

                        const safeId = (app.id || app.name || '').replace(/'/g, "\\'");

                        const safeName = (app.name || 'App').replace(/'/g, "\\'");

                        const safeManager = app.manager || 'pm2';



                        html += `

        <div class="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md transition-shadow group relative">

            <div class="flex items-center justify-between mb-4">

                <div class="flex items-center space-x-3">

                    <div class="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">

                        <i class="fas fa-box"></i>

                    </div>

                    <div>

                        <h3 class="font-bold text-gray-900 truncate max-w-[150px]" title="${app.name}">${app.name}</h3>

                        <span

                            class="text-xs px-2 py-0.5 bg-${statusColor}-100 text-${statusColor}-700 rounded-full font-bold flex items-center w-fit">

                            <span class="w-1.5 h-1.5 bg-${statusColor}-500 rounded-full mr-1"></span>

                            ${app.status ? app.status.toUpperCase() : 'UNKNOWN'}

                        </span>

                    </div>

                </div>

                <div class="text-right">

                    <div class="text-xs text-gray-400">Port</div>

                    <div class="font-mono font-bold text-gray-700">${app.port || '?'}</div>

                </div>

            </div>



            <div class="text-xs text-gray-500 mb-4 space-y-2">

                <div class="flex justify-between"><span>Manager:</span> <span

                        class="font-medium text-gray-700">${app.manager || 'PM2'}</span></div>

                <div class="flex justify-between"><span>Path:</span> <span

                        class="font-mono text-gray-700 truncate max-w-[180px]" title="${app.path}">${app.path || '~/apps/' + app.name}</span>

                </div>



                ${(app.manager === 'systemd' || app.manager === 'pm2') ? `

                <div class="flex justify-between items-center pt-2">

                    <span>Auto-Restart (Boot):</span>

                    <label class="relative inline-flex items-center cursor-pointer">

                        <input type="checkbox" class="sr-only peer"

                            onchange="manageApp('${safeId}', this.checked ? 'enable-boot' : 'disable-boot', '${safeManager}')"

                            ${app.autostart ? 'checked' : ''}>

                        <div

                            class="w-9 h-5 bg-gray-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600">

                        </div>

                    </label>

                </div>

                ` : ''}

            </div>



            <div class="flex items-center space-x-2 pt-4 border-t border-gray-100">

                <a href="${link}" target="_blank"

                    class="flex-1 text-center bg-indigo-50 text-indigo-700 py-2 rounded-lg text-sm font-bold hover:bg-indigo-100 transition-colors">

                    <i class="fas fa-external-link-alt mr-1"></i> Open

                </a>

                

                ${isActive ? `

                <button onclick="manageApp('${safeId}', 'restart', '${safeManager}')" class="w-10 h-10 flex items-center justify-center text-orange-600 bg-orange-50 hover:bg-orange-100 rounded-lg transition-colors" title="Restart">

                     <i class="fas fa-sync-alt"></i>

                </button>

                <button onclick="manageApp('${safeId}', 'stop', '${safeManager}')" class="w-10 h-10 flex items-center justify-center text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors" title="Stop">

                     <i class="fas fa-stop"></i>

                </button>

                ` : `

                <button onclick="manageApp('${safeId}', 'start', '${safeManager}')" class="w-10 h-10 flex items-center justify-center text-green-600 bg-green-50 hover:bg-green-100 rounded-lg transition-colors" title="Start">

                     <i class="fas fa-play"></i>

                </button>

                `}



                <button onclick="manageApp('${safeId}', 'delete', '${safeManager}')"

                    class="w-10 h-10 flex items-center justify-center text-gray-400 hover:text-red-600 hover:bg-gray-100 rounded-lg transition-colors"

                    title="Delete">

                    <i class="fas fa-trash-alt"></i>

                </button>

            </div>

        </div>

        `;

                    });



                    html += `</div>`;

                    container.innerHTML = html;



                } catch (e) {

                    container.innerHTML = `<div class="text-red-500 p-4">Error: ${e.message}</div>`;

                }

            }



            async function manageApp(name, action, manager) {

                if (!confirm(`Are you sure you want to ${action} app "${name}"?`)) return;



                showLoader("Processing...", `${action.toUpperCase()} ${name}...`);

                try {

                    // Determine PM2 vs Systemd

                    const isPm2 = (!manager || manager.toLowerCase() === 'pm2');



                    // Call backend

                    const res = await ipcRenderer.invoke('ssh:manage-app', {

                        id: name,

                        action,

                        isPm2

                    });



                    if (res.success) {

                        // Refresh

                        loadApps();

                    } else {

                        alert(`Action failed: ${res.error}`);

                    }

                } catch (e) {

                    alert(`Error: ${e.message}`);

                } finally {

                    hideLoader();

                }

            }



            // --- SECURITY VIEW LOGIC ---

            async function toggleFirewall(enable) {

                if (!confirm(`Are you sure you want to ${enable ? 'ENABLE' : 'DISABLE'} the firewall?`)) return;



                showLoader(enable ? "Enabling Firewall..." : "Disabling Firewall...", "Configuring UFW rules...");

                try {

                    const res = await ipcRenderer.invoke('ssh:toggle-firewall', enable);

                    if (res.success) {

                        loadSecurity(); // Refresh

                    } else {

                        alert('Action failed: ' + res.error);

                        loadSecurity(); // Reset toggle state on failure

                    }

                } catch (e) { alert('Error: ' + e.message); loadSecurity(); }

                finally { hideLoader(); }

            }



            async function installSSL() {

                const domain = prompt("Enter the domain name for SSL (e.g. example.com):\nMake sure A records are pointed to this server IP first.");

                if (!domain) return;



                showLoader("Installing SSL...", "running certbot --nginx...");

                try {

                    const res = await ipcRenderer.invoke('ssh:install-ssl', domain);

                    if (res.success) {

                        alert("SSL Certificate Installed Successfully!");

                        loadSecurity(); // Refresh

                    } else {

                        alert('Installation failed. Check logs or ensure Nginx is configured for this domain.\n\nError: ' + res.error);

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }

            window.installSSL = installSSL;

            window.toggleFirewall = toggleFirewall;



            async function loadSecurity() {

                const container = document.getElementById('security-container');

                if (!container) return;



                container.innerHTML = getSkeletonHtml('card-grid');



                try {

                    const res = await ipcRenderer.invoke('ssh:get-security-status');



                    if (!res.success) {

                        container.innerHTML = `<div class="text-red-500 bg-red-50 p-6 rounded-xl border border-red-100 text-center"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">Failed to load security status</p><p class="text-xs mt-1">${res.error}</p></div>`;

                        return;

                    }



                    const { firewall, ssl } = res;

                    const isFwActive = (firewall.status === 'active');



                    container.innerHTML = `

                    <!-- Overview Stats -->

                    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">

                        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

                            <div class="flex items-center gap-3">

                                <div class="w-9 h-9 ${isFwActive ? 'bg-emerald-50' : 'bg-red-50'} rounded-lg flex items-center justify-center ${isFwActive ? 'text-emerald-600' : 'text-red-600'}"><i class="fas fa-shield-alt"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Firewall</p>

                                    <p class="text-lg font-black ${isFwActive ? 'text-emerald-600' : 'text-red-600'} leading-tight">${isFwActive ? 'Active' : 'Inactive'}</p>

                                </div>

                            </div>

                        </div>

                        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

                            <div class="flex items-center gap-3">

                                <div class="w-9 h-9 bg-amber-50 rounded-lg flex items-center justify-center text-amber-600"><i class="fas fa-lock"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">SSL Certificates</p>

                                    <p class="text-lg font-black text-gray-900 leading-tight">${ssl.length}</p>

                                </div>

                            </div>

                        </div>

                        <div class="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">

                            <div class="flex items-center gap-3">

                                <div class="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center text-blue-600"><i class="fas fa-list-ul"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active Rules</p>

                                    <p class="text-lg font-black text-gray-900 leading-tight">${firewall.rules.length}</p>

                                </div>

                            </div>

                        </div>

                    </div>



                    <!-- Side by Side Layout -->

                    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">

                        

                        <!-- Firewall Section -->

                        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col">

                            <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">

                                <div class="flex items-center gap-3">

                                    <div class="w-9 h-9 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">

                                        <i class="fas fa-shield-alt"></i>

                                    </div>

                                    <div>

                                        <h3 class="text-sm font-black text-gray-900">Firewall (UFW)</h3>

                                        <p class="text-[10px] text-gray-500 font-medium">Manage traffic rules</p>

                                    </div>

                                </div>

                                <div class="flex items-center gap-3">

                                    <label class="flex items-center gap-2 cursor-pointer bg-white px-3 py-1.5 rounded-lg border border-gray-200 shadow-sm">

                                        <span class="text-[9px] font-black uppercase tracking-wider ${isFwActive ? 'text-emerald-600' : 'text-gray-400'}">${isFwActive ? 'Enabled' : 'Disabled'}</span>

                                        <input type="checkbox" class="sr-only peer" ${isFwActive ? 'checked' : ''} onchange="toggleFirewall(this.checked)">

                                        <div class="relative w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>

                                    </label>

                                </div>

                            </div>

                            

                            <div class="flex-1 overflow-y-auto" style="max-height: 400px;">

                                <table class="w-full text-sm">

                                    <thead class="sticky top-0 bg-white">

                                        <tr class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">

                                            <th class="text-left py-2.5 pl-4">Port</th>

                                            <th class="text-left py-2.5">Action</th>

                                            <th class="text-left py-2.5">Source</th>

                                            <th class="text-right py-2.5 pr-4">Actions</th>

                                        </tr>

                                    </thead>

                                    <tbody class="divide-y divide-gray-50">

                                        ${firewall.rules.length === 0 ?

                            `<tr><td colspan="4" class="p-6 text-center text-gray-400"><i class="fas fa-inbox text-xl mb-2 block opacity-30"></i><p class="text-xs font-bold">No active firewall rules</p></td></tr>` :

                            firewall.rules.map(rule => `

                                            <tr class="group hover:bg-gray-50/50 transition-colors">

                                                <td class="px-4 py-3"><span class="font-mono text-xs font-black text-gray-900 bg-gray-100 px-2 py-0.5 rounded border border-gray-200">${rule.port}</span></td>

                                                <td class="px-3 py-3"><span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-bold ${rule.action.toLowerCase() === 'allow' ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-red-50 text-red-700 border border-red-100'}"><i class="fas fa-${rule.action.toLowerCase() === 'allow' ? 'check' : 'times'} text-[8px]"></i>${rule.action}</span></td>

                                                <td class="py-3 text-xs text-gray-500 font-mono">${rule.from}</td>

                                                <td class="py-3 pr-4 text-right">

                                                    <div class="flex items-center justify-end gap-1">

                                                        <button onclick="editFirewallRule('${rule.port}', '${rule.action}', '${rule.from}')" class="opacity-0 group-hover:opacity-100 px-2 py-1 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-md text-[9px] font-bold transition-all border border-blue-100" title="Edit rule">

                                                            <i class="fas fa-edit text-[8px]"></i>

                                                        </button>

                                                        <button onclick="deleteFirewallRule('${rule.port}')" class="opacity-0 group-hover:opacity-100 px-2 py-1 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-md text-[9px] font-bold transition-all border border-red-100" title="Remove rule">

                                                            <i class="fas fa-trash text-[8px]"></i>

                                                        </button>

                                                    </div>

                                                </td>

                                            </tr>

                                        `).join('')}

                                    </tbody>

                                </table>

                            </div>

                            

                            <div class="px-5 py-3 border-t border-gray-100 bg-gray-50/30 flex justify-between items-center">

                                <p class="text-[10px] text-gray-400 font-medium">Unlisted ports are blocked by default</p>

                                <button onclick="openAddFirewallRuleModal()" class="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-600 hover:text-white rounded-lg text-[9px] font-black uppercase tracking-wider transition-all border border-indigo-100">

                                    <i class="fas fa-plus mr-1"></i>Add Rule

                                </button>

                            </div>

                        </div>



                        <!-- SSL Certificates Section -->

                        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col">

                            <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">

                                <div class="flex items-center gap-3">

                                    <div class="w-9 h-9 bg-gradient-to-br from-amber-500 to-orange-600 rounded-xl flex items-center justify-center text-white shadow-sm">

                                        <i class="fas fa-lock"></i>

                                    </div>

                                    <div>

                                        <h3 class="text-sm font-black text-gray-900">SSL Certificates</h3>

                                        <p class="text-[10px] text-gray-500 font-medium">Let's Encrypt certificates</p>

                                    </div>

                                </div>

                                <button onclick="openInstallSSLModal()" class="px-3 py-2 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all shadow-sm active:scale-95">

                                    <i class="fas fa-plus mr-1.5"></i>Install SSL

                                </button>

                            </div>

                            

                            <div class="flex-1 overflow-y-auto" style="max-height: 400px;">

                                ${ssl.length === 0 ?

                            `<div class="p-8 text-center">

                                    <div class="w-14 h-14 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-3"><i class="fas fa-lock text-xl text-gray-300"></i></div>

                                    <p class="font-bold text-gray-500 text-sm">No SSL Certificates Found</p>

                                    <p class="text-xs text-gray-400 mt-1">Click "Install SSL" to set up a Let's Encrypt certificate</p>

                                </div>` :

                            `<table class="w-full text-sm">

                                    <thead class="sticky top-0 bg-white">

                                        <tr class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">

                                            <th class="text-left py-2.5 pl-4">Domain</th>

                                            <th class="text-left py-2.5">Expiry</th>

                                            <th class="text-left py-2.5">Days Left</th>

                                            <th class="text-right py-2.5 pr-4">Actions</th>

                                        </tr>

                                    </thead>

                                    <tbody class="divide-y divide-gray-50">

                                        ${ssl.map(cert => `

                                        <tr class="group hover:bg-gray-50/50 transition-colors">

                                            <td class="px-4 py-3">

                                                <div class="flex items-center gap-2">

                                                    <i class="fas fa-globe text-gray-400 text-[10px]"></i>

                                                    <span class="font-bold text-gray-900 text-xs">${cert.domain}</span>

                                                </div>

                                            </td>

                                            <td class="py-3 text-xs text-gray-500">${cert.expiry}</td>

                                            <td class="py-3"><span class="font-mono text-xs font-bold ${cert.daysLeft <= 7 ? 'text-red-600' : cert.daysLeft <= 30 ? 'text-amber-600' : 'text-gray-600'}">${cert.daysLeft}d</span></td>

                                            <td class="py-3 pr-4 text-right">

                                                <div class="flex items-center justify-end gap-1">

                                                    <button onclick="renewSSLCert('${cert.domain}')" class="opacity-0 group-hover:opacity-100 px-2 py-1 bg-emerald-50 text-emerald-600 hover:bg-emerald-600 hover:text-white rounded-md text-[9px] font-bold transition-all border border-emerald-100" title="Renew certificate">

                                                        <i class="fas fa-sync text-[8px]"></i>

                                                    </button>

                                                    <button onclick="deleteSSLCert('${cert.domain}')" class="opacity-0 group-hover:opacity-100 px-2 py-1 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-md text-[9px] font-bold transition-all border border-red-100" title="Remove certificate">

                                                        <i class="fas fa-trash text-[8px]"></i>

                                                    </button>

                                                </div>

                                            </td>

                                        </tr>

                                        `).join('')}

                                    </tbody>

                                </table>`}

                            </div>

                        </div>

                    </div>

                `;



                } catch (e) {

                    container.innerHTML = `<div class="text-red-500 bg-red-50 p-6 rounded-xl border border-red-100 text-center"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">Error</p><p class="text-xs mt-1">${e.message}</p></div>`;

                }

            }



            async function openAddFirewallRuleModal() {

                const modal = document.createElement('div');

                modal.id = 'firewall-rule-modal';

                modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6';

                modal.innerHTML = `

                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100">

                        <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">

                            <h3 class="font-bold text-gray-900">Add Firewall Rule</h3>

                            <button onclick="document.getElementById('firewall-rule-modal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>

                        </div>

                        <div class="p-6 space-y-4">

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Port or Service</label>

                                <input type="text" id="fw-port-input" placeholder="e.g., 80, 443, ssh, http" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all">

                                <p class="text-xs text-gray-400 mt-1">Enter port number (80, 443) or service name (ssh, http)</p>

                            </div>

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Action</label>

                                <select id="fw-action-input" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 bg-white">

                                    <option value="allow">Allow</option>

                                    <option value="deny">Deny</option>

                                </select>

                            </div>

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Source IP (Optional)</label>

                                <input type="text" id="fw-source-input" placeholder="e.g., 192.168.1.0/24 or leave empty for any" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all">

                                <p class="text-xs text-gray-400 mt-1">Leave empty to allow from any source</p>

                            </div>

                        </div>

                        <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">

                            <button onclick="document.getElementById('firewall-rule-modal').remove()" class="px-4 py-2 text-gray-500 hover:bg-gray-200 rounded-lg font-bold text-xs transition-colors">Cancel</button>

                            <button onclick="submitFirewallRule()" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-lg shadow-indigo-200 transition-all">Add Rule</button>

                        </div>

                    </div>

                `;

                document.body.appendChild(modal);

                document.getElementById('fw-port-input').focus();

            }



            async function submitFirewallRule() {

                const port = document.getElementById('fw-port-input').value.trim();

                const action = document.getElementById('fw-action-input').value;

                const source = document.getElementById('fw-source-input').value.trim();



                if (!port) {

                    alert('Please enter a port or service name');

                    return;

                }



                document.getElementById('firewall-rule-modal').remove();



                let command = `sudo ufw ${action} ${port}`;

                if (source) {

                    command = `sudo ufw ${action} from ${source} to any port ${port}`;

                }



                showLoader('Adding Rule...', `Configuring firewall rule for ${port}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', { command });

                    if (res.success) {

                        alert('Firewall rule added successfully!');

                        loadSecurity();

                    } else {

                        alert('Failed to add rule: ' + (res.error || res.output));

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }



            async function editFirewallRule(port, action, from) {

                const modal = document.createElement('div');

                modal.id = 'firewall-rule-modal';

                modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6';

                modal.innerHTML = `

                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100">

                        <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">

                            <h3 class="font-bold text-gray-900">Edit Firewall Rule</h3>

                            <button onclick="document.getElementById('firewall-rule-modal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>

                        </div>

                        <div class="p-6 space-y-4">

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Port or Service</label>

                                <input type="text" id="fw-port-input" value="${port}" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all">

                            </div>

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Action</label>

                                <select id="fw-action-input" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 bg-white">

                                    <option value="allow" ${action.toLowerCase() === 'allow' ? 'selected' : ''}>Allow</option>

                                    <option value="deny" ${action.toLowerCase() === 'deny' ? 'selected' : ''}>Deny</option>

                                </select>

                            </div>

                            <p class="text-xs text-gray-400 bg-amber-50 border border-amber-200 rounded-lg p-3">

                                <i class="fas fa-info-circle mr-1"></i>

                                To edit, we'll delete the old rule and create a new one

                            </p>

                        </div>

                        <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">

                            <button onclick="document.getElementById('firewall-rule-modal').remove()" class="px-4 py-2 text-gray-500 hover:bg-gray-200 rounded-lg font-bold text-xs transition-colors">Cancel</button>

                            <button onclick="submitEditFirewallRule('${port}')" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-lg shadow-indigo-200 transition-all">Update Rule</button>

                        </div>

                    </div>

                `;

                document.body.appendChild(modal);

            }



            async function submitEditFirewallRule(oldPort) {

                const newPort = document.getElementById('fw-port-input').value.trim();

                const action = document.getElementById('fw-action-input').value;



                if (!newPort) {

                    alert('Please enter a port or service name');

                    return;

                }



                document.getElementById('firewall-rule-modal').remove();



                showLoader('Updating Rule...', 'Modifying firewall configuration');

                try {

                    // Delete old rule

                    await ipcRenderer.invoke('ssh:exec', { command: `sudo ufw delete allow ${oldPort}` });

                    await ipcRenderer.invoke('ssh:exec', { command: `sudo ufw delete deny ${oldPort}` });



                    // Add new rule

                    const res = await ipcRenderer.invoke('ssh:exec', { command: `sudo ufw ${action} ${newPort}` });

                    if (res.success) {

                        alert('Firewall rule updated successfully!');

                        loadSecurity();

                    } else {

                        alert('Failed to update rule: ' + (res.error || res.output));

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }



            async function deleteFirewallRule(port) {

                if (!confirm(`Delete firewall rule for port ${port}?`)) return;

                showLoader('Removing Rule...', `Deleting rule for port ${port}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', { command: `sudo ufw delete allow ${port}` });

                    if (res.success) {

                        alert('Rule deleted successfully.');

                        loadSecurity();

                    } else {

                        alert('Failed to delete rule: ' + (res.error || res.output));

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }



            async function openInstallSSLModal() {

                const modal = document.createElement('div');

                modal.id = 'ssl-install-modal';

                modal.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6';

                modal.innerHTML = `

                    <div class="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-gray-100">

                        <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50 rounded-t-2xl">

                            <h3 class="font-bold text-gray-900">Install SSL Certificate</h3>

                            <button onclick="document.getElementById('ssl-install-modal').remove()" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>

                        </div>

                        <div class="p-6 space-y-4">

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Domain Name</label>

                                <input type="text" id="ssl-domain-input" placeholder="example.com" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all">

                                <p class="text-xs text-gray-400 mt-1">Enter the domain name (without www)</p>

                            </div>

                            <div>

                                <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Email Address</label>

                                <input type="email" id="ssl-email-input" placeholder="admin@example.com" class="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all">

                                <p class="text-xs text-gray-400 mt-1">For renewal and security notices</p>

                            </div>

                            <div class="bg-blue-50 border border-blue-200 rounded-lg p-3">

                                <p class="text-xs text-blue-700 font-semibold mb-2"><i class="fas fa-info-circle mr-1"></i>Prerequisites:</p>

                                <ul class="text-xs text-blue-600 space-y-1 ml-4 list-disc">

                                    <li>Domain DNS A record points to this server</li>

                                    <li>Nginx is installed and configured</li>

                                    <li>Port 80 and 443 are open</li>

                                </ul>

                            </div>

                        </div>

                        <div class="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3 rounded-b-2xl">

                            <button onclick="document.getElementById('ssl-install-modal').remove()" class="px-4 py-2 text-gray-500 hover:bg-gray-200 rounded-lg font-bold text-xs transition-colors">Cancel</button>

                            <button onclick="submitInstallSSL()" class="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold text-xs shadow-lg shadow-indigo-200 transition-all">Install Certificate</button>

                        </div>

                    </div>

                `;

                document.body.appendChild(modal);

                document.getElementById('ssl-domain-input').focus();

            }



            async function submitInstallSSL() {

                const domain = document.getElementById('ssl-domain-input').value.trim();

                const email = document.getElementById('ssl-email-input').value.trim();



                if (!domain) {

                    alert('Please enter a domain name');

                    return;

                }



                if (!email) {

                    alert('Please enter an email address');

                    return;

                }



                document.getElementById('ssl-install-modal').remove();



                showLoader('Installing SSL Certificate...', 'Running certbot, this may take a few minutes');

                try {

                    const command = `sudo certbot --nginx -d ${domain} --non-interactive --agree-tos --email ${email}`;

                    const res = await ipcRenderer.invoke('ssh:exec', { command });

                    if (res.success) {

                        alert('SSL Certificate installed successfully!');

                        loadSecurity();

                    } else {

                        alert('Installation failed. Ensure prerequisites are met.\n\nError: ' + (res.error || res.output));

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }



            async function renewSSLCert(domain) {

                if (!confirm(`Renew SSL certificate for ${domain}?`)) return;

                showLoader('Renewing Certificate...', `Renewing SSL for ${domain}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', { command: `sudo certbot renew --cert-name ${domain}` });

                    if (res.success) {

                        alert('Certificate renewed successfully!');

                        loadSecurity();

                    } else {

                        alert('Failed to renew certificate: ' + (res.error || res.output));

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }



            async function deleteSSLCert(domain) {

                if (!confirm(`Delete SSL certificate for ${domain}?\n\nThis will remove the certificate but not the Nginx configuration.`)) return;

                showLoader('Removing Certificate...', `Deleting SSL for ${domain}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', { command: `sudo certbot delete --cert-name ${domain} --non-interactive` });

                    if (res.success) {

                        alert('Certificate deleted successfully.');

                        loadSecurity();

                    } else {

                        alert('Failed to delete certificate: ' + (res.error || res.output));

                    }

                } catch (e) { alert('Error: ' + e.message); }

                finally { hideLoader(); }

            }



            async function addFirewallRule() {

                openAddFirewallRuleModal();

            }



            async function installSSL() {

                openInstallSSLModal();

            }



            // --- MONITORING DASHBOARD LOGIC ---

            let monInterval = null;

            let monPaused = false;

            let monIntervalMs = 3000;

            const monHistory = {

                cpu: Array(60).fill(0),

                ram: Array(60).fill(0),

                netIn: Array(60).fill(0),

                netOut: Array(60).fill(0),

                diskR: Array(60).fill(0),

                diskW: Array(60).fill(0)

            };

            const MON_MAX_POINTS = 60;

            let monPrevNet = null;

            let monPrevDisk = null;



            function formatBytes(bytes, decimals = 1) {

                if (!bytes || bytes === 0) return '0 B';

                const k = 1024;

                const dm = decimals < 0 ? 0 : decimals;

                const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];

                const i = Math.floor(Math.log(bytes) / Math.log(k));

                return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];

            }



            function formatBytesRate(bytes) {

                if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB/s';

                if (bytes > 1024) return (bytes / 1024).toFixed(1) + ' KB/s';

                return bytes.toFixed(0) + ' B/s';

            }



            function stopMonitoring() {

                if (monInterval) { clearInterval(monInterval); monInterval = null; }

            }



            function monitoringPause() {

                monPaused = !monPaused;

                const btn = document.getElementById('mon-pause-btn');

                if (btn) btn.innerHTML = monPaused

                    ? '<i class="fas fa-play mr-1"></i>Resume'

                    : '<i class="fas fa-pause mr-1"></i>Pause';

                const indicator = document.getElementById('mon-live-indicator');

                if (indicator) {

                    if (monPaused) {

                        indicator.className = 'flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-700 text-[9px] font-bold rounded-lg border border-amber-100';

                        indicator.querySelector('span').className = 'w-1.5 h-1.5 bg-amber-500 rounded-full';

                    } else {

                        indicator.className = 'flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-700 text-[9px] font-bold rounded-lg border border-emerald-100';

                        indicator.querySelector('span').className = 'w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse';

                    }

                }

            }

            window.monitoringPause = monitoringPause;

            // EXPOSE MONITORING FUNCTIONS GLOBALLY
            window.ensureMonitoringDOM = ensureMonitoringDOM;
            window.loadMonitoring = loadMonitoring;
            window.stopMonitoring = stopMonitoring;
            window.fetchMonitoringData = fetchMonitoringData;
            window.renderMonitoringUI = renderMonitoringUI;



            async function monExec(cmd) {

                try {

                    const res = await ipcRenderer.invoke('ssh:execute', cmd);

                    if (res.success) return res.data.stdout || '';

                    return '';

                } catch (e) { return ''; }

            }



            window.monCharts = {};



            function updateApexChart(chartId, data, options) {

                if (!window.monCharts[chartId]) {

                    const el = document.getElementById(chartId);

                    if (!el) return;

                    window.monCharts[chartId] = new ApexCharts(el, options);

                    window.monCharts[chartId].render();

                } else {

                    // Update options and series data together to ensure UI settings are applied

                    window.monCharts[chartId].updateOptions({

                        series: options.series,

                        ...options

                    }, false, false); // Use false, false to avoid resetting animations and to keep it smooth

                }

            }



            function formatBytes(bytes) {

                if (bytes < 1024) return bytes.toFixed(0) + ' B';

                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';

                if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';

                return (bytes / 1073741824).toFixed(2) + ' GB';

            }



            function formatBytesRate(bytes) {

                if (bytes < 1024) return bytes.toFixed(0) + ' B/s';

                if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB/s';

                if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB/s';

                return (bytes / 1073741824).toFixed(2) + ' GB/s';

            }



            async function fetchMonitoringData() {

                const bigCmd = [

                    "grep 'cpu ' /proc/stat", // 0: CPU Total

                    "free -b | grep Mem",    // 1: Mem

                    "free -b | grep Swap",   // 2: Swap

                    "cat /proc/loadavg",     // 3: Load

                    "uptime -p 2>/dev/null || uptime", // 4: Uptime

                    "df -B1 / | tail -1",    // 5: Disk usage

                    "cat /proc/net/dev | grep -E 'eth|ens|eno|enp|wlan' | head -1", // 6: Net

                    "cat /proc/diskstats | grep -E 'sd[a-z]|nvme[0-9]|vd[a-z]' | head -1", // 7: Disk IO

                    "ps -eo pid,user,%cpu,%mem,stat,time,args --sort=-%cpu --no-headers | head -12 | while read -r p u c m s t cmd; do echo \"PROC_INFO|$p|$u|$c|$m|$s|$t|$cmd\"; if [ -r /proc/$p/io ]; then grep '_bytes: ' /proc/$p/io 2>/dev/null; fi; echo \"PROC_END\"; done", // 8: Procs

                    "hostname; uname -r",    // 9: Host/Kernel

                    "ss -tun state established 2>/dev/null | wc -l || netstat -tun | grep ESTABLISHED | wc -l", // 10: Conns

                    "nproc",                 // 11: Cores count

                    "cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 0", // 12: Temp

                    "cat /proc/sys/kernel/random/entropy_avail 2>/dev/null || echo 0", // 13: Entropy

                    "cat /proc/sys/fs/file-nr | awk '{print $1}'", // 14: Open files

                    "cat /proc/meminfo | grep -E 'Buffers:|Cached:|Dirty:|Shmem:|Slab:|PageTables:|VmallocUsed:|Mapped:'", // 15: Detailed Mem

                    "cat /proc/net/snmp | grep -E 'Tcp:|Ip:'", // 16: TCP/IP Metrics

                    "grep '^cpu[0-9]' /proc/stat", // 17: Per-Core CPU

                    "vmstat 1 2 | tail -1", // 18: VM Stats (cs, in, pg)

                    "df -i / | tail -1", // 19: Inodes

                    "docker stats --no-stream --format 'STATS|{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.NetIO}}|{{.BlockIO}}' 2>/dev/null || echo 'NO_DOCKER'", // 20: Docker

                    "systemctl is-system-running 2>/dev/null || echo 'unknown'; systemctl list-units --state=failed --no-legend 2>/dev/null | head -5", // 21: Services

                    "ss -nlpt 2>/dev/null | grep LISTEN | wc -l", // 22: Listening Ports

                    "grep -i 'failed' /var/log/auth.log 2>/dev/null | tail -5 | wc -l || grep -i 'failed' /var/log/secure 2>/dev/null | tail -5 | wc -l", // 23: Failed Logins

                    "cat /proc/cpuinfo | grep -m1 'model name' | cut -d: -f2; uname -m; cat /proc/cpuinfo | grep -c ^processor; lscpu 2>/dev/null | grep -E 'Thread|Socket|Cache|Arch' | head -6", // 24: Hardware CPU Model

                    "cat /etc/os-release 2>/dev/null | grep -E 'PRETTY_NAME|VERSION_ID' | head -2; dpkg -l 2>/dev/null | tail -n +6 | wc -l || rpm -qa 2>/dev/null | wc -l; who -b 2>/dev/null | awk '{print $3, $4}'", // 25: OS Details

                    "ulimit -n; ulimit -u; cat /proc/sys/fs/file-max 2>/dev/null; cat /proc/sys/kernel/pid_max 2>/dev/null; cat /proc/sys/kernel/threads-max 2>/dev/null; cat /proc/sys/vm/max_map_count 2>/dev/null", // 26: Resource Limits

                    "cat /proc/swaps 2>/dev/null; swapon --show=NAME,TYPE,SIZE,USED,PRIO --noheadings 2>/dev/null", // 27: Swap Details

                    "timedatectl 2>/dev/null | grep -E 'Time zone|Local time' | head -2 || date '+%Z %z'", // 28: Timezone

                    "lspci 2>/dev/null | grep -i 'vga\\|3d\\|display' | head -1 || echo 'No GPU detected'", // 29: GPU Info

                ].join(' && echo \"___DELIM___\" && ');



                const raw = await monExec(bigCmd);

                return raw.split('___DELIM___').map(s => s.trim());

            }



            function parseMonData(parts) {

                const d = {

                    memDetails: {}, snmp: {}, perCore: [], vmstat: {},

                    docker: [], services: { failed: [], state: 'unknown' },

                    security: { ports: 0, failedLogins: 0 },

                    processes: [],

                    hardware: { cpuModel: 'Unknown', arch: 'Unknown', cpuCount: 0, details: [], gpu: 'No GPU detected' },

                    osInfo: { distro: 'Unknown', versionId: '', packages: 0, lastBoot: 'Unknown' },

                    limits: { openFilesLimit: 0, maxProcs: 0, fileMax: 0, pidMax: 0, threadsMax: 0, maxMapCount: 0 },

                    swapDetails: [],

                    timezone: 'Unknown'

                };

                try {

                    // CPU Total (0)

                    const cpuParts = (parts[0] || '').split(/\s+/);

                    if (cpuParts.length >= 8) {

                        const u = parseInt(cpuParts[1]) || 0, n = parseInt(cpuParts[2]) || 0, s = parseInt(cpuParts[3]) || 0, i = parseInt(cpuParts[4]) || 0, iw = parseInt(cpuParts[5]) || 0, irq = parseInt(cpuParts[6]) || 0, sirq = parseInt(cpuParts[7]) || 0, steal = parseInt(cpuParts[8]) || 0;

                        d.cpuRaw = { active: u + n + s + iw + irq + sirq + steal, total: u + n + s + i + iw + irq + sirq + steal, details: { user: u, system: s, idle: i, wait: iw, steal: steal } };

                    }



                    // Mem/Swap (1, 2)

                    const mp = (parts[1] || '').split(/\s+/);

                    d.memTotal = parseInt(mp[1]) || 1; d.memUsed = parseInt(mp[2]) || 0; d.memPct = (d.memUsed / d.memTotal) * 100;

                    const swp = (parts[2] || '').split(/\s+/);

                    d.swapTotal = parseInt(swp[1]) || 0; d.swapUsed = parseInt(swp[2]) || 0;



                    // Load/Uptime (3, 4)

                    const lp = (parts[3] || '0 0 0').split(/\s+/);

                    d.load1 = parseFloat(lp[0]); d.load5 = parseFloat(lp[1]); d.load15 = parseFloat(lp[2]);

                    d.uptime = (parts[4] || 'Unknown').replace('up ', '');



                    // Disk / Net / IO (5, 6, 7)

                    const dp = (parts[5] || '').split(/\s+/);

                    d.diskTotal = parseInt(dp[1]) || 1; d.diskUsed = parseInt(dp[2]) || 0; d.diskPct = (d.diskUsed / d.diskTotal) * 100; d.diskPath = dp[5] || '/';

                    const np = (parts[6] || '').trim().split(/\s+/);

                    d.netInterface = (np[0] || 'eth0').replace(':', ''); d.netRxBytes = parseInt(np[1]) || 0; d.netTxBytes = parseInt(np[9]) || 0;

                    const dio = (parts[7] || '').trim().split(/\s+/);

                    d.diskReadSectors = parseInt(dio[5]) || 0; d.diskWriteSectors = parseInt(dio[9]) || 0;



                    // Processes (8)

                    const psRaw = parts[8] || '';

                    let curP = null;

                    psRaw.split('\n').forEach(line => {

                        line = line.trim();

                        if (line.startsWith('PROC_INFO|')) {

                            const f = line.substring(10).split('|');

                            curP = { pid: f[0], user: f[1], cpu: parseFloat(f[2]) || 0, mem: parseFloat(f[3]) || 0, stat: f[4], time: f[5], command: f.slice(6).join('|'), io: { r: 0, w: 0 } };

                        } else if (line.startsWith('PROC_END')) { if (curP) d.processes.push(curP); curP = null; }

                        else if (curP) {

                            if (line.includes('read_bytes:')) curP.io.r = parseInt(line.split(':')[1]) || 0;

                            if (line.includes('write_bytes:')) curP.io.w = parseInt(line.split(':')[1]) || 0;

                        }

                    });



                    // Host/System (9..14)

                    const hk = (parts[9] || '').split('\n');

                    d.hostname = (hk[0] || 'Unknown').trim(); d.kernel = (hk[1] || 'Unknown').trim();

                    d.netConns = parseInt(parts[10]) || 0; d.cpuCores = parseInt(parts[11]) || 1;

                    d.cpuTemp = (parseInt(parts[12]) || 0) / 1000; d.entropy = parseInt(parts[13]) || 0; d.openFiles = parseInt(parts[14]) || 0;



                    // Detailed Data (15..23)

                    (parts[15] || '').split('\n').forEach(l => { const m = l.match(/^(\w+):\s+(\d+)/); if (m) d.memDetails[m[1].toLowerCase()] = parseInt(m[2]) * 1024; });

                    const snmpL = (parts[16] || '').split('\n');

                    snmpL.forEach((l, i) => {

                        if (l.startsWith('Tcp:') && snmpL[i + 1]?.startsWith('Tcp:')) { const keys = l.split(/\s+/), vals = snmpL[i + 1].split(/\s+/); keys.forEach((k, idx) => d.snmp['tcp_' + k.toLowerCase()] = parseInt(vals[idx])); }

                        if (l.startsWith('Ip:') && snmpL[i + 1]?.startsWith('Ip:')) { const keys = l.split(/\s+/), vals = snmpL[i + 1].split(/\s+/); keys.forEach((k, idx) => d.snmp['ip_' + k.toLowerCase()] = parseInt(vals[idx])); }

                    });

                    (parts[17] || '').split('\n').forEach(l => { const p = l.split(/\s+/); if (p.length > 5) d.perCore.push({ id: p[0], user: parseInt(p[1]), system: parseInt(p[3]), idle: parseInt(p[4]) }); });

                    const vs = (parts[18] || '').trim().split(/\s+/);

                    if (vs.length >= 16) d.vmstat = { cs: vs[11], in: vs[10], b: vs[1], so: vs[7] };

                    const ino = (parts[19] || '').split(/\s+/); if (ino.length >= 5) d.inodes = { pct: parseInt(ino[4]) };

                    (parts[20] || '').split('\n').forEach(l => { if (l.startsWith('STATS|')) { const f = l.split('|'); d.docker.push({ name: f[1], cpu: f[2], mem: f[3], net: f[4], io: f[5] }); } });

                    const svc = (parts[21] || '').split('\n');

                    d.services.state = svc[0] || 'unknown'; d.services.failed = svc.slice(1).filter(l => l.trim().length > 0);

                    d.security.ports = parseInt(parts[22]) || 0; d.security.failedLogins = parseInt(parts[23]) || 0;



                    // Hardware CPU Model (24)

                    const hwLines = (parts[24] || '').split('\n').filter(l => l.trim());

                    if (hwLines.length >= 1) d.hardware.cpuModel = hwLines[0].trim() || 'Unknown';

                    if (hwLines.length >= 2) d.hardware.arch = hwLines[1].trim() || 'Unknown';

                    if (hwLines.length >= 3) d.hardware.cpuCount = parseInt(hwLines[2]) || 0;

                    d.hardware.details = hwLines.slice(3).map(l => l.trim()).filter(l => l);



                    // OS Details (25)

                    const osLines = (parts[25] || '').split('\n').filter(l => l.trim());

                    osLines.forEach(l => {

                        if (l.startsWith('PRETTY_NAME=')) d.osInfo.distro = l.split('=')[1].replace(/"/g, '');

                        else if (l.startsWith('VERSION_ID=')) d.osInfo.versionId = l.split('=')[1].replace(/"/g, '');

                        else if (/^\d+$/.test(l.trim())) d.osInfo.packages = parseInt(l.trim()) || 0;

                        else if (/\d{4}-\d{2}-\d{2}/.test(l)) d.osInfo.lastBoot = l.trim();

                    });



                    // Resource Limits (26)

                    const limLines = (parts[26] || '').split('\n').filter(l => l.trim());

                    if (limLines.length >= 1) d.limits.openFilesLimit = parseInt(limLines[0]) || 0;

                    if (limLines.length >= 2) d.limits.maxProcs = parseInt(limLines[1]) || 0;

                    if (limLines.length >= 3) d.limits.fileMax = parseInt(limLines[2]) || 0;

                    if (limLines.length >= 4) d.limits.pidMax = parseInt(limLines[3]) || 0;

                    if (limLines.length >= 5) d.limits.threadsMax = parseInt(limLines[4]) || 0;

                    if (limLines.length >= 6) d.limits.maxMapCount = parseInt(limLines[5]) || 0;



                    // Swap Details (27)

                    (parts[27] || '').split('\n').forEach(l => {

                        l = l.trim();

                        if (l && !l.startsWith('Filename') && !l.startsWith('NAME')) {

                            const sp = l.split(/\s+/);

                            if (sp.length >= 3) d.swapDetails.push({ name: sp[0], type: sp[1] || 'partition', size: sp[2] || '0', used: sp[3] || '0', prio: sp[4] || '0' });

                        }

                    });



                    // Timezone (28)

                    const tzLines = (parts[28] || '').split('\n').filter(l => l.trim());

                    tzLines.forEach(l => {

                        if (l.includes('Time zone:') || l.includes('Timezone:')) d.timezone = l.split(':').slice(1).join(':').trim();

                        else if (!d.timezone || d.timezone === 'Unknown') d.timezone = l.trim();

                    });



                    // GPU Info (29)

                    d.hardware.gpu = (parts[29] || 'No GPU detected').trim();



                } catch (e) { console.error('Production parse error:', e); }

                return d;

            }



            // Previous CPU raw for delta calc

            let monPrevCpuRaw = null;



            var monDomReady = false;



            function ensureMonitoringDOM() {

                if (monDomReady) return;

                const container = document.getElementById('monitoring-container');

                if (!container) return;



                container.innerHTML = `

                <!-- EXECUTIVE PULSE ROW (High-Performance Redesign) -->

    <div class="grid grid-cols-2 lg:grid-cols-6 gap-4 mb-6">

        <!-- Hostname Card -->

        <div class="bg-white border border-slate-200/60 rounded-[28px] p-4 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300 group cursor-default">

            <div class="flex items-center gap-3 mb-2.5">

                <div class="w-8 h-8 bg-slate-100 text-slate-500 rounded-xl flex items-center justify-center group-hover:bg-slate-900 group-hover:text-white transition-all duration-300">

                    <i class="fas fa-server text-[11px]"></i>

                </div>

                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Hostname</p>

            </div>

            <p class="text-[13px] font-black text-slate-900 truncate pl-1" id="mv-hostname">--</p>

        </div>



        <!-- Uptime Card -->

        <div class="bg-white border border-slate-200/60 rounded-[28px] p-4 shadow-sm hover:shadow-xl hover:shadow-emerald-200/40 transition-all duration-300 group cursor-default">

            <div class="flex items-center gap-3 mb-2.5">

                <div class="w-8 h-8 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center group-hover:bg-emerald-500 group-hover:text-white transition-all duration-300">

                    <i class="fas fa-clock text-[11px]"></i>

                </div>

                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Uptime</p>

            </div>

            <p class="text-[13px] font-black text-slate-900 truncate pl-1" id="mv-uptime">--</p>

        </div>



        <!-- Load Card -->

        <div class="bg-white border border-slate-200/60 rounded-[28px] p-4 shadow-sm hover:shadow-xl hover:shadow-indigo-200/40 transition-all duration-300 group cursor-default">

            <div class="flex items-center gap-3 mb-2.5">

                <div class="w-8 h-8 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center group-hover:bg-indigo-500 group-hover:text-white transition-all duration-300">

                    <i class="fas fa-microchip text-[11px]"></i>

                </div>

                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Load</p>

            </div>

            <p class="text-[13px] font-black text-slate-900 pl-1" id="mv-load">--</p>

        </div>



        <!-- Connections Card -->

        <div class="bg-white border border-slate-200/60 rounded-[28px] p-4 shadow-sm hover:shadow-xl hover:shadow-blue-200/40 transition-all duration-300 group cursor-default">

            <div class="flex items-center gap-3 mb-2.5">

                <div class="w-8 h-8 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center group-hover:bg-blue-500 group-hover:text-white transition-all duration-300">

                    <i class="fas fa-network-wired text-[11px]"></i>

                </div>

                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Connections</p>

            </div>

            <p class="text-[13px] font-black text-slate-900 pl-1" id="mv-conns">--</p>

        </div>



        <!-- Entropy Card -->

        <div class="bg-white border border-slate-200/60 rounded-[28px] p-4 shadow-sm hover:shadow-xl hover:shadow-rose-200/40 transition-all duration-300 group cursor-default">

            <div class="flex items-center gap-3 mb-2.5">

                <div class="w-8 h-8 bg-rose-50 text-rose-600 rounded-xl flex items-center justify-center group-hover:bg-rose-500 group-hover:text-white transition-all duration-300">

                    <i class="fas fa-shield-alt text-[11px]"></i>

                </div>

                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Entropy</p>

            </div>

            <p class="text-[13px] font-black text-slate-900 pl-1" id="mv-entropy">--</p>

        </div>



        <!-- Files Card -->

        <div class="bg-white border border-slate-200/60 rounded-[28px] p-4 shadow-sm hover:shadow-xl hover:shadow-amber-200/40 transition-all duration-300 group cursor-default">

            <div class="flex items-center gap-3 mb-2.5">

                <div class="w-8 h-8 bg-amber-50 text-amber-600 rounded-xl flex items-center justify-center group-hover:bg-amber-500 group-hover:text-white transition-all duration-300">

                    <i class="fas fa-file-invoice text-[11px]"></i>

                </div>

                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest">Files</p>

            </div>

            <p class="text-[13px] font-black text-slate-900 pl-1" id="mv-files">--</p>

        </div>

    </div>



                <!-- TELEMETRY RADIAL GAUGES (CLEAN PREMIUM LIGHT MODE) -->

                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">

                    <!-- CPU USAGE GAUGE -->

                    <div class="bg-white rounded-[24px] p-4 shadow-sm border border-slate-100 flex flex-col items-center justify-between overflow-hidden relative" style="min-height: 240px;">

                        <p class="text-[10px] font-black text-slate-400 text-center uppercase tracking-[0.2em] mb-1">CPU Usage</p>

                        <!-- OUTER RING INDICATOR -->

                        <div class="absolute top-[38px] left-1/2 -translate-x-1/2 w-[165px] h-[165px] rounded-full opacity-100 pointer-events-none" style="background: conic-gradient(from 250deg at 50% 50%, #10b981 0deg, #f59e0b 110deg, #ef4444 220deg, transparent 220deg); -webkit-mask: radial-gradient(transparent 66%, black 67%); mask: radial-gradient(transparent 66%, black 67%); z-index: 0;"></div>

                        <!-- SKELETON -->

                        <div id="skel-cpu-gauge" class="absolute inset-0 z-20 skeleton rounded-[24px]"></div>

                        <div id="mon-cpu-gauge-radial" class="relative z-10" style="width: 100%; height: 160px;"></div>

                        <div id="mon-cpu-gauge-spark" class="w-full h-[50px] -mt-4 opacity-30 relative z-10"></div>

                    </div>

                    <!-- MEMORY USAGE GAUGE -->

                    <div class="bg-white rounded-[24px] p-4 shadow-sm border border-slate-100 flex flex-col items-center justify-between overflow-hidden relative" style="min-height: 240px;">

                        <p class="text-[10px] font-black text-slate-400 text-center uppercase tracking-[0.2em] mb-1">Memory Usage</p>

                        <!-- OUTER RING INDICATOR -->

                        <div class="absolute top-[38px] left-1/2 -translate-x-1/2 w-[165px] h-[165px] rounded-full opacity-100 pointer-events-none" style="background: conic-gradient(from 250deg at 50% 50%, #10b981 0deg, #f59e0b 110deg, #ef4444 220deg, transparent 220deg); -webkit-mask: radial-gradient(transparent 66%, black 67%); mask: radial-gradient(transparent 66%, black 67%); z-index: 0;"></div>

                        <!-- SKELETON -->

                        <div id="skel-ram-gauge" class="absolute inset-0 z-20 skeleton rounded-[24px]"></div>

                        <div id="mon-ram-gauge-radial" class="relative z-10" style="width: 100%; height: 160px;"></div>

                        <div id="mon-ram-gauge-spark" class="w-full h-[50px] -mt-4 opacity-30 relative z-10"></div>

                    </div>

                    <!-- DISK USAGE GAUGE -->

                    <div class="bg-white rounded-[24px] p-4 shadow-sm border border-slate-100 flex flex-col items-center justify-between overflow-hidden relative" style="min-height: 240px;">

                        <p class="text-[10px] font-black text-slate-400 text-center uppercase tracking-[0.2em] mb-1">Disk Usage</p>

                        <!-- OUTER RING INDICATOR -->

                        <div class="absolute top-[38px] left-1/2 -translate-x-1/2 w-[165px] h-[165px] rounded-full opacity-100 pointer-events-none" style="background: conic-gradient(from 250deg at 50% 50%, #10b981 0deg, #f59e0b 110deg, #ef4444 220deg, transparent 220deg); -webkit-mask: radial-gradient(transparent 66%, black 67%); mask: radial-gradient(transparent 66%, black 67%); z-index: 0;"></div>

                         <!-- SKELETON -->

                        <div id="skel-disk-gauge" class="absolute inset-0 z-20 skeleton rounded-[24px]"></div>

                        <div id="mon-disk-gauge-radial" class="relative z-10" style="width: 100%; height: 160px;"></div>

                        <div id="mon-disk-gauge-spark" class="w-full h-[50px] -mt-4 opacity-30 relative z-10"></div>

                    </div>

                    <!-- BANDWIDTH GAUGE -->

                    <div class="bg-white rounded-[24px] p-4 shadow-sm border border-slate-100 flex flex-col items-center justify-between overflow-hidden relative" style="min-height: 240px;">

                        <p class="text-[10px] font-black text-slate-400 text-center uppercase tracking-[0.2em] mb-1">Bandwidth</p>

                        <!-- OUTER RING INDICATOR -->

                        <div class="absolute top-[38px] left-1/2 -translate-x-1/2 w-[165px] h-[165px] rounded-full opacity-100 pointer-events-none" style="background: conic-gradient(from 250deg at 50% 50%, #10b981 0deg, #f59e0b 110deg, #ef4444 220deg, transparent 220deg); -webkit-mask: radial-gradient(transparent 66%, black 67%); mask: radial-gradient(transparent 66%, black 67%); z-index: 0;"></div>

                        <!-- SKELETON -->

                        <div id="skel-net-gauge" class="absolute inset-0 z-20 skeleton rounded-[24px]"></div>

                        <div id="mon-net-gauge-radial" class="relative z-10" style="width: 100%; height: 160px;"></div>

                        <div id="mon-net-gauge-spark" class="w-full h-[50px] -mt-4 opacity-30 relative z-10"></div>

                    </div>

                </div>



                <!-- PRIMARY METRICS WITH GRAPHS - VISIBLE FIRST -->

                <div class="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-5">

                    

                    <!-- COMPUTE INTELLIGENCE (Compact Bento Redesign) -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-xl transition-all p-6 ring-1 ring-slate-100 flex flex-col">

                        <div class="flex justify-between items-start mb-6">

                            <div class="flex items-center gap-3">

                                <div class="w-10 h-10 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-lg">

                                    <i class="fas fa-bolt text-xs"></i>

                                </div>

                                <div>

                                    <h3 class="text-sm font-black text-slate-900 leading-none">Compute Intelligence</h3>

                                    <p class="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1" id="mv-cpu-sub">Analyzing DNA...</p>

                                </div>

                            </div>

                            <div class="text-right">

                                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Total Load</p>

                                <span class="text-2xl font-black text-slate-900 tabular-nums leading-none" id="mv-cpu-pct">--%</span>

                            </div>

                        </div>

                        

                        <div class="space-y-4 mb-6">

                            <!-- User Runtime -->

                            <div class="space-y-1.5">

                                <div class="flex justify-between text-[9px] font-black uppercase tracking-widest">

                                    <span class="text-slate-400">User Runtime</span>

                                    <span class="text-emerald-600" id="mv-cpu-user">--%</span>

                                </div>

                                <div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">

                                    <div id="mv-cpu-user-fill" class="h-full bg-emerald-400 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(52,211,153,0.3)]" style="width:0%"></div>

                                </div>

                            </div>

                            <!-- Kernel Ops -->

                            <div class="space-y-1.5">

                                <div class="flex justify-between text-[9px] font-black uppercase tracking-widest">

                                    <span class="text-slate-400">Kernel Operations</span>

                                    <span class="text-indigo-600" id="mv-cpu-sys">--%</span>

                                </div>

                                <div class="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">

                                    <div id="mv-cpu-sys-fill" class="h-full bg-indigo-500 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(99,102,241,0.3)]" style="width:0%"></div>

                                </div>

                            </div>

                        </div>



                        <div class="mt-auto">

                            <div class="flex items-center gap-4 mb-3 border-t border-slate-50 pt-3">

                                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-blue-500"></span><span class="text-[8px] font-black text-slate-400 uppercase">Live Load</span></div>

                                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-emerald-100 border border-emerald-200"></span><span class="text-[8px] font-black text-slate-400 uppercase">Optimal</span></div>

                                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-rose-100 border border-rose-200"></span><span class="text-[8px] font-black text-slate-400 uppercase">Critical</span></div>

                            </div>

                            <div class="bg-slate-50/50 rounded-2xl border border-slate-100 overflow-hidden">

                                <div id="mon-cpu-chart" style="width:100%;height:130px"></div>

                            </div>

                        </div>

                    </div>



                    <!-- MEMORY PRESSURE (Compact Bento Redesign) -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-xl transition-all p-6 ring-1 ring-slate-100 flex flex-col">

                        <div class="flex justify-between items-start mb-6">

                            <div class="flex items-center gap-3">

                                <div class="w-10 h-10 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-100/50">

                                    <i class="fas fa-memory text-xs"></i>

                                </div>

                                <div>

                                    <h3 class="text-sm font-black text-slate-900 leading-none">Memory Pressure</h3>

                                    <p class="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-1" id="mv-ram-sub">-- Total capacity</p>

                                </div>

                            </div>

                            <div class="text-right">

                                <p class="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-0.5">Consumption</p>

                                <span class="text-2xl font-black text-slate-900 tabular-nums leading-none" id="mv-ram-pct">--%</span>

                            </div>

                        </div>



                        <div class="grid grid-cols-4 gap-2 mb-6">

                            <div class="bg-indigo-50/20 p-2.5 rounded-xl border border-indigo-100/20 text-center group hover:bg-white hover:shadow-md transition-all duration-300">

                                <p class="text-[7px] font-black text-slate-400 uppercase mb-0.5">Buffers</p>

                                <p class="text-[9px] font-black text-indigo-600" id="mv-ram-buff">--</p>

                            </div>

                            <div class="bg-violet-50/20 p-2.5 rounded-xl border border-violet-100/20 text-center group hover:bg-white hover:shadow-md transition-all duration-300">

                                <p class="text-[7px] font-black text-slate-400 uppercase mb-0.5">Cached</p>

                                <p class="text-[9px] font-black text-violet-600" id="mv-ram-cache">--</p>

                            </div>

                            <div class="bg-slate-50/20 p-2.5 rounded-xl border border-slate-100/20 text-center group hover:bg-white hover:shadow-md transition-all duration-300">

                                <p class="text-[7px] font-black text-slate-400 uppercase mb-0.5">Slab</p>

                                <p class="text-[9px] font-black text-slate-600" id="mv-ram-slab">--</p>

                            </div>

                            <div class="bg-blue-50/20 p-2.5 rounded-xl border border-blue-100/20 text-center group hover:bg-white hover:shadow-md transition-all duration-300">

                                <p class="text-[7px] font-black text-slate-400 uppercase mb-0.5">Shared</p>

                                <p class="text-[9px] font-black text-blue-600" id="mv-ram-maps">--</p>

                            </div>

                        </div>



                        <div class="mt-auto">

                            <div class="flex items-center gap-4 mb-3 border-t border-slate-50 pt-3">

                                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-indigo-500"></span><span class="text-[8px] font-black text-slate-400 uppercase">Pressure</span></div>

                                <div class="flex items-center gap-1.5"><span class="w-2 h-2 rounded-full bg-slate-200"></span><span class="text-[8px] font-black text-slate-400 uppercase">Available</span></div>

                            </div>

                            <div class="bg-slate-50/50 rounded-2xl border border-slate-100 overflow-hidden">

                                <div id="mon-ram-chart" style="width:100%;height:130px"></div>

                            </div>

                        </div>

                    </div>



                    <!-- HARDWARE MANIFEST -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-lg transition-all p-6 ring-1 ring-slate-100">

                        <div class="flex items-center gap-3 mb-5">

                            <div class="w-10 h-10 bg-gradient-to-br from-violet-600 to-purple-700 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-violet-200"><i class="fas fa-cogs text-xs"></i></div>

                            <div><h3 class="text-sm font-black text-slate-900 leading-none">Hardware Manifest</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Processor & Architecture</p></div>

                        </div>

                        <div class="space-y-3">

                            <div class="bg-violet-50/40 border border-violet-100/50 rounded-2xl p-3">

                                <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">CPU Model</p>

                                <p class="text-[11px] font-black text-slate-900 truncate" id="mv-hw-cpumodel">Scanning...</p>

                            </div>

                            <div class="grid grid-cols-3 gap-2">

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Arch</p><p class="text-[10px] font-black text-violet-600" id="mv-hw-arch">--</p></div>

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Cores</p><p class="text-[10px] font-black text-indigo-600" id="mv-hw-cores">--</p></div>

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Temp</p><p class="text-[10px] font-black text-amber-600" id="mv-hw-temp">--</p></div>

                            </div>

                            <div class="bg-slate-50/30 border border-slate-100/40 rounded-2xl p-3">

                                <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1.5">GPU</p>

                                <p class="text-[9px] font-bold text-slate-600 truncate" id="mv-hw-gpu">Scanning...</p>

                            </div>

                            <div id="mv-hw-details" class="space-y-1"></div>

                        </div>

                    </div>



                    <!-- OS INTELLIGENCE -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-lg transition-all p-6 ring-1 ring-slate-100">

                        <div class="flex items-center gap-3 mb-5">

                            <div class="w-10 h-10 bg-gradient-to-br from-teal-500 to-emerald-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-teal-200"><i class="fab fa-linux text-xs"></i></div>

                            <div><h3 class="text-sm font-black text-slate-900 leading-none">OS Intelligence</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">System Identity</p></div>

                        </div>

                        <div class="space-y-3">

                            <div class="bg-teal-50/40 border border-teal-100/50 rounded-2xl p-3">

                                <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Distribution</p>

                                <p class="text-[11px] font-black text-slate-900 truncate" id="mv-os-distro">Scanning...</p>

                            </div>

                            <div class="grid grid-cols-2 gap-2">

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Kernel</p><p class="text-[10px] font-black text-emerald-600 truncate" id="mv-os-kernel">--</p></div>

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Packages</p><p class="text-[10px] font-black text-teal-600" id="mv-os-pkgs">--</p></div>

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Boot</p><p class="text-[10px] font-black text-slate-700 truncate" id="mv-os-boot">--</p></div>

                                <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Timezone</p><p class="text-[10px] font-black text-indigo-600 truncate" id="mv-os-tz">--</p></div>

                            </div>

                            <div class="bg-slate-50/50 border border-slate-100/50 p-2.5 rounded-2xl text-center"><p class="text-[7px] font-black text-slate-400 uppercase mb-1">Hostname</p><p class="text-[10px] font-black text-slate-900 truncate" id="mv-os-host">--</p></div>

                        </div>

                    </div>



                    <!-- KERNEL PERFORMANCE -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-lg transition-all p-6 ring-1 ring-slate-100">

                        <div class="flex items-center gap-3 mb-5">

                            <div class="w-10 h-10 bg-gradient-to-br from-slate-800 to-slate-600 rounded-2xl flex items-center justify-center text-white shadow-lg"><i class="fas fa-microchip text-xs"></i></div>

                            <div><h3 class="text-sm font-black text-slate-900 leading-none">Kernel Performance</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Context Ops & IRQs</p></div>

                        </div>

                        <div class="grid grid-cols-2 gap-3">

                            <div class="bg-indigo-50/30 border border-indigo-100 p-3 rounded-2xl"><p class="text-[8px] font-black text-slate-400 uppercase mb-1.5">Context</p><p class="text-sm font-black text-indigo-600" id="mv-perf-cs">--</p></div>

                            <div class="bg-purple-50/30 border border-purple-100 p-3 rounded-2xl"><p class="text-[8px] font-black text-slate-400 uppercase mb-1.5">Interrupts</p><p class="text-sm font-black text-purple-600" id="mv-perf-in">--</p></div>

                            <div class="bg-amber-50/30 border border-amber-100 p-3 rounded-2xl"><p class="text-[8px] font-black text-slate-400 uppercase mb-1.5">Queue</p><p class="text-sm font-black text-amber-600" id="mv-perf-b">--</p></div>

                            <div class="bg-rose-50/30 border border-rose-100 p-3 rounded-2xl"><p class="text-[8px] font-black text-slate-400 uppercase mb-1.5">I/O Wait</p><p class="text-sm font-black text-rose-500" id="mv-perf-fault">--</p></div>

                        </div>

                    </div>



                    <!-- SECURITY SENTINEL -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-lg transition-all p-6 ring-1 ring-slate-100">

                        <div class="flex items-center gap-3 mb-4">

                            <div class="w-10 h-10 bg-gradient-to-br from-rose-500 to-red-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-rose-200"><i class="fas fa-shield-alt text-xs"></i></div>

                            <div><h3 class="text-sm font-black text-slate-900 leading-none">Security Sentinel</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1" id="mv-kernel">Kernel...</p></div>

                        </div>

                        <div class="flex justify-between items-center mb-3"><span id="mv-svc-status" class="px-3 py-1 bg-emerald-50 text-[9px] font-black text-emerald-600 uppercase rounded-full border border-emerald-100">Healthy</span><span class="text-[9px] font-black text-rose-500 uppercase" id="mv-security-failed">0 failed</span></div>

                        <div id="mv-svc-list" class="p-2 bg-rose-50/50 rounded-2xl border border-rose-100 hidden"><div class="text-[8px] font-bold text-rose-600 space-y-1" id="mv-svc-list-body"></div></div>

                        <div class="mt-2 text-[9px] font-bold text-slate-400 uppercase flex gap-3"><span>Svc: <span id="mv-svc-failed" class="text-rose-500">0</span></span><span>Ports: <span id="mv-security-ports" class="text-indigo-600">--</span></span></div>

                    </div>







                </div>





                <!-- SYSTEM INFORMATION CARDS - BENTO GRID -->

                <div class="grid grid-cols-1 md:grid-cols-2 gap-5 mb-5">

                    

                    <!-- SWAP ANALYSIS -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-lg transition-all p-6 ring-1 ring-slate-100">

                        <div class="flex items-center gap-3 mb-4">

                            <div class="w-10 h-10 bg-gradient-to-br from-pink-500 to-rose-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-pink-200"><i class="fas fa-exchange-alt text-xs"></i></div>

                            <div><h3 class="text-sm font-black text-slate-900 leading-none">Swap Analysis</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Virtual Memory</p></div>

                        </div>

                        <div class="space-y-2.5">

                            <div class="flex justify-between items-center bg-pink-50/40 border border-pink-100/40 p-3 rounded-2xl">

                                <div><p class="text-[7px] font-black text-slate-400 uppercase">Total</p><p class="text-sm font-black text-slate-900" id="mv-swap-total">--</p></div>

                                <div class="text-right"><p class="text-[7px] font-black text-slate-400 uppercase">Used</p><p class="text-sm font-black text-rose-500" id="mv-swap-used">--</p></div>

                            </div>

                            <div class="h-2 w-full bg-slate-100 rounded-full overflow-hidden shadow-inner"><div id="mv-swap-fill" class="h-full bg-gradient-to-r from-pink-400 to-rose-500 rounded-full transition-all duration-1000" style="width:0%"></div></div>

                            <p class="text-[8px] font-black text-slate-400 uppercase tracking-widest text-center" id="mv-swap-pct">0% utilized</p>

                            <div id="mv-swap-devices" class="space-y-1"></div>

                        </div>

                    </div>



                    <!-- RESOURCE LIMITS -->

                    <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm hover:shadow-lg transition-all p-6 ring-1 ring-slate-100">

                        <div class="flex items-center gap-3 mb-4">

                            <div class="w-10 h-10 bg-gradient-to-br from-cyan-500 to-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-cyan-200"><i class="fas fa-tachometer-alt text-xs"></i></div>

                            <div><h3 class="text-sm font-black text-slate-900 leading-none">Resource Limits</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Kernel Boundaries</p></div>

                        </div>

                        <div class="grid grid-cols-2 gap-2">

                            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2.5 text-center overflow-hidden"><p class="text-[7px] font-black text-slate-400 uppercase mb-1 truncate">Files</p><p class="text-xs font-black text-cyan-600 tabular-nums truncate" id="mv-lim-openfiles">--</p><div class="mt-1 h-1 w-full bg-slate-200 rounded-full overflow-hidden"><div id="mv-lim-openfiles-fill" class="h-full bg-cyan-500 rounded-full transition-all" style="width:0%"></div></div><p class="text-[6px] font-bold text-slate-400 mt-0.5 truncate" id="mv-lim-openfiles-pct">--</p></div>

                            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2.5 text-center overflow-hidden"><p class="text-[7px] font-black text-slate-400 uppercase mb-1 truncate">Procs</p><p class="text-xs font-black text-slate-900 tabular-nums truncate" id="mv-lim-maxprocs">--</p></div>

                            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2.5 text-center overflow-hidden"><p class="text-[7px] font-black text-slate-400 uppercase mb-1 truncate">File Max</p><p class="text-xs font-black text-indigo-600 tabular-nums truncate" id="mv-lim-filemax">--</p></div>

                            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2.5 text-center overflow-hidden"><p class="text-[7px] font-black text-slate-400 uppercase mb-1 truncate">PID Max</p><p class="text-xs font-black text-violet-600 tabular-nums truncate" id="mv-lim-pidmax">--</p></div>

                            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2.5 text-center overflow-hidden"><p class="text-[7px] font-black text-slate-400 uppercase mb-1 truncate">Threads</p><p class="text-xs font-black text-emerald-600 tabular-nums truncate" id="mv-lim-threadsmax">--</p></div>

                            <div class="bg-slate-50/50 border border-slate-100 rounded-xl p-2.5 text-center overflow-hidden"><p class="text-[7px] font-black text-slate-400 uppercase mb-1 truncate">Map Cnt</p><p class="text-xs font-black text-amber-600 tabular-nums truncate" id="mv-lim-mapcount">--</p></div>

                        </div>

                    </div>



                </div>



                <!-- 3. CONTAINER OPS ZONE FULL WIDTH -->

                <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm p-8 mb-6 ring-1 ring-slate-100">

                    <div class="flex items-center gap-4 mb-6">

                        <div class="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-blue-200"><i class="fab fa-docker text-lg"></i></div>

                        <div><h3 class="text-base font-black text-slate-900 leading-none">Virtualization Runtime Ops</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5" id="mv-docker-count">Synchronizing container registry...</p></div>

                    </div>

                    <div id="mv-docker-list" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">

                        <div class="p-6 border border-slate-100 rounded-3xl bg-slate-50 flex items-center justify-center flex-col text-center"><i class="fas fa-circle-notch fa-spin text-slate-200 text-xl mb-3"></i><p class="text-[10px] font-bold text-slate-300 uppercase tracking-widest">Awaiting Runtime telemetry...</p></div>

                    </div>

                </div>



                <!-- 4. ENTERPRISE PROCESS SENTINEL -->

                <div class="bg-white border border-slate-200 rounded-[32px] shadow-sm p-0 overflow-hidden ring-1 ring-slate-100">

                    <div class="px-8 py-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">

                        <div class="flex items-center gap-4">

                            <div class="w-12 h-12 bg-slate-900 rounded-2xl flex items-center justify-center text-white shadow-xl"><i class="fas fa-list-ol text-sm"></i></div>

                            <div><h3 class="text-base font-black text-slate-900 leading-none">Enterprise Process Analysis</h3><p class="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">Full execution stack monitoring</p></div>

                        </div>

                        <span class="px-4 py-2 bg-white border border-slate-200 text-[10px] font-black text-indigo-600 uppercase tracking-widest rounded-2xl shadow-sm" id="mv-proc-count">Detecting process load...</span>

                    </div>

                    <div class="overflow-x-auto">

                        <table class="w-full text-sm">

                            <thead>

                                <tr class="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] border-b border-slate-100/50 bg-slate-50/20">

                                    <th class="text-left py-5 pl-10 w-[35%]">Entity Identity</th>

                                    <th class="text-left py-5 w-[10%]">PID</th>

                                    <th class="text-left py-5 w-[15%]">Compute DNA</th>

                                    <th class="text-left py-5 w-[15%]">Memory Footprint</th>

                                    <th class="text-left py-5 w-[12%]">Disk Ops</th>

                                    <th class="text-right py-5 pr-10 w-[13%]">Execution</th>

                                </tr>

                            </thead>

                            <tbody class="divide-y divide-slate-100/30" id="mv-proc-tbody"></tbody>

                        </table>

                    </div>

                </div>



                <div class="text-center py-8">

                    <span class="px-6 py-2 bg-white/50 border border-white rounded-2xl text-[10px] font-black text-slate-300 backdrop-blur-sm uppercase tracking-[0.3em]" id="mv-last-update">Establishing secure telemetry tunnel...</span>

                </div>

                `;

                monDomReady = true;

            }



            function renderMonitoringUI(d) {

                window.latestMonData = d;

                ensureMonitoringDOM();

                const set = (id, val) => { const el = document.getElementById(id); if (el) { if (typeof val === 'number') el.innerText = val.toLocaleString(); else el.innerText = val; } };

                const setH = (id, html) => { const el = document.getElementById(id); if (el) el.innerHTML = html; };



                // 1. Calculations & Rates

                let cpuPct = 0;

                let isFirstDataPoint = false;



                if (monPrevCpuRaw && d.cpuRaw) {

                    const activeDiff = d.cpuRaw.active - monPrevCpuRaw.active;

                    const totalDiff = d.cpuRaw.total - monPrevCpuRaw.total;

                    cpuPct = totalDiff > 0 ? (activeDiff / totalDiff) * 100 : 0;

                } else {

                    isFirstDataPoint = true;

                }

                monPrevCpuRaw = d.cpuRaw;



                const now = Date.now();

                const deltaSec = (monIntervalMs || 1000) / 1000;

                const netInRate = Math.max(0, (d.netRxBytes - (monPrevNet?.rx || d.netRxBytes)) / deltaSec);

                const netOutRate = Math.max(0, (d.netTxBytes - (monPrevNet?.tx || d.netTxBytes)) / deltaSec);

                monPrevNet = { rx: d.netRxBytes, tx: d.netTxBytes };



                const dr = d.diskReadSectors * 512, dw = d.diskWriteSectors * 512;

                const diskRRate = Math.max(0, (dr - (monPrevDisk?.r || dr)) / deltaSec);

                const diskWRate = Math.max(0, (dw - (monPrevDisk?.w || dw)) / deltaSec);

                monPrevDisk = { r: dr, w: dw };



                // 2. Performance History

                monHistory.cpu.push(cpuPct); monHistory.ram.push(d.memPct);

                monHistory.netIn.push(netInRate); monHistory.netOut.push(netOutRate);

                monHistory.diskR.push(diskRRate); monHistory.diskW.push(diskWRate);

                [monHistory.cpu, monHistory.ram, monHistory.netIn, monHistory.netOut, monHistory.diskR, monHistory.diskW].forEach(arr => { if (arr.length > 50) arr.shift(); });



                // 3. Executive Pulse Row

                set('mv-hostname', d.hostname);

                set('mv-uptime', d.uptime);

                set('mv-load', `${d.load1.toFixed(2)} ${d.load5.toFixed(2)} ${d.load15.toFixed(2)}`);

                set('mv-conns', d.netConns);

                set('mv-entropy', d.entropy);

                set('mv-files', d.openFiles);



                // 4. Analytics Grid - Compute

                set('mv-cpu-pct', isFirstDataPoint ? '...' : cpuPct.toFixed(1) + '%');

                set('mv-cpu-sub', `${d.cpuCores} Logic Cores @ ${d.cpuTemp.toFixed(1)}C`);

                if (d.cpuRaw?.details && monPrevCpuRaw?.details) {

                    const det = d.cpuRaw.details;

                    const detPrev = monPrevCpuRaw.details;

                    const totalDiff = d.cpuRaw.total - monPrevCpuRaw.total;



                    const uDiff = det.user - detPrev.user;

                    const sDiff = det.system - detPrev.system;

                    const wDiff = (det.wait || 0) - (detPrev.wait || 0);

                    const stDiff = (det.steal || 0) - (detPrev.steal || 0);



                    const u = totalDiff > 0 ? (uDiff / totalDiff) * 100 : 0;

                    const s = totalDiff > 0 ? (sDiff / totalDiff) * 100 : 0;

                    const w = totalDiff > 0 ? ((wDiff + stDiff) / totalDiff) * 100 : 0;



                    set('mv-cpu-user', u.toFixed(1) + '%');

                    set('mv-cpu-sys', s.toFixed(1) + '%');

                    set('mv-cpu-wait', w.toFixed(1) + '%');



                    const uf = document.getElementById('mv-cpu-user-fill'), sf = document.getElementById('mv-cpu-sys-fill'), wf = document.getElementById('mv-cpu-wait-fill');

                    if (uf) { uf.style.width = Math.min(u, 100) + '%'; uf.className = 'h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(52,211,153,0.4)]'; }

                    if (sf) { sf.style.width = Math.min(s, 100) + '%'; sf.className = 'h-full bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(99,102,241,0.4)]'; }

                    if (wf) { wf.style.width = Math.min(w, 100) + '%'; wf.className = 'h-full bg-gradient-to-r from-orange-400 to-orange-500 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(251,146,60,0.4)]'; }

                }



                // 5. Analytics Grid - Memory

                set('mv-ram-pct', d.memPct.toFixed(1) + '%');

                set('mv-ram-sub', (d.memTotal / 1073741824).toFixed(1) + ' GB Total Pool');

                set('mv-ram-buff', formatBytes(d.memDetails.buffers || 0));

                set('mv-ram-cache', formatBytes(d.memDetails.cached || 0));

                set('mv-ram-slab', formatBytes(d.memDetails.slab || 0));

                set('mv-ram-maps', formatBytes(d.memDetails.mapped || 0));



                // 6. Analytics Grid - Storage

                set('mv-disk-pct', d.diskPct.toFixed(1) + '%');

                set('mv-disk-sub', d.diskPath || '/');

                set('mv-disk-used', formatBytes(d.diskUsed));

                set('mv-disk-inodes', (d.inodes?.pct || 0) + '%');

                const df = document.getElementById('mv-disk-fill'); if (df) df.style.width = Math.min(d.diskPct, 100) + '%';

                set('mv-dio-r', isFirstDataPoint ? '...' : formatBytesRate(diskRRate)); set('mv-dio-w', isFirstDataPoint ? '...' : formatBytesRate(diskWRate));



                // 7. Analytics Grid - Connectivity

                set('mv-net-iface', d.netInterface || 'eth0');

                set('mv-net-rx', isFirstDataPoint ? '...' : formatBytesRate(netInRate)); set('mv-net-tx', isFirstDataPoint ? '...' : formatBytesRate(netOutRate));

                set('mv-tcp-retrans', d.snmp.tcp_retransseg || 0); set('mv-tcp-est', d.snmp.tcp_currestab || d.netConns);

                set('mv-net-err', (d.snmp.ip_inerrors || 0) + (d.snmp.ip_indiscards || 0)); set('mv-net-ports', d.security.ports);



                // 8. Security & Performance Faults

                set('mv-perf-cs', d.vmstat.cs || 0); set('mv-perf-in', d.vmstat.in || 0);

                set('mv-perf-b', d.vmstat.b || 0); set('mv-perf-fault', d.vmstat.so || 0);

                set('mv-kernel', d.kernel);

                set('mv-security-failed', d.security.failedLogins + ' failed attempts');

                set('mv-security-ports', d.security.ports + ' listening');

                set('mv-svc-failed', d.services.failed.length + ' service failures');



                const ss = document.getElementById('mv-svc-status');

                if (ss) {

                    const ok = d.services.state === 'running' && d.services.failed.length === 0;

                    ss.textContent = ok ? 'Unit Pulse: Normal' : 'Unit Pulse: Critical';

                    ss.className = `px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-full border ${ok ? 'bg-emerald-50 text-emerald-600 border-emerald-100' : 'bg-rose-50 text-rose-600 border-rose-100 animate-pulse'}`;

                }

                const sl = document.getElementById('mv-svc-list');

                if (sl) {

                    if (d.services.failed.length > 0) {

                        sl.classList.remove('hidden');

                        setH('mv-svc-list-body', d.services.failed.map(s => `<div> ${s.split(' ')[0]}</div>`).join(''));

                    } else sl.classList.add('hidden');

                }



                // 9. Docker Ops Center

                set('mv-docker-count', d.docker.length + ' ACTIVE CONTAINERS');

                const dl = document.getElementById('mv-docker-list');

                if (dl) {

                    if (d.docker.length > 0) {

                        dl.innerHTML = d.docker.map(c => `

                            <div class="p-5 border border-slate-100 rounded-3xl bg-white/40 backdrop-blur-sm group hover:bg-white hover:shadow-lg transition-all border-l-4 border-l-blue-500">

                                <div class="flex justify-between items-start mb-3">

                                    <div class="min-w-0">

                                        <p class="text-[11px] font-black text-slate-900 truncate">${c.name}</p>

                                        <p class="text-[9px] text-slate-400 font-bold uppercase mt-1">Docker Runtime</p>

                                    </div>

                                    <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>

                                </div>

                                <div class="grid grid-cols-2 gap-2 mb-3">

                                    <div class="bg-white/60 p-2 rounded-xl border border-slate-100/50">

                                        <p class="text-[7px] font-black text-slate-400 uppercase">Load</p>

                                        <p class="text-[10px] font-black text-slate-900">${c.cpu}</p>

                                    </div>

                                    <div class="bg-white/60 p-2 rounded-xl border border-slate-100/50">

                                        <p class="text-[7px] font-black text-slate-400 uppercase">Memory</p>

                                        <p class="text-[10px] font-black text-slate-900">${c.mem}</p>

                                    </div>

                                </div>

                                <div class="flex justify-between text-[8px] font-black uppercase text-slate-400 border-t border-slate-100/50 pt-3">

                                    <span>IO: ${c.io.split('/')[0]}</span>

                                    <span>NET: ${c.net.split('/')[0]}</span>

                                </div>

                            </div>

                        `).join('');

                    } else dl.innerHTML = `<div class="col-span-full p-8 text-center text-[10px] font-bold text-slate-300 uppercase tracking-widest">No Active Containers Detected</div>`;

                }



                // 10. Enterprise Process Sentinel

                set('mv-proc-count', `${d.processes.length} LIVE PROCESSES`);

                const tb = document.getElementById('mv-proc-tbody');

                if (tb) {

                    const getIcon = (cmd) => {

                        const c = (cmd || '').toLowerCase();

                        if (c.includes('devyntra')) return 'fas fa-shield-alt text-indigo-500';

                        if (c.includes('node') || c.includes('java') || c.includes('python')) return 'fas fa-code text-emerald-500';

                        if (c.includes('docker')) return 'fab fa-docker text-blue-500';

                        return 'fas fa-microchip text-slate-400';

                    };

                    tb.innerHTML = d.processes.slice(0, 15).map(p => {

                        const cmd = (p.command || '').trim().split(' ')[0].split('/').pop() || 'kernel';

                        return `

                        <tr class="hover:bg-slate-50/50 transition-all group border-b border-transparent hover:border-slate-100/50">

                            <td class="py-4 pl-10">

                                <div class="flex items-center gap-4">

                                    <div class="w-10 h-10 rounded-2xl bg-white border border-slate-100 flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform"><i class="${getIcon(p.command)} text-[11px]"></i></div>

                                    <div class="min-w-0"><p class="text-xs font-black text-slate-900 truncate">${cmd}</p><p class="text-[9px] text-slate-400 font-bold truncate mt-1 opacity-60">${p.user}  PID ${p.pid}</p></div>

                                </div>

                            </td>

                            <td class="py-4 font-mono text-[10px] font-black text-slate-400 text-center">#${p.pid}</td>

                            <td class="py-4">

                                <div class="w-full max-w-[100px] flex flex-col gap-1.5 mx-auto">

                                    <div class="flex justify-between text-[9px] font-black uppercase"><span class="text-slate-400">Load</span><span class="text-slate-900">${p.cpu.toFixed(1)}%</span></div>

                                    <div class="h-1 w-full bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-slate-900" style="width:${Math.min(p.cpu, 100)}%"></div></div>

                                </div>

                            </td>

                            <td class="py-4">

                                <div class="w-full max-w-[100px] flex flex-col gap-1.5 mx-auto">

                                    <div class="flex justify-between text-[9px] font-black uppercase"><span class="text-slate-400">RAM</span><span class="text-slate-900">${p.mem.toFixed(1)}%</span></div>

                                    <div class="h-1 w-full bg-slate-100 rounded-full overflow-hidden"><div class="h-full bg-indigo-500" style="width:${Math.min(p.mem * 5, 100)}%"></div></div>

                                </div>

                            </td>

                            <td class="py-4 text-[10px] font-black text-slate-500 text-center">${formatBytesRate(p.diskReadRate || 0)}</td>

                            <td class="py-4 pr-10 text-right font-mono text-[10px] text-slate-400 font-bold">${p.time}</td>

                        </tr>`;

                    }).join('');

                }



                // 11. Hardware Manifest

                set('mv-hw-cpumodel', d.hardware.cpuModel || 'Unknown');

                set('mv-hw-arch', d.hardware.arch || 'Unknown');

                set('mv-hw-cores', d.hardware.cpuCount || d.cpuCores || '--');

                set('mv-hw-temp', d.cpuTemp > 0 ? d.cpuTemp.toFixed(1) + 'C' : 'N/A');

                set('mv-hw-gpu', d.hardware.gpu || 'No GPU detected');

                const hwDetails = document.getElementById('mv-hw-details');

                if (hwDetails && d.hardware.details.length > 0) {

                    hwDetails.innerHTML = d.hardware.details.map(line => {

                        const parts = line.split(':');

                        const label = (parts[0] || '').trim();

                        const value = (parts.slice(1).join(':') || '').trim();

                        return `<div class="flex justify-between text-[9px] bg-slate-50/40 border border-slate-100/30 rounded-xl px-3 py-1.5">

                            <span class="font-black text-slate-400 uppercase tracking-wider">${label}</span>

                            <span class="font-black text-slate-700">${value}</span>

                        </div>`;

                    }).join('');

                }



                // 12. OS Intelligence

                set('mv-os-distro', d.osInfo.distro || 'Unknown');

                set('mv-os-kernel', d.kernel || 'Unknown');

                set('mv-os-pkgs', d.osInfo.packages > 0 ? d.osInfo.packages.toLocaleString() + ' installed' : '--');

                set('mv-os-boot', d.osInfo.lastBoot || 'Unknown');

                set('mv-os-tz', d.timezone || 'Unknown');

                set('mv-os-host', d.hostname || 'Unknown');



                // 13. Swap Analysis

                set('mv-swap-total', formatBytes(d.swapTotal || 0));

                set('mv-swap-used', formatBytes(d.swapUsed || 0));

                const swapPct = d.swapTotal > 0 ? ((d.swapUsed / d.swapTotal) * 100) : 0;

                set('mv-swap-pct', swapPct.toFixed(1) + '% utilized');

                const swapFill = document.getElementById('mv-swap-fill');

                if (swapFill) swapFill.style.width = Math.min(swapPct, 100) + '%';

                const swapDevices = document.getElementById('mv-swap-devices');

                if (swapDevices) {

                    if (d.swapDetails.length > 0) {

                        swapDevices.innerHTML = d.swapDetails.map(sw => `

                            <div class="flex justify-between items-center text-[9px] bg-pink-50/30 border border-pink-100/30 rounded-xl px-3 py-1.5">

                                <span class="font-black text-slate-500 truncate max-w-[100px]">${sw.name}</span>

                                <span class="font-bold text-slate-400">${sw.type}</span>

                                <span class="font-black text-rose-500">${sw.size}</span>

                            </div>

                        `).join('');

                    } else {

                        swapDevices.innerHTML = '<p class="text-[9px] font-bold text-slate-300 uppercase tracking-widest text-center">No swap devices detected</p>';

                    }

                }



                // 14. Resource Limits & Capacity

                set('mv-lim-openfiles', d.limits.openFilesLimit > 0 ? d.limits.openFilesLimit.toLocaleString() : '--');

                set('mv-lim-maxprocs', d.limits.maxProcs > 0 ? d.limits.maxProcs.toLocaleString() : '--');

                set('mv-lim-filemax', d.limits.fileMax > 0 ? d.limits.fileMax.toLocaleString() : '--');

                set('mv-lim-pidmax', d.limits.pidMax > 0 ? d.limits.pidMax.toLocaleString() : '--');

                set('mv-lim-threadsmax', d.limits.threadsMax > 0 ? d.limits.threadsMax.toLocaleString() : '--');

                set('mv-lim-mapcount', d.limits.maxMapCount > 0 ? d.limits.maxMapCount.toLocaleString() : '--');

                // Open files usage gauge

                if (d.limits.openFilesLimit > 0 && d.openFiles > 0) {

                    const fileUsePct = Math.min((d.openFiles / d.limits.openFilesLimit) * 100, 100);

                    const fileFill = document.getElementById('mv-lim-openfiles-fill');

                    if (fileFill) fileFill.style.width = fileUsePct.toFixed(1) + '%';

                    set('mv-lim-openfiles-pct', `${d.openFiles.toLocaleString()} used (${fileUsePct.toFixed(1)}%)`);

                }



                set('mv-last-update', `FEED STABLE: ${new Date().toLocaleTimeString()}  ALL SYSTEMS OPERATIONAL`);



                const mNet = Math.max(...monHistory.netIn, ...monHistory.netOut, 1024);

                const mDisk = Math.max(...monHistory.diskR, ...monHistory.diskW, 1024);



                // --- NEW TELEMETRY RADIALS (CLEAN PREMIUM LIGHT MODE) ---

                const radialOptions = (val, color, unit = '%', fontSize = '20px') => ({

                    chart: { type: 'radialBar', height: 180, sparkline: { enabled: true }, zoom: { enabled: false }, animations: { enabled: true, speed: 600 } },

                    series: [parseFloat(val.toFixed(1))],

                    colors: [color],

                    plotOptions: {

                        radialBar: {

                            startAngle: -110,

                            endAngle: 110,

                            hollow: { size: '60%', background: '#ffffff', dropShadow: { enabled: true, top: 0, left: 0, blur: 4, opacity: 0.1 } },

                            track: {

                                background: '#f1f5f9', // Neutral track

                                opacity: 1,

                                strokeWidth: '100%',

                                margin: 0,

                            },

                            dataLabels: {

                                name: { show: false },

                                value: {

                                    offsetY: 8, fontSize: fontSize, fontWeight: 900, color: '#1e293b',

                                    formatter: (v) => v + unit

                                }

                            }

                        }

                    },

                    stroke: { lineCap: 'butt' }

                });



                const gaugeSparkOptions = (data, color) => ({

                    chart: { type: 'area', height: 50, sparkline: { enabled: true }, zoom: { enabled: false }, animations: { enabled: true, speed: 600 } },

                    series: [{ data: data }],

                    colors: [color],

                    stroke: { curve: 'smooth', width: 2 },

                    fill: { type: 'gradient', gradient: { opacityFrom: 0.3, opacityTo: 0 } },

                    tooltip: { enabled: false }

                });



                const getStatusColor = (v) => v > 80 ? '#f43f5e' : v > 50 ? '#f59e0b' : '#10b981';



                const hideSkel = (id) => {

                    if (!isFirstDataPoint) {

                        const el = document.getElementById(id);

                        if (el) {

                            el.style.opacity = '0';

                            setTimeout(() => el.remove(), 500);

                        }

                    }

                };



                // CPU Gauge

                updateApexChart('mon-cpu-gauge-radial', [], radialOptions(cpuPct, getStatusColor(cpuPct)));

                updateApexChart('mon-cpu-gauge-spark', [], gaugeSparkOptions(monHistory.cpu, '#3b82f6'));

                hideSkel('skel-cpu-gauge');



                // RAM Gauge

                updateApexChart('mon-ram-gauge-radial', [], radialOptions(d.memPct, getStatusColor(d.memPct)));

                updateApexChart('mon-ram-gauge-spark', [], gaugeSparkOptions(monHistory.ram, '#3b82f6'));

                hideSkel('skel-ram-gauge');



                // Disk Gauge

                updateApexChart('mon-disk-gauge-radial', [], radialOptions(d.diskPct, getStatusColor(d.diskPct)));

                updateApexChart('mon-disk-gauge-spark', [], gaugeSparkOptions(monHistory.diskR.map((v, i) => v + monHistory.diskW[i]), '#3b82f6'));

                hideSkel('skel-disk-gauge');



                // Bandwidth Gauge

                const currentBW_KB = (netInRate + netOutRate) / 1024;

                const bwPct = Math.min((currentBW_KB / 10240) * 100, 100);

                updateApexChart('mon-net-gauge-radial', [], {

                    ...radialOptions(bwPct, '#10b981', ' kbps', '16px'),

                    plotOptions: {

                        radialBar: {

                            ...radialOptions(bwPct, '#10b981', ' kbps', '16px').plotOptions.radialBar,

                            dataLabels: {

                                name: { show: false },

                                value: {

                                    offsetY: 8, fontSize: '16px', fontWeight: 900, color: '#1e293b',

                                    formatter: () => currentBW_KB.toFixed(0) + ' kbps'

                                }

                            }

                        }

                    }

                });

                hideSkel('skel-net-gauge');

                updateApexChart('mon-net-gauge-spark', [], gaugeSparkOptions(monHistory.netIn.map((v, i) => (v + monHistory.netOut[i]) / 1024), '#6366f1'));



                // 15. Premium ApexCharts Rendering

                // CPU: Dashed lines + threshold regions (Style 7)

                updateApexChart('mon-cpu-chart', monHistory.cpu, {

                    chart: { type: 'line', height: 130, toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false } },

                    stroke: { curve: 'straight', width: 2, dashArray: 6 },

                    series: [{ name: 'CPU Load', data: monHistory.cpu }],

                    colors: ['#3b82f6'],

                    dataLabels: { enabled: false },

                    legend: { show: false },

                    grid: { show: true, borderColor: '#f1f5f9', strokeDashArray: 0, xaxis: { lines: { show: true } }, yaxis: { lines: { show: true } } },

                    xaxis: { labels: { show: false }, axisBorder: { show: false }, axisTicks: { show: false } },

                    yaxis: { min: 0, max: 100, labels: { show: true, formatter: (val) => val.toFixed(0), style: { fontSize: '8px', fontWeight: 900 } } },

                    annotations: {

                        yaxis: [

                            { y: 80, y2: 100, fillColor: '#fee2e2', opacity: 0.3, borderColor: 'transparent' }, // Red zone

                            { y: 0, y2: 80, fillColor: '#f0fdf4', opacity: 0.1, borderColor: 'transparent' }   // Green zone

                        ]

                    },

                    tooltip: { enabled: false }

                });



                // RAM: Stacked bars (Style 5)

                updateApexChart('mon-ram-chart', [], {

                    chart: { type: 'bar', height: 130, stacked: true, toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false } },

                    plotOptions: { bar: { horizontal: false, columnWidth: '50%', borderRadius: 3 } },

                    series: [

                        { name: 'Used', data: monHistory.ram },

                        { name: 'Available', data: monHistory.ram.map(v => 100 - v) }

                    ],

                    colors: ['#6366f1', '#f1f5f9'],

                    dataLabels: { enabled: false },

                    legend: { show: false },

                    grid: { show: true, borderColor: '#f1f5f9', xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },

                    xaxis: { labels: { show: false }, axisBorder: { show: false } },

                    yaxis: { min: 0, max: 100, labels: { show: true, formatter: (val) => val.toFixed(0), style: { fontSize: '8px', fontWeight: 900 } } },

                    fill: { opacity: 1 },

                    tooltip: { enabled: false }

                });



                // Network: Line graph with opacity area (Style 1 - Mirrored)

                updateApexChart('mon-net-chart', [], {

                    chart: { type: 'area', height: 160, toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false } },

                    stroke: { curve: 'smooth', width: 2 },

                    grid: { show: true, borderColor: '#f1f5f9', xaxis: { lines: { show: true } }, yaxis: { lines: { show: true } } },

                    fill: { type: 'gradient', gradient: { shadeIntensity: 1, opacityFrom: 0.6, opacityTo: 0.1 } },

                    series: [

                        { name: 'Inbound', data: monHistory.netIn },

                        { name: 'Outbound', data: monHistory.netOut.map(v => -v) }

                    ],

                    colors: ['#3b82f6', '#10b981'],

                    dataLabels: { enabled: false },

                    legend: { show: false },

                    xaxis: { labels: { show: false }, axisBorder: { show: false } },

                    yaxis: {

                        min: -mNet, max: mNet,

                        labels: {

                            show: true,

                            style: { fontSize: '8px', fontWeight: 900 },

                            formatter: (v) => Math.abs(v) > 1024 * 1024 ? (Math.abs(v) / (1024 * 1024)).toFixed(0) + 'M' : Math.abs(v) > 1024 ? (Math.abs(v) / 1024).toFixed(0) + 'K' : Math.abs(v).toFixed(0)

                        }

                    },

                    tooltip: { enabled: false }

                });



                // Disk: Interpolation mode: Step (Style 2/3)

                updateApexChart('mon-disk-chart', [], {

                    chart: { type: 'area', height: 150, toolbar: { show: false }, zoom: { enabled: false }, animations: { enabled: false } },

                    stroke: { curve: 'stepline', width: 2 },

                    grid: { show: true, borderColor: '#f1f5f9', xaxis: { lines: { show: true } }, yaxis: { lines: { show: true } } },

                    series: [

                        { name: 'Read', data: monHistory.diskR },

                        { name: 'Write', data: monHistory.diskW }

                    ],

                    colors: ['#3b82f6', '#10b981'],

                    fill: { type: 'gradient', gradient: { opacityFrom: 0.4, opacityTo: 0.05 } },

                    dataLabels: { enabled: false },

                    legend: { show: false },

                    xaxis: { labels: { show: false }, axisBorder: { show: false } },

                    yaxis: {

                        min: 0, max: mDisk,

                        labels: {

                            show: true,

                            style: { fontSize: '8px', fontWeight: 900 },

                            formatter: (v) => v > 1024 * 1024 ? (v / (1024 * 1024)).toFixed(0) + 'M' : v > 1024 ? (v / 1024).toFixed(0) + 'K' : v.toFixed(0)

                        }

                    },

                    tooltip: { enabled: false }

                });

            }



            async function loadMonitoring(resume = false) {

                const container = document.getElementById('monitoring-container');

                // In cached mode, container might be deeper or inside view-cache-monitoring.

                // But since getElementById performs a global search, it should find it if it exists in the DOM.



                if (!resume && !container) return; // Should not happen if called after view render



                // Stop old interval

                stopMonitoring();

                monPaused = false;



                if (!resume) {

                    monDomReady = false;

                    window.monCharts = {};

                    // Only overwrite innerHTML if we are NOT resuming

                    if (container) container.innerHTML = getSkeletonHtml('monitoring');

                }



                // Re-bind Selector if needed (or ensure it persists)

                const sel = document.getElementById('mon-interval-select');

                if (sel) {

                    // Remove old listener to avoid duplicates if any (though typically element is replaced if !resume)

                    // unique listener approach is hard without named function, but replacing element works.

                    // For now assuming safe.

                    sel.onchange = function () {

                        monIntervalMs = parseInt(this.value);

                        const lbl = document.getElementById('mon-interval-label');

                        if (lbl) lbl.textContent = (monIntervalMs / 1000) + 's';

                        stopMonitoring();

                        loadMonitoring(true); // Restart with new interval

                    };

                }



                // Define Search/Render Function

                const runUpdate = async () => {

                    if (typeof monPaused !== 'undefined' && monPaused) return;

                    // Check if container still exists (user might have navigated away)

                    if (!document.getElementById('monitoring-container')) {

                        stopMonitoring();

                        return;

                    }



                    try {

                        const parts = await fetchMonitoringData();

                        const d = parseMonData(parts);

                        renderMonitoringUI(d);

                    } catch (e) {

                        console.error("Mon fetch error:", e);

                        // Only show error on UI if it's the first load and we currently have skeleton/empty

                        // This prevents flashing error on transient failures during resume

                        if (!resume && container && (container.innerHTML.includes('skeleton') || container.innerHTML === '')) {

                            container.innerHTML = `<div class="text-red-500 bg-red-50 p-6 rounded-xl border border-red-100 text-center"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">Failed to connect to monitoring</p><p class="text-xs mt-1">${e.message}</p></div>`;

                        }

                    }

                };



                // Trigger first fetch immediately (Non-blocking)

                runUpdate();



                // Start polling immediately

                monInterval = setInterval(runUpdate, monIntervalMs);

            }



            // Cleanup when navigating away

            const origNavigate = typeof navigate === 'function' ? navigate : null;



            // --- SCHEDULED TASKS VIEW LOGIC ---

            let geminiApiKey = ''; // Not persisted locally



            async function loadTasks() {

                const container = document.getElementById('tasks-container');

                if (!container) return;



                // Attach header button listener

                const headerBtn = document.getElementById('btn-create-task-header');

                if (headerBtn) headerBtn.addEventListener('click', openCreateTaskModal);



                container.innerHTML = getSkeletonHtml('list-items');



                try {

                    const res = await ipcRenderer.invoke('ssh:list-crons');



                    if (!res.success) {

                        container.innerHTML = `<div class="text-red-500 bg-red-50 p-6 rounded-xl border border-red-100 text-center"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">Failed to load tasks</p><p class="text-xs mt-1">${res.error}</p></div>`;

                        return;

                    }



                    const { crons } = res;

                    const activeCount = crons.length;



                    container.innerHTML = `

                <!--Overview Stats-->

                    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">

                        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">

                            <div class="flex items-center gap-3">

                                <div class="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center text-white shadow-lg"><i class="fas fa-tasks text-lg"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Total Tasks</p>

                                    <p class="text-2xl font-black text-gray-900 leading-tight">${crons.length}</p>

                                </div>

                            </div>

                        </div>

                        <div class="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">

                            <div class="flex items-center gap-3">

                                <div class="w-12 h-12 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-xl flex items-center justify-center text-white shadow-lg"><i class="fas fa-clock text-lg"></i></div>

                                <div>

                                    <p class="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Active Schedules</p>

                                    <p class="text-2xl font-black text-gray-900 leading-tight">${activeCount}</p>

                                </div>

                            </div>

                        </div>

                    </div>



                    ${crons.length === 0 ? `

                        <div class="bg-white border border-gray-200 rounded-xl p-16 text-center shadow-sm">

                            <div class="w-20 h-20 bg-gradient-to-br from-indigo-100 to-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-6">

                                <i class="fas fa-clock text-3xl text-indigo-600"></i>

                            </div>

                            <h3 class="text-xl font-bold text-gray-900 mb-2">No Scheduled Tasks Yet</h3>

                            <p class="text-gray-500 text-sm mb-8 max-w-md mx-auto">Automate your server tasks with cron jobs. Schedule backups, cleanups, monitoring scripts, and more.</p>

                            <button onclick="openCreateTaskModal()" class="px-6 py-3 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-lg text-sm font-bold hover:shadow-lg hover:shadow-indigo-200 active:scale-95 transition-all">

                                <i class="fas fa-plus mr-2"></i>Create Your First Task

                            </button>

                        </div>

                    ` : `

                        <div class="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">

                            <div class="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">

                                <h3 class="text-sm font-bold text-gray-900 flex items-center gap-2"><i class="fas fa-list text-indigo-500"></i>Scheduled Tasks</h3>

                                <span class="text-xs font-bold text-gray-400 bg-gray-100 px-3 py-1 rounded-lg border border-gray-200">${crons.length} task${crons.length !== 1 ? 's' : ''}</span>

                            </div>

                            <div class="divide-y divide-gray-100">

                                ${crons.map(task => {

                        return `

                                    <div class="group p-5 hover:bg-indigo-50/30 transition-all">

                                        <div class="flex items-start justify-between gap-4">

                                            <div class="flex items-start gap-4 flex-1 min-w-0">

                                                <div class="w-10 h-10 bg-gradient-to-br from-indigo-100 to-purple-100 text-indigo-600 rounded-xl flex items-center justify-center flex-shrink-0">

                                                    <i class="fas fa-terminal text-sm"></i>

                                                </div>

                                                <div class="flex-1 min-w-0">

                                                    <h4 class="text-sm font-bold text-gray-900 mb-1">${task.name || 'Unnamed Task'}</h4>

                                                    <div class="flex flex-wrap items-center gap-3 mb-2">

                                                        <div class="flex items-center gap-2">

                                                            <i class="fas fa-clock text-xs text-gray-400"></i>

                                                            <span class="font-mono text-xs font-bold text-gray-600 bg-gray-100 px-2 py-1 rounded border border-gray-200">${task.schedule}</span>

                                                        </div>

                                                        ${task.lastRun ? `<span class="text-xs text-gray-400">Last run: ${task.lastRun}</span>` : ''}

                                                    </div>

                                                    <div class="flex items-center gap-2 mb-2">

                                                        <i class="fas fa-terminal text-xs text-gray-400"></i>

                                                        <code class="text-xs text-gray-600 bg-gray-50 px-2 py-1 rounded border border-gray-100 font-mono truncate max-w-md" title="${task.command}">${task.command}</code>

                                                    </div>

                                                </div>

                                            </div>

                                            <div class="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">

                                                <button onclick="editTask('${task.raw.replace(/'/g, "\\'")}', '${(task.name || '').replace(/'/g, "\\'")}', '${task.schedule}', '${task.command.replace(/'/g, "\\'")}')" class="px-3 py-1.5 bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white rounded-lg text-xs font-bold transition-all border border-blue-100" title="Edit task">

                                                    <i class="fas fa-edit text-[10px]"></i>

                                                </button>

                                                <button onclick="deleteTask('${task.raw.replace(/'/g, "\\'")}', '${(task.name || 'this task').replace(/'/g, "\\'")}' )" class="px-3 py-1.5 bg-red-50 text-red-600 hover:bg-red-600 hover:text-white rounded-lg text-xs font-bold transition-all border border-red-100" title="Delete task">

                                                    <i class="fas fa-trash text-[10px]"></i>

                                                </button>

                                            </div>

                                        </div>

                                    </div>

                                `;

                    }).join('')}

                            </div>

                        </div>

                    `}



                    <!--Cron Schedule Help-->

                <div class="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5">

                    <div class="flex items-start gap-4">

                        <div class="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center text-white flex-shrink-0 shadow-lg"><i class="fas fa-info-circle"></i></div>

                        <div class="flex-1">

                            <p class="font-bold text-gray-900 text-sm mb-2">Cron Schedule Format</p>

                            <code class="text-xs bg-white text-blue-800 px-3 py-1.5 rounded-lg font-bold border border-blue-200 inline-block mb-3">minute  hour  day  month  weekday</code>

                            <div class="flex flex-wrap gap-2">

                                <span class="text-xs bg-white text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 font-mono font-bold">0 * * * * <span class="text-gray-400 font-sans font-normal ml-1">→ every hour</span></span>

                                <span class="text-xs bg-white text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 font-mono font-bold">0 0 * * * <span class="text-gray-400 font-sans font-normal ml-1">→ daily at midnight</span></span>

                                <span class="text-xs bg-white text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 font-mono font-bold">*/5 * * * * <span class="text-gray-400 font-sans font-normal ml-1">→ every 5 minutes</span></span>

                                <span class="text-xs bg-white text-gray-700 px-3 py-1.5 rounded-lg border border-gray-200 font-mono font-bold">0 2 * * 0 <span class="text-gray-400 font-sans font-normal ml-1">→ Sundays at 2 AM</span></span>

                            </div>

                        </div>

                    </div>

                </div>

            `;



                    // Attach event listeners

                    const createBtnEmpty = document.getElementById('btn-create-task-empty');

                    if (createBtnEmpty) createBtnEmpty.addEventListener('click', openCreateTaskModal);



                } catch (e) {

                    container.innerHTML = `<div class="text-red-500 bg-red-50 p-6 rounded-xl border border-red-100 text-center"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">Error</p><p class="text-xs mt-1">${e.message}</p></div>`;

                }

            }



            function openCreateTaskModal() {

                // Create modal HTML - Simplified UI

                const modalHtml = `

                <div id="task-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 z-50 flex items-center justify-center backdrop-blur-sm">

                    <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">

                        <div class="flex items-center justify-between mb-5">

                            <h2 class="text-lg font-bold text-gray-900">Create Scheduled Task</h2>

                            <button onclick="closeTaskModal()" class="text-gray-400 hover:text-gray-600">

                                <i class="fas fa-times"></i>

                            </button>

                        </div>



                        <form id="task-form" class="space-y-4">

                            <div>

                                <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">Task Name</label>

                                <input type="text" id="task-name" placeholder="e.g. Daily Backup" required

                                    class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 outline-none text-sm">

                            </div>



                            <div>

                                <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">Schedule</label>

                                <div class="grid grid-cols-5 gap-2">

                                    <div>

                                        <input type="text" id="cron-min" placeholder="*" value="0" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            <p class="text-[10px] text-gray-400 text-center mt-1">Min</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-hour" placeholder="*" value="0" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            <p class="text-[10px] text-gray-400 text-center mt-1">Hour</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-day" placeholder="*" value="*" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            <p class="text-[10px] text-gray-400 text-center mt-1">Day</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-month" placeholder="*" value="*" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            <p class="text-[10px] text-gray-400 text-center mt-1">Month</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-weekday" placeholder="*" value="*" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            <p class="text-[10px] text-gray-400 text-center mt-1">Weekday</p>

                                    </div>

                                </div>

                                <p class="text-xs text-gray-400 mt-2"><i class="fas fa-info-circle mr-1"></i>Default: Every day at midnight (0 0 * * *)</p>



                                <!-- Optional Stop Date -->

                                <details class="mt-3">

                                    <summary class="text-xs text-gray-500 cursor-pointer hover:text-gray-700">

                                        <i class="fas fa-clock mr-1"></i>Set Stop Date (Optional)

                                    </summary>

                                    <div class="mt-2 flex gap-2">

                                        <input type="date" id="task-stop-date"

                                            class="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            <input type="time" id="task-stop-time" value="23:59"

                                                class="border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                            </div>

                                            <p class="text-xs text-gray-400 mt-1">The cron job will be automatically removed after this date/time</p>

                                        </details>

                                    </div>



                                    <div>

                                        <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">Script / Command</label>

                                        <div class="flex gap-2">

                                            <input type="text" id="task-command" placeholder="/path/to/script.sh" required

                                                class="flex-1 border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 outline-none">

                                                <button type="button" id="btn-browse-script" class="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-sm font-medium">

                                                    <i class="fas fa-folder-open mr-1"></i>Browse

                                                </button>

                                        </div>

                                    </div>



                                    <!-- Collapsible AI Section -->

                                    <details class="border border-purple-100 rounded-lg bg-purple-50/50">

                                        <summary class="px-4 py-3 cursor-pointer flex items-center gap-2 text-sm font-medium text-purple-700 hover:bg-purple-50">

                                            <i class="fas fa-wand-magic-sparkles"></i>

                                            Generate Script with AI (Optional)

                                        </summary>

                                        <div class="px-4 pb-4 space-y-3">

                                            <div>

                                                <label class="block text-xs font-semibold text-gray-600 uppercase mb-1">Describe the Script</label>

                                                <textarea id="script-description" rows="2" placeholder="e.g., Backup MySQL databases daily"

                                                    class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-purple-200 outline-none"></textarea>

                                            </div>

                                            <button type="button" id="btn-generate-script" class="w-full px-3 py-2 bg-purple-600 text-white rounded-lg text-sm font-medium hover:bg-purple-700">

                                                <i class="fas fa-wand-magic-sparkles mr-2"></i>Generate

                                            </button>

                                            <div id="generated-script-container" class="hidden space-y-2">

                                                <textarea id="generated-script" rows="6"

                                                    class="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-xs bg-gray-900 text-green-400"></textarea>

                                                <div class="flex gap-2">

                                                    <input type="text" id="script-save-path" placeholder="/home/ubuntu/myscript.sh"

                                                        class="flex-1 border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm">

                                                        <button type="button" id="btn-save-script" class="px-3 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700">

                                                            <i class="fas fa-save mr-1"></i>Save & Use

                                                        </button>

                                                </div>

                                            </div>

                                        </div>

                                    </details>



                                    <div class="flex gap-3 pt-3">

                                        <button type="button" onclick="closeTaskModal()" class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 text-sm">

                                            Cancel

                                        </button>

                                        <button type="submit" class="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 text-sm">

                                            <i class="fas fa-plus mr-2"></i>Create Task

                                        </button>

                                    </div>

                                </form>

                            </div>

                    </div>

            `;



                document.body.insertAdjacentHTML('beforeend', modalHtml);



                // Attach event listeners

                document.getElementById('task-form').addEventListener('submit', createTask);

                document.getElementById('btn-browse-script').addEventListener('click', browseForScript);

                document.getElementById('btn-generate-script').addEventListener('click', generateScript);

                document.getElementById('btn-save-script').addEventListener('click', saveGeneratedScript);

            }



            async function browseForScript() {

                // Open a simple file picker modal showing server files

                const path = prompt("Enter the path to your script on the server:\n\nExample: /home/ubuntu/scripts/backup.sh\n\nTip: Use the Files & Code section to upload or create scripts first.");

                if (path) {

                    document.getElementById('task-command').value = path;

                }

            }





            function closeTaskModal() {

                const modal = document.getElementById('task-modal');

                if (modal) modal.remove();

            }

            window.closeTaskModal = closeTaskModal;



            async function createTask(e) {

                e.preventDefault();



                const name = document.getElementById('task-name').value;

                const min = document.getElementById('cron-min').value || '*';

                const hour = document.getElementById('cron-hour').value || '*';

                const day = document.getElementById('cron-day').value || '*';

                const month = document.getElementById('cron-month').value || '*';

                const weekday = document.getElementById('cron-weekday').value || '*';

                const schedule = `${min} ${hour} ${day} ${month} ${weekday} `;

                const command = document.getElementById('task-command').value;



                // Optional stop date

                const stopDateVal = document.getElementById('task-stop-date')?.value;

                const stopTimeVal = document.getElementById('task-stop-time')?.value || '23:59';

                let stopDateTime = null;

                if (stopDateVal) {

                    stopDateTime = `${stopDateVal} ${stopTimeVal} `;

                }



                if (!name || !command) {

                    alert('Please fill in Task Name and Command');

                    return;

                }



                showLoader("Creating Task...", "Adding cron job to server...");

                try {

                    const res = await ipcRenderer.invoke('ssh:add-cron', { name, schedule, command, stopDateTime });

                    if (res.success) {

                        closeTaskModal();

                        loadTasks();

                    } else {

                        alert('Failed to create task: ' + res.error);

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }





            async function deleteTask(rawLine, taskName) {

                if (!confirm(`Are you sure you want to delete "${taskName}"?\n\nThis will permanently remove the scheduled task.`)) return;



                showLoader("Deleting Task...", "Removing cron job from server...");

                try {

                    const res = await ipcRenderer.invoke('ssh:delete-cron', rawLine);

                    if (res.success) {

                        alert('Task deleted successfully!');

                        loadTasks();

                    } else {

                        alert('Failed to delete task: ' + res.error);

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }

            window.deleteTask = deleteTask;



            async function editTask(rawLine, name, schedule, command) {

                // Parse schedule

                const parts = schedule.trim().split(/\s+/);

                const [min = '*', hour = '*', day = '*', month = '*', weekday = '*'] = parts;



                // Create edit modal

                const modalHtml = `

                <div id="task-modal" class="fixed inset-0 bg-gray-900 bg-opacity-75 z-50 flex items-center justify-center backdrop-blur-sm">

                    <div class="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">

                        <div class="flex items-center justify-between mb-5">

                            <h2 class="text-lg font-bold text-gray-900">Edit Scheduled Task</h2>

                            <button onclick="closeTaskModal()" class="text-gray-400 hover:text-gray-600">

                                <i class="fas fa-times"></i>

                            </button>

                        </div>



                        <form id="task-form" class="space-y-4">

                            <input type="hidden" id="task-old-raw" value="${rawLine.replace(/"/g, '&quot;')}">

                            

                            <div>

                                <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">Task Name</label>

                                <input type="text" id="task-name" value="${name.replace(/"/g, '&quot;')}" required

                                    class="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 outline-none text-sm">

                            </div>



                            <div>

                                <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">Schedule</label>

                                <div class="grid grid-cols-5 gap-2">

                                    <div>

                                        <input type="text" id="cron-min" value="${min}" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                        <p class="text-[10px] text-gray-400 text-center mt-1">Min</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-hour" value="${hour}" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                        <p class="text-[10px] text-gray-400 text-center mt-1">Hour</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-day" value="${day}" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                        <p class="text-[10px] text-gray-400 text-center mt-1">Day</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-month" value="${month}" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                        <p class="text-[10px] text-gray-400 text-center mt-1">Month</p>

                                    </div>

                                    <div>

                                        <input type="text" id="cron-weekday" value="${weekday}" class="w-full border border-gray-300 rounded-lg px-2 py-2 text-center font-mono text-sm focus:ring-2 focus:ring-indigo-200 outline-none">

                                        <p class="text-[10px] text-gray-400 text-center mt-1">Weekday</p>

                                    </div>

                                </div>

                            </div>



                            <div>

                                <label class="block text-xs font-semibold text-gray-700 uppercase mb-1">Command</label>

                                <input type="text" id="task-command" value="${command.replace(/"/g, '&quot;')}" required

                                    class="w-full border border-gray-300 rounded-lg px-3 py-2 font-mono text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-500 outline-none">

                            </div>



                            <div class="bg-amber-50 border border-amber-200 rounded-lg p-3">

                                <p class="text-xs text-amber-700">

                                    <i class="fas fa-info-circle mr-1"></i>

                                    Editing will delete the old task and create a new one with updated settings.

                                </p>

                            </div>



                            <div class="flex gap-3 pt-3">

                                <button type="button" onclick="closeTaskModal()" class="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg font-medium hover:bg-gray-50 text-sm">

                                    Cancel

                                </button>

                                <button type="submit" class="flex-1 px-4 py-2.5 bg-indigo-600 text-white rounded-lg font-medium hover:bg-indigo-700 text-sm">

                                    <i class="fas fa-save mr-2"></i>Update Task

                                </button>

                            </div>

                        </form>

                    </div>

                </div>

            `;



                document.body.insertAdjacentHTML('beforeend', modalHtml);

                document.getElementById('task-form').addEventListener('submit', updateTask);

            }

            window.editTask = editTask;



            async function updateTask(e) {

                e.preventDefault();



                const oldRaw = document.getElementById('task-old-raw').value;

                const name = document.getElementById('task-name').value;

                const min = document.getElementById('cron-min').value || '*';

                const hour = document.getElementById('cron-hour').value || '*';

                const day = document.getElementById('cron-day').value || '*';

                const month = document.getElementById('cron-month').value || '*';

                const weekday = document.getElementById('cron-weekday').value || '*';

                const schedule = `${min} ${hour} ${day} ${month} ${weekday}`;

                const command = document.getElementById('task-command').value;



                if (!name || !command) {

                    alert('Please fill in Task Name and Command');

                    return;

                }



                showLoader("Updating Task...", "Modifying cron job...");

                try {

                    // Delete old task

                    await ipcRenderer.invoke('ssh:delete-cron', oldRaw);



                    // Add new task

                    const res = await ipcRenderer.invoke('ssh:add-cron', { name, schedule, command });

                    if (res.success) {

                        alert('Task updated successfully!');

                        closeTaskModal();

                        loadTasks();

                    } else {

                        alert('Failed to update task: ' + res.error);

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function generateScript() {

                const description = document.getElementById('script-description').value;

                const apiKey = document.getElementById('gemini-key')?.value || '';



                if (!description) {

                    alert('Please describe what the script should do.');

                    return;

                }



                // API key is optional - will be fetched from Supabase if not provided

                if (apiKey) {

                    geminiApiKey = apiKey;

                    // API key not persisted locally

                }



                const btn = document.getElementById('btn-generate-script');

                btn.disabled = true;

                btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i>Analyzing server...';



                try {

                    // First, gather server context for smarter script generation

                    let serverContext = null;

                    try {

                        btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i>Scanning server...';

                        const contextRes = await ipcRenderer.invoke('ssh:get-server-context');

                        if (contextRes.success) {

                            serverContext = contextRes.context;

                        }

                    } catch (e) {

                        console.log('Could not get server context:', e.message);

                    }



                    btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i>Generating script...';



                    // Call the generate script handler with context

                    const res = await ipcRenderer.invoke('ssh:generate-script', {

                        description,

                        apiKey,

                        serverContext

                    });



                    if (res.success) {

                        document.getElementById('generated-script').value = res.script;

                        document.getElementById('generated-script-container').classList.remove('hidden');



                        // Auto-suggest a save path based on task name

                        const taskName = document.getElementById('task-name').value || 'script';

                        const filename = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.sh';

                        const savePath = document.getElementById('script-save-path');

                        if (savePath && !savePath.value) {

                            savePath.value = `/ home / ${serverContext?.user || 'ubuntu'} /scripts/${filename} `;

                        }

                    } else {

                        alert('Failed to generate script: ' + res.error);

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    btn.disabled = false;

                    btn.innerHTML = '<i class="fas fa-wand-magic-sparkles mr-2"></i>Generate';

                }

            }





            async function saveGeneratedScript() {

                const script = document.getElementById('generated-script').value;

                const customPath = document.getElementById('script-save-path').value.trim();

                const taskName = document.getElementById('task-name').value || 'task';



                let savePath;

                if (customPath) {

                    // Use custom path provided by user

                    savePath = customPath;

                } else {

                    // Generate default path

                    const filename = taskName.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_' + Date.now() + '.sh';

                    savePath = `~/.devyntra/scripts / ${filename} `;

                }



                showLoader("Saving Script...", "Uploading to server...");

                try {

                    // Save using the full path

                    const b64 = btoa(script);

                    const saveCmd = `mkdir - p $(dirname ${savePath}) && echo "${b64}" | base64 - d > ${savePath} && chmod + x ${savePath} && echo ${savePath} `;

                    const res = await ipcRenderer.invoke('ssh:exec', saveCmd);



                    if (res && res.code === 0) {

                        const fullPath = res.stdout.trim();

                        document.getElementById('task-command').value = fullPath;

                        alert(`Script saved to: ${fullPath} \n\nThe command field has been updated.`);

                    } else {

                        // Fallback to the save-script handler

                        const filename = savePath.split('/').pop();

                        const res2 = await ipcRenderer.invoke('ssh:save-script', { filename, content: script });

                        if (res2.success) {

                            document.getElementById('task-command').value = res2.path;

                            alert(`Script saved to: ${res2.path} \n\nThe command field has been updated.`);

                        } else {

                            alert('Failed to save script: ' + (res2.error || 'Unknown error'));

                        }

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }







            // Wait for DOM to be ready before initializing floating terminal

            document.addEventListener('DOMContentLoaded', () => {

            });





            // FLOATING TERMINAL REMOVED

            // --- DEPLOYMENT LOGIC ---

            let selectedDeploySource = null;

            let selectedUploadFiles = null;



            function loadDeployView() {

                selectedDeploySource = null;

                selectedUploadFiles = null;

                const config = document.getElementById('deploy-config');

                if (config) {

                    config.classList.add('hidden');

                    config.innerHTML = '';

                }

                document.querySelectorAll('.deploy-source-card').forEach(el => {

                    el.classList.remove('border-indigo-500', 'bg-indigo-50', 'ring-2', 'ring-indigo-200');

                    el.classList.add('border-transparent', 'bg-gray-50');

                });

            }



            function selectDeploySource(source) {
                selectedDeploySource = source;



                let sourceTitle = 'Server Directory', sourceDesc = 'Host path', sourceIcon = 'fa-folder-tree', sourceTheme = 'emerald', sourceHtml = '';

                if (source === 'github') {
                    sourceTitle = 'Git Repo'; sourceDesc = 'Remote codebase'; sourceIcon = 'fa-git-alt'; sourceTheme = 'slate';
                    sourceHtml = `
                        <div class="space-y-4">
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-link"></i> Repository URL</label>
                                    <input type="text" id="deploy-source-url" placeholder="https://github.com/user/repo.git" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-bold text-slate-800">
                                </div>
                                <div>
                                    <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-code-branch"></i> Branch</label>
                                    <input type="text" id="deploy-branch" value="main" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-bold text-slate-800">
                                </div>
                            </div>
                            <div>
                                <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-key"></i> Personal Access Token (Optional)</label>
                                <input type="password" id="deploy-source-token" placeholder="ghp_xxxxxxxxxxxx" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-indigo-500/20 transition-all text-sm font-bold text-slate-800">
                                <p class="text-[9px] text-slate-400 mt-1.5 font-medium italic">Required for private repositories</p>
                            </div>
                        </div>`;
                } else if (source === 'path') {
                    sourceHtml = `
                        <div>
                            <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-folder"></i> Folder Path</label>
                            <div class="flex gap-2">
                                <input type="text" id="deploy-source-path" placeholder="/var/www/app" class="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition-all text-sm font-mono font-bold text-slate-800">
                                <button onclick="openServerBrowser()" class="px-5 bg-emerald-50 text-emerald-600 rounded-xl font-black border border-emerald-100 hover:bg-emerald-100 transition-all text-[10px] uppercase tracking-widest">Browse</button>
                            </div>
                        </div>`;
                } else if (source === 'upload') {
                    sourceTitle = 'Upload ZIP'; sourceDesc = 'Direct upload'; sourceIcon = 'fa-cloud-upload-alt'; sourceTheme = 'amber';
                    sourceHtml = `
                        <div class="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-6 text-center cursor-pointer hover:bg-amber-50 group" onclick="document.getElementById('deploy-upload-input').click()">
                            <i class="fas fa-file-archive text-2xl text-amber-500 mb-2"></i>
                            <p class="text-xs font-bold text-slate-700">Click to select archive</p>
                            <input type="file" id="deploy-upload-input" class="hidden" webkitdirectory directory onchange="handleDeployFileUpload(this)">
                            <div id="deploy-file-name" class="mt-2 text-[10px] font-black text-amber-600 hidden"></div>
                        </div>`;
                }

                document.getElementById('deploy-main-content').innerHTML = `
                    <div class="fade-in-up space-y-6">
                        <div class="bg-white rounded-3xl p-8 border border-slate-200 shadow-xl shadow-slate-200/20">
                            <h3 class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-6 border-b pb-3 flex items-center gap-2"><i class="fas fa-terminal"></i> Source Config</h3>
                            ${sourceHtml}

                            <h3 class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-8 mb-6 border-b pb-3 flex items-center gap-2"><i class="fas fa-microchip"></i> Environment</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div><label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-tag text-[8px]"></i> App Name *</label><input type="text" id="deploy-name" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-sm font-bold"></div>
                                <div class="grid grid-cols-2 gap-4">
                                    <div><label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-plug text-[8px]"></i> Port</label><input type="number" id="deploy-port" placeholder="3000" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-sm font-bold"></div>
                                    <div class="relative">
                                        <label class="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5 flex items-center gap-2"><i class="fas fa-dna text-[8px]"></i> Manager</label>
                                        <div class="relative flex items-center">
                                            <select id="deploy-manager" class="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white text-sm font-bold appearance-none pr-10">
                                                <option value="systemd">Systemd</option>
                                                <option value="pm2">PM2</option>
                                            </select>
                                            <div class="absolute inset-y-0 right-0 flex items-center pr-4 pointer-events-none text-slate-400">
                                                <i class="fas fa-chevron-down text-[10px]"></i>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <h3 class="text-[10px] font-black text-indigo-500 uppercase tracking-widest mt-8 mb-6 border-b pb-3 flex items-center gap-2"><i class="fas fa-gear"></i> Options</h3>
                            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <label class="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 cursor-pointer group hover:bg-white hover:border-indigo-200 transition-all">
                                    <input type="checkbox" id="deploy-deps" checked class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500">
                                    <div><span class="block text-xs font-black text-slate-700">Install Dependencies</span><p class="text-[10px] text-slate-400 font-medium">Auto run npm/pip install</p></div>
                                </label>
                                <label class="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 cursor-pointer group hover:bg-white hover:border-indigo-200 transition-all">
                                    <input type="checkbox" id="deploy-update" checked class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500">
                                    <div><span class="block text-xs font-black text-slate-700">System Update</span><p class="text-[10px] text-slate-400 font-medium">Update OS packages</p></div>
                                </label>
                                <label class="flex items-center gap-3 p-4 rounded-2xl border border-slate-100 bg-slate-50/50 cursor-pointer group hover:bg-white hover:border-indigo-200 transition-all">
                                    <input type="checkbox" id="deploy-restart" checked class="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500">
                                    <div><span class="block text-xs font-black text-slate-700">Auto Restart</span><p class="text-[10px] text-slate-400 font-medium">On boot or app crash</p></div>
                                </label>
                            </div>

                            <div class="mt-10 pt-8 border-t border-slate-100 flex justify-end">
                                <button onclick="startDeployment()" class="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl hover:bg-indigo-600 transition-all hover:-translate-y-1 flex items-center gap-3">
                                    Initiate Pipeline <i class="fas fa-arrow-right text-[10px]"></i>
                                </button>
                            </div>
                        </div>
                    </div>`;
            }      // Add CSS for slide up and custom toggle
            if (!document.getElementById('deploy-custom-styles')) {
                const style = document.createElement('style');
                style.id = 'deploy-custom-styles';
                style.innerHTML = `
                @keyframes slideUp {
                            from { opacity: 0; transform: translateY(20px); }
                            to { opacity: 1; transform: translateY(0); }
                }
                `;
                document.head.appendChild(style);
            }

            function handleDeployFileUpload(input) {
                if (input.files.length > 0) {
                    selectedUploadFiles = input.files;
                    const fileNameEl = document.getElementById('deploy-file-name');
                    if (fileNameEl) {
                        fileNameEl.innerText = `${input.files.length} files selected`;
                        fileNameEl.classList.remove('hidden');
                    }
                }
            }

            async function startDeployment() {
                const nameCheck = document.getElementById('deploy-name');
                if (!nameCheck) return;

                const name = nameCheck.value;
                const port = document.getElementById('deploy-port').value;
                const manager = document.getElementById('deploy-manager').value;

                if (!name) {
                    alert('Please enter Application Name');
                    return;
                }

                const config = {
                    name, port, manager,
                    autostart: true,
                    installDeps: document.getElementById('deploy-deps').checked,
                    runUpdate: document.getElementById('deploy-update').checked,
                    autoRestart: document.getElementById('deploy-restart').checked,
                    sourceType: selectedDeploySource
                };

                if (selectedDeploySource === 'github') {
                    config.repoUrl = document.getElementById('deploy-source-url').value;
                    config.branch = document.getElementById('deploy-branch').value;
                    config.token = document.getElementById('deploy-source-token').value;
                    if (!config.repoUrl) return alert("Repo URL required");
                } else if (selectedDeploySource === 'path') {
                    config.serverPath = document.getElementById('deploy-source-path').value;
                    if (!config.serverPath) return alert("Path required");
                } else if (selectedDeploySource === 'upload') {
                    alert("Upload deployment support coming soon. Please use Git or Server Path.");
                    return;
                }

                showLoader('Deploying Application...', 'Running setup scripts...');

                try {
                    const result = await ipcRenderer.invoke('ssh:deploy-app', config);
                    if (result.success) {
                        const finalPort = result.port || port;
                        alert(`Deployment Successful!\n\nApp is running on port ${finalPort}.\n\nEnsure your security group allows traffic on port ${finalPort}.`);
                        navigate('manage-apps');
                    } else {
                        alert(`Deployment Failed: ${result.error} `);
                    }
                } catch (e) {
                    alert(`Error: ${e.message} `);
                } finally {
                    hideLoader();
                }
            }



            // --- SERVER BROWSER LOGIC ---

            let currentBrowserPath = '.';



            function openServerBrowser() {

                const modal = document.getElementById('browser-modal');

                if (modal) modal.classList.remove('hidden');

                loadBrowserPath(currentBrowserPath);

            }



            function closeServerBrowser() {

                const modal = document.getElementById('browser-modal');

                if (modal) modal.classList.add('hidden');

            }



            async function loadBrowserPath(path) {

                const listContainer = document.getElementById('browser-file-list');

                const pathDisplay = document.getElementById('browser-current-path');



                if (listContainer) listContainer.innerHTML = `< div class="text-center py-8" > <i

                    class="fas fa-circle-notch fa-spin text-indigo-600 text-2xl"></i></div > `;



                try {

                    // Use existing ssh:list-files handler

                    const res = await ipcRenderer.invoke('ssh:list-files', path);



                    if (res.success) {

                        currentBrowserPath = res.path;

                        if (pathDisplay) pathDisplay.innerText = res.path || '/';



                        let html = '';

                        if (res.files && res.files.length > 0) {

                            // Sort directories first

                            res.files.sort((a, b) => (a.isDirectory === b.isDirectory) ? 0 : a.isDirectory ? -1 : 1);



                            res.files.forEach(f => {

                                const icon = f.isDirectory ? 'fa-folder text-yellow-500' : 'fa-file-code text-gray-400';

                                // Construct path carefully

                                const fullPath = (res.path === '/') ? `/ ${f.name} ` : `${res.path}/${f.name}`;

                                // Only directories are clickable

                                const action = f.isDirectory ? `onclick="loadBrowserPath('${fullPath.replace(/'/g, "\\'")}')"` : '';

                                const cursor = f.isDirectory ? 'cursor-pointer hover:bg-indigo-50' : 'opacity-60 cursor-default';



                                html += `

    <div class="flex items-center p-3 rounded-lg ${cursor} text-sm border-b border-gray-50 last:border-0 transition-colors"

        ${action}>

        <div class="w-8 text-center text-lg mr-3"><i class="fas ${icon}"></i></div>

        <div class="flex-1 truncate font-medium text-gray-700">${f.name}</div>

        <div class="text-xs text-gray-400 w-24 text-right font-mono">${f.size || '-'}</div>

    </div>

    `;

                            });

                        } else {

                            html = '<div class="text-gray-400 text-center py-8 text-sm italic">Empty Directory</div>';

                        }



                        if (listContainer) listContainer.innerHTML = html;

                    } else {

                        if (listContainer) listContainer.innerHTML = `<div class="text-red-500 p-4 text-sm bg-red-50 rounded">Error:

        ${res.error}</div>`;

                    }

                } catch (e) {

                    if (listContainer) listContainer.innerHTML = `<div class="text-red-500 p-4 text-sm bg-red-50 rounded">Error:

        ${e.message}</div>`;

                }

            }



            function browseParent() {

                if (currentBrowserPath === '/' || currentBrowserPath === '.') return loadBrowserPath('/');

                if (!currentBrowserPath.includes('/')) return loadBrowserPath('/');



                const parts = currentBrowserPath.split('/');

                while (parts.length > 0 && !parts[parts.length - 1]) parts.pop(); // Remove trailing empty

                parts.pop(); // Go up

                const parent = parts.join('/') || '/';

                loadBrowserPath(parent);

            }



            function selectCurrentFolder() {

                const input = document.getElementById('deploy-source-path');

                if (input) input.value = currentBrowserPath;

                closeServerBrowser();

            }







            // --- INTERCEPT COMMANDS ---

            // Proxy the IPC invoke method to catch all ssh:execute calls

            const originalInvoke = ipcRenderer.invoke;

            ipcRenderer.invoke = async function (channel, ...args) {

                let cmdStr = '';



                if (channel === 'ssh:execute') {

                    cmdStr = args[0];

                } else if (channel === 'ssh:zip-file') {

                    cmdStr = `zip-file target=${args[0].targetPath} out=${args[0].outputPath}`;

                } else if (channel === 'ssh:unzip-file') {

                    cmdStr = `unzip-file archive=${args[0].archivePath} dest=${args[0].destDir}`;

                } else if (channel === 'ssh:connect') {

                    cmdStr = `ssh connect ${args[0].host}`;

                }



                if (cmdStr) {

                    try {

                        const result = await originalInvoke.call(ipcRenderer, channel, ...args);



                        let isSuccess = true;

                        // Check for error properties in result

                        if (result && typeof result === 'object') {

                            if (result.success === false) isSuccess = false;

                            if (result.error) isSuccess = false;

                            // Inspect nested data for exit code (ssh-client exec result)

                            if (result.data && typeof result.data.code === 'number' && result.data.code !== 0) {

                                isSuccess = false;

                            }

                        }



                        if (typeof addToGlobalLog === 'function') addToGlobalLog(cmdStr, isSuccess);

                        return result;

                    } catch (e) {

                        if (typeof addToGlobalLog === 'function') addToGlobalLog(cmdStr, false);

                        throw e;

                    }

                } else {

                    return originalInvoke.call(ipcRenderer, channel, ...args);

                }

            };







            // --- AI FILE OPERATIONS ---

            function showAIInputModal(title, placeholder, onConfirm) {

                const id = 'ai-input-modal-' + Date.now();

                const modal = document.createElement('div');

                modal.id = id;

                modal.className = "fixed inset-0 bg-black/80 z-[100] flex items-center justify-center backdrop-blur-sm fade-in";

                modal.innerHTML = `

                <div class="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-lg overflow-hidden">

                     <div class="bg-indigo-50 px-6 py-4 border-b border-indigo-100 flex justify-between items-center">

                        <div class="flex items-center gap-3">

                            <div class="bg-white p-2 rounded-lg text-purple-600 shadow-sm"><i class="fas fa-robot"></i></div>

                            <h3 class="text-indigo-900 font-bold text-lg">${title}</h3>

                        </div>

                        <button onclick="document.getElementById('${id}').remove()" class="text-gray-400 hover:text-gray-600 transition-colors"><i class="fas fa-times"></i></button>

                    </div>

                    <div class="p-6">

                        <textarea id="${id}-input" class="w-full bg-gray-50 border border-gray-300 text-gray-900 rounded-lg p-3 text-sm focus:border-purple-500 outline-none h-32 mb-6 resize-none" placeholder="${placeholder}" autofocus></textarea>

                        <div class="flex justify-end gap-3">

                            <button onclick="document.getElementById('${id}').remove()" class="px-4 py-2 bg-white text-gray-700 rounded-lg text-sm hover:bg-gray-50 font-bold border border-gray-300 shadow-sm">Cancel</button>

                            <button id="${id}-btn" class="px-6 py-2 bg-gradient-to-r from-purple-600 to-indigo-600 text-white rounded-lg text-sm font-bold hover:shadow-lg transition-all flex items-center shadow-purple-200">

                                <i class="fas fa-magic mr-2"></i>Generate

                            </button>

                        </div>

                    </div>

                </div>

            `;

                document.body.appendChild(modal);



                const btn = document.getElementById(`${id}-btn`);

                const input = document.getElementById(`${id}-input`);



                // Auto focus

                setTimeout(() => input.focus(), 50);



                btn.onclick = async () => {

                    const prompt = input.value.trim();

                    if (!prompt) return;



                    btn.disabled = true;

                    btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Thinking...';

                    input.disabled = true;



                    await onConfirm(prompt, id);

                };

            }



            function openAICreateFileModal() {

                showAIInputModal("AI Create File", "Describe the file you want to create (e.g. 'Create a python script hello.py that calculates fibonacci')", async (prompt, modalId) => {

                    const contextPrompt = `I am in directory '${currentFilesPath}'. ${prompt}`;



                    if (!cachedServerContext) {

                        try { const ctx = await ipcRenderer.invoke('ssh:get-server-context'); if (ctx.success) cachedServerContext = ctx.context; } catch (e) { }

                    }



                    try {

                        const res = await ipcRenderer.invoke('ssh:ai-command', { prompt: contextPrompt, serverContext: cachedServerContext, chatHistory: [] });

                        document.getElementById(modalId).remove();



                        if (res.success && res.command) {

                            // EXECUTE DIRECTLY (No Confirmation)

                            showLoader("AI Creating...", "Executing generated command...");

                            try {

                                const execRes = await ipcRenderer.invoke('ssh:execute', res.command);

                                if (execRes.success) {

                                    loadFiles(currentFilesPath); // Refresh

                                } else {

                                    alert("Failed to execute creation command: " + execRes.error);

                                }

                            } catch (ex) {

                                alert("Execution Error: " + ex.message);

                            } finally {

                                hideLoader();

                            }

                        } else {

                            alert("AI Generation Failed: " + res.error);

                        }

                    } catch (e) {

                        alert("Error: " + e.message);

                        document.getElementById(modalId)?.remove();

                    }

                });

            }



            function openAIEditFileModal() {

                if (selectedFiles.size !== 1) { alert("Please select exactly one file to edit."); return; }

                const filename = Array.from(selectedFiles)[0];

                const fullpath = (currentFilesPath === '/' ? '' : currentFilesPath) + '/' + filename;



                showAIInputModal("AI Edit File: " + filename, "How should I change this file? (e.g. 'Add error logging to the main function')", async (prompt, modalId) => {

                    try {

                        const readRes = await ipcRenderer.invoke('ssh:read-file', fullpath);

                        if (!readRes.success) throw new Error(readRes.error);



                        if (!cachedServerContext) { try { const ctx = await ipcRenderer.invoke('ssh:get-server-context'); if (ctx.success) cachedServerContext = ctx.context; } catch (e) { } }



                        const truncatedContent = readRes.content.length > 5000 ? readRes.content.slice(0, 5000) + "\n... (truncated)" : readRes.content;

                        const aiDesc = `Update file ${fullpath}. \nOriginal Content:\n${truncatedContent}\n\nUser Request: ${prompt}`;



                        const res = await ipcRenderer.invoke('ssh:generate-script', { description: aiDesc, apiKey: null, serverContext: cachedServerContext });



                        document.getElementById(modalId).remove();



                        if (res.success && res.script) {

                            // EXECUTE DIRECTLY (No Confirmation)

                            showLoader("AI Editing...", "Applying changes to file...");

                            try {

                                const execRes = await ipcRenderer.invoke('ssh:execute', res.script);

                                if (execRes.success) {

                                    loadFiles(currentFilesPath); // Refresh

                                } else {

                                    alert("Failed to execute edit script: " + execRes.error);

                                }

                            } catch (ex) {

                                alert("Execution Error: " + ex.message);

                            } finally {

                                hideLoader();

                            }

                        } else {

                            alert("AI Failed: " + (res.error || 'Unknown'));

                        }



                    } catch (e) {

                        alert("Error: " + e.message);

                        document.getElementById(modalId)?.remove();

                    }

                });

            }



            function showSuccessResultModal(title, message, actionBtnText, onAction) {

                const id = 'ai-result-modal-' + Date.now();

                const modal = document.createElement('div');

                modal.id = id;

                modal.className = "fixed inset-0 bg-gray-900/50 z-[100] flex items-center justify-center backdrop-blur-sm fade-in";

                modal.innerHTML = `

                <div class="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform scale-100 transition-all">

                     <div class="p-6 text-center">

                        <div class="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-4 text-green-600 text-3xl shadow-sm">

                            <i class="fas fa-check"></i>

                        </div>

                        <h3 class="text-gray-900 font-bold text-lg mb-2">${title}</h3>

                        <p class="text-gray-600 text-sm mb-6">${message}</p>

                        

                        <button id="${id}-btn" class="w-full px-4 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all active:scale-95">

                            ${actionBtnText || 'OK'}

                        </button>

                     </div>

                </div>

             `;

                document.body.appendChild(modal);



                document.getElementById(`${id}-btn`).onclick = () => {

                    document.getElementById(id).remove();

                    if (onAction) onAction();

                };

            }



            function showExecutionConfirmation(userRequest, command, onSuccess) {

                const id = 'ai-exec-modal-' + Date.now();

                const modal = document.createElement('div');

                modal.id = id;

                modal.className = "fixed inset-0 bg-gray-900/50 z-[100] flex items-center justify-center backdrop-blur-sm fade-in";

                modal.innerHTML = `

                <div class="bg-white border border-gray-200 rounded-xl shadow-2xl w-full max-w-sm overflow-hidden transform scale-100 transition-all">

                     <div class="p-6 text-center">

                        <div class="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600 text-2xl shadow-sm">

                            <i class="fas fa-robot"></i>

                        </div>

                        <h3 class="text-gray-900 font-bold text-lg mb-2">Ready to Execute</h3>

                        <p class="text-gray-500 text-sm mb-6">Permission to proceed with: <br><span class="font-bold text-indigo-700">"${userRequest}"</span>?</p>

                        

                        <div class="flex gap-3">

                             <button onclick="document.getElementById('${id}').remove()" class="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50">Cancel</button>

                             <button id="${id}-run" class="flex-1 px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200">

                                Proceed

                             </button>

                        </div>

                        

                        <div class="mt-4 pt-4 border-t border-gray-100">

                            <details class="text-left group">

                                <summary class="text-xs text-gray-400 cursor-pointer hover:text-indigo-600 flex items-center justify-center gap-1 list-none">

                                    <span>View Command</span> <i class="fas fa-chevron-down group-open:rotate-180 transition-transform"></i>

                                </summary>

                                <div class="mt-2 relative">

                                    <pre class="bg-gray-50 border border-gray-200 rounded p-2 text-[10px] text-gray-600 font-mono overflow-x-auto overflow-y-auto max-h-64 whitespace-pre-wrap">${escapeHtml(command)}</pre>

                                </div>

                            </details>

                        </div>

                     </div>

                </div>

             `;

                document.body.appendChild(modal);



                document.getElementById(`${id}-run`).onclick = async () => {

                    document.getElementById(id).remove();



                    showLoader("AI Executing...", "Running command...");

                    try {

                        const res = await ipcRenderer.invoke('ssh:execute', command);

                        if (res.success) {

                            if (onSuccess) {

                                onSuccess();

                            } else {

                                // Default refresh behavior

                                const nav = document.querySelector(`button[onclick="navigate('${currentView}')"]`);

                                if (nav) nav.click();

                                // Also Files logic fallback

                                if (typeof loadFiles === 'function' && currentView === 'files') loadFiles(currentFilesPath);

                            }

                        } else {

                            alert("Execution Failed: " + res.error);

                        }

                    } catch (e) { alert("Error: " + e.message); } finally { hideLoader(); }

                };

            }



            function openAIAppsModal() {

                showAIInputModal("AI App Manager", "What do you want to start, stop, or install? (e.g. 'Install Docker', 'Restart Nginx')", async (prompt, modalId) => {

                    if (!cachedServerContext) { try { const ctx = await ipcRenderer.invoke('ssh:get-server-context'); if (ctx.success) cachedServerContext = ctx.context; } catch (e) { } }



                    // Force AI to generate a summary comment

                    const contextPrompt = `Manage Applications: ${prompt}.

                

                IMPORTANT INSTRUCTION:

                You MUST include a comment line near the top of the script in EXACTLY this format:

                # SUMMARY: [A short, clear summary of what this script does]

                Example: # SUMMARY: Installing Docker and dependencies

                `;



                    try {

                        const res = await ipcRenderer.invoke('ssh:ai-command', {

                            prompt: contextPrompt,

                            serverContext: cachedServerContext,

                            mode: 'script' // Use script mode to allow comments

                        });

                        document.getElementById(modalId).remove();



                        if (res.success && res.command) {

                            let summary = prompt;

                            const command = res.command;



                            // Parse Summary

                            const summaryMatch = command.match(/^#\s*SUMMARY:\s*(.+)$/m);

                            if (summaryMatch && summaryMatch[1]) {

                                summary = summaryMatch[1].trim();

                            }



                            showExecutionConfirmation(summary, command, () => {

                                showSuccessResultModal("Action Completed", "The requested action executed successfully.", "View Apps", () => navigate('apps'));

                            });

                        } else {

                            alert("AI Error: " + res.error);

                        }

                    } catch (e) { alert("Error: " + e.message); document.getElementById(modalId)?.remove(); }

                });

            }



            function openAIDashboardModal() {

                showAIInputModal("AI Assistant", "Ask about your server status, or request an action.", async (prompt, modalId) => {

                    if (!cachedServerContext) { try { const ctx = await ipcRenderer.invoke('ssh:get-server-context'); if (ctx.success) cachedServerContext = ctx.context; } catch (e) { } }



                    const contextPrompt = `${prompt}.

                

                IMPORTANT INSTRUCTION:

                You MUST include a comment line near the top of the script in EXACTLY this format:

                # SUMMARY: [A short, clear summary of what this script does]

                `;



                    try {

                        const res = await ipcRenderer.invoke('ssh:ai-command', {

                            prompt: contextPrompt,

                            serverContext: cachedServerContext,

                            mode: 'script'

                        });

                        document.getElementById(modalId).remove();



                        if (res.success && res.command) {

                            let summary = prompt;

                            const command = res.command;



                            // Parse Summary

                            const summaryMatch = command.match(/^#\s*SUMMARY:\s*(.+)$/m);

                            if (summaryMatch && summaryMatch[1]) {

                                summary = summaryMatch[1].trim();

                            }



                            showExecutionConfirmation(summary, command, () => {

                                showSuccessResultModal("Task Completed", "The AI command ran successfully.", "OK");

                            });

                        } else {

                            alert("AI Error: " + res.error);

                        }

                    } catch (e) { alert("Error: " + e.message); document.getElementById(modalId)?.remove(); }

                });

            }



            function openAIDeployModal() {

                showAIInputModal("AI Deployment Helper", "Paste a Git URL or describe the app stack you want to deploy.", async (prompt, modalId) => {

                    if (!cachedServerContext) { try { const ctx = await ipcRenderer.invoke('ssh:get-server-context'); if (ctx.success) cachedServerContext = ctx.context; } catch (e) { } }



                    const contextPrompt = `Suggest deployment steps or commands for: ${prompt}. Focus on initial setup.

                

                IMPORTANT INSTRUCTION:

                You MUST include a comment line near the top of the script in EXACTLY this format:

                # SUMMARY: [A short, clear summary of what this script does]

                Example: # SUMMARY: Deploying application from GitHub

                `;



                    try {

                        const res = await ipcRenderer.invoke('ssh:ai-command', {

                            prompt: contextPrompt,

                            serverContext: cachedServerContext,

                            mode: 'script'

                        });

                        document.getElementById(modalId).remove();



                        if (res.success && res.command) {

                            let summary = prompt;

                            const command = res.command;



                            // Parse Summary

                            const summaryMatch = command.match(/^#\s*SUMMARY:\s*(.+)$/m);

                            if (summaryMatch && summaryMatch[1]) {

                                summary = summaryMatch[1].trim();

                            }



                            showExecutionConfirmation(summary, command, () => {

                                showSuccessResultModal(

                                    "Deployment Complete",

                                    "Your application has been deployed successfully. You can now manage it in the Applications dashboard.",

                                    "Go to Applications",

                                    () => navigate('apps')

                                );

                            });

                        } else {

                            alert("AI Error: " + res.error);

                        }

                    } catch (e) { alert("Error: " + e.message); document.getElementById(modalId)?.remove(); }

                });

            }



            // --- CHAT INTERFACE LOGIC ---

            let copilotHistory = [];

            let pendingChatMessage = null; // For dashboard quick action



            function handleQuickAction(value) {
                value = value?.trim();
                if (!value) return;
                pendingChatMessage = value;
                toggleDevAI();
            }

            function toggleDevAI() {
                const panel = document.getElementById('devai-inline-panel');
                if (!panel) return;

                const isOpen = panel.style.maxWidth !== '0px' && panel.style.maxWidth !== '0';
                if (isOpen) {
                    // Close panel
                    panel.style.maxWidth = '0';
                    panel.classList.remove('border-l');
                    panel.classList.add('border-l-0');
                } else {
                    // Open panel
                    panel.style.maxWidth = '840px';
                    panel.classList.add('border-l');
                    panel.classList.remove('border-l-0');
                    // Initialize chat
                    if (typeof loadChat === 'function') loadChat();
                }
            }



            // --- DEVAI HISTORY LOGIC ---

            function toggleHistoryDrawer() {

                const drawer = document.getElementById('chat-history-drawer');

                if (!drawer) return;

                const isOpen = !drawer.classList.contains('translate-x-full');

                if (isOpen) {

                    drawer.classList.add('translate-x-full');

                } else {

                    drawer.classList.remove('translate-x-full');

                    loadHistoryFromDb(); // Fetch latest

                }

            }



            async function loadHistoryFromDb() {

                const list = document.getElementById('history-list');

                if (!list) return;



                try {

                    const { data: { user } } = await supabase.auth.getUser();

                    if (!user) {

                        list.innerHTML = '<div class="py-10 text-center text-gray-400 text-xs font-medium">Please sign in to view history.</div>';

                        return;

                    }



                    const { data, error } = await supabase

                        .from('copilot_history')

                        .select('*')

                        .eq('user_id', user.id)

                        .order('created_at', { ascending: false })

                        .limit(30);



                    if (error) throw error;



                    if (!data || data.length === 0) {

                        list.innerHTML = '<div class="py-10 text-center text-gray-400 text-xs font-medium italic">No previous activity found.</div>';

                        return;

                    }



                    const html = data.map(item => `

                    <div class="p-3 bg-white border border-gray-100 rounded-xl hover:border-indigo-200 hover:shadow-sm transition-all cursor-pointer group" onclick="loadChatSession('${item.created_at}')">

                        <div class="flex items-center justify-between mb-1">

                            <span class="text-[10px] font-bold text-indigo-500 uppercase tracking-wider">${item.role === 'user' ? 'Request' : 'Response'}</span>

                            <span class="text-[9px] text-gray-400">${new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>

                        </div>

                        <p class="text-[11px] text-gray-600 line-clamp-2 leading-relaxed font-medium">${escapeHtml(item.text).substring(0, 80)}${item.text.length > 80 ? '...' : ''}</p>

                        ${item.is_action ? `<div class="mt-2 flex items-center gap-1.5 text-[9px] font-bold text-emerald-600"><i class="fas fa-bolt"></i> <span>Executed Action</span></div>` : ''}

                    </div>

                `).join('');



                    list.innerHTML = html;



                    // Also update welcome screen list if it exists

                    const welcomeList = document.getElementById('welcome-history-list');

                    if (welcomeList) {

                        welcomeList.innerHTML = data.slice(0, 3).map(item => `

                        <div class="p-3 bg-white/50 border border-gray-100/50 rounded-xl hover:bg-white hover:border-indigo-200 transition-all cursor-pointer group flex items-center gap-3" onclick="loadChatSession('${item.created_at}')">

                            <div class="w-7 h-7 rounded-lg bg-${item.role === 'user' ? 'indigo' : 'emerald'}-50 flex items-center justify-center text-${item.role === 'user' ? 'indigo' : 'emerald'}-600 shrink-0">

                                <i class="fas fa-${item.role === 'user' ? 'comment-alt' : 'robot'} text-[10px]"></i>

                            </div>

                            <div class="flex-1 min-w-0">

                                <p class="text-[11px] text-gray-600 truncate font-medium">${escapeHtml(item.text)}</p>

                                <p class="text-[9px] text-gray-400 font-bold uppercase tracking-widest mt-0.5">${new Date(item.created_at).toLocaleDateString()}</p>

                            </div>

                            <i class="fas fa-chevron-right text-[8px] text-gray-300 group-hover:text-indigo-500 transition-colors"></i>

                        </div>

                    `).join('') || '<div class="py-4 text-center text-gray-300 text-[11px] italic font-medium">No recent activity</div>';

                    }



                } catch (e) {

                    console.error("History fetch error", e);

                    list.innerHTML = `<div class="py-10 text-center text-red-400 text-xs font-medium">Sync Error: ${e.message}</div>`;

                }

            }



            async function saveChatMessageToDb(role, text, isAction = false, summary = '') {

                try {

                    const { data: { user } } = await supabase.auth.getUser();

                    if (!user) return;



                    const payload = {

                        user_id: user.id,

                        server_host: connectedServerData?.host || 'local',

                        role: role,

                        text: text,

                        is_action: isAction,

                        summary: summary,

                        created_at: new Date().toISOString()

                    };



                    await supabase.from('copilot_history').insert(payload);

                } catch (e) {

                    console.error("Failed to save chat to DB", e);

                }

            }





            async function loadChat() {

                const container = document.getElementById('chat-messages');

                if (!container) return;



                const welcome = document.getElementById('chat-welcome');



                // 1. CLEAR CURRENT

                container.innerHTML = '';

                if (welcome) {

                    container.appendChild(welcome);

                    welcome.classList.remove('hidden');

                    welcome.classList.add('flex');

                }



                // 2. FETCH FROM DB (LATEST 20)

                try {

                    const { data: { user } } = await supabase.auth.getUser();

                    if (user) {

                        loadHistoryFromDb(); // Also refresh the activity lists

                        const { data, error } = await supabase

                            .from('copilot_history')

                            .select('*')

                            .eq('user_id', user.id)

                            .eq('server_host', connectedServerData?.host || 'local')

                            .order('created_at', { ascending: true })

                            .limit(20);



                        if (!error && data && data.length > 0) {

                            copilotHistory = data.map(item => ({

                                role: item.role,

                                text: item.text,

                                isAction: item.is_action,

                                summary: item.summary

                            }));



                            if (welcome) welcome.classList.add('hidden');



                            copilotHistory.forEach(msg => {

                                if (msg.role === 'ai' && msg.isAction) {

                                    renderActionCard(msg.summary, msg.text, false);

                                } else {

                                    renderChatBubble(msg.role, msg.text);

                                }

                            });

                            scrollToBottom();

                        }

                    }

                } catch (e) { console.error("History fetch error", e); }





                // ATTACH LISTENERS (Fix for 'Unable to send')

                const chatInput = document.getElementById('chat-input');

                if (chatInput && !chatInput.hasAttribute('data-listening')) {

                    chatInput.setAttribute('data-listening', 'true');

                    chatInput.addEventListener('input', function () {

                        this.style.height = 'auto';

                        this.style.height = (this.scrollHeight) + 'px';

                    });

                    chatInput.addEventListener('keydown', function (e) {

                        if (e.key === 'Enter' && !e.shiftKey) {

                            e.preventDefault();

                            sendChatMessage();

                        }

                    });

                    setTimeout(() => chatInput.focus(), 100);

                }



                // Check for pending message

                if (pendingChatMessage) {

                    const msg = pendingChatMessage;

                    pendingChatMessage = null;

                    setTimeout(() => {

                        const input = document.getElementById('chat-input');

                        if (input) {

                            input.value = msg;

                            sendChatMessage();

                        }

                    }, 200);

                }

            }



            async function loadChatSession(timestamp) {

                // For now, toggle and just refresh the whole view

                toggleHistoryDrawer();

                loadChat();

            }



            function scrollToBottom() {

                const container = document.getElementById('chat-messages');

                if (container) container.scrollTop = container.scrollHeight;

            }



            async function sendChatMessage() {

                console.log("Adding Chat Message...");

                const input = document.getElementById('chat-input');

                if (!input) {

                    console.error("Critical: Chat input element not found!");

                    alert("Interface Error: Chat input missing.");

                    return;

                }



                const prompt = input.value.trim();

                if (!prompt) {

                    console.log("Empty prompt, ignoring.");

                    return;

                }



                console.log("Sending prompt:", prompt);



                // Hide Welcome

                const welcome = document.getElementById('chat-welcome');

                if (welcome) { welcome.classList.add('hidden'); welcome.classList.remove('flex'); }



                try {

                    // UI Update

                    renderChatBubble('user', prompt);

                    input.value = '';

                    input.style.height = 'auto';



                    // Add user msg to history

                    copilotHistory.push({ role: 'user', text: prompt });

                    saveChatMessageToDb('user', prompt);



                    const loadingId = renderLoadingBubble();

                    scrollToBottom();



                    if (!cachedServerContext) { try { const ctx = await ipcRenderer.invoke('ssh:get-server-context'); if (ctx.success) cachedServerContext = ctx.context; } catch (e) { } }



                    // Chat-focused query

                    const contextPrompt = prompt;



                    // Prepare history for AI context (limited for tokens)

                    const apiHistory = copilotHistory.slice(-10).map(m => ({ role: m.role, text: m.text }));



                    const res = await ipcRenderer.invoke('ssh:ai-command', {

                        prompt: contextPrompt,

                        serverContext: cachedServerContext,

                        mode: 'chat',

                        chatHistory: apiHistory

                    });



                    removeChatBubble(loadingId);



                    if (res.success) {

                        // 1. Render Message (if any)

                        if (res.message) {

                            renderChatBubble('ai', res.message);

                            copilotHistory.push({ role: 'ai', text: res.message });

                            saveChatMessageToDb('ai', res.message);

                        }



                        // 2. Render Action/Command (if any)

                        if (res.action) {

                            let summary = "Server Action";

                            if (res.message && res.message.length < 50) summary = res.message;



                            const card = renderActionCard(summary, res.action);

                            if (res.navigateTo) {

                                card.setAttribute('data-navigate-to', res.navigateTo);

                            }

                            if (res.navigatePath) {

                                card.setAttribute('data-navigate-path', res.navigatePath);

                            }



                            // AUTO-EXECUTE if safe

                            if (res.safeToAutoRun) {

                                const btn = card.querySelector('button[onclick^="executeChatAction"]');

                                if (btn) {

                                    // Add a small delay for visual feedback

                                    setTimeout(() => {

                                        executeChatAction(btn.getAttribute('onclick').match(/'([^']+)'/)[1], btn);

                                    }, 100);

                                }

                            }



                            copilotHistory.push({ role: 'ai', text: res.action, isAction: true, summary: summary });

                            saveChatMessageToDb('ai', res.action, true, summary);

                        }



                        // Fallback: If neither

                        if (!res.message && !res.action) {

                            // Should not happen, but safe fallback

                            const msg = "I'm sorry, I couldn't generate a response.";

                            renderChatBubble('ai', msg);

                            copilotHistory.push({ role: 'ai', text: msg });

                        }



                    } else {

                        const errMsg = "I'm sorry, I couldn't generate a command for that. Error: " + (res.error || 'Unknown');

                        renderChatBubble('ai', errMsg);

                        copilotHistory.push({ role: 'ai', text: errMsg });

                    }

                } catch (e) {

                    console.error("Send Error:", e);

                    // Try to remove loading bubble even effectively

                    const loadingEls = document.querySelectorAll('[id^="loading-"]');

                    loadingEls.forEach(el => el.remove());



                    const errMsg = "System Error: " + e.message;

                    renderChatBubble('ai', errMsg);

                    copilotHistory.push({ role: 'ai', text: errMsg });

                }

                scrollToBottom();

            }



            // Deprecated: We now rely on Supabase

            function saveChatHistory() {

                // localStorage.setItem('copilot_chat_history', JSON.stringify(copilotHistory));

            }



            function renderChatBubble(role, text) {

                const container = document.getElementById('chat-messages');

                const msgDiv = document.createElement('div');

                msgDiv.className = "flex gap-4 items-start fade-in-up " + (role === 'user' ? 'flex-row-reverse' : '');



                // Avatars with Devyntra logo for AI

                let avatar = role === 'user'

                    ? `<div class="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-200/50 flex-shrink-0">

                     <i class="fas fa-user text-xs"></i>

                   </div>`

                    : `<img src="icon.png" alt="DevAI" class="w-9 h-9 rounded-full shadow-md shadow-indigo-100/50 flex-shrink-0 ring-2 ring-white object-cover">`;



                // Process text for AI (simple markdown)

                let processedText = escapeHtml(text);

                if (role === 'ai') {

                    // Convert markdown-like syntax

                    processedText = processedText

                        .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')

                        .replace(/\*(.+?)\*/g, '<em>$1</em>')

                        .replace(/`([^`]+)`/g, '<code class="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-sm font-mono">$1</code>')

                        .replace(/^### (.+)$/gm, '<h4 class="text-base font-bold text-gray-900 mt-3 mb-2">$1</h4>')

                        .replace(/^## (.+)$/gm, '<h3 class="text-lg font-bold text-gray-900 mt-4 mb-2">$1</h3>')

                        .replace(/^# (.+)$/gm, '<h2 class="text-xl font-bold text-gray-900 mt-4 mb-3">$1</h2>')

                        .replace(/\n/g, '<br>');

                }



                // Bubble styles

                let bubbleClass = role === 'user'

                    ? "bg-gradient-to-br from-indigo-600 to-violet-600 text-white rounded-2xl rounded-tr-md shadow-lg shadow-indigo-500/20"

                    : "bg-white border border-gray-100 text-gray-700 rounded-2xl rounded-tl-md shadow-sm";



                let contentClass = role === 'user'

                    ? "text-[15px] leading-relaxed"

                    : "text-[15px] leading-relaxed prose prose-sm prose-indigo max-w-none";



                msgDiv.innerHTML = `

                ${avatar}

                <div class="${bubbleClass} px-5 py-4 max-w-xl">

                    <div class="${contentClass}">${role === 'user' ? escapeHtml(text) : processedText}</div>

                </div>

            `;

                container.appendChild(msgDiv);

                return msgDiv;

            }



            function renderLoadingBubble() {

                const container = document.getElementById('chat-messages');

                const id = 'loading-' + Date.now();

                const msgDiv = document.createElement('div');

                msgDiv.id = id;

                msgDiv.className = "flex gap-4 fade-in items-start";

                msgDiv.innerHTML = `

                 <img src="icon.png" alt="DevAI" class="w-10 h-10 rounded-xl shadow-md shadow-indigo-100/50 flex-shrink-0 mt-1 ring-2 ring-white object-cover">

                 <div class="bg-white border border-gray-100 px-6 py-4 rounded-2xl rounded-tl-sm shadow-sm text-gray-500 text-sm flex items-center gap-3">

                    <span class="relative flex h-3 w-3">

                      <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>

                      <span class="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>

                    </span>

                    <span class="font-medium animate-pulse">Thinking...</span>

                </div>

            `;

                container.appendChild(msgDiv);

                return id;

            }



            function removeChatBubble(id) {

                const el = document.getElementById(id);

                if (el) el.remove();

            }



            function renderActionCard(summary, command, animate = true) {

                const container = document.getElementById('chat-messages');

                const div = document.createElement('div');

                div.className = "flex gap-4 items-start " + (animate ? "fade-in-up" : "");

                const cid = 'action-' + Math.random().toString(36).substr(2, 9);



                // Sleek Action Card Design

                div.innerHTML = `

                <div class="bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 p-4 flex items-center justify-between">

                    <div class="flex items-center gap-3">

                             <div class="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center shadow-md">

                                <i class="fas fa-terminal text-xs"></i>

                             </div>

                             <div>

                                <span class="block font-bold text-gray-900 text-sm">System Proposal</span>

                                <span class="block text-[10px] text-gray-400 uppercase tracking-widest font-bold">Action Required</span>

                             </div>

                        </div>

                    </div>

                    

                    <div class="p-5">

                        <p class="text-sm font-semibold text-gray-800 mb-3 leading-relaxed">${escapeHtml(summary)}</p>

                        

                        <div class="mb-5">

                             <button onclick="const el = document.getElementById('code-${cid}'); const icon = this.querySelector('i'); el.classList.toggle('hidden'); if(el.classList.contains('hidden')) { icon.className='fas fa-chevron-right text-xs'; } else { icon.className='fas fa-chevron-down text-xs'; }" class="flex items-center gap-2 text-xs font-bold text-gray-500 hover:text-indigo-600 transition-colors bg-gray-50 px-3 py-2 rounded-lg border border-gray-100 hover:bg-indigo-50 hover:border-indigo-100 w-full text-left">

                                <i class="fas fa-chevron-right text-xs"></i>

                                <span>View Generated Script</span>

                                <span class="ml-auto text-[10px] text-gray-400 font-mono">${command.split('\n').length} lines</span>

                             </button>

                             

                             <div id="code-${cid}" class="hidden mt-3 relative group fade-in">

                                  <div class="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">

                                     <button onclick="navigator.clipboard.writeText('${command.replace(/'/g, "\\'")}')" class="p-1.5 bg-gray-800/80 backdrop-blur text-gray-400 hover:text-white rounded-md text-[10px] border border-gray-700" title="Copy to clipboard">

                                         <i class="fas fa-copy"></i>

                                     </button>

                                  </div>

                                  <pre class="bg-gray-950 rounded-xl p-4 pt-4 text-[11px] text-indigo-300 font-mono overflow-x-auto max-h-80 border border-gray-800 shadow-inner leading-relaxed whitespace-pre-wrap custom-scrollbar relative z-10">${escapeHtml(command)}</pre>

                             </div>

                        </div>

                        

                        <div class="flex gap-3">

                            <button onclick="this.closest('.flex.gap-4').remove()" class="flex-1 py-2.5 bg-gray-50 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all">Decline</button>

                            <button onclick="executeChatAction('${cid}', this)" class="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-200 transition-all flex items-center justify-center gap-2 group/btn">

                                <span>Run Command</span>

                                <i class="fas fa-play text-[8px] group-hover:translate-x-1 transition-transform"></i>

                            </button>

                        </div>

                        <div id="${cid}-result" class="hidden mt-4 p-4 bg-gray-50 rounded-xl border border-gray-100 font-mono text-xs text-gray-700 max-h-40 overflow-y-auto custom-scrollbar"></div>

                    </div>

                </div>

             `;

                container.appendChild(div);

                window['cmd_' + cid] = command;

                scrollToBottom();

                return div;

            }







            async function executeChatAction(cid, btn) {

                const command = window['cmd_' + cid];

                btn.disabled = true;

                btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i> Running...';



                const resultDiv = document.getElementById(cid + '-result');

                resultDiv.classList.remove('hidden');

                resultDiv.innerHTML = '<span class="text-gray-500 italic"><i class="fas fa-terminal mr-2"></i>Executing on server...</span>';



                try {

                    const res = await ipcRenderer.invoke('ssh:execute', command);

                    if (res.success) {

                        resultDiv.innerHTML = `

                        <div class="flex items-start gap-3 p-3 bg-emerald-50/50 rounded-xl border border-emerald-100/50">

                            <div class="w-6 h-6 rounded-full bg-emerald-500 text-white flex items-center justify-center flex-shrink-0 shadow-sm">

                                <i class="fas fa-check text-[10px]"></i>

                            </div>

                            <div>

                                <h5 class="text-[13px] font-bold text-emerald-800">Executed successfully</h5>

                                <div class="mt-1 font-mono text-[11px] text-emerald-600/80 leading-relaxed max-h-40 overflow-y-auto">${escapeHtml(res.output || 'No output')}</div>

                            </div>

                        </div>`;

                        btn.innerHTML = '<i class="fas fa-check mr-2"></i> Done';

                        btn.className = "flex-1 py-2.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-xl text-xs font-bold cursor-default opacity-80 pointer-events-none";



                        // AUTO-NAVIGATE

                        const card = btn.closest('.flex.gap-4');

                        if (card && card.hasAttribute('data-navigate-to')) {

                            const target = card.getAttribute('data-navigate-to');

                            setTimeout(() => {

                                navigate(target);

                                // Show a small toast or success result if needed

                            }, 1500);

                        }

                    } else {

                        resultDiv.innerHTML = `

                        <div class="p-3 bg-red-50 rounded-lg border border-red-100">

                            <div class="flex items-center gap-2 text-red-700 font-bold mb-1"><i class="fas fa-exclamation-circle"></i> Failed</div>

                            <p class="text-red-600 text-xs font-mono break-all">${res.error}</p>

                        </div>`;

                        btn.disabled = false;

                        btn.innerHTML = 'Retry';

                    }

                } catch (e) {

                    resultDiv.innerHTML = `<div class="text-red-500">System Error: ${e.message}</div>`;

                    btn.disabled = false;

                    btn.innerHTML = 'Retry';

                }

            }



            function clearChatHistory() {

                const chat = document.getElementById('chat-messages');

                if (chat) {

                    // Reset to welcome

                    chat.innerHTML = `

                 <div class="flex gap-4 fade-in">

                     <div class="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 flex-shrink-0 mt-1"><i class="fas fa-robot text-sm"></i></div>

                     <div class="bg-white border border-gray-100 p-5 rounded-2xl rounded-tl-none shadow-sm text-gray-700 text-sm leading-relaxed max-w-2xl">

                         <p class="font-semibold text-gray-900 mb-1">Hello! I'm your Server Copilot.</p>

                         <p>Chat cleared. Ready for new commands!</p>

                     </div>

                 </div>`;

                }

                copilotHistory = [];

            }







            // --- 8. USERS & GROUPS LOGIC ---

            async function loadUsersGroups() {

                if (!isConnected) return;

                const uContainer = document.getElementById('users-list-container');

                const gContainer = document.getElementById('groups-list-container');

                if (uContainer) uContainer.innerHTML = getSkeletonHtml('list-items');

                if (gContainer) gContainer.innerHTML = getSkeletonHtml('list-items');



                const showSystem = document.getElementById('show-system-users-toggle')?.checked || false;



                try {

                    const res = await ipcRenderer.invoke('ssh:get-system-users');



                    if (res.success) {

                        const filteredUsers = res.users.filter(u => showSystem || !u.isSystem);

                        const filteredGroups = res.groups.filter(g => showSystem || !g.isSystem);



                        // Update overview stats

                        const totalEl = document.getElementById('users-total-count');

                        const groupsEl = document.getElementById('groups-total-count');

                        const sudoEl = document.getElementById('users-sudo-count');

                        if (totalEl) totalEl.innerText = filteredUsers.length;

                        if (groupsEl) groupsEl.innerText = filteredGroups.length;

                        if (sudoEl) sudoEl.innerText = filteredUsers.filter(u => u.uid === 0 || u.home === '/root').length || '0';



                        if (uContainer) {

                            uContainer.innerHTML = filteredUsers.length ? `

                            <table class="w-full text-sm">

                                <thead>

                                    <tr class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 bg-gray-50/30">

                                        <th class="text-left py-2.5 pl-5">User</th>

                                        <th class="text-left py-2.5">UID</th>

                                        <th class="text-left py-2.5">Shell</th>

                                        <th class="text-left py-2.5">Home</th>

                                        <th class="text-right py-2.5 pr-5">Actions</th>

                                    </tr>

                                </thead>

                                <tbody class="divide-y divide-gray-50">

                                    ${filteredUsers.map(u => `

                                    <tr class="group hover:bg-indigo-50/30 transition-colors cursor-pointer" onclick="openEditUserModal('${u.username}')">

                                        <td class="py-3 pl-5">

                                            <div class="flex items-center gap-2.5">

                                                <div class="w-8 h-8 rounded-full ${u.isSystem ? 'bg-gray-100 text-gray-500' : 'bg-indigo-50 text-indigo-600'} flex items-center justify-center font-black text-xs group-hover:scale-110 transition-transform">

                                                    ${u.username.charAt(0).toUpperCase()}

                                                </div>

                                                <div>

                                                    <p class="text-xs font-bold text-gray-900">${u.username}</p>

                                                    ${u.isSystem ? '<span class="text-[8px] bg-gray-200 text-gray-500 px-1.5 py-0.5 rounded font-bold uppercase">System</span>' : ''}

                                                </div>

                                            </div>

                                        </td>

                                        <td class="py-3"><span class="font-mono text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">${u.uid}</span></td>

                                        <td class="py-3"><span class="text-[10px] text-gray-500 font-mono">${u.shell}</span></td>

                                        <td class="py-3"><span class="text-[10px] text-gray-400 font-mono bg-gray-50 px-2 py-0.5 rounded border border-gray-100">${u.home}</span></td>

                                        <td class="py-3 pr-5">

                                            <div class="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">

                                                <button onclick="event.stopPropagation(); openEditUserModal('${u.username}')" class="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-indigo-600 hover:border-indigo-300 flex items-center justify-center transition-all shadow-sm" title="Edit ${u.username}">

                                                    <i class="fas fa-pencil-alt text-[10px]"></i>

                                                </button>

                                                <button onclick="event.stopPropagation(); connectAsUser('${u.username}')" class="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-emerald-600 hover:border-emerald-300 flex items-center justify-center transition-all shadow-sm" title="Login as ${u.username}">

                                                    <i class="fas fa-sign-in-alt text-[10px]"></i>

                                                </button>

                                            </div>

                                        </td>

                                    </tr>

                                    `).join('')}

                                </tbody>

                            </table>

                            ` : '<div class="p-8 text-center text-gray-400"><i class="fas fa-user-slash text-2xl mb-2 opacity-20"></i><p class="text-xs font-bold">No user accounts found</p></div>';

                        }



                        if (gContainer) {

                            gContainer.innerHTML = filteredGroups.length ? `

                            <table class="w-full text-sm">

                                <thead>

                                    <tr class="text-[9px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100 bg-gray-50/30">

                                        <th class="text-left py-2.5 pl-5">Group</th>

                                        <th class="text-left py-2.5">GID</th>

                                        <th class="text-left py-2.5">Members</th>

                                        <th class="text-right py-2.5 pr-5">Actions</th>

                                    </tr>

                                </thead>

                                <tbody class="divide-y divide-gray-50">

                                    ${filteredGroups.map(g => `

                                    <tr class="group hover:bg-purple-50/30 transition-colors cursor-pointer" onclick="openEditGroupModal('${g.name}')">

                                        <td class="py-3 pl-5">

                                            <div class="flex items-center gap-2.5">

                                                <div class="w-7 h-7 rounded-md ${g.isSystem ? 'bg-gray-100 text-gray-500' : 'bg-purple-50 text-purple-600'} flex items-center justify-center font-bold text-xs">

                                                    <i class="fas fa-layer-group text-[10px]"></i>

                                                </div>

                                                <div>

                                                    <p class="text-xs font-bold text-gray-900">${g.name}</p>

                                                    ${g.isSystem ? '<span class="text-[8px] bg-gray-200 text-gray-500 px-1 rounded uppercase font-bold">Sys</span>' : ''}

                                                </div>

                                            </div>

                                        </td>

                                        <td class="py-3"><span class="font-mono text-[10px] font-bold text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded border border-gray-200">${g.gid}</span></td>

                                        <td class="py-3">

                                            <div class="flex items-center gap-1.5 flex-wrap max-w-[300px]">

                                                ${g.members.length > 0 ? g.members.slice(0, 5).map(m => `<span class="text-[9px] bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded border border-purple-100 font-bold">${m}</span>`).join('') + (g.members.length > 5 ? `<span class="text-[9px] text-gray-400 font-bold">+${g.members.length - 5} more</span>` : '') : '<span class="text-[9px] text-gray-300 italic">No members</span>'}

                                            </div>

                                        </td>

                                        <td class="py-3 pr-5">

                                            <div class="flex justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">

                                                <button onclick="event.stopPropagation(); openEditGroupModal('${g.name}')" class="w-7 h-7 rounded-lg bg-white border border-gray-200 text-gray-400 hover:text-purple-600 hover:border-purple-300 flex items-center justify-center transition-all shadow-sm" title="Manage ${g.name}">

                                                    <i class="fas fa-pencil-alt text-[10px]"></i>

                                                </button>

                                            </div>

                                        </td>

                                    </tr>

                                    `).join('')}

                                </tbody>

                            </table>

                            ` : '<div class="p-8 text-center text-gray-400"><i class="fas fa-layer-group text-2xl mb-2 opacity-20"></i><p class="text-xs font-bold">No groups found</p></div>';

                        }

                    } else {

                        if (uContainer) uContainer.innerHTML = `<div class="p-6 text-red-500 text-center bg-red-50 rounded-xl"><i class="fas fa-exclamation-circle text-xl mb-2"></i><p class="text-xs font-bold">Error: ${res.error}</p></div>`;

                    }

                } catch (e) {

                    console.error("Load Users Error:", e);

                }

            }



            function openCreateUserModal() {

                document.getElementById('new-user-name').value = '';

                document.getElementById('new-user-pass').value = '';

                document.getElementById('new-user-groups').value = '';

                document.getElementById('create-user-modal').classList.remove('hidden');

            }



            async function submitCreateUser() {

                const username = document.getElementById('new-user-name').value.trim();

                const password = document.getElementById('new-user-pass').value;

                const groupsStr = document.getElementById('new-user-groups').value;



                if (!username || !password) {

                    alert("Username and Password are required");

                    return;

                }



                const groups = groupsStr ? groupsStr.split(',').map(s => s.trim()).filter(s => s) : [];



                document.getElementById('create-user-modal').classList.add('hidden');

                showLoader("Creating User...", `Adding ${username} to system`);



                try {

                    const res = await ipcRenderer.invoke('ssh:create-user', { username, password, groups });

                    if (res.success) {

                        alert(`User ${username} created successfully!`);

                        loadUsersGroups();

                    } else {

                        alert("Failed to create user: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function connectAsUser(username) {

                if (!confirm(`Switch user to ${username}? This will disconnect the current session.`)) return;



                // 1. Capture current host info before disconnect

                const host = connectedServerData?.host;

                const ip = host; // Assuming host is IP for now, or we get it from server object



                if (!ip) {

                    alert("Could not determine server address.");

                    return;

                }



                // 2. Disconnect

                await disconnect();



                // 3. Open Connection Modal Pre-filled

                openConnectionModal(); // Resets form



                document.getElementById('host').value = ip;

                document.getElementById('username').value = username;

                document.getElementById('password').focus();



                // Show hint

                // alert(`Please enter password for ${username} to connect.`);

            }



            function openEditUserModal(username) {

                document.getElementById('edit-user-name').value = username;

                document.getElementById('edit-user-name-title').innerText = username;

                document.getElementById('edit-user-pass').value = '';

                document.getElementById('edit-user-modal').classList.remove('hidden');



                // Reset and load groups

                document.getElementById('edit-user-group-select').innerHTML = '<option value="">-- Select Group --</option>';

                document.getElementById('edit-user-groups-list').innerHTML = '';

                loadAvailableGroupsForUser();

                loadUserCurrentGroups(username);

            }



            async function loadAvailableGroupsForUser() {

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', 'getent group | cut -d: -f1 | sort');

                    if (res.success) {

                        const select = document.getElementById('edit-user-group-select');

                        const groups = res.stdout.trim().split('\n').filter(g => g);

                        groups.forEach(g => {

                            const opt = document.createElement('option');

                            opt.value = g;

                            opt.innerText = g;

                            select.appendChild(opt);

                        });

                    }

                } catch (e) { console.error('Failed to load groups:', e); }

            }



            async function loadUserCurrentGroups(username) {

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', `groups ${username}`);

                    if (res.success) {

                        const container = document.getElementById('edit-user-groups-list');

                        const groups = res.stdout.replace(/.*:/, '').trim().split(/\s+/);

                        container.innerHTML = groups.map(g =>

                            `<span class="px-2 py-1 bg-gray-100 rounded text-xs font-medium">${g}</span>`

                        ).join('');

                    }

                } catch (e) { console.error('Failed to load user groups:', e); }

            }



            async function addGroupToUserFromModal() {

                const username = document.getElementById('edit-user-name').value;

                const group = document.getElementById('edit-user-group-select').value;

                if (!group) return alert('Please select a group');



                showLoader('Adding to group...', `Adding ${username} to ${group}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', `sudo usermod -aG ${group} ${username}`);

                    if (res.success) {

                        alert(`Added ${username} to ${group}`);

                        await loadUserCurrentGroups(username);

                    } else {

                        alert('Failed: ' + res.stderr);

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function grantUserSudo() {

                const username = document.getElementById('edit-user-name').value;

                if (!confirm(`Grant sudo privileges to ${username}?`)) return;



                showLoader('Granting sudo...', `Adding ${username} to sudo group`);

                try {

                    const res = await ipcRenderer.invoke('ssh:exec', `sudo usermod -aG sudo ${username}`);

                    if (res.success) {

                        alert(`Sudo privileges granted to ${username}`);

                        await loadUserCurrentGroups(username);

                    } else {

                        alert('Failed: ' + res.stderr);

                    }

                } catch (e) {

                    alert('Error: ' + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function submitUpdateUser() {

                const username = document.getElementById('edit-user-name').value;

                const password = document.getElementById('edit-user-pass').value;



                if (!password) {

                    alert("No changes specified.");

                    return;

                }



                document.getElementById('edit-user-modal').classList.add('hidden');

                showLoader("Updating User...", `Updating password for ${username}`);



                try {

                    const res = await ipcRenderer.invoke('ssh:update-user-password', { username, password });

                    if (res.success) {

                        alert("User updated successfully!");

                    } else {

                        alert("Update failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function deleteUser() {

                const username = document.getElementById('edit-user-name').value;

                if (!confirm(`Are you sure you want to PERMANENTLY delete user ${username}? Home directory will be removed.`)) return;



                document.getElementById('edit-user-modal').classList.add('hidden');

                showLoader("Deleting User...", `Removing ${username} from system`);



                try {

                    const res = await ipcRenderer.invoke('ssh:delete-user', username);

                    if (res.success) {

                        alert("User deleted.");

                        loadUsersGroups();

                    } else {

                        alert("Deletion failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function enablePasswordAuth() {

                const username = document.getElementById('edit-user-name').value;

                if (!confirm(`Enable SSH password login for ${username}? This will modify sshd_config and restart SSH service.`)) return;



                document.getElementById('edit-user-modal').classList.add('hidden');

                showLoader("Configuring SSH...", `Enabling password auth for ${username}`);



                try {

                    const res = await ipcRenderer.invoke('ssh:enable-password-auth', username);

                    if (res.success) {

                        alert(`Password authentication enabled for ${username}. You can now login with their password on the Server Manager page.`);

                    } else {

                        alert("Configuration failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            function openEditGroupModal(name) {

                document.getElementById('edit-group-name').value = name;

                document.getElementById('edit-group-name-title').innerText = name;

                document.getElementById('add-to-group-user').value = '';

                document.getElementById('edit-group-modal').classList.remove('hidden');

            }



            async function addUserToGroup() {

                const group = document.getElementById('edit-group-name').value;

                const username = document.getElementById('add-to-group-user').value.trim();



                if (!username) return;



                showLoader("Updating Group...", `Adding ${username} to ${group}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:add-user-to-group', { username, group });

                    if (res.success) {

                        alert("User added to group.");

                        loadUsersGroups();

                    } else {

                        alert("Failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function deleteGroup() {

                const name = document.getElementById('edit-group-name').value;

                if (!confirm(`Are you sure you want to delete group ${name}?`)) return;



                document.getElementById('edit-group-modal').classList.add('hidden');

                showLoader("Deleting Group...", `Removing ${name}`);



                try {

                    const res = await ipcRenderer.invoke('ssh:delete-group', name);

                    if (res.success) {

                        alert("Group deleted.");

                        loadUsersGroups();

                    } else {

                        alert("Deletion failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            function openCreateGroupModal() {

                openInputModal("Create Group", "Enter group name", async (name) => {

                    showLoader("Creating Group...", `Adding group ${name}`);

                    try {

                        const res = await ipcRenderer.invoke('ssh:create-group', name);

                        if (res.success) {

                            loadUsersGroups();

                        } else {

                            alert("Failed: " + res.error);

                        }

                    } catch (e) {

                        alert("Error: " + e.message);

                    } finally {

                        hideLoader();

                    }

                });

            }



            // --- 9. STORAGE LOGIC ---

            let showLoopDevices = false;

            function toggleStorageLoopDevices() {

                showLoopDevices = !showLoopDevices;

                const section = document.getElementById('storage-loop-section');

                const btn = document.getElementById('toggle-loop-btn');

                if (section) section.classList.toggle('hidden', !showLoopDevices);

                if (btn) {

                    btn.className = showLoopDevices

                        ? 'px-3 py-1.5 bg-indigo-50 border border-indigo-200 text-indigo-700 rounded-lg text-[10px] font-bold shadow-sm hover:bg-indigo-100 transition-all'

                        : 'px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-[10px] font-bold shadow-sm hover:bg-gray-50 transition-all';

                }

            }



            async function loadStorage() {

                if (!isConnected) return;

                const physContainer = document.getElementById('storage-physical-container');

                const loopContainer = document.getElementById('storage-loop-container');

                if (!physContainer) return;



                physContainer.innerHTML = getSkeletonHtml('card-grid');

                if (loopContainer) loopContainer.innerHTML = '';



                try {

                    const res = await ipcRenderer.invoke('ssh:get-disks');

                    if (res.success) {

                        if (res.disks.length === 0) {

                            physContainer.innerHTML = '<div class="text-center p-10 text-gray-500"><i class="fas fa-database text-3xl mb-3 text-gray-300"></i><p class="font-bold">No block devices detected</p><p class="text-xs text-gray-400 mt-1">This server has no attached storage devices.</p></div>';

                            return;

                        }



                        // Separate physical disks from loop devices

                        const physicalDisks = res.disks.filter(d => d.type !== 'loop');

                        const loopDisks = res.disks.filter(d => d.type === 'loop');



                        // Count stats

                        let totalDisks = physicalDisks.length;

                        let mountedCount = 0;

                        let unmountedCount = 0;



                        const countMounts = (items) => {

                            items.forEach(d => {

                                if (d.mountpoint) mountedCount++;

                                else if (d.type === 'disk' && (!d.children || d.children.length === 0)) unmountedCount++;

                                if (d.children) d.children.forEach(c => {

                                    if (c.mountpoint) mountedCount++;

                                    else unmountedCount++;

                                });

                            });

                        };

                        countMounts(physicalDisks);



                        // Update overview

                        const totalEl = document.getElementById('storage-total-disks');

                        const mountedEl = document.getElementById('storage-mounted-count');

                        const unmountedEl = document.getElementById('storage-unmounted-count');

                        if (totalEl) totalEl.innerText = totalDisks;

                        if (mountedEl) mountedEl.innerText = mountedCount;

                        if (unmountedEl) unmountedEl.innerText = unmountedCount;



                        // Render physical disks

                        if (physicalDisks.length === 0) {

                            physContainer.innerHTML = '<div class="text-center p-10 text-gray-400 bg-white border border-gray-200 rounded-xl"><i class="fas fa-hdd text-3xl mb-3 text-gray-300"></i><p class="font-bold text-gray-500">No physical disks found</p><p class="text-xs mt-1">Only loop/snap devices are present on this server.</p></div>';

                        } else {

                            physContainer.innerHTML = physicalDisks.map(disk => renderDiskCard(disk)).join('');

                        }



                        // Render loop devices

                        if (loopContainer) {

                            if (loopDisks.length === 0) {

                                loopContainer.innerHTML = '<div class="col-span-full text-center p-6 text-gray-400 text-xs">No loop devices found.</div>';

                            } else {

                                loopContainer.innerHTML = loopDisks.map(disk => renderLoopCard(disk)).join('');

                            }

                        }



                    } else {

                        physContainer.innerHTML = `<div class="p-10 text-red-500 text-center bg-white border border-red-200 rounded-xl"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">Scan Failed</p><p class="text-xs">${res.error}</p></div>`;

                    }

                } catch (e) {

                    physContainer.innerHTML = `<div class="p-10 text-red-500 text-center bg-white border border-red-200 rounded-xl"><i class="fas fa-exclamation-circle text-2xl mb-2"></i><p class="font-bold">System Error</p><p class="text-xs">${e.message}</p></div>`;

                }

            }



            function renderDiskCard(disk) {

                const children = disk.children || [];

                const isMounted = disk.mountpoint !== null;

                const showConnect = !isMounted && children.length === 0 && disk.type === 'disk';

                const modelName = disk.model || (disk.type === 'disk' ? 'Unknown Disk' : disk.type.toUpperCase());

                const partCount = children.length;



                // Parse size for display

                const sizeStr = disk.size || '--';



                return `

                <div class="bg-white border border-gray-200 rounded-xl shadow-sm hover:shadow-md hover:border-indigo-200 transition-all overflow-hidden">

                    <!-- Disk Header -->

                    <div class="px-5 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">



                        <div class="flex items-center gap-4">

                            <div class="w-11 h-11 bg-gradient-to-br from-indigo-500 to-blue-600 rounded-xl flex items-center justify-center text-white shadow-sm">

                                <i class="fas fa-hdd text-lg"></i>

                            </div>

                            <div>

                                <div class="flex items-center gap-2">

                                    <h3 class="font-black text-gray-900 text-sm">/dev/${disk.name}</h3>

                                    <span class="px-2 py-0.5 bg-indigo-50 text-indigo-600 rounded-md text-[9px] font-black uppercase tracking-wider border border-indigo-100">${disk.type}</span>

                                </div>

                                <p class="text-[11px] text-gray-500 mt-0.5 font-medium">${modelName}  <span class="font-bold text-gray-700">${sizeStr}</span>${partCount > 0 ? `  ${partCount} partition${partCount > 1 ? 's' : ''}` : ''}</p>

                            </div>

                        </div>

                        <div class="flex items-center gap-2">

                            ${showConnect ? `

                                <button onclick="openMountModal('${disk.name}', '${disk.fstype || ''}')" class="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-black uppercase tracking-wider shadow-sm transition-all active:scale-95">

                                    <i class="fas fa-plug mr-1.5"></i>Mount

                                </button>

                            ` : ''}

                        </div>

                    </div>



                    <!-- Partitions Table -->

                    ${(isMounted || children.length > 0) ? `

                    <div class="p-4">

                        <table class="w-full text-sm">

                            <thead>

                                <tr class="text-[9px] font-black text-gray-400 uppercase tracking-widest">

                                    <th class="text-left pb-2 pl-1">Partition</th>

                                    <th class="text-left pb-2">Size</th>

                                    <th class="text-left pb-2">Filesystem</th>

                                    <th class="text-left pb-2">Mount Point</th>

                                    <th class="text-right pb-2 pr-1">Actions</th>

                                </tr>

                            </thead>

                            <tbody class="divide-y divide-gray-50">

                                ${isMounted ? renderPartitionRow(disk) : ''}

                                ${children.map(child => renderPartitionRow(child)).join('')}

                            </tbody>

                        </table>

                    </div>

                    ` : `

                    <div class="p-6 text-center">

                        <p class="text-xs text-gray-400 font-medium"><i class="fas fa-info-circle mr-1"></i>This disk has no partitions and is not mounted. Click <strong>Mount</strong> to attach it.</p>

                    </div>

                    `}

                </div>

                `;

            }



            function renderLoopCard(disk) {

                const isMounted = disk.mountpoint !== null;

                const sizeStr = disk.size || '--';

                const mountPath = disk.mountpoint || '--';

                const fsType = disk.fstype || 'squashfs'; // loops are often squashfs (snaps)



                return `

                <div class="bg-gray-50 border border-gray-200 rounded-lg p-3 flex items-center justify-between hover:bg-white hover:shadow-sm transition-all group">

                    <div class="flex items-center gap-3">

                        <div class="w-8 h-8 bg-gray-200 rounded-lg flex items-center justify-center text-gray-500">

                             <i class="fas fa-circle-notch text-xs"></i>

                        </div>

                        <div>

                            <h4 class="text-xs font-bold text-gray-700">/dev/${disk.name}</h4>

                            <p class="text-[9px] text-gray-400 font-mono">${sizeStr}  ${fsType}</p>

                        </div>

                    </div>

                    

                    <div class="text-right">

                         ${isMounted

                        ? `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-600 rounded text-[9px] font-bold border border-emerald-100"><i class="fas fa-check-circle text-[8px]"></i> ${mountPath}</span>`

                        : `<span class="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-400 rounded text-[9px] font-bold border border-gray-200">Unmounted</span>`

                    }

                    </div>

                </div>

                `;

            }



            function renderPartitionRow(part) {

                if (!part.name) return '';

                const isMounted = !!part.mountpoint;

                const fsType = part.fstype || '--';

                const mountPath = part.mountpoint || '--';



                const statusBadge = isMounted

                    ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-md text-[9px] font-bold border border-emerald-100"><i class="fas fa-check-circle text-[8px]"></i>${mountPath}</span>`

                    : `<span class="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 rounded-md text-[9px] font-bold border border-amber-200"><i class="fas fa-exclamation-circle text-[8px]"></i>Not Mounted</span>`;



                const rowBg = isMounted ? 'hover:bg-gray-50/50' : 'bg-amber-50/30 hover:bg-amber-50/60 border-l-2 border-l-amber-400';



                return `

                <tr class="group ${rowBg} transition-colors">

                    <td class="py-2.5 pl-1">

                        <div class="flex items-center gap-2">

                            <i class="fas fa-${isMounted ? 'database text-indigo-400' : 'exclamation-triangle text-amber-400'} text-[10px]"></i>

                            <span class="font-mono text-xs font-bold text-gray-700">${part.name}</span>

                            ${!isMounted ? '<span class="text-[8px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-black uppercase tracking-wider border border-amber-200 animate-pulse">New</span>' : ''}

                        </div>

                    </td>

                    <td class="py-2.5">

                        <span class="text-xs font-bold text-gray-600">${part.size || '--'}</span>

                    </td>

                    <td class="py-2.5">

                        <span class="px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] font-bold font-mono border border-gray-200">${fsType}</span>

                    </td>

                    <td class="py-2.5">${statusBadge}</td>

                    <td class="py-2.5 pr-1">

                        <div class="flex justify-end gap-1.5 ${isMounted ? 'opacity-0 group-hover:opacity-100' : ''} transition-opacity">

                            ${!isMounted ? `

                                <button onclick="openMountModal('${part.name}', '${part.fstype || ''}')" class="px-3 py-1.5 bg-indigo-600 text-white hover:bg-indigo-700 rounded-lg text-[9px] font-black uppercase tracking-wider transition-all shadow-sm shadow-indigo-200 active:scale-95" title="Mount this partition">

                                    <i class="fas fa-plug mr-1"></i>Mount Now

                                </button>

                            ` : `

                                <button onclick="unmountPartition('${part.name}')" class="px-2.5 py-1 bg-amber-50 text-amber-700 hover:bg-amber-600 hover:text-white rounded-md text-[9px] font-bold transition-all border border-amber-100" title="Unmount this partition">

                                    <i class="fas fa-eject mr-1"></i>Unmount

                                </button>

                            `}

                        </div>

                    </td>

                </tr>

                `;

            }



            let currentMountDevice = null;

            let currentMountFsType = null;

            function openMountModal(device, fsType) {

                currentMountDevice = device;

                currentMountFsType = (fsType === undefined || fsType === null) ? null : String(fsType);

                document.getElementById('mount-device-name').innerText = '/dev/' + device;

                document.getElementById('mount-point').value = '/mnt/data1';

                document.getElementById('mount-format').checked = false;

                document.getElementById('mount-disk-modal').classList.remove('hidden');

            }



            async function submitMountDisk() {

                const mountPoint = document.getElementById('mount-point').value.trim();

                const format = document.getElementById('mount-format').checked;



                if (!mountPoint) {

                    alert("Mount point is required");

                    return;

                }



                // If the target device appears unformatted, guide user to enable format first.

                const fsType = String(currentMountFsType || '').trim();

                const isUnformatted = !fsType || fsType === '--' || fsType === 'null' || fsType === 'undefined';

                if (isUnformatted && !document.getElementById('mount-format').checked) {

                    const ok = confirm('This device appears to be unformatted. Please enable "Format as EXT4" to continue. Enable formatting now?');

                    if (ok) {

                        document.getElementById('mount-format').checked = true;

                    }

                    return;

                }



                if (format && !confirm("WARNING: Formatting will ERASE ALL DATA on this volume. Continue?")) return;



                document.getElementById('mount-disk-modal').classList.add('hidden');

                showLoader("Connecting Volume...", `Mounting /dev/${currentMountDevice} to ${mountPoint}`);



                try {

                    const res = await ipcRenderer.invoke('ssh:mount-disk', { device: currentMountDevice, mountPoint, format });

                    if (res.success) {

                        alert("Volume connected successfully!");

                        loadStorage();

                    } else {

                        alert("Connection failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function unmountPartition(name) {

                if (!confirm(`Are you sure you want to unmount /dev/${name}?`)) return;



                showLoader("Unmounting...", `Unmounting /dev/${name}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:unmount-disk', name);

                    if (res.success) {

                        alert("Volume unmounted successfully");

                        loadStorage();

                    } else {

                        alert("Unmount failed: " + res.error);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            // --- 9.5 USERS & GROUPS LOGIC ---



            // State

            window.systemUsers = [];

            window.systemGroups = [];



            async function loadUsersGroups() {

                if (!isConnected) return;



                const userBody = document.getElementById('users-table-body');

                const groupBody = document.getElementById('groups-table-body');



                if (userBody) userBody.innerHTML = getSkeletonHtml('table-rows');

                if (groupBody) groupBody.innerHTML = getSkeletonHtml('table-rows');



                try {

                    const res = await ipcRenderer.invoke('ssh:get-system-users');

                    if (res.success) {

                        window.systemUsers = res.users;

                        window.systemGroups = res.groups;

                        renderUsersAndGroups();

                    } else {

                        if (userBody) userBody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500 text-xs opacity-70">${res.error}</td></tr>`;

                    }

                } catch (e) {

                    console.error("Failed to load users/groups", e);

                    if (userBody) userBody.innerHTML = `<tr><td colspan="4" class="p-4 text-center text-red-500 text-xs">Connection Error</td></tr>`;

                }

            }



            function renderUsersAndGroups() {

                const userBody = document.getElementById('users-table-body');

                const groupBody = document.getElementById('groups-table-body');



                if (userBody) {

                    // Filter: Real users (UID >= 1000) + root

                    const displayUsers = window.systemUsers.filter(u => u.uid >= 1000 || u.uid === 0);



                    userBody.innerHTML = displayUsers.length ? displayUsers.map(u => `

                        <tr class="hover:bg-gray-50 transition-colors group border-b border-gray-50 last:border-0">

                            <td class="px-6 py-3 font-medium text-gray-900">

                                <div class="flex items-center gap-3">

                                    <div class="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center font-black text-xs border border-blue-100">

                                        ${u.username.substring(0, 2).toUpperCase()}

                                    </div>

                                    <div>

                                        <div class="text-sm font-bold text-gray-800">${u.username}</div>

                                        ${u.uid === 0 ? '<span class="text-[9px] bg-red-100 text-red-600 px-1.5 rounded border border-red-200 font-bold uppercase">Root / Admin</span>' : `<span class="text-[10px] text-gray-400 font-mono">ID: ${u.uid}</span>`}

                                    </div>

                                </div>

                            </td>

                            <td class="px-6 py-3 text-gray-500 text-xs">

                                <div class="flex flex-col gap-0.5">

                                    <div class="flex items-center gap-1.5 text-gray-600">

                                        <i class="fas fa-folder text-[10px] text-gray-400 w-4"></i>

                                        <span class="font-mono text-[10px]">${u.home}</span>

                                    </div>

                                    <div class="flex items-center gap-1.5 text-gray-600">

                                        <i class="fas fa-terminal text-[10px] text-gray-400 w-4"></i>

                                        <span class="font-mono text-[10px]">${u.shell}</span>

                                    </div>

                                </div>

                            </td>

                            <td class="px-6 py-3 text-right">

                                <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">

                                    <button onclick="openUserModal('${u.username}')" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all" title="Edit User">

                                        <i class="fas fa-edit"></i>

                                    </button>

                                    ${u.uid >= 1000 ? `

                                    <button onclick="deleteUser('${u.username}')" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" title="Delete User">

                                        <i class="fas fa-trash-alt"></i>

                                    </button>` : ''}

                                </div>

                            </td>

                        </tr>

                    `).join('') : '<tr><td colspan="4" class="px-6 py-8 text-center text-gray-400 text-xs italic">No users found</td></tr>';

                }



                if (groupBody) {

                    // Filter: Real groups (GID >= 1000) or common ones

                    const displayGroups = window.systemGroups.filter(g => g.gid >= 1000 || ['sudo', 'docker', 'adm', 'root', 'www-data'].includes(g.name));



                    groupBody.innerHTML = displayGroups.length ? displayGroups.map(g => `

                        <tr class="hover:bg-gray-50 transition-colors group border-b border-gray-50 last:border-0">

                            <td class="px-6 py-3 font-medium text-gray-900">

                                <div class="flex items-center gap-3">

                                    <div class="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 flex items-center justify-center font-black text-xs border border-purple-100">

                                        <i class="fas fa-users"></i>

                                    </div>

                                    <div>

                                        <div class="text-sm font-bold text-gray-800">${g.name}</div>

                                        <span class="text-[10px] text-gray-400 font-mono">GID: ${g.gid}</span>

                                    </div>

                                </div>

                            </td>

                            <td class="px-6 py-3 text-gray-500 text-xs">

                                <div class="flex flex-wrap gap-1 max-w-[200px]">

                                    ${g.members.length ? g.members.slice(0, 5).map(m => `<span class="px-1.5 py-0.5 bg-gray-100 rounded text-[9px] text-gray-600 border border-gray-200 font-mono">${m}</span>`).join('') : '<span class="text-gray-300 italic">No members</span>'}

                                    ${g.members.length > 5 ? `<span class="text-[9px] text-gray-400 self-center">+${g.members.length - 5}</span>` : ''}

                                </div>

                            </td>

                            <td class="px-6 py-3 text-right">

                                <div class="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">

                                    <button onclick="openGroupModal('${g.name}')" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-all" title="Edit Group">

                                        <i class="fas fa-edit"></i>

                                    </button>

                                    ${g.gid >= 1000 ? `

                                    <button onclick="deleteGroup('${g.name}')" class="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" title="Delete Group">

                                        <i class="fas fa-trash-alt"></i>

                                    </button>` : ''}

                                </div>

                            </td>

                        </tr>

                    `).join('') : '<tr><td colspan="4" class="px-6 py-8 text-center text-gray-400 text-xs italic">No groups found</td></tr>';

                }

            }



            // --- USER MODAL LOGIC ---



            // Define available permissions (Modules)

            const AVAILABLE_PERMISSIONS = [

                { id: 'servers', label: 'Servers', icon: 'fa-server' },

                { id: 'cicd', label: 'CI/CD Pipelines', icon: 'fa-code-branch' },

                { id: 'deploy', label: 'Deploy App', icon: 'fa-rocket' },

                { id: 'manage-apps', label: 'Applications', icon: 'fa-cubes' },

                { id: 'storage', label: 'Storage', icon: 'fa-hdd' },

                { id: 'users-groups', label: 'Users & Groups', icon: 'fa-users-cog' },

                { id: 'global-apps', label: 'App Store', icon: 'fa-store' },

                { id: 'files', label: 'File Manager', icon: 'fa-folder-open' },

                { id: 'terminal', label: 'Terminal', icon: 'fa-terminal' },

                { id: 'security', label: 'Security', icon: 'fa-shield-alt' },

                { id: 'tasks', label: 'Scheduled Tasks', icon: 'fa-calendar-check' }

            ];



            function openUserModal(username = null) {

                const modal = document.getElementById('user-modal');

                const title = document.getElementById('user-modal-title');

                const modeInput = document.getElementById('user-modal-mode');

                const origInput = document.getElementById('user-modal-original-username');



                const nameIn = document.getElementById('user-input-name');

                const passIn = document.getElementById('user-input-pass');

                const shellIn = document.getElementById('user-input-shell');

                const homeIn = document.getElementById('user-input-home');

                const passHint = document.getElementById('user-pass-hint');



                // Clear fields

                nameIn.value = '';

                passIn.value = '';

                shellIn.value = '/bin/bash';

                homeIn.value = '';



                // Populate Groups

                populateGroupOptions();



                // Populate Permissions

                populatePermissionCheckboxes(username);



                if (username) {

                    // EDIT MODE

                    title.innerText = "Edit User & Permissions";

                    modeInput.value = "edit";

                    origInput.value = username;



                    const user = window.systemUsers.find(u => u.username === username);

                    if (user) {

                        nameIn.value = user.username;

                        nameIn.disabled = true;

                        nameIn.classList.add('bg-gray-100', 'text-gray-500');

                        shellIn.value = user.shell || '/bin/bash';

                        homeIn.value = user.home || `/home/${username}`;



                        // Set Primary Group

                        const pGroup = window.systemGroups.find(g => g.gid === user.gid);

                        if (pGroup && document.getElementById('user-input-group')) {

                            document.getElementById('user-input-group').value = pGroup.name;

                        }



                        // Check Secondary Groups

                        const checkboxes = document.querySelectorAll('.group-checkbox');

                        checkboxes.forEach(cb => {

                            const gName = cb.value;

                            const group = window.systemGroups.find(g => g.name === gName);

                            if (group && group.members.includes(username)) {

                                cb.checked = true;

                            } else {

                                cb.checked = false;

                            }

                        });

                    }

                    passHint.classList.remove('hidden');

                } else {

                    // CREATE MODE

                    title.innerText = "Create New User";

                    modeInput.value = "create";

                    origInput.value = "";

                    nameIn.disabled = false;

                    nameIn.classList.remove('bg-gray-100', 'text-gray-500');



                    // Auto-fill home

                    nameIn.oninput = () => {

                        if (modeInput.value === 'create') homeIn.value = `/home/${nameIn.value}`;

                    };



                    passHint.classList.add('hidden');

                }



                modal.classList.remove('hidden');

            }



            function closeUserModal() {

                document.getElementById('user-modal').classList.add('hidden');

            }



            function populatePermissionCheckboxes(username) {

                // Determine container - we need to add this to the HTML first?

                // Or we can inject it here if it doesn't exist

                let permContainer = document.getElementById('user-permissions-container');

                if (!permContainer) {

                    // Inject into modal form if not present

                    const groupsList = document.getElementById('user-input-groups-list');

                    if (groupsList && groupsList.parentElement) {

                        const containerDiv = document.createElement('div');

                        containerDiv.className = 'mt-4 pt-4 border-t border-gray-100';

                        containerDiv.innerHTML = `

                            <label class="block text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">App Permissions (Sidebar Access)</label>

                            <div class="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto custom-scrollbar p-1" id="user-permissions-list">

                                <!-- Checkboxes -->

                            </div>

                        `;

                        groupsList.parentElement.parentElement.appendChild(containerDiv);

                        permContainer = document.getElementById('user-permissions-list');

                    }

                }



                if (!permContainer) return; // Should allow insertion now



                // Get saved permissions (mock: storing in localStorage for now since we are in a browser context)

                // In a real app, this should be saved on the server in a config file

                let savedPerms = [];

                if (username) {

                    const key = `permissions_${username}`; // simplified key

                    const stored = localStorage.getItem(key);

                    if (stored) {

                        try { savedPerms = JSON.parse(stored); } catch (e) { }

                    } else {

                        // Default: All enabled if no config found (or restrict? let's default all for now)

                        savedPerms = AVAILABLE_PERMISSIONS.map(p => p.id);

                    }

                } else {

                    // Default New User: Dashboard only? Or all? Let's check Dashboard + Terminal

                    savedPerms = ['dashboard', 'terminal', 'files'];

                }



                permContainer.innerHTML = AVAILABLE_PERMISSIONS.map(p => `

                    <label class="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-lg cursor-pointer border border-transparent hover:border-gray-100 transition-all">

                        <input type="checkbox" value="${p.id}" class="perm-checkbox w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500" ${savedPerms.includes(p.id) ? 'checked' : ''}>

                        <div class="flex items-center gap-2 text-gray-700">

                            <div class="w-5 h-5 rounded bg-white border border-gray-200 flex items-center justify-center text-xs text-indigo-500">

                                <i class="fas ${p.icon}"></i>

                            </div>

                            <span class="text-xs font-medium">${p.label}</span>

                        </div>

                    </label>

                `).join('');

            }



            function populateGroupOptions() {

                // Populate Primary Group Dropdown

                const primSelect = document.getElementById('user-input-group');

                const secList = document.getElementById('user-input-groups-list');



                if (primSelect && window.systemGroups) {

                    // Standard Linux requirement: Primary group usually implies a group with same name, or 'users'

                    // We list all groups

                    primSelect.innerHTML = window.systemGroups

                        .sort((a, b) => a.name.localeCompare(b.name))

                        .map(g => `<option value="${g.name}" ${g.name === 'users' ? 'selected' : ''}>${g.name}</option>`)

                        .join('');

                }



                if (secList && window.systemGroups) {

                    secList.innerHTML = window.systemGroups

                        .filter(g => g.gid >= 1000 || ['sudo', 'docker', 'adm', 'plugdev', 'cdrom', 'www-data'].includes(g.name))

                        .sort((a, b) => a.name.localeCompare(b.name))

                        .map(g => `

                            <label class="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer">

                                <input type="checkbox" value="${g.name}" class="group-checkbox rounded border-gray-300 text-blue-600 focus:ring-blue-500">

                                <span class="text-xs text-gray-700 font-mono">${g.name}</span>

                            </label>

                        `).join('');

                }

            }



            async function submitUserForm() {

                const mode = document.getElementById('user-modal-mode').value;

                const username = document.getElementById('user-input-name').value;

                const password = document.getElementById('user-input-pass').value;

                const shell = document.getElementById('user-input-shell').value;

                const home = document.getElementById('user-input-home').value;

                const primaryGroup = document.getElementById('user-input-group').value; // Usually handled by useradd -g



                // Get checked secondary groups

                const secondaryGroups = Array.from(document.querySelectorAll('.group-checkbox:checked')).map(cb => cb.value);



                // Get permissions

                const permissions = Array.from(document.querySelectorAll('.perm-checkbox:checked')).map(cb => cb.value);



                if (!username) return alert("Username is required");



                // Save Permissions (Client-side simulation for this prototype)

                // In production, this would write to /etc/devyntra/auth.json on the server

                localStorage.setItem(`permissions_${username}`, JSON.stringify(permissions));

                console.log(`Saved permissions for ${username}:`, permissions);



                closeUserModal();



                if (mode === 'create') {

                    if (!password) return alert("Password is required for new user");

                    showLoader("Creating User...", `Adding ${username}`);



                    try {

                        // Create User Call

                        const res = await ipcRenderer.invoke('ssh:create-user', {

                            username,

                            password,

                            groups: secondaryGroups

                        });



                        if (res.success) {

                            // If shell/home are different from default, update them

                            // useradd usually sets them if passed, but our current handler might just do basics

                            // Re-read code: create-user does `useradd -m -s /bin/bash`. 

                            // If user selected different shell, we should update it.

                            if (shell !== '/bin/bash') await ipcRenderer.invoke('ssh:change-user-shell', { username, shell });



                            loadUsersGroups();

                        } else {

                            alert("Failed: " + res.error);

                        }

                    } catch (e) { alert(e.message); }

                    finally { hideLoader(); }



                } else {

                    // UPDATE MODE

                    showLoader("Updating User...", `Modifying ${username}`);

                    try {

                        // 1. Password

                        if (password) {

                            await ipcRenderer.invoke('ssh:update-user-password', { username, password });

                        }



                        // 2. Shell

                        await ipcRenderer.invoke('ssh:change-user-shell', { username, shell });



                        // 3. Home

                        const current = window.systemUsers.find(u => u.username === username);

                        if (current && current.home !== home && home) {

                            await ipcRenderer.invoke('ssh:change-user-home', { username, home });

                        }



                        // 4. Groups Management

                        // We need to calc diff for secondary groups

                        // This is complex because 'groups' command output in 'get-system-users' isn't fully robust for user->groups mapping

                        // relying on group members list instead.



                        // Current groups this user is in

                        const currentGroups = window.systemGroups.filter(g => g.members.includes(username)).map(g => g.name);



                        // To Add

                        const toAdd = secondaryGroups.filter(g => !currentGroups.includes(g));

                        for (const g of toAdd) {

                            await ipcRenderer.invoke('ssh:add-user-to-group', { username, group: g });

                        }



                        // To Remove (be careful not to remove primary group if displayed here)

                        // In Linux, usermod -G overwrites secondary groups if used directly, but we have individual add/remove

                        const toRemove = currentGroups.filter(g => !secondaryGroups.includes(g) && g !== primaryGroup); // Simple safety check

                        for (const g of toRemove) {

                            await ipcRenderer.invoke('ssh:remove-user-from-group', { username, group: g });

                        }



                        loadUsersGroups();



                    } catch (e) { alert(e.message); }

                    finally { hideLoader(); }

                }

            }





            // --- GROUP MODAL LOGIC ---

            function openGroupModal(groupname = null) {

                const modal = document.getElementById('group-modal');

                const title = document.getElementById('group-modal-title');

                const modeInput = document.getElementById('group-modal-mode');

                const origInput = document.getElementById('group-modal-original-name');

                const nameIn = document.getElementById('group-input-name');



                nameIn.value = '';



                if (groupname) {

                    title.innerText = "Edit Group";

                    modeInput.value = "edit";

                    origInput.value = groupname;

                    nameIn.value = groupname;

                } else {

                    title.innerText = "Create New Group";

                    modeInput.value = "create";

                    origInput.value = "";

                }

                modal.classList.remove('hidden');

            }



            function closeGroupModal() {

                document.getElementById('group-modal').classList.add('hidden');

            }



            async function submitGroupForm() {

                const mode = document.getElementById('group-modal-mode').value;

                const name = document.getElementById('group-input-name').value;

                const oldName = document.getElementById('group-modal-original-name').value;



                if (!name) return alert("Group name is required");

                closeGroupModal();



                if (mode === 'create') {

                    createSystemGroup(name);

                } else {

                    if (name === oldName) return; // No change



                    showLoader("Updating Group...", `Renaming to ${name}`);

                    try {

                        const res = await ipcRenderer.invoke('ssh:update-group-name', { oldName, newName: name });

                        if (res.success) loadUsersGroups();

                        else alert("Failed: " + res.error);

                    } catch (e) { alert(e.message); }

                    finally { hideLoader(); }

                }

            }





            async function deleteUser(username) {

                if (!confirm(`Are you sure you want to delete user '${username}'? This will remove their home directory.`)) return;

                showLoader("Deleting User...", `Removing ${username}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:delete-user', username);

                    if (res.success) loadUsersGroups();

                    else alert("Failed to delete user: " + res.error);

                } catch (e) { alert("Error: " + e.message); }

                finally { hideLoader(); }

            }



            async function deleteGroup(name) {

                if (!confirm(`Are you sure you want to delete group '${name}'?`)) return;

                showLoader("Deleting Group...", `Removing ${name}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:delete-group', name);

                    if (res.success) loadUsersGroups();

                    else alert("Failed to delete group: " + res.error);

                } catch (e) { alert("Error: " + e.message); }

                finally { hideLoader(); }

            }



            async function createSystemGroup(name) {

                showLoader("Creating Group...", `Adding ${name}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:create-group', name);

                    if (res.success) loadUsersGroups();

                    else alert("Failed to create group: " + res.error);

                } catch (e) { alert("Error: " + e.message); }

                finally { hideLoader(); }

            }



            // --- 10. GLOBAL APPS LOGIC ---

            const APP_CATALOG = [

                { id: 'docker.io', name: 'Docker Engine', icon: 'fab fa-docker', color: 'text-blue-500', bg: 'bg-blue-50', desc: 'Container platform' },

                { id: 'nginx', name: 'Nginx Web Server', icon: 'fas fa-server', color: 'text-green-600', bg: 'bg-green-50', desc: 'High perf web server' },

                { id: 'nodejs', name: 'Node.js (LTS)', icon: 'fab fa-node-js', color: 'text-green-500', bg: 'bg-green-50', desc: 'JS Runtime' },

                { id: 'git', name: 'Git', icon: 'fab fa-git-alt', color: 'text-orange-600', bg: 'bg-orange-50', desc: 'Version Control' },

                { id: 'python3', name: 'Python 3', icon: 'fab fa-python', color: 'text-yellow-600', bg: 'bg-yellow-50', desc: 'Programming Language' },

                { id: 'mysql-server', name: 'MySQL Server', icon: 'fas fa-database', color: 'text-blue-800', bg: 'bg-blue-50', desc: 'Relational Database' },

                { id: 'redis-server', name: 'Redis', icon: 'fas fa-layer-group', color: 'text-red-600', bg: 'bg-red-50', desc: 'In-memory Cache' },

                { id: 'htop', name: 'HTOP', icon: 'fas fa-chart-bar', color: 'text-purple-600', bg: 'bg-purple-50', desc: 'Interactive Process Viewer' },

                { id: 'zip', name: 'Zip/Unzip', icon: 'fas fa-file-archive', color: 'text-gray-600', bg: 'bg-gray-100', desc: 'Compression Tools' }

            ];



            async function loadGlobalApps() {

                if (!isConnected) return;

                const container = document.getElementById('apps-grid-container');

                if (!container) return;



                container.innerHTML = getSkeletonHtml('card-grid');



                // 1. Get List of Package IDs

                const pkgIds = APP_CATALOG.map(a => a.id);



                // 2. Check statuses in batch

                let installedMap = {};

                try {

                    const res = await ipcRenderer.invoke('ssh:check-installed', pkgIds);

                    if (res.success) installedMap = res.results;

                } catch (e) { console.error("Failed to check packages", e); }



                container.innerHTML = APP_CATALOG.map(app => {

                    const isInstalled = installedMap[app.id] === true;



                    // Button Logic

                    let actionsHtml = '';

                    if (isInstalled) {

                        actionsHtml = `

                        <div class="flex gap-2">

                             <button onclick="reinstallPackage('${app.id}')" class="flex-1 px-2.5 py-1.5 bg-gray-50 hover:bg-orange-50 text-gray-600 hover:text-orange-600 border border-gray-200 hover:border-orange-200 rounded-lg text-[10px] font-bold transition-all uppercase tracking-wide" title="Reinstall / Update">

                                <i class="fas fa-sync-alt"></i>

                             </button>

                             <button onclick="uninstallPackage('${app.id}')" class="flex-1 px-2.5 py-1.5 bg-gray-50 hover:bg-red-50 text-gray-600 hover:text-red-600 border border-gray-200 hover:border-red-200 rounded-lg text-[10px] font-bold transition-all uppercase tracking-wide" title="Uninstall">

                                <i class="fas fa-trash-alt"></i>

                             </button>

                        </div>

                        `;

                    } else {

                        actionsHtml = `

                        <button onclick="installPackage('${app.id}')" class="w-full px-2.5 py-1.5 bg-gray-50 hover:bg-indigo-600 hover:text-white text-indigo-600 border border-gray-200 hover:border-indigo-600 rounded-lg text-[10px] font-bold transition-all uppercase tracking-wide">

                            Install

                        </button>

                        `;

                    }



                    return `

                  <div class="bg-white border ${isInstalled ? 'border-green-200 ring-1 ring-green-100' : 'border-gray-200'} rounded-xl p-4 hover:shadow-md transition-all group relative flex flex-col justify-between">

                       ${isInstalled ? '<div class="absolute top-2 right-2 text-green-500 text-xs"><i class="fas fa-check-circle"></i></div>' : ''}

                       <div class="flex items-center justify-between mb-3">

                           <div class="w-10 h-10 ${app.bg} rounded-lg flex items-center justify-center ${app.color} text-lg shadow-sm">

                               <i class="${app.icon}"></i>

                           </div>

                       </div>

                       <div class="mb-3">

                           <h3 class="text-sm font-bold text-gray-900 mb-0.5">${app.name}</h3>

                           <p class="text-[10px] text-gray-500 leading-tight">${app.desc}</p>

                       </div>

                       <div class="mt-auto pt-3 border-t border-gray-50">

                            ${actionsHtml}

                       </div>

                  </div>

             `}).join('');

            }



            async function installPackage(pkg) {

                if (!confirm(`Are you sure you want to install ${pkg} globally?`)) return;



                showLoader("Installing...", `Downloading and configuring ${pkg}`);

                try {

                    const res = await ipcRenderer.invoke('ssh:install-package', pkg);

                    if (res.success) {

                        alert(`${pkg} installed successfully!`);

                        loadGlobalApps();

                    } else {

                        alert(`Installation failed: ${res.error}`);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function uninstallPackage(pkg) {

                if (!confirm(`Are you sure you want to UNINSTALL ${pkg}? This may affect running services.`)) return;



                showLoader("Uninstalling...", `Removing ${pkg} from system`);

                try {

                    const res = await ipcRenderer.invoke('ssh:remove-package', pkg);

                    if (res.success) {

                        alert(`${pkg} uninstalled successfully.`);

                        loadGlobalApps();

                    } else {

                        alert(`Uninstallation failed: ${res.error}`);

                    }

                } catch (e) {

                    alert("Error: " + e.message);

                } finally {

                    hideLoader();

                }

            }



            async function reinstallPackage(pkg) {

                if (!confirm(`Reinstall ${pkg}? This will update to the latest version.`)) return;

                // Reuse install logic, apt-get install will upgrade/reinstall

                installPackage(pkg);

            }



            function filterApps(query) {

                const container = document.getElementById('apps-grid-container');

                if (!container) return;



                const term = query.toLowerCase();

                const cards = container.children; // HTMLCollection



                // This is naive DOM filtering since we rendered statically

                Array.from(cards).forEach(card => {

                    const title = card.querySelector('h3').innerText.toLowerCase();

                    if (title.includes(term)) {

                        card.style.display = 'block';

                    } else {

                        card.style.display = 'none';

                    }

                });

            }







            // Note: ssh:log-event listener is at the top of the script (line ~524)

            // Do not add duplicate listeners here.






            // Start initialization
            initProfile();

            // Force open Control Center (Servers) on startup
            setTimeout(() => navigate('servers'), 100);
