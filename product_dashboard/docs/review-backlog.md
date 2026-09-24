# Review backlog

Non-blocking findings ([P2]/[NIT]) from end-of-task reviews, to be handled in a
later polish slice. One line per item: date · source · file · finding · fix idea.

- 2026-09-24 · Codex review of `fix/overview-category-switch` · `components/dashboard/dashboard-client.tsx` (PRICE_TIER_COLORS lookup) · every non-code price tier falls back to `PRICE_TIER_FALLBACK_COLOR`, so the Dashboard tier pie slices and legend are indistinguishable for non-code categories · assign distinct colors for non-code tier keys (reuse the Types page's category-keyed palette from PR #15).
