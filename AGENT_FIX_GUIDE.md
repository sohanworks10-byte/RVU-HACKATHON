# Agent Connection Fix Guide

## Problem
Your agent is connecting to the backend successfully, but the desktop app shows limited sidebar options because it cannot fetch server/agent data from the database. The `servers` and `agents` tables are missing from your Supabase database.

## Root Cause
1. The agent connects via WebSocket and registers in memory only
2. The desktop app tries to fetch data from `servers` and `agents` tables in Supabase
3. These tables don't exist in your database schema
4. Without this data, the UI shows limited options

## Solution

### Step 0: Get Your Database Connection String

You need to add your Supabase database URL to run migrations. Choose one of these methods:

#### Method A: Add DATABASE_URL to .env (Recommended)

1. Go to https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm
2. Click **Settings** → **Database**
3. Copy the **Connection string** (URI format)
4. Add to `apps/backend/.env`:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.psnrofnlgpqkfprjrbnm.supabase.co:5432/postgres
   ```

#### Method B: Run Migration in Supabase SQL Editor

1. Go to your Supabase dashboard → **SQL Editor**
2. Click **New query**
3. Copy contents of `apps/backend/src/migrations/007_servers_and_agents.sql`
4. Paste and click **Run**
5. Skip to Step 2 below

### Step 1: Run the Database Migration (if using Method A)

Navigate to your backend directory and run the migration:

```bash
cd apps/backend
node src/infra/migrate.js src/migrations/007_servers_and_agents.sql
```

This will create:
- `servers` table - for SSH connections
- `agents` table - for agent connections
- Proper indexes and Row Level Security (RLS) policies

### Step 2: Restart Your Backend Server

After running the migration, restart your backend:

```bash
# If running in development
npm run dev

# If running in production
pm2 restart devyntra-backend
# or
systemctl restart devyntra-backend
```

### Step 3: Reconnect Your Agent

On your server where the agent is running:

1. Check if the agent is still running:
```bash
screen -list | grep devyntra-agent
```

2. If it's running, the agent should automatically reconnect and be saved to the database

3. If not running, restart it using the installation command from your desktop app

### Step 4: Verify in Desktop App

1. Restart your desktop application
2. Log in again
3. The sidebar should now show all options including:
   - Dashboard
   - Monitoring
   - FileManager
   - Tasks
   - Terminal
   - History
   - Servers (with your connected agent)

## What Changed

### Database Schema
- Added `agents` table to store agent connection information
- Added `servers` table to store SSH server connections
- Both tables have proper RLS policies for user isolation

### Backend Code
- Modified WebSocket connection handler to persist agent data
- Agent status is now saved as 'online' when connected
- Agent metadata (hostname, platform, arch) is saved on first 'hello' message
- Agent status is updated to 'offline' when disconnected

## Troubleshooting

### Agent shows as offline
```bash
# Check agent logs
screen -r devyntra-agent

# Restart agent
screen -X -S devyntra-agent quit
# Then run the installation command again
```

### Tables not created
```bash
# Verify migration ran successfully
psql $DATABASE_URL -c "SELECT tablename FROM pg_tables WHERE tablename IN ('servers', 'agents');"
```

### Desktop app still shows limited options
1. Clear browser cache (if using web version)
2. Restart desktop app completely
3. Check browser console for errors (Ctrl+Shift+I)
4. Verify you're logged in with the same user account

### Check agent in database
```bash
# Connect to your database
psql $DATABASE_URL

# Check agents table
SELECT agent_id, hostname, status, last_seen FROM agents;
```

## Additional Notes

- The agent will automatically reconnect if the connection drops
- Agent status is updated every 30 seconds via ping/pong
- Agents are marked offline after 90 seconds of no activity
- Each agent has a unique `agent_id` that persists across reconnections
