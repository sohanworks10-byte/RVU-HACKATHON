# Agent Connection Fix - Quick Checklist

## ✅ Step-by-Step Fix (5 minutes)

### 1. Run SQL Migration
- [ ] Go to: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new
- [ ] Copy contents of `apps/backend/src/migrations/007_servers_and_agents.sql`
- [ ] Paste and click **Run**
- [ ] Verify: Run `SELECT * FROM agents;` (should not error)

### 2. Restart Backend
- [ ] Open terminal in `apps/backend`
- [ ] Run: `pkill -f "node.*index.js"` (or `pm2 restart devyntra-backend`)
- [ ] Run: `npm run dev` (or your start command)
- [ ] Verify: Check logs show no errors

### 3. Verify Agent Running
- [ ] SSH to your server
- [ ] Run: `screen -list | grep devyntra-agent`
- [ ] Should show: `devyntra-agent` session
- [ ] Run: `screen -r devyntra-agent` to view logs
- [ ] Should show: "Connected to Devyntra backend"
- [ ] Press `Ctrl+A` then `D` to detach

### 4. Check Database
- [ ] In Supabase SQL Editor, run:
  ```sql
  SELECT agent_id, hostname, status, last_seen FROM agents;
  ```
- [ ] Should see your agent with `status = 'online'`
- [ ] If not, wait 30 seconds and check again

### 5. Restart Desktop App
- [ ] **IMPORTANT**: Completely close the desktop app (quit, don't just close window)
- [ ] Reopen the desktop app
- [ ] Log in
- [ ] Check sidebar - should now show all options
- [ ] Check dashboard - should show server stats

## ✅ Verification

After completing all steps, you should see:

- ✅ Sidebar shows: Dashboard, Monitoring, FileManager, Tasks, Terminal, History, **and more**
- ✅ Dashboard displays real CPU, Memory, Disk, Network stats
- ✅ "CONNECTED: AGENT:..." shown in header
- ✅ Server performance graphs are populated with data
- ✅ All features work normally

## ❌ If Still Not Working

### Check 1: Migration Ran Successfully
```sql
-- Should return rows, not error
SELECT tablename FROM pg_tables WHERE tablename IN ('servers', 'agents');
```

### Check 2: Backend Logs
```bash
cd apps/backend
tail -20 stdout.txt
# Look for: "[agent-ws] Agent ... saved to database"
```

### Check 3: Desktop App Console
- Press `Ctrl+Shift+I` in desktop app
- Look for errors
- Should see: "Loaded X servers/agents"

### Check 4: Authentication
- Log out completely
- Log back in
- Verify same user account that created the agent

## 🆘 Still Having Issues?

1. Check `CHECK_AGENT_STATUS.md` for detailed troubleshooting
2. Check `AGENT_CONNECTION_COMPLETE_FIX.md` for full explanation
3. Verify all files were modified correctly:
   - `apps/backend/src/index.js` - WebSocket handler updated
   - `apps/desktop/test_script.js` - Server reload added
   - Migration file created and run

## Quick Test

Run this in Supabase SQL Editor to manually verify everything:

```sql
-- Check tables exist
SELECT 'servers' as table_name, COUNT(*) as count FROM servers
UNION ALL
SELECT 'agents', COUNT(*) FROM agents;

-- Check your agent
SELECT 
  agent_id,
  name,
  hostname,
  status,
  last_seen,
  created_at
FROM agents
WHERE user_id = auth.uid()
ORDER BY created_at DESC;

-- Check RLS is enabled
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('servers', 'agents');
```

All queries should work without errors.
