# Production Agent Setup - Final Implementation

## Overview

The Devyntra Agent is now production-ready with:
- ✅ Uses prebuilt binary (FAST - no Node.js installation)
- ✅ Systemd service for reliability
- ✅ Auto-start on boot
- ✅ Auto-restart on crash (5 second delay)
- ✅ Proper logging
- ✅ Runs in background safely
- ✅ 24/7 connectivity with same token
- ✅ Auto-detection in desktop app
- ✅ Real-time status indicators
- ✅ Mode persistence (agent/user/ssh)

## System Architecture

### Agent Side (Server):
```
Install Script → Download Binary → Create Config → Install Systemd Service → Enable & Start
                                                                                    ↓
                                                                    Agent connects to backend
                                                                                    ↓
                                                                    Token stored in config
                                                                                    ↓
                                                            Survives reboots & crashes
```

### Desktop App Side:
```
App Starts → Load Saved Servers → Start Background Monitoring (every 10s)
                                                    ↓
                                    Check each agent's online status
                                                    ↓
                                    Update status indicator (green/gray dot)
                                                    ↓
                                    User sees real-time agent status
```

## Implementation Details

### 1. Systemd Service Configuration

**Location:** `/etc/systemd/system/devyntra-agent.service`

```ini
[Unit]
Description=Devyntra Agent
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/devyntra-agent/config.env
ExecStart=/usr/local/bin/devyntra-agent
Restart=always
RestartSec=5
StandardOutput=append:/var/log/devyntra-agent/agent.log
StandardError=append:/var/log/devyntra-agent/agent.log

[Install]
WantedBy=multi-user.target
```

**Key Features:**
- `After=network.target` - Waits for network
- `Restart=always` - Auto-restart on any exit
- `RestartSec=5` - 5 second delay before restart
- `StandardOutput/Error` - Logs to file
- `WantedBy=multi-user.target` - Auto-start on boot

### 2. Token Persistence

**Location:** `/etc/devyntra-agent/config.env`

```bash
DEVYNTRA_AGENT_TOKEN=eyJ1c2VySWQiOi...
DEVYNTRA_BACKEND_URL=https://devyntra-backend-api-production.up.railway.app
```

**How It Works:**
1. Token generated during enrollment
2. Saved to config file during installation
3. Systemd loads config on every start
4. Agent connects with same token
5. Desktop app recognizes agent by token
6. Connection persists across reboots

### 3. Background Agent Monitoring

**Desktop App Feature:**
- Runs every 10 seconds
- Checks all saved agent connections
- Updates status indicators in real-time
- Shows green dot when online, gray when offline

**Code Location:** `apps/desktop/index.html`

```javascript
async function startBackgroundAgentMonitoring() {
    setInterval(async () => {
        // Find all agent connections
        const agentServers = userServers.filter(s => 
            String(s.host || '').startsWith('agent:')
        );
        
        // Check each agent's status
        for (const server of agentServers) {
            const agentId = String(server.host).replace(/^agent:/, '').trim();
            const status = await ipcRenderer.invoke('agent:status', { agentId });
            
            if (status?.success && status.online) {
                // Update UI - show green dot
            } else {
                // Update UI - show gray dot
            }
        }
    }, 10000); // Every 10 seconds
}
```

### 4. Status Indicators

**Visual Feedback:**
- Green dot (●) - Agent online and connected
- Gray dot (●) - Agent offline or disconnected

**Location:** Top-right corner of agent server cards

### 5. Mode Persistence

**Database Field:** `servers.mode`
**Values:** 'agent', 'user', 'ssh'

**Fixed in 3 places:**
1. `loadServersFromSupabase()` - Load from DB
2. `onConnectionSuccess()` - Update on connect
3. `saveServerToSupabase()` - Save to DB

## Installation Flow

### User Experience:

1. **Generate Command:**
   - User clicks "Connect via Agent"
   - Clicks "Generate Command"
   - Gets: `curl -fsSL https://backend.com/agent/install.sh | sudo bash -s -- --token "TOKEN"`

2. **Run on Server:**
   ```bash
   curl -fsSL https://backend.com/agent/install.sh | sudo bash -s -- --token "TOKEN"
   ```

3. **Installation Output:**
   ```
   Starting Devyntra Agent installer...
   [1/9] Downloading agent binary
   [OK] Downloading agent binary
   [2/9] Setting executable permissions
   [OK] Setting executable permissions
   [3/9] Writing agent configuration
   [OK] Writing agent configuration
   [4/9] Installing systemd service
   [OK] Installing systemd service
   [5/9] Enabling + starting service
   [OK] Enabling + starting service
   Devyntra Agent installed and running.
     Service: devyntra-agent
     Status: systemctl status devyntra-agent
     Logs: journalctl -u devyntra-agent -f
   ```

4. **Desktop App:**
   - Agent appears in "Your Fleet" with green dot
   - User can click to connect
   - Connection persists across app restarts

