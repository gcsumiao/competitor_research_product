# Competitor Research Product

End-to-end monthly workflow for:
1. building Code Reader market datasets from Helium10 exports,
2. generating raw and formatted report workbooks,
3. archiving monthly dashboard source data,
4. serving analytics in a Next.js dashboard.

## Repository structure

- `Amazon_Monthly_Competitor_Report copy/`: monthly data pipeline and report scripts
- `product_dashboard/`: Next.js dashboard app (main app)
- `dashboard_templatev0/`: older template dashboard
- `DMM_h10/`: DMM and other category CSV data sources

## Data inputs and sources

For Code Reader monthly processing, data comes from:

1. Helium10 exports
- Primary exports: `Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/raw_data/YYYYMM/*.csv`
- Backup exports: `Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/backup_data/YYYYMM/*.csv`
- Optional missing fill file: `Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/backup_data/YYYYMM/missing-good.csv`

2. ASIN type mapping
- `Amazon_Monthly_Competitor_Report copy/amazon_scanner_type.xlsx`

3. Optional actual sales overrides (current month)
- `Amazon_Monthly_Competitor_Report copy/innova_actual_data/innova1p_YYYYMM.csv`
- `Amazon_Monthly_Competitor_Report copy/innova_actual_data/innova3p_YYYYMM.csv`
- `Amazon_Monthly_Competitor_Report copy/innova_actual_data/blcktecYYYYMM.xlsx`

### Monthly sourcing-data creation checklist (from Helium10)

For each new month (`YYYYMM`):

1. Create month folders:
- `Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/raw_data/YYYYMM/`
- `Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/backup_data/YYYYMM/` (optional but recommended)

2. Put Helium10 CSV exports into `raw_data/YYYYMM/`.

3. If you have backup or repaired exports, place them in `backup_data/YYYYMM/`.

4. If there are manually recovered missing ASIN rows, place `missing-good.csv` in `backup_data/YYYYMM/`.

5. If current-month real sales are available, add Innova/BLCKTEC files in:
- `Amazon_Monthly_Competitor_Report copy/innova_actual_data/`

6. Run the one-command prelaunch pipeline (below). It creates the sourcing workbooks consumed by dashboard ingestion.

## One-command prelaunch pipeline

Run this before starting the dashboard:

```bash
pnpm prelaunch:code-reader -- --month YYYYMM
```

If `--month` is omitted, it auto-picks the latest `YYYYMM` folder in `raw_data`.

Equivalent direct command:

```bash
cd "Amazon_Monthly_Competitor_Report copy"
.venv/bin/python script/run_prelaunch_dashboard_pipeline.py --month YYYYMM
```

Script path:
- `Amazon_Monthly_Competitor_Report copy/script/run_prelaunch_dashboard_pipeline.py`

## Step-by-step pipeline logic (what the script does)

### 1) Resolve month

- Uses `--month YYYYMM` if provided.
- Otherwise scans `Amazon_Raw_Data/raw_data/` and chooses the max `YYYYMM`.

### 2) Run preprocess in strict mode first

- Runs: `script/preprocess_month.py --month YYYYMM`
- Expected output:
  - `amazon_obd2/amazon_obd2_YYYYMM.xlsx`
  - optional artifacts under `script/runs/YYYYMM/`:
    - `missing.xlsx`
    - `extra.xlsx`

Branch rules:
- exit `0`: continue
- exit `2` (missing unresolved): auto fallback to carryover route
- exit `3` (extra/type unresolved): rerun with `--allow-extra`
- any other exit: fail

### 3) Missing-data fallback route (auto carryover-zero)

When missing ASINs remain unresolved:

1. Generate helper files from `script/runs/YYYYMM/missing.xlsx`:
- `missing_asins_for_export.txt`
- `missing_asin_urls_for_export.csv`

2. Rerun preprocess with:
- `--allow-missing --allow-extra`

3. Build carryover workbook:
- `script/build_amazon_obd2_with_carryover.py`

4. Build temporary 13-month OBD2 history dir:
- previous 12 monthly files + carryover current month

5. Use that temporary OBD2 history for full report generation.

### 4) Generate raw monthly report outputs

Runs `script/full_report_month.py` and writes:
- `Amazon_Monthly_Competitor_Report copy/script output reports/Amazon Competitor Report.xlsx`
- `Amazon_Monthly_Competitor_Report copy/script output reports/summary.xlsx`

