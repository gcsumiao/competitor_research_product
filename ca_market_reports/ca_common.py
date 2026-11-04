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

MONTH_RE = re.compile(r"^\d{4}(0[1-9]|1[0-2])$")   # calendar-valid month (finding 29)
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

def combined_gauge_report_name(month: str) -> str:
    """CA + US OBD gauge workbook (side-by-side comparison; lands in the CA-OBD-GAUGE outputs dir)."""
    return f"CA_US_OBD_Gauge_Competitor_Report_{month}.xlsx"

BACKUP_SUBDIR = "_backup"          # <out_dir>/_backup/<name>.<YYYYMMDD-HHMMSS>.xlsx
RUNBOOK_FILE = "RUNBOOK.md"

# --------------------------------------------------------------------------------------
# Code-reader Type taxonomy (identical to the US pipeline)
# --------------------------------------------------------------------------------------
TYPES: tuple[str, ...] = ("Tablet", "Handheld", "Dongle", "VCI", "Cable/Adapter", "Key", "OBD1", "Probe", "Other")
OTHER_TOOLS_TYPES: tuple[str, ...] = ("Key", "Cable/Adapter", "Other", "Probe", "VCI", "OBD1")  # OBD1 included (US quirk not carried over)
# type_source values (STRICT enum); the matching rule name goes to type_rule_id (e.g. "cable_adapter", "gauge_hud", "profile:<brand_key>")
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
# TWO scope predicates (Codex challenge finding 1 — never conflate them):
#   gauge_in_scope      = class in GAUGE_WORKBOOK_CLASSES  -> the row appears in the gauge workbook (own section per class)
#   gauge_device_scope  = class in GAUGE_DEVICE_CLASSES    -> the row counts in Summary totals, brand thresholds, tiers, shares, benchmarks
#   core device         = gauge_device_scope AND NOT borderline ; "incl. borderline" = gauge_device_scope (borderline rows included)
# EXCLUDED classes and `ambiguous` are in neither scope (they live on the Excluded tab with their rule id; ambiguous also in the review queue).
GAUGE_WORKBOOK_CLASSES: tuple[str, ...] = GAUGE_DEVICE_CLASSES + GAUGE_ADJACENT_CLASSES + GAUGE_ACCESSORY_CLASSES
GAUGE_IN_SCOPE_CLASSES = GAUGE_WORKBOOK_CLASSES   # alias kept for readability; same meaning as workbook scope
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
# Frozen rule anchors (Codex challenge findings 3, 7-12). The classifier module owns the full rule table, but these
# anchors are contractual: tests pin the boundary titles listed in the plan.
#  - Candidate pre-filter GAUGE_SCAN_RE must be SUPERSET-recall: it must match every device/accessory family anchor below
#    (Edge Insight CTS3 has no 'gauge'/'obd' token) and every ASIN present in maps/ca_gauge_map.csv is always a candidate.
#  - TD (tuner) requires a tuner model/family phrase; a bare brand never classifies: 'evolution ct', 'triple dog', 'platinum gt',
#    'gt platinum', 'gt gas', 'gt diesel', 'hemi plus', '4041x/4042x/4043x', 'juice.*attitude', 'flashpaq', 'dashpaq'.
#  - AC before TD: 'replacement block' / '40400-105' is an accessory; cables: r"\bh0000800(?:0)?\b|(?:hdmi|hd\s+multimedia\s+interface).*\b(?:cs2|cts2|cts3)\b";
#    'dash(board) mount ... scangauge' is an accessory, not GD.
#  - XN "scanner" exclusion is only legal when the title has a scanner/code-reader/diagnostic token AND NO display-device claim
#    (hud | head(s)-up | gauge display | digital gauges | trip computer | smart gauge | on-board computer | race display);
#    the word 'monitor' alone is NOT a display claim. ScanGauge 3, BYZFCM 'Smart OBD2 Scanner & GPS ... HUD' and Riloer 'OBD & GPS Scanner' HUD must survive.
#  - HO family rule r"\bkw206\b" sits before GD (KONNWEI KW206 and its 'Fit for KW206' clones are OBD HUDs).
#  - XN patterns also cover: 'screen protector', the 'power upgrade/torque booster' plug family, golf-cart OBC ('golf cart|club car' with 'obc|on-board computer'),
#    'memory saver', 'breakout box', carry/travel cases, splitters/pigtails/extension cables, mechanical bulk gauges (r"\d+\s?pcs"), Dakota Digital cluster systems.
#  - fuel_scope 'diesel-capable' needs explicit evidence: r"\bdiesel\b|\bdpf\b|\begt\b|\bdef\b|\bregen" ; 'boost'/'turbo' are NOT diesel evidence.
#    Conflicting gas+diesel evidence -> 'unspecified' and a review-queue row, never resolved by regex order.
# Device feature flags (title-derived unless verified); fixed vocabularies
FEATURE_DATA_SOURCE = ("OBD", "OBD+GPS", "GPS", "unspecified")
FEATURE_SCREEN_TYPE = ("windshield projector", "dash-top LCD", "in-dash round gauge", "tuner touchscreen", "unspecified")
FEATURE_FUEL_SCOPE = ("gas", "diesel-capable", "universal", "unspecified")
FEATURE_COLUMNS: tuple[str, ...] = ("data_source", "screen_type", "fuel_scope", "alarms", "multi_gauge", "gesture_control", "kmh_mph", "lordco_type_unit")
# Enrichment columns added by the gauge classifier / curated maps (finding 6): base rows + these = ENRICHED_ROW_COLUMNS
GAUGE_ENRICHMENT_COLUMNS: tuple[str, ...] = ("gauge_device_scope", "borderline", "feature_verified_date") + FEATURE_COLUMNS
MODELB_COLUMNS: tuple[str, ...] = ("app_gauge_capable", "app_gauge_source_url", "app_gauge_accessed")

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
BASE_ROW_COLUMNS: tuple[str, ...] = (
    "asin", "title", "brand_raw", "brand_key", "brand_display", "seller", "fulfillment", "category", "subcategory",
    "bsr", "subcategory_bsr", "list_price", "units_month", "revenue_month", "price",
    "review_count", "rating", "listing_age_months", "variation_count", "frequently_returned",
    "last_year_units", "yoy_units_pct", "sales_trend_90d_pct", "price_trend_90d_pct",
    "url", "image_url", "export_date", "source_file", "source_set", "market", "currency",
    "type", "type_source", "type_confidence",
    "gauge_class", "gauge_in_scope", "gauge_rule_id", "gauge_confidence",
    "price_tier",
    "type_rule_id", "type_conflict",      # finding 15: rule id for keyword/profile hits; conflict flag when a gauge device is typed Tablet/Handheld/Dongle
)
# Modules MUST preserve columns they do not own (never reindex a frame down to BASE_ROW_COLUMNS); ENRICHED = base + gauge enrichment + Model B.
ENRICHED_ROW_COLUMNS: tuple[str, ...] = BASE_ROW_COLUMNS + GAUGE_ENRICHMENT_COLUMNS + MODELB_COLUMNS
ROW_COLUMNS = BASE_ROW_COLUMNS   # alias: "the row contract" means the base columns; classifier output is ENRICHED_ROW_COLUMNS
# Percent fields (*_pct) are stored as FRACTIONS (Helium 10 "-32" -> -0.32); missing/N/A -> NaN, never 0 (finding 17).
# last_year_units: missing -> NaN (never 0). Helium 10 'Last Year Sales' semantics are UNVERIFIED: never divide units_month by it and never derive a YoY from it; show it as reported. Per-listing 'Sales YoY %' is never averaged or summed (only sign counts / revenue shares of listings with data).
# bsr / subcategory_bsr: missing -> NaN (never 0).
SOURCE_SETS: tuple[str, ...] = ("code_reader", "gauge", "both")
# Dedupe winner within a source (finding 13), compared lexicographically:
#   (revenue_month DESC, bsr ASC with missing LAST, export_date ASC, relative file path ASC (lexical), source row index ASC)
# Cross-source union (finding 2): normalize -> dedupe each source -> union with the CODE-READER row as master for overlapping ASINs
# (source_set="both"; the gauge row is recorded in the dedupe audit with discrepancy_flag when it would have won numerically)
# -> classify the WINNING row -> aggregate. Never prefilter a source before the union except the US code-reader export, where the
# candidate set = GAUGE_SCAN_RE hits ∪ ASINs in the gauge map (superset recall), applied AFTER that source's own dedupe.
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
GAUGE_MAP_COLUMNS = ("asin", "gauge_class", "borderline", "reason", "decided_by", "decided_month")   # scope is DERIVED from gauge_class, never stored
APP_GAUGE_BRANDS_COLUMNS = ("brand_key", "app_name", "app_gauge_capable", "source_url", "accessed", "note")   # maps/ca_app_gauge_brands.csv (Model B)
# maps/ca_app_feature_matrix.csv (Model B app comparison, filled from the memo research; every non-GAP cell needs source_url+accessed)
APP_FEATURE_MATRIX_COLUMNS = ("app", "vendor", "live_gauges", "custom_dashboards", "hud_mirror_mode", "alarms", "data_logging",
                              "enhanced_diesel_pids", "carplay_android_auto", "subscription", "canada_availability", "source_url", "accessed", "note")
