#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import re
from pathlib import Path

from month_context import MONTHS, MONTH_TO_SHORT, MonthContext, infer_month_context
from report_fill.main import build_report_output
from template_fill.main import build_monthly_output


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_DIR = ROOT / "script output reports"
DEFAULT_RAW_REPORT = DEFAULT_RAW_DIR / "Amazon Competitor Report.xlsx"
DEFAULT_RAW_SUMMARY = DEFAULT_RAW_DIR / "summary.xlsx"


def _parse_month(value: str) -> MonthContext:
    if not re.fullmatch(r"\d{6}", value):
        raise SystemExit(f"Invalid --month {value!r}. Expected YYYYMM.")
    year = int(value[:4])
    month = int(value[4:])
    if month < 1 or month > 12:
        raise SystemExit(f"Invalid --month {value!r}. Expected YYYYMM.")
    month_name = MONTHS[month - 1]
    yy = str(year)[-2:]
    return MonthContext(
        month_name=month_name,
        short_label=f"{MONTH_TO_SHORT[month_name]} '{yy}",
        long_label=f"{month_name} '{yy}",
        year=year,
        month=month,
    )


def _shift_month(context: MonthContext, offset: int) -> MonthContext:
    idx = context.year * 12 + (context.month - 1) + offset
    year = idx // 12
    month = idx % 12 + 1
    return _parse_month(f"{year}{month:02d}")


def _resolve_path(path: Path | None) -> Path | None:
    if path is None:
        return None
    return path.expanduser().resolve() if path.is_absolute() else (ROOT / path).resolve()


def _normalize_date_tag(value: str | None) -> str:
    if value is None:
        return dt.date.today().strftime("%y-%m-%d")
    value = value.strip()
    if re.fullmatch(r"\d{2}-\d{2}-\d{2}", value):
        return value
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return dt.date.fromisoformat(value).strftime("%y-%m-%d")
    raise SystemExit(f"Invalid date tag {value!r}. Expected YY-MM-DD or YYYY-MM-DD.")


def _template_pattern(kind: str, context: MonthContext) -> str:
    if kind == "report":
        return f"*Amazon Competitor Report {context.month_name} Innova Adjusted.xlsx"
    if kind == "analysis":
        return f"*Amazon Competitor Analysis {context.month_name}.xlsx"
    raise ValueError(kind)


def _find_previous_template(kind: str, context: MonthContext) -> Path:
    previous = _shift_month(context, -1)
    folder = ROOT / previous.output_folder_name
    pattern = _template_pattern(kind, previous)
    candidates = [
        path
        for path in folder.glob(pattern)
        if path.is_file() and not path.name.startswith("~$")
    ]
    if not candidates:
        raise SystemExit(
            "Could not auto-detect previous-month "
            f"{kind} template in {folder} with pattern {pattern!r}. "
            f"Pass --template-{kind} explicitly."
        )
    return max(candidates, key=lambda path: (path.stat().st_mtime, path.name)).resolve()


def _resolve_context(raw_report: Path, requested_month: str | None) -> MonthContext:
    raw_context = infer_month_context(raw_report)
    if requested_month is None:
        return raw_context
    requested_context = _parse_month(requested_month)
    if (raw_context.year, raw_context.month) != (requested_context.year, requested_context.month):
        raise SystemExit(
            "Raw report month does not match --month: "
            f"raw={raw_context.year}{raw_context.month:02d}, requested={requested_month}"
        )
    return requested_context


def _check_output_path(path: Path, *, overwrite: bool) -> None:
    if path.exists() and not overwrite:
        raise SystemExit(
            f"Output already exists: {path}\n"
            "Pass --overwrite-final to replace existing final workbook files."
        )


