# Devyntra Phase 1 (Core Orchestrator)

## What’s included

- Backend orchestrator + worker (single-process) with DB authoritative state
- Pipeline CRUD + Run APIs under `/api/*`
- DAG validation + layered topological execution
- Stage types: `script/docker`, `ssh`, `agent`, `approval`
- Log streaming: Redis pub/sub -> backend WS `/ws` -> UI
- Log archiving: `./archives/{runId}/{stageRunId}.log.gz` served from `/archives/*`

## Backend

### Env

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `DATABASE_URL` (Postgres)
- `REDIS_URL` (required for live log WS)

### Install

```bash
npm --workspace apps/backend install
```

### Migrate

```bash
npm --workspace apps/backend run migrate:phase1
```

### Run

```bash
npm --workspace apps/backend run dev
```

## Desktop (Pipeline UI bundle)

### Install

```bash
npm --workspace apps/desktop install
```

### Build bundle

```bash
npm --workspace apps/desktop run pipeline:build
```

Produces:

- `apps/desktop/dist/pipeline.js`

## API quick check

- `POST /api/pipelines`
- `GET /api/pipelines/:id`
- `POST /api/pipelines/:id/runs`
- `GET /api/runs/:runId`
- `POST /api/runs/:runId/approve`
- `GET /api/runs/:runId/stage_runs/:stageRunId/logs`

## WebSocket

- `ws://localhost:4000/ws?token=<jwt>&runId=<uuid>&stageRunId=<uuid>`

## Tests

### Backend tests

```bash
npm --workspace apps/backend run test
```

Integration test requires `DATABASE_URL` and migrations applied.

## Local verification checklist

- Create a pipeline with a cycle -> expect HTTP 400 and `cycle` list.
- Start a run -> API returns `202` quickly.
- Watch run status -> stages update to `running/success/failed`.
- Approval stage -> run stops at `awaiting_approval`; approve endpoint resumes.
- Backend restart -> stale `running` stage_runs older than heartbeat cutoff are marked failed by recon.
- Logs -> appear in UI quickly; archived logs available under `/archives/*`.
