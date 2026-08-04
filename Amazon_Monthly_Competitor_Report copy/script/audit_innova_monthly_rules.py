#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from full_report_month import (
    _aggregate_actual_by_asin,
    _clean_asin,
    _innova_3p_non_code_exclusion_map,
    _is_innova_code_reader_actual,
    _read_innova1p,
    _read_innova3p,
    _to_number,
)
from preprocess_month import NON_OBD2_ASINS


def _load_actual(path: Path, reader) -> pd.DataFrame:
    if not path.exists():
        raise SystemExit(f"Missing required Innova actual file: {path}")
    try:
        return _aggregate_actual_by_asin(reader(path))
    except Exception as exc:
        raise SystemExit(f"Failed reading Innova actual file {path}: {exc}") from exc


def _first_nonblank(values: pd.Series) -> str:
    for value in values:
        if pd.notna(value) and str(value).strip():
            return str(value).strip()
    return ""


def _raw_innova_rows(market: pd.DataFrame) -> pd.DataFrame:
    required = {"ASIN", "Brand"}
    missing = sorted(required - set(market.columns))
    if missing:
        raise SystemExit(f"amazon_obd2 file missing required columns: {', '.join(missing)}")

    out = market.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    out["Brand"] = out["Brand"].astype(str).str.lower().str.strip()
    out = out[out["ASIN"].map(lambda v: str(v).strip() != "" and str(v).strip().lower() != "nan")].copy()

    for col in ["Title", "Monthly Sales", "Monthly Revenue", "Price", "Type", "URL"]:
        if col not in out.columns:
            out[col] = pd.NA
    out["Raw Monthly Sales"] = _to_number(out["Monthly Sales"])
    out["Raw Monthly Revenue"] = _to_number(out["Monthly Revenue"])
    raw = out[out["Brand"].eq("innova")].copy()
    if raw.empty:
        return pd.DataFrame(
            columns=[
                "ASIN",
                "Raw Title",
                "Raw Monthly Sales",
                "Raw Monthly Revenue",
                "Raw Price",
                "Raw Type",
                "Raw URL",
            ]
        )
    return (
        raw.groupby("ASIN", as_index=False)
        .agg(
            Raw_Title=("Title", _first_nonblank),
            Raw_Monthly_Sales=("Raw Monthly Sales", "sum"),
            Raw_Monthly_Revenue=("Raw Monthly Revenue", "sum"),
            Raw_Price=("Price", _first_nonblank),
            Raw_Type=("Type", _first_nonblank),
            Raw_URL=("URL", _first_nonblank),
        )
        .rename(
            columns={
                "Raw_Title": "Raw Title",
                "Raw_Monthly_Sales": "Raw Monthly Sales",
                "Raw_Monthly_Revenue": "Raw Monthly Revenue",
                "Raw_Price": "Raw Price",
                "Raw_Type": "Raw Type",
                "Raw_URL": "Raw URL",
            }
        )
    )


def _actual_rows(actual: pd.DataFrame, prefix: str) -> pd.DataFrame:
    out = actual.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    return out.rename(
        columns={
            "Title": f"{prefix} Title",
            "Monthly Sales": f"{prefix} Monthly Sales",
            "Monthly Revenue": f"{prefix} Monthly Revenue",
        }
    )


def _classify(row: pd.Series) -> str:
    if bool(row["Innova 3P Non-Code Excluded"]):
        return "excluded_innova_3p_non_code"
    if bool(row["NON_OBD2_ASIN"]) and (bool(row["Innova 1P Actual Present"]) or bool(row["Innova 3P Actual Present"])):
        return "excluded_non_obd2_asin"
    raw = bool(row["Raw Innova Present"])
    one_p = bool(row["Effective 1P Actual Present"])
    three_p = bool(row["Effective 3P Actual Present"])
    one_p_code_reader = bool(row["1P Actual Code Reader/OBD Title"])
    if raw and (one_p or three_p):
        return "raw_innova_overlap_actual_values_used"
    if raw:
        return "raw_innova_retained_no_actual"
    if one_p and three_p:
        return "actual_1p_3p_appended"
    if three_p:
        return "actual_3p_only_appended"
    if one_p and one_p_code_reader:
        return "actual_1p_only_code_reader_appended"
    if one_p:
        return "actual_1p_only_excluded"
    return "not_applicable"


