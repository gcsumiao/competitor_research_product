"""CA code-reader workbooks (single month, Helium 10 Black Box estimates in CAD).

  CA_Code_Reader_Competitor_Report_<m>.xlsx : Summary, Top 50, Innova, top-brand tabs, All ASINs, Metadata
  CA_Code_Reader_Analysis_<m>.xlsx          : Brand x Tier, Category, one tab per CR tier, Trend Proxy, Type Coverage, Metadata

Every number is a static value computed here (ca_common formula policy). Run:
  ca_market_reports/run.sh ca_market_reports/build_ca_code_reader_report.py --month 202609 [--overwrite]
  dev: ... --from-normalized ca_market_reports/tests/fixtures/normalized_rows.csv --out-dir tmp/ca_scratch/fx --runs-dir tmp/ca_scratch/runs
"""
from __future__ import annotations

import argparse
import re
import shutil
import sys
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from ca_market_reports import ca_common as C
from ca_market_reports import ca_xlsx_style as X
from ca_market_reports.ca_xlsx_style import Book, ColumnSpec as Col, TableSpec

MARKET = C.MARKETS["CA"]
SCOPE_NOTE = "Single month; no MoM/Rolling-12; tier thresholds are nominal US break points in CAD"
TREND_NOTE = "Helium 10 estimates; paired-ASIN cohort only; not pipeline history"
PIVOT_NOTE = ("Avg Price = revenue ÷ units. Brand rows: Qty by % / Revenue by % = share within the tier. "
              "Tier Total row: share of the full CA code-reader market.")

# --------------------------------------------------------------------------------------
# Row helpers
# --------------------------------------------------------------------------------------
_AFTER_INNOVA_RE = re.compile(r"\binnova\b[\s\-]+(?:carscan\s+(?:pro\s+)?)?(\d{3,5}[a-z]{0,3}(?:\s+v\d+)?)\b", re.I)
_MODEL_RE = re.compile(r"\b(\d{3,5}[a-z]{0,3})\b(?:\s+(v\d+)\b)?", re.I)
_YEAR_RE = re.compile(r"^(19|20)\d{2}$")


def item_number(title: str) -> str:
    """Innova model token parsed from the listing title ('5610', '3020RS', '1000 V2'); '' when the title has none."""
    t = title or ""
    m = _AFTER_INNOVA_RE.search(t)
    if m:
        return re.sub(r"\s+", " ", m.group(1)).upper()
    for m in _MODEL_RE.finditer(t):
        tok = m.group(1)
        if _YEAR_RE.match(tok):
            continue
        return tok.upper() + (f" {m.group(2).upper()}" if m.group(2) else "")
    return ""


def sold_by_amazon(seller: str) -> str:
    s = (seller or "").strip().casefold()
    if s in ("amazon", "amazon.ca"):
        return "Yes"
    if s == "amazon us":
        return "Amazon US (cross-border)"
    return "No"


def tier_leaves(label: str) -> tuple[str, ...]:
    if label in C.CR_TIER_GROUPS:
        return C.CR_TIER_GROUPS[label]
    if label in C.CR_TIERS:
        return (label,)
    raise KeyError(f"unknown CR tier label {label!r}")


def prepare_cr_frame(df: pd.DataFrame) -> pd.DataFrame:
    X.require_columns(df, C.BASE_ROW_COLUMNS, "CA code-reader frame")
    df = X.coerce_frame(df)
    X.check_sales_columns(df, "CA code-reader frame")
    bad_types = sorted(set(df["type"]) - set(C.TYPES))
    if bad_types:
        raise ValueError(f"CA code-reader rows need a Type in {C.TYPES}; got {bad_types} "
                         f"(e.g. {df.loc[~df['type'].isin(C.TYPES), 'asin'].tolist()[:5]})")
    bad_tier = df.loc[~df["price_tier"].isin(list(C.CR_TIERS)), "asin"].tolist()
    if bad_tier:
        raise ValueError(f"rows without a leaf CR price_tier: {bad_tier[:10]}")
    mism = [a for a, t, tier in zip(df["asin"], df["type"], df["price_tier"]) if t not in C.CR_TIERS[tier][0]]
    if mism:
        raise ValueError(f"price_tier inconsistent with Type for ASINs {mism[:10]}")
    df = X.add_canonical_url(df, MARKET)
    df["_item"] = df["title"].map(item_number)
    df["_sold"] = df["seller"].map(sold_by_amazon)
    return df


