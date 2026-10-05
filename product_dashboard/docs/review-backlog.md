# Review backlog

Non-blocking findings ([P2]/[NIT]) from end-of-task reviews, handled in polish slices. One line each: source, finding, decision.

- 2026-10-01 · Codex review of `chore/neon-preview-readonly` · [P2] `scripts/check-deployment-env.mts` no-target (production) path now errors when `DASHBOARD_DB_READ_ONLY` is truthy with `VERCEL_ENV=production` and prints three extra info lines (roles, flag). **Decision: keep** — a read-only flag leaking into Production would silently disable Consult Me writes; the guard is intentional and the lines are informational.
- 2026-09-24 · Codex review of `fix/overview-category-switch` · [P2] non-code categories' price-tier pies share one colour in `dashboard-client.tsx`. Open.
- 2026-10-05 · Codex review of 5832423 (all-brands Ave Rating zero-exclusion) · [P2] archive `data/code_reader_scanner/202609/report.xlsx` changes more than the 31 Summary rating cells (brand-tab A1 in-cell logo placeholders, Generic tab position, image storage). **Decision: keep** — the previous archive was the analyst's hand-finished copy; she waived that hand-finish and the archive is now the pristine generator output, which is the documented convention.
- 2026-10-05 · Codex review of 5832423 · [P2] runbook pitfall 11 said months before 202609 keep the zero-inclusive mean, which is false for Innova in 202607-202608. **Fixed** in the follow-up docs commit.
