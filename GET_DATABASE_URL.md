# How to Get Your Supabase Database URL

To run the migration, you need to add your database connection string to the `.env` file.

## Steps to Get Database URL from Supabase:

1. Go to your Supabase project dashboard: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm

2. Click on **Settings** (gear icon in the left sidebar)

3. Click on **Database** in the settings menu

4. Scroll down to **Connection string** section

5. Select the **URI** tab

6. Copy the connection string (it will look like):
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.psnrofnlgpqkfprjrbnm.supabase.co:5432/postgres
   ```

7. Add it to your `apps/backend/.env` file:
   ```env
   DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.psnrofnlgpqkfprjrbnm.supabase.co:5432/postgres
   SUPABASE_URL=https://psnrofnlgpqkfprjrbnm.supabase.co
   SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   PORT=4000
   ```

## Alternative: Run Migration Directly in Supabase

If you prefer, you can run the migration directly in the Supabase SQL Editor:

1. Go to your Supabase project dashboard
2. Click on **SQL Editor** in the left sidebar
3. Click **New query**
4. Copy the contents of `apps/backend/src/migrations/007_servers_and_agents.sql`
5. Paste it into the SQL editor
6. Click **Run** or press `Ctrl+Enter`

This will create the tables without needing the DATABASE_URL in your .env file.

## After Adding DATABASE_URL

Once you've added the DATABASE_URL to your .env file, run:

```bash
cd apps/backend
node src/infra/migrate.js src/migrations/007_servers_and_agents.sql
```

Then restart your backend server and reconnect your agent.
