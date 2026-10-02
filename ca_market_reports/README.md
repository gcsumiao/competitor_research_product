# ca_market_reports

Excel-only monthly competitor reports for the Canada Amazon market (code readers + OBD gauges) and the
US-vs-CA OBD gauge comparison. No dashboard, no database. See `RUNBOOK.md` for the monthly rerun.

Interpreter: `ca_market_reports/run.sh <python args>` (uses the report-repo venv: pandas + openpyxl).
Frozen names: `ca_common.py`. Raw data is read from the gitignored `NewProductCategory/` and
`Amazon_Monthly_Competitor_Report copy/` folders by absolute path; outputs land in `NewProductCategory/<category>/outputs/`.