APP_FEATURE_MATRIX_APPS = ("OBDLink", "BlueDriver", "FIXD", "Carista", "Torque Pro", "Car Scanner ELM OBD2", "DashCommand", "Innova RS2 (RepairSolutions2)", "CarMD")
BRAND_ALIASES_COLUMNS = ("raw_key", "canonical_key", "note")
BRAND_DISPLAY_COLUMNS = ("canonical_key", "display")
DEDUPE_AUDIT_COLUMNS = ("market", "source_set", "asin", "n_rows", "chosen_file", "chosen_row", "dropped", "values_identical",
                        "revenue_chosen", "revenue_dropped_max", "units_diff", "price_diff", "title_diff", "winning_rule", "discrepancy_flag")
# dropped = ";"-joined "file:row"; winning_rule ∈ {"single","identical","revenue","bsr","export_date","path","row","cr_master","bad_asin"};
# discrepancy_flag = "Y" when cr_master precedence beat the numerical winner (finding 14)
TYPE_DECISIONS_COLUMNS = ("month", "market", "asin", "type", "type_source", "type_rule_id", "type_confidence", "type_conflict", "run_id")
TYPE_REVIEW_COLUMNS = ("asin", "title", "brand_display", "price", "revenue_month", "url", "proposed_type", "type_source", "type_rule_id", "type_confidence", "review_reason", "reviewed_type")
# review_reason ∈ {"default_other","low_confidence","gauge_type_conflict"} (finding 26: V17 covers all three)
GAUGE_DECISIONS_COLUMNS = ("month", "market", "asin", "gauge_class", "gauge_in_scope", "gauge_rule_id", "gauge_confidence", "run_id")
BRAND_RECOVERY_COLUMNS = ("month", "asin", "title", "old_brand", "new_brand", "matched_text", "monthly_units", "monthly_revenue", "action")  # action ∈ {reassigned}
SOURCES_COLUMNS = ("url", "accessed", "publisher", "claim", "quote", "used_in_section")   # memo/sources_<m>.csv; quote ≤ 15 words

