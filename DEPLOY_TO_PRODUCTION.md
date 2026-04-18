# Deploy Fix to Production

## Your Setup

- **Backend**: https://devyntra-global-20260203.onrender.com (Render)
- **Database**: Supabase (psnrofnlgpqkfprjrbnm)
- **Agent**: Connecting to production backend
- **Status**: Code pushed to GitHub ✅, but not deployed yet ❌

## Step 1: Run Migration on Production Database

1. Go to Supabase SQL Editor:
   https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new

2. Copy the ENTIRE contents of:
   `apps/backend/src/migrations/007_servers_and_agents.sql`

3. Paste into SQL Editor and click **RUN**

4. Verify it worked:
   ```sql
   SELECT tablename FROM pg_tables WHERE tablename IN ('servers', 'agents');
   ```
   Should return both tables.

## Step 2: Deploy Backend to Render

### Option A: Auto-Deploy (if configured)

If your Render service is connected to GitHub with auto-deploy:

1. Go to: https://dashboard.render.com/
2. Find your `devyntra-global-20260203` service
3. Check if it's deploying automatically
4. Wait for deployment to complete (usually 2-5 minutes)
5. Check logs for "Devyntra backend listening on..."

### Option B: Manual Deploy

If auto-deploy is not configured:

1. Go to Render dashboard
2. Select your service
3. Click **Manual Deploy** → **Deploy latest commit**
4. Wait for deployment to complete

### Option C: Deploy via Git

```bash
# If you have Render CLI
render deploy

# Or trigger via webhook (if configured)
curl -X POST https://api.render.com/deploy/YOUR_DEPLOY_HOOK
```

## Step 3: Verify Deployment

Check if the updated backend is running:

```bash
curl https://devyntra-global-20260203.onrender.com/health
```

Should return: `{"ok":true}`

## Step 4: Check Backend Logs

In Render dashboard:

1. Go to your service
2. Click **Logs** tab
3. Look for agent connection messages:
   ```
   [agent-ws] Agent ... saved to database
   [agent-ws] Agent ... metadata updated
   ```

## Step 5: Verify Agent in Database

Run this in Supabase SQL Editor:

```sql
SELECT 
  agent_id,
  hostname,
  status,
  last_seen,
  created_at
FROM agents
WHERE status = 'online'
ORDER BY created_at DESC;
```

You should see your agent listed.

## Step 6: Restart Desktop App

**CRITICAL**: You MUST completely restart the desktop app:

1. Close ALL windows
2. Right-click app in taskbar → **Quit** or **Exit**
3. Reopen app from Start menu
4. Log in
5. Check sidebar - should now show all options
6. Check dashboard - should show real server stats

## Troubleshooting

### Deployment not starting?

Check Render dashboard:
- Is auto-deploy enabled?
- Are there any deployment errors?
- Is the service paused?

### Agent still not in database?

1. Check agent is running on your server:
   ```bash
   screen -list | grep devyntra-agent
   screen -r devyntra-agent
   ```

2. Check agent logs show connection:
   ```
   Connected to Devyntra backend
   ```

3. Restart agent if needed:
   ```bash
   screen -X -S devyntra-agent quit
   # Run installation command again
   ```

### Desktop app still shows limited options?

1. Verify you restarted app COMPLETELY (not just refreshed)
2. Check browser console (Ctrl+Shift+I) for errors
3. Verify you're logged in with same account that created agent
4. Try logging out and back in

### Backend logs show errors?

Common issues:
- `DATABASE_NOT_CONFIGURED`: Add DATABASE_URL to Render environment variables
- `relation agents does not exist`: Migration not run on production database
- `auth.uid() is null`: RLS policies issue, check migration ran correctly

## Quick Verification Script

After deployment, run this locally to test:

```bash
node test-migration.js
```

Should show:
- ✅ Tables exist
- ✅ Agent found in database with status='online'

## Expected Timeline

1. Run migration: **30 seconds**
2. Deploy to Render: **2-5 minutes**
3. Agent reconnects: **5-30 seconds** (automatic)
4. Restart desktop app: **10 seconds**
5. **Total: ~5-10 minutes**

## Final Checklist

- [ ] Migration run on production Supabase
- [ ] Backend deployed to Render
- [ ] Deployment completed successfully
- [ ] Backend logs show no errors
- [ ] Agent appears in database with status='online'
- [ ] Desktop app restarted COMPLETELY
- [ ] Sidebar shows all menu items
- [ ] Dashboard displays real server stats
- [ ] All features working normally

## If Everything is Done But Still Not Working

1. **Clear desktop app cache**:
   - Close app
   - Delete: `%APPDATA%/devyntra-desktop/`
   - Reopen app

2. **Check Render environment variables**:
   - Ensure `SUPABASE_URL` is set
   - Ensure `SUPABASE_ANON_KEY` is set
   - Add `DATABASE_URL` if using direct database queries

3. **Check Supabase RLS policies**:
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables 
   WHERE tablename IN ('servers', 'agents');
   ```
   Both should show `rowsecurity = true`

4. **Manually test agent connection**:
   ```sql
   -- Insert test agent
   INSERT INTO agents (agent_id, user_id, name, status)
   VALUES ('test-123', auth.uid(), 'Test Agent', 'online');
   
   -- Check if it appears
   SELECT * FROM agents WHERE agent_id = 'test-123';
   ```

The fix is ready and pushed to GitHub. You just need to deploy it to production!