@dataclass
class Ctx:
    ds: C.CaDataset
    df: pd.DataFrame
    month: str
    mon: str
    sub: str
    ccy: str
    market_rev: float
    market_units: float


def _gauge_overlap(df: pd.DataFrame) -> str:
    if "gauge_device_scope" not in df.columns:
        return "n/a — run gauge report"
    m = df["gauge_device_scope"].astype(bool)
    return f"{int(m.sum())} code-reader rows are gauge device scope; revenue {X.fmt_money(df.loc[m, 'revenue_month'].sum(), MARKET)}"


def _metadata(ctx: Ctx) -> dict[str, str]:
    d = X.base_metadata(ctx.ds, MARKET)
    audit = ctx.ds.audits.get("dedupe_audit")
    if audit is not None and "source_set" in audit.columns:
        audit = audit[audit["source_set"].astype(str) == "code_reader"]
    d["Dedupe summary"] = X.dedupe_summary(audit, X.input_mode(ctx.ds))
    d["Type coverage"] = X.type_coverage_text(ctx.df)
    d["Gauge overlap"] = _gauge_overlap(ctx.df)
    d["Scope note"] = SCOPE_NOTE
    d["Rows"] = f"{len(ctx.df)} listings (one row per ASIN after dedupe); revenue {X.fmt_money(ctx.market_rev, MARKET)}; units {ctx.market_units:,.0f}"
    d["Method"] = ("All numbers are static values computed from the normalized rows. Avg Rating = units-weighted mean over listings "
                   "with rating > 0. Price Per Unit = revenue ÷ units. Truncated tables end with an 'Other …' residual row so the "
                   "Total row equals the full dataset.")
    return d


# --------------------------------------------------------------------------------------
# Workbook 1: Competitor Report
# --------------------------------------------------------------------------------------
def all_asins_columns(ccy: str) -> list[Col]:
    return [Col("ASIN", "asin", "text", 13), Col("Title", "title", "text", 60), Col("Brand", "brand_display", "text", 18),
            Col("Type", "type", "text", 13), Col("Type Source", "type_source", "text", 16), Col(f"Price ({ccy})", "price", "money2", 12),
            Col(f"Monthly Rev ({ccy})", "revenue_month", "money", 15), Col("Monthly Units", "units_month", "int", 12),
            Col("Reviews", "review_count", "int", 10), Col("Rating", "rating", "rating", 8),
            Col("Listing Age (Months)", "listing_age_months", "int", 11), Col("Last Year Sales", "last_year_units", "int", 12),
            Col("Sales YoY %", "yoy_units_pct", "pct", 11), Col("Price Tier", "price_tier", "text", 17),
            Col("Source File", "source_file", "text", 26), Col("URL", "_url", "text", 34), Col("Link", "asin", "link", 24)]