def run_file(runs_dir: Path, month: str, stem: str, scope: str, ext: str = "csv") -> Path:
    """runs/<month>/<stem>_<scope>_<month>.<ext>  (finding 4: namespaced so CA/US and code_reader/gauge runs never overwrite each other)

    scope examples: "CA_code_reader", "CA_gauge", "US_gauge", "CA" (whole-market artifacts such as validation), "ALL".
    """
    return Path(runs_dir) / month / f"{stem}_{scope}_{month}.{ext}"

RUN_STEMS = ("dedupe_audit", "type_decisions", "type_review", "gauge_decisions", "brand_recovery", "table_registry",
             "validation", "preview_summary", "manifest", "input_hashes")
# Decision files are keyed by (month, market, asin) [+source_set for dedupe]; a rerun MERGES by key, never replaces the file.
# Human maps (maps/*.csv) ALWAYS win over frozen machine decisions; a map row that changes an applicable decision rewrites that
# decision row (run_id updated, loud log line) instead of being silenced by replay (finding 5).
# Map row selection: the row with the latest decided_month <= report month wins; two rows for one ASIN with the same decided_month
# and different values are a hard error. Booleans in CSVs are parsed from {"Y","N","true","false","1","0"} explicitly (finding 29).

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
GAUGE_TAIL_SHEETS: tuple[str, ...] = ("All Products", "Dedupe & Classification Audit", "Excluded", "Source & Method", "Metadata")
# "All Products" = every union row (all classes) with gauge_class, gauge_in_scope, gauge_device_scope, borderline -> completeness check (V18 role all_rows).
# Gauge "Innova" tab = (a) one line "Innova gauge/HUD device listings in this dataset: 0" (static count, role innova) and
# (b) the app-capable Innova hardware list from the code-reader set (role modelb_top filter brand_key=="innova").
# --- Combined CA + US gauge workbook (user request 2026-10-02): frozen sheet names, table titles and roles ---
COMBINED_MARKETS: tuple[str, str] = ("CA", "US")
COMBINED_FIXED_SHEETS: tuple[str, ...] = ("Read Me", "Summary", "Top 50 CA", "Top 50 US", "Innova")      # then brand tabs, then:
COMBINED_MODEL_SHEETS: tuple[str, ...] = ("Price Ladder (Model A)", "Feature Matrix (Model A)", "App-Gauge Proxy (Model B)")  # CA analyses, unchanged
COMBINED_TAIL_SHEETS: tuple[str, ...] = ("US vs CA Same-ASIN", "All Products", "Dedupe & Classification Audit", "Excluded", "Source & Method", "Metadata")
# Summary tables, in this vertical order (role in brackets); every table is ONE table with CA and US columns side by side
COMBINED_SUMMARY_TITLES: dict[str, tuple[str, str]] = {
    "key_figures": ("Key figures", "kpi"),                                              # rows = COMBINED_KEY_FIGURE_LABELS, columns Measure | CA | US | Unit; the gauge-share rows are part of THIS table (user request 2026-10-02), bold, "0.00%"
    "brands":      ("Brand summary — CA vs US", "summary_brands"),                      # Brand | CA # Listings | CA Monthly Rev (CAD) | CA Monthly Units | CA Rev Share | CA Avg Rating | US … ; residual per market; Total
    "subtypes":    ("Sub-type mix — CA vs US", "subtype_mix"),                          # rows = device sub-types + "GPS-only HUD (adjacent)" + Total
    "tier_ca":     ("Price tier × sub-type — CA (CAD)", "tier_matrix"),                 # rows = sub-types + Total; columns per tier: "<tier> Rev (CAD)", "<tier> Units"; last pair "All tiers"
    "tier_us":     ("Price tier × sub-type — US (USD)", "tier_matrix"),
    "fuel":        ("Fuel split — CA vs US", "subtype_mix"),                            # rows = (fuel, sub-type) + per-fuel subtotal + Total; columns CA # ASINs | CA Rev | CA Units | US # ASINs | US Rev | US Units
}
# Key figures rows, in order. Rows 8-11 fold the former "Gauge share of the code-reader market" table into Key figures
# (definition (b): all core devices ÷ (full code-reader export + core devices found only in the gauge export)); the two share rows are bold.
COMBINED_KEY_FIGURE_LABELS: tuple[str, ...] = (
    "Core device revenue", "Core device units", "# core device ASINs", "# core device ASINs with sales > 0",
    "Incl. borderline revenue", "Accessories revenue", "Adjacent GPS-only HUD revenue",
    "Code-reader market revenue (full export)", "Code-reader market units (full export)",
    "Gauge share of code-reader market — revenue (b)", "Gauge share of code-reader market — units (b)",
)
COMBINED_KEY_FIGURE_SHARE_LABELS: tuple[str, ...] = COMBINED_KEY_FIGURE_LABELS[-2:]
COMBINED_SHARE_ROW_LABEL = "(b) All core gauge devices (CR ∪ gauge export)"   # legacy name of the folded table's row (no longer a table)
# Market highlight: header fills per market block (CA purple, US blue) and a faint data tint; applied to every side-by-side table
FILL_MARKET_HEADER: dict[str, str] = {"CA": "D9D2E9", "US": "DCE6F1"}
FILL_MARKET_DATA: dict[str, str] = {"CA": "F4F1F9", "US": "F3F7FB"}
# Brand tabs: a brand qualifies if it meets the brand-tab rule in EITHER market; layout = rows 1-6 title/subtitle/KPI block with CA | US columns,
# then four ranking tables in this order with Total rows: "CA — Rank by Revenue", "CA — Rank by Units", "US — Rank by Revenue", "US — Rank by Units"
COMBINED_BRAND_TABLE_TITLES: tuple[str, ...] = ("CA — Rank by Revenue", "CA — Rank by Units", "US — Rank by Revenue", "US — Rank by Units")
# All Products / Excluded / Audit sheets hold two stacked tables titled "<table> — CA" and "<table> — US" (ASIN uniqueness is per table)
for _s in COMBINED_FIXED_SHEETS + COMBINED_MODEL_SHEETS + COMBINED_TAIL_SHEETS:
    assert len(_s) <= 31, _s

