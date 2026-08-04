#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd

try:
    from preprocess_month import NON_OBD2_ASINS
except ImportError:
    NON_OBD2_ASINS = {
        "B000EW0KHW",
        "B000EVU8C0",
        "B078BHTCK1",
        "B000EVYH36",
        "B000EW0KJ0",
    }

TOP50_EXCLUDED_ASINS_BY_MONTH = {"202604": {"B000EVYGV4"}}
TOP50_EXCLUDED_ASINS_FROM_MONTH = {"202605": {"B000EVYGV4"}}
BRAND_ALIASES = {
    "edge": "krazy on highways",
}
INNOVA_RULE_RAW_PLUS_3P_ACTUAL_ONLY = "raw-plus-3p-actual-only"
INNOVA_RULE_RAW_PLUS_ACTUAL_OBD = "raw-plus-actual-obd"
INNOVA_RAW_PRESENT_COL = "_Innova Raw Present"
INNOVA_ADDED_1P_COL = "_Innova Added From 1P Actual OBD"
INNOVA_ADDED_3P_COL = "_Innova Added From 3P Actual"
INNOVA_EFFECTIVE_1P_COL = "_Innova Effective 1P Actual"
INNOVA_EFFECTIVE_3P_COL = "_Innova Effective 3P Actual"
CARRYOVER_ZERO_COL = "_Carryover Zero"
INNOVA_3P_NON_CODE_EXCLUSION_START_MONTH = "202607"
INNOVA_3P_EXCLUDED_FAMILY_DIGITAL_MULTIMETER = "Digital Multimeter"
INNOVA_3P_EXCLUDED_FAMILY_THERMAL = "Thermal Imager/Thermal Camera"
INNOVA_3P_EXCLUDED_FAMILY_BORESCOPE = "Borescope/Inspection Camera"


def _yyyymm_history(end_month: str, periods: int = 13) -> list[str]:
    end_date = pd.Period(end_month, freq="M").to_timestamp(how="end")
    return pd.date_range(end=end_date, periods=periods, freq="ME").strftime("%Y%m").tolist()


def _clean_asin(s: pd.Series) -> pd.Series:
    return s.astype(str).str.strip()


def _canonicalize_brand_series(s: pd.Series) -> pd.Series:
    out = s.astype(str).str.lower().str.strip()
    return out.replace(BRAND_ALIASES)


def _canonicalize_market_brands(df: pd.DataFrame) -> pd.DataFrame:
    if "Brand" not in df.columns:
        return df
    out = df.copy()
    out["Brand"] = _canonicalize_brand_series(out["Brand"])
    return out


def _filter_asins(df: pd.DataFrame, excluded_asins: set[str]) -> pd.DataFrame:
    if df.empty or "ASIN" not in df.columns:
        return df
    out = df.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    return out[~out["ASIN"].isin(excluded_asins)].copy()


def _top50_excluded_asins_for_month(month: str) -> set[str]:
    excluded = set(TOP50_EXCLUDED_ASINS_BY_MONTH.get(month, set()))
    for start_month, asins in TOP50_EXCLUDED_ASINS_FROM_MONTH.items():
        if month >= start_month:
            excluded.update(asins)
    return excluded


def _filter_top50_excluded_asins(df: pd.DataFrame, month: str) -> pd.DataFrame:
    return _filter_asins(df, _top50_excluded_asins_for_month(month))


def _carryover_zero_mask(df: pd.DataFrame) -> pd.Series:
    if CARRYOVER_ZERO_COL not in df.columns:
        return pd.Series(False, index=df.index)
    values = df[CARRYOVER_ZERO_COL]
    if values.dtype == bool:
        return values.fillna(False)
    return values.astype(str).str.lower().str.strip().isin({"true", "1", "yes", "y"})


def _to_number(s: pd.Series) -> pd.Series:
    return pd.to_numeric(s.astype(str).str.replace(r"[^0-9.-]", "", regex=True), errors="coerce")


def _is_valid_asin_value(v) -> bool:
    if pd.isna(v):
        return False
    s = str(v).strip()
    return s != "" and s.lower() != "nan"


def _clean_actual_df(df: pd.DataFrame) -> pd.DataFrame:
    out = df.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    out = out[out["ASIN"].map(_is_valid_asin_value)].copy()
    out["Monthly Sales"] = _to_number(out["Monthly Sales"])
    out["Monthly Revenue"] = _to_number(out["Monthly Revenue"])
    if "Title" not in out.columns:
        out["Title"] = np.nan
    return out


def _aggregate_actual_by_asin(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["ASIN", "Monthly Sales", "Monthly Revenue", "Title"])
    out = (
        df.groupby("ASIN", as_index=False)
        .agg(
            Monthly_Sales=("Monthly Sales", "sum"),
            Monthly_Revenue=("Monthly Revenue", "sum"),
            Title=("Title", "first"),
        )
        .rename(columns={"Monthly_Sales": "Monthly Sales", "Monthly_Revenue": "Monthly Revenue"})
    )
    return out


def _build_innova_actual_helper(actual_1p: pd.DataFrame, actual_3p: pd.DataFrame) -> pd.DataFrame:
    actual_1p = actual_1p.copy()
    actual_3p = actual_3p.copy()
    if not actual_1p.empty:
        actual_1p["ASIN"] = _clean_asin(actual_1p["ASIN"])
    if not actual_3p.empty:
        actual_3p["ASIN"] = _clean_asin(actual_3p["ASIN"])

    actual_1p_effective_asins: set[str] = set()
    if not actual_1p.empty:
        actual_1p_effective_asins = set(
            actual_1p.loc[actual_1p["Title"].map(_is_innova_code_reader_actual), "ASIN"].dropna().unique().tolist()
        )
        actual_1p = actual_1p[actual_1p["ASIN"].isin(actual_1p_effective_asins)].copy()

    combined = _aggregate_actual_by_asin(pd.concat([actual_1p, actual_3p], ignore_index=True))
    if combined.empty:
        combined["Has 1P Actual"] = False
        combined["Has 3P Actual"] = False
        return combined

    combined["ASIN"] = _clean_asin(combined["ASIN"])
    actual_1p_asins = actual_1p_effective_asins
    actual_3p_asins = set(actual_3p["ASIN"].dropna().unique().tolist()) if not actual_3p.empty else set()
    combined["Has 1P Actual"] = combined["ASIN"].isin(actual_1p_asins)
    combined["Has 3P Actual"] = combined["ASIN"].isin(actual_3p_asins)
    return combined


def _to_number_value(v) -> float:
    return pd.to_numeric(pd.Series([v]).astype(str).str.replace(r"[^0-9.-]", "", regex=True), errors="coerce").iloc[0]


def _normalize_key(v) -> str:
    return str(v).strip().lower()


def _rolling_month_labels(end_month: str, periods: int = 12) -> list[str]:
    end = pd.Period(end_month, freq="M")
    return [(end - (periods - 1 - i)).strftime("%B '%y") for i in range(periods)]


def _find_reference_rolling_report(base_dir: Path, month: str) -> Path | None:
    prev = pd.Period(month, freq="M") - 1
    folder = base_dir / f"{prev.strftime('%y-%m')}-reports"
    if not folder.exists():
        return None
    pattern = f"*Amazon Competitor Report {prev.strftime('%B')} Innova Adjusted.xlsx"
    candidates = sorted(
        p for p in folder.glob(pattern) if p.is_file() and not p.name.startswith("._") and not p.name.startswith("~$")
    )
    return candidates[-1] if candidates else None


def _parse_reference_rolling_block(df: pd.DataFrame, header_row: int) -> dict[str, dict[str, float]]:
    headers = df.iloc[header_row].tolist()
    month_cols: list[tuple[int, str]] = []
    for col in range(1, len(headers)):
        raw = headers[col]
        text = "" if pd.isna(raw) else str(raw).strip()
        if not text:
            continue
        if _normalize_key(text).startswith("grand total"):
            break
        month_cols.append((col, text))

    rows: dict[str, dict[str, float]] = {}
    for row in range(header_row + 1, len(df)):
        brand_raw = df.iat[row, 0]
        if pd.isna(brand_raw) or str(brand_raw).strip() == "":
            break
        brand_key = _normalize_key(brand_raw)
        values: dict[str, float] = {}
        for col, label in month_cols:
            value = _to_number_value(df.iat[row, col])
            if not pd.isna(value):
                values[label] = float(value)
        rows[brand_key] = values
    return rows


def _load_reference_rolling_tables(reference_report: Path | None) -> tuple[dict[str, dict[str, float]], dict[str, dict[str, float]]]:
    if reference_report is None or not reference_report.exists():
        return {}, {}
    df = pd.read_excel(reference_report, sheet_name="Rolling 12 mo", header=None, engine="openpyxl")
    brand_header_rows = [i for i, v in enumerate(df.iloc[:, 0].tolist()) if _normalize_key(v) == "brand"]
    if len(brand_header_rows) < 2:
        return {}, {}
    rev_rows = _parse_reference_rolling_block(df, brand_header_rows[0])
    unit_rows = _parse_reference_rolling_block(df, brand_header_rows[1])
    return rev_rows, unit_rows


