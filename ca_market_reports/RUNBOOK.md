# CA market reports: monthly runbook

Operator runbook for the Canada Amazon code-reader and OBD-gauge workbooks (plus the US gauge benchmark).
Follow it top to bottom each month. Every command below was run on the 202609 data (into scratch folders under
`tmp/ca_scratch/`) while this runbook was written; the quoted log lines are real output.

## 1. Purpose

Each month the package turns Helium 10 Black Box exports into five Excel workbooks:

| Workbook | Built by | Lands in |
|---|---|---|
| `CA_Code_Reader_Competitor_Report_<M>.xlsx` | `build_ca_code_reader_report.py` | `NewProductCategory/CA-CODE-READER/outputs/` |
| `CA_Code_Reader_Analysis_<M>.xlsx` | `build_ca_code_reader_report.py` | `NewProductCategory/CA-CODE-READER/outputs/` |
| `US_OBD_Gauge_Competitor_Report_<M>.xlsx` | `build_gauge_report.py --market US` | `NewProductCategory/US-OBD-GAUGE/outputs/` |
| `CA_OBD_Gauge_Competitor_Report_<M>.xlsx` | `build_gauge_report.py --market CA --benchmark-market US` | `NewProductCategory/CA-OBD-GAUGE/outputs/` |
| `CA_US_OBD_Gauge_Competitor_Report_<M>.xlsx` (CA and US side by side) | `build_combined_gauge_report.py` (Step 4c) | `NewProductCategory/CA-OBD-GAUGE/outputs/` |

Each output folder also gets `manifest_<M>.json` (sha256 of the outputs and of every input; the combined workbook is
merged into the CA-OBD-GAUGE manifest together with both markets' raw inputs). The machine decisions of the run (dedupe
audit, brand recovery, type decisions, type review queue, gauge decisions, table registry; the combined workbook has its
own `table_registry_CAUS_<M>.json`) go to `ca_market_reports/runs/<M>/`. `validate_outputs.py` then checks everything
(V01-V23).

`<M>` is the report month as `YYYYMM` (for example `202609`). All commands run from the repository root.

## 2. Prerequisites

- **Interpreter.** Always run through `ca_market_reports/run.sh <python args>`. It uses
  `/Users/sumiaoc/competitor_research_product/Amazon_Monthly_Competitor_Report copy/.venv/bin/python` (pandas +
  openpyxl), or the interpreter in `$CA_REPORTS_PYTHON` when that is set. If the interpreter is missing, `run.sh` exits 2
  and prints how to create one from `ca_market_reports/requirements.txt`.
- **Raw data lives outside git.** `NewProductCategory/` and `Amazon_Monthly_Competitor_Report copy/` are gitignored in
  this repository. `NewProductCategory/` is also its own nested git repository. **Never run `git add` inside
  `NewProductCategory/`** and never commit raw exports or workbooks to this repository.
- **US Type map.** The CA code-reader build reads `Amazon_Monthly_Competitor_Report copy/amazon_scanner_type.xlsx`
  (ASIN -> Type) by default (`--us-type-map` overrides it).
- **Tests pass:** `ca_market_reports/run.sh -m unittest discover -s ca_market_reports/tests -p "test_*.py"`.

## 3. Monthly procedure

Replace `202609` with the report month.

### Step 1: drop the Helium 10 exports

Put the CSV exports directly into these month folders. Every file name must carry the export date as
`_YYYY-MM-DD` (Helium 10 does this: `CA_AMAZON_blackBoxProducts_1_2026-10-02 (3).csv`). Overlapping pages are fine:
rows are deduped per ASIN.

| Export | Folder | 202609 |
|---|---|---|
| CA code readers | `NewProductCategory/CA-CODE-READER/raw_data/<M>/` | 10 files |
| CA OBD gauges, plus any extra gauge exports (e.g. the Bully Dog search) | `NewProductCategory/CA-OBD-GAUGE/raw_data/<M>/` | 4 files + `CA_AMAZON_blackBoxProducts_bullydog_2026-10-02.csv` |
| US OBD gauges | `NewProductCategory/US-OBD-GAUGE/raw_data/<M>/` | 3 files |
| US code readers (the regular US monthly export) | `Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/raw_data/<M>/` | 28 files |

