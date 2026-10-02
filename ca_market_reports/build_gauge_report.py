"""OBD gauge competitor workbook (CA or US; single month, Helium 10 Black Box estimates in the market currency).

  <M>_OBD_Gauge_Competitor_Report_<m>.xlsx
    Read Me, Summary, Top 50, Innova, brand tabs,
    [CA only] Price Ladder (Model A), Feature Matrix (Model A), App-Gauge Proxy (Model B),
    [CA + benchmark] US Benchmark, US vs CA Same-ASIN,
    All Products, Dedupe & Classification Audit, Excluded, Source & Method, Metadata

Scope predicates (ca_common, never conflated): workbook scope = class in GAUGE_WORKBOOK_CLASSES; device scope = class in
GAUGE_DEVICE_CLASSES; core device = device scope AND NOT borderline. Summary totals, brand thresholds, tiers, shares and the
benchmark use core devices. Every number is a static value (ca_common formula policy). Run:
  ca_market_reports/run.sh ca_market_reports/build_gauge_report.py --market CA --month 202609 --benchmark-market US [--overwrite]
  dev: ... --from-normalized <csv> [--benchmark-from-normalized <csv>] --out-dir tmp/ca_scratch/fx --runs-dir tmp/ca_scratch/runs
"""
from __future__ import annotations

import argparse
import math
import shutil
import sys
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from ca_market_reports import ca_common as C
from ca_market_reports import ca_xlsx_style as X
from ca_market_reports.ca_xlsx_style import Book, ColumnSpec as Col, TableSpec

APP_GAUGE_BRANDS_DEFAULT = C.MAPS_DIR / "ca_app_gauge_brands.csv"
GAUGE_MAP_DEFAULT = C.MAPS_DIR / "ca_gauge_map.csv"
APP_FEATURE_MATRIX_DEFAULT = C.MAPS_DIR / "ca_app_feature_matrix.csv"
# display headers, 1:1 with ca_common.APP_FEATURE_MATRIX_COLUMNS (frozen CSV schema); rows in APP_FEATURE_MATRIX_APPS order
APP_MATRIX_HEADERS: tuple[str, ...] = ("App", "Vendor", "Live gauges", "Custom dashboards", "HUD/mirror mode", "Alarms", "Data logging",
                                       "Enhanced/diesel PIDs", "CarPlay/Android Auto", "Subscription", "Canada availability", "Source",
                                       "Accessed", "Note")
APP_MATRIX_WIDTHS: tuple[float, ...] = (24, 18, 11, 12, 12, 10, 11, 14, 13, 20, 18, 44, 11, 30)
if len(APP_MATRIX_HEADERS) != len(C.APP_FEATURE_MATRIX_COLUMNS) or len(APP_MATRIX_WIDTHS) != len(APP_MATRIX_HEADERS):
    raise AssertionError("APP_MATRIX_HEADERS drifted from ca_common.APP_FEATURE_MATRIX_COLUMNS")
APP_MATRIX_PLACEHOLDER = "GAP"
APP_MATRIX_NOTE = ("Features as described by app-store listings / vendor pages on the accessed date; 'GAP' = not found. "
                   "Not derived from Helium 10.")
DECISION_STEMS: tuple[str, ...] = ("dedupe_audit", "brand_recovery", "type_decisions", "gauge_decisions")   # frozen run decisions
INNOVA_COUNT_CELL = "B3"       # gauge Innova tab: A3 = the device-count line, B3 = the same count as a number (role kpi)
SAME_ASIN_COUNT_CELL = "B3"    # US vs CA Same-ASIN: A3 = "Listings in both marketplaces", B3 = the intersection count (role kpi)
FEATURE_HEADERS: dict[str, str] = {"data_source": "Data Source", "screen_type": "Screen Type", "fuel_scope": "Fuel Scope",
                                   "alarms": "Alarms", "multi_gauge": "Multi-gauge", "gesture_control": "Gesture Control",
                                   "kmh_mph": "km/h–mph", "lordco_type_unit": "Lordco-type Unit"}
FEATURE_BOOLS: tuple[str, ...] = ("alarms", "multi_gauge", "gesture_control", "kmh_mph", "lordco_type_unit")
US_BENCHMARK_SOURCE = ("US-OBD-GAUGE export + gauge-class candidates from the US code-reader export; raw Helium 10 estimates, "
                       "no actuals overlay")
CAVEAT_US_RAW = "US figures are raw Helium 10 estimates without the monthly pipeline's actuals overlay."
CAVEAT_CA_EDITION = "'CA Edition' in Edge part numbers = California/CARB, not Canada."
DEDUPE_RULE = ("Within each source export, rows are deduped to one row per ASIN; the winner is chosen by revenue (desc), then BSR "
               "(asc, missing last), then export date (asc), then file path (lexical), then source row index. The code-reader and "
               "gauge exports are then unioned with the code-reader row as master for ASINs present in both (source_set = both); "
               "the gauge row is kept in the dedupe audit. The winning row is classified, then aggregated.")


SHARE_TITLE = "Gauge share of the code-reader market"
SHARE_ROW_LABELS: tuple[str, ...] = ("Code-reader export total", "(a) Gauge devices inside the code-reader export",
                                     "(b) All core gauge devices (CR ∪ gauge export)", "(b) denominator: CR total + gauge-only rows")
SHARE_NOTE = ("Core devices = device scope, not borderline. (a) = core devices present in the code-reader export ÷ the FULL "
              "code-reader export (before any gauge candidate filter). (b) = all core devices ÷ (full code-reader export + core "
              "devices found only in the gauge export). Shares of revenue and of units are computed within this market.")
BENCH_SHARE_TITLE = "Gauge share of the code-reader market — CA vs US"
BENCH_SHARE_ROWS: tuple[str, ...] = ("(a) Gauge devices inside the code-reader export: share of revenue",
                                     "(a) Gauge devices inside the code-reader export: share of units",
                                     "(b) All core gauge devices (CR ∪ gauge export): share of revenue",
                                     "(b) All core gauge devices (CR ∪ gauge export): share of units")
FUEL_TITLE = "Fuel split (core devices)"
FUEL_NOTE = ("Fuel scope is derived from model numbers (tuners/monitors) or title tokens; HUD/gauge-display listings are generic "
             "OBD-II products and stay 'unspecified' unless the title states a fuel.")


def fuel_headers(ccy: str) -> list[str]:
    """Fuel split columns, built from ca_common.FEATURE_FUEL_SCOPE at runtime (new fuel values flow in automatically)."""
    return [h for f in C.FEATURE_FUEL_SCOPE for h in (f"{f}: # ASINs", f"{f}: Monthly Rev ({ccy})", f"{f}: Monthly Units")]


def code_reader_totals(df: pd.DataFrame, market: str) -> dict:
    """Totals of the FULL code-reader export (for US: before the gauge candidate filter)."""
    X.require_columns(df, ("asin", "revenue_month", "units_month"), f"{market} code-reader export")
    f = X.coerce_frame(df[["asin", "revenue_month", "units_month"]])
    for col in ("revenue_month", "units_month"):
        bad = f.loc[f[col].isna() | (f[col] < 0), "asin"].tolist()
        if bad:
            raise ValueError(f"{market} code-reader export: missing/negative {col} for {bad[:10]}")
    if f["asin"].duplicated().any():
        raise ValueError(f"{market} code-reader export: duplicate ASINs {f.loc[f['asin'].duplicated(), 'asin'].tolist()[:10]}")
    return {"n": int(f["asin"].nunique()), "rev": float(f["revenue_month"].sum()), "units": float(f["units_month"].sum()),
            "asins": frozenset(f["asin"])}


def market_share_rows(u: pd.DataFrame, cr: dict, market: str) -> list[dict]:
    core = u[u["_core"]]
    a = core[core["source_set"].isin(["code_reader", "both"])]
    g = core[core["source_set"] == "gauge"]
    missing = sorted(set(a["asin"]) - cr["asins"])
    if missing:
        raise ValueError(f"{market}: core rows marked code_reader/both are not in the code-reader export: {missing[:10]}")
    overlap = sorted(set(g["asin"]) & cr["asins"])
    if overlap:
        raise ValueError(f"{market}: gauge-only rows are also in the code-reader export: {overlap[:10]}")
    den_n, den_rev = cr["n"] + int(g["asin"].nunique()), cr["rev"] + float(g["revenue_month"].sum())
    den_u = cr["units"] + float(g["units_month"].sum())
    a_rev, a_u = float(a["revenue_month"].sum()), float(a["units_month"].sum())
    b_rev, b_u = float(core["revenue_month"].sum()), float(core["units_month"].sum())
    L = SHARE_ROW_LABELS
    return [{"label": L[0], "n": cr["n"], "rev": cr["rev"], "units": cr["units"], "s_rev": X.safe_div(cr["rev"], cr["rev"]),
             "s_u": X.safe_div(cr["units"], cr["units"])},
            {"label": L[1], "n": int(a["asin"].nunique()), "rev": a_rev, "units": a_u, "s_rev": X.safe_div(a_rev, cr["rev"]),
             "s_u": X.safe_div(a_u, cr["units"])},
            {"label": L[2], "n": int(core["asin"].nunique()), "rev": b_rev, "units": b_u, "s_rev": X.safe_div(b_rev, den_rev),
             "s_u": X.safe_div(b_u, den_u)},
            {"label": L[3], "n": den_n, "rev": den_rev, "units": den_u, "s_rev": X.safe_div(den_rev, den_rev),
             "s_u": X.safe_div(den_u, den_u)}]


def _scope_text(cls: str) -> str:
    if cls in C.GAUGE_DEVICE_CLASSES:
        return "device: counted in totals, tiers, shares, benchmark"
    if cls in C.GAUGE_ADJACENT_CLASSES:
        return "adjacent: shown, excluded from OBD gauge totals"
    if cls in C.GAUGE_ACCESSORY_CLASSES:
        return "accessory: shown, excluded from device totals"
    if cls in C.GAUGE_EXCLUDED_CLASSES:
        return "excluded: Excluded tab only"
    return "review: Excluded tab + review queue"


# --------------------------------------------------------------------------------------
# Union assembly + enrichment
# --------------------------------------------------------------------------------------
def read_gauge_map(path: Path) -> pd.DataFrame:
    gm = pd.read_csv(path, dtype=str, keep_default_na=False)
    return gm


