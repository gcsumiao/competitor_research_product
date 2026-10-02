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