def build_report_book(ctx: Ctx) -> Book:
    book = Book(C.cr_report_name("CA", ctx.month), MARKET)
    df, ccy = ctx.df, ctx.ccy

    ws = book.sheet("Summary")
    shown, residual, total = X.brand_summary(df, top_n=C.SUMMARY_TOP_BRANDS)
    cols = X.summary_columns(ccy)
    tr = book.table(ws, TableSpec("Summary", "summary_brands", f"CA Code Reader Market — Brand Summary ({ctx.mon})", cols, shown,
                                  X.fit(total, cols), X.fit(residual, cols), ("CA",), subtitle=ctx.sub,
                                  dataset_filter="all CA code-reader rows"), 1)
    X.hide_zero_revenue_rows(ws, tr)
    book.bar(ws, tr, "Brand", f"Monthly Rev ({ccy})", f"Monthly revenue by brand ({ccy})")
    book.pie(ws, tr, "Brand", "Monthly Rev Market Share %", "Revenue share by brand", include_residual=True)

    ws = book.sheet("Top 50")
    cols = X.top50_columns(ccy)
    shown, residual, total = X.top_listings(df, by="revenue", n=C.TOP_N)
    tr1 = book.table(ws, TableSpec("Top 50", "top_by_revenue", f"Top {C.TOP_N} Listings — Rank by Revenue ({ctx.mon})", cols, shown,
                                   X.fit(total, cols), X.fit(residual, cols), ("CA",), subtitle=ctx.sub,
                                   dataset_filter="all CA code-reader rows"), 1)
    shown, residual, total = X.top_listings(df, by="units", n=C.TOP_N)
    book.table(ws, TableSpec("Top 50", "top_by_units", f"Top {C.TOP_N} Listings — Rank by Units", cols, shown, X.fit(total, cols),
                             X.fit(residual, cols), ("CA",), dataset_filter="all CA code-reader rows"), X.table_end(tr1) + 4)

    inn = df[df["brand_key"] == "innova"]
    cols = X.brand_tab_columns(ccy) + [Col("Item #", "_item", "text", 10), Col("Seller", "seller", "text", 18),
                                       Col("Sold by Amazon", "_sold", "text", 14), Col("Fulfillment", "fulfillment", "text", 11)]
    if [c.header for c in cols[-4:]] != list(C.INNOVA_TAB_EXTRA_COLUMNS):
        raise AssertionError("Innova extra columns drifted from ca_common")
    X.write_brand_tab(book, "Innova", inn, columns=cols, title=f"Innova — CA code-reader listings ({ctx.mon})", subtitle=ctx.sub,
                      kpi_items=X.brand_kpi_items(inn, ctx.market_rev, ccy), dataset_filter="brand_key == 'innova'",
                      rev_role="innova", units_role="brand_tab_units")
    book.brand_sheet_map["innova"] = "Innova"

    ranked, _, _ = X.brand_summary(df[df["brand_key"] != "innova"], top_n=C.CR_REPORT_BRAND_TABS)
    taken: set[str] = set()
    cols = X.brand_tab_columns(ccy)
    for key, display in zip(ranked["brand_key"], ranked["brand"]):
        name = C.sheet_name_for_brand(display, taken)
        rows = df[df["brand_key"] == key]
        X.write_brand_tab(book, name, rows, columns=cols, title=f"{display} — CA code-reader listings ({ctx.mon})", subtitle=ctx.sub,
                          kpi_items=X.brand_kpi_items(rows, ctx.market_rev, ccy), dataset_filter=f"brand_key == {key!r}")
        book.brand_sheet_map[key] = name

    ws = book.sheet("All ASINs")
    cols = all_asins_columns(ccy)
    rows = X.rank_listings(df, "revenue")
    total = X.fit(X.listing_totals(df, "asin", C.TOTAL_ROW_LABEL), cols)
    book.table(ws, TableSpec("All ASINs", "all_rows", f"All CA code-reader listings ({len(df)}) — by revenue", cols, rows, total, None,
                             ("CA",), subtitle=ctx.sub, dataset_filter="all CA code-reader rows"), 1)

    book.metadata(book.sheet("Metadata"), _metadata(ctx))
    if book.sheetnames[:3] != list(C.CR_REPORT_FIXED_SHEETS) or book.sheetnames[-2:] != list(C.CR_REPORT_TAIL_SHEETS):
        raise AssertionError(f"sheet order drifted: {book.sheetnames}")
    return book


# --------------------------------------------------------------------------------------
# Workbook 2: Analysis
# --------------------------------------------------------------------------------------
def _pivot_columns(ccy: str, *, listings: bool = False) -> list[Col]:
    h = [s.format(ccy=ccy) for s in C.TIER_PIVOT_COLUMNS]
    cols = [Col("Tier", "_tier", "text", 17), Col("Brand", "brand", "text", 26)]
    if listings:
        cols.append(Col("# of Listings", "listings", "int", 11))
    cols += [Col(h[0], "avg_price", "money2", 13), Col(h[1], "units", "int", 12), Col(h[2], "qty_pct", "pct", 11),
             Col(h[3], "rev", "money", 15), Col(h[4], "rev_pct", "pct", 12)]
    return cols


def _pivot_row(sub: pd.DataFrame, tier_units: float, tier_rev: float) -> dict:
    rev, units = float(sub["revenue_month"].sum()), float(sub["units_month"].sum())
    return {"listings": int(sub["asin"].nunique()), "avg_price": X.safe_div(rev, units), "units": units,
            "qty_pct": X.safe_div(units, tier_units), "rev": rev, "rev_pct": X.safe_div(rev, tier_rev)}


