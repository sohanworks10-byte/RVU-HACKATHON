-- Phase: Servers and Agents tables for storing server connections

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

-- Enable Row Level Security
ALTER TABLE servers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist (to allow re-running migration)
DROP POLICY IF EXISTS "Users can view their own servers" ON servers;
DROP POLICY IF EXISTS "Users can insert their own servers" ON servers;
DROP POLICY IF EXISTS "Users can update their own servers" ON servers;
DROP POLICY IF EXISTS "Users can delete their own servers" ON servers;

DROP POLICY IF EXISTS "Users can view their own agents" ON agents;
DROP POLICY IF EXISTS "Users can insert their own agents" ON agents;
DROP POLICY IF EXISTS "Users can update their own agents" ON agents;
DROP POLICY IF EXISTS "Users can delete their own agents" ON agents;

-- RLS Policies for servers table
CREATE POLICY "Users can view their own servers"
  ON servers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own servers"
  ON servers FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own servers"
  ON servers FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own servers"
  ON servers FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for agents table
CREATE POLICY "Users can view their own agents"
  ON agents FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own agents"
  ON agents FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own agents"
  ON agents FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own agents"
  ON agents FOR DELETE
  USING (auth.uid() = user_id);