GAUGE_BRAND_TAB_MIN_REVENUE = 1000.0   # brand gets a tab if device revenue >= this ...
GAUGE_BRAND_TAB_MIN_ASINS = 3          # ... or it has at least this many device ASINs
SUMMARY_TOP_BRANDS = 25
TOP_N = 50
TIER_TAB_TOP_N = 25
CATEGORY_TOP_BRANDS = 5

for _s in CR_ANALYSIS_SHEETS + GAUGE_MODEL_SHEETS + GAUGE_BENCHMARK_SHEETS + GAUGE_TAIL_SHEETS:
    assert len(_s) <= 31, _s

RESERVED_SHEET_NAMES: frozenset[str] = frozenset(s.lower() for s in
    CR_REPORT_FIXED_SHEETS + CR_REPORT_TAIL_SHEETS + CR_ANALYSIS_SHEETS + GAUGE_FIXED_SHEETS + GAUGE_MODEL_SHEETS + GAUGE_BENCHMARK_SHEETS + GAUGE_TAIL_SHEETS)
_SHEET_BAD_CHARS = re.compile(r"[\[\]:*?/\\]")

def sheet_name_for_brand(display: str, taken: set[str]) -> str:
    """Deterministic Excel sheet name for a brand tab (finding 28): strip forbidden chars, trim to 31, avoid reserved names and
    case-insensitive collisions with a numeric suffix. `taken` holds lower-cased names already used; the chosen name is added."""
    base = _SHEET_BAD_CHARS.sub("", display).strip() or "Brand"
    base = base[:31]
    cand, n = base, 2
    while cand.lower() in RESERVED_SHEET_NAMES or cand.lower() in taken:
        suffix = f" {n}"
        cand = base[: 31 - len(suffix)] + suffix
        n += 1
    taken.add(cand.lower())
    return cand
