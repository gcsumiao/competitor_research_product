# Neon + Vercel Production Deployment

This dashboard is designed to run on:

- local development: Docker PostgreSQL 18
- Production deployments: Neon PostgreSQL 17 via Vercel (the long-lived `production` branch)
- Preview deployments: read the production branch via the read-only role `dashboard_preview_ro` (no Neon branch per preview)

## 1. Neon and Vercel setup

1. Create or select a Neon project on PostgreSQL 17.
2. Create one long-lived production branch in Neon.
3. Do not connect the Neon Vercel Previews integration. It was disconnected on 2026-10-01 because every Preview deployment created a billable Neon branch.
4. Manage the database envs manually in Vercel:
   - Production scope: `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for the `production` branch.
   - Preview scope: plain (non-branch) `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for role `dashboard_preview_ro` on the production endpoint, plus `DASHBOARD_DB_READ_ONLY=1`.

   Create the read-only role once on the production branch (Neon SQL editor, as `neondb_owner`; use a generated password, e.g. `openssl rand -base64 24`):

   ```sql
   CREATE ROLE dashboard_preview_ro LOGIN PASSWORD '<generated-password>';
   GRANT CONNECT ON DATABASE neondb TO dashboard_preview_ro;
   GRANT USAGE ON SCHEMA public TO dashboard_preview_ro;
   GRANT SELECT ON ALL TABLES IN SCHEMA public TO dashboard_preview_ro;
   ALTER DEFAULT PRIVILEGES FOR ROLE neondb_owner IN SCHEMA public GRANT SELECT ON TABLES TO dashboard_preview_ro;
   ```

   Default privileges are per grantor: the last statement only covers tables that `neondb_owner` creates later. If a migration ever runs as another role, re-run the `GRANT SELECT ON ALL TABLES` statement (and add a matching `ALTER DEFAULT PRIVILEGES FOR ROLE <that role>`).

## 2. Vercel environment contract

Use the values in [`.env.vercel.example`](/Users/sumiaoc/competitor_research_product/product_dashboard/.env.vercel.example) as the contract.

There are two contracts, one per Vercel scope. Each list below matches what `scripts/check-deployment-env.mts` checks in that mode; the notes say where an item is guidance the check does not enforce.

### Production (`pnpm deploy:check-env`)

- `DATABASE_URL`: Neon pooled runtime URL for the `production` branch, role `neondb_owner`
- `DATABASE_URL_UNPOOLED`: Neon direct URL for migrations and ingest, role `neondb_owner`
- `DASHBOARD_DATA_SOURCE=postgres`
- `DASHBOARD_DEPLOYMENT_MODE=full`
- `DASHBOARD_REVALIDATE_SECRET`
- `DASHBOARD_REVALIDATE_URL`: must be https; use the exact deployed Production URL (not enforced; the check warns when its host differs from `VERCEL_URL`)
- `DASHBOARD_DB_READ_ONLY` unset or false (the check fails if it is truthy while `VERCEL_ENV=production`)

The check prints the role of both URLs but does not enforce `neondb_owner`; confirm it in the output.

### Preview (`pnpm deploy:check-env -- --target preview`)

- `DATABASE_URL` / `DATABASE_URL_UNPOOLED`: pooled and direct URLs of the production endpoint, both with role exactly `dashboard_preview_ro` (any other role fails, including `neondb_owner`)
- `DASHBOARD_DB_READ_ONLY=1` (`1`, `true`, `yes` or `on`)
- `DASHBOARD_DATA_SOURCE=postgres`
- `DASHBOARD_REVALIDATE_SECRET`
- `DASHBOARD_DEPLOYMENT_MODE`: must be present; its value is not enforced
- `DASHBOARD_REVALIDATE_URL`: optional (ingest only revalidates Production); if set, it must be https

Consult Me history is read-only in Preview (deletes return 409).

### Rules for both

- `DATABASE_URL` and `DATABASE_URL_UNPOOLED` must use `postgres://` or `postgresql://` and must not be identical (pooled runtime URL vs direct URL).
- With `CF_ACCESS_ENABLED=true`, `CF_ACCESS_TEAM_DOMAIN` (an `https://*.cloudflareaccess.com` URL), `CF_ACCESS_AUDIENCES`, `CF_ACCESS_USERS_GROUP_ID`, `CF_ACCESS_ADMIN_GROUP_ID` and `CF_ACCESS_AUTOMATION_CLIENT_ID` are required; otherwise the check only warns that the origin accepts direct traffic.
- Keep `file` mode in code for rollback only during the first production release.

Validate envs before cutover:

```bash
pnpm deploy:check-env
```

Validate Preview-scope envs (export the Preview values in your shell; they take precedence over `.env.local`):

```bash
pnpm deploy:check-env -- --target preview
```

## 3. Release commands

Run these from the repo root or `product_dashboard`:

Production DB initialization (Preview has no database of its own):

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

## 6. Branch budget

- The Neon Launch plan includes 10 branches per project; extra branches cost $1.50/branch-month.
- Steady state is 1 branch (`production`). Preview deployments do not create branches.
- Run the audit in the monthly checks (needs `NEON_API_KEY` in `product_dashboard/.env.local`; `NEON_PROJECT_ID` defaults to `bold-haze-58127872`, `NEON_BRANCH_MAX` to 2):

  ```bash
  pnpm neon:branch-audit
  ```

  It exits 1 when the branch count exceeds the budget or any `preview/*` or `vercel-dev` branch exists.
- Clean up with a dry run first, then delete: `pnpm neon:branch-audit -- --prune` lists the `preview/*` candidates (add `--delete <name>` for exact names such as `vercel-dev`), and `pnpm neon:branch-audit -- --prune --yes` deletes them. Default, primary and protected branches are never deleted.
- Validate Preview envs with `pnpm deploy:check-env -- --target preview`.
