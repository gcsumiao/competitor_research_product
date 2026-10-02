# Review backlog

[P2] / [NIT] findings from end-of-task reviews, grouped by task. Handled in one polish slice later.

## CA market reports 202609 (ca_market_reports/)

_(empty — filled by the end-of-task Codex review)_

### Known residuals noted during integration (before the end-of-task review)
- [P2] Gauge classifier: a gas+diesel fuel-scope conflict is logged (`gauge_fuel_conflict asin=…`) but produces no review-queue row; the validator/runbook should surface it from the log or a decisions column. None occurred in 202609.
- [P2] Gauge map ports kept verbatim from the US map but questionable: B07DQ44JFB "Haul Gauge" (app weigh scale) as gauge_display borderline=Y; B0C7YYH37M MR CARTOOL inclinometer HUD excluded by map although rules say obd_hud.
- [NIT] Two ASINs stay `ambiguous` (undecidable from title): B0784PC19Q "Auto Meter 5323 OBD-II Accessory" (CA $0), B08NWFYLRQ "Banks Power 64331" (US). They sit on the Excluded tab with rule id AMB.
- [NIT] `classify_gauges` gained a keyword-only `month=` parameter (needed for "latest decided_month <= report month"); builders must pass it.
- [P2] Type assignment: LAUNCH Creader Elite family (B08QGPX465, B0HD73991F) is typed Tablet by brand token profile at 0.50–0.56 (handheld-class product); both sit in `type_review_CA_code_reader_202609.csv` for Ginny's review. GODIAG GT100/GT100+ breakout boxes score 0.769 → Other and left the queue (correct type, no action).
- [NIT] 107 default_other rows remain (CA$15.9K, 0.4% of CA revenue): tuners (Z Automotive Tazer), TPMS tools, manuals, fuel-saver chips. Review CSV covers them.
- [P2] `ca_xlsx_style.write_manifest`: no test asserts that writing a manifest never modifies any input file (an orchestrator patch briefly shadowed the manifest `path` variable and wrote JSON over an input CSV; caught by the validator/tests, raw exports verified intact). Add a test that snapshots input hashes before/after `write_manifest`.
- [NIT] Manifest inputs: stale previous entries are dropped only when their file changed and this run did not declare them; a renamed input leaves a harmless orphan entry.

### Codex end-of-task review 2026-10-02 (gpt-6-sol @ xhigh, FIX-FIRST → P1s fixed in one round; full text: ca_market_reports/runs/202609/codex_review_202609.md)
- [P2] validate_outputs.py V09: the Model B "# app-gauge-capable" expected values come from the builder's `modelb_universe`; a wrong brand-map join would reproduce the same wrong number. Derive per-ASIN app capability in the validator from the typed CR rows + maps/ca_app_gauge_brands.csv independently.
- [P2] render_preview.py: `--out` may write under NewProductCategory/ (path boundary); add the same NEW_PRODUCT_DIR guard the validator's `--json` now has.
- (fixed in the round) V04 compares every Top-50 row; manifests + V19 use the loader's recursive raw file list; bare Edge model numbers in the fuel rule; untagged memo count; stale RUNBOOK status; `--json` path guard.
