# Automated Monthly Competitor Report Runbook

> Repo hygiene: everything unrelated to this monthly flow was archived on
> 2026-07-07 into `archive/2026-07-07_cleanup/` (see its README for the item
> list and restore instructions). If a script you remember is missing, look
> there first.

This runbook describes the **new automated flow** in this repository: from monthly Helium10 exports → preprocessed `amazon_obd2_YYYYMM.xlsx` → raw workbooks (`Amazon Competitor Report.xlsx` + `summary.xlsx`) → final formatted deliverables.

It is designed to **avoid manual copy/paste**, including the **Rolling-12 “Total Market”** rows (those are filled automatically during formatting).

## Inputs you provide each month

1) Helium10 Black Box exports (CSV)
- Primary exports: `Amazon_Raw_Data/raw_data/YYYYMM/*.csv`
- Backup exports (only if missing ASINs): `Amazon_Raw_Data/backup_data/YYYYMM/*.csv`

2) Product type mapping (ongoing)
- Master file: `amazon_scanner_type.xlsx`
- If preprocess generates `extra.xlsx`, you must categorize those ASINs and add them to `amazon_scanner_type.xlsx`.

3) Optional actuals (current month only)
- `innova_actual_data/innova1p_YYYYMM.csv`
- `innova_actual_data/innova3p_YYYYMM.csv`
- `innova_actual_data/blcktecYYYYMM.xlsx`

## One-command pipeline (when inputs are ready)

From repo root:

```bash
python3.12 script/run_prelaunch_dashboard_pipeline.py \
  --month YYYYMM
```

Outputs:
- Raw outputs: `script output reports/`
- Dashboard ingest: raw workbook data plus `dashboard_snapshot_rows.json` using `source-mode raw_unformatted`
- Formatted deliverables: `YY-MM-reports/` after dashboard ingest succeeds

## Step-by-step (debuggable)

### 1) Preprocess Helium10 exports → `amazon_obd2_YYYYMM.xlsx`

```bash
python3.12 script/preprocess_month.py --month YYYYMM
```

Artifacts:
- `script/runs/YYYYMM/missing.xlsx` (only if still missing after backup/missing-good)
- `script/runs/YYYYMM/extra.xlsx` (new ASINs missing Type)

If `missing.xlsx` exists and the script stops:
- Export backup CSVs to `Amazon_Raw_Data/backup_data/YYYYMM/` and rerun.
- If still missing: fill `missing.xlsx` manually (Helium10 extension), save as `missing-good.csv` into `Amazon_Raw_Data/backup_data/YYYYMM/`, then rerun.

If `extra.xlsx` exists and the script stops:
- Add those ASINs + Types into `amazon_scanner_type.xlsx`, then rerun.

### 2) Generate raw workbooks (report + summary)

```bash
python3.12 script/full_report_month.py --month YYYYMM
```

Outputs (defaults):
- `script/Amazon Competitor Report.xlsx`
- `script/summary.xlsx`

### 3) Format final deliverables (templates → filled outputs)

```bash
python3.12 script/automate_final_outputs.py \
  --month YYYYMM
```

Important:
- The formatter auto-detects previous-month final workbooks from `YY-MM-reports/`.
- It fails rather than overwriting existing final files unless `--overwrite-final` is passed.
- The dashboard ingest does not read these final Excel workbooks; it continues to use the raw files.

## Brand logos (automatic)

Brand tab header logos are inserted automatically as floating images from the
repo asset library:

- `script/brand_header_assets/analysis/<brand>.png` (8 fixed Analysis brand tabs)
- `script/brand_header_assets/report/<brand>.png` (Innova/Innova 1P/Innova 3P/BLCKTEC + all competitor tabs)

Notes:
- File names are matched to sheet names case-insensitively, ignoring spaces
  and punctuation (e.g. `Diesel Laptops` → `diesellaptops.png`).
- **New brand next month?** Drop a PNG named after its tab into
  `script/brand_header_assets/report/` — the formatter prints a warning when a
  brand tab has no logo asset but does not fail the build.
- Logos are auto-scaled to fit the merged header block (rows 1–5).
- The old manual copy/paste (Excel in-cell images) is no longer needed;
  openpyxl cannot preserve in-cell images, which is why they used to vanish.
- To re-extract logos from a hand-fixed final workbook:
  `script/extract_brand_logos.py --analysis <file> --report <file>`

## Regression review vs a golden month

`script/review_final_outputs.py` regenerates a month's two deliverables into a
sandbox and diffs them cell-by-cell (values, number formats, merges, fonts,
fills, tables, logos) against the hand-checked finals:

```bash
.venv/bin/python script/review_final_outputs.py \
  --month YYYYMM \
  --golden-dir YY-MM-reports
```

(`--tier-scheme v1|v2` forces the Analysis scheme; default follows the month.)

- Sandbox output: `script/runs/YYYYMM/formatted_review/` (never touches the
  golden folder; refuses to write into it).
- Diff report: `script/runs/YYYYMM/formatted_review/diff_report.xlsx`
  (`diffs` tab = every difference, `summary` tab = counts per sheet/category).
- Use `--skip-generate` to re-diff without regenerating.

Build-time validation now also enforces: brand logos present, Rank by
Revenue/Units titles merged across the table width, Innova red / BLCKTEC blue
fonts (and no stray own-brand colors on other tabs), dynamic Summary
brand-color ranges, and brand-table column number formats.

## Formatting is rule-driven, not template-inherited

The formatter re-applies these styles explicitly after writing data, so they
stay correct even when row counts or brand order change month over month
(and broken cells in an old template no longer propagate):

- Hyperlink columns: blue Hyperlink theme color + underline on every data row
  (own-brand rows keep Innova red / BLCKTEC blue).