# Innova has its own fixed tab and does NOT consume one of the CR_REPORT_BRAND_TABS slots.

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

# Formula policy (finding 23): openpyxl cannot evaluate formulas, so EVERY numeric cell (incl. Total rows and Avg Rating totals) is a
# STATIC value computed in pandas. The only formula allowed is the HYPERLINK; destination and display text must carry the same ASIN
# and the row's market domain (named backreferences). Text cells are written as strings (a leading "=" in a title never becomes a formula).
ALLOWED_FORMULA_RES: tuple[re.Pattern[str], ...] = (
    re.compile(r'^=HYPERLINK\("https://amazon\.(?P<tld>ca|com)/dp/(?P<asin>[A-Z0-9]{10})","Amazon\.(?P=tld) - (?P=asin)"\)$'),
)
HYPERLINK_TEXT = "Amazon.{tld} - {asin}"
# Truncated tables (finding 20): any table that shows a top-N subset ends with a residual row "Other brands (n)" / "Other listings (n)"
# so that the Total row equals the FULL dataset and shares sum to 1 over displayed rows + residual. Innova is never duplicated when a
# "top brands + Innova" selection already contains it.
RESIDUAL_ROW_LABEL = "Other {noun} ({n})"
TOTAL_ROW_LABEL = "Total"
# Table registry (finding 24): every builder writes runs/<m>/table_registry_<market>_<m>.json — one entry per table:
#   {"workbook","sheet","role","header_row","first_data_row","last_data_row","total_row","residual_row","columns","dataset_filter",
#    "allowed_markets","charts":[{"type","anchor","has_axes"}],"brand_sheet_map":{brand_key:sheet}}
# The validator consumes the registry (V04/V09/V14/V16/V18) instead of guessing table boundaries; duplicate-ASIN checks run per table.
TABLE_ROLES: tuple[str, ...] = ("summary_brands", "subtype_mix", "tier_matrix", "kpi", "top_by_revenue", "top_by_units", "innova",
                               "brand_tab_revenue", "brand_tab_units", "all_rows", "excluded", "dedupe_audit", "tier_pivot", "category",
                               "tier_tab", "trend_proxy", "type_coverage", "price_ladder", "feature_matrix", "modelb_tiers", "modelb_brands",
                               "modelb_top", "modelb_app_matrix", "benchmark_brands", "benchmark_subtypes", "benchmark_tiers", "same_asin",
                               "source_method", "metadata", "read_me")
