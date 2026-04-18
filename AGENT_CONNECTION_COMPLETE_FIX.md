# Complete Fix for Agent Connection Issue

## Problem Summary
- Agent connects successfully to backend (shows "CONNECTED: AGENT:063766EB...")
- But desktop app shows limited sidebar options
- Server performance data not loading
- Only showing: Dashboard, Monitoring, FileManager, Tasks, Terminal, History

## Root Causes Identified

1. **Missing Database Tables**: `servers` and `agents` tables don't exist in Supabase
2. **Backend Not Persisting Agent Data**: WebSocket connection handler wasn't saving agent info to database
3. **Desktop App Not Refreshing**: After agent connects, app doesn't reload server list from database

## Complete Solution

### Part 1: Create Database Tables

Run this SQL in Supabase SQL Editor (https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new):

```sql
-- Create servers table
CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  host text NOT NULL,
  ip text,
  username text NOT NULL DEFAULT 'root',
  key_path text,
  private_key text,
  key_stored_in_cloud boolean DEFAULT false,
  is_elastic boolean DEFAULT false,
  mode text DEFAULT 'ssh',
  params jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_servers_user_id ON servers(user_id);
CREATE INDEX IF NOT EXISTS idx_servers_host ON servers(host);

-- Create agents table
CREATE TABLE IF NOT EXISTS agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  agent_id text NOT NULL UNIQUE,
  name text,
  hostname text,
  ip text,
  host text,
  username text DEFAULT 'root',
  agent_version text,
  platform text,
  arch text,
  mode text DEFAULT 'agent',
  status text DEFAULT 'offline',
  last_seen timestamptz,
  params jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agents_user_id ON agents(user_id);
CREATE INDEX IF NOT EXISTS idx_agents_agent_id ON agents(agent_id);
CREATE INDEX IF NOT EXISTS idx_agents_status ON agents(status);

-- Enable RLS
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any
DROP POLICY IF EXISTS "Users can view their own servers" ON servers;
DROP POLICY IF EXISTS "Users can insert their own servers" ON servers;
DROP POLICY IF EXISTS "Users can update their own servers" ON servers;
DROP POLICY IF EXISTS "Users can delete their own servers" ON servers;
DROP POLICY IF EXISTS "Users can view their own agents" ON agents;
DROP POLICY IF EXISTS "Users can insert their own agents" ON agents;
DROP POLICY IF EXISTS "Users can update their own agents" ON agents;
DROP POLICY IF EXISTS "Users can delete their own agents" ON agents;

-- Create RLS policies for servers
CREATE POLICY "Users can view their own servers"
  ON servers FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own servers"
  ON servers FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own servers"
  ON servers FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own servers"
  ON servers FOR DELETE USING (auth.uid() = user_id);

-- Create RLS policies for agents
CREATE POLICY "Users can view their own agents"
  ON agents FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own agents"
  ON agents FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own agents"
  ON agents FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own agents"
  ON agents FOR DELETE USING (auth.uid() = user_id);
```

### Part 2: Restart Backend Server

The backend code has been updated to save agent data when it connects. Restart it:

```bash
cd apps/backend

# If running with npm
pkill -f "node.*index.js"
npm run dev

# If running with PM2
pm2 restart devyntra-backend

# If running with systemd
sudo systemctl restart devyntra-backend
```

### Part 3: Verify Agent Connection

On your server where the agent is running:

```bash
# Check if agent is running
screen -list | grep devyntra-agent

# View logs (should show "Connected to Devyntra backend")
screen -r devyntra-agent
# Press Ctrl+A then D to detach
```

### Part 4: Verify Database Entry

Check if agent was saved to database:

```sql
SELECT agent_id, hostname, status, last_seen 
FROM agents 
ORDER BY created_at DESC 
LIMIT 5;
```

You should see your agent with `status = 'online'`.

### Part 5: Refresh Desktop App

**Important**: The desktop app needs to be completely restarted to reload the server list.

1. **Close the desktop app completely** (not just the window, but quit the app)
2. **Reopen the desktop app**
3. **Log in again**
4. The sidebar should now show all options and server data should load

## What Was Fixed

### Backend Changes (`apps/backend/src/index.js`)
- WebSocket connection handler now saves agent to database when it connects
- Agent metadata (hostname, platform, arch) is saved on first "hello" message
- Agent status is updated to "offline" when it disconnects

### Desktop App Changes (`apps/desktop/test_script.js`)
- Added `loadServersFromSupabase()` call after successful agent connection
- This ensures the UI refreshes with the newly connected agent

### Database Schema (`apps/backend/src/migrations/007_servers_and_agents.sql`)
- Created `servers` table for SSH connections
- Created `agents` table for agent connections
- Added proper indexes and RLS policies

## Verification Steps

1. **Check agent is in database**:
   ```sql
   SELECT * FROM agents WHERE status = 'online';
   ```

2. **Check backend logs**:
   ```bash
   cd apps/backend
   tail -f stdout.txt | grep agent-ws
   ```
   Should show:
   ```
   [agent-ws] Agent <id> saved to database
   [agent-ws] Agent <id> metadata updated
   ```

3. **Check desktop app console** (Ctrl+Shift+I):
   - Should show: `Loaded X servers/agents`
   - No errors about missing tables

4. **Verify sidebar**:
   - Should show all menu items
   - Dashboard should display server stats
   - Monitoring should show real-time data

## Troubleshooting

### Still showing limited options after restart?

1. **Clear app cache**:
   - Close app
   - Delete: `%APPDATA%/devyntra-desktop/` (Windows) or `~/.config/devyntra-desktop/` (Linux)
   - Reopen app

2. **Check authentication**:
   - Log out and log back in
   - Verify you're using the same account that enrolled the agent

3. **Check browser console for errors**:
   - Press Ctrl+Shift+I
   - Look for errors related to Supabase or database queries

### Agent shows offline in database?

1. **Restart agent on server**:
   ```bash
   screen -X -S devyntra-agent quit
   # Then run the installation command again
   ```

2. **Check backend is running**:
   ```bash
   curl http://localhost:4000/health
   # Should return: {"ok":true}
   ```

3. **Check WebSocket connection**:
   ```bash
   netstat -an | grep :4000
   ```

## Expected Behavior After Fix

1. Agent connects via WebSocket
2. Backend saves agent to `agents` table with status='online'
3. Desktop app loads agents from database on startup
4. Sidebar shows all options
5. Dashboard displays real server stats
6. Monitoring shows real-time performance data
7. All features work normally

## Files Modified

- `apps/backend/src/migrations/007_servers_and_agents.sql` - New migration
- `apps/backend/src/index.js` - Updated WebSocket handler
- `apps/desktop/test_script.js` - Added server list reload after agent connection