- Analysis brand-tab overview (rows 8-17): grand "Total" row purple
  `FFB5A7D7` bold; "Total Tablet/Handheld/Dongle/Other Tools" subtotal rows
  gray (25% tint) bold; type rows unfilled.
- Category tabs (Tablet/Handheld Total, Dongle, Other Tools + price-range
  children): brand rows in white / light-gray (5% tint) alternating banding,
  total rows purple `FFB5A7D7` bold; order follows the raw summary.xlsx
  Category sheet.
- Brand listing tables: header row bold with lavender fill; the "Monthly
  Rev" / "Monthly Units" column highlighted lavender on every data row.
- Analysis Summary category table (scheme V2, 202610+): sub-tier rows
  unfilled, regular weight, label indented one level; "Total Tablet/Handheld/
  Other Tools" gray bold; "Total Dongle" bold with **no** fill; grand "Total"
  purple bold. (V1 months keep the template's Summary styling.)

## Price-tier scheme V2 (report months 202610+)

`script/price_tier_scheme.py` is the single source of the tiers. From
202610 the raw `summary.xlsx` (`full_report_month.py`) and the Analysis
workbook (`template_fill/`) use scheme V2:

- Tabs: Summary, Top 50, Tablet Total, Tablet $800+, Tablet $400-$800,
  Tablet $400-, **Tablet $300-$400, Tablet $200-$300, Tablet $200-**, Handheld
  Total, Handheld $100+, Handheld $100-, **Handheld $65-$100, Handheld $35-$65,
  Handheld $35-**, Dongle, Other Tools, then the 8 brand tabs. (Final analyst
  labels 2026-11-03; a template still carrying the first preview's "Tablet
  $300+" / "Handheld $65+" wording is renamed in place by the upgrade.)
- "Tablet $400-" / "Handheld $100-" get one section per sub-tier below their
  ranking tables (same block layout as the Tablet Total sections); each
  sub-tier tab's overview links to its section (its Total row = the section
  Total row = `=Summary!...`).
- "Tablet Total" / "Handheld Total" carry a brand-breakdown section for every
  tier AND sub-tier of the family in scheme order (6 tablet, 5 handheld); the
  sub-tier tabs still link the parent tier tab's sections.
- summary.xlsx Sheet1 "Qty by %" / "Revenue by %" divide by each tag's own
  "Total"-category sums per frame (OBD1 listings belong to no category), so
  every "Total" row reads exactly 100%; V1 months keep the whole-frame basis,
  and the report workbook's Summary "Market ... Share %" columns and Rolling-12
  Total Market row stay whole-market.
- Summary category table: 16 rows (sub-tiers directly under their parent);
  the charts and the brand Revenue/Units blocks sit 6 rows lower than in V1.
- Brand tabs keep the 10 parent-level rows (no sub-tiers).
- A sub-tier with no sales in a month still builds: its section is title +
  header + a Total row (0 units/revenue, 0% shares, other columns linked to its
  zero Summary row), its tab's overview is that Total row only and its ranking
  tables are empty; the next month's build grows both back.

**Self-upgrading template.** `automate_final_outputs.py` still uses last
month's final as the template. Before filling, `template_fill/scheme_upgrade.py`
reshapes it to the month's scheme: clones missing tier/sub-tier tabs (tables,
6 charts, conditional formats re-pointed at the new tab), removes tier tabs of
the other scheme, adds/replaces parent sections, grows the Summary table and
re-points the Summary chart series by label. Each change is logged as
`[template-upgrade] ...`; an already-V2 template is left alone. No manual
tab/row work is needed for October.

Month selection is automatic (`--month`, or the raw report title). To preview
another month in V2, force the scheme consistently in all three steps:

```bash
.venv/bin/python script/full_report_month.py --month 202609 --tier-scheme v2 \
  --out-report OUT/"Amazon Competitor Report.xlsx" --out-summary OUT/summary.xlsx \
  --out-dashboard-json OUT/dashboard_snapshot_rows.json \
  --amazon-obd2-dir "script/runs/202609/obd2_carryover_zero"
.venv/bin/python script/automate_final_outputs.py --month 202609 --tier-scheme v2 \
  --raw-report OUT/"Amazon Competitor Report.xlsx" --raw-summary OUT/summary.xlsx \
  --template-report <report template> --template-analysis <analysis template> \
  --out-dir OUT --date-tag YY-MM-DD
.venv/bin/python script/qa_final_workbooks.py --tier-scheme v2 --report ... --analysis ... \
  --raw-report OUT/"Amazon Competitor Report.xlsx"
```

A raw summary built with the other scheme fails the filler before anything is
written. Tests: `cd script && ../.venv/bin/python -m unittest
test_template_fill_scheme` (set `TEMPLATE_FILL_V2_RAW_DIR` to a V2 202609 raw
dir to skip regenerating it; `TEMPLATE_FILL_TEST_DIR` keeps the outputs). The
V1 regression test rebuilds September with the pre-change filler and requires
byte-identical workbook parts.

## Optional sanity checks

Rolling-12 continuity check:
```bash
python3.12 script/rolling12_impact_report.py --end-month YYYYMM --amazon-obd2-dir "amazon_obd2" --cur-month-file "amazon_obd2/amazon_obd2_YYYYMM.xlsx" --label check
```

Source breakdown (raw vs backup vs missing-good):
```bash
python3.12 script/quantify_month_sources.py \
  --amazon-obd2 "amazon_obd2/amazon_obd2_YYYYMM.xlsx" \
  --raw-folder "Amazon_Raw_Data/raw_data/YYYYMM" \
  --backup-folder "Amazon_Raw_Data/backup_data/YYYYMM" \
  --out-csv "script/runs/YYYYMM/source_breakdown.csv"
```