### Step 2: CA code-reader workbooks

```bash
ca_market_reports/run.sh ca_market_reports/build_ca_code_reader_report.py --month 202609 --overwrite
```

Prints `registry: …/runs/202609/table_registry_CA_202609.json (72 tables)`, `manifest: …` and one `wrote …` line per
workbook. Loud `type default_other at revenue >= 1000: asin=… revenue=… title=…` lines are expected (see
Troubleshooting). Add `--audit` to print the raw-file, dedupe and type-coverage summary.

### Step 3: US gauge workbook

```bash
ca_market_reports/run.sh ca_market_reports/build_gauge_report.py --market US --month 202609 --overwrite
```

On 202609 it logged `gauge_decisions US 202609: unfrozen_candidates=273 (rederive=False) -> …` on the first run.

### Step 4: CA gauge workbook with the US benchmark

```bash
ca_market_reports/run.sh ca_market_reports/build_gauge_report.py --market CA --month 202609 --benchmark-market US --overwrite
```

Run it after Step 3. The CA build reloads the US data for the benchmark sheets and replays the US gauge decisions
frozen in Step 3 (202609 log: `gauge_decisions US 202609: unfrozen_candidates=0`).

### Step 4b: write the month's memo

The memo is `ca_market_reports/memo/CA_OBD_Gauge_Market_Memo_<M>.md` with its sources in
`ca_market_reports/memo/sources_<M>.csv` (columns `url,accessed,publisher,claim,quote,used_in_section`). For a new month,
start from the previous month's files as the skeleton:

```bash
cp ca_market_reports/memo/CA_OBD_Gauge_Market_Memo_202609.md ca_market_reports/memo/CA_OBD_Gauge_Market_Memo_202610.md
cp ca_market_reports/memo/sources_202609.csv ca_market_reports/memo/sources_202610.csv
```

Then rewrite the month-specific text and tag every number:

- Amazon (Helium 10) numbers: `[WB: <file>!<sheet>!<cell>]` right after the number, e.g.
  `CA$47,821 [WB: CA_OBD_Gauge_Competitor_Report_202610.xlsx!Summary!C30]`. V20 compares the LAST number before the tag
  on the same line with the cell: exact for counts, ±1 for money shown without cents, ±0.001 for shares (`45.2%`).
  The workbook file names carry the month, so every tag copied from the previous memo must be re-pointed at the new
  month's workbooks and cells; a tag naming a workbook that is not in the output folders FAILs. Use `[WB: TBD]` while a
  number is not filled yet: any `[WB: TBD]` left makes V20 FAIL.
- Web sources: `[SRC: <url>, accessed YYYY-MM-DD]`; the url must be a row of `sources_<M>.csv`.
- Tags inside backticks (`` `[WB: …]` ``) are treated as literal mentions and are not checked.

Run Step 5 to check the tags (V20 runs with the other checks). `--skip V20` (documented reason "memo not filled yet")
is allowed only while the memo is still being written; the month is not finished until V20 PASSes without it.

### Step 4c: combined CA + US gauge workbook

```bash
ca_market_reports/run.sh ca_market_reports/build_combined_gauge_report.py --month 202609 --overwrite
```

Run it after Step 4 (and so after Step 3). It writes `CA_US_OBD_Gauge_Competitor_Report_<M>.xlsx` next to the CA gauge
workbook in `NewProductCategory/CA-OBD-GAUGE/outputs/`, its registry `runs/<M>/table_registry_CAUS_<M>.json`, and merges
its entry (plus the CA and US raw inputs) into that folder's `manifest_<M>.json`. Every Summary table shows CA (CAD) and
US (USD) side by side; there is no FX conversion and no cross-currency ratio. Rebuild it whenever Step 3 or Step 4 is
rebuilt so it carries the same decisions: Step 5 re-derives its figures from the raw exports, so a stale combined
workbook FAILs the dataset checks.

### Step 5: validate

```bash
ca_market_reports/run.sh ca_market_reports/validate_outputs.py --month 202609 \
    --json ca_market_reports/runs/202609/validation_CA_202609.json
```

