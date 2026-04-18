# Phase 1 Migrations

## Apply

- `apps/backend/src/migrations/001_pipelines.sql`

Example:

```bash
cd apps/backend
node ./src/infra/migrate.js ./src/migrations/001_pipelines.sql
```

## Notes

- Requires `DATABASE_URL` env var pointing to Supabase Postgres (or any Postgres).
- Uses `pgcrypto` for UUID generation.
