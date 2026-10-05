1. [P1] `ca_market_reports/build_combined_gauge_report.py:781` — The default build calls a helper that can append new gauge decisions or rewrite frozen rows after a map change. That does not guarantee the promised replay or `unfrozen_candidates=0`, and can make the combined workbook differ from the single-market workbooks. **Fix:** require complete, unchanged frozen decisions for both markets before building; fail on any new or rewritten decision and keep the combined path read-only with respect to decisions.

2. [P2] `ca_market_reports/validate_outputs.py:1287` — V07 accepts a money header such as `US Monthly Rev` without `(USD)` because the `US` prefix counts as a currency label. The workbook and registry can both carry that header while the numeric checks pass. **Fix:** require the matching `(CAD)` or `(USD)` token on every money header, with an explicit exception for the Key figures `CA`/`US` value columns; add a missing-token mutation test.

3. [P2] `ca_market_reports/validate_outputs.py:1556` — Brand rows are checked by display text and in any order, while the builder groups by `brand_key` and promises CA-revenue order. Different CA/US display text for one key can fail a correct workbook; swapping complete brand rows can pass. **Fix:** derive the expected ordered rows by `brand_key`, compare them by position, and handle display-label collisions explicitly.

4. [P2] `ca_market_reports/validate_outputs.py:1729` — The brand-tab KPI check validates only the rows and market columns listed in the registry. Removing the share row from the workbook and shortening its registered range can still pass, so V09 does not establish the required four-row CA|US block. **Fix:** assert the exact columns, row positions, and four metric labels for every qualifying brand tab before checking values.

PASS: The nominal `max(CA revenue, US revenue)` rule is confined to brand-row selection and is disclosed; totals and shares use separate market frames.  
PASS: Top 50, All Products, Excluded, and Audit tables use the single-market writers.  
PASS: The combined workbook is entered in the shared CA gauge manifest with both markets’ raw inputs.

VERDICT: FIX-FIRST