def tier_pivot(sub: pd.DataFrame, label: str, *, top_n: int, market_units: float, market_rev: float,
               force_innova: bool = False) -> tuple[pd.DataFrame, dict | None, dict]:
    """Brand rows of one tier (shares within the tier), residual 'Other brands (n)', Total (tier share of the market)."""
    tier_units, tier_rev = float(sub["units_month"].sum()), float(sub["revenue_month"].sum())
    rows = []
    for key, g in sub.groupby("brand_key", sort=False):
        d = _pivot_row(g, tier_units, tier_rev)
        d.update(_tier=label, brand=str(g["brand_display"].iloc[0]), brand_key=key)
        rows.append(d)
    cols = ["_tier", "brand", "brand_key", "listings", "avg_price", "units", "qty_pct", "rev", "rev_pct"]
    full = pd.DataFrame(rows, columns=cols)
    if len(full):
        full = full.sort_values(["rev", "units", "brand"], ascending=[False, False, True], kind="mergesort").reset_index(drop=True)
    shown = full.head(top_n)
    if force_innova and "innova" not in set(shown["brand_key"]):
        inn = full[full["brand_key"] == "innova"]
        if len(inn):
            shown = pd.concat([shown, inn])
        else:
            zero = {"_tier": label, "brand": "Innova", "brand_key": "innova", "listings": 0, "avg_price": float("nan"), "units": 0.0,
                    "qty_pct": X.safe_div(0.0, tier_units), "rev": 0.0, "rev_pct": X.safe_div(0.0, tier_rev)}
            shown = pd.concat([shown, pd.DataFrame([zero], columns=cols)])
    shown = shown.reset_index(drop=True)
    rest = sorted(set(full["brand_key"]) - set(shown["brand_key"]))
    residual = None
    if rest:
        residual = _pivot_row(sub[sub["brand_key"].isin(rest)], tier_units, tier_rev)
        residual.update(_tier=label, brand=C.RESIDUAL_ROW_LABEL.format(noun="brands", n=len(rest)))
    total = _pivot_row(sub, market_units, market_rev)
    total.update(_tier=label, brand=C.TOTAL_ROW_LABEL)
    return shown, residual, total


def _trend_row(sub: pd.DataFrame) -> dict:
    paired = sub[sub["last_year_units"].notna() & sub["units_month"].notna()]
    cur, ly = float(paired["units_month"].sum()), float(paired["last_year_units"].sum())
    rev = float(sub["revenue_month"].sum())
    return {"rev": rev, "units": float(sub["units_month"].sum()), "units_paired": cur, "ly_paired": ly,
            "yoy": (cur / ly - 1.0) if ly > 0 else float("nan"),
            "coverage": X.safe_div(float(paired["revenue_month"].sum()), rev), "n_yoy": int(len(paired))}


def trend_proxy(df: pd.DataFrame, *, top_n: int) -> tuple[pd.DataFrame, dict | None, dict]:
    ranked, _, _ = X.brand_summary(df, top_n=len(df) + 1)
    rows = []
    for key, display in zip(ranked["brand_key"], ranked["brand"]):
        d = _trend_row(df[df["brand_key"] == key])
        d.update(brand=display, brand_key=key)
        rows.append(d)
    full = pd.DataFrame(rows, columns=["brand", "brand_key", "rev", "units", "units_paired", "ly_paired", "yoy", "coverage", "n_yoy"])
    shown = full.head(top_n).reset_index(drop=True)
    rest = list(full["brand_key"].iloc[top_n:])
    residual = None
    if rest:
        residual = _trend_row(df[df["brand_key"].isin(rest)])
        residual["brand"] = C.RESIDUAL_ROW_LABEL.format(noun="brands", n=len(rest))
    total = _trend_row(df)
    total["brand"] = C.TOTAL_ROW_LABEL
    return shown, residual, total


