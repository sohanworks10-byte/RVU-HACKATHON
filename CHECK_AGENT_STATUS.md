# Check Agent Status and Troubleshoot

## Step 1: Verify Migration Was Run

Check if the `agents` table exists in your Supabase database:

1. Go to: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/editor
2. Run this query:

```sql
SELECT * FROM agents;
```

If you get an error "relation agents does not exist", the migration hasn't been run yet.

## Step 2: Run the Migration

### Option A: Via Supabase SQL Editor (Easiest)

1. Go to: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new
2. Copy the entire contents of `apps/backend/src/migrations/007_servers_and_agents.sql`
3. Paste and click **Run**

### Option B: Via Command Line

1. Add `DATABASE_URL` to `apps/backend/.env`:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.psnrofnlgpqkfprjrbnm.supabase.co:5432/postgres
   ```
2. Run:
   ```bash
   cd apps/backend
   node src/infra/migrate.js src/migrations/007_servers_and_agents.sql
   ```

## Step 3: Restart Backend

After running the migration, restart your backend server:

```bash
cd apps/backend
# Kill existing process
pkill -f "node.*index.js"

# Start again
npm run dev
# or
node src/index.js
```

## Step 4: Check Agent Connection

On your server where the agent is running:

```bash
# Check if agent is running
screen -list | grep devyntra-agent

# View agent logs
screen -r devyntra-agent
# (Press Ctrl+A then D to detach without stopping)
```

You should see logs like:
```
Connected to Devyntra backend
```

## Step 5: Verify Agent in Database

After the agent connects, check if it's saved in the database:

```sql
SELECT agent_id, hostname, status, last_seen, created_at 
FROM agents 
ORDER BY created_at DESC;
```

You should see your agent listed with `status = 'online'`.

## Step 6: Refresh Desktop App

1. Close and reopen your desktop app completely
2. Or press `Ctrl+R` to reload
3. Log in again if needed
4. Check the sidebar - you should now see all options

## Common Issues

### Issue: Agent shows in database but not in desktop app

**Solution**: The desktop app caches the server list. Try:
1. Log out and log back in
2. Or completely restart the desktop app
3. Check browser console (Ctrl+Shift+I) for errors

### Issue: Agent connects but immediately disconnects

**Solution**: Check backend logs for errors:
```bash
cd apps/backend
tail -f stdout.txt
# or
pm2 logs devyntra-backend
```

### Issue: "Agent is offline" error when trying to connect

**Solution**: 
1. Verify agent is running on your server
2. Check if backend can reach the agent (WebSocket connection)
3. Restart both agent and backend

## Debug Commands

### Check agent WebSocket connection:
```bash
# On your server
netstat -an | grep :4000
```

### Check backend logs:
```bash
cd apps/backend
cat stdout.txt | grep agent-ws
```

### Check if agent table has RLS enabled:
```sql
SELECT tablename, rowsecurity 
FROM pg_tables 
WHERE tablename IN ('servers', 'agents');
```

Both should show `rowsecurity = true`.

### Manually insert test agent:
```sql
INSERT INTO agents (agent_id, user_id, name, status)
VALUES ('test-agent-123', auth.uid(), 'Test Agent', 'online');
```

Then refresh your desktop app to see if it appears.
