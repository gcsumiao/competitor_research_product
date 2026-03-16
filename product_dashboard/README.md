Product market research dashboard (Next.js App Router).

- Main dashboard pages live under `app/(dashboard)` (e.g. `/`, `/sales`, `/customers`, `/reports`, `/specs`, `/orders`).
- `DASHBOARD_DATA_SOURCE=file|postgres` controls whether runtime reads from snapshot files or PostgreSQL.
- Non-code category data is still generated from `data/non_code_categories/**` and `../NewProductCategory/**`, but the dashboard should now read PostgreSQL in normal operation.
- Code Reader & Scanner snapshots are still produced from the monthly pipeline, then ingested into PostgreSQL with artifacts attached.
- The older single-page mock dashboard is still available at `/legacy`.

## Deployment Modes

- `DASHBOARD_DEPLOYMENT_MODE=code_reader_only` keeps the existing code-reader-only deployment behavior.
- `DASHBOARD_DEPLOYMENT_MODE=full` enables all product categories.
- If the env var is omitted, local development defaults to `full` and Vercel defaults to `code_reader_only`.

## PostgreSQL Runtime

Local development is designed for Docker PostgreSQL 18. Production stays compatible with Neon PostgreSQL 17.

Create envs from `.env.example`:

```bash
DATABASE_URL=postgresql://dashboard:dashboard@localhost:55432/competitor_dashboard
DATABASE_URL_UNPOOLED=postgresql://dashboard:dashboard@localhost:55432/competitor_dashboard
DASHBOARD_DATA_SOURCE=postgres
DASHBOARD_DEPLOYMENT_MODE=full
DASHBOARD_REVALIDATE_SECRET=replace-me
```

The Docker default in this repo uses `localhost:55432` to avoid collisions with existing local PostgreSQL services.

Start the local database and apply migrations:

```bash
pnpm db:up
pnpm db:migrate
```

Backfill all existing dashboard data into PostgreSQL:

```bash
pnpm db:backfill
```

For Vercel + Neon:

- `DATABASE_URL` should use Neon pooled runtime connections.
- `DATABASE_URL_UNPOOLED` should use Neon direct connections for migrations and backfills.
- Keep schema and SQL PG17-compatible even if local Docker uses PG18.
- Production and Preview deployment runbook: [`docs/neon-vercel-production.md`](/Users/sumiaoc/competitor_research_product/product_dashboard/docs/neon-vercel-production.md)
- Validate deployment envs before cutover with `pnpm deploy:check-env`.
- Validate file-vs-postgres parity before cutover with `pnpm db:verify:parity`.
- Validate a deployed Preview or Production site with `pnpm deploy:smoke -- --base-url https://<deployment-domain>`.

## Non-Code Data Sync

In the new flow, ingest normalized non-code snapshots into PostgreSQL:

```bash
pnpm db:ingest:non-code
```

Legacy file-copy behavior is still available for rollback only:

```bash
pnpm sync:non-code-files
```

## Code Reader & Scanner Data

- Historical official report+analysis files under `data/code_reader_scanner/YYYYMM/` are still supported for backfill and rollback.
- The normal monthly path is now:
  1. run the Python pipeline
  2. emit `dashboard_snapshot_rows.json`
  3. ingest structured rows + artifacts into PostgreSQL
  4. trigger dashboard tag revalidation

Monthly ingest command:

```bash
pnpm db:ingest:code-reader -- --month YYYYMM
```

If you explicitly need the old file archive as a rollback artifact:

```bash
pnpm db:ingest:code-reader -- --month YYYYMM --write-file-archive
```

One-time historical backfill command:

```bash
pnpm db:backfill
```

## Getting Started

First, run the development server:

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