def build_analysis_book(ctx: Ctx) -> Book:
    book = Book(C.cr_analysis_name("CA", ctx.month), MARKET)
    df, ccy = ctx.df, ctx.ccy

    # Brand x Tier: one table per tier label (leaf tiers and Total* groups), Total row first
    ws = book.sheet("Brand x Tier")
    cols = _pivot_columns(ccy)
    r = X.write_sheet_header(ws, f"CA Code Reader — Brand x Price Tier ({ctx.mon})", ctx.sub, len(cols), note=PIVOT_NOTE) + 1
    for label in C.CR_TIER_ORDER:
        leaves = tier_leaves(label)
        sub = df[df["price_tier"].isin(leaves)]
        shown, residual, total = tier_pivot(sub, label, top_n=C.SUMMARY_TOP_BRANDS, market_units=ctx.market_units,
                                            market_rev=ctx.market_rev)
        tr = book.table(ws, TableSpec("Brand x Tier", "tier_pivot", label, cols, shown, X.fit(total, cols), X.fit(residual, cols),
                                      ("CA",), dataset_filter=f"price_tier in {list(leaves)}", total_position="top"), r)
        r = X.table_end(tr) + 3

    # Category: per tier, top CATEGORY_TOP_BRANDS brands + Innova + residual + tier total
    ws = book.sheet("Category")
    cols = _pivot_columns(ccy, listings=True)
    r = X.write_sheet_header(ws, f"CA Code Reader — Category view by tier ({ctx.mon})", ctx.sub, len(cols),
                             note=f"Top {C.CATEGORY_TOP_BRANDS} brands per tier by revenue, plus Innova (listed even with no "
                                  f"listing in the tier), then the remaining brands as one residual row. " + PIVOT_NOTE) + 1
    for label in C.CR_TIER_ORDER:
        leaves = tier_leaves(label)
        sub = df[df["price_tier"].isin(leaves)]
        shown, residual, total = tier_pivot(sub, label, top_n=C.CATEGORY_TOP_BRANDS, market_units=ctx.market_units,
                                            market_rev=ctx.market_rev, force_innova=True)
        tr = book.table(ws, TableSpec("Category", "category", f"{label} — top {C.CATEGORY_TOP_BRANDS} brands + Innova", cols, shown,
                                      X.fit(total, cols), X.fit(residual, cols), ("CA",),
                                      dataset_filter=f"price_tier in {list(leaves)}"), r)
        r = X.table_end(tr) + 3

    # one tab per tier label
    cols = X.top50_columns(ccy)
    for label in C.CR_TIER_ORDER:
        leaves = tier_leaves(label)
        sub = df[df["price_tier"].isin(leaves)]
        ws = book.sheet(label)
        shown, residual, total = X.top_listings(sub, by="revenue", n=C.TIER_TAB_TOP_N)
        book.table(ws, TableSpec(label, "tier_tab", f"{label} — top {C.TIER_TAB_TOP_N} listings by revenue ({ctx.mon})", cols, shown,
                                 X.fit(total, cols), X.fit(residual, cols), ("CA",), subtitle=ctx.sub,
                                 dataset_filter=f"price_tier in {list(leaves)}"), 1)

    # Trend Proxy
    ws = book.sheet("Trend Proxy")
    cols = [Col("Brand", "brand", "text", 26), Col(f"Monthly Rev ({ccy})", "rev", "money", 15), Col("Monthly Units", "units", "int", 12),
            Col("Monthly Units (paired cohort)", "units_paired", "int", 14),
            Col("Last Year Units (paired cohort)", "ly_paired", "int", 14), Col("Units YoY % (paired sums)", "yoy", "pct", 13),
            Col("Cohort coverage % (revenue)", "coverage", "pct", 14), Col("# Listings with YoY data", "n_yoy", "int", 13)]
    shown, residual, total = trend_proxy(df, top_n=C.SUMMARY_TOP_BRANDS)
    book.table(ws, TableSpec("Trend Proxy", "trend_proxy", f"Trend proxy — Helium 10 last-year units by brand ({ctx.mon})", cols, shown,
                             X.fit(total, cols), X.fit(residual, cols), ("CA",), subtitle=ctx.sub,
                             note=TREND_NOTE + ". Paired cohort = listings with both a current and a last-year unit estimate; "
                                               "YoY = paired current units ÷ paired last-year units − 1.",
                             dataset_filter="all CA code-reader rows"), 1)

    # Type Coverage
    ws = book.sheet("Type Coverage")
    base = X.type_source_base(df["type_source"])
    n, rev = len(df), ctx.market_rev
    src_rows = [{"src": s, "n": int((base == s).sum()), "n_pct": X.safe_div((base == s).sum(), n),
                 "rev": float(df.loc[base == s, "revenue_month"].sum()),
                 "rev_pct": X.safe_div(df.loc[base == s, "revenue_month"].sum(), rev)} for s in C.TYPE_SOURCES]
    cols = [Col("Type Source", "src", "text", 18), Col("# of Listings", "n", "int", 11), Col("% of Listings", "n_pct", "pct", 11),
            Col(f"Monthly Rev ({ccy})", "rev", "money", 15), Col("Revenue share", "rev_pct", "pct", 12)]
    total = {"src": C.TOTAL_ROW_LABEL, "n": n, "n_pct": 1.0 if n else float("nan"), "rev": rev, "rev_pct": X.safe_div(rev, rev)}
    tr = book.table(ws, TableSpec("Type Coverage", "type_coverage", f"Type assignment coverage by source ({ctx.mon})", cols,
                                  pd.DataFrame(src_rows), total, None, ("CA",), subtitle=ctx.sub,
                                  note="Type Source: override = human map; us_map = US ASIN→Type map; prior_month = frozen "
                                       "decision; keyword = title rule (keyword:<rule>); token_profile = title-token similarity; "
                                       "default_other = no evidence (review queue).",
                                  dataset_filter="all CA code-reader rows"), 1)
    type_rows = [{"type": t, "n": int((df["type"] == t).sum()), "rev": float(df.loc[df["type"] == t, "revenue_month"].sum()),
                  "units": float(df.loc[df["type"] == t, "units_month"].sum()),
                  "rev_pct": X.safe_div(df.loc[df["type"] == t, "revenue_month"].sum(), rev)} for t in C.TYPES]
    cols = [Col("Type", "type", "text", 18), Col("# of Listings", "n", "int", 11), Col(f"Monthly Rev ({ccy})", "rev", "money", 15),
            Col("Monthly Units", "units", "int", 12), Col("Revenue share", "rev_pct", "pct", 12)]
    total = {"type": C.TOTAL_ROW_LABEL, "n": n, "rev": rev, "units": ctx.market_units, "rev_pct": X.safe_div(rev, rev)}
    book.table(ws, TableSpec("Type Coverage", "type_coverage", "Listings by Type", cols, pd.DataFrame(type_rows), total, None, ("CA",),
                             dataset_filter="all CA code-reader rows"), X.table_end(tr) + 3)

    book.metadata(book.sheet("Metadata"), _metadata(ctx))
    if book.sheetnames != list(C.CR_ANALYSIS_SHEETS):
        raise AssertionError(f"analysis sheet order drifted: {book.sheetnames}")
    return book


