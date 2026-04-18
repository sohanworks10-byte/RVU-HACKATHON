# Verify and Fix Agent Connection - Step by Step

## Current Status: Migration NOT Run Yet

The code changes are in place, but the database tables haven't been created yet. Follow these steps:

## Step 1: Run Migration in Supabase (EASIEST - DO THIS)

Since you don't have `DATABASE_URL` configured locally, use Supabase SQL Editor:

1. **Open Supabase SQL Editor**: 
   https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new

2. **Copy this entire SQL** (from the file `apps/backend/src/migrations/007_servers_and_agents.sql`):

```sql
-- Copy the ENTIRE contents of apps/backend/src/migrations/007_servers_and_agents.sql
-- It starts with: CREATE TABLE IF NOT EXISTS servers...
-- And ends with: ...USING (auth.uid() = user_id);
```

3. **Paste into SQL Editor and click RUN**

4. **Verify it worked** - Run this query:
```sql
SELECT tablename FROM pg_tables WHERE tablename IN ('servers', 'agents');
```

You should see:
```
tablename
---------
servers
agents
```

## Step 2: Restart Your Backend Server

After running the migration, restart your backend:

### If running locally:
```bash
cd apps/backend
# Kill existing process
taskkill /F /IM node.exe
# Or on Linux: pkill -f "node.*index.js"

# Start again
npm run dev
```

### If running on a server (Railway, Render, etc.):
- Go to your hosting dashboard
- Click "Restart" or "Redeploy"
- Wait for it to come back online

## Step 3: Verify Agent is Running on Your Server

SSH to your server and check:

```bash
# Check if agent is running
screen -list | grep devyntra-agent

# If not running, restart it with the installation command
# (the one you copied from the desktop app)
```

## Step 4: Check Backend Logs

After backend restarts, check if agent connects and saves to database:

```bash
cd apps/backend
cat stdout.txt | grep "agent-ws"
# or
tail -f stdout.txt
```

You should see:
```
[agent-ws] Agent <id> saved to database
[agent-ws] Agent <id> metadata updated
```

## Step 5: Verify in Database

In Supabase SQL Editor, run:

```sql
SELECT agent_id, hostname, status, last_seen, created_at 
FROM agents 
ORDER BY created_at DESC;
```

You should see your agent with `status = 'online'`.

## Step 6: Restart Desktop App COMPLETELY

**CRITICAL**: You must completely close and reopen the desktop app:

1. Close all windows
2. Right-click the app in taskbar and click "Quit" or "Exit"
3. Reopen the app from Start menu/Applications
4. Log in again
5. Check sidebar - should now show all options

## Quick Verification Checklist

Run these checks in order:

### ✅ Check 1: Tables Exist
```sql
SELECT COUNT(*) FROM agents;
SELECT COUNT(*) FROM servers;
```
Both should work without errors.

### ✅ Check 2: Agent in Database
```sql
SELECT * FROM agents WHERE status = 'online';
```
Should show your connected agent.

### ✅ Check 3: Backend Running
```bash
curl http://localhost:4000/health
# Should return: {"ok":true}
```

### ✅ Check 4: Agent Connected
On your server:
```bash
screen -r devyntra-agent
# Should show: "Connected to Devyntra backend"
# Press Ctrl+A then D to detach
```

### ✅ Check 5: Desktop App Loaded Servers
Open desktop app, press `Ctrl+Shift+I` (Developer Tools), check Console:
- Should see: "Loaded X servers/agents"
- Should NOT see errors about missing tables

## If Still Not Working After All Steps

### Debug 1: Check if migration actually ran
```sql
-- This should NOT error
SELECT * FROM agents LIMIT 1;
```

If it errors with "relation agents does not exist", the migration didn't run.

### Debug 2: Check backend is using updated code
```bash
cd apps/backend
git log -1 --oneline
# Should show: "Fix agent connection issue..."
```

### Debug 3: Check desktop app is using updated code
```bash
cd apps/desktop
git log -1 --oneline
# Should show recent commit
```

### Debug 4: Clear desktop app cache
Close app completely, then:
- Windows: Delete `%APPDATA%/devyntra-desktop/`
- Linux: Delete `~/.config/devyntra-desktop/`
- Reopen app

## Expected Result

After completing ALL steps above:

1. ✅ Agent shows in database with status='online'
2. ✅ Backend logs show agent saved to database
3. ✅ Desktop app sidebar shows ALL menu items (not just 6)
4. ✅ Dashboard displays real server stats (CPU, Memory, etc.)
5. ✅ Monitoring page shows real-time graphs
6. ✅ All features work normally

## Most Common Mistake

**Not restarting the desktop app completely!**

You must:
1. Close ALL windows
2. Quit the app (not just close window)
3. Reopen from scratch
4. Log in again

The app caches the server list on startup. If you don't restart it, it won't load the new agent from the database.
