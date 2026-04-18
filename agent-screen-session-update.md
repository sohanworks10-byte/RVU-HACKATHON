# Agent Screen Session Update

## Changes Made

### 1. Agent Installation Simplified
The agent now handles screen session setup internally with the `--install` flag, making the command much shorter and cleaner for users.

### 2. Agent Code Updates (`agent-repo/agent.js`)

Added installation mode that:
- Checks if screen is installed, installs it if needed
- Creates a detached screen session named "devyntra-agent"
- Runs the agent in the background
- Provides clear feedback to users
- Prevents duplicate sessions

**Key Features:**
- `--install` flag triggers installation mode
- Automatic screen installation via apt-get
- Session detection to prevent duplicates
- Clean exit after setup with helpful messages

### 3. Desktop App Updates (`apps/desktop/index.html`)

**generateAgentInstall() function:**
- Simplified command generation
- Now just appends `--install` flag to the base command
- Agent handles all screen session complexity internally

**Before:**
```bash
sudo apt-get update && sudo apt-get install -y screen && screen -dmS devyntra-agent bash -c 'curl ... | bash' && echo "Agent started..."
```

**After:**
```bash
curl -fsSL https://raw.githubusercontent.com/sohan20051519/devyntra-agent/main/install.sh | bash -s -- --token TOKEN --backend URL --install
```

### 4. Mode Persistence Fix (`apps/desktop/index.html`)

**loadServersFromSupabase() function:**
- Added `mode` field to the server mapping
- Mode now properly loads from database: `mode: s.mode || (s.agent_version ? 'agent' : 'ssh')`
- Falls back to 'agent' if agent_version exists, otherwise 'ssh'

### 5. Database Migration (`mode-column-migration.sql`)

SQL commands to add and configure the `mode` column:
- Adds `mode` column with default 'ssh'
- Adds constraint to ensure only valid values (ssh, agent, user)
- Updates existing agent connections to have mode='agent'
- Ensures all records have a valid mode

## User Benefits

1. **Shorter Commands**: Users see a clean, simple command instead of complex bash scripts
2. **Better UX**: Agent handles all complexity internally
3. **Persistent Mode**: Connection type (agent/user/ssh) now persists across app restarts
4. **Automatic Screen Setup**: No manual screen session management needed
5. **Session Safety**: Prevents duplicate agent sessions

## Testing Steps

1. Run the SQL migration in Supabase
2. Generate a new agent install command
3. Run the command on a server - it should be much shorter
4. Verify agent starts in screen session
5. Close and reopen the desktop app
6. Verify connection type icons display correctly (green plug for agent, blue lock for user, gray terminal for ssh)

## Files Modified

- `agent-repo/agent.js` - Added --install mode handling
- `apps/desktop/index.html` - Simplified command generation, fixed mode persistence
- `mode-column-migration.sql` - Database migration for mode column
