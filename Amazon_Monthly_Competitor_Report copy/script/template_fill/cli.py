from __future__ import annotations

import argparse
from pathlib import Path

from .config import DEFAULT_RAW_REPORT, DEFAULT_RAW_SUMMARY, ROOT, STAGING_TEMPLATE
from .main import build_monthly_output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build an 8-brand Analysis workbook from raw monthly outputs.")
    parser.add_argument("--month-label", default=None, help='Short report label, e.g. "Apr \'26". Defaults to raw Summary title.')
    parser.add_argument("--month-name", default=None, help="Long month name for output file, e.g. April. Defaults to raw Summary title.")
    parser.add_argument("--date-tag", required=True, help="Output date tag, e.g. 26-05-06.")
    parser.add_argument("--template", type=Path, default=STAGING_TEMPLATE)
    parser.add_argument("--raw-summary", type=Path, default=DEFAULT_RAW_SUMMARY)
    parser.add_argument("--raw-report", type=Path, default=DEFAULT_RAW_REPORT)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--brand-header-dir", type=Path, default=None)
    args = parser.parse_args()

    def resolve(path: Path | None) -> Path | None:
        if path is None:
            return None
        return path if path.is_absolute() else ROOT / path

    out = build_monthly_output(
        month_label=args.month_label,
        month_name=args.month_name,
        date_tag=args.date_tag,
        template=resolve(args.template),
        raw_summary=resolve(args.raw_summary),
        raw_report=resolve(args.raw_report),
        out_dir=resolve(args.out_dir),
        brand_header_dir=resolve(args.brand_header_dir),
    )
    print(out)


if __name__ == "__main__":
    main()