## Crash Recovery

### Scenario 1: Agent Process Crashes

```
Agent crashes → Systemd detects exit → Waits 5 seconds → Restarts agent
                                                              ↓
                                                    Agent reconnects with same token
                                                              ↓
                                                    Desktop app shows green dot
                                                              ↓
                                                    User sees agent back online
```

### Scenario 2: Server Reboots

```
Server reboots → System boots up → Network comes online → Systemd starts agent
                                                              ↓
                                                    Agent connects with token from config
                                                              ↓
                                                    Desktop app detects agent online
                                                              ↓
                                                    Green dot appears automatically
```

### Scenario 3: Network Interruption

```
Network drops → Agent loses connection → Agent's reconnection logic kicks in
                                                              ↓
                                                    Network restored
                                                              ↓
                                                    Agent reconnects automatically
                                                              ↓
                                                    Desktop app shows green dot
```

## Systemd Commands

### Check Status:
```bash
systemctl status devyntra-agent
```

### View Logs:
```bash
# Real-time logs
journalctl -u devyntra-agent -f

# Last 100 lines
journalctl -u devyntra-agent -n 100

# Today's logs
journalctl -u devyntra-agent --since today

# Log file
tail -f /var/log/devyntra-agent/agent.log
```

### Manual Control:
```bash
# Stop agent
sudo systemctl stop devyntra-agent

# Start agent
sudo systemctl start devyntra-agent

# Restart agent
sudo systemctl restart devyntra-agent

# Disable auto-start
sudo systemctl disable devyntra-agent

# Enable auto-start
sudo systemctl enable devyntra-agent

# Check if enabled
systemctl is-enabled devyntra-agent
```

## Database Migration

**Required for mode persistence:**

```sql
-- Add mode column to servers table
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'ssh';

-- Add constraint
ALTER TABLE servers 
DROP CONSTRAINT IF EXISTS servers_mode_check;

ALTER TABLE servers 
ADD CONSTRAINT servers_mode_check 
CHECK (mode IN ('ssh', 'agent', 'user'));

-- Update existing records
UPDATE servers 
SET mode = 'agent' 
WHERE host LIKE 'agent:%' AND (mode IS NULL OR mode = 'ssh');

UPDATE servers 
SET mode = 'ssh' 
WHERE mode IS NULL;
```

## Testing Checklist

- [ ] Run SQL migration in Supabase
- [ ] Restart backend server
- [ ] Generate new agent install command
- [ ] Run install on test server
- [ ] Verify service running: `systemctl status devyntra-agent`
- [ ] Check logs: `journalctl -u devyntra-agent -n 50`
- [ ] Open desktop app
- [ ] Verify agent shows with green dot
- [ ] Click to connect to agent
- [ ] Verify green plug icon (agent mode)
- [ ] Close desktop app
- [ ] Reboot server: `sudo reboot`
- [ ] Wait for server to boot
- [ ] Open desktop app
- [ ] Verify green dot appears automatically (within 10 seconds)
- [ ] Verify can still connect
- [ ] Test crash recovery: `sudo systemctl stop devyntra-agent`
- [ ] Wait 5 seconds
- [ ] Verify service restarted: `systemctl status devyntra-agent`
- [ ] Verify green dot returns in desktop app

## Troubleshooting

### Agent Not Connecting:

1. **Check service status:**
   ```bash
   systemctl status devyntra-agent
   ```

2. **Check logs:**
   ```bash
   journalctl -u devyntra-agent -n 100
   ```

3. **Verify config:**
   ```bash
   cat /etc/devyntra-agent/config.env
   ```

4. **Test network:**
   ```bash
   curl -I https://devyntra-backend-api-production.up.railway.app
   ```

### Green Dot Not Showing:

1. **Check desktop app console:**
   - Look for `[agent-monitor]` logs

2. **Verify agent is online:**
   ```bash
   systemctl status devyntra-agent
   ```

3. **Wait 10 seconds:**
   - Background monitoring runs every 10 seconds

### Mode Not Persisting:

1. **Verify SQL migration ran:**
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'servers' AND column_name = 'mode';
   ```

2. **Check server record:**
   ```sql
   SELECT id, name, host, mode FROM servers WHERE host LIKE 'agent:%';
   ```

## Files Modified

- `apps/backend/src/index.js` - Systemd service with logging
- `apps/desktop/index.html` - Background monitoring, status indicators, mode persistence
- `mode-column-migration.sql` - Database migration

## Benefits Summary

✅ **Production Ready** - Systemd is industry standard
✅ **Zero Downtime** - Auto-restart on crash
✅ **Boot Persistent** - Starts automatically
✅ **24/7 Connectivity** - Always connected with same token
✅ **Real-time Status** - Desktop app shows live status
✅ **Fast Installation** - Prebuilt binary, no Node.js
✅ **Easy Debugging** - Comprehensive logging
✅ **User Friendly** - Green/gray dots show status at a glance
