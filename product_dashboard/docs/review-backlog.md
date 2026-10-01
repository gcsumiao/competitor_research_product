# Review backlog

Non-blocking findings ([P2]/[NIT]) from end-of-task reviews, handled in polish slices. One line each: source, finding, decision.

- 2026-10-01 · Codex review of `chore/neon-preview-readonly` · [P2] `scripts/check-deployment-env.mts` no-target (production) path now errors when `DASHBOARD_DB_READ_ONLY` is truthy with `VERCEL_ENV=production` and prints three extra info lines (roles, flag). **Decision: keep** — a read-only flag leaking into Production would silently disable Consult Me writes; the guard is intentional and the lines are informational.
- 2026-09-24 · Codex review of `fix/overview-category-switch` · [P2] non-code categories' price-tier pies share one colour in `dashboard-client.tsx`. Open.