# --------------------------------------------------------------------------------------
# Entry points
# --------------------------------------------------------------------------------------
def _save_outputs(books: list[Book], out_dir: Path, *, overwrite: bool, dated_copy: bool, manifest: dict | None) -> list[Path]:
    paths: list[Path] = []
    for book in books:
        path = X.safe_output_path(out_dir, book.name, overwrite, manifest)
        book.save(path)
        paths.append(path)
        if dated_copy:
            dp = X.safe_output_path(out_dir, X.dated_copy_name(book.name), overwrite, manifest)
            shutil.copyfile(path, dp)
            paths.append(dp)
    return paths


def build_code_reader_workbooks(ds: C.CaDataset, out_dir: Path, *, overwrite: bool, dated_copy: bool, runs_dir: Path = C.RUNS_DIR,
                                input_paths: list[Path] | tuple = ()) -> list[Path]:
    """Build both CA code-reader workbooks; returns [report, (dated copy), analysis, (dated copy)].

    Also writes runs/<m>/table_registry_CA_<m>.json (merged with the gauge builder's entries) and <out_dir>/manifest_<m>.json.
    `input_paths` are hashed into the manifest (raw CSVs / normalized frame); maps/*.csv are always added.
    """
    if ds.market != "CA":
        raise ValueError(f"the code-reader workbooks are CA only (got market {ds.market!r})")
    if not C.MONTH_RE.match(str(ds.month)):
        raise ValueError(f"invalid month {ds.month!r}")
    out_dir = Path(out_dir)
    names = [C.cr_report_name("CA", ds.month), C.cr_analysis_name("CA", ds.month)]
    if not overwrite:
        existing = [n for n in names if (out_dir / n).exists()]
        if existing:
            raise FileExistsError(f"outputs exist in {out_dir}: {existing}; pass --overwrite (old files are backed up)")
    df = prepare_cr_frame(ds.code_reader)
    ctx = Ctx(ds=ds, df=df, month=ds.month, mon=X.month_label(ds.month), sub=X.subtitle_text(MARKET, ds.export_dates, ds.month),
              ccy=MARKET.currency, market_rev=float(df["revenue_month"].sum()), market_units=float(df["units_month"].sum()))
    books = [build_report_book(ctx), build_analysis_book(ctx)]
    manifest = X.read_manifest(out_dir, ds.month)
    paths = _save_outputs(books, out_dir, overwrite=overwrite, dated_copy=dated_copy, manifest=manifest)
    reg = X.TableRegistry("CA", ds.month)
    for b in books:
        reg.add_book(b)
    reg_path = reg.write(runs_dir)
    inputs = X.input_hashes(list(input_paths) + sorted(C.MAPS_DIR.glob("*.csv")))
    man_path = X.write_manifest(out_dir, ds.month, paths, inputs)
    print(f"registry: {reg_path} ({sum(len(b.tables) for b in books)} tables)")
    print(f"manifest: {man_path}")
    return paths