def _overlay_reference_rolling_history(
    rolling_export: pd.DataFrame,
    *,
    month: str,
    rolling_revenue_cols: list[str],
    rolling_unit_cols: list[str],
    reference_rev_rows: dict[str, dict[str, float]],
    reference_unit_rows: dict[str, dict[str, float]],
) -> pd.DataFrame:
    if rolling_export.empty:
        return rolling_export
    if not reference_rev_rows and not reference_unit_rows:
        return rolling_export

    month_labels = _rolling_month_labels(month, periods=len(rolling_revenue_cols))
    current_label = pd.Period(month, freq="M").strftime("%B '%y")
    rev_label_by_col = {col: month_labels[idx] for idx, col in enumerate(rolling_revenue_cols)}
    unit_label_by_col = {col: month_labels[idx] for idx, col in enumerate(rolling_unit_cols)}

    out = rolling_export.copy()
    existing_keys = set(_normalize_key(v) for v in out["Brand"].tolist())
    for brand_key, rev_map in reference_rev_rows.items():
        if brand_key in {"total", "total market"}:
            continue
        if brand_key in existing_keys:
            continue
        unit_map = reference_unit_rows.get(brand_key, {})
        row: dict[str, float | str] = {"Brand": brand_key}
        for col, label in rev_label_by_col.items():
            if label == current_label:
                row[col] = 0.0
            else:
                row[col] = float(rev_map.get(label, 0) or 0)
        for col, label in unit_label_by_col.items():
            if label == current_label:
                row[col] = 0.0
            else:
                row[col] = float(unit_map.get(label, 0) or 0)
        out = pd.concat([out, pd.DataFrame([row])], ignore_index=True)

    for idx in out.index:
        brand_key = _normalize_key(out.at[idx, "Brand"])
        rev_map = reference_rev_rows.get(brand_key, {})
        unit_map = reference_unit_rows.get(brand_key, {})
        for col, label in rev_label_by_col.items():
            if label == current_label:
                continue
            value = rev_map.get(label)
            if value is not None and not pd.isna(value):
                out.at[idx, col] = float(value)
        for col, label in unit_label_by_col.items():
            if label == current_label:
                continue
            value = unit_map.get(label)
            if value is not None and not pd.isna(value):
                out.at[idx, col] = float(value)

    out["Grand Total Revenue"] = out[rolling_revenue_cols].apply(_to_number).sum(axis=1)
    out["Grand Total Units"] = out[rolling_unit_cols].apply(_to_number).sum(axis=1)
    return out


def _read_csv_robust(path: Path) -> pd.DataFrame:
    for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return pd.read_csv(path, encoding=enc, compression="infer")
        except UnicodeDecodeError:
            continue
    return pd.read_csv(path, encoding="cp1252", encoding_errors="replace", compression="infer")


def _load_helium10_meta(*folders: Path) -> pd.DataFrame:
    """
    Load Helium10 Black Box export metadata for ASIN-level fields needed in Innova/BLCKTEC tabs.
    """
    keep_cols = ["ASIN", "URL", "Title", "Brand", "Review Count", "Reviews Rating", "Price", "Fulfillment"]
    dfs: list[pd.DataFrame] = []
    for folder in folders:
        if folder is None or not folder.exists():
            continue
        for p in sorted(folder.iterdir()):
            if not p.is_file():
                continue
            if p.suffix.lower() != ".csv":
                continue
            if p.name.startswith("._"):
                continue
            try:
                df = _read_csv_robust(p)
            except Exception:
                continue
            if "ASIN" not in df.columns:
                continue
            # Normalize column names from exports (they match, but be defensive).
            for c in keep_cols:
                if c not in df.columns:
                    df[c] = np.nan
            df = df[keep_cols].copy()
            dfs.append(df)
    if not dfs:
        return pd.DataFrame(columns=keep_cols)
    meta = pd.concat(dfs, ignore_index=True)
    meta["ASIN"] = _clean_asin(meta["ASIN"])
    meta = meta[meta["ASIN"].ne("") & meta["ASIN"].ne("nan")].copy()
    # Keep the first seen record per ASIN (folders are ordered by caller priority).
    meta = meta.drop_duplicates(subset=["ASIN"], keep="first")
    return meta


def _read_innova1p(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path, skiprows=1)
    df = df.rename(columns={"Ordered Units": "Monthly Sales", "Ordered Revenue": "Monthly Revenue", "Product Title": "Title"})
    return _clean_actual_df(df[["ASIN", "Monthly Sales", "Monthly Revenue", "Title"]])