def build_audit(base_dir: Path, month: str) -> pd.DataFrame:
    market_path = base_dir / "amazon_obd2" / f"amazon_obd2_{month}.xlsx"
    if not market_path.exists():
        raise SystemExit(f"Missing amazon_obd2 file: {market_path}")
    try:
        market = pd.read_excel(market_path, dtype={"ASIN": str})
    except Exception as exc:
        raise SystemExit(f"Failed reading amazon_obd2 file {market_path}: {exc}") from exc

    actual_dir = base_dir / "innova_actual_data"
    one_p = _load_actual(actual_dir / f"innova1p_{month}.csv", _read_innova1p)
    three_p = _load_actual(actual_dir / f"innova3p_{month}.csv", _read_innova3p)
    three_p_exclusions = _innova_3p_non_code_exclusion_map(three_p, month)
    raw = _raw_innova_rows(market)

    one_p = _actual_rows(one_p, "1P")
    three_p = _actual_rows(three_p, "3P")
    all_asins = sorted(set(raw["ASIN"]) | set(one_p["ASIN"]) | set(three_p["ASIN"]))
    audit = pd.DataFrame({"ASIN": all_asins})
    audit = audit.merge(raw, how="left", on="ASIN")
    audit = audit.merge(one_p, how="left", on="ASIN")
    audit = audit.merge(three_p, how="left", on="ASIN")

    audit["Raw Innova Present"] = audit["Raw Title"].notna()
    audit["Innova 1P Actual Present"] = audit["1P Title"].notna() | audit["1P Monthly Sales"].notna() | audit["1P Monthly Revenue"].notna()
    audit["Innova 3P Actual Present"] = audit["3P Title"].notna() | audit["3P Monthly Sales"].notna() | audit["3P Monthly Revenue"].notna()
    audit["NON_OBD2_ASIN"] = audit["ASIN"].isin(NON_OBD2_ASINS)
    audit["Innova 3P Excluded Product Family"] = audit["ASIN"].map(
        {asin: family for asin, (family, _reason) in three_p_exclusions.items()}
    )
    audit["Exclusion Reason"] = audit["ASIN"].map(
        {asin: reason for asin, (_family, reason) in three_p_exclusions.items()}
    )
    audit["Innova 3P Non-Code Excluded"] = audit["ASIN"].isin(three_p_exclusions)
    audit["1P Actual Code Reader/OBD Title"] = audit["1P Title"].map(_is_innova_code_reader_actual)
    audit["Effective 1P Actual Present"] = (
        audit["Innova 1P Actual Present"] & audit["1P Actual Code Reader/OBD Title"] & ~audit["NON_OBD2_ASIN"]
    )
    audit["Effective 3P Actual Present"] = (
        audit["Innova 3P Actual Present"]
        & ~audit["NON_OBD2_ASIN"]
        & ~audit["Innova 3P Non-Code Excluded"]
    )
    audit["Rule Action"] = audit.apply(_classify, axis=1)
    audit["Will Appear In Innova Sheet"] = audit["Rule Action"].isin(
        [
            "raw_innova_overlap_actual_values_used",
            "raw_innova_retained_no_actual",
            "actual_1p_3p_appended",
            "actual_3p_only_appended",
            "actual_1p_only_code_reader_appended",
        ]
    )
    audit["Current Month Values Source"] = audit["Rule Action"].map(
        {
            "raw_innova_overlap_actual_values_used": "actual",
            "raw_innova_retained_no_actual": "raw",
            "actual_1p_3p_appended": "1p+3p_actual",
            "actual_3p_only_appended": "3p_actual",
            "actual_1p_only_code_reader_appended": "1p_actual",
            "actual_1p_only_excluded": "excluded",
            "excluded_non_obd2_asin": "excluded",
            "excluded_innova_3p_non_code": "excluded",
        }
    )

    return audit[
        [
            "ASIN",
            "Rule Action",
            "Will Appear In Innova Sheet",
            "Current Month Values Source",
            "NON_OBD2_ASIN",
            "Innova 3P Non-Code Excluded",
            "Innova 3P Excluded Product Family",
            "Exclusion Reason",
            "Raw Innova Present",
            "Innova 1P Actual Present",
            "Innova 3P Actual Present",
            "Effective 1P Actual Present",
            "Effective 3P Actual Present",
            "1P Actual Code Reader/OBD Title",
            "Raw Title",
            "Raw Monthly Sales",
            "Raw Monthly Revenue",
            "Raw Price",
            "Raw Type",
            "1P Title",
            "1P Monthly Sales",
            "1P Monthly Revenue",
            "3P Title",
            "3P Monthly Sales",
            "3P Monthly Revenue",
            "Raw URL",
        ]
    ].sort_values(["Rule Action", "ASIN"], ignore_index=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit monthly Innova raw/actual inclusion rules.")
    parser.add_argument("--month", required=True, help="YYYYMM, e.g. 202606")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repo root (default: parent of script/).",
    )
    parser.add_argument("--out-csv", type=Path, default=None, help="Optional output CSV path.")
    parser.add_argument("--out-xlsx", type=Path, default=None, help="Optional output XLSX path.")
    args = parser.parse_args()

    month = str(args.month).strip()
    if not (len(month) == 6 and month.isdigit()):
        raise SystemExit("--month must be YYYYMM")

    base_dir = args.base_dir.resolve()
    run_dir = base_dir / "script" / "runs" / month
    run_dir.mkdir(parents=True, exist_ok=True)
    out_csv = (args.out_csv or (run_dir / "innova_monthly_rules_audit.csv")).resolve()
    out_xlsx = (args.out_xlsx or (run_dir / "innova_monthly_rules_audit.xlsx")).resolve()

    audit = build_audit(base_dir, month)
    out_csv.parent.mkdir(parents=True, exist_ok=True)
    audit.to_csv(out_csv, index=False)
    with pd.ExcelWriter(out_xlsx, engine="openpyxl") as writer:
        audit.to_excel(writer, sheet_name="audit", index=False)

    counts = audit["Rule Action"].value_counts().to_dict()
    print(f"Wrote {out_csv} ({len(audit)} rows)")
    print(f"Wrote {out_xlsx} ({len(audit)} rows)")
    print("Rule action counts:")
    for key in sorted(counts):
        print(f"  - {key}: {counts[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
