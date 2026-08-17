# Monthly Operator Checklists

## DB bootstrap vs monthly ingest

- Run `pnpm -C product_dashboard db:backfill` only for a brand-new empty database.
- Do not run `db:backfill` for normal monthly updates.
- Normal month-end operations are incremental:
  - Code Reader: rerun the Python monthly pipeline
  - Non-code: rerun `pnpm -C product_dashboard db:ingest:non-code`

## Code Reader monthly checklist

1. Put the current month's Helium10 CSV exports in `Amazon_Raw_Data/raw_data/YYYYMM/`.
2. Run the monthly pipeline in the default pause-for-Helium10 mode:

```bash
cd "/Users/sumiaoc/competitor_research_product/Amazon_Monthly_Competitor_Report copy"
.venv/bin/python script/run_prelaunch_dashboard_pipeline.py --month YYYYMM
```

3. If there are missing ASINs, the pipeline writes:
   - `script/runs/YYYYMM/missing.xlsx`
   - `script/runs/YYYYMM/missing_asins_for_export.txt`
   - `script/runs/YYYYMM/missing_asin_urls_for_export.csv`
   - `script/runs/YYYYMM/helium10_batches/asins_batch_001.txt` ... `asins_batch_NNN.txt`
   - `script/runs/YYYYMM/helium10_batches_manifest.csv`
4. Upload the generated `helium10_batches/asins_batch_*.txt` files to Helium10 manually. Each batch is capped at 200 ASINs.
5. Save the returned Helium10 export CSVs into `Amazon_Raw_Data/backup_data/YYYYMM/`.
6. Build `missing-good.csv` from the returned exports:

```bash
.venv/bin/python script/build_missing_good_from_exports.py \
  --missing-xlsx script/runs/YYYYMM/missing.xlsx \
  --export "Amazon_Raw_Data/backup_data/YYYYMM/*.csv" \
  --raw-template-folder Amazon_Raw_Data/raw_data/YYYYMM \
  --out Amazon_Raw_Data/backup_data/YYYYMM/missing-good.csv
```

7. Rerun the same monthly pipeline command.
8. If `extra.xlsx` is produced, review the auto-categorization outputs and only update taxonomy for unresolved ASINs.
9. When preprocess is clean, the same pipeline run automatically completes:
   - raw report creation via `full_report_month.py`
   - raw summary creation via `full_report_month.py`
   - formatted report creation via `format_from_raw_outputs.py`
   - formatted analysis creation via `format_from_raw_outputs.py`
   - Postgres ingest via `db-ingest-code-reader.mts`
   - dashboard revalidate
10. Only use carryover fallback when Helium10 truly cannot return those missing ASINs:

```bash
.venv/bin/python script/run_prelaunch_dashboard_pipeline.py \
  --month YYYYMM \
  --missing-mode carryover_zero
```

## Non-code monthly checklist

1. Drop the new month raw CSVs into the configured category folder under the active non-code root.
2. Generate the formatted report and analysis workbook for the affected category:

```bash
cd /Users/sumiaoc/competitor_research_product
pnpm -C product_dashboard reports:generate:non-code -- --category <category_id> --month YYYYMM
```

3. Sync the non-code category folders into the deployable app data copy:

```bash
cd /Users/sumiaoc/competitor_research_product
pnpm -C product_dashboard sync:non-code-files
```

4. Run:

```bash
cd /Users/sumiaoc/competitor_research_product
pnpm -C product_dashboard db:ingest:non-code
```

5. Verify the category renders correctly in dashboard, reports, specs, and copilot.

## New non-code category checklist

1. Create the new category data folder, for example `Smoke Machine/raw_data/YYYYMM/`.
2. Add one entry to `product_dashboard/lib/non-code-category-config.ts` with:
   - `id`
   - `label`
   - `folderName`
   - workbook locator rules
   - visible report rules
   - optional starter questions
   - `specsMode`
3. Generate the first month workbook outputs:

```bash
cd /Users/sumiaoc/competitor_research_product
pnpm -C product_dashboard reports:generate:non-code -- --category <category_id> --month YYYYMM
pnpm -C product_dashboard sync:non-code-files
```

4. Run:

```bash
cd /Users/sumiaoc/competitor_research_product
pnpm -C product_dashboard build
pnpm -C product_dashboard db:ingest:non-code
```

5. Verify the new category appears at the same level as the existing non-code categories in:
   - dashboard filters
   - reports
   - specs
   - stakeholders copilot

## Dashboard cache revalidation

After running `pnpm db:ingest:code-reader` or `pnpm db:ingest:non-code`, watch the ingest output for `Failed to revalidate` warnings. The revalidate call is a silent no-op when `DASHBOARD_REVALIDATE_URL` or `DASHBOARD_REVALIDATE_SECRET` is unset. Allow ~60 seconds after ingest for the in-process memo TTL to expire before spot-checking the dashboard.
