# Systemd Production Setup - Final Implementation

## Overview

The Devyntra Agent now uses systemd for production-ready deployment with:
- ✅ Auto-start on boot
- ✅ Auto-restart if crash (5 second delay)
- ✅ Proper logging to `/var/log/devyntra-agent/agent.log`
- ✅ Runs in background safely
- ✅ Production ready
- ✅ Persistent connection with same token (survives reboots)

## Changes Made

### 1. Backend Install Script (`apps/backend/src/index.js`)

**Removed:**
- `--install` flag and screen session logic
- All screen-related code

**Enhanced Systemd Service:**
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
- `After=network.target` - Waits for network before starting
- `Restart=always` - Auto-restart on any failure
- `RestartSec=5` - Wait 5 seconds before restart
- `StandardOutput/StandardError` - Logs to file
- `WantedBy=multi-user.target` - Auto-start on boot

### 2. Desktop App (`apps/desktop/index.html`)

**Removed:**
- `--install` flag appending logic

**Kept:**
- Simple command generation
- Mode persistence fixes

### 3. Agent Code (`agent-repo/agent.js`)

**Removed:**
- All `--install` mode handling
- Screen session setup code
- `execSync` import

**Kept:**
- Core WebSocket connection logic
- Auto-reconnection on disconnect
- Command execution

### 4. Mode Persistence (`apps/desktop/index.html`)

**Fixed in 3 places:**

1. **loadServersFromSupabase()** - Load mode from database
2. **onConnectionSuccess()** - Update mode for existing servers
3. **saveServerToSupabase()** - Save mode to database

## How It Works

### Installation Flow:

1. User generates install command in desktop app
2. Command: `curl -fsSL https://backend.com/agent/install.sh | sudo bash -s -- --token "TOKEN"`
3. Install script:
   - Downloads prebuilt binary (fast)
   - Creates `/etc/devyntra-agent/config.env` with token
   - Installs systemd service
   - Enables service (auto-start on boot)
   - Starts service immediately

### Runtime Behavior:

1. **Normal Operation:**
   - Agent connects to backend via WebSocket
   - Token stored in `/etc/devyntra-agent/config.env`
   - Runs continuously in background

2. **On Crash:**
   - Systemd detects process exit
   - Waits 5 seconds
   - Restarts agent automatically
   - Agent reconnects with same token

3. **On Reboot:**
   - System boots up
   - Network comes online
   - Systemd starts devyntra-agent service
   - Agent connects with same token from config file

4. **Connection Persistence:**
   - Token never changes
   - Desktop app recognizes agent by token
   - Connection restored automatically
   - No manual reconnection needed

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

# Log file
tail -f /var/log/devyntra-agent/agent.log
```

### Manual Control:
```bash
# Stop agent
systemctl stop devyntra-agent

# Start agent
systemctl start devyntra-agent

# Restart agent
systemctl restart devyntra-agent

# Disable auto-start
systemctl disable devyntra-agent

# Enable auto-start
systemctl enable devyntra-agent
```

## Database Migration

Run this SQL in Supabase to enable mode persistence:

```sql
-- Add mode column to servers table
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'ssh';

-- Add constraint to ensure only valid values
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
- [ ] Run install command on test server
- [ ] Verify service is running: `systemctl status devyntra-agent`
- [ ] Connect to agent in desktop app
- [ ] Verify green plug icon shows (agent mode)
- [ ] Close desktop app
- [ ] Reboot server: `sudo reboot`
- [ ] Wait for server to come back online
- [ ] Open desktop app
- [ ] Verify agent auto-reconnects
- [ ] Verify green plug icon persists
- [ ] Check logs: `journalctl -u devyntra-agent -n 50`

## Benefits

### Production Ready:
- Systemd is the standard init system for modern Linux
- Battle-tested and reliable
- Used by millions of production servers

### Auto-Recovery:
- Crashes don't require manual intervention
- Service restarts automatically
- Connection restored without user action

### Logging:
- All output captured to log file
- Easy to debug issues
- Logs persist across restarts

### Boot Persistence:
- Agent starts automatically on server boot
- No manual startup required
- Connection restored after reboot

### Token Persistence:
- Token stored in config file
- Survives reboots and restarts
- Desktop app recognizes agent automatically
- No re-enrollment needed

## Files Modified

- `apps/backend/src/index.js` - Enhanced systemd service, removed screen
- `apps/desktop/index.html` - Mode persistence fixes, removed --install flag
- `agent-repo/agent.js` - Removed screen installation code
- `mode-column-migration.sql` - Database migration for mode persistence
