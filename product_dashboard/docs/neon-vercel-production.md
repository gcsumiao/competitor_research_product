# Neon + Vercel Production Deployment

This dashboard is designed to run on:

- local development: Docker PostgreSQL 18
- Preview and Production deployments: Neon PostgreSQL 17 via Vercel

## 1. Neon and Vercel setup

1. Create or select a Neon project on PostgreSQL 17.
2. Create one long-lived production branch in Neon.
3. Connect the Neon project to the `product_dashboard` Vercel project using the Neon-managed Vercel integration.
4. Enable automatic Preview branch creation and cleanup in the Neon integration settings.

## 2. Vercel environment contract

Use the values in [`.env.vercel.example`](/Users/sumiaoc/competitor_research_product/product_dashboard/.env.vercel.example) as the contract.

Required runtime envs:

- `DATABASE_URL`
- `DATABASE_URL_UNPOOLED`
- `DASHBOARD_DATA_SOURCE=postgres`
- `DASHBOARD_DEPLOYMENT_MODE=full`
- `DASHBOARD_REVALIDATE_SECRET`
- `DASHBOARD_REVALIDATE_URL`

Rules:

- `DATABASE_URL` must be the Neon pooled runtime URL.
- `DATABASE_URL_UNPOOLED` must be the Neon direct URL for migrations and ingest.
- `DASHBOARD_REVALIDATE_URL` must be the exact deployed URL for the environment you are targeting.
- Keep `file` mode in code for rollback only during the first production release.

Validate envs before cutover:

```bash
pnpm deploy:check-env
```

## 3. Release commands

Run these from the repo root or `product_dashboard`:

Preview / production DB initialization:

```bash
pnpm db:migrate
pnpm db:backfill
```

Incremental monthly updates:

```bash
pnpm db:ingest:non-code
pnpm db:ingest:code-reader -- --month YYYYMM
```

Before production cutover, verify local file data and Postgres data match:

```bash
pnpm db:verify:parity
```

After Preview or Production deploy, run smoke checks against the deployed app:

```bash
pnpm deploy:smoke -- --base-url https://<deployment-domain>
```

If you want the smoke run to also verify revalidation:

```bash
DASHBOARD_REVALIDATE_SECRET=<secret> pnpm deploy:smoke -- --base-url https://<deployment-domain>
```

## 4. Production cutover

1. Set Production envs to `postgres` + `full`.
2. Run `pnpm db:migrate` against the Neon production branch.
3. Run `pnpm db:backfill` or the required delta ingest commands.
4. Deploy Production.
5. Run `pnpm deploy:smoke -- --base-url https://<production-domain>`.

## 5. Rollback

If production runtime has an issue:

1. Set `DASHBOARD_DATA_SOURCE=file` in Production.
2. Redeploy.
3. Do not delete or roll back Neon data.

After one stable production release, remove `file` mode as a follow-up cleanup task.
