# Quick Fix for Agent Connection Issue

## Problem
Agent connects but desktop app shows limited sidebar options (only Dashboard, Monitoring, FileManager, Tasks, Terminal, History).

## Root Cause
Missing `servers` and `agents` tables in your Supabase database.

## Fastest Solution (2 minutes)

### Option 1: Run SQL Directly in Supabase (Easiest)

1. Open: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new

2. Copy and paste this SQL:

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

3. Click **Run** (or press Ctrl+Enter)

4. Restart your backend server:
```bash
cd apps/backend
npm run dev
# or if using pm2: pm2 restart devyntra-backend
```

5. Wait 30 seconds for agent to reconnect (it auto-reconnects)

6. Refresh your desktop app

✅ Done! Your agent should now appear in the sidebar with all options visible.

---

### Option 2: Using Migration Script

If you prefer using the migration script:

1. Add DATABASE_URL to `apps/backend/.env`:
   - Get it from: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/settings/database
   - Add line: `DATABASE_URL=postgresql://postgres:[PASSWORD]@db.psnrofnlgpqkfprjrbnm.supabase.co:5432/postgres`

2. Run migration:
```bash
cd apps/backend
node src/infra/migrate.js src/migrations/007_servers_and_agents.sql
```

3. Restart backend and refresh desktop app

---

## Verify It Worked

Check in Supabase SQL Editor:
```sql
SELECT agent_id, hostname, status, last_seen FROM agents;
```

You should see your connected agent listed as 'online'.