def _assemble_union_from_loader(ds: C.CaDataset, gauge_map_path: Path, runs_dir: Path, rederive: bool) -> pd.DataFrame:
    """Real path: candidate pre-filter (US code-reader export only) -> union -> classify -> freeze -> type conflicts."""
    from ca_market_reports.ca_load import union_gauge_frames  # ASSEMBLY: ca_load.union_gauge_frames
    from ca_market_reports.ca_gauge_classification import candidate_mask, classify_gauges  # ASSEMBLY: ca_gauge_classification
    from ca_market_reports.ca_gauge_classification import freeze_gauge_decisions  # ASSEMBLY: not in ca_common's frozen list

    if ds.gauge_set is None:
        raise ValueError(f"{ds.market} gauge workbook needs the gauge export (dataset.gauge_set is None)")
    gauge_map_df = read_gauge_map(gauge_map_path)
    cr = ds.code_reader
    if ds.market == "US":
        cr = cr[candidate_mask(cr, gauge_map_df)].copy()  # ASSEMBLY: ca_gauge_classification.candidate_mask (before the union)
    audit_rows: list[dict] = []
    union = union_gauge_frames(cr, ds.gauge_set, audit_rows)  # ASSEMBLY: ca_load.union_gauge_frames
    if audit_rows:
        ds.audits["dedupe_audit"] = pd.concat([ds.audits["dedupe_audit"], pd.DataFrame(audit_rows, columns=list(C.DEDUPE_AUDIT_COLUMNS))],
                                              ignore_index=True)
    prior_path = C.run_file(Path(runs_dir), ds.month, "gauge_decisions", f"{ds.market}_gauge")
    prior = None if (rederive or not prior_path.exists()) else pd.read_csv(prior_path, dtype=str, keep_default_na=False)
    union = classify_gauges(union, gauge_map_df, prior, month=ds.month)  # ASSEMBLY: ca_gauge_classification.classify_gauges
    freeze_gauge_decisions(union, Path(runs_dir), ds.month, ds.market, rederive=rederive)  # ASSEMBLY: returns the decision table
    return union   # type conflicts are flagged in gauge_union (after enrichment, both input modes)


def _dev_union(ds: C.CaDataset) -> pd.DataFrame:
    cr = ds.code_reader
    gs = ds.gauge_set if ds.gauge_set is not None else cr.iloc[0:0]
    return pd.concat([cr, gs[~gs["asin"].isin(set(cr["asin"]))]], ignore_index=True)


