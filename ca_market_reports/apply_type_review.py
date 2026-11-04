"""Append reviewed Types from a type_review CSV to the human override map (maps/ca_type_overrides.csv).

Usage:
  ca_market_reports/run.sh -m ca_market_reports.apply_type_review --review runs/202609/type_review_CA_code_reader_202609.csv \
      --decided-by ginny [--month 202609] [--overrides ca_market_reports/maps/ca_type_overrides.csv]

Rows with an empty reviewed_type are skipped. Every non-empty reviewed_type must be in TYPES (otherwise nothing is
appended and the command exits 2). An ASIN that already has an override row with the same decided_month and a
DIFFERENT type is refused (counted as a conflict, exit 1); one with the same decided_month and the same type is already
recorded and is not appended again. Prints `appended=<n> skipped_blank=<n> conflicts=<n>`.
"""
from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path

import pandas as pd

from ca_market_reports.ca_common import ASIN_RE, MAPS_DIR, MONTH_RE, TYPE_OVERRIDES_COLUMNS, TYPE_REVIEW_COLUMNS, TYPES

_MONTH_IN_NAME = re.compile(r"_(\d{6})\.csv$")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--review", required=True, type=Path, help="type_review_<scope>_<YYYYMM>.csv with reviewed_type filled")
    ap.add_argument("--decided-by", required=True, help="name recorded in decided_by")
    ap.add_argument("--month", help="decided_month YYYYMM (default: parsed from the review file name)")
    ap.add_argument("--overrides", type=Path, default=MAPS_DIR / "ca_type_overrides.csv")
    args = ap.parse_args(argv)

    month = args.month
    if month is None:
        m = _MONTH_IN_NAME.search(args.review.name)
        if not m:
            ap.error(f"--month not given and no _YYYYMM.csv suffix in {args.review.name}")
        month = m.group(1)
    if not MONTH_RE.match(month):
        ap.error(f"bad month {month!r} (want YYYYMM)")
    if not args.decided_by.strip():
        ap.error("--decided-by must not be empty")
    if not args.review.exists():
        ap.error(f"review file not found: {args.review}")
    if not args.overrides.exists():
        ap.error(f"override map not found: {args.overrides}")

    review = pd.read_csv(args.review, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    missing = [c for c in TYPE_REVIEW_COLUMNS if c not in review.columns]
    if missing:
        ap.error(f"{args.review.name}: missing column(s) {missing}")
    overrides = pd.read_csv(args.overrides, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    if tuple(overrides.columns) != TYPE_OVERRIDES_COLUMNS:
        ap.error(f"{args.overrides.name}: columns {list(overrides.columns)} != {list(TYPE_OVERRIDES_COLUMNS)}")

    # validate everything before appending anything
    picked: list[tuple[str, str]] = []
    skipped_blank = 0
    for i, row in review.iterrows():
        reviewed = row["reviewed_type"].strip()
        if not reviewed:
            skipped_blank += 1
            continue
        asin = row["asin"].strip().upper()
        if not ASIN_RE.match(asin):
            ap.error(f"{args.review.name}: data row {i}: bad ASIN {row['asin']!r}")
        if reviewed not in TYPES:
            ap.error(f"{args.review.name}: data row {i} ({asin}): reviewed_type {reviewed!r} not in {TYPES}")
        picked.append((asin, reviewed))

    same_month = {}
    for a, t, dm in zip(overrides["asin"].str.strip().str.upper(), overrides["type"].str.strip(), overrides["decided_month"].str.strip()):
        if dm == month:
            same_month.setdefault(a, set()).add(t)

    to_append: list[dict] = []
    conflicts = 0
    for asin, typ in picked:
        existing = same_month.get(asin, set())
        if existing - {typ}:
            conflicts += 1
            print(f"conflict: {asin} already has decided_month={month} type(s) {sorted(existing)}; refusing {typ!r}", file=sys.stderr)
            continue
        if typ in existing:
            continue        # already recorded (idempotent rerun)
        to_append.append({"asin": asin, "type": typ, "reason": f"manual review {month}", "decided_by": args.decided_by.strip(),
                          "decided_month": month})
        same_month.setdefault(asin, set()).add(typ)

    if to_append:
        text = args.overrides.read_text(encoding="utf-8-sig")
        with open(args.overrides, "a", newline="", encoding="utf-8") as fh:
            if text and not text.endswith("\n"):
                fh.write("\n")
            w = csv.DictWriter(fh, fieldnames=list(TYPE_OVERRIDES_COLUMNS), lineterminator="\n")
            w.writerows(to_append)
    print(f"appended={len(to_append)} skipped_blank={skipped_blank} conflicts={conflicts}")
    return 1 if conflicts else 0


if __name__ == "__main__":
    sys.exit(main())
