-- Add created_at column to servers table for proper ordering
-- Run this in your Supabase SQL Editor

-- Step 1: Add created_at column with default value
ALTER TABLE servers 
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Step 2: For existing records without created_at, set them based on updated_at
-- If no updated_at, they'll keep the default NOW() from when column was added
UPDATE servers 
SET created_at = updated_at
WHERE created_at IS NULL AND updated_at IS NOT NULL;

-- Step 3: Create index for faster ordering
CREATE INDEX IF NOT EXISTS idx_servers_created_at ON servers(created_at DESC);

-- Step 4: Verify the changes - check if all have same timestamp
SELECT id, name, host, created_at, updated_at
FROM servers 
ORDER BY created_at DESC;

-- Step 5: If all have same created_at, manually set different timestamps
-- Run this ONLY if all servers have the same created_at timestamp
-- This will space them out by 1 minute each based on their name order
WITH numbered_servers AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY name) as rn
  FROM servers
)
UPDATE servers s
SET created_at = NOW() - (ns.rn || ' minutes')::INTERVAL
FROM numbered_servers ns
WHERE s.id = ns.id;