# Allowed markets per sheet in the CA gauge workbook (finding 21): USD amounts and amazon.com URLs may appear ONLY on these sheets,
# in columns whose header says "(USD)" / "US"; research citation URLs (non-Amazon) appear only on Source & Method / App-Gauge Proxy.
CA_SHEETS_ALLOWING_US: tuple[str, ...] = ("US Benchmark", "US vs CA Same-ASIN", "Source & Method", "Metadata")
# Cross-market comparisons (finding 19): never divide CAD by USD. Compare units, listing counts and ranks; show revenue in native
# currency side by side with the currency in the header. No FX conversion anywhere unless a rate, source and date are frozen in Metadata.

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
    "V06": "every Amazon product URL/HYPERLINK matches its row's market domain and ASIN; cross-market URLs only on CA_SHEETS_ALLOWING_US",
    "V07": "currency labels: money formats/headers carry the table's market currency; foreign-currency columns only on CA_SHEETS_ALLOWING_US with '(USD)' headers",
    "V08": "Innova: CR Report Innova tab rows == dataset Innova rows (23 for CA 202609); gauge Innova tab device count == 0 and hardware list == CR Innova rows",
    "V09": "Total-row static values equal the column sums of the full dataset (per table registry); residual rows present where truncated",
    "V10": "no ~$ lock files in out dirs",
    "V11": "zero error tokens (#REF!, #DIV/0!, #NAME?, #VALUE!) in any cell",
    "V12": "gauge Summary device totals == device_scope rows (core and incl. borderline separately); workbook-scope rows == All Products rows; CA: Bully Dog TD rows present",
    "V13": "Excluded tab rows == excluded + ambiguous classified rows, each with a rule id",
    "V14": "no duplicate ASIN within any single registered table (rankings may repeat ASINs across tables)",
    "V15": "Metadata tab has every METADATA_REQUIRED_KEYS entry",
    "V16": "chart count per sheet as registered; every chart axis delete=0",
    "V17": "type review: every default_other, low-confidence (< TYPE_REVIEW_CONFIDENCE) and gauge_type_conflict row is listed in type_review_<scope>_<m>.csv",
    "V18": "per-ASIN reconciliation: every all_rows table row matches the dataset (units, revenue, brand, type/class, tier); exactly one leaf tier per eligible row",
    "V19": "manifest sha256 matches outputs AND input CSVs, maps and decision files (non-recursive list, excludes itself)",
    "V20": "every memo number tagged [WB: file!sheet!cell] equals the cell (exact for counts, ±1 for rounded money, ±0.001 for shares); every [SRC:] url is in sources CSV",
    "V21": "inputs sane: valid ASINs, finite non-negative units/revenue/price, known taxonomy values; rows with revenue > 0 and units == 0 are reported",
    "V22": "classifier golden: the pinned boundary titles in tests/fixtures classify to their expected class (independent of the live rule table)",
    "V23": "benchmark joins: US vs CA Same-ASIN rows == ASIN intersection of the two union frames; Model B universe == CR Type==Dongle rows",
}
VALIDATION_FINAL_RE = re.compile(r"^VALIDATION: (PASS|FAIL) \((\d+)/(\d+)(?:; failed: [A-Z0-9, ]+)?\)$")
# Memo number tags: the NUMBER immediately preceding the tag (same line, last numeric token incl. thousands separators) is compared to the cell.
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
    audits      : {"dedupe_audit": DataFrame(DEDUPE_AUDIT_COLUMNS) covering BOTH sources, "brand_recovery": ..., "type_decisions": ..., "type_review": ...}
                  union_gauge_frames() APPENDS its cross-source rows to audits["dedupe_audit"] (winning_rule="cr_master").
    export_dates: raises ValueError when no file name carries a date (never a fake date)
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
#   ca_load.load_month(...) MUST raise ValueError when market == "US" and assign_types is True (US Type assignment is out of scope; type
#   columns stay empty for US). Token profiles (CA only) are built deterministically from the US map + already-typed CA rows; score =
#   |profile tokens ∩ title tokens| / |title tokens| (US semantics) over tokens of length >= 3 with re.ASCII; ties -> lexically smallest type; confidence = score.
#   ca_load.load_month(market: str, month: str, *, cr_raw_dir: Path | None = None, gauge_raw_dir: Path | None = None,
#                      us_type_map: Path | None = US_TYPE_MAP_DEFAULT, type_map: Path = MAPS_DIR/"ca_type_overrides.csv",
#                      gauge_map: Path = MAPS_DIR/"ca_gauge_map.csv", runs_dir: Path = RUNS_DIR, assign_types: bool = True,
#                      rederive: bool = False, freeze: bool = True) -> CaDataset
#   ca_load.union_gauge_frames(code_reader: DataFrame, gauge_set: DataFrame, audit: list[dict]) -> DataFrame   # CR row is master; source_set="both"; appends audit rows
#   ca_brands.canonical_brand_key(raw: str, aliases: dict[str, str]) -> str
#   ca_brands.display_brand(key: str, display: dict[str, str]) -> str
#   ca_brands.recover_generic_brands(df, vocabulary: set[str], frozen: DataFrame | None) -> tuple[DataFrame, DataFrame]  # (df, audit rows)
#   ca_types.assign_types(df, *, us_map: dict[str, str], overrides: dict[str, str], prior: dict[str, tuple[str, str, float]]) -> DataFrame   # prior value = (type, type_source, confidence)
#   ca_tiers.assign_cr_tiers(df) -> DataFrame        # adds price_tier using CR_TIERS (by type)
#   ca_tiers.tier_label(price: float, tiers: tuple[tuple[str, float, float], ...]) -> str
#   ca_gauge_classification.GAUGE_SCAN_RE: re.Pattern   # candidate pre-filter (used on the US code-reader export)
#   ca_gauge_classification.classify_gauges(df, gauge_map: DataFrame, prior: DataFrame | None = None) -> DataFrame   # adds gauge_class/in_scope/rule_id/confidence + GAUGE_ENRICHMENT_COLUMNS; preserves all input columns
#   ca_gauge_classification.candidate_mask(df, gauge_map: DataFrame) -> Series[bool]   # GAUGE_SCAN_RE hits ∪ mapped ASINs (superset recall)
#   build_ca_code_reader_report.build_code_reader_workbooks(ds: CaDataset, out_dir: Path, *, overwrite: bool, dated_copy: bool) -> list[Path]
#   build_gauge_report.build_gauge_workbook(ds: CaDataset, out_dir: Path, *, benchmark: CaDataset | None, overwrite: bool, dated_copy: bool) -> Path
#   build_*: each builder also writes run_file(runs_dir, month, "table_registry", "<market>", "json") and the manifest (outputs + inputs + maps + decisions hashes)
#   validate_outputs.main(argv) -> int   # prints one line per check "PASS|FAIL Vnn <name>: <evidence>" then VALIDATION_FINAL_RE line; exit 1 on any FAIL
