-- Add mode column to servers table to persist connection type (agent/user/ssh)
-- Run this in your Supabase SQL Editor

-- Step 1: Add the mode column if it doesn't exist
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS mode TEXT DEFAULT 'ssh';

-- Step 2: Add constraint to ensure only valid values
ALTER TABLE servers 
DROP CONSTRAINT IF EXISTS servers_mode_check;

ALTER TABLE servers 
ADD CONSTRAINT servers_mode_check 
CHECK (mode IN ('ssh', 'agent', 'user'));

-- Step 3: Update existing records - set agent mode for agent connections
UPDATE servers 
SET mode = 'agent' 
WHERE host LIKE 'agent:%' AND (mode IS NULL OR mode = 'ssh');

-- Step 4: Ensure all other records default to ssh
UPDATE servers 
SET mode = 'ssh' 
WHERE mode IS NULL;

-- Verify the changes
SELECT id, name, host, mode FROM servers ORDER BY created_at DESC;
