# Manual Fix for Render Deployment

## Problem
Render is trying to build the entire monorepo (including desktop app) instead of just the backend, causing the build to fail because of the missing `@devyntra/api-client` package.

## Solution: Update Render Service Settings

### Step 1: Go to Render Dashboard
1. Open: https://dashboard.render.com/
2. Find your service: `devyntra-global-20260203`
3. Click on the service name

### Step 2: Update Build & Deploy Settings
1. Click **Settings** in the left sidebar
2. Scroll to **Build & Deploy** section
3. Update the following:

**Build Command:**
```bash
cd apps/backend && npm install --production
```

**Start Command:**
```bash
cd apps/backend && npm start
```

4. Click **Save Changes**

### Step 3: Trigger Manual Deploy
1. Go to **Manual Deploy** tab
2. Click **Deploy latest commit**
3. Wait for deployment (2-5 minutes)

### Step 4: Monitor Deployment
Watch the logs. You should see:
```
==> Running build command 'cd apps/backend && npm install --production'...
✓ Build succeeded
==> Starting service with 'cd apps/backend && npm start'...
Devyntra backend listening on 4000
```

## Alternative: Use Render Blueprint

If the above doesn't work, you can use the render.yaml blueprint:

### Step 1: Enable Blueprint
1. In Render dashboard, go to your service
2. Click **Settings**
3. Scroll to **Blueprint**
4. Enable **Use render.yaml from repository**
5. Save changes

### Step 2: Redeploy
The render.yaml file in the repo will now control the build process.

## Verification

After successful deployment:

1. **Check health endpoint:**
   ```bash
   curl https://devyntra-global-20260203.onrender.com/health
   ```
   Should return: `{"ok":true}`

2. **Check logs for agent connection:**
   - In Render dashboard, go to **Logs** tab
   - Look for: `[agent-ws] Agent ... saved to database`

3. **Verify agent in database:**
   - Go to: https://supabase.com/dashboard/project/psnrofnlgpqkfprjrbnm/sql/new
   - Run: `SELECT * FROM agents WHERE status = 'online';`

4. **Restart desktop app:**
   - Close completely
   - Reopen and log in
   - Check sidebar shows all options

## If Still Failing

### Option A: Deploy Backend as Separate Service

Create a new Render service specifically for the backend:

1. In Render dashboard, click **New +**
2. Select **Web Service**
3. Connect your GitHub repo
4. Configure:
   - **Name:** `devyntra-backend-only`
   - **Root Directory:** `apps/backend`
   - **Build Command:** `npm install --production`
   - **Start Command:** `npm start`
   - **Environment:** Node
5. Add environment variables:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `PORT=4000`
6. Click **Create Web Service**

### Option B: Use Docker

Create a Dockerfile for the backend:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY apps/backend/package*.json ./
RUN npm install --production
COPY apps/backend/ ./
EXPOSE 4000
CMD ["npm", "start"]
```

Then deploy as a Docker service on Render.

## Quick Test

Once deployed, run this locally:

```bash
node test-migration.js
```

Should show agent in database with status='online'.

## Expected Timeline

- Update settings: 1 minute
- Redeploy: 2-5 minutes
- Agent reconnect: 30 seconds
- Total: ~5-10 minutes

Then restart your desktop app and everything should work!