def enrich_union(union: pd.DataFrame, market: C.Market, notes: list[str]) -> pd.DataFrame:
    """Validate the classified union and add derived helper columns (_core, _subtype, _gtier, _url)."""
    X.require_columns(union, C.BASE_ROW_COLUMNS, f"{market.code} gauge union")
    u = X.coerce_frame(union)
    X.check_sales_columns(u, f"{market.code} gauge union")
    unknown = sorted(set(u["gauge_class"]) - set(C.GAUGE_CLASS_NAMES))
    if unknown:
        raise ValueError(f"unknown gauge_class values {unknown} (every union row must be classified)")
    scope = u["gauge_class"].isin(C.GAUGE_WORKBOOK_CLASSES)
    bad = u.loc[u["gauge_in_scope"].astype(bool) != scope, "asin"].tolist()
    if bad:
        raise ValueError(f"gauge_in_scope contradicts gauge_class for {bad[:10]}")
    device = u["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)
    if "gauge_device_scope" not in u.columns:
        u["gauge_device_scope"] = device
        notes.append("gauge_device_scope absent in the input: derived from gauge_class (class in GAUGE_DEVICE_CLASSES)")
    else:
        bad = u.loc[u["gauge_device_scope"].astype(bool) != device, "asin"].tolist()
        if bad:
            raise ValueError(f"gauge_device_scope contradicts gauge_class for {bad[:10]}")
    if "borderline" not in u.columns:
        u["borderline"] = False
        notes.append("borderline absent in the input: treated as False (no borderline rows)")
    missing_feat = [c for c in C.FEATURE_COLUMNS + ("feature_verified_date",) if c not in u.columns]
    for c in missing_feat:
        u[c] = ""
    if missing_feat:
        notes.append(f"feature columns absent in the input, shown empty: {', '.join(missing_feat)}")
    u["gauge_device_scope"] = u["gauge_device_scope"].astype(bool)
    u["borderline"] = u["borderline"].astype(bool)
    bad = u.loc[u["borderline"] & ~u["gauge_device_scope"], "asin"].tolist()
    if bad:
        raise ValueError(f"borderline rows outside device scope: {bad[:10]}")
    u["_core"] = u["gauge_device_scope"] & ~u["borderline"]
    u["_subtype"] = u["gauge_class"].map(C.GAUGE_SUBTYPE_LABELS)
    no_price = u.loc[u["gauge_device_scope"] & u["price"].isna(), "asin"].tolist()
    if no_price:
        raise ValueError(f"device-scope rows without a price (no tier possible): {no_price[:10]}")
    u["_gtier"] = [X.tier_of(p, C.GAUGE_TIERS) if not math.isnan(p) else "" for p in u["price"]]
    return X.add_canonical_url(u, market)


def gauge_union(ds: C.CaDataset, *, preclassified: bool, gauge_map_path: Path, runs_dir: Path,
                rederive: bool) -> tuple[pd.DataFrame, list[str]]:
    """(enriched union, notes). Public 2-tuple contract (validate_outputs.derive_data unpacks it)."""
    u, notes, _ = gauge_union_with_flags(ds, preclassified=preclassified, gauge_map_path=gauge_map_path, runs_dir=runs_dir,
                                         rederive=rederive)
    return u, notes


def gauge_union_with_flags(ds: C.CaDataset, *, preclassified: bool, gauge_map_path: Path, runs_dir: Path,
                           rederive: bool) -> tuple[pd.DataFrame, list[str], bool]:
    """(enriched union, notes, fuel_absent) — fuel_absent: the input carried no fuel_scope column (dev frames)."""
    notes: list[str] = []
    if preclassified:
        union = _dev_union(ds)
        notes.append("union taken from a normalized, already-classified frame (code-reader row kept for ASINs in both sets)")
    else:
        union = _assemble_union_from_loader(ds, gauge_map_path, runs_dir, rederive)
    if union["asin"].duplicated().any():
        raise ValueError(f"duplicate ASINs after the union: {union.loc[union['asin'].duplicated(), 'asin'].tolist()[:10]}")
    fuel_absent = "fuel_scope" not in union.columns
    u = enrich_union(union, C.MARKETS[ds.market], notes)
    from ca_market_reports.ca_types import flag_type_conflicts  # ASSEMBLY: ca_types.flag_type_conflicts
    u = flag_type_conflicts(u)   # device-scope rows typed Tablet/Handheld/Dongle -> type_conflict (idempotent OR)
    if fuel_absent:
        notes.append("fuel_scope absent in the input: core devices are counted as 'unspecified' in the fuel split")
    return u, notes, fuel_absent


def read_app_gauge_brands(path: Path) -> pd.DataFrame:
    app = pd.read_csv(path, dtype=str, keep_default_na=False)
    X.require_columns(app, C.APP_GAUGE_BRANDS_COLUMNS, str(path))
    app["brand_key"] = app["brand_key"].str.strip()
    dup = app.loc[app["brand_key"].duplicated(), "brand_key"].tolist()
    if dup:
        raise ValueError(f"{path}: duplicate brand_key rows {dup}")
    app["_capable"] = [None if str(v).strip() == "" else X.parse_bool_value(v, column="app_gauge_capable", blank_is_false=False)
                       for v in app["app_gauge_capable"]]
    return app


def write_conflict_review(u: pd.DataFrame, market: str, month: str, runs_dir: Path) -> tuple[int, Path | None]:
    """CA only: gauge_type_conflict rows -> runs/<m>/type_review_CA_code_reader_<m>.csv (V17). Built with
    ca_types.build_type_review and merged with ca_types.write_type_review (an existing human reviewed_type is kept).
    The US workbook never writes a review file (US Type assignment is out of scope)."""
    if market != "CA":
        return 0, None
    from ca_market_reports import ca_types  # ASSEMBLY: ca_types.build_type_review / write_type_review
    rows = u[u["type_conflict"].astype(bool)]
    if rows.empty:
        print("type_review: 0 gauge_type_conflict rows (nothing to merge)")
        return 0, None
    review = ca_types.build_type_review(rows)
    other = sorted(set(review["review_reason"]) - {"gauge_type_conflict"})
    if other or len(review) != len(rows):
        raise AssertionError(f"conflict review rows carry unexpected reasons {other} ({len(review)} of {len(rows)} rows)")
    path = C.run_file(Path(runs_dir), month, "type_review", "CA_code_reader")
    ca_types.write_type_review(review, path)
    print(f"type_review: {len(review)} gauge_type_conflict rows merged into {path}")
    return len(review), path


def read_app_feature_matrix(path: Path) -> pd.DataFrame:
    """maps/ca_app_feature_matrix.csv -> one row per APP_FEATURE_MATRIX_APPS app, in that order. An app absent from the CSV
    becomes a row of 'GAP'; values of present rows are shown as written. Unknown or duplicate apps fail loudly."""
    m = pd.read_csv(path, dtype=str, keep_default_na=False)
    X.require_columns(m, C.APP_FEATURE_MATRIX_COLUMNS, str(path))
    m["app"] = m["app"].str.strip()
    unknown = sorted(set(m["app"]) - set(C.APP_FEATURE_MATRIX_APPS))
    if unknown:
        raise ValueError(f"{path}: apps not in APP_FEATURE_MATRIX_APPS: {unknown}")
    dup = sorted(set(m.loc[m["app"].duplicated(), "app"]))
    if dup:
        raise ValueError(f"{path}: duplicate app rows {dup}")
    by_app = {r["app"]: r for r in m[list(C.APP_FEATURE_MATRIX_COLUMNS)].to_dict("records")}
    rows = []
    for app in C.APP_FEATURE_MATRIX_APPS:
        if app in by_app:
            rows.append(by_app[app])
        else:
            rows.append({c: (app if c == "app" else APP_MATRIX_PLACEHOLDER) for c in C.APP_FEATURE_MATRIX_COLUMNS})
    return pd.DataFrame(rows, columns=list(C.APP_FEATURE_MATRIX_COLUMNS))


def modelb_universe(ds: C.CaDataset, app_map_path: Path) -> pd.DataFrame:
    """Model B universe = CA code-reader rows typed Dongle, joined with the brand-level app-gauge map on brand_key."""
    cr = X.coerce_frame(ds.code_reader)
    X.require_columns(cr, C.BASE_ROW_COLUMNS, "CA code-reader frame")
    uni = cr[cr["type"] == "Dongle"].copy()
    X.check_sales_columns(uni, "Model B universe")
    app = read_app_gauge_brands(app_map_path)
    m = app.set_index("brand_key")
    cap = [m["_capable"].get(k, "missing") for k in uni["brand_key"]]
    uni["app_gauge_capable"] = [None if c == "missing" else c for c in cap]
    uni["_app_capable"] = ["not in map" if c == "missing" else ("undecided" if c is None else ("Y" if c else "N")) for c in cap]
    uni["_app_name"] = [m["app_name"].get(k, "") for k in uni["brand_key"]]
    uni["app_gauge_source_url"] = [m["source_url"].get(k, "") for k in uni["brand_key"]]
    uni["app_gauge_accessed"] = [m["accessed"].get(k, "") for k in uni["brand_key"]]
    uni["_dtier"] = [X.tier_of(p, C.DONGLE_TIERS) for p in uni["price"]]
    uni["_s2r"] = [X.safe_div(u, r) if r and not math.isnan(r) else float("nan") for u, r in zip(uni["units_month"], uni["review_count"])]
    return X.add_canonical_url(uni, C.MARKETS["CA"])


# --------------------------------------------------------------------------------------
# Context
# --------------------------------------------------------------------------------------
@dataclass
class GCtx:
    ds: C.CaDataset
    market: C.Market
    u: pd.DataFrame
    notes: list[str]
    month: str
    mon: str
    sub: str
    ccy: str
    cr_totals: dict = field(default_factory=dict)       # FULL code-reader export totals (before any candidate filter)
    fuel_absent: bool = False
    bench: C.CaDataset | None = None
    bu: pd.DataFrame | None = None
    bench_notes: list[str] = field(default_factory=list)
    bench_cr_totals: dict = field(default_factory=dict)
    modelb: pd.DataFrame | None = None
    app_matrix: pd.DataFrame | None = None
    app_matrix_path: Path | None = None

    @property
    def core(self) -> pd.DataFrame:
        return self.u[self.u["_core"]]

    @property
    def device(self) -> pd.DataFrame:
        return self.u[self.u["gauge_device_scope"]]

    @property
    def code(self) -> str:
        return self.market.code


def _stats(sub: pd.DataFrame, total_rev: float) -> dict:
    rev, units = float(sub["revenue_month"].sum()), float(sub["units_month"].sum())
    return {"n": int(sub["asin"].nunique()), "rev": rev, "units": units, "share": X.safe_div(rev, total_rev),
            "avg_price": X.safe_div(rev, units), "rating": X.weighted_rating(sub), "n_sales": int((sub["units_month"] > 0).sum())}


# --------------------------------------------------------------------------------------
# Sheets
# --------------------------------------------------------------------------------------
def _read_me(book: Book, c: GCtx) -> None:
    ws = book.sheet("Read Me")
    files = "; ".join(f"{n} ({r} rows)" for n, r in c.ds.raw_files) or "none recorded"
    paras = ["# Purpose",
             f"Monthly snapshot of OBD gauge, HUD and gauge-tuner listings on {c.market.domain} ({c.mon}), built from Helium 10 "
             f"Black Box exports. Revenue and unit figures are Helium 10 estimates in {c.ccy}."]
    if c.code == "CA":
        paras += ["# Business models",
                  "Model A — dedicated gauge/HUD device: a stand-alone display (windshield HUD, dash-top LCD, in-dash round gauge, "
                  "or a tuner with a gauge screen). Sheets: Price Ladder (Model A), Feature Matrix (Model A).",
                  "Model B — app-based gauges on an OBD dongle: a Bluetooth/Wi-Fi dongle whose phone app shows live gauges. Proxy: "
                  "code-reader listings typed Dongle, flagged by the brand-level app-gauge map (maps/ca_app_gauge_brands.csv). "
                  "Sheet: App-Gauge Proxy (Model B)."]
        if c.bench is not None:
            paras += ["US comparison: US Benchmark (brand, sub-type and tier tables side by side, native currencies) and US vs CA "
                      "Same-ASIN (listings sold in both marketplaces)."]
    paras += ["# Source files", files, "# Dedupe rule", DEDUPE_RULE,
              "# Classification",
              "Each union row gets one gauge class (table below). Human ASIN decisions in maps/ca_gauge_map.csv override every "
              "rule; otherwise the first matching title rule wins. Workbook scope = device + adjacent + accessory classes. "
              "Device scope = the five device classes. Core device = device scope and not borderline; Summary totals, brand "
              "thresholds, price tiers and shares use core devices.",
              "# Caveats",
              CAVEAT_US_RAW, CAVEAT_CA_EDITION,
              "Helium 10 revenue and unit figures are estimates; no calibration to actual sales is applied.",
              "Single month: no month-over-month or Rolling-12 comparison.",
              "No currency conversion: CAD and USD amounts are never added, divided or ranked together.",
              "Feature flags are parsed from listing titles and are unverified unless a Verified Date is shown."]
    tr = book.text(ws, f"{c.code} OBD Gauge Competitor Report — Read Me ({c.mon})", paras, role="read_me")
    rows = pd.DataFrame([{"code": code, "cls": name, "label": C.GAUGE_SUBTYPE_LABELS[name], "scope": _scope_text(name)}
                         for code, name in C.GAUGE_CLASSES])
    cols = [Col("Code", "code", "text", 8), Col("Gauge class", "cls", "text", 26), Col("Label", "label", "text", 30),
            Col("Scope", "scope", "text", 48)]
    book.table(ws, TableSpec("Read Me", "read_me", "Gauge taxonomy (first matching rule wins; ASIN map decisions override)", cols,
                             rows, None, None, (c.code,), dataset_filter="GAUGE_CLASSES"), tr.last_data_row + 2, freeze=False)
    ws.column_dimensions["A"].width = 120


def _summary(book: Book, c: GCtx) -> None:
    ws = book.sheet("Summary")
    ccy, code = c.ccy, c.code
    core, device = c.core, c.device
    # (a) brands over core devices
    shown, residual, total = X.brand_summary(core, top_n=C.SUMMARY_TOP_BRANDS)
    cols = X.summary_columns(ccy)
    tr_a = book.table(ws, TableSpec("Summary", "summary_brands", f"{code} OBD Gauge Market — Brand Summary, core devices ({c.mon})",
                                    cols, shown, X.fit(total, cols), X.fit(residual, cols), (code,), subtitle=c.sub,
                                    dataset_filter="core devices: gauge_device_scope & ~borderline"), 1)
    X.hide_zero_revenue_rows(ws, tr_a)
    # (b) sub-type mix over device scope (incl. borderline); GPS-only HUD in its own adjacent block
    dev_rev = float(device["revenue_month"].sum())
    rows = []
    for cls in C.GAUGE_DEVICE_CLASSES:
        d = _stats(device[device["gauge_class"] == cls], dev_rev)
        d["label"] = C.GAUGE_SUBTYPE_LABELS[cls]
        rows.append(d)
    cols_b = [Col("Sub-type", "label", "text", 28), Col("# ASINs", "n", "int", 10), Col(f"Monthly Rev ({ccy})", "rev", "money", 15),
              Col("Monthly Units", "units", "int", 12), Col("Rev share", "share", "pct", 11),
              Col(f"Avg price ({ccy})", "avg_price", "money2", 12), Col("Avg rating", "rating", "rating", 10)]
    tot = _stats(device, dev_rev)
    tot["label"] = C.TOTAL_ROW_LABEL
    tr_b = book.table(ws, TableSpec("Summary", "subtype_mix", "Device sub-type mix (device scope incl. borderline)", cols_b,
                                    pd.DataFrame(rows), X.fit(tot, cols_b), None, (code,),
                                    note="Avg price = revenue ÷ units; Avg rating = units-weighted mean over ratings > 0.",
                                    dataset_filter="gauge_device_scope"), X.table_end(tr_a) + 3)
    adj = c.u[c.u["gauge_class"].isin(C.GAUGE_ADJACENT_CLASSES)]
    rows = []
    for cls in C.GAUGE_ADJACENT_CLASSES:
        d = _stats(adj[adj["gauge_class"] == cls], float("nan"))
        d["label"] = C.GAUGE_SUBTYPE_LABELS[cls]
        rows.append(d)
    tr_adj = book.table(ws, TableSpec("Summary", "subtype_mix", "Adjacent (excluded from totals)", cols_b, pd.DataFrame(rows), None,
                                      None, (code,), dataset_filter="gauge_class in GAUGE_ADJACENT_CLASSES"), X.table_end(tr_b) + 3)
    # (c) tier x sub-type matrices over core devices
    r = X.table_end(tr_adj) + 3
    for metric, kind, hdr in (("revenue_month", "money", f" ({ccy})"), ("units_month", "int", "")):
        mrows = []
        for label, _, _ in C.GAUGE_TIERS:
            t = core[core["_gtier"] == label]
            d = {"tier": label}
            for cls in C.GAUGE_DEVICE_CLASSES:
                d[cls] = float(t.loc[t["gauge_class"] == cls, metric].sum())
            d["all"] = float(t[metric].sum())
            mrows.append(d)
        tot = {"tier": C.TOTAL_ROW_LABEL, "all": float(core[metric].sum())}
        for cls in C.GAUGE_DEVICE_CLASSES:
            tot[cls] = float(core.loc[core["gauge_class"] == cls, metric].sum())
        cols_c = ([Col("Price tier", "tier", "text", 28)] + [Col(C.GAUGE_SUBTYPE_LABELS[cls] + hdr, cls, kind, 15) for cls in C.GAUGE_DEVICE_CLASSES]
                  + [Col("Total" + hdr, "all", kind, 15)])
        what = f"Monthly Rev ({ccy})" if metric == "revenue_month" else "Monthly Units"
        tr_c = book.table(ws, TableSpec("Summary", "tier_matrix", f"Price tier × sub-type — {what}, core devices", cols_c,
                                        pd.DataFrame(mrows), tot, None, (code,),
                                        dataset_filter="core devices; tiers = GAUGE_TIERS on price (half-open)"), r)
        r = X.table_end(tr_c) + 3
    # (d) KPI block
    acc = c.u[c.u["gauge_class"].isin(C.GAUGE_ACCESSORY_CLASSES)]
    items = [(f"Core device revenue ({ccy})", float(core["revenue_month"].sum()), "money"),
             ("Core device units", float(core["units_month"].sum()), "int"),
             ("Core device # ASINs", int(core["asin"].nunique()), "int"),
             (f"Device revenue incl. borderline ({ccy})", float(device["revenue_month"].sum()), "money"),
             (f"Gauge accessories revenue ({ccy})", float(acc["revenue_month"].sum()), "money"),
             (f"Adjacent GPS-only HUD revenue ({ccy})", float(adj["revenue_month"].sum()), "money"),
             ("# core device ASINs with sales > 0", int((core["units_month"] > 0).sum()), "int")]
    tr_d = book.kpi(ws, r, items, title="Key figures", dataset_filter="see metric labels")
    # charts first: anchors sit beside (a) and (b), left of the wider tables written below
    book.bar(ws, tr_a, "Brand", f"Monthly Rev ({ccy})", f"Core device revenue by brand ({ccy})")
    book.pie(ws, tr_b, "Sub-type", "Rev share", "Device revenue by sub-type")
    # (e) gauge share of the whole code-reader market (this market only; the CA vs US view is on US Benchmark)
    cols_e = [Col("Measure", "label", "text", 34), Col("# ASINs", "n", "int", 10), Col(f"Monthly Rev ({ccy})", "rev", "money", 15),
              Col("Monthly Units", "units", "int", 12), Col("Share of revenue", "s_rev", "pct2", 12),
              Col("Share of units", "s_u", "pct2", 12)]
    tr_e = book.table(ws, TableSpec("Summary", "kpi", SHARE_TITLE, cols_e, pd.DataFrame(market_share_rows(c.u, c.cr_totals, code)),
                                    None, None, (code,), note=SHARE_NOTE,
                                    dataset_filter="core devices vs the full code-reader export"), X.table_end(tr_d) + 3)
    # (f) fuel split of core devices by sub-type
    fuels = tuple(C.FEATURE_FUEL_SCOPE)
    fuel = pd.Series("unspecified", index=core.index) if c.fuel_absent else core["fuel_scope"].astype(str)
    bad = sorted(set(fuel) - set(fuels))
    if bad:
        raise ValueError(f"core devices with fuel_scope outside FEATURE_FUEL_SCOPE {fuels}: {bad} "
                         f"(e.g. {core.loc[~fuel.isin(fuels), 'asin'].tolist()[:5]})")

    def fuel_row(sub: pd.DataFrame, f_sub: pd.Series, label: str) -> dict:
        d = {"label": label}
        for i, f in enumerate(fuels):
            m = f_sub == f
            d[f"f{i}_n"] = int(sub.loc[m, "asin"].nunique())
            d[f"f{i}_rev"] = float(sub.loc[m, "revenue_month"].sum())
            d[f"f{i}_units"] = float(sub.loc[m, "units_month"].sum())
        return d

    frows = [fuel_row(core[core["gauge_class"] == cls], fuel[core["gauge_class"] == cls], C.GAUGE_SUBTYPE_LABELS[cls])
             for cls in C.GAUGE_DEVICE_CLASSES]
    hdrs = fuel_headers(ccy)
    cols_f = [Col("Sub-type", "label", "text", 28)]
    for i, _ in enumerate(fuels):
        cols_f += [Col(hdrs[3 * i], f"f{i}_n", "int", 10), Col(hdrs[3 * i + 1], f"f{i}_rev", "money", 14),
                   Col(hdrs[3 * i + 2], f"f{i}_units", "int", 11)]
    book.table(ws, TableSpec("Summary", "subtype_mix", FUEL_TITLE, cols_f, pd.DataFrame(frows),
                             fuel_row(core, fuel, C.TOTAL_ROW_LABEL), None, (code,), note=FUEL_NOTE,
                             dataset_filter="core devices; fuel_scope in FEATURE_FUEL_SCOPE"), X.table_end(tr_e) + 3)


def _top50_columns(ccy: str) -> list[Col]:
    return [Col("Ranking", "_rank", "int", 9), Col("ASIN", "asin", "text", 13), Col("Product Name", "title", "text", 60),
            Col("Brand", "brand_display", "text", 16), Col("Sub-type", "_subtype", "text", 22), Col("Data Source", "data_source", "text", 11),
            Col("Screen Type", "screen_type", "text", 18), Col("Fuel Scope", "fuel_scope", "text", 13),
            Col(f"Price ({ccy})", "price", "money2", 12), Col(f"Est. Monthly Rev ({ccy})", "revenue_month", "money", 15),
            Col("Est. Monthly Units", "units_month", "int", 12), Col("# Reviews", "review_count", "int", 10),
            Col("Avg Rating", "rating", "rating", 9), Col("Listing Age (Months)", "listing_age_months", "int", 11),
            Col("Last Year Sales", "last_year_units", "int", 12), Col("Sales YoY %", "yoy_units_pct", "pct", 11),
            Col("90-day Sales Trend %", "sales_trend_90d_pct", "pct", 12), Col("Lordco-type unit", "lordco_type_unit", "bool", 11),
            Col("URL", "_url", "text", 34), Col("Link", "asin", "link", 24)]


def _top50(book: Book, c: GCtx) -> None:
    ws = book.sheet("Top 50")
    cols = _top50_columns(c.ccy)
    shown, residual, total = X.top_listings(c.core, by="revenue", n=C.TOP_N)
    tr = book.table(ws, TableSpec("Top 50", "top_by_revenue", f"Top {C.TOP_N} core gauge devices — Rank by Revenue ({c.mon})", cols,
                                  shown, X.fit(total, cols), X.fit(residual, cols), (c.code,), subtitle=c.sub,
                                  dataset_filter="core devices"), 1)
    shown, residual, total = X.top_listings(c.core, by="units", n=C.TOP_N)
    book.table(ws, TableSpec("Top 50", "top_by_units", f"Top {C.TOP_N} core gauge devices — Rank by Units", cols, shown,
                             X.fit(total, cols), X.fit(residual, cols), (c.code,), dataset_filter="core devices"), X.table_end(tr) + 4)


def _modelb_hw_columns(ccy: str) -> list[Col]:
    return [Col("Product Name", "title", "text", 60), Col("ASIN", "asin", "text", 13), Col("Type", "type", "text", 10),
            Col(f"Price ({ccy})", "price", "money2", 12), Col(f"Monthly Rev ({ccy})", "revenue_month", "money", 15),
            Col("Monthly Units", "units_month", "int", 12), Col("# of Reviews", "review_count", "int", 11),
            Col("Tool Rating", "rating", "rating", 9), Col("Listing Age (Months)", "listing_age_months", "int", 11),
            Col("Sales YoY % (Helium 10)", "yoy_units_pct", "pct", 12), Col("App gauge capable", "_app_capable", "text", 12),
            Col("URL", "_url", "text", 34), Col("Link", "asin", "link", 24)]


def _innova(book: Book, c: GCtx) -> None:
    ws = book.sheet("Innova")
    cols = _modelb_hw_columns(c.ccy)
    X.write_sheet_header(ws, f"Innova — {c.code} OBD gauge view ({c.mon})", c.sub, len(cols))
    inn_dev = c.u[(c.u["brand_key"] == "innova") & c.u["gauge_device_scope"]]
    book.line(ws, 3, f"Innova gauge/HUD device listings in this dataset: {len(inn_dev)}", role="innova",
              dataset_filter="brand_key == 'innova' & gauge_device_scope")
    tr_n = book.number(ws, 3, 2, len(inn_dev), label="Innova gauge/HUD device listings in this dataset",
                       dataset_filter="brand_key == 'innova' & gauge_device_scope")
    if ws.cell(tr_n.first_data_row, tr_n.first_col).coordinate != INNOVA_COUNT_CELL:
        raise AssertionError("Innova count cell moved")
    if c.modelb is not None:
        rows = c.modelb[c.modelb["brand_key"] == "innova"]
        total = X.fit(X.listing_totals(rows, "title", C.TOTAL_ROW_LABEL), cols)
        book.table(ws, TableSpec("Innova", "modelb_top", "Innova app-capable hardware — Model B universe (code-reader Type = Dongle)",
                                 cols, X.rank_listings(rows, "revenue"), total, None, ("CA",),
                                 dataset_filter="Model B universe & brand_key == 'innova'"), C.BRAND_TAB_RESERVED_ROWS + 1)
    else:
        X.set_text(ws.cell(5, 1), "Model B (Innova dongles with app gauges) is built in the CA workbook only.")
    book.brand_sheet_map["innova"] = "Innova"


def _brand_tabs(book: Book, c: GCtx) -> None:
    core, device = c.core, c.device
    core_rev = float(core["revenue_month"].sum())
    keys = []
    for key, g in device.groupby("brand_key", sort=False):
        if key == "innova":
            continue
        crev = float(core.loc[core["brand_key"] == key, "revenue_month"].sum())
        if crev >= C.GAUGE_BRAND_TAB_MIN_REVENUE or g["asin"].nunique() >= C.GAUGE_BRAND_TAB_MIN_ASINS:
            keys.append((-crev, -float(g["revenue_month"].sum()), str(g["brand_display"].iloc[0]), key))
    taken: set[str] = set()
    cols = X.brand_tab_columns(c.ccy, type_header="Sub-type", type_field="_subtype")
    for _, _, display, key in sorted(keys):
        rows = core[core["brand_key"] == key]
        name = C.sheet_name_for_brand(display, taken)
        X.write_brand_tab(book, name, rows, columns=cols, title=f"{display} — {c.code} core gauge devices ({c.mon})", subtitle=c.sub,
                          kpi_items=X.brand_kpi_items(rows, core_rev, c.ccy), dataset_filter=f"core devices & brand_key == {key!r}")
        book.brand_sheet_map[key] = name


def _price_ladder(book: Book, c: GCtx) -> None:
    ws = book.sheet("Price Ladder (Model A)")
    core, ccy, m = c.core, c.ccy, c.market
    core_rev = float(core["revenue_month"].sum())
    cols = [Col("Tier", "tier", "text", 12), Col("# ASINs", "n", "int", 9), Col(f"Monthly Rev ({ccy})", "rev", "money", 15),
            Col("Monthly Units", "units", "int", 12), Col("Rev share", "share", "pct", 10), Col(f"Avg price ({ccy})", "avg_price", "money2", 12),
            Col("Units-weighted rating", "rating", "rating", 11), Col("# with sales > 0", "n_sales", "int", 10),
            Col("Top ASIN", "top", "text", 13), Col("Note", "note", "text", 52)]
    rows = []
    for i, (label, lo, hi) in enumerate(C.GAUGE_TIERS):
        sub = core[core["_gtier"] == label]
        d = _stats(sub, core_rev)
        d.update(tier=label, top=X.rank_listings(sub, "revenue")["asin"].iloc[0] if len(sub) else "", note="")
        rows.append(d)
        if i < len(C.GAUGE_TIERS) - 1:
            below = core.loc[core["price"] < hi, "price"].max()
            above = core.loc[core["price"] >= hi, "price"].min()
            if pd.isna(below) and pd.isna(above):
                note = "No core device listed"
            elif pd.isna(below):
                note = f"No core device priced below {X.fmt_money(above, m, 2)}"
            elif pd.isna(above):
                note = f"No core device priced at or above {X.fmt_money(below, m, 2)}"
            else:
                note = f"No core device priced between {X.fmt_money(below, m, 2)} and {X.fmt_money(above, m, 2)}"
            rows.append({"tier": "Gap", "note": note})
    tot = _stats(core, core_rev)
    tot["tier"] = C.TOTAL_ROW_LABEL
    frame = pd.DataFrame(rows, columns=["tier", "n", "rev", "units", "share", "avg_price", "rating", "n_sales", "top", "note"])
    tr = book.table(ws, TableSpec("Price Ladder (Model A)", "price_ladder", f"Model A price ladder — core gauge devices ({c.mon})", cols,
                                  frame, X.fit(tot, cols), None, ("CA",), subtitle=c.sub,
                                  note="Tiers are half-open [low, high) on the listing price in CAD. 'Gap' rows give the empty price "
                                       "range around each tier boundary (highest core device price below it, lowest at or above it).",
                                  dataset_filter="core devices"), 1)
    cols2 = [Col("ASIN", "asin", "text", 13), Col("Brand", "brand_display", "text", 16), Col(f"Price ({ccy})", "price", "money2", 12),
             Col("Rating", "rating", "rating", 8), Col("Units", "units_month", "int", 9), Col("Reviews", "review_count", "int", 9)]
    tr2 = book.table(ws, TableSpec("Price Ladder (Model A)", "price_ladder", "Per-device data (scatter source), by price", cols2,
                                   X.rank_listings(core, "price"), None, None, ("CA",), dataset_filter="core devices"), X.table_end(tr) + 3)
    book.scatter(ws, tr2, f"Price ({ccy})", "Rating", "Rating vs price — core gauge devices")


def _feature_matrix(book: Book, c: GCtx) -> None:
    ws = book.sheet("Feature Matrix (Model A)")
    cols = [Col("ASIN", "asin", "text", 13), Col("Brand", "brand_display", "text", 16), Col("Sub-type", "_subtype", "text", 22)]
    for f in C.FEATURE_COLUMNS:
        cols.append(Col(FEATURE_HEADERS[f], f, "bool" if f in FEATURE_BOOLS else "text", 12 if f in FEATURE_BOOLS else 18))
    cols += [Col("Evidence (listing title)", "title", "text", 70), Col("Verified Date", "feature_verified_date", "text", 12)]
    book.table(ws, TableSpec("Feature Matrix (Model A)", "feature_matrix", f"Model A feature matrix — core gauge devices ({c.mon})", cols,
                             X.rank_listings(c.core, "revenue"), None, None, ("CA",), subtitle=c.sub,
                             note="Features are what the listing title claims, unverified unless dated (Verified Date).",
                             dataset_filter="core devices"), 1)


def _modelb(book: Book, c: GCtx) -> None:
    ws = book.sheet("App-Gauge Proxy (Model B)")
    uni, ccy = c.modelb, c.ccy
    uni_rev = float(uni["revenue_month"].sum())
    hw_cols = _modelb_hw_columns(ccy)
    r = X.write_sheet_header(ws, f"Model B — app-gauge proxy: CA code-reader dongles ({c.mon})", c.sub, 15,
                             note="Universe = CA code-reader listings typed Dongle. 'App gauge capable' comes from the brand-level "
                                  "map maps/ca_app_gauge_brands.csv ('not in map' = brand not yet researched).") + 1
    cols = [Col("Tier", "tier", "text", 12), Col("# ASINs", "n", "int", 9), Col(f"Monthly Rev ({ccy})", "rev", "money", 15),
            Col("Monthly Units", "units", "int", 12), Col("Rev share", "share", "pct", 10), Col(f"Avg price ({ccy})", "avg_price", "money2", 12),
            Col("# app-gauge-capable ASINs", "n_cap", "int", 13)]
    rows = []
    for label, _, _ in C.DONGLE_TIERS:
        sub = uni[uni["_dtier"] == label]
        d = _stats(sub, uni_rev)
        d.update(tier=label, n_cap=int((sub["_app_capable"] == "Y").sum()))
        rows.append(d)
    tot = _stats(uni, uni_rev)
    tot.update(tier=C.TOTAL_ROW_LABEL, n_cap=int((uni["_app_capable"] == "Y").sum()))
    tr = book.table(ws, TableSpec(ws.title, "modelb_tiers", "Dongle price tiers", cols, pd.DataFrame(rows), X.fit(tot, cols), None,
                                  ("CA",), dataset_filter="Model B universe; DONGLE_TIERS on price"), r)
    shown, residual, total = X.brand_summary(uni, top_n=C.SUMMARY_TOP_BRANDS)
    capm = uni.groupby("brand_key")["_app_capable"].first()
    appm = uni.groupby("brand_key")["_app_name"].first()
    shown["_cap"] = [capm[k] for k in shown["brand_key"]]
    shown["_app"] = [appm[k] for k in shown["brand_key"]]
    cols = X.summary_columns(ccy)[:6] + [Col("App gauge capable", "_cap", "text", 12), Col("App", "_app", "text", 34)]
    tr_b = book.table(ws, TableSpec(ws.title, "modelb_brands", "Dongle brands (Innova in red)", cols, shown, X.fit(total, cols),
                                    X.fit(residual, cols), ("CA",), dataset_filter="Model B universe"), X.table_end(tr) + 3)
    cols = [Col("Ranking", "_rank", "int", 9), Col("ASIN", "asin", "text", 13), Col("Product Name", "title", "text", 60),
            Col("Brand", "brand_display", "text", 16), Col(f"Price ({ccy})", "price", "money2", 12),
            Col(f"Monthly Rev ({ccy})", "revenue_month", "money", 15), Col("Monthly Units", "units_month", "int", 12),
            Col("# of Reviews", "review_count", "int", 11), Col("Avg Rating", "rating", "rating", 9),
            Col("Listing Age (Months)", "listing_age_months", "int", 11), Col("Sales-to-Reviews", "_s2r", "rating", 10),
            Col("Frequently Returned", "frequently_returned", "bool", 11), Col("App gauge capable", "_app_capable", "text", 12),
            Col("URL", "_url", "text", 34), Col("Link", "asin", "link", 24)]
    shown, residual, total = X.top_listings(uni, by="revenue", n=C.TIER_TAB_TOP_N)
    tr_t = book.table(ws, TableSpec(ws.title, "modelb_top", f"Top {C.TIER_TAB_TOP_N} dongles by revenue", cols, shown, X.fit(total, cols),
                                    X.fit(residual, cols), ("CA",),
                                    note="Sales-to-Reviews = estimated monthly units ÷ review count.",
                                    dataset_filter="Model B universe"), X.table_end(tr_b) + 3)
    if c.app_matrix is None:
        raise ValueError("CA gauge workbook needs the app feature matrix (maps/ca_app_feature_matrix.csv)")
    cols = [Col(h, f, "text", w) for h, f, w in zip(APP_MATRIX_HEADERS, C.APP_FEATURE_MATRIX_COLUMNS, APP_MATRIX_WIDTHS, strict=True)]
    book.table(ws, TableSpec(ws.title, "modelb_app_matrix", "App feature matrix", cols, c.app_matrix, None, None, ("CA",),
                             note=APP_MATRIX_NOTE,
                             dataset_filter=f"{c.app_matrix_path.name}: APP_FEATURE_MATRIX_APPS order; missing apps = GAP"),
               X.table_end(tr_t) + 3)
    book.bar(ws, tr_b, "Brand", f"Monthly Rev ({ccy})", f"Dongle revenue by brand ({ccy})")


def _side_by_side(ca: pd.DataFrame, us: pd.DataFrame, key: str, order: list[tuple[str, str]]) -> pd.DataFrame:
    rows = []
    for k, label in order:
        a, b = ca[ca[key] == k], us[us[key] == k]
        ca_u, us_u = float(a["units_month"].sum()), float(b["units_month"].sum())
        rows.append({"label": label, "key": k, "ca_n": int(a["asin"].nunique()), "ca_rev": float(a["revenue_month"].sum()), "ca_units": ca_u,
                     "us_n": int(b["asin"].nunique()), "us_rev": float(b["revenue_month"].sum()), "us_units": us_u,
                     "ratio": X.safe_div(us_u, ca_u)})
    return pd.DataFrame(rows, columns=["label", "key", "ca_n", "ca_rev", "ca_units", "us_n", "us_rev", "us_units", "ratio"])


def _sbs_total(ca: pd.DataFrame, us: pd.DataFrame, label: str) -> dict:
    ca_u, us_u = float(ca["units_month"].sum()), float(us["units_month"].sum())
    return {"label": label, "ca_n": int(ca["asin"].nunique()), "ca_rev": float(ca["revenue_month"].sum()), "ca_units": ca_u,
            "us_n": int(us["asin"].nunique()), "us_rev": float(us["revenue_month"].sum()), "us_units": us_u, "ratio": X.safe_div(us_u, ca_u)}


def _benchmark(book: Book, c: GCtx) -> None:
    ws = book.sheet("US Benchmark")
    ca, us = c.core, c.bu[c.bu["_core"]]

    def cols(first: str) -> list[Col]:
        return [Col(first, "label", "text", 28), Col("CA # of Listings", "ca_n", "int", 11), Col("CA Monthly Rev (CAD)", "ca_rev", "money", 15),
                Col("CA Monthly Units", "ca_units", "int", 12), Col("US # of Listings", "us_n", "int", 11),
                Col("US Monthly Rev (USD)", "us_rev", "money", 15, market="US"), Col("US Monthly Units", "us_units", "int", 12),
                Col("Units ratio US/CA", "ratio", "rating", 11)]

    r = X.write_sheet_header(ws, f"US benchmark — core gauge devices, CA vs US ({c.mon})", c.sub, 8,
                             note="Revenue is shown in each market's own currency side by side; no FX conversion and no revenue "
                                  "ratios across currencies. Units ratio = US units ÷ CA units. US = raw Helium 10 estimates "
                                  "(no actuals overlay). Tier thresholds are nominal in each market's currency.") + 1
    disp = {**dict(zip(us["brand_key"], us["brand_display"])), **dict(zip(ca["brand_key"], ca["brand_display"]))}
    ca_rev = ca.groupby("brand_key")["revenue_month"].sum()
    us_rev = us.groupby("brand_key")["revenue_month"].sum()
    keys = sorted(disp, key=lambda k: (-float(ca_rev.get(k, 0.0)), -float(us_rev.get(k, 0.0)), disp[k]))
    shown_keys, rest = keys[:C.SUMMARY_TOP_BRANDS], keys[C.SUMMARY_TOP_BRANDS:]
    frame = _side_by_side(ca, us, "brand_key", [(k, disp[k]) for k in shown_keys])
    frame["brand_key"] = frame["key"]
    residual = (_sbs_total(ca[ca["brand_key"].isin(rest)], us[us["brand_key"].isin(rest)],
                           C.RESIDUAL_ROW_LABEL.format(noun="brands", n=len(rest))) if rest else None)
    tr = book.table(ws, TableSpec("US Benchmark", "benchmark_brands", "Brands", cols("Brand"), frame, _sbs_total(ca, us, C.TOTAL_ROW_LABEL),
                                  residual, ("CA", "US"), dataset_filter="core devices, both markets"), r)
    frame = _side_by_side(ca, us, "gauge_class", [(k, C.GAUGE_SUBTYPE_LABELS[k]) for k in C.GAUGE_DEVICE_CLASSES])
    tr = book.table(ws, TableSpec("US Benchmark", "benchmark_subtypes", "Device sub-types", cols("Sub-type"), frame,
                                  _sbs_total(ca, us, C.TOTAL_ROW_LABEL), None, ("CA", "US"),
                                  dataset_filter="core devices, both markets"), X.table_end(tr) + 3)
    frame = _side_by_side(ca, us, "_gtier", [(t, t) for t, _, _ in C.GAUGE_TIERS])
    tr = book.table(ws, TableSpec("US Benchmark", "benchmark_tiers", "Price tiers (CA in CAD, US in USD)", cols("Price tier"), frame,
                                  _sbs_total(ca, us, C.TOTAL_ROW_LABEL), None, ("CA", "US"),
                                  dataset_filter="core devices, both markets; GAUGE_TIERS per market currency"), X.table_end(tr) + 3)
    # gauge share of each market's code-reader market: shares only (each computed within its own currency)
    s_ca = {d["label"]: d for d in market_share_rows(c.u, c.cr_totals, "CA")}
    s_us = {d["label"]: d for d in market_share_rows(c.bu, c.bench_cr_totals, "US")}
    L = SHARE_ROW_LABELS
    rows = [{"label": BENCH_SHARE_ROWS[0], "ca": s_ca[L[1]]["s_rev"], "us": s_us[L[1]]["s_rev"]},
            {"label": BENCH_SHARE_ROWS[1], "ca": s_ca[L[1]]["s_u"], "us": s_us[L[1]]["s_u"]},
            {"label": BENCH_SHARE_ROWS[2], "ca": s_ca[L[2]]["s_rev"], "us": s_us[L[2]]["s_rev"]},
            {"label": BENCH_SHARE_ROWS[3], "ca": s_ca[L[2]]["s_u"], "us": s_us[L[2]]["s_u"]}]
    cols_s = [Col("Measure", "label", "text", 52), Col("CA share", "ca", "pct2", 11), Col("US share", "us", "pct2", 11)]
    book.table(ws, TableSpec("US Benchmark", "kpi", BENCH_SHARE_TITLE, cols_s, pd.DataFrame(rows), None, None, ("CA", "US"),
                             note="Each share is computed within its own market and currency (definitions as on Summary); "
                                  "no cross-currency ratio.",
                             dataset_filter="core devices vs the full code-reader export, per market"), X.table_end(tr) + 3)


def _same_asin(book: Book, c: GCtx) -> None:
    ws = book.sheet("US vs CA Same-ASIN")
    ca, us = c.u.set_index("asin"), c.bu.set_index("asin")
    both = sorted(set(ca.index) & set(us.index))
    both = [a for a in both if bool(ca.at[a, "gauge_device_scope"]) or bool(us.at[a, "gauge_device_scope"])]
    rows = []
    for a in both:
        cs, us_s = ca.at[a, "_subtype"], us.at[a, "_subtype"]
        rows.append({"asin": a, "title": ca.at[a, "title"], "sub": cs if cs == us_s else f"CA: {cs} / US: {us_s}",
                     "ca_price": ca.at[a, "price"], "ca_units": ca.at[a, "units_month"], "ca_rev": ca.at[a, "revenue_month"],
                     "us_price": us.at[a, "price"], "us_units": us.at[a, "units_month"], "us_rev": us.at[a, "revenue_month"],
                     "ratio": X.safe_div(us.at[a, "units_month"], ca.at[a, "units_month"])})
    frame = pd.DataFrame(rows, columns=["asin", "title", "sub", "ca_price", "ca_units", "ca_rev", "us_price", "us_units", "us_rev", "ratio"])
    frame = frame.sort_values(["ca_rev", "asin"], ascending=[False, True], kind="mergesort").reset_index(drop=True)
    cols = [Col("ASIN", "asin", "text", 13), Col("Title", "title", "text", 60), Col("Sub-type", "sub", "text", 24),
            Col("CA Price (CAD)", "ca_price", "money2", 12), Col("CA Units", "ca_units", "int", 9), Col("CA Rev (CAD)", "ca_rev", "money", 13),
            Col("US Price (USD)", "us_price", "money2", 12, market="US"), Col("US Units", "us_units", "int", 9),
            Col("US Rev (USD)", "us_rev", "money", 13, market="US"), Col("Units ratio US/CA", "ratio", "rating", 11),
            Col("Link CA", "asin", "link", 24, market="CA"), Col("Link US", "asin", "link", 24, market="US")]
    flt = "asin in CA union ∩ US union & (CA device scope | US device scope)"
    X.write_sheet_header(ws, f"US vs CA Same-ASIN — listings in both marketplaces ({c.mon})", c.sub, len(cols))
    tr_k = book.kpi(ws, 3, [("Listings in both marketplaces", len(frame), "int")], header=False, dataset_filter=flt,
                    allowed_markets=("CA", "US"))
    if ws.cell(tr_k.first_data_row, 2).coordinate != SAME_ASIN_COUNT_CELL:
        raise AssertionError("Same-ASIN count cell moved")
    book.table(ws, TableSpec("US vs CA Same-ASIN", "same_asin", f"Listings in both marketplaces ({len(frame)}) — device scope in either",
                             cols, frame, None, None, ("CA", "US"),
                             note="ASIN intersection of the CA and US gauge union frames where either side is device scope. Prices "
                                  "and revenue in native currency; no FX conversion.",
                             dataset_filter=flt), X.table_end(tr_k) + 2)


def _all_products(book: Book, c: GCtx) -> None:
    ws = book.sheet("All Products")
    ccy = c.ccy
    cols = [Col("ASIN", "asin", "text", 13), Col("Product Name", "title", "text", 60), Col("Brand", "brand_display", "text", 16),
            Col("Gauge Class", "gauge_class", "text", 24), Col("Sub-type", "_subtype", "text", 24),
            Col("Workbook Scope", "gauge_in_scope", "bool", 10), Col("Device Scope", "gauge_device_scope", "bool", 10),
            Col("Borderline", "borderline", "bool", 10), Col("Rule ID", "gauge_rule_id", "text", 14),
            Col("Confidence", "gauge_confidence", "rating", 10), Col("Source Set", "source_set", "text", 12),
            Col("CR Type", "type", "text", 12), Col("Type Conflict", "type_conflict", "bool", 10),
            Col(f"Price ({ccy})", "price", "money2", 12), Col(f"Monthly Rev ({ccy})", "revenue_month", "money", 15),
            Col("Monthly Units", "units_month", "int", 12), Col("# Reviews", "review_count", "int", 10), Col("Rating", "rating", "rating", 8),
            Col("Gauge Tier", "_gtier", "text", 11), Col("Source File", "source_file", "text", 26), Col("URL", "_url", "text", 34),
            Col("Link", "asin", "link", 24)]
    total = X.fit(X.listing_totals(c.u, "asin", C.TOTAL_ROW_LABEL), cols)
    book.table(ws, TableSpec("All Products", "all_rows", f"All union rows ({len(c.u)}) — every class, by revenue", cols,
                             X.rank_listings(c.u, "revenue"), total, None, (c.code,), subtitle=c.sub,
                             dataset_filter="code-reader ∪ gauge union (all classes)"), 1)


AUDIT_MONEY_HEADERS: dict[str, str] = {"revenue_chosen": "Revenue chosen ({ccy})", "revenue_dropped_max": "Revenue dropped max ({ccy})"}


def dedupe_audit_columns(ccy: str) -> list[Col]:
    """DEDUPE_AUDIT_COLUMNS as table columns: field names stay the frozen audit names; only the two money columns get a
    display header carrying the currency (V07). Every other header is the raw audit column name."""
    kinds = {"n_rows": "int", "revenue_chosen": "money", "revenue_dropped_max": "money"}
    return [Col(AUDIT_MONEY_HEADERS.get(h, h).format(ccy=ccy), h, kinds.get(h, "text"), 30 if h in ("chosen_file", "dropped") else 13)
            for h in C.DEDUPE_AUDIT_COLUMNS]


def _audit(book: Book, c: GCtx) -> None:
    ws = book.sheet("Dedupe & Classification Audit")
    audit = c.ds.audits.get("dedupe_audit")
    if audit is None:
        raise KeyError("dataset audits carry no 'dedupe_audit' frame")
    X.require_columns(audit, C.DEDUPE_AUDIT_COLUMNS, "dedupe_audit")
    audit = audit[audit["asin"].isin(set(c.u["asin"]))].reset_index(drop=True)
    cols = dedupe_audit_columns(c.ccy)
    note = None
    if X.input_mode(c.ds) == X.INPUT_MODE_NORMALIZED:
        note = "Built from a normalized frame: the loader did not run, so there is no dedupe audit."
    tr = book.table(ws, TableSpec(ws.title, "dedupe_audit", f"Dedupe audit — union ASINs ({len(audit)} rows)", cols, audit, None, None,
                                  (c.code,), subtitle=c.sub, note=note, dataset_filter="dedupe_audit rows for union ASINs"), 1)
    cols = [Col("ASIN", "asin", "text", 13), Col("Gauge Class", "gauge_class", "text", 24), Col("Workbook Scope", "gauge_in_scope", "bool", 10),
            Col("Device Scope", "gauge_device_scope", "bool", 10), Col("Borderline", "borderline", "bool", 10),
            Col("Rule ID", "gauge_rule_id", "text", 14), Col("Confidence", "gauge_confidence", "rating", 10),
            Col("Source Set", "source_set", "text", 12)]
    rows = c.u.sort_values(["gauge_class", "asin"], kind="mergesort").reset_index(drop=True)
    book.table(ws, TableSpec(ws.title, "dedupe_audit", f"Classification decisions ({len(rows)} union rows)", cols, rows, None, None,
                             (c.code,), dataset_filter="classification decisions (all union rows)"), X.table_end(tr) + 3)


def _excluded(book: Book, c: GCtx) -> None:
    ws = book.sheet("Excluded")
    ex = c.u[c.u["gauge_class"].isin(C.GAUGE_EXCLUDED_CLASSES + ("ambiguous",))].copy()
    no_rule = ex.loc[ex["gauge_rule_id"].str.strip() == "", "asin"].tolist()
    if no_rule:
        raise ValueError(f"excluded/ambiguous rows without a rule id: {no_rule[:10]}")
    ex["_reason"] = ex["gauge_class"].map(C.GAUGE_SUBTYPE_LABELS)
    ccy = c.ccy
    cols = [Col("ASIN", "asin", "text", 13), Col("Product Name", "title", "text", 60), Col("Brand", "brand_display", "text", 16),
            Col("Gauge Class", "gauge_class", "text", 22), Col("Rule ID", "gauge_rule_id", "text", 14), Col("Reason", "_reason", "text", 26),
            Col("Confidence", "gauge_confidence", "rating", 10), Col(f"Price ({ccy})", "price", "money2", 12),
            Col(f"Monthly Rev ({ccy})", "revenue_month", "money", 15), Col("Monthly Units", "units_month", "int", 12),
            Col("Source Set", "source_set", "text", 12), Col("URL", "_url", "text", 34), Col("Link", "asin", "link", 24)]
    rows = ex.sort_values(["gauge_class", "revenue_month", "asin"], ascending=[True, False, True], kind="mergesort").reset_index(drop=True)
    total = X.fit(X.listing_totals(ex, "asin", C.TOTAL_ROW_LABEL), cols)
    book.table(ws, TableSpec("Excluded", "excluded", f"Excluded and ambiguous rows ({len(rows)})", cols, rows, total, None, (c.code,),
                             subtitle=c.sub, note="Excluded classes and 'ambiguous' are outside both scopes; ambiguous rows also go to "
                                                  "the review queue. Reason = class label; Rule ID = the classifier rule or MAP decision.",
                             dataset_filter="gauge_class in GAUGE_EXCLUDED_CLASSES + ambiguous"), 1)


def _source_method(book: Book, c: GCtx) -> None:
    ws = book.sheet("Source & Method")
    paras = ["# Inputs",
             f"{c.code} Helium 10 Black Box exports for {c.month}: the code-reader export and the OBD gauge export. Files: "
             + ("; ".join(f"{n} ({r} rows)" for n, r in c.ds.raw_files) or "none recorded") + ".",
             "Columns are read by Helium 10 header name; percent fields are stored as fractions; missing values stay blank (never 0).",
             "# Dedupe and union", DEDUPE_RULE]
    if c.code == "US":
        paras.append("US code-reader export: only gauge candidates (title pre-filter hits plus ASINs in the gauge map) enter the "
                     "union; the pre-filter runs after that export's own dedupe.")
    paras += ["# Classification",
              "Ordered rule table over the listing title (first match wins); ASIN decisions in maps/ca_gauge_map.csv override every "
              "rule; frozen decisions of earlier runs are replayed unless --rederive. Rule ID 'MAP' = human decision.",
              "Workbook scope = device, adjacent (GPS-only HUD) and accessory classes. Device scope = tuner with gauge display, truck "
              "gauge monitor, OBD+GPS HUD, OBD HUD, gauge display. Core device = device scope and not borderline.",
              "# Aggregation",
              "All figures are static values computed from the classified rows. Shares = revenue ÷ the table's full-dataset revenue; "
              "truncated tables end with an 'Other …' residual row so the Total row equals the full dataset. Avg price = revenue ÷ "
              "units. Avg rating = units-weighted mean over listings with rating > 0, blank when none.",
              f"Price tiers: half-open [low, high) on the listing price ({', '.join(t for t, _, _ in C.GAUGE_TIERS)}), nominal in "
              f"the market currency.",
              "Gauge share of the code-reader market: (a) core devices present in the code-reader export ÷ the full code-reader "
              "export totals (taken before any gauge candidate filter); (b) all core devices ÷ (full code-reader export + core "
              "devices found only in the gauge export). Revenue and unit shares are computed within each market.",
              "Fuel split: core devices by fuel_scope (" + ", ".join(C.FEATURE_FUEL_SCOPE) + "). " + FUEL_NOTE]
    if c.code == "CA":
        paras += ["# Models",
                  "Model A tables use core devices. Model B universe = CA code-reader listings typed Dongle; app-gauge capability is "
                  "a brand-level research flag (maps/ca_app_gauge_brands.csv).",
                  "App feature matrix: one row per app in a fixed order, read from maps/ca_app_feature_matrix.csv; " + APP_MATRIX_NOTE,
                  "# Benchmark",
                  "US Benchmark and US vs CA Same-ASIN compare units, listing counts and ranks; revenue is shown in native currency "
                  "side by side. No FX conversion. " + CAVEAT_US_RAW]
    paras += ["# Caveats", CAVEAT_CA_EDITION, "Helium 10 estimates are not calibrated to actual sales."]
    book.text(ws, f"Source & Method ({c.mon})", paras, role="source_method")


def _metadata(book: Book, c: GCtx) -> None:
    d = X.base_metadata(c.ds, c.market)
    audit = c.ds.audits.get("dedupe_audit")
    if audit is not None:
        X.require_columns(audit, C.DEDUPE_AUDIT_COLUMNS, "dedupe_audit")
        audit = audit[audit["asin"].isin(set(c.u["asin"]))]
    d["Dedupe summary"] = X.dedupe_summary(audit, X.input_mode(c.ds))
    typed = c.u[c.u["type"] != ""]
    d["Type coverage"] = (X.type_coverage_text(typed) + " (code-reader rows of the union)") if c.code == "CA" and len(typed) else \
        "n/a — US Type assignment is out of scope" if c.code == "US" else "no typed rows in the union"
    dev, core = c.device, c.core
    from_cr = int(dev["source_set"].isin(["code_reader", "both"]).sum())
    d["Gauge overlap"] = (f"{len(dev)} device-scope rows ({len(core)} core, {len(dev) - len(core)} borderline), revenue "
                          f"{X.fmt_money(dev['revenue_month'].sum(), c.market)}; {from_cr} of them come from the code-reader export")
    d["Scope note"] = (f"Single month; no MoM/Rolling-12; gauge price tiers are nominal break points in {c.ccy}; "
                       f"totals use core devices (device scope, not borderline)")
    d["Enrichment columns"] = "; ".join(c.notes) or "all enrichment columns present in the classified frame"
    d["Code-reader market totals"] = (f"{c.cr_totals['n']} ASINs, {X.fmt_money(c.cr_totals['rev'], c.market)}, "
                                      f"{c.cr_totals['units']:,.0f} units (full {c.code} code-reader export, before any gauge "
                                      f"candidate filter)")
    if c.code == "CA" and c.app_matrix is not None:
        filled = int((c.app_matrix.drop(columns=["app"]) != APP_MATRIX_PLACEHOLDER).any(axis=1).sum())
        d["App feature matrix"] = (f"{c.app_matrix_path.name}: {filled} of {len(C.APP_FEATURE_MATRIX_APPS)} apps with research rows; "
                                   f"the rest '{APP_MATRIX_PLACEHOLDER}'")
    if c.code == "CA":
        d["Model B universe"] = (f"{len(c.modelb)} CA code-reader rows typed Dongle; app-gauge map {APP_GAUGE_BRANDS_DEFAULT.name}"
                                 if c.modelb is not None else "not built")
    if c.bench is not None:
        d["US benchmark source"] = US_BENCHMARK_SOURCE
        d["US benchmark input mode"] = X.input_mode(c.bench)
        d["US benchmark export dates"] = f"{c.bench.export_dates[0].isoformat()} – {c.bench.export_dates[1].isoformat()}"
        d["US benchmark raw files"] = "; ".join(f"{n}: {r}" for n, r in c.bench.raw_files) or "none recorded"
        if c.bench_notes:
            d["US benchmark enrichment"] = "; ".join(c.bench_notes)
        d["US code-reader market totals"] = (f"{c.bench_cr_totals['n']} ASINs, {X.fmt_money(c.bench_cr_totals['rev'], C.MARKETS['US'])}, "
                                             f"{c.bench_cr_totals['units']:,.0f} units (full US code-reader export, before the gauge "
                                             f"candidate filter)")
    book.metadata(book.sheet("Metadata"), d)


def build_gauge_book(c: GCtx) -> Book:
    book = Book(C.gauge_report_name(c.code, c.month), c.market)
    _read_me(book, c)
    _summary(book, c)
    _top50(book, c)
    _innova(book, c)
    _brand_tabs(book, c)
    if c.code == "CA":
        _price_ladder(book, c)
        _feature_matrix(book, c)
        _modelb(book, c)
        if c.bench is not None:
            _benchmark(book, c)
            _same_asin(book, c)
    _all_products(book, c)
    _audit(book, c)
    _excluded(book, c)
    _source_method(book, c)
    _metadata(book, c)
    names = book.sheetnames
    if names[:4] != list(C.GAUGE_FIXED_SHEETS) or names[-5:] != list(C.GAUGE_TAIL_SHEETS):
        raise AssertionError(f"gauge sheet order drifted: {names}")
    return book


# --------------------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------------------
def build_gauge_workbook(ds: C.CaDataset, out_dir: Path, *, benchmark: C.CaDataset | None, overwrite: bool, dated_copy: bool,
                         runs_dir: Path = C.RUNS_DIR, preclassified: bool = False, gauge_map: Path = GAUGE_MAP_DEFAULT,
                         app_gauge_brands: Path = APP_GAUGE_BRANDS_DEFAULT, app_feature_matrix: Path = APP_FEATURE_MATRIX_DEFAULT,
                         rederive: bool = False, input_paths: list[Path] | tuple = ()) -> Path:
    """Build <M>_OBD_Gauge_Competitor_Report_<m>.xlsx; returns its path (a dated copy, when asked, sits next to it).

    preclassified=True: the dataset frames already carry the gauge classification (normalized fixture / dev mode); the
    union/classify/freeze seams are skipped. Otherwise the union is assembled through ca_load / ca_gauge_classification / ca_types.
    """
    if ds.market not in ("CA", "US"):
        raise ValueError(f"unknown market {ds.market!r}")
    if benchmark is not None:
        if ds.market != "CA":
            raise ValueError("a benchmark is only built into the CA workbook")
        if benchmark.market != "US":
            raise ValueError(f"benchmark market must be US (got {benchmark.market!r})")
        if benchmark.month != ds.month:
            raise ValueError(f"benchmark month {benchmark.month} != {ds.month}")
    market = C.MARKETS[ds.market]
    out_dir = Path(out_dir)
    name = C.gauge_report_name(ds.market, ds.month)
    if not overwrite and (out_dir / name).exists():
        raise FileExistsError(f"{out_dir / name} exists; pass --overwrite (the old file is backed up)")
    # full code-reader totals BEFORE the union (the US candidate pre-filter only narrows a local copy inside the assembly)
    cr_totals = code_reader_totals(ds.code_reader, ds.market)
    u, notes, fuel_absent = gauge_union_with_flags(ds, preclassified=preclassified, gauge_map_path=gauge_map, runs_dir=runs_dir,
                                        rederive=rederive)
    c = GCtx(ds=ds, market=market, u=u, notes=notes, month=ds.month, mon=X.month_label(ds.month),
             sub=X.subtitle_text(market, ds.export_dates, ds.month), ccy=market.currency, cr_totals=cr_totals,
             fuel_absent=fuel_absent)
    if benchmark is not None:
        c.bench = benchmark
        c.bench_cr_totals = code_reader_totals(benchmark.code_reader, benchmark.market)
        c.bu, c.bench_notes = gauge_union(benchmark, preclassified=preclassified, gauge_map_path=gauge_map, runs_dir=runs_dir,
                                             rederive=rederive)
    if ds.market == "CA":
        c.modelb = modelb_universe(ds, app_gauge_brands)
        c.app_matrix, c.app_matrix_path = read_app_feature_matrix(app_feature_matrix), Path(app_feature_matrix)
    book = build_gauge_book(c)
    manifest = X.read_manifest(out_dir, ds.month)
    path = X.safe_output_path(out_dir, book.name, overwrite, manifest)
    book.save(path)
    outputs = [path]
    if dated_copy:
        dp = X.safe_output_path(out_dir, X.dated_copy_name(book.name), overwrite, manifest)
        shutil.copyfile(path, dp)
        outputs.append(dp)
    reg = X.TableRegistry(ds.market, ds.month)
    reg.add_book(book)
    reg_path = reg.write(runs_dir)
    write_conflict_review(u, ds.market, ds.month, runs_dir)
    extra = [gauge_map, app_gauge_brands] if not preclassified else []
    if ds.market == "CA":
        extra.append(app_feature_matrix)
    inputs = X.input_hashes(list(input_paths) + extra + sorted(C.MAPS_DIR.glob("*.csv")))
    man_path = X.write_manifest(out_dir, ds.month, outputs, inputs)
    print(f"registry: {reg_path} ({len(book.tables)} tables)")
    print(f"manifest: {man_path}")
    return path


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build the OBD gauge competitor workbook (CA or US)")
    p.add_argument("--market", required=True, choices=("CA", "US"))
    p.add_argument("--month", required=True, help="report month YYYYMM")
    p.add_argument("--gauge-raw-dir", type=Path, help="gauge export folder (default NewProductCategory/<M>-OBD-GAUGE/raw_data/<m>)")
    p.add_argument("--cr-raw-dir", type=Path, help="code-reader export folder (default per market)")
    p.add_argument("--benchmark-market", choices=("US",), help="CA only: add the US benchmark sheets")
    p.add_argument("--benchmark-gauge-raw-dir", type=Path)
    p.add_argument("--benchmark-cr-raw-dir", type=Path)
    p.add_argument("--out-dir", type=Path, help="output folder (default NewProductCategory/<M>-OBD-GAUGE/outputs)")
    p.add_argument("--gauge-map", type=Path, default=GAUGE_MAP_DEFAULT)
    p.add_argument("--app-feature-matrix", type=Path, default=APP_FEATURE_MATRIX_DEFAULT,
                   help="CA only: app feature matrix CSV (ca_common.APP_FEATURE_MATRIX_COLUMNS)")
    p.add_argument("--runs-dir", type=Path, help="frozen run decisions + registry (default ca_market_reports/runs)")
    p.add_argument("--overwrite", action="store_true", help="replace an existing output (old file moved to _backup/)")
    p.add_argument("--rederive", action="store_true", help="re-derive decisions instead of replaying frozen ones")
    p.add_argument("--dated-copy", action="store_true", help="also write <name>_<YYYYMMDD>.xlsx")
    p.add_argument("--from-normalized", type=Path, help="DEV: build from a normalized, already-classified CSV (fixtures)")
    p.add_argument("--benchmark-from-normalized", type=Path, help="DEV: benchmark from a normalized, already-classified US CSV")
    a = p.parse_args(argv)
    if not C.MONTH_RE.match(a.month):
        p.error(f"--month must be a calendar month YYYYMM, got {a.month!r}")
    if a.benchmark_market and a.market != "CA":
        p.error("--benchmark-market is only valid with --market CA")
    if a.benchmark_from_normalized and not a.from_normalized:
        p.error("--benchmark-from-normalized needs --from-normalized (dev and loader inputs are never mixed)")
    if a.benchmark_from_normalized and not a.benchmark_market:
        p.error("--benchmark-from-normalized needs --benchmark-market US")
    if a.from_normalized and a.benchmark_market and not a.benchmark_from_normalized:
        p.error("dev mode with --benchmark-market needs --benchmark-from-normalized")
    return a


def main(argv: list[str] | None = None) -> int:
    a = parse_args(argv)
    market = C.MARKETS[a.market]
    bench = None
    if a.from_normalized:
        if a.out_dir is None:
            raise SystemExit("--from-normalized needs --out-dir (dev runs never write to the real output folder)")
        X.refuse_new_product_dir(a.out_dir)
        if a.runs_dir is None:
            raise SystemExit("--from-normalized needs --runs-dir (dev runs never write to ca_market_reports/runs)")
        ds = X.dataset_from_normalized(X.read_normalized_csv(a.from_normalized), a.market, a.month)
        inputs = [a.from_normalized]
        if a.benchmark_from_normalized:
            bench = X.dataset_from_normalized(X.read_normalized_csv(a.benchmark_from_normalized), "US", a.month)
            inputs.append(a.benchmark_from_normalized)
        out_dir, runs_dir, pre = a.out_dir, a.runs_dir, True
    else:
        from ca_market_reports.ca_load import load_month  # ASSEMBLY: ca_load.load_month
        runs_dir = a.runs_dir or C.RUNS_DIR
        cr_dir = a.cr_raw_dir or market.cr_raw_dir(a.month)
        g_dir = a.gauge_raw_dir or market.gauge_raw_dir(a.month)
        ds = load_month(a.market, a.month, cr_raw_dir=cr_dir, gauge_raw_dir=g_dir, gauge_map=a.gauge_map, runs_dir=runs_dir,
                        assign_types=(a.market == "CA"), rederive=a.rederive)  # ASSEMBLY: ca_load.load_month
        # every CSV the loader read, recursively (its own listing); CA also reads the default US type map (assign_types)
        inputs = X.raw_input_files(ds, X.loader_raw_dirs(a.market, a.month, cr_dir, g_dir))
        if a.market == "CA":
            inputs.append(C.US_TYPE_MAP_DEFAULT)
        markets_read = [a.market]
        if a.benchmark_market:
            us = C.MARKETS["US"]
            bcr = a.benchmark_cr_raw_dir or us.cr_raw_dir(a.month)
            bg = a.benchmark_gauge_raw_dir or us.gauge_raw_dir(a.month)
            bench = load_month("US", a.month, cr_raw_dir=bcr, gauge_raw_dir=bg, gauge_map=a.gauge_map, runs_dir=runs_dir,
                               assign_types=False, rederive=a.rederive)  # ASSEMBLY: ca_load.load_month
            inputs += X.raw_input_files(bench, X.loader_raw_dirs("US", a.month, bcr, bg))
            markets_read.append("US")
        out_dir, pre = (a.out_dir or market.gauge_out_dir()), False
    path = build_gauge_workbook(ds, out_dir, benchmark=bench, overwrite=a.overwrite, dated_copy=a.dated_copy, runs_dir=runs_dir,
                                preclassified=pre, gauge_map=a.gauge_map, app_feature_matrix=a.app_feature_matrix,
                                rederive=a.rederive, input_paths=inputs)
    if not pre:
        # frozen decision files of every market this run loaded; the type review queue is an output, never an input
        decisions = [C.run_file(Path(runs_dir), a.month, stem, f"{mk}_{src}") for mk in markets_read
                     for stem in DECISION_STEMS for src in ("code_reader", "gauge")]
        decisions = [d for d in decisions if d.exists()]
        if decisions:
            X.write_manifest(Path(out_dir), a.month, [path], X.input_hashes(decisions))
    print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