The validator re-derives the dataset from the raw exports (it never writes to `NewProductCategory/`), reads the
workbooks, the table registry, the manifests, the decision files and the memo, and prints one line per check:

```
PASS V01 summary revenue total: revenue == re-derived dataset (…)
…
PASS V23 benchmark joins: Same-ASIN 26 rows == CA∩US device-scope-in-either 26 (of 57 shared ASINs); …
VALIDATION: PASS (23/23)
```

Exit code 0 only when no check FAILs. The final line counts PASS checks out of 23 (a SKIP is not a PASS, so a clean
run with one skip reads `VALIDATION: PASS (22/23)`). Useful options:

- `--cr-out-dir`, `--gauge-out-dir`, `--us-gauge-out-dir`, `--runs-dir`, `--raw-dir`, `--gauge-raw-dir`,
  `--us-gauge-raw-dir`, `--us-cr-raw-dir`, `--memo`, `--sources`: point at non-default locations (defaults are the
  folders in this runbook).
- `--skip V20` or `--skip V23` only. `V20` (memo) may be skipped before the memo is written; `V23` only when the CA
  gauge workbook was built without `--benchmark-market US`. Any other ID is refused with an argument error.
- `--combined auto|require|off` (default `auto`): the combined workbook from Step 4c is validated whenever it sits in
  `--gauge-out-dir`; when it is absent the run is not failed and V15's evidence says `combined: absent`. Use
  `--combined require` for the month's final run so a missing combined workbook FAILs; `off` ignores it.

The combined workbook adds no check lines: it adds evidence to the existing ones (e.g.
`…; CA_US_OBD_Gauge_Competitor_Report CA … / US …`) and FAILs the same check ids. Each table is checked against its
market block: Key figures and the brand Total against each market's core totals (V01-V03), Top 50 CA / US and the four
brand-tab ranking tables (V04), shares within each block (V05), amazon.ca links in CA tables and amazon.com links in US
tables (V06), every money column labelled with one block currency and no cross-currency ratio (V07), all 11 Key
figures rows (incl. the full code-reader market totals and the bold "0.00%" gauge-share rows, definition (b)), tier ×
sub-type revenue and units, fuel subtotals, sub-type mix and every Total (V09), the core / borderline / accessory /
adjacent Key figures rows and Innova B3/B4 (V12), Excluded — CA / — US (V13), All Products — CA / — US per ASIN (V18), and the shared manifest (V19).

202609 status: the committed result (`ca_market_reports/runs/202609/validation_ALL_202609.txt`) is
`VALIDATION: PASS (23/23)` on the final outputs with the filled memo. Notes on two checks:

