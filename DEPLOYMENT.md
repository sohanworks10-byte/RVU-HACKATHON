# Phase-2 Deployment Commands

## Railway Deployment

### 1. Login to Railway
```powershell
railway login
```

### 2. Link to your project
```powershell
cd apps/backend
railway link
# Select your project: devyntra-backend-api
```

### 3. Set all required environment variables
```powershell
# Feature flag
railway variables set FEATURE_PHASE2=true

# Database (from Supabase)
railway variables set DATABASE_URL="postgresql://postgres:[password]@db.bpjltoaqfpybslxlxcql.supabase.co:5432/postgres"

# Redis (from Railway or Upstash)
railway variables set REDIS_URL="redis://[user]:[pass]@[host]:[port]"

# Supabase
railway variables set SUPABASE_URL="https://bpjltoaqfpybslxlxcql.supabase.co"
railway variables set SUPABASE_ANON_KEY="[your-anon-key]"

# MinIO/S3 (for artifacts)
railway variables set MINIO_ENDPOINT="https://[your-minio].railway.app"
railway variables set MINIO_ACCESS_KEY="[access-key]"
railway variables set MINIO_SECRET_KEY="[secret-key]"
railway variables set ARTIFACTS_BUCKET="devyntra-artifacts"

# Vault (optional, for secrets)
railway variables set VAULT_ADDR="https://[your-vault].railway.app"
railway variables set VAULT_TOKEN="[dev-token]"

# Terraform settings
railway variables set TERRAFORM_WORKSPACE_BASE="/tmp/terraform"
railway variables set TERRAFORM_IMAGE="hashicorp/terraform:1.5.0"
```

### 4. Deploy
```powershell
railway up
```

### 5. Verify deployment
```powershell
railway status
curl https://devyntra-backend-api-production.up.railway.app/health
```

## Supabase Configuration

### Link project
```powershell
supabase link --project-ref bpjltoaqfpybslxlxcql
```

### Apply migrations
```powershell
cd apps/backend
npm run migrate:phase2
```

### Set secrets (optional - if using Supabase Vault)
```powershell
supabase secrets set VAULT_TOKEN="your-token"
```

## Environment Variables Reference

### Required for Phase-1
- `DATABASE_URL` - Postgres connection string
- `REDIS_URL` - Redis connection string
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anon key

### Required for Phase-2
- `FEATURE_PHASE2=true` - Enable Phase-2 features
- `MINIO_ENDPOINT` - MinIO/S3 endpoint for artifacts
- `MINIO_ACCESS_KEY` - S3 access key
- `MINIO_SECRET_KEY` - S3 secret key
- `ARTIFACTS_BUCKET` - S3 bucket name for artifacts

### Optional for Phase-2
- `VAULT_ADDR` - HashiCorp Vault address
- `VAULT_TOKEN` - Vault dev token
- `TERRAFORM_WORKSPACE_BASE` - Base path for Terraform workspaces
- `TERRAFORM_IMAGE` - Docker image for Terraform
