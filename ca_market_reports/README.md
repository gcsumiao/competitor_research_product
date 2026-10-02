# ca_market_reports

Excel-only monthly competitor reports for the Canada Amazon market: CA code readers, CA OBD gauges, and the US OBD
gauge workbook used as the CA benchmark. Input = Helium 10 Black Box CSV exports; output = four `.xlsx` workbooks with
static values (the only formulas are `HYPERLINK`s), a manifest per output folder, and frozen run decisions. No
dashboard, no database. The monthly procedure is in [`RUNBOOK.md`](RUNBOOK.md).

## Layout

| Path | What |
|---|---|
| `ca_common.py` | Frozen interface: paths, markets, file names, taxonomies, tiers, row/CSV schemas, sheet names, validator contract (V01-V23). Change only through the orchestrator. |
| `ca_load.py` | Raw CSV -> normalized, deduped rows; brands; CA Types; CR price tiers; freeze/replay of run decisions. |
| `ca_brands.py`, `ca_types.py`, `ca_tiers.py` | Brand keys/display/recovery, code-reader Type assignment + review queue, price tiers. |
| `ca_gauge_classification.py` | Gauge class rules, candidate pre-filter, map/prior precedence, gauge decision freeze. |
| `ca_xlsx_style.py` | Single-pass workbook engine: house style, tables, charts, table registry, manifest, backups. |
| `build_ca_code_reader_report.py` | CA Code Reader Competitor Report + Analysis workbooks. |
| `build_gauge_report.py` | CA or US OBD Gauge Competitor Report (CA adds Model A/B and the US benchmark sheets). |
| `validate_outputs.py` | Re-derives the dataset from the raw exports and checks the workbooks (V01-V23). |
| `apply_type_review.py` | Appends reviewed Types from the review CSV to `maps/ca_type_overrides.csv`. |
| `render_preview.py` | HTML/Markdown preview of a built workbook. |
| `maps/` | Human decisions (brand aliases/display, Type overrides, gauge map, app-gauge brands). Committed. |
| `runs/<YYYYMM>/` | Frozen machine decisions + table registry of each month. Committed. |
| `memo/` | Market memo and its sources CSV. |
| `tests/` | stdlib `unittest` suite and fixtures. |
| `run.sh` | Runs Python with the report-repo venv (pandas + openpyxl); `$CA_REPORTS_PYTHON` overrides it. |

## Quickstart (report month 202609, raw exports already in place)

```bash
ca_market_reports/run.sh ca_market_reports/build_ca_code_reader_report.py --month 202609 --overwrite
ca_market_reports/run.sh ca_market_reports/build_gauge_report.py --market US --month 202609 --overwrite
ca_market_reports/run.sh ca_market_reports/build_gauge_report.py --market CA --month 202609 --benchmark-market US --overwrite
ca_market_reports/run.sh ca_market_reports/validate_outputs.py --month 202609
```

The three build commands make the workbooks; the last line validates them (exit 0 only when no check FAILs). Where to
drop the exports, how to review Types and gauge classes, and what to commit: see `RUNBOOK.md`.

## Where outputs land

- `NewProductCategory/CA-CODE-READER/outputs/`: `CA_Code_Reader_Competitor_Report_<M>.xlsx`, `CA_Code_Reader_Analysis_<M>.xlsx`, `manifest_<M>.json`
- `NewProductCategory/CA-OBD-GAUGE/outputs/`: `CA_OBD_Gauge_Competitor_Report_<M>.xlsx`, `manifest_<M>.json`
- `NewProductCategory/US-OBD-GAUGE/outputs/`: `US_OBD_Gauge_Competitor_Report_<M>.xlsx`, `manifest_<M>.json`
- `ca_market_reports/runs/<M>/`: decision CSVs, `type_review_CA_code_reader_<M>.csv`, `table_registry_<market>_<M>.json`

`NewProductCategory/` and `Amazon_Monthly_Competitor_Report copy/` are gitignored here (`NewProductCategory/` is a
nested git repository: never `git add` inside it). All default paths in `ca_common.py` are absolute and point at the main
checkout. Overwritten workbooks are moved to `<outputs>/_backup/`.

## Interface

Every frozen name (file names, sheet names, column headers, CSV schemas, tiers, gauge classes, validator check IDs and
output format) is defined in `ca_common.py`. Code against those names; flag a needed change instead of editing them.

## Tests

```bash
ca_market_reports/run.sh -m unittest discover -s ca_market_reports/tests -p "test_*.py"
```

Fixture tests write only under `tmp/ca_scratch/` (gitignored). `test_smoke_real_data.py` runs only when the 202609 raw
exports exist in the main checkout.