def build_final_outputs(
    *,
    month: str | None,
    raw_report: Path,
    raw_summary: Path,
    template_report: Path | None,
    template_analysis: Path | None,
    out_dir: Path | None,
    date_tag: str,
    brand_header_dir: Path | None,
    overwrite_final: bool,
) -> tuple[Path, Path]:
    if not raw_report.exists():
        raise SystemExit(f"Missing raw report: {raw_report}")
    if not raw_summary.exists():
        raise SystemExit(f"Missing raw summary: {raw_summary}")

    context = _resolve_context(raw_report, month)
    out_dir = out_dir or (ROOT / context.output_folder_name)
    template_report = template_report or _find_previous_template("report", context)
    template_analysis = template_analysis or _find_previous_template("analysis", context)

    if not template_report.exists():
        raise SystemExit(f"Missing report template: {template_report}")
    if not template_analysis.exists():
        raise SystemExit(f"Missing analysis template: {template_analysis}")

    report_name = f"{date_tag}Amazon Competitor Report {context.month_name} Innova Adjusted.xlsx"
    analysis_name = context.analysis_output_name(date_tag)
    report_out = out_dir / report_name
    analysis_out = out_dir / analysis_name
    _check_output_path(report_out, overwrite=overwrite_final)
    _check_output_path(analysis_out, overwrite=overwrite_final)

    print("[info] Final formatter inputs:")
    print(f"  raw_report: {raw_report}")
    print(f"  raw_summary: {raw_summary}")
    print(f"  template_report: {template_report}")
    print(f"  template_analysis: {template_analysis}")
    print(f"  out_dir: {out_dir}")

    # Build analysis first because the chart XML patchers register namespaces process-wide.
    # Saving the chart-heavy analysis workbook before the report prevents namespace bleed
    # from another workbook patch from affecting openpyxl drawing serialization.
    analysis_path = build_monthly_output(
        month_label=context.short_label,
        month_name=context.month_name,
        date_tag=date_tag,
        template=template_analysis,
        raw_summary=raw_summary,
        raw_report=raw_report,
        out_dir=out_dir,
        brand_header_dir=brand_header_dir,
    )
    report_path = build_report_output(
        template=template_report,
        raw_report=raw_report,
        raw_summary=raw_summary,
        out_dir=out_dir,
        output_name=report_name,
        brand_header_dir=brand_header_dir,
    )
    return report_path, analysis_path


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Build the two final formatted Amazon competitor workbooks from raw monthly outputs."
    )
    parser.add_argument("--month", default=None, help="Report month in YYYYMM. Defaults to the raw report title.")
    parser.add_argument("--raw-report", type=Path, default=DEFAULT_RAW_REPORT)
    parser.add_argument("--raw-summary", type=Path, default=DEFAULT_RAW_SUMMARY)
    parser.add_argument("--template-report", type=Path, default=None)
    parser.add_argument("--template-analysis", type=Path, default=None)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--date-tag", default=None, help="Output filename date tag, YY-MM-DD or YYYY-MM-DD. Defaults to today.")
    parser.add_argument("--run-date", default=None, help="Alias for --date-tag for older runbooks.")
    parser.add_argument("--brand-header-dir", type=Path, default=None)
    parser.add_argument(
        "--overwrite-final",
        action="store_true",
        help="Replace existing final workbook files. Default: fail if outputs already exist.",
    )
    args = parser.parse_args()

    if args.date_tag and args.run_date:
        raise SystemExit("Use only one of --date-tag or --run-date.")

    report_path, analysis_path = build_final_outputs(
        month=args.month,
        raw_report=_resolve_path(args.raw_report),
        raw_summary=_resolve_path(args.raw_summary),
        template_report=_resolve_path(args.template_report),
        template_analysis=_resolve_path(args.template_analysis),
        out_dir=_resolve_path(args.out_dir),
        date_tag=_normalize_date_tag(args.date_tag or args.run_date),
        brand_header_dir=_resolve_path(args.brand_header_dir),
        overwrite_final=args.overwrite_final,
    )
    print("[ok] Wrote final formatted outputs:")
    print(f"  - {report_path}")
    print(f"  - {analysis_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