Actual override behavior:
- if Innova/BLCKTEC actual files exist, they are merged into current-month data before raw report/summary are written.

### 5) Archive raw outputs into dashboard source

Runs dashboard archive script:
- `product_dashboard/scripts/archive-code-reader-monthly.mjs --month YYYYMM --overwrite`

Creates/updates:
- `product_dashboard/data/code_reader_scanner/YYYYMM/report.xlsx`
- `product_dashboard/data/code_reader_scanner/YYYYMM/summary.xlsx`
- `product_dashboard/data/code_reader_scanner/YYYYMM/manifest.json`

Manifest mode for this flow:
- `sourceMode: "raw_unformatted"`

### 6) Build formatted deliverables

Auto-detects previous-month templates from `*-reports` folders:

- `* Amazon Competitor Report <PrevMonthName> Innova Adjusted.xlsx`
- `* Amazon Competitor Analysis <PrevMonthName>.xlsx`

Then runs formatter and writes:
- `Amazon_Monthly_Competitor_Report copy/YY-MM-reports/YY-MM-DD Amazon Competitor Report <Month> Innova Adjusted.xlsx`
- `Amazon_Monthly_Competitor_Report copy/YY-MM-reports/YY-MM-DD Amazon Competitor Analysis <Month>.xlsx`

### 7) Run summary and checks

At the end, the script validates:
- raw report has sheets: `Summary`, `Rolling 12 mo`, `Top 50`
- raw summary has `Sheet1` or `Category`
- archive folder contains `report.xlsx`, `summary.xlsx`, `manifest.json`
- manifest month matches `YYYYMM`

Warnings are printed for non-blocking cases, such as unresolved `extra.xlsx`.

## How dashboard uses the source data

Code Reader dashboard snapshots come from:
- `product_dashboard/data/code_reader_scanner/YYYYMM/`

Loader behavior:
1. Reads all `YYYYMM` month folders.
2. Requires a report workbook (`report.xlsx`, or manifest-named report fallback).
3. For type/category breakdowns:
- prefers `analysis.xlsx` if present
- else uses `summary.xlsx`
4. Uses `manifest.json` for:
- month metadata
- snapshot date
- display file names in report download UI
5. Sorts snapshots by date and shows the latest by default.

Implication:
- If both `analysis.xlsx` and new `summary.xlsx` exist, type-breakdown views will use `analysis.xlsx` first.

### Dashboard source-data contract (per month folder)

Required for full Code Reader month support:
1. `report.xlsx` (or manifest-declared report filename)
2. One type-breakdown source:
- `analysis.xlsx` preferred, or
- `summary.xlsx` fallback
3. `manifest.json` (recommended; required for stable metadata/display names)

Expected report sheets checked by prelaunch pipeline:
1. `Summary`
2. `Rolling 12 mo`
3. `Top 50`

## How the dashboard was built

Main app:
- `product_dashboard/` (Next.js App Router, React, TypeScript)

Core build/runtime:
1. Server-side loaders parse workbook/csv sources into normalized snapshot objects.
2. Dashboard pages render snapshot metrics, trends, brand views, and report downloads.
3. API routes serve report file downloads and chatbot/consult tooling endpoints.

Key data loader modules:
1. `product_dashboard/lib/code-reader-scanner-data.ts`
2. `product_dashboard/lib/report-files.ts`
3. `product_dashboard/lib/competitor-data.ts`

Primary app commands:

```bash
pnpm -C product_dashboard install
pnpm dev
```

Root shortcut commands:
- `pnpm dev` (product dashboard)
- `pnpm build`
- `pnpm start`
- `pnpm prelaunch:code-reader -- --month YYYYMM`

## Development quick start

1. Install app dependencies:

```bash
pnpm -C product_dashboard install
```

2. Run prelaunch pipeline for your month:

```bash
pnpm prelaunch:code-reader -- --month YYYYMM
```

3. Start dashboard:

```bash
pnpm dev
```

4. Open:
- `http://localhost:3000`

## Additional references

- `Amazon_Monthly_Competitor_Report copy/script/RUNBOOK_NEW_FLOW.md`
- `product_dashboard/README.md`