def _read_innova3p(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    asin_col = "(Child) ASIN" if "(Child) ASIN" in df.columns else "ASIN"
    df = df.rename(columns={asin_col: "ASIN", "Units Ordered": "Monthly Sales", "Ordered Product Sales": "Monthly Revenue"})
    if "Title" not in df.columns:
        df["Title"] = np.nan
    return _clean_actual_df(df[["ASIN", "Monthly Sales", "Monthly Revenue", "Title"]])


def _read_blcktec(path: Path, month: str, market_df_for_mapping: pd.DataFrame | None = None) -> pd.DataFrame:
    df = pd.read_excel(path)
    if "ASIN" in df.columns:
        df = df.rename(columns={"Unit Sold": "Monthly Sales", "Revenue": "Monthly Revenue"})
        df["ASIN"] = _clean_asin(df["ASIN"])
        df["Monthly Sales"] = _to_number(df["Monthly Sales"])
        df["Monthly Revenue"] = _to_number(df["Monthly Revenue"])
        return df[["ASIN", "Monthly Sales", "Monthly Revenue"]]

    xls = pd.ExcelFile(path)
    expected_range = None
    try:
        start = pd.Period(month, freq="M").to_timestamp(how="start")
        end = pd.Period(month, freq="M").to_timestamp(how="end")
        expected_range = f"{start:%m/%d/%Y} - {end:%m/%d/%Y}"
    except Exception:
        expected_range = None

    target_sheet = xls.sheet_names[0]
    if expected_range:
        for sheet in xls.sheet_names:
            head = pd.read_excel(path, sheet_name=sheet, header=None, nrows=5)
            if (head.astype(str) == expected_range).any().any():
                target_sheet = sheet
                break

    raw = pd.read_excel(path, sheet_name=target_sheet, header=None)
    header_row = None
    for i in range(len(raw)):
        if str(raw.iloc[i, 1]).strip().lower() == "unit sold":
            header_row = i
            break
    if header_row is None:
        raise KeyError("BLCKTEC file missing ASIN column and does not contain a 'Unit Sold' header row.")

    data = raw.iloc[header_row + 1 :, [0, 1, 2]].copy()
    data.columns = ["Code", "Monthly Sales", "Monthly Revenue"]
    data = data.dropna(subset=["Code"])
    data["Code"] = data["Code"].astype(str).str.strip()
    data["Monthly Sales"] = _to_number(data["Monthly Sales"])
    data["Monthly Revenue"] = _to_number(data["Monthly Revenue"])
    data = data[~data["Code"].str.lower().isin({"total", "(sales numbers included b2b and non-b2b)"})]

    if market_df_for_mapping is None or not all(c in market_df_for_mapping.columns for c in ["ASIN", "Title", "Brand"]):
        raise KeyError(
            "BLCKTEC file has no ASIN column and could not map codes -> ASIN from amazon_obd2_YYYYMM.xlsx. "
            "Ensure the current month's amazon_obd2 file includes BLCKTEC rows with titles like 'BLCKTEC 440 ...'."
        )

    mkt = market_df_for_mapping.copy()
    mkt["ASIN"] = _clean_asin(mkt["ASIN"])
    mkt["Brand"] = mkt["Brand"].astype(str).str.lower().str.strip()
    bl = mkt[mkt["Brand"].eq("blcktec")].copy()
    if bl.empty:
        raise KeyError("Cannot map BLCKTEC codes -> ASIN: no BLCKTEC rows in current month amazon_obd2.")

    bl["_code"] = bl["Title"].astype(str).str.extract(r"(?i)\bBLCKTEC\s+([0-9]{3}[A-Za-z]?)\b", expand=False)
    bl = bl.dropna(subset=["_code"]).copy()
    code_to_asin = dict(zip(bl["_code"].astype(str).str.strip().tolist(), bl["ASIN"].tolist(), strict=False))

    mapped = data.copy()
    mapped["ASIN"] = mapped["Code"].map(code_to_asin)
    mapped = mapped.dropna(subset=["ASIN"]).copy()
    return mapped[["ASIN", "Monthly Sales", "Monthly Revenue"]]


def _apply_actuals(market_df: pd.DataFrame, actual_df: pd.DataFrame, brand: str, spec_df: pd.DataFrame | None = None) -> pd.DataFrame:
    if actual_df.empty:
        return market_df
    market_df = market_df.copy()
    market_df["ASIN"] = _clean_asin(market_df["ASIN"])
    actual_df = actual_df.copy()
    actual_df["ASIN"] = _clean_asin(actual_df["ASIN"])

    actual_asins = set(actual_df["ASIN"].dropna().unique().tolist())
    if not actual_asins:
        return market_df

    missing_asins = actual_asins - set(market_df["ASIN"])
    if missing_asins:
        add = actual_df[actual_df["ASIN"].isin(missing_asins)].copy()
        add["Brand"] = brand
        if "Title" not in add.columns:
            add["Title"] = np.nan
        add = add.rename(columns={"Monthly Sales": "Monthly Sales", "Monthly Revenue": "Monthly Revenue"})
        if spec_df is not None and "Type" in spec_df.columns:
            add = add.merge(spec_df[["ASIN", "Type"]], how="left", on="ASIN")
        market_df = pd.concat([market_df, add], ignore_index=True, sort=False)

    # If an ASIN exists in the market file under a different Brand, treat the actual export as authoritative.
    market_df.loc[market_df["ASIN"].isin(actual_asins), "Brand"] = brand

    mask = market_df["ASIN"].isin(actual_asins) & market_df["Brand"].astype(str).str.lower().str.strip().eq(brand)
    # Overwrite current-month numbers for the brand ASINs.
    actual_map = actual_df.set_index("ASIN")[["Monthly Sales", "Monthly Revenue"]]
    market_df.loc[mask, "Monthly Sales"] = market_df.loc[mask, "ASIN"].map(actual_map["Monthly Sales"])
    market_df.loc[mask, "Monthly Revenue"] = market_df.loc[mask, "ASIN"].map(actual_map["Monthly Revenue"])
    return market_df


def _set_avg_price_for_asins(df: pd.DataFrame, asins: set[str]) -> pd.DataFrame:
    if df.empty or not asins:
        return df
    out = df.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    if "Price" not in out.columns:
        out["Price"] = np.nan
    sales = _to_number(out.get("Monthly Sales", pd.Series(np.nan, index=out.index)))
    revenue = _to_number(out.get("Monthly Revenue", pd.Series(np.nan, index=out.index)))
    mask = out["ASIN"].isin(asins) & sales.gt(0)
    out.loc[mask, "Price"] = revenue.loc[mask] / sales.loc[mask]
    return out


def _filter_innova_actual_excluded_asins(df: pd.DataFrame) -> pd.DataFrame:
    return _filter_asins(df, set(NON_OBD2_ASINS))


def _classify_innova_3p_non_code_product(title) -> tuple[str, str] | None:
    """Classify Innova 3P non-Code Reader products using explicit product phrases."""
    text = "" if pd.isna(title) else str(title).lower()
    text = re.sub(r"[-_/]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()

    if re.search(r"\bdigital\s+multimeter\b", text):
        return (
            INNOVA_3P_EXCLUDED_FAMILY_DIGITAL_MULTIMETER,
            "3P title matched explicit 'digital multimeter' product phrase",
        )
    if re.search(
        r"\bthermal\s+imager\b|\bthermal\s+camera\b|\bthermal\s+imaging\s+camera\b|\binfrared\s+inspection\s+camera\b",
        text,
    ):
        return (
            INNOVA_3P_EXCLUDED_FAMILY_THERMAL,
            "3P title matched thermal/infrared camera product phrase",
        )
    if re.search(r"\bborescope\b|\binspection\s+camera\b", text):
        return (
            INNOVA_3P_EXCLUDED_FAMILY_BORESCOPE,
            "3P title matched borescope/inspection camera product phrase",
        )
    return None


def _innova_3p_non_code_exclusion_map(
    innova3p_actual: pd.DataFrame,
    month: str | None,
) -> dict[str, tuple[str, str]]:
    """Return ASIN -> (product family, reason) for the 202607+ Innova 3P rule."""
    if not month or month < INNOVA_3P_NON_CODE_EXCLUSION_START_MONTH:
        return {}
    if innova3p_actual.empty or "ASIN" not in innova3p_actual.columns:
        return {}

    out = innova3p_actual.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    if "Title" not in out.columns:
        out["Title"] = np.nan

    exclusions: dict[str, tuple[str, str]] = {}
    for row in out[["ASIN", "Title"]].itertuples(index=False):
        asin = str(row.ASIN).strip()
        if not asin or asin.lower() == "nan":
            continue
        classified = _classify_innova_3p_non_code_product(row.Title)
        if classified is not None:
            exclusions[asin] = classified
    return exclusions


def _filter_innova_3p_non_code_products(df: pd.DataFrame, month: str | None) -> pd.DataFrame:
    exclusions = _innova_3p_non_code_exclusion_map(df, month)
    return _filter_asins(df, set(exclusions))


def _is_innova_code_reader_actual(title) -> bool:
    text = "" if pd.isna(title) else str(title).lower()
    return bool(re.search(r"\bobd\s*(?:2|ii)?\b|\bcode\s*reader\b", text))


def _merge_type_from_spec(add: pd.DataFrame, spec_df: pd.DataFrame | None) -> pd.DataFrame:
    if spec_df is None or "ASIN" not in spec_df.columns or "Type" not in spec_df.columns:
        return add
    spec = spec_df[["ASIN", "Type"]].copy()
    spec["ASIN"] = _clean_asin(spec["ASIN"])
    spec = spec.dropna(subset=["ASIN"]).drop_duplicates(subset=["ASIN"], keep="last")
    return add.merge(spec, how="left", on="ASIN")


def _apply_innova_monthly_rules(
    market_df: pd.DataFrame,
    innova1p_actual: pd.DataFrame,
    innova3p_actual: pd.DataFrame,
    spec_df: pd.DataFrame | None = None,
    month: str | None = None,
) -> pd.DataFrame:
    """
    Monthly Innova inclusion policy:
      - raw-present Innova ASINs stay included; 1P/3P actual metrics win when present
      - raw-present Innova ASINs absent from actual keep raw current-month metrics
      - 3P actual-only ASINs are added as Innova using actual metrics
      - 1P actual-only OBD/code-reader ASINs are added as Innova using actual metrics
      - NON_OBD2_ASINS are excluded from both raw and actual-driven Innova inclusion
      - from 202607, explicit non-Code Reader Innova 3P product families are
        removed from the complete current-month market before any downstream rollup
    """
    market_df = market_df.copy()
    if market_df.empty or "ASIN" not in market_df.columns:
        return market_df
    market_df["ASIN"] = _clean_asin(market_df["ASIN"])
    innova_3p_non_code_exclusions = _innova_3p_non_code_exclusion_map(innova3p_actual, month)
    if innova_3p_non_code_exclusions:
        market_df = _filter_asins(market_df, set(innova_3p_non_code_exclusions))
    if "Brand" not in market_df.columns:
        market_df["Brand"] = np.nan

    brand_key = market_df["Brand"].astype(str).str.lower().str.strip()
    carryover_zero = _carryover_zero_mask(market_df)
    raw_innova_asins = set(market_df.loc[brand_key.eq("innova") & ~carryover_zero, "ASIN"].dropna().unique().tolist())

    out = market_df.copy()
    out[INNOVA_RAW_PRESENT_COL] = out["ASIN"].isin(raw_innova_asins)
    out[INNOVA_ADDED_1P_COL] = False
    out[INNOVA_ADDED_3P_COL] = False
    out[INNOVA_EFFECTIVE_1P_COL] = False
    out[INNOVA_EFFECTIVE_3P_COL] = False

    actual_1p = _filter_innova_actual_excluded_asins(innova1p_actual)
    if not actual_1p.empty:
        actual_1p["ASIN"] = _clean_asin(actual_1p["ASIN"])
    actual_3p = _filter_innova_actual_excluded_asins(innova3p_actual)
    actual_3p = _filter_innova_3p_non_code_products(actual_3p, month)
    if not actual_3p.empty:
        actual_3p["ASIN"] = _clean_asin(actual_3p["ASIN"])

    combined_actual = _build_innova_actual_helper(actual_1p, actual_3p)
    actual_1p_asins: set[str] = set()
    actual_3p_asins: set[str] = set()
    if not combined_actual.empty:
        combined_actual["ASIN"] = _clean_asin(combined_actual["ASIN"])
        actual_1p_asins = set(
            combined_actual.loc[combined_actual["Has 1P Actual"].fillna(False), "ASIN"].dropna().unique().tolist()
        )
        actual_3p_asins = set(
            combined_actual.loc[combined_actual["Has 3P Actual"].fillna(False), "ASIN"].dropna().unique().tolist()
        )
        combined_actual_asins = set(combined_actual["ASIN"].dropna().unique().tolist())
        raw_actual_asins = raw_innova_asins & combined_actual_asins
        if raw_actual_asins:
            combined_map = combined_actual.drop_duplicates(subset=["ASIN"], keep="first").set_index("ASIN")
            raw_actual_mask = out[INNOVA_RAW_PRESENT_COL].fillna(False) & out["ASIN"].isin(raw_actual_asins)
            out.loc[raw_actual_mask, "Monthly Sales"] = out.loc[raw_actual_mask, "ASIN"].map(combined_map["Monthly Sales"])
            out.loc[raw_actual_mask, "Monthly Revenue"] = out.loc[raw_actual_mask, "ASIN"].map(combined_map["Monthly Revenue"])
            out.loc[raw_actual_mask, INNOVA_EFFECTIVE_1P_COL] = out.loc[raw_actual_mask, "ASIN"].map(combined_map["Has 1P Actual"])
            out.loc[raw_actual_mask, INNOVA_EFFECTIVE_3P_COL] = out.loc[raw_actual_mask, "ASIN"].map(combined_map["Has 3P Actual"])

    actual_3p_nonraw_asins = actual_3p_asins - raw_innova_asins
    if actual_3p_nonraw_asins:
        actual_map = combined_actual.drop_duplicates(subset=["ASIN"], keep="first").set_index("ASIN")
        existing_market_mask = out["ASIN"].isin(actual_3p_nonraw_asins)
        existing_asins = set(out.loc[existing_market_mask, "ASIN"].dropna().unique().tolist())
        if existing_asins:
            out.loc[existing_market_mask, "Brand"] = "innova"
            out.loc[existing_market_mask, INNOVA_ADDED_3P_COL] = True
            out.loc[existing_market_mask, INNOVA_ADDED_1P_COL] = out.loc[existing_market_mask, "ASIN"].isin(actual_1p_asins)
            out.loc[existing_market_mask, INNOVA_RAW_PRESENT_COL] = False
            out.loc[existing_market_mask, INNOVA_EFFECTIVE_1P_COL] = out.loc[existing_market_mask, "ASIN"].map(actual_map["Has 1P Actual"])
            out.loc[existing_market_mask, INNOVA_EFFECTIVE_3P_COL] = out.loc[existing_market_mask, "ASIN"].map(actual_map["Has 3P Actual"])
            out.loc[existing_market_mask, "Monthly Sales"] = out.loc[existing_market_mask, "ASIN"].map(actual_map["Monthly Sales"])
            out.loc[existing_market_mask, "Monthly Revenue"] = out.loc[existing_market_mask, "ASIN"].map(actual_map["Monthly Revenue"])

        missing_asins = actual_3p_nonraw_asins - existing_asins
        if missing_asins:
            add = combined_actual[combined_actual["ASIN"].isin(missing_asins)].copy()
            add["Brand"] = "innova"
            if "Title" not in add.columns:
                add["Title"] = np.nan
            add = _merge_type_from_spec(add, spec_df)
            add[INNOVA_RAW_PRESENT_COL] = False
            add[INNOVA_ADDED_1P_COL] = add["ASIN"].isin(actual_1p_asins)
            add[INNOVA_ADDED_3P_COL] = True
            add[INNOVA_EFFECTIVE_1P_COL] = add["Has 1P Actual"].fillna(False)
            add[INNOVA_EFFECTIVE_3P_COL] = add["Has 3P Actual"].fillna(False)
            out = pd.concat([out, add], ignore_index=True, sort=False)

    actual_1p_only_asins = actual_1p_asins - raw_innova_asins - actual_3p_asins
    actual_1p_code_reader_asins: set[str] = set()
    if actual_1p_only_asins:
        title_map = actual_1p.drop_duplicates(subset=["ASIN"], keep="first").set_index("ASIN")["Title"]
        actual_1p_code_reader_asins = {asin for asin in actual_1p_only_asins if _is_innova_code_reader_actual(title_map.get(asin))}
        if actual_1p_code_reader_asins:
            actual_map = actual_1p.drop_duplicates(subset=["ASIN"], keep="first").set_index("ASIN")
            existing_market_mask = out["ASIN"].isin(actual_1p_code_reader_asins)
            existing_asins = set(out.loc[existing_market_mask, "ASIN"].dropna().unique().tolist())
            if existing_asins:
                out.loc[existing_market_mask, "Brand"] = "innova"
                out.loc[existing_market_mask, INNOVA_ADDED_1P_COL] = True
                out.loc[existing_market_mask, INNOVA_ADDED_3P_COL] = False
                out.loc[existing_market_mask, INNOVA_RAW_PRESENT_COL] = False
                out.loc[existing_market_mask, INNOVA_EFFECTIVE_1P_COL] = True
                out.loc[existing_market_mask, INNOVA_EFFECTIVE_3P_COL] = False
                out.loc[existing_market_mask, "Monthly Sales"] = out.loc[existing_market_mask, "ASIN"].map(actual_map["Monthly Sales"])
                out.loc[existing_market_mask, "Monthly Revenue"] = out.loc[existing_market_mask, "ASIN"].map(actual_map["Monthly Revenue"])

            missing_asins = actual_1p_code_reader_asins - existing_asins
            if missing_asins:
                add = actual_1p[actual_1p["ASIN"].isin(missing_asins)].copy()
                add["Brand"] = "innova"
                if "Title" not in add.columns:
                    add["Title"] = np.nan
                add = _merge_type_from_spec(add, spec_df)
                add[INNOVA_RAW_PRESENT_COL] = False
                add[INNOVA_ADDED_1P_COL] = True
                add[INNOVA_ADDED_3P_COL] = False
                add[INNOVA_EFFECTIVE_1P_COL] = True
                add[INNOVA_EFFECTIVE_3P_COL] = False
                out = pd.concat([out, add], ignore_index=True, sort=False)

    actual_overlap_asins = raw_innova_asins & set(combined_actual.get("ASIN", pd.Series(dtype=str)).dropna().tolist())
    added_actual_asins = actual_3p_nonraw_asins | actual_1p_code_reader_asins
    return _set_avg_price_for_asins(out, actual_overlap_asins | added_actual_asins)


def _enforce_brand_actual_scope(market_df: pd.DataFrame, actual_df: pd.DataFrame, brand: str) -> pd.DataFrame:
    """
    Keep only actual-export ASINs for the given brand in current month to ensure
    brand totals match real sales files exactly.
    """
    if actual_df.empty:
        return market_df
    out = market_df.copy()
    out["ASIN"] = _clean_asin(out["ASIN"])
    actual_asins = set(_clean_asin(actual_df["ASIN"]).dropna().tolist())
    if not actual_asins:
        return out
    brand_mask = out["Brand"].astype(str).str.lower().str.strip().eq(brand)
    drop_mask = brand_mask & ~out["ASIN"].isin(actual_asins)
    if drop_mask.any():
        out = out.loc[~drop_mask].copy()
    return out


def _build_innova_account_sheet(
    innova_df: pd.DataFrame,
    account_actual_df: pd.DataFrame,
    *,
    fulfillment: str,
) -> pd.DataFrame:
    if account_actual_df.empty:
        return innova_df.iloc[0:0].copy()
    out = innova_df.copy()
    account_actual_df = account_actual_df.copy()
    account_actual_df["ASIN"] = _clean_asin(account_actual_df["ASIN"])
    asins = set(account_actual_df["ASIN"].dropna().tolist())
    if INNOVA_RAW_PRESENT_COL not in out.columns:
        out[INNOVA_RAW_PRESENT_COL] = True
    if INNOVA_ADDED_1P_COL not in out.columns:
        out[INNOVA_ADDED_1P_COL] = False
    if INNOVA_ADDED_3P_COL not in out.columns:
        out[INNOVA_ADDED_3P_COL] = False
    if INNOVA_EFFECTIVE_1P_COL not in out.columns:
        out[INNOVA_EFFECTIVE_1P_COL] = False
    if INNOVA_EFFECTIVE_3P_COL not in out.columns:
        out[INNOVA_EFFECTIVE_3P_COL] = False
    current_innova_mask = (
        out[INNOVA_RAW_PRESENT_COL].fillna(False)
        | out[INNOVA_ADDED_1P_COL].fillna(False)
        | out[INNOVA_ADDED_3P_COL].fillna(False)
    )
    effective_col = INNOVA_EFFECTIVE_1P_COL if fulfillment == "1P" else INNOVA_EFFECTIVE_3P_COL
    include_mask = out["ASIN"].isin(asins) & current_innova_mask & out[effective_col].fillna(False)
    out = out[include_mask].copy()
    actual_map = account_actual_df.drop_duplicates(subset=["ASIN"], keep="first").set_index("ASIN")[["Monthly Sales", "Monthly Revenue"]]
    out["Monthly Sales"] = out["ASIN"].map(actual_map["Monthly Sales"])
    out["Monthly Revenue"] = out["ASIN"].map(actual_map["Monthly Revenue"])
    out = _set_avg_price_for_asins(out, asins)
    out["Fulfillment"] = fulfillment
    return out


def _is_missing_value(v) -> bool:
    if v is None:
        return True
    if isinstance(v, float) and np.isnan(v):
        return True
    if isinstance(v, str) and v.strip() == "":
        return True
    return False


def _fill_metadata_from_history(
    *,
    cur: pd.DataFrame,
    history: list[pd.DataFrame],
    spec_df: pd.DataFrame | None,
    raw_meta: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """
    Fill missing metadata fields (Type, URL, Title, Price) from:
      1) spec mapping (Type)
      2) current month OBD2 and historical OBD2 months
      3) Helium10 raw exports

    Review Count and Reviews Rating are intentionally filled only from
    matching Helium10 raw-export rows. Actual-sales rows without Helium10
    rating metadata must remain blank so brand Avg Rating excludes them.
    """
    cur = cur.copy()
    cur["ASIN"] = _clean_asin(cur["ASIN"])

    # Ensure columns exist.
    meta_cols = ["Title", "Type", "Price", "Review Count", "Reviews Rating", "URL"]
    for c in meta_cols:
        if c not in cur.columns:
            cur[c] = np.nan

    # Fill Type from spec first.
    if spec_df is not None and "ASIN" in spec_df.columns and "Type" in spec_df.columns:
        s = spec_df.copy()
        s["ASIN"] = _clean_asin(s["ASIN"])
        type_map = s.dropna(subset=["ASIN"]).drop_duplicates(subset=["ASIN"], keep="last").set_index("ASIN")["Type"]
        m = cur["Type"].isna() | cur["Type"].astype(str).str.strip().eq("")
        cur.loc[m, "Type"] = cur.loc[m, "ASIN"].map(type_map)

    history_fill_cols = ["Title", "Type", "Price", "URL"]

    # Then fill non-rating metadata from history (newest -> oldest).
    for h in reversed(history):
        if "ASIN" not in h.columns:
            continue
        h = h.copy()
        h["ASIN"] = _clean_asin(h["ASIN"])
        h = h.dropna(subset=["ASIN"]).drop_duplicates(subset=["ASIN"], keep="first")
        for c in history_fill_cols:
            if c not in h.columns:
                continue
            src = h.set_index("ASIN")[c]
            mask = cur[c].map(_is_missing_value)
            if not mask.any():
                continue
            cur.loc[mask, c] = cur.loc[mask, "ASIN"].map(src)

    # Finally fill from Helium10 raw exports (current or historical exports, if provided).
    if raw_meta is not None and not raw_meta.empty and "ASIN" in raw_meta.columns:
        rm = raw_meta.copy()
        rm["ASIN"] = _clean_asin(rm["ASIN"])
        rm = rm.drop_duplicates(subset=["ASIN"], keep="first").set_index("ASIN")
        for c in meta_cols:
            if c not in rm.columns:
                continue
            src = rm[c]
            mask = cur[c].map(_is_missing_value)
            if not mask.any():
                continue
            cur.loc[mask, c] = cur.loc[mask, "ASIN"].map(src)

    # If URL is still missing, fall back to a canonical Amazon DP link.
    if "URL" in cur.columns:
        url_missing = cur["URL"].map(_is_missing_value)
        if url_missing.any():
            cur.loc[url_missing, "URL"] = cur.loc[url_missing, "ASIN"].map(lambda a: f"https://www.amazon.com/dp/{a}" if a else np.nan)

    # Normalize numeric-ish metadata.
    cur["Price"] = _to_number(cur["Price"])
    # Review Count can be blank; keep NaN if unknown.
    cur["Review Count"] = _to_number(cur["Review Count"])
    cur["Reviews Rating"] = pd.to_numeric(cur["Reviews Rating"], errors="coerce")
    return cur


def _recalc_avg_price(df: pd.DataFrame, brand: str) -> pd.DataFrame:
    """
    For specific brands with actual Monthly Revenue/Monthly Sales, recompute Price as
    Monthly Revenue / Monthly Sales (average selling price).
    """
    df = df.copy()
    if "Brand" not in df.columns or "Monthly Revenue" not in df.columns or "Monthly Sales" not in df.columns:
        return df
    b = df["Brand"].astype(str).str.lower().str.strip().eq(brand)
    sales = _to_number(df["Monthly Sales"])
    rev = _to_number(df["Monthly Revenue"])
    with np.errstate(divide="ignore", invalid="ignore"):
        avg = rev / sales.replace(0, np.nan)
    mask = b & sales.gt(0)
    if "Price" not in df.columns:
        df["Price"] = np.nan
    df.loc[mask, "Price"] = avg.loc[mask]
    return df


def _finalize_innova_blcktec_fields(df: pd.DataFrame) -> pd.DataFrame:
    """
    Ensure Innova/BLCKTEC tabs have the requested fields populated.

    When Helium10 cannot return metadata for some ASINs (e.g. actual-only items that never appear
    in exports), we still:
      - provide a canonical URL
      - default missing Type to 'Other'
      - leave missing review count/rating blank so Avg Rating excludes them
    """
    df = df.copy()
    if "Brand" not in df.columns:
        return df
    b = df["Brand"].astype(str).str.lower().str.strip()
    mask = b.isin({"innova", "blcktec"})

    if "Type" in df.columns:
        tmiss = mask & (df["Type"].isna() | df["Type"].astype(str).str.strip().eq(""))
        df.loc[tmiss, "Type"] = "Other"

    if "Review Count" in df.columns:
        rc = pd.to_numeric(df["Review Count"], errors="coerce")
        df["Review Count"] = rc

    if "Reviews Rating" in df.columns:
        rr = pd.to_numeric(df["Reviews Rating"], errors="coerce")
        df["Reviews Rating"] = rr

    if "Price" in df.columns:
        pr = pd.to_numeric(df["Price"], errors="coerce")
        df["Price"] = pr
        df.loc[mask & df["Price"].isna(), "Price"] = 0

    if "URL" in df.columns:
        umiss = mask & df["URL"].map(_is_missing_value)
        if umiss.any() and "ASIN" in df.columns:
            df.loc[umiss, "URL"] = df.loc[umiss, "ASIN"].map(lambda a: f"https://www.amazon.com/dp/{a}" if a else np.nan)

    return df


def _log_missing_rating_metadata(df: pd.DataFrame) -> None:
    if df.empty or "Brand" not in df.columns or "ASIN" not in df.columns:
        return
    b = df["Brand"].astype(str).str.lower().str.strip()
    missing = df[
        b.isin({"innova", "blcktec"})
        & (
            df.get("Review Count", pd.Series(np.nan, index=df.index)).isna()
            | df.get("Reviews Rating", pd.Series(np.nan, index=df.index)).isna()
        )
    ].copy()
    if missing.empty:
        return

    print("Innova/BLCKTEC ASINs missing Helium10 review/rating metadata:")
    for _, row in missing.sort_values(["Brand", "ASIN"]).iterrows():
        asin = row.get("ASIN")
        brand = row.get("Brand")
        title = str(row.get("Title") or "").strip()
        print(f"  - {brand} {asin}: {title[:100]}")


def extract_first_digit(text: str) -> str | None:
    pattern = r"\d{3,4}\w{,2}"
    match = re.search(pattern, str(text))
    return str(match.group()) if match else None


def append_summary_list(df: pd.DataFrame, category: dict, tag: str, summary: list[list]):
    unit_total = df["Monthly Sales"].sum()
    rev_total = df["Monthly Revenue"].sum()
    for c, l in category.items():
        df_cate = df[(df.Type.isin(l[0])) & (df.Price >= l[1]) & (df.Price < l[2])]
        if len(df_cate) > 0:
            cate_unit = df_cate["Monthly Sales"].sum()
            cate_rev = df_cate["Monthly Revenue"].sum()
            l_cate = [tag, c]
            l_cate += [cate_unit, cate_unit / unit_total, cate_rev, cate_rev / rev_total]
            summary.append(l_cate)
        else:
            summary.append([tag, c, 0, 0, 0, 0])


def df_to_excel(
    df: pd.DataFrame,
    top: int,
    workbook: pd.ExcelWriter,
    sheet: str,
    index: list[list[str]],
    section_titles: tuple[str, str] | None = None,
):
    rev = df.sort_values("Monthly Revenue", ascending=False, ignore_index=True).head(top)
    rev = rev.reindex(index[0], axis=1)
    rev_start = 0
    if section_titles:
        pd.DataFrame([[section_titles[0]]]).to_excel(
            workbook,
            sheet_name=sheet,
            index=False,
            header=False,
            startrow=0,
        )
        rev_start = 1
    rev.to_excel(workbook, sheet_name=sheet, index=False, startrow=rev_start)

    unit = df.sort_values("Monthly Sales", ascending=False, ignore_index=True).head(top)
    unit = unit.reindex(index[1], axis=1)
    unit_start = rev_start + len(rev) + 5
    if section_titles:
        pd.DataFrame([[section_titles[1]]]).to_excel(
            workbook,
            sheet_name=sheet,
            index=False,
            header=False,
            startrow=unit_start,
        )
        unit_start += 1
    unit.to_excel(workbook, sheet_name=sheet, startrow=unit_start, index=False)


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate raw report workbooks (Amazon Competitor Report.xlsx + summary.xlsx).")
    parser.add_argument("--month", required=True, help="YYYYMM, e.g. 202601")
    parser.add_argument(
        "--base-dir",
        type=Path,
        default=Path(__file__).resolve().parent.parent,
        help="Repo root (default: parent of script/).",
    )
    parser.add_argument("--amazon-obd2-dir", type=Path, default=None, help="Folder containing amazon_obd2_YYYYMM.xlsx")
    parser.add_argument("--actual-dir", type=Path, default=None, help="Folder containing innova/blcktec actual files")
    parser.add_argument("--spec", type=Path, default=None, help="Path to amazon_scanner_type.xlsx")
    parser.add_argument("--out-report", type=Path, default=None, help="Output raw report workbook path")
    parser.add_argument("--out-summary", type=Path, default=None, help="Output raw summary workbook path")
    parser.add_argument("--out-dashboard-json", type=Path, default=None, help="Optional structured snapshot export JSON path")
    parser.add_argument("--raw-exports-dir", type=Path, default=None, help="Helium10 raw export folder (default: <base>/Amazon_Raw_Data/raw_data/YYYYMM)")
    parser.add_argument("--backup-exports-dir", type=Path, default=None, help="Helium10 backup export folder (default: <base>/Amazon_Raw_Data/backup_data/YYYYMM)")
    parser.add_argument(
        "--innova-rule",
        choices=[INNOVA_RULE_RAW_PLUS_ACTUAL_OBD, INNOVA_RULE_RAW_PLUS_3P_ACTUAL_ONLY],
        default=INNOVA_RULE_RAW_PLUS_ACTUAL_OBD,
        help=(
            "Innova inclusion rule. Default includes raw-present rows, 3P actual-only rows, "
            "and 1P actual-only rows whose title is OBD/code-reader related. "
            "The legacy raw-plus-3p-actual-only value is accepted as an alias."
        ),
    )
    parser.add_argument(
        "--rolling-reference-report",
        type=Path,
        default=None,
        help="Optional formatted report path used to enforce historical Rolling 12 mo values.",
    )
    args = parser.parse_args()

    month = str(args.month).strip()
    if not (len(month) == 6 and month.isdigit()):
        raise SystemExit("--month must be YYYYMM")

    base_dir: Path = args.base_dir.resolve()
    obd2_dir = (args.amazon_obd2_dir or (base_dir / "amazon_obd2")).resolve()
    actual_dir = (args.actual_dir or (base_dir / "innova_actual_data")).resolve()
    spec_path = (args.spec or (base_dir / "amazon_scanner_type.xlsx")).resolve()
    out_report = (args.out_report or (base_dir / "script" / "Amazon Competitor Report.xlsx")).resolve()
    out_summary = (args.out_summary or (base_dir / "script" / "summary.xlsx")).resolve()
    out_dashboard_json = args.out_dashboard_json.resolve() if args.out_dashboard_json else None
    raw_exports_dir = (args.raw_exports_dir or (base_dir / "Amazon_Raw_Data" / "raw_data" / month)).resolve()
    backup_exports_dir = (args.backup_exports_dir or (base_dir / "Amazon_Raw_Data" / "backup_data" / month)).resolve()
    rolling_reference_report = args.rolling_reference_report.resolve() if args.rolling_reference_report else _find_reference_rolling_report(base_dir, month)
    reference_rev_rows, reference_unit_rows = _load_reference_rolling_tables(rolling_reference_report)
    if rolling_reference_report and rolling_reference_report.exists():
        print(f"Using rolling reference report: {rolling_reference_report}")

    history = _yyyymm_history(month, periods=13)
    markets: list[pd.DataFrame] = []
    for m in history:
        p = obd2_dir / f"amazon_obd2_{m}.xlsx"
        if not p.exists():
            raise SystemExit(f"Missing amazon_obd2 file: {p}")
        markets.append(_canonicalize_market_brands(pd.read_excel(p)))

    spec_df = pd.read_excel(spec_path) if spec_path.exists() else None

    # Load Helium10 metadata for filling URLs/reviews/rating/title when actual exports add ASINs
    # that were excluded from the OBD2 pipeline.
    run_dir = base_dir / "script" / "runs" / month
    extra_meta_dirs = []
    if run_dir.exists():
        for p in sorted(run_dir.iterdir()):
            if p.is_dir() and p.name.startswith("missing_asin_newdata"):
                extra_meta_dirs.append(p)
    # Also include historical raw/backup exports for the 13-month window (most-recent first).
    hist_meta_dirs: list[Path] = []
    for m in reversed(history):
        rd = base_dir / "Amazon_Raw_Data" / "raw_data" / m
        bd = base_dir / "Amazon_Raw_Data" / "backup_data" / m
        if rd.exists():
            hist_meta_dirs.append(rd)
        if bd.exists():
            hist_meta_dirs.append(bd)

    raw_meta = _load_helium10_meta(raw_exports_dir, backup_exports_dir, *extra_meta_dirs, *hist_meta_dirs)

    # Ensure every month has a Monthly Revenue column for rolling/merge logic.
    # For Helium10-derived OBD2 exports, Monthly Revenue is typically computed as Price * Monthly Sales.
    # Actual datasets (Innova/BLCKTEC) will override the current month after this base computation.
    for i in range(len(markets)):
        df = markets[i]
        if "Monthly Sales" in df.columns:
            df["Monthly Sales"] = _to_number(df["Monthly Sales"])
        if "Price" in df.columns:
            df["Price"] = _to_number(df["Price"])
        if "Monthly Revenue" not in df.columns:
            if "Price" in df.columns and "Monthly Sales" in df.columns:
                df["Monthly Revenue"] = df["Price"] * df["Monthly Sales"]
            else:
                df["Monthly Revenue"] = np.nan
        else:
            df["Monthly Revenue"] = _to_number(df["Monthly Revenue"])
        markets[i] = _canonicalize_market_brands(df)

    innova1p_path = actual_dir / f"innova1p_{month}.csv"
    innova3p_path = actual_dir / f"innova3p_{month}.csv"
    blcktec_path = actual_dir / f"blcktec{month}.xlsx"

    blcktec_actual = _read_blcktec(blcktec_path, month=month, market_df_for_mapping=markets[-1]) if blcktec_path.exists() else pd.DataFrame(
        columns=["ASIN", "Monthly Sales", "Monthly Revenue"]
    )
    innova1p_actual_raw = _read_innova1p(innova1p_path) if innova1p_path.exists() else pd.DataFrame(
        columns=["ASIN", "Monthly Sales", "Monthly Revenue", "Title"]
    )
    innova3p_actual_raw = _read_innova3p(innova3p_path) if innova3p_path.exists() else pd.DataFrame(
        columns=["ASIN", "Monthly Sales", "Monthly Revenue", "Title"]
    )
    innova1p_actual = _filter_innova_actual_excluded_asins(_aggregate_actual_by_asin(innova1p_actual_raw))
    innova3p_actual_unfiltered = _filter_innova_actual_excluded_asins(_aggregate_actual_by_asin(innova3p_actual_raw))
    innova3p_actual = _filter_innova_3p_non_code_products(innova3p_actual_unfiltered, month)

    # Default 3P list (used when no 3P actual export exists).
    p3_default = [
        "B07Z481NJM",
        "B07Z46L5FG",
        "B07ZL7CLYR",
        "B07Z46KNLR",
        "B084SWJL4J",
        "B07ZL746BR",
        "B0B2B41RF3",
        "B09WRQ3LFH",
        "B07Z48NKF1",
        "B08FZ46X2M",
        "B082JCSB4Z",
        "B09WPW4WQ4",
        "B0D32BNNQ9",
        "B0F254MVB5",
        "B0F4M2MZYN",
    ]

    innova3p_asins: list[str] = []
    if not innova3p_actual.empty and "ASIN" in innova3p_actual.columns:
        # Use all effective ASINs present in the filtered 3P actual export for fulfillment labeling.
        innova3p_asins = innova3p_actual["ASIN"].dropna().astype(str).str.strip().unique().tolist()
        p3 = innova3p_asins
    else:
        p3 = p3_default

    markets[-1] = _apply_innova_monthly_rules(
        markets[-1],
        innova1p_actual,
        innova3p_actual_unfiltered,
        spec_df=spec_df,
        month=month,
    )
    markets[-1] = _apply_actuals(markets[-1], blcktec_actual, "blcktec", spec_df=spec_df)

    # Fill missing metadata for Innova/BLCKTEC from current+historical OBD2s, then recompute avg Price.
    markets[-1] = _fill_metadata_from_history(cur=markets[-1], history=markets, spec_df=spec_df, raw_meta=raw_meta)
    markets[-1] = _canonicalize_market_brands(markets[-1])
    innova_added_asins = set(
        markets[-1]
        .loc[markets[-1].get(INNOVA_ADDED_3P_COL, pd.Series(False, index=markets[-1].index)).fillna(False), "ASIN"]
        .dropna()
        .astype(str)
        .str.strip()
        .tolist()
    )
    innova_added_asins.update(
        markets[-1]
        .loc[markets[-1].get(INNOVA_ADDED_1P_COL, pd.Series(False, index=markets[-1].index)).fillna(False), "ASIN"]
        .dropna()
        .astype(str)
        .str.strip()
        .tolist()
    )
    markets[-1] = _set_avg_price_for_asins(markets[-1], innova_added_asins)
    markets[-1] = _recalc_avg_price(markets[-1], "blcktec")
    markets[-1] = _finalize_innova_blcktec_fields(markets[-1])
    _log_missing_rating_metadata(markets[-1])

    writer = pd.ExcelWriter(out_report, engine="openpyxl")

    market = markets[-1]

    for i in range(len(markets) - 1):
        market = market.merge(markets[-2 - i], how="left", on=["ASIN"], suffixes=("", str(-1 - i)))

    market_top50 = _filter_top50_excluded_asins(market, month)
    market_lm = markets[-2]
    market_ly = markets[0]

    rev_month = market.columns[market.columns.str.contains("Monthly Revenue")].tolist()
    unit_month = market.columns[market.columns.str.contains("Monthly Sales")].tolist()
    market["12mo Revenue"] = market.iloc[:, market.columns.isin(rev_month)].sum(axis=1)
    market["12mo Units"] = market.iloc[:, market.columns.isin(unit_month)].sum(axis=1)

    for i in range(len(markets) - 1):
        market.loc[market["Monthly Revenue-" + str(i + 1)].isna(), "12mo Revenue"] += market["Monthly Revenue"] * 12 / len(unit_month)

    market_rev_total = market["Monthly Revenue"].sum()
    market_unit_total = market["Monthly Sales"].sum()
    print(f"marketRevTotal={market_rev_total:,.2f}")
    print(f"marketUnitTotal={market_unit_total:,.0f}")

    brand = (
        market.groupby(["Brand"], as_index=False)
        .sum(["Monthly Sales", "Monthly Revenue", "Review Count"])[["Brand", "Monthly Sales", "Monthly Revenue", "Review Count"]]
    )
    brand["Review Count"] = brand["Review Count"].apply(int)
    brand["# of Listings"] = market.groupby(["Brand"]).count()["ASIN"].tolist()
    brand["Price Per Unit"] = round(brand["Monthly Revenue"] / brand["Monthly Sales"], 2)
    brand["Market Rev Share %"] = round(brand["Monthly Revenue"] / market_rev_total, 4)
    brand["Market Units Share %"] = round(brand["Monthly Sales"] / market_unit_total, 4)
    brand["Ave Rating"] = round(market.groupby(["Brand"]).mean(["Reviews Rating"])["Reviews Rating"], 1).tolist()
    brand_top = brand.sort_values("Monthly Revenue", ascending=False, ignore_index=True).head(25)
    brand_list = brand_top.sort_values("Brand", ignore_index=True).Brand.tolist()

    for i in range(len(markets) - 1):
        brand_r12 = (
            markets[-2 - i]
            .groupby(["Brand"], as_index=False)
            .sum(["Monthly Sales", "Monthly Revenue"])[["Brand", "Monthly Sales", "Monthly Revenue"]]
        )
        brand = brand.merge(brand_r12, how="left", on=["Brand"], suffixes=("", str(-1 - i)))

    brand["12mo Revenue"] = brand.iloc[:, brand.columns.isin(rev_month)].sum(axis=1)
    brand["12mo Revenue"] = brand["12mo Revenue"] * 12 / len(rev_month)
    brand["12mo Units"] = brand.iloc[:, brand.columns.isin(unit_month)].sum(axis=1)
    brand["12mo Units"] = brand["12mo Units"] * 12 / len(unit_month)

    month_abbr = pd.Period(month, freq="M").strftime("%b '%y")

    brand_index = [
        ["Brand", "# of Listings", "Monthly Revenue", "12mo Revenue", "Monthly Sales", "Market Rev Share %", "Price Per Unit", "Review Count", "Ave Rating"],
        ["Brand", "# of Listings", "Monthly Revenue", "12mo Units", "Monthly Sales", "Market Units Share %", "Price Per Unit", "Review Count", "Ave Rating"],
    ]
    df_to_excel(
        brand,
        25,
        writer,
        "Summary",
        brand_index,
        section_titles=(f"{month_abbr} Monthly Summary - Revenue", f"{month_abbr} Summary - Units"),
    )

    rev_month.reverse()
    unit_month.reverse()
    rolling_revenue_cols = rev_month[1:]
    rolling_unit_cols = unit_month[1:]

    rolling_export = brand.copy()
    rolling_export["Grand Total Revenue"] = rolling_export[rolling_revenue_cols].sum(axis=1)
    rolling_export["Grand Total Units"] = rolling_export[rolling_unit_cols].sum(axis=1)

    total_row = {"Brand": "Total"}
    for col in rolling_revenue_cols:
        total_row[col] = rolling_export[col].sum()
    for col in rolling_unit_cols:
        total_row[col] = rolling_export[col].sum()
    total_row["Grand Total Revenue"] = sum(total_row[col] for col in rolling_revenue_cols)
    total_row["Grand Total Units"] = sum(total_row[col] for col in rolling_unit_cols)

    total_market_row = {"Brand": "Total Market"}
    market_revenue_series = [markets[i]["Monthly Revenue"].sum() for i in range(1, len(markets))]
    market_unit_series = [markets[i]["Monthly Sales"].sum() for i in range(1, len(markets))]
    for col, value in zip(rolling_revenue_cols, market_revenue_series, strict=True):
        total_market_row[col] = value
    for col, value in zip(rolling_unit_cols, market_unit_series, strict=True):
        total_market_row[col] = value
    total_market_row["Grand Total Revenue"] = sum(market_revenue_series)
    total_market_row["Grand Total Units"] = sum(market_unit_series)

    rolling_export = pd.concat([rolling_export, pd.DataFrame([total_row, total_market_row])], ignore_index=True)
    rolling_export = _overlay_reference_rolling_history(
        rolling_export,
        month=month,
        rolling_revenue_cols=rolling_revenue_cols,
        rolling_unit_cols=rolling_unit_cols,
        reference_rev_rows=reference_rev_rows,
        reference_unit_rows=reference_unit_rows,
    )

    rolling_index = [
        ["Brand"] + rolling_revenue_cols + ["Grand Total Revenue"],
        ["Brand"] + rolling_unit_cols + ["Grand Total Units"],
    ]
    df_to_excel(
        rolling_export,
        len(rolling_export),
        writer,
        "Rolling 12 mo",
        rolling_index,
        section_titles=("Monthly Revenue", "Monthly Units"),
    )

    prod_index = [
        ["ASIN", "Title", "Brand", "Type", "Price", "Monthly Revenue", "Monthly Sales", "Review Count", "Reviews Rating", "URL"],
        ["ASIN", "Title", "Brand", "Type", "Price", "Monthly Revenue", "Monthly Sales", "Review Count", "Reviews Rating", "URL"],
    ]
    df_to_excel(
        market_top50,
        50,
        writer,
        "Top 50",
        prod_index,
        section_titles=(
            f"Rank By Monthly Revenue - {month_abbr} ONLY",
            f"Rank By Monthly Units - {month_abbr} ONLY",
        ),
    )

    innova_current_mask = (
        ~_carryover_zero_mask(market)
        | market.get(INNOVA_ADDED_1P_COL, pd.Series(False, index=market.index)).fillna(False)
        | market.get(INNOVA_ADDED_3P_COL, pd.Series(False, index=market.index)).fillna(False)
    )
    innova = market[(market["Brand"] == "innova") & innova_current_mask].copy()
    innova["Item #"] = innova["Title"].apply(extract_first_digit)
    if INNOVA_EFFECTIVE_1P_COL not in innova.columns:
        innova[INNOVA_EFFECTIVE_1P_COL] = False
    if INNOVA_EFFECTIVE_3P_COL not in innova.columns:
        innova[INNOVA_EFFECTIVE_3P_COL] = False
    innova1p_asins = set(
        innova.loc[innova[INNOVA_EFFECTIVE_1P_COL].fillna(False), "ASIN"].dropna().astype(str).str.strip().tolist()
    )
    innova3p_asin_set = set(
        innova.loc[innova[INNOVA_EFFECTIVE_3P_COL].fillna(False), "ASIN"].dropna().astype(str).str.strip().tolist()
    )
    overlap_asins = innova1p_asins & innova3p_asin_set

    innova["Fulfillment"] = ""
    innova.loc[innova["ASIN"].isin(innova1p_asins), "Fulfillment"] = "1P"
    innova.loc[innova["ASIN"].isin(innova3p_asin_set), "Fulfillment"] = "3P"
    innova.loc[innova["ASIN"].isin(overlap_asins), "Fulfillment"] = "1P+3P"
    innova["12mo Revenue"] = innova["12mo Revenue"]
    innova["12mo Units"] = innova["12mo Units"]

    innova_index = [
        ["Title", "ASIN", "Item #", "Fulfillment", "Type", "Price", "12mo Revenue", "Monthly Revenue", "12mo Units", "Monthly Sales", "Review Count", "Reviews Rating", "URL"],
        ["Title", "ASIN", "Item #", "Fulfillment", "Type", "Price", "12mo Revenue", "Monthly Revenue", "12mo Units", "Monthly Sales", "Review Count", "Reviews Rating", "URL"],
    ]
    df_to_excel(
        innova,
        len(innova),
        writer,
        "Innova",
        innova_index,
        section_titles=("Rank by Revenue", "Rank by Units"),
    )

    # Innova 1P / 3P sheets use account-specific actual monthly values.
    innova1p = _build_innova_account_sheet(innova, innova1p_actual, fulfillment="1P")
    df_to_excel(
        innova1p,
        len(innova1p),
        writer,
        "Innova 1P",
        innova_index,
        section_titles=("Rank by Revenue", "Rank by Units"),
    )

    innova3p = _build_innova_account_sheet(innova, innova3p_actual, fulfillment="3P")
    df_to_excel(
        innova3p,
        len(innova3p),
        writer,
        "Innova 3P",
        innova_index,
        section_titles=("Rank by Revenue", "Rank by Units"),
    )

    for brands in brand_list:
        if brands == "innova":
            continue
        df = market[market["Brand"] == brands].copy()
        index = [
            ["Title", "ASIN", "Type", "Price", "12mo Revenue", "Monthly Revenue", "12mo Units", "Monthly Sales", "Review Count", "Reviews Rating", "URL"],
            ["Title", "ASIN", "Type", "Price", "12mo Revenue", "Monthly Revenue", "12mo Units", "Monthly Sales", "Review Count", "Reviews Rating", "URL"],
        ]
        df_to_excel(
            df,
            len(df),
            writer,
            brands,
            index,
            section_titles=("Rank by Revenue", "Rank by Units"),
        )

    writer.close()

    writer_s = pd.ExcelWriter(out_summary, engine="openpyxl")

    list_summary: list[list] = []
    list_summary_lm: list[list] = []
    list_summary_ly: list[list] = []
    cate_summary: list[list] = []
    cate_summary_lm: list[list] = []
    cate_summary_ly: list[list] = []
    top_list: dict[str, list[str]] = {}
    price_range = math.ceil(max(market.Price))
    category = {
        "Tablet $800+": [["Tablet"], 800, price_range],
        "Tablet $400-$800": [["Tablet"], 400, 800],
        "Tablet $400-": [["Tablet"], 0, 400],
        "Total Tablet": [["Tablet"], 0, price_range],
        "Handheld $75+": [["Handheld"], 75, price_range],
        "Handheld $75-": [["Handheld"], 0, 75],
        "Total Handheld": [["Handheld"], 0, price_range],
        "Total Dongle": [["Dongle"], 0, price_range],
        "Total Other Tools": [["Key", "Cable/Adapter", "Other", "Probe", "VCI"], 0, price_range],
        "Total": [["Tablet", "Handheld", "Dongle", "Key", "Cable/Adapter", "Other", "Probe", "VCI"], 0, price_range],
    }

    for db, top50_db, ls in zip(
        [market, market_lm, market_ly],
        [market_top50, market_lm, market_ly],
        [list_summary, list_summary_lm, list_summary_ly],
        strict=True,
    ):
        append_summary_list(db, category, "Total", ls)
        top50 = top50_db.sort_values("Monthly Revenue", ascending=False, ignore_index=True).head(50)
        append_summary_list(top50, category, "Top 50", ls)
        for brands in brand_list:
            df_b = db[db["Brand"] == brands].copy()
            append_summary_list(df_b, category, brands, ls)

    summary = pd.DataFrame(list_summary, columns=["Brand", "Category", "Quantity/Mo", "Qty by %", "Revenue/Mo", "Revenue by %"])
    summary_lm = pd.DataFrame(list_summary_lm, columns=["Brand", "Category", "Quantity/Mo", "Qty by %", "Revenue/Mo", "Revenue by %"])
    summary_ly = pd.DataFrame(list_summary_ly, columns=["Brand", "Category", "Quantity/Mo", "Qty by %", "Revenue/Mo", "Revenue by %"])
    summary["Avg Price"] = summary["Revenue/Mo"] / summary["Quantity/Mo"]
    summary_lm["Avg Price"] = summary_lm["Revenue/Mo"] / summary_lm["Quantity/Mo"]
    summary_ly["Avg Price"] = summary_ly["Revenue/Mo"] / summary_ly["Quantity/Mo"]
    summary = summary.merge(summary_lm, how="left", on=["Brand", "Category"], suffixes=("", " LM")).merge(
        summary_ly, how="left", on=["Brand", "Category"], suffixes=("", " LY")
    )
    summary["Avg Price MoM"] = summary["Avg Price"] / summary["Avg Price LM"] - 1
    summary["Revenue MoM"] = summary["Revenue/Mo"] / summary["Revenue/Mo LM"] - 1
    summary["Qty MoM"] = summary["Quantity/Mo"] / summary["Quantity/Mo LM"] - 1
    summary["Avg Price YoY"] = summary["Avg Price"] / summary["Avg Price LY"] - 1
    summary["Revenue YoY"] = summary["Revenue/Mo"] / summary["Revenue/Mo LY"] - 1
    summary["Qty YoY"] = summary["Quantity/Mo"] / summary["Quantity/Mo LY"] - 1
    summary = summary.replace([np.inf, -np.inf], "N/A")
    summary = summary.reindex(
        ["Brand", "Category", "Avg Price", "Avg Price MoM", "Avg Price YoY", "Quantity/Mo", "Qty by %", "Qty MoM", "Qty YoY", "Revenue/Mo", "Revenue by %", "Revenue MoM", "Revenue YoY"],
        axis=1,
    )
    summary.to_excel(writer_s, index=False)

    for db, ls in zip([market, market_lm, market_ly], [cate_summary, cate_summary_lm, cate_summary_ly], strict=True):
        for c, l in category.items():
            df_t = db[(db.Type.isin(l[0])) & (db.Price >= l[1]) & (db.Price < l[2])]
            df_t = (
                df_t.groupby(["Brand"], as_index=False)
                .sum(["Monthly Sales", "Monthly Revenue"])[["Brand", "Monthly Sales", "Monthly Revenue"]]
                .sort_values("Monthly Revenue", ascending=False, ignore_index=True)
            )
            unit_total = df_t["Monthly Sales"].sum()
            rev_total = df_t["Monthly Revenue"].sum()
            df_t["Market Units Share %"] = df_t["Monthly Sales"] / unit_total
            df_t["Market Rev Share %"] = df_t["Monthly Revenue"] / rev_total

            if db.equals(market):
                top_list[c] = df_t.head(5).Brand.tolist() + ["blcktec", "innova"]

            for i in top_list[c]:
                ls.append(df_t.loc[df_t.Brand == i].sum().tolist() + [c])
                df_t = df_t.loc[df_t.Brand != i]
            ls.append(["Other"] + df_t.sum()[1:5].tolist() + [c])

    cate_df = pd.DataFrame(cate_summary, columns=["Brand", "Quantity/Mo", "Revenue/Mo", "Qty by %", "Revenue by %", "Category"])
    cate_df_lm = pd.DataFrame(cate_summary_lm, columns=["Brand", "Quantity/Mo", "Revenue/Mo", "Qty by %", "Revenue by %", "Category"])
    cate_df_ly = pd.DataFrame(cate_summary_ly, columns=["Brand", "Quantity/Mo", "Revenue/Mo", "Qty by %", "Revenue by %", "Category"])
    cate_df["Avg Price"] = cate_df["Revenue/Mo"] / cate_df["Quantity/Mo"]
    cate_df_lm["Avg Price"] = cate_df_lm["Revenue/Mo"] / cate_df_lm["Quantity/Mo"]
    cate_df_ly["Avg Price"] = cate_df_ly["Revenue/Mo"] / cate_df_ly["Quantity/Mo"]
    cate_df = cate_df.merge(cate_df_lm, how="left", on=["Brand", "Category"], suffixes=("", " LM")).merge(
        cate_df_ly, how="left", on=["Brand", "Category"], suffixes=("", " LY")
    )
    cate_df["Avg Price MoM"] = cate_df["Avg Price"] / cate_df["Avg Price LM"] - 1
    cate_df["Revenue MoM"] = cate_df["Revenue/Mo"] / cate_df["Revenue/Mo LM"] - 1
    cate_df["Qty MoM"] = cate_df["Quantity/Mo"] / cate_df["Quantity/Mo LM"] - 1
    cate_df["Avg Price YoY"] = cate_df["Avg Price"] / cate_df["Avg Price LY"] - 1
    cate_df["Revenue YoY"] = cate_df["Revenue/Mo"] / cate_df["Revenue/Mo LY"] - 1
    cate_df["Qty YoY"] = cate_df["Quantity/Mo"] / cate_df["Quantity/Mo LY"] - 1
    cate_df = cate_df.reindex(
        ["Category", "Brand", "Avg Price", "Avg Price MoM", "Avg Price YoY", "Quantity/Mo", "Qty by %", "Qty MoM", "Qty YoY", "Revenue/Mo", "Revenue by %", "Revenue MoM", "Revenue YoY"],
        axis=1,
    )
    cate_df.to_excel(writer_s, sheet_name="Category", index=False)

    for c, l in category.items():
        top_df = market[(market.Type.isin(l[0])) & (market.Price >= l[1]) & (market.Price < l[2])]
        df_to_excel(top_df, 10, writer_s, c, prod_index)

    writer_s.close()
    if out_dashboard_json is not None:
        export_cols = [
            "ASIN",
            "Title",
            "Brand",
            "Type",
            "Price",
            "Monthly Revenue",
            "Monthly Sales",
            "Review Count",
            "Reviews Rating",
            "Fulfillment",
            "URL",
            "12mo Revenue",
            "12mo Units",
        ]
        export_df = market.copy()
        for col in export_cols:
            if col not in export_df.columns:
                export_df[col] = np.nan
        export_df = export_df[export_cols].replace({np.nan: None})
        snapshot_rows = []
        for record in export_df.to_dict(orient="records"):
            snapshot_rows.append(
                {
                    "rowSource": "structured_export",
                    "asin": record.get("ASIN"),
                    "title": record.get("Title"),
                    "brand": record.get("Brand"),
                    "typeLabel": record.get("Type"),
                    "price": record.get("Price"),
                    "monthlyRevenue": record.get("Monthly Revenue"),
                    "monthlyUnits": record.get("Monthly Sales"),
                    "reviewCount": record.get("Review Count"),
                    "rating": record.get("Reviews Rating"),
                    "fulfillment": record.get("Fulfillment"),
                    "url": record.get("URL"),
                    "estimatedRevenue12mo": record.get("12mo Revenue"),
                    "estimatedUnits12mo": record.get("12mo Units"),
                }
            )
        out_dashboard_json.parent.mkdir(parents=True, exist_ok=True)
        out_dashboard_json.write_text(
            json.dumps(
                {
                    "month": month,
                    "snapshotDate": f"{month[:4]}-{month[4:6]}-01",
                    "snapshotRows": snapshot_rows,
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Wrote {out_dashboard_json}")
    print(f"Wrote {out_report}")
    print(f"Wrote {out_summary}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
