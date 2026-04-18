#!/bin/bash

# Script to run the servers and agents migration

echo "Running migration: 007_servers_and_agents.sql"
node src/infra/migrate.js src/migrations/007_servers_and_agents.sql

if [ $? -eq 0 ]; then
    echo "✓ Migration completed successfully!"
    echo ""
    echo "Next steps:"
    echo "1. Restart your backend server"
    echo "2. Reconnect your agent (it should auto-reconnect)"
    echo "3. Refresh your desktop app"
else
    echo "✗ Migration failed. Please check the error above."
    exit 1
fi
