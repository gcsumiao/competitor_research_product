#!/usr/bin/env python3
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd


NON_OBD2_ASINS = {
    "B000EW0KHW",  # 3145 Ford Digital OBD1 Code Reader
    "B000EVU8C0",  # 3123 GM OBD1 Code Reader
    "B078BHTCK1",  # 3129 OBD-1 Kit
    "B000EVYH36",  # 3149 Extension Cable for the Ford OBD1 reader
    "B000EW0KJ0",
    "B0BY8QJQ8S",  # Ford Digital OBD1 Code Reader + Extension Cable bundle (analyst directive 2026-11-03)
}

BRAND_ALIASES = {
    "edge": "krazy on highways",
}


FINAL_COLUMNS = [
    "Title",
    "Brand",
    "Fulfillment",
    "BSR",
    "Price",
    "Monthly Sales",
    "Monthly Revenue",
    "Review Count",
    "Reviews Rating",
    "ASIN",
    "Seller",
    "Number of Active Sellers",
    "Best Sales Period",
    "Age (Month)",
    "Number of Images",
    "Variation Count",
    "URL",
    "Type",
]


def _to_num(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype(str).str.replace(r"[^0-9.-]", "", regex=True), errors="coerce").fillna(0)


def _canonicalize_brands(s: pd.Series) -> pd.Series:
    out = s.astype(str).str.lower().str.strip()
    return out.replace(BRAND_ALIASES)


def _prev_month_yyyymm(yyyymm: str) -> str:
    p = pd.Period(yyyymm, freq="M") - 1
    return f"{p.year}{p.month:02d}"


def _read_csv_robust(path: Path) -> pd.DataFrame:
    for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return pd.read_csv(path, encoding=enc, compression="infer")
        except UnicodeDecodeError:
            continue
    return pd.read_csv(path, encoding="cp1252", encoding_errors="replace", compression="infer")


def _load_exports(folder: Path) -> pd.DataFrame:
    if not folder.exists():
        raise SystemExit(f"Missing folder: {folder}")
    dfs: list[pd.DataFrame] = []
    for entry in sorted(folder.iterdir()):
        if not entry.is_file():
            continue
        name = entry.name.lower()
        if not name.endswith(".csv") or name.startswith("._") or name == ".ds_store":
            continue
        if entry.name == "missing-good.csv":
            continue
        try:
            dfs.append(_read_csv_robust(entry))
        except Exception as e:
            raise SystemExit(f"Failed reading export {entry}: {e}") from e
    if not dfs:
        raise SystemExit(f"No CSV exports found in: {folder}")
    return pd.concat(dfs, ignore_index=True)


