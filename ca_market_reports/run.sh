#!/usr/bin/env bash
# Runs a module/script of ca_market_reports with the report-repo venv (pandas + openpyxl).
# Usage: ca_market_reports/run.sh <python args...>   e.g. run.sh -m unittest discover -s ca_market_reports/tests -v
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$HERE/.." && pwd)"
VENV_PY="${CA_REPORTS_PYTHON:-/Users/sumiaoc/competitor_research_product/Amazon_Monthly_Competitor_Report copy/.venv/bin/python}"
if [[ ! -x "$VENV_PY" ]]; then
  echo "run.sh: interpreter not found: $VENV_PY" >&2
  echo "create one: uv venv .venv && uv pip install -r ca_market_reports/requirements.txt ; then export CA_REPORTS_PYTHON=\$PWD/.venv/bin/python" >&2
  exit 2
fi
cd "$REPO_ROOT"
export PYTHONPATH="$REPO_ROOT${PYTHONPATH:+:$PYTHONPATH}"
exec "$VENV_PY" "$@"