def _print_audit(ds: C.CaDataset) -> None:
    df = prepare_cr_frame(ds.code_reader)
    print(f"AUDIT raw files: {ds.raw_files}")
    print(f"AUDIT dedupe: {X.dedupe_summary(ds.audits.get('dedupe_audit'), X.input_mode(ds))}")
    print(f"AUDIT type coverage: {X.type_coverage_text(df)}")
    review = ds.audits.get("type_review")
    print(f"AUDIT type review rows: {0 if review is None else len(review)}")


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Build the CA code-reader Competitor Report + Analysis workbooks")
    p.add_argument("--month", required=True, help="report month YYYYMM")
    p.add_argument("--raw-dir", type=Path, help="CA code-reader raw CSV folder (default NewProductCategory/CA-CODE-READER/raw_data/<m>)")
    p.add_argument("--out-dir", type=Path, help="output folder (default NewProductCategory/CA-CODE-READER/outputs)")
    p.add_argument("--us-type-map", type=Path, default=C.US_TYPE_MAP_DEFAULT)
    p.add_argument("--type-map", type=Path, default=C.MAPS_DIR / "ca_type_overrides.csv")
    p.add_argument("--runs-dir", type=Path, help="frozen run decisions + registry (default ca_market_reports/runs)")
    p.add_argument("--audit", action="store_true", help="print the dataset audit summary (raw files, dedupe, type coverage)")
    p.add_argument("--overwrite", action="store_true", help="replace existing outputs (old files moved to _backup/)")
    p.add_argument("--rederive", action="store_true", help="re-derive decisions instead of replaying frozen ones (loader)")
    p.add_argument("--dated-copy", action="store_true", help="also write <name>_<YYYYMMDD>.xlsx")
    p.add_argument("--from-normalized", type=Path, help="DEV: build from a normalized-row CSV (fixtures); skips the loader")
    a = p.parse_args(argv)
    if not C.MONTH_RE.match(a.month):
        p.error(f"--month must be a calendar month YYYYMM, got {a.month!r}")
    return a


def main(argv: list[str] | None = None) -> int:
    a = parse_args(argv)
    if a.from_normalized:
        if a.out_dir is None:
            raise SystemExit("--from-normalized needs --out-dir (dev runs never write to the real output folder)")
        X.refuse_new_product_dir(a.out_dir)
        if a.runs_dir is None:
            raise SystemExit("--from-normalized needs --runs-dir (dev runs never write to ca_market_reports/runs)")
        ds = X.dataset_from_normalized(X.read_normalized_csv(a.from_normalized), "CA", a.month)
        inputs = [a.from_normalized]
        out_dir, runs_dir = a.out_dir, a.runs_dir
    else:
        from ca_market_reports.ca_load import load_month  # ASSEMBLY: ca_load.load_month
        raw_dir = a.raw_dir or MARKET.cr_raw_dir(a.month)
        runs_dir = a.runs_dir or C.RUNS_DIR
        ds = load_month("CA", a.month, cr_raw_dir=raw_dir, us_type_map=a.us_type_map, type_map=a.type_map, runs_dir=runs_dir,
                        assign_types=True, rederive=a.rederive)
        inputs = sorted(Path(raw_dir).glob("*.csv")) + [a.us_type_map, a.type_map]
        inputs += sorted((Path(runs_dir) / a.month).glob("*_CA_code_reader_*.csv"))
        out_dir = a.out_dir or MARKET.cr_out_dir()
    paths = build_code_reader_workbooks(ds, out_dir, overwrite=a.overwrite, dated_copy=a.dated_copy, runs_dir=runs_dir,
                                        input_paths=inputs)
    if a.audit:
        _print_audit(ds)
    for p in paths:
        print(f"wrote {p}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