def _ensure_cols(df: pd.DataFrame, cols: list[str]) -> pd.DataFrame:
    for c in cols:
        if c not in df.columns:
            df[c] = pd.NA
    return df


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Preprocess Helium10 Black Box exports into amazon_obd2_YYYYMM.xlsx.",
    )
    parser.add_argument("--month", required=True, help="YYYYMM, e.g. 202601")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repo root (default: parent of script/).",
    )
    parser.add_argument(
        "--raw-folder",
        type=Path,
        default=None,
        help="Raw exports folder (default: <base>/Amazon_Raw_Data/raw_data/YYYYMM).",
    )
    parser.add_argument(
        "--backup-folder",
        type=Path,
        default=None,
        help="Backup exports folder (default: <base>/Amazon_Raw_Data/backup_data/YYYYMM).",
    )
    parser.add_argument(
        "--missing-good",
        type=Path,
        default=None,
        help="Path to missing-good.csv (default: <backup-folder>/missing-good.csv).",
    )
    parser.add_argument(
        "--spec",
        type=Path,
        default=None,
        help="Path to amazon_scanner_type.xlsx (default: <base>/amazon_scanner_type.xlsx).",
    )
    parser.add_argument(
        "--out-obd2",
        type=Path,
        default=None,
        help="Output amazon_obd2_YYYYMM.xlsx path (default: <base>/amazon_obd2/amazon_obd2_YYYYMM.xlsx).",
    )
    parser.add_argument(
        "--run-dir",
        type=Path,
        default=None,
        help="Folder to write artifacts like missing.xlsx + extra.xlsx (default: <base>/script/runs/YYYYMM).",
    )
    parser.add_argument(
        "--allow-missing",
        action="store_true",
        help="Do not stop if missing ASINs remain (still writes missing.xlsx).",
    )
    parser.add_argument(
        "--allow-extra",
        action="store_true",
        help="Do not stop if extra.xlsx (unknown Type) is generated.",
    )
    args = parser.parse_args()

    month = str(args.month).strip()
    if not (len(month) == 6 and month.isdigit()):
        raise SystemExit("--month must be YYYYMM")

    base_dir: Path = args.base_dir.resolve()
    raw_folder = (args.raw_folder or (base_dir / "Amazon_Raw_Data" / "raw_data" / month)).resolve()
    backup_folder = (args.backup_folder or (base_dir / "Amazon_Raw_Data" / "backup_data" / month)).resolve()
    spec_path = (args.spec or (base_dir / "amazon_scanner_type.xlsx")).resolve()
    out_obd2 = (args.out_obd2 or (base_dir / "amazon_obd2" / f"amazon_obd2_{month}.xlsx")).resolve()
    run_dir = (args.run_dir or (base_dir / "script" / "runs" / month)).resolve()

    run_dir.mkdir(parents=True, exist_ok=True)

    market_raw = _load_exports(raw_folder)
    market_raw = _ensure_cols(
        market_raw,
        [
            "Title",
            "Brand",
            "Fulfillment",
            "BSR",
            "Price",
            "ASIN Sales",
            "ASIN Revenue",
            "Review Count",
            "Reviews Rating",
            "ASIN",
            "Seller",
            "Number of Active Sellers",
            "Best Sales Period",
            "Age (Month)",
            "Number of Images",
            "Variation Count",
            "URL",
        ],
    )
    market_raw["ASIN"] = market_raw["ASIN"].astype(str).str.strip()
    market_raw = market_raw[market_raw["ASIN"].ne("") & market_raw["ASIN"].ne("nan")].copy()

    market_raw["BSR"] = _to_num(market_raw["BSR"])
    market_raw = market_raw.sort_values(["BSR"], ignore_index=True)

    if not spec_path.exists():
        raise SystemExit(f"Missing spec file: {spec_path}")
    spec = pd.read_excel(spec_path, usecols=["ASIN", "Type"], dtype={"ASIN": str})
    spec["ASIN"] = spec["ASIN"].astype(str).str.strip()
    spec = spec.dropna(subset=["ASIN"]).drop_duplicates(subset=["ASIN"], keep="last")

    # Missing handling uses previous month's ASIN list.
    prev_month = _prev_month_yyyymm(month)
    prev_path = base_dir / "amazon_obd2" / f"amazon_obd2_{prev_month}.xlsx"
    missing_path = run_dir / "missing.xlsx"

    missing_asins: set[str] = set()
    if prev_path.exists():
        prev = pd.read_excel(prev_path, dtype={"ASIN": str})
        prev["ASIN"] = prev["ASIN"].astype(str).str.strip()
        prev = prev[prev["ASIN"].ne("") & prev["ASIN"].ne("nan")].copy()
        missing_asins = set(prev["ASIN"]) - set(market_raw["ASIN"])
        if missing_asins:
            if backup_folder.exists():
                backup_raw = _load_exports(backup_folder)
                if "ASIN" in backup_raw.columns:
                    backup_raw["ASIN"] = backup_raw["ASIN"].astype(str).str.strip()
                    backup_raw = backup_raw[backup_raw["ASIN"].isin(missing_asins)].copy()
                    market_raw = pd.concat([market_raw, backup_raw], ignore_index=True, sort=False)

            missing_asins = set(prev["ASIN"]) - set(market_raw["ASIN"])

            missing_good = args.missing_good
            if missing_good is None:
                missing_good = backup_folder / "missing-good.csv"
            missing_good = Path(missing_good).resolve()
            if missing_asins and missing_good.exists():
                mg = pd.read_csv(missing_good, dtype=str)
                if "ASIN" in mg.columns:
                    mg["ASIN"] = mg["ASIN"].astype(str).str.strip()
                    mg = mg[mg["ASIN"].isin(missing_asins)].copy()
                    market_raw = pd.concat([market_raw, mg], ignore_index=True, sort=False)
                missing_asins = set(prev["ASIN"]) - set(market_raw["ASIN"])

            if missing_asins:
                # Write missing.xlsx as the user-facing artifact to fill (SOP step).
                miss = prev[prev["ASIN"].isin(sorted(missing_asins))].copy()
                miss = miss.rename(columns={"Monthly Sales": "ASIN Sales", "Monthly Revenue": "ASIN Revenue"})
                with pd.ExcelWriter(missing_path, engine="openpyxl") as w:
                    miss.to_excel(w, index=False)
                print(f"Wrote {missing_path}")
                print(f"Still missing ASINs after backup/missing-good: {len(missing_asins):,}", file=sys.stderr)
                if not args.allow_missing:
                    print("Stop: fill missing.xlsx -> missing-good.csv and rerun.", file=sys.stderr)
                    return 2

    # Core cleaning / shaping
    market_raw["Brand"] = _canonicalize_brands(market_raw["Brand"])
    market_raw.loc[
        (market_raw["Brand"].eq("innova")) & (market_raw["Seller"].astype(str).str.strip().eq("Romondes")),
        "Brand",
    ] = "innova-ann"

    market_raw = market_raw[~market_raw["ASIN"].isin(NON_OBD2_ASINS)].copy()

    # After concatenating backup/missing-good rows, re-normalize mixed-type columns before sorting/merging.
    market_raw["BSR"] = _to_num(market_raw["BSR"])

    market_raw["ASIN Revenue"] = market_raw["ASIN Revenue"].replace("-", 0)
    market_raw["Monthly Revenue"] = _to_num(market_raw["ASIN Revenue"])
    market_raw["Monthly Sales"] = _to_num(market_raw["ASIN Sales"])

    market_raw["Price"] = _to_num(market_raw["Price"])
    nonzero = market_raw["Monthly Sales"].ne(0)
    market_raw.loc[nonzero, "Price"] = market_raw.loc[nonzero, "Monthly Revenue"] / market_raw.loc[nonzero, "Monthly Sales"]

    market = market_raw.copy()
    # missing-good.csv may carry forward a Type column from last month's amazon_obd2.
    # Merge spec Types without losing the existing column.
    market = market.merge(spec, how="left", on="ASIN", suffixes=("", "_spec"))
    if "Type_spec" in market.columns:
        if "Type" in market.columns:
            market["Type"] = market["Type"].fillna(market["Type_spec"])
        else:
            market["Type"] = market["Type_spec"]
        market = market.drop(columns=["Type_spec"])
    market = market.sort_values(["BSR"], ignore_index=True)
    market = market.drop_duplicates(subset=["ASIN"], keep="first")

    market = _ensure_cols(market, FINAL_COLUMNS)
    market = market[FINAL_COLUMNS].copy()

    out_obd2.parent.mkdir(parents=True, exist_ok=True)
    market.to_excel(out_obd2, index=False)
    print(f"Wrote {out_obd2}")

    # Artifacts
    extra = market[market["Type"].isna() | market["Type"].astype(str).str.strip().eq("")].copy()
    extra_path = run_dir / "extra.xlsx"
    if len(extra):
        cols = ["Title", "Brand", "ASIN", "Price", "URL", "Monthly Revenue"]
        extra = _ensure_cols(extra, cols)[cols].copy()
        with pd.ExcelWriter(extra_path, engine="openpyxl") as w:
            extra.to_excel(w, index=False)
        print(f"Wrote {extra_path} (unknown Type rows: {len(extra):,})")
        if not args.allow_extra:
            print("Stop: update amazon_scanner_type.xlsx with extra.xlsx rows and rerun.", file=sys.stderr)
            return 3

    # Lightweight summary
    units = float(market["Monthly Sales"].sum())
    rev = float((market["Price"] * market["Monthly Sales"]).sum())
    print(f"Totals: units={units:,.0f} revenue={rev:,.2f} asins={market['ASIN'].nunique():,}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
