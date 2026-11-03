#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

from openpyxl import load_workbook

from month_context import infer_month_context, validate_month_headers
from report_fill.main import _read_workbook, validate_output_file as validate_report_file
from report_fill.main import validate_report_workbook
from template_fill.validate import validate_output_file as validate_analysis_file
from template_fill.validate import validate_workbook as validate_analysis_workbook


ERROR_TOKENS = ("#REF!", "#DIV/0!", "#VALUE!", "#NAME?", "#N/A", "#NUM!", "#NULL!")
EXCLUDED_ASINS = {"B000EVYGZA", "B000KIMHRQ", "B082JCSB4Z", "B0FDLVW4G8"}
KEPT_ASIN = "B09ZQ3ZQV2"


def _scan_workbook(path: Path) -> tuple[int, list[str], dict[str, list[str]]]:
    formula_wb = load_workbook(path, read_only=False, data_only=False)
    value_wb = load_workbook(path, read_only=False, data_only=True)
    formula_count = 0
    errors: list[str] = []
    hits = {asin: [] for asin in EXCLUDED_ASINS | {KEPT_ASIN}}
    try:
        for formula_ws in formula_wb.worksheets:
            value_ws = value_wb[formula_ws.title]
            for row in formula_ws.iter_rows():
                for cell in row:
                    raw = cell.value
                    text = "" if raw is None else str(raw)
                    if text in hits:
                        hits[text].append(f"{formula_ws.title}!{cell.coordinate}")
                    if cell.data_type == "f" or text.startswith("="):
                        formula_count += 1
                        upper_formula = text.upper()
                        if any(token in upper_formula for token in ERROR_TOKENS):
                            errors.append(f"{formula_ws.title}!{cell.coordinate} formula={text}")
                        cached = value_ws[cell.coordinate]
                        cached_text = "" if cached.value is None else str(cached.value).upper()
                        if cached.data_type == "e" or any(token in cached_text for token in ERROR_TOKENS):
                            errors.append(f"{formula_ws.title}!{cell.coordinate} cached={cached.value}")
                    elif cell.data_type == "e" or any(token == text.upper() for token in ERROR_TOKENS):
                        errors.append(f"{formula_ws.title}!{cell.coordinate} value={raw}")
    finally:
        formula_wb.close()
        value_wb.close()
    return formula_count, errors, hits


def main() -> int:
    parser = argparse.ArgumentParser(description="Post-Excel QA for final monthly report workbooks.")
    parser.add_argument("--report", type=Path, required=True)
    parser.add_argument("--analysis", type=Path, required=True)
    parser.add_argument("--raw-report", type=Path, required=True)
    args = parser.parse_args()

    report_path = args.report.resolve()
    analysis_path = args.analysis.resolve()
    raw_report_path = args.raw_report.resolve()
    issues: list[str] = []

    raw_wb = load_workbook(raw_report_path, read_only=False, data_only=True)
    report_wb = load_workbook(report_path, read_only=False, data_only=False)
    try:
        raw = _read_workbook(raw_wb)
        report_issues = validate_report_workbook(report_wb, raw)
        validate_month_headers(report_wb, infer_month_context(raw_report_path), report_issues)
        issues.extend(f"report: {item}" for item in report_issues)
    finally:
        raw_wb.close()
        report_wb.close()
    issues.extend(f"report file: {item}" for item in validate_report_file(report_path))

    analysis_wb = load_workbook(analysis_path, read_only=False, data_only=False)
    try:
        analysis_issues = validate_analysis_workbook(analysis_wb)
        validate_month_headers(analysis_wb, infer_month_context(raw_report_path), analysis_issues)
        issues.extend(f"analysis: {item}" for item in analysis_issues)
    finally:
        analysis_wb.close()
    issues.extend(f"analysis file: {item}" for item in validate_analysis_file(analysis_path))

    scan_results = {}
    for label, path in (("report", report_path), ("analysis", analysis_path)):
        formula_count, errors, hits = _scan_workbook(path)
        scan_results[label] = {"formula_count": formula_count, "hits": hits}
        issues.extend(f"{label}: {item}" for item in errors)
        for asin in EXCLUDED_ASINS:
            if hits[asin]:
                issues.append(f"{label}: excluded ASIN {asin} found at {', '.join(hits[asin])}")

    if not scan_results["report"]["hits"][KEPT_ASIN]:
        issues.append(f"report: retained ASIN {KEPT_ASIN} was not found")

    lock_files = sorted({*report_path.parent.glob("~$*"), *analysis_path.parent.glob("~$*")})
    if lock_files:
        issues.append("Excel lock files remain: " + ", ".join(str(path) for path in lock_files))

    if issues:
        raise SystemExit("Post-Excel workbook QA failed:\n- " + "\n- ".join(issues))

    print("Post-Excel workbook QA passed")
    print(f"report formulas scanned: {scan_results['report']['formula_count']:,}")
    print(f"analysis formulas scanned: {scan_results['analysis']['formula_count']:,}")
    print(f"retained ASIN {KEPT_ASIN} locations: {len(scan_results['report']['hits'][KEPT_ASIN]):,}")
    print("excluded ASIN hits: 0")
    print("formula/value error tokens: 0")
    print("Excel lock files: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