- V04 compares every row of every ranked table (Top 50 by revenue and by units, brand tabs, tier tabs, Model B top
  lists) with the dataset sorted independently: revenue DESC, units DESC, ASIN ASC for "by revenue" tables; units DESC,
  revenue DESC, ASIN ASC for "by units" tables (the builders' order).
- V19 requires every raw CSV the loader reads to be hashed in the manifest. The loader reads raw folders recursively
  (subfolders included, AppleDouble `._*` files skipped), so a CSV in a subfolder must be hashed too. Hashed
  `maps/*.csv` are matched by file name and current content, so a build made from another checkout still validates;
  editing a map after the build makes V19 FAIL (`maps changed since the build`).
- `--json` must point outside `NewProductCategory/` (the validator refuses with exit 2 otherwise).

### Step 6: review the Types

Open `ca_market_reports/runs/202609/type_review_CA_code_reader_202609.csv` (125 rows for 202609). Each row is a
`default_other`, a low-confidence `token_profile` (< 0.70) or a gauge type conflict. Write the correct Type (one of
`Tablet, Handheld, Dongle, VCI, Cable/Adapter, Key, OBD1, Probe, Other`) into `reviewed_type`; leave it blank to skip
the row. Then append the decisions to the human override map:

```bash
ca_market_reports/run.sh -m ca_market_reports.apply_type_review \
    --review ca_market_reports/runs/202609/type_review_CA_code_reader_202609.csv --decided-by <your name>
```

It prints `appended=<n> skipped_blank=<n> conflicts=<n>` and appends to `maps/ca_type_overrides.csv` (a rerun appends
nothing new: `appended=0`). An unknown Type is refused before anything is appended. Then rerun Steps 2, 4, 4c and 5. The
override map wins over the frozen decision without `--rederive`; the CR build logs, e.g.
`type_decisions[CA/code_reader]: override map rewrites frozen decision B0895R2YMM: Handheld/token_profile -> Handheld/override`.
Use `--rederive` only when you want every machine decision derived afresh (see Section 4).

### Step 7: commit the decisions

Commit the month's decision files and any map edits in this repository (never in `NewProductCategory/`):

```bash
git add ca_market_reports/runs/202609 ca_market_reports/maps
git commit -m "chore(ca-reports): 202609 run decisions + maps"
```

`ca_market_reports/runs/` and `ca_market_reports/maps/` are not gitignored; next month's run reads them.

### Step 8: ship the runbook and the memo with the workbooks

```bash
cp ca_market_reports/RUNBOOK.md NewProductCategory/CA-CODE-READER/outputs/
cp ca_market_reports/RUNBOOK.md ca_market_reports/memo/CA_OBD_Gauge_Market_Memo_202609.md NewProductCategory/CA-OBD-GAUGE/outputs/
```

The validator ignores `.md` files in the output folders (it checks the `.xlsx` files and the manifest).

## 4. Freeze / replay

- **First run of a month derives; later runs replay.** The first build of a month writes its machine decisions to
  `runs/<M>/` (`dedupe_audit_*`, `brand_recovery_*`, `type_decisions_CA_code_reader_<M>.csv`,
  `type_review_CA_code_reader_<M>.csv`, `gauge_decisions_<market>_gauge_<M>.csv`, `table_registry_<market>_<M>.json`).
  A rerun replays them: on 202609 a second CR build left `type_decisions_CA_code_reader_202609.csv` byte-identical.
  New ASINs are appended (`unfrozen_candidates=<n>` in the gauge log).
- **`--rederive`** (both builders) derives every decision afresh and rewrites the decision files (202609: all 1,828 type
  decisions got the new run id).
- **Maps always win.** A row in `maps/ca_type_overrides.csv` or `maps/ca_gauge_map.csv` overrides a frozen decision on
  the next run without `--rederive`, with a loud log line (gauge example:
  `gauge_map_override asin=B0784PC19Q frozen=ambiguous/AMB -> map=excluded_non_gauge`).
- **The type review file merges.** A rebuild refreshes the machine columns and keeps any `reviewed_type` you entered.

## 5. Backups and the HAND-EDITED warning

`--overwrite` never deletes a workbook: the old file moves to `<outputs>/_backup/<name>.<YYYYMMDD-HHMMSS>.xlsx`
(`backup: CA_Code_Reader_Competitor_Report_202609.xlsx -> …/_backup/CA_Code_Reader_Competitor_Report_202609.20261002-123253.xlsx`).
Without `--overwrite` an existing output is refused (`FileExistsError: outputs exist in …; pass --overwrite`). If the
existing file differs from the hash in `manifest_<M>.json` (someone edited it in Excel), the builder prints
`HAND-EDITED: <path>` before backing it up. Move any hand edits into the maps instead; a workbook rebuild always
starts from the data. Close a workbook in Excel before rebuilding: an Excel lock file (`~$<name>`) makes the builder
refuse, and V10 fails while one exists.

## 6. The US code-reader export

`Amazon_Monthly_Competitor_Report copy/Amazon_Raw_Data/raw_data/<M>/` holds the regular US monthly code-reader export.
This package only **reads** it, and only to add gauge-class rows to the US gauge union: after its own dedupe, only the
rows that pass the gauge candidate pre-filter (title rules) or whose ASIN is in `maps/ca_gauge_map.csv` enter the union
(202609: 5,547 deduped rows read, 273 union rows in the US gauge workbook). It is never used to build or change the US
monthly code-reader report, and no US Type is assigned.

## 7. Brand aliases and display names

- `maps/ca_brand_aliases.csv` (`raw_key,canonical_key,note`): maps a Helium 10 brand spelling to one canonical key.
  Both sides are normalized (case, ™/®/© glyphs, whitespace), so `Krazy Tools™` and `krazy tools` are the same key.
  A raw key that maps to two canonical keys, or an alias chain, is an error when the map is read.
- `maps/ca_brand_display.csv` (`canonical_key,display`): the name shown in the workbooks. Without a row the key is
  title-cased (`krazy tools` -> `Krazy Tools`).
- Add the row, rerun Steps 2-5, commit `maps/`.

## 8. Reviewing gauge classifications

- Every row of the code-reader and gauge exports gets one gauge class. The workbooks show device classes in the totals,
  the GPS-only HUD and gauge accessories as separate blocks, and every excluded or `ambiguous` row on the **Excluded**
  tab with its Rule ID (`XN-…`, `XD-…`, `AMB`, `MAP`). The **All Products** tab lists every union row.
  On a rebuild of the same month the replayed rows show Rule ID `PRIOR` (202609 CA rerun: 1,783 `PRIOR` + 27 `MAP` on
  the Excluded tab); the original rule id stays in `runs/<M>/gauge_decisions_<market>_gauge_<M>.csv`.
- `ambiguous` rows (rule `AMB`; 202609 CA: 1 row, `B0784PC19Q`) need a human decision.
- To decide a row, append to `maps/ca_gauge_map.csv`:
  `asin,gauge_class,borderline,reason,decided_by,decided_month`, e.g.
  `B0784PC19Q,excluded_non_gauge,N,<why>,<you>,202609`. `gauge_class` must be a class name from `ca_common.GAUGE_CLASSES`;
  `borderline` is `Y`/`N` (blank = `N`; anything else is an error). For one ASIN the row with the latest
  `decided_month <= <M>` wins; two different decisions with the same `decided_month` are an error.
- Rerun Steps 3-5 (the map applies to both markets), commit `maps/`.

## 9. Next month (202610)

202609 is the first month built with this package. For 202610:

- Commit `runs/202609/` first (Step 7). The 202610 CR build carries the 202609 type decisions forward as
  `prior_month` (verified with the 202609 exports replayed as 202610: 431 rows typed `prior_month`, after the 1,275
  `us_map` rows). `default_other` and low-confidence decisions are not carried forward.
- 202610 is the first month where a month-over-month comparison is possible (`runs/202609/` and the 202609 workbooks
  exist). The current builders still write single-month workbooks (Metadata "Scope note": "Single month; no
  MoM/Rolling-12"); MoM sheets are new builder work.

## 10. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `ValueError: CA_export.csv: no export date (_YYYY-MM-DD) in the file name` | A raw file was renamed. Restore the Helium 10 name (it carries `_YYYY-MM-DD`); the date is never guessed. |
| `ValueError: <map>.csv: data row 0: type 'Scanner' is not one of ('Tablet', …)` | Unknown Type in `maps/ca_type_overrides.csv`. Use one of the nine Types. `apply_type_review` refuses an unknown `reviewed_type` the same way and appends nothing. |
| Many `type default_other at revenue >= 1000: asin=…` lines | Listings with no Type evidence and at least CA$1,000 monthly revenue. They are in the type review CSV; fix them in Step 6. |
| `ValueError: column 'gauge_in_scope': blank boolean` | A classified row with an empty scope flag (seen with a hand-edited normalized CSV in dev mode). Booleans are parsed only from `Y/N/true/false/1/0`; regenerate the frame instead of editing it. |
| `cannot parse gauge_map borderline (…) 'maybe'; expected one of Y/N/true/false/1/0` | Fix the `borderline` cell in `maps/ca_gauge_map.csv`. |
| `FileExistsError: outputs exist in …; pass --overwrite` | Add `--overwrite` (the old file is backed up). |
| Validator `FAIL V19 … sha256 mismatch` | A workbook, raw CSV or map changed after the build. Rebuild (Steps 2-4c) and validate again. |
| Validator `FAIL V20 … [WB: TBD] placeholder(s) left` | Fill the memo tags from the validated workbooks, or `--skip V20` while the memo is not written yet. |
| Validator `FAIL … workbook missing: …` | The build step for that workbook did not run, or `--*-out-dir` points elsewhere. |
