"""Frozen names shared by every ca_market_reports module.

This file is the interface contract between the tracks (loader, brands/types/tiers,
gauge classifier, workbook builders, validator, runbook). Change a value here only
through the orchestrator; implementers flag rather than invent.

Data lives OUTSIDE git (the NewProductCategory/ and "Amazon_Monthly_Competitor_Report copy"/
folders are gitignored), so every default path below is ABSOLUTE and points at the
main checkout, not at the worktree that runs the code.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

# --------------------------------------------------------------------------------------
# Paths (absolute; data is gitignored and only exists in the main checkout)
# --------------------------------------------------------------------------------------
PACKAGE_ROOT = Path(__file__).resolve().parent            # .../ca_market_reports
REPO_ROOT = PACKAGE_ROOT.parent                             # the checkout/worktree running the code
MAIN_CHECKOUT = Path("/Users/sumiaoc/competitor_research_product")
NEW_PRODUCT_DIR = MAIN_CHECKOUT / "NewProductCategory"
REPORT_REPO_DIR = MAIN_CHECKOUT / "Amazon_Monthly_Competitor_Report copy"
VENV_PYTHON = REPORT_REPO_DIR / ".venv" / "bin" / "python"
US_TYPE_MAP_DEFAULT = REPORT_REPO_DIR / "amazon_scanner_type.xlsx"      # ASIN -> Type (US, 11,227 rows)
US_CR_RAW_ROOT = REPORT_REPO_DIR / "Amazon_Raw_Data" / "raw_data"       # /<YYYYMM>/*.csv (US code reader)
MAPS_DIR = PACKAGE_ROOT / "maps"
RUNS_DIR = PACKAGE_ROOT / "runs"
MEMO_DIR = PACKAGE_ROOT / "memo"
FIXTURES_DIR = PACKAGE_ROOT / "tests" / "fixtures"
SCRATCH_DIR = REPO_ROOT / "tmp" / "ca_scratch"            # gitignored (tmp/); delegates write here, never to NewProductCategory

MONTH_RE = re.compile(r"^\d{6}$")
ASIN_RE = re.compile(r"^[A-Z0-9]{10}$")
EXPORT_DATE_RE = re.compile(r"_(\d{4}-\d{2}-\d{2})")       # from Helium 10 file names


# --------------------------------------------------------------------------------------
# Markets
# --------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Market:
    code: str                 # "CA" | "US"
    domain: str               # amazon.ca | amazon.com
    currency: str             # CAD | USD
    money_fmt: str            # Excel number format, whole units
    money_fmt_2dp: str        # Excel number format, 2 dp (prices)
    label: str                # used in sheet subtitles
    gauge_folder: str         # NewProductCategory/<folder>
    cr_folder: str | None     # NewProductCategory/<folder>; None -> US_CR_RAW_ROOT

    def url(self, asin: str) -> str:
        return f"https://{self.domain}/dp/{asin}"

    def cr_raw_dir(self, month: str) -> Path:
        if self.cr_folder is None:
            return US_CR_RAW_ROOT / month
        return NEW_PRODUCT_DIR / self.cr_folder / "raw_data" / month

    def gauge_raw_dir(self, month: str) -> Path:
        return NEW_PRODUCT_DIR / self.gauge_folder / "raw_data" / month

    def cr_out_dir(self) -> Path:
        if self.cr_folder is None:
            raise ValueError("US code-reader workbooks are out of scope (no out dir)")
        return NEW_PRODUCT_DIR / self.cr_folder / "outputs"

    def gauge_out_dir(self) -> Path:
        return NEW_PRODUCT_DIR / self.gauge_folder / "outputs"


MARKETS: dict[str, Market] = {
    "CA": Market("CA", "amazon.ca", "CAD", '"CA$"#,##0', '"CA$"#,##0.00',
                 "amazon.ca · CAD · Helium 10 estimates", "CA-OBD-GAUGE", "CA-CODE-READER"),
    "US": Market("US", "amazon.com", "USD", '"$"#,##0', '"$"#,##0.00',
                 "amazon.com · USD · Helium 10 estimates (raw, no actuals overlay)", "US-OBD-GAUGE", None),
}

# --------------------------------------------------------------------------------------
# Output file names (stable, month-stamped; the validator targets exactly these)
# --------------------------------------------------------------------------------------
def cr_report_name(market: str, month: str) -> str:
    return f"{market}_Code_Reader_Competitor_Report_{month}.xlsx"

def cr_analysis_name(market: str, month: str) -> str:
    return f"{market}_Code_Reader_Analysis_{month}.xlsx"

def gauge_report_name(market: str, month: str) -> str:
    return f"{market}_OBD_Gauge_Competitor_Report_{month}.xlsx"

def manifest_name(month: str) -> str:
    return f"manifest_{month}.json"

def memo_name(month: str) -> str:
    return f"CA_OBD_Gauge_Market_Memo_{month}.md"

BACKUP_SUBDIR = "_backup"          # <out_dir>/_backup/<name>.<YYYYMMDD-HHMMSS>.xlsx
RUNBOOK_FILE = "RUNBOOK.md"

# --------------------------------------------------------------------------------------
# Code-reader Type taxonomy (identical to the US pipeline)
# --------------------------------------------------------------------------------------
TYPES: tuple[str, ...] = ("Tablet", "Handheld", "Dongle", "VCI", "Cable/Adapter", "Key", "OBD1", "Probe", "Other")
OTHER_TOOLS_TYPES: tuple[str, ...] = ("Key", "Cable/Adapter", "Other", "Probe", "VCI", "OBD1")  # OBD1 included (US quirk not carried over)
# type_source values; keyword hits are recorded as "keyword:<rule_name>"
TYPE_SOURCES: tuple[str, ...] = ("override", "us_map", "prior_month", "keyword", "token_profile", "default_other")
TYPE_REVIEW_CONFIDENCE = 0.70      # token_profile below this, and every default_other, goes to type_review_<m>.csv
TYPE_LOUD_REVENUE = 1000.0         # any default_other row at/above this monthly revenue triggers a loud warning

# --------------------------------------------------------------------------------------
# Gauge taxonomy (ordered: first matching rule wins; ASIN map decisions override everything)
# --------------------------------------------------------------------------------------
GAUGE_CLASSES: tuple[tuple[str, str], ...] = (
    ("XN", "excluded_non_gauge"),
    ("XD", "excluded_app_dongle"),
    ("AC", "gauge_accessory"),
    ("TD", "tuner_with_gauge_display"),
    ("TM", "truck_gauge_monitor"),
    ("HG", "obd_gps_hud"),
    ("HO", "obd_hud"),
    ("GH", "gps_hud"),
    ("GD", "gauge_display"),
    ("AMB", "ambiguous"),
)
GAUGE_CLASS_BY_CODE: dict[str, str] = dict(GAUGE_CLASSES)
GAUGE_CLASS_NAMES: tuple[str, ...] = tuple(name for _, name in GAUGE_CLASSES)
GAUGE_DEVICE_CLASSES: tuple[str, ...] = ("tuner_with_gauge_display", "truck_gauge_monitor", "obd_gps_hud", "obd_hud", "gauge_display")  # counted in OBD gauge totals
GAUGE_ADJACENT_CLASSES: tuple[str, ...] = ("gps_hud",)                      # shown as adjacent, excluded from OBD totals (decision D3)
GAUGE_ACCESSORY_CLASSES: tuple[str, ...] = ("gauge_accessory",)
GAUGE_EXCLUDED_CLASSES: tuple[str, ...] = ("excluded_non_gauge", "excluded_app_dongle")
GAUGE_LORDCO_TYPE_CLASSES: tuple[str, ...] = ("tuner_with_gauge_display", "truck_gauge_monitor")
# gauge_in_scope is True for DEVICE + ADJACENT + ACCESSORY classes (they appear in the gauge workbook, each in its own section);
# False for EXCLUDED and for `ambiguous` (ambiguous rows go to the review queue and the Excluded tab with rule id AMB).
GAUGE_IN_SCOPE_CLASSES: tuple[str, ...] = GAUGE_DEVICE_CLASSES + GAUGE_ADJACENT_CLASSES + GAUGE_ACCESSORY_CLASSES
GAUGE_SUBTYPE_LABELS: dict[str, str] = {
    "tuner_with_gauge_display": "Tuner with gauge display",
    "truck_gauge_monitor": "Truck gauge monitor",
    "obd_gps_hud": "OBD+GPS HUD",
    "obd_hud": "OBD HUD",
    "gps_hud": "GPS-only HUD (adjacent)",
    "gauge_display": "Gauge display",
    "gauge_accessory": "Gauge accessory",
    "excluded_non_gauge": "Excluded - not a gauge",
    "excluded_app_dongle": "Excluded - app dongle",
    "ambiguous": "Ambiguous - needs review",
}
# Device feature flags (title-derived unless verified); fixed vocabularies
FEATURE_DATA_SOURCE = ("OBD", "OBD+GPS", "GPS", "unspecified")
FEATURE_SCREEN_TYPE = ("windshield projector", "dash-top LCD", "in-dash round gauge", "tuner touchscreen", "unspecified")
FEATURE_FUEL_SCOPE = ("gas", "diesel-capable", "unspecified")
FEATURE_COLUMNS: tuple[str, ...] = ("data_source", "screen_type", "fuel_scope", "alarms", "multi_gauge", "gesture_control", "kmh_mph", "lordco_type_unit")

# --------------------------------------------------------------------------------------
# Price tiers — half-open [lo, hi); the top tier has hi = inf (fixes the US ceil(max) strict-< edge case)
# --------------------------------------------------------------------------------------
INF = math.inf
# Code reader: (tier label) -> (types, lo, hi). Labels are frozen sheet/row names.
CR_TIERS: dict[str, tuple[tuple[str, ...], float, float]] = {
    "Tablet $800+":      (("Tablet",), 800.0, INF),
    "Tablet $400-$800":  (("Tablet",), 400.0, 800.0),
    "Tablet $400-":      (("Tablet",), 0.0, 400.0),
    "Handheld $75+":     (("Handheld",), 75.0, INF),
    "Handheld $75-":     (("Handheld",), 0.0, 75.0),
    "Total Dongle":      (("Dongle",), 0.0, INF),
    "Total Other Tools": (OTHER_TOOLS_TYPES, 0.0, INF),
}
CR_TIER_GROUPS: dict[str, tuple[str, ...]] = {
    "Total Tablet":   ("Tablet $800+", "Tablet $400-$800", "Tablet $400-"),
    "Total Handheld": ("Handheld $75+", "Handheld $75-"),
    "Total":          ("Tablet $800+", "Tablet $400-$800", "Tablet $400-", "Handheld $75+", "Handheld $75-", "Total Dongle", "Total Other Tools"),
}
CR_TIER_ORDER: tuple[str, ...] = ("Tablet $800+", "Tablet $400-$800", "Tablet $400-", "Total Tablet",
                                  "Handheld $75+", "Handheld $75-", "Total Handheld", "Total Dongle", "Total Other Tools", "Total")
# Gauge devices (CAD for CA, USD for US; same labels)
GAUGE_TIERS: tuple[tuple[str, float, float], ...] = (
    ("Under $50", 0.0, 50.0), ("$50-99", 50.0, 100.0), ("$100-249", 100.0, 250.0), ("$250-499", 250.0, 500.0), ("$500+", 500.0, INF),
)
# Model B proxy (code-reader Type == Dongle)
DONGLE_TIERS: tuple[tuple[str, float, float], ...] = (
    ("Under $50", 0.0, 50.0), ("$50-99", 50.0, 100.0), ("$100-149", 100.0, 150.0), ("$150-249", 150.0, 250.0), ("$250+", 250.0, INF),
)

# --------------------------------------------------------------------------------------
# Normalized row contract (one row per ASIN after dedupe) — column order is frozen
# --------------------------------------------------------------------------------------
ROW_COLUMNS: tuple[str, ...] = (
    "asin", "title", "brand_raw", "brand_key", "brand_display", "seller", "fulfillment", "category", "subcategory",
    "bsr", "subcategory_bsr", "list_price", "units_month", "revenue_month", "price",
    "review_count", "rating", "listing_age_months", "variation_count", "frequently_returned",
    "last_year_units", "yoy_units_pct", "sales_trend_90d_pct", "price_trend_90d_pct",
    "url", "image_url", "export_date", "source_file", "source_set", "market", "currency",
    "type", "type_source", "type_confidence",
    "gauge_class", "gauge_in_scope", "gauge_rule_id", "gauge_confidence",
    "price_tier",
)
SOURCE_SETS: tuple[str, ...] = ("code_reader", "gauge", "both")
# Helium 10 Black Box header names we read (by name, never by position)
H10_COLUMNS: dict[str, str] = {
    "url": "URL", "image_url": "Image URL", "asin": "ASIN", "title": "Title", "brand_raw": "Brand",
    "fulfillment": "Fulfillment", "category": "Category", "bsr": "BSR", "subcategory": "Subcategory",
    "subcategory_bsr": "Subcategory BSR", "list_price": "Price", "price_trend_90d_pct": "Price Trend (90 days) (%)",
    "units_month": "ASIN Sales", "sales_trend_90d_pct": "Sales Trend (90 days) (%)", "revenue_month": "ASIN Revenue",
    "review_count": "Review Count", "frequently_returned": "Frequently Returned Item Badge", "rating": "Reviews Rating",
    "seller": "Seller", "last_year_units": "Last Year Sales", "yoy_units_pct": "Sales Year Over Year (%)",
    "listing_age_months": "Listing Age (Months)", "variation_count": "Variation Count",
}
# Never aggregate these Helium 10 columns (they double count variations)
H10_NEVER_SUM: tuple[str, ...] = ("Parent Level Sales", "Parent Level Revenue")

# --------------------------------------------------------------------------------------
# Frozen CSV schemas (maps are append-only human decisions; runs/<m>/ are frozen machine decisions)
# --------------------------------------------------------------------------------------
TYPE_OVERRIDES_COLUMNS = ("asin", "type", "reason", "decided_by", "decided_month")
GAUGE_MAP_COLUMNS = ("asin", "gauge_class", "in_scope", "reason", "decided_by", "decided_month")
BRAND_ALIASES_COLUMNS = ("raw_key", "canonical_key", "note")
BRAND_DISPLAY_COLUMNS = ("canonical_key", "display")
DEDUPE_AUDIT_COLUMNS = ("asin", "n_rows", "chosen_file", "dropped_files", "values_identical", "revenue_chosen", "revenue_dropped_max", "reason")
TYPE_DECISIONS_COLUMNS = ("month", "asin", "type", "type_source", "type_confidence", "run_id")
TYPE_REVIEW_COLUMNS = ("asin", "title", "brand_display", "price", "revenue_month", "url", "proposed_type", "type_source", "type_confidence", "reviewed_type")
GAUGE_DECISIONS_COLUMNS = ("month", "market", "asin", "gauge_class", "gauge_in_scope", "gauge_rule_id", "gauge_confidence", "run_id")
BRAND_RECOVERY_COLUMNS = ("month", "asin", "title", "old_brand", "new_brand", "matched_text", "monthly_units", "monthly_revenue", "action")  # action ∈ {reassigned}
SOURCES_COLUMNS = ("url", "accessed", "publisher", "claim", "quote", "used_in_section")   # memo/sources_<m>.csv; quote ≤ 15 words

def run_file(runs_dir: Path, month: str, stem: str, ext: str = "csv") -> Path:
    """runs/<month>/<stem>_<month>.<ext>  e.g. dedupe_audit_202609.csv"""
    return Path(runs_dir) / month / f"{stem}_{month}.{ext}"

RUN_STEMS = ("dedupe_audit", "type_decisions", "type_review", "gauge_decisions", "brand_recovery", "validation", "preview_summary", "manifest")

# --------------------------------------------------------------------------------------
# Sheet registries (names are frozen; Excel limit 31 chars — all verified)
# --------------------------------------------------------------------------------------
CR_REPORT_FIXED_SHEETS: tuple[str, ...] = ("Summary", "Top 50", "Innova")        # then one tab per top brand, then:
CR_REPORT_TAIL_SHEETS: tuple[str, ...] = ("All ASINs", "Metadata")
CR_REPORT_BRAND_TABS = 10                                                        # top-N brands by revenue get a tab (Innova always has its own)
CR_ANALYSIS_SHEETS: tuple[str, ...] = ("Brand x Tier", "Category") + CR_TIER_ORDER + ("Trend Proxy", "Type Coverage", "Metadata")
GAUGE_FIXED_SHEETS: tuple[str, ...] = ("Read Me", "Summary", "Top 50", "Innova")  # then brand tabs, then:
GAUGE_MODEL_SHEETS: tuple[str, ...] = ("Price Ladder (Model A)", "Feature Matrix (Model A)", "App-Gauge Proxy (Model B)")   # CA only
GAUGE_BENCHMARK_SHEETS: tuple[str, ...] = ("US Benchmark", "US vs CA Same-ASIN")                                           # CA only
GAUGE_TAIL_SHEETS: tuple[str, ...] = ("Dedupe & Classification Audit", "Excluded", "Source & Method", "Metadata")
GAUGE_BRAND_TAB_MIN_REVENUE = 1000.0   # brand gets a tab if device revenue >= this ...
GAUGE_BRAND_TAB_MIN_ASINS = 3          # ... or it has at least this many device ASINs
SUMMARY_TOP_BRANDS = 25
TOP_N = 50
TIER_TAB_TOP_N = 25
CATEGORY_TOP_BRANDS = 5

for _s in CR_ANALYSIS_SHEETS + GAUGE_MODEL_SHEETS + GAUGE_BENCHMARK_SHEETS + GAUGE_TAIL_SHEETS:
    assert len(_s) <= 31, _s

# Fixed column headers (frozen so the validator can find them)
SUMMARY_COLUMNS: tuple[str, ...] = ("Brand", "# of Listings", "Monthly Rev ({ccy})", "Monthly Units", "Monthly Rev Market Share %",
                                    "Price Per Unit ({ccy})", "Total Reviews", "Avg Rating")
TOP50_COLUMNS: tuple[str, ...] = ("Ranking", "ASIN", "Product Name", "Brand", "Type", "Price ({ccy})", "Est. Monthly Retail Rev ({ccy})",
                                  "Est. Monthly Units Sold", "# of Reviews", "Avg. Rating", "Listing Age (Months)", "Last Year Sales (Helium 10)",
                                  "Sales YoY % (Helium 10)", "90-day Sales Trend % (Helium 10)", "URL", "Link")
BRAND_TAB_COLUMNS: tuple[str, ...] = ("Product Name", "ASIN", "Type", "Price ({ccy})", "Monthly Rev ({ccy})", "Monthly Units",
                                      "# of Reviews", "Tool Rating", "Listing Age (Months)", "Sales YoY % (Helium 10)", "URL", "Link")
INNOVA_TAB_EXTRA_COLUMNS: tuple[str, ...] = ("Item #", "Seller", "Sold by Amazon", "Fulfillment")
TIER_PIVOT_COLUMNS: tuple[str, ...] = ("Avg Price ({ccy})", "Quantity/Mo", "Qty by %", "Revenue/Mo ({ccy})", "Revenue by %")
METADATA_REQUIRED_KEYS: tuple[str, ...] = ("Marketplace", "Currency", "Report month", "Export dates", "Raw files", "Dedupe summary",
                                           "Type coverage", "Gauge overlap", "Pipeline version", "Generated at", "Scope note")

# Formula policy: only these shapes may appear in any workbook; everything else is a static value
ALLOWED_FORMULA_RES: tuple[re.Pattern[str], ...] = (
    re.compile(r"^=SUM\([A-Z]{1,2}\d+:[A-Z]{1,2}\d+\)$"),
    re.compile(r'^=AVERAGEIF\([A-Z]{1,2}\d+:[A-Z]{1,2}\d+,"<>0"\)$'),
    re.compile(r"^=IFERROR\([A-Z]{1,2}\d+/[A-Z]{1,2}\d+,0\)$"),
    re.compile(r'^=HYPERLINK\("https://amazon\.(ca|com)/dp/[A-Z0-9]{10}","Amazon\.(ca|com) - [A-Z0-9]{10}"\)$'),
)
HYPERLINK_TEXT = "Amazon.{tld} - {asin}"

# Style constants (from NewProductCategory/Borescope/apply_borescope_excel_formatting.py — the house style)
FILL_TITLE = "B4A7D6"
FILL_HEADER = "D9D2E9"
FILL_ALT_ROW = "EAE4F5"
FILL_TOTAL = "2E1A47"       # white bold text on this
COLOR_LINK = "0563C1"
COLOR_INNOVA = "FF0000"     # Innova rows red text (US convention)
BRAND_PALETTE: tuple[str, ...] = ("4F81BD", "C0504D", "9BBB59", "8064A2", "4BACC6", "F79646", "2C4D75", "772C2A", "5F7530", "4D3B62")
BRAND_TAB_RESERVED_ROWS = 6  # rows 1-6: title, subtitle, KPI block; "Rank by Revenue" title at row 7, header row 8

# --------------------------------------------------------------------------------------
# Validator contract
# --------------------------------------------------------------------------------------
VALIDATION_CHECKS: dict[str, str] = {
    "V01": "summary revenue total == dataset revenue total",
    "V02": "summary units total == dataset units total",
    "V03": "summary # of listings == unique ASINs in dataset",
    "V04": "Top 50 rank 1 revenue == dataset max revenue",
    "V05": "market shares sum to 1 (tol 1e-6)",
    "V06": "every URL/HYPERLINK matches the market domain; zero cross-market URLs",
    "V07": "currency labels: money formats carry the market currency; '(CAD)'/'(USD)' on money headers; no foreign currency strings",
    "V08": "Innova rows in workbook == Innova rows in dataset (> 0 for CA code reader)",
    "V09": "Total-row formula ranges match data extents",
    "V10": "no ~$ lock files in out dirs",
    "V11": "zero error tokens (#REF!, #DIV/0!, #NAME?, #VALUE!) in any cell",
    "V12": "gauge in-scope rows/revenue == classified in-scope rows (CA: Bully Dog TD rows present)",
    "V13": "Excluded tab rows == excluded + ambiguous classified rows",
    "V14": "no duplicate ASIN within any workbook table",
    "V15": "Metadata tab has every METADATA_REQUIRED_KEYS entry",
    "V16": "chart count per sheet as registered; every chart axis delete=0",
    "V17": "type coverage: every default_other row is listed in type_review_<m>.csv",
    "V18": "All ASINs rows == dataset rows",
    "V19": "manifest sha256 matches the files on disk",
    "V20": "every [WB: file!sheet!cell] reference in the memo resolves and matches (±0.5%)",
}
VALIDATION_FINAL_RE = re.compile(r"^VALIDATION: (PASS|FAIL) \((\d+)/(\d+)(?:; failed: [A-Z0-9, ]+)?\)$")
MEMO_WB_REF_RE = re.compile(r"\[WB: (?P<file>[^!\]]+)!(?P<sheet>[^!\]]+)!(?P<cell>[A-Z]{1,3}\d+)\]")
MEMO_SRC_REF_RE = re.compile(r"\[SRC: (?P<url>https?://[^,\]]+), accessed (?P<date>\d{4}-\d{2}-\d{2})\]")


# --------------------------------------------------------------------------------------
# Dataset container returned by ca_load.load_month (frozen signature; see docstring)
# --------------------------------------------------------------------------------------
@dataclass
class CaDataset:
    """Result of ca_load.load_month(...).

    code_reader : normalized rows from the code-reader export (ROW_COLUMNS), typed when assign_types=True
    gauge_set   : normalized rows from the gauge export (ROW_COLUMNS, type columns empty), or None
    export_dates: (min, max) export dates parsed from file names across both sets
    raw_files   : [(file_name, row_count), ...] in read order
    audits      : {"dedupe_audit": DataFrame(DEDUPE_AUDIT_COLUMNS), "brand_recovery": ..., "type_decisions": ..., "type_review": ...}
    """
    market: str
    month: str
    code_reader: Any                      # pandas.DataFrame
    gauge_set: Any | None                 # pandas.DataFrame | None
    export_dates: tuple[date, date]
    raw_files: list[tuple[str, int]] = field(default_factory=list)
    audits: dict[str, Any] = field(default_factory=dict)


# Frozen function signatures (implemented in the named modules; documented here so every track codes against one contract):
#
#   ca_load.load_month(market: str, month: str, *, cr_raw_dir: Path | None = None, gauge_raw_dir: Path | None = None,
#                      us_type_map: Path | None = US_TYPE_MAP_DEFAULT, type_map: Path = MAPS_DIR/"ca_type_overrides.csv",
#                      gauge_map: Path = MAPS_DIR/"ca_gauge_map.csv", runs_dir: Path = RUNS_DIR, assign_types: bool = True,
#                      rederive: bool = False, freeze: bool = True) -> CaDataset
#   ca_load.union_gauge_frames(primary: DataFrame, secondary: DataFrame) -> DataFrame     # dedupe across sets; source_set="both"
#   ca_brands.canonical_brand_key(raw: str, aliases: dict[str, str]) -> str
#   ca_brands.display_brand(key: str, display: dict[str, str]) -> str
#   ca_brands.recover_generic_brands(df, vocabulary: set[str], frozen: DataFrame | None) -> tuple[DataFrame, DataFrame]  # (df, audit rows)
#   ca_types.assign_types(df, *, us_map: dict[str, str], overrides: dict[str, str], prior: dict[str, str]) -> DataFrame
#   ca_tiers.assign_cr_tiers(df) -> DataFrame        # adds price_tier using CR_TIERS (by type)
#   ca_tiers.tier_label(price: float, tiers: tuple[tuple[str, float, float], ...]) -> str
#   ca_gauge_classification.GAUGE_SCAN_RE: re.Pattern   # candidate pre-filter (used on the US code-reader export)
#   ca_gauge_classification.classify_gauges(df, gauge_map: DataFrame, prior: DataFrame | None = None) -> DataFrame   # adds the 4 gauge columns + FEATURE_COLUMNS
#   build_ca_code_reader_report.build_code_reader_workbooks(ds: CaDataset, out_dir: Path, *, overwrite: bool, dated_copy: bool) -> list[Path]
#   build_gauge_report.build_gauge_workbook(ds: CaDataset, out_dir: Path, *, benchmark: CaDataset | None, overwrite: bool, dated_copy: bool) -> Path
#   validate_outputs.main(argv) -> int   # prints one line per check "PASS|FAIL Vnn <name>: <evidence>" then VALIDATION_FINAL_RE line
