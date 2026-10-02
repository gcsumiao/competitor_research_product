"""OBD-gauge classifier for the CA/US gauge workbooks.

Pure pandas + re; no file IO at import. Public interface (frozen in ca_common):

    GAUGE_SCAN_RE                                   superset-recall candidate pre-filter over title + " " + brand_raw
    candidate_mask(df, gauge_map) -> Series[bool]   scan hits ∪ ASINs present in the gauge map
    classify_gauges(df, gauge_map, prior=None) -> DataFrame
    freeze_gauge_decisions(df, runs_dir, month, market, *, rederive=False) -> DataFrame

Precedence inside classify_gauges:
    1. explicit ASIN decision in gauge_map (latest decided_month <= report month; same-month conflict -> ValueError)  rule "MAP", 1.0
    2. prior frozen decision (GAUGE_DECISIONS_COLUMNS, one month/market): class replayed verbatim                    rule "PRIOR", 1.0
    3. ordered rule table below (first match wins)                                                                   rule "<CODE>-<name>", 0.9
    4. ambiguous                                                                                                     rule "AMB", 0.0

Rules read the TITLE only (a bare brand never classifies); the brand only widens the candidate scan.
"""
from __future__ import annotations

import logging
import re
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Callable

import pandas as pd

from .ca_common import (
    FEATURE_COLUMNS,
    FEATURE_DATA_SOURCE,
    FEATURE_FUEL_SCOPE,
    FEATURE_SCREEN_TYPE,
    GAUGE_CLASS_BY_CODE,
    GAUGE_CLASS_NAMES,
    GAUGE_DECISIONS_COLUMNS,
    GAUGE_DEVICE_CLASSES,
    GAUGE_LORDCO_TYPE_CLASSES,
    GAUGE_MAP_COLUMNS,
    GAUGE_WORKBOOK_CLASSES,
    MONTH_RE,
    PACKAGE_ROOT,
    run_file,
)

log = logging.getLogger("ca_market_reports.gauge")

# --------------------------------------------------------------------------------------
# Candidate pre-filter (superset recall). Base = US scan_gauge_candidates.py GAUGE_RE, plus the CA additions.
# --------------------------------------------------------------------------------------
_US_BASE_SCAN = (
    r"gauge|dash(?:board)?\b|\bhud\b|heads?[- ]?up|trip computer|combination meter|"
    r"speedometer|tachometer|driving computer|on[- ]?board computer|car computer|"
    r"instrument|cluster|datamonster|dashcontrol|scangauge|scan gauge|ultragauge|"
    r"ultra gauge|idash|i-dash|insight ct\w*|\bcts[23]\b|obd\W{0,4}display|"
    r"display for car|digital meter"
)
_CA_SCAN_ADDITIONS = (
    r"obd\+?gps|dual (?:system|mode)|windshield projector|smart gauge|gague|race display|d-meter|fd evo|"
    r"on[- ]?board computer|x-series|52mm|replacement block|shift light|h0000800|hd\s+multimedia|hdmi|eas egt|"
    r"data module|can bridge|dash(?:board)? mount|"
    r"lap timer|dash logger"          # extra recall: track dash loggers (AiM Solo 2 DL) land in review instead of XN-noscan
)
_SCAN_ANCHORS = (
    r"wiiyii|lufi|keenso|byzfcm|camecho|miollybo|azijyv|maimeimi|\bedge\b|scangauge|\bsg2\b|\baem\b|auto ?meter|"
    r"banks|bully ?dog|\b4041\d\b|\b4042\d\b|\b4043\d\b|40400-105|ultra ?gauge|konnwei|kw206|autool|insight|"
    r"evolution ct|cts[23]|idash|datamonster|shadow|dakota digital"
)
GAUGE_SCAN_RE: re.Pattern[str] = re.compile(f"{_US_BASE_SCAN}|{_CA_SCAN_ADDITIONS}|{_SCAN_ANCHORS}", re.I)

# --------------------------------------------------------------------------------------
# Shared fragments
# --------------------------------------------------------------------------------------
HUD_RE = re.compile(r"\bhud\b|\bheads?[- ]?up\b|headup|projector|windshield", re.I)
_OBD_RE = re.compile(r"obd", re.I)
_GPS_RE = re.compile(r"\bgps\b", re.I)
_DUAL_RE = re.compile(r"dual[- ](?:system|mode)", re.I)
SCANNER_TOKEN_RE = re.compile(r"scanner|scan tool|code reader|diagnostic", re.I)
# A display-device claim rescues a title from the scanner exclusion. 'monitor' alone is NOT a claim.
DISPLAY_CLAIM_RE = re.compile(
    r"\bhud\b|\bheads?[- ]?up\b|headup|gauge display|digital gauges|trip computer|smart gauge|on[- ]?board computer|"
    r"race display|gauge tuner|"
    # family/device phrases shared with the GD rule (a superset of the frozen claim list keeps recall high)
    r"digital gauges?\b|d-meter|fd evo|scangauge|\bobd(?:2|ii)? gauge\b|multi-?function (?:digital )?gauge",
    re.I,
)


def _rx(pattern: str) -> Callable[[str], bool]:
    rx = re.compile(pattern, re.I)
    return lambda t: rx.search(t) is not None


def _and(*preds: Callable[[str], bool]) -> Callable[[str], bool]:
    return lambda t: all(p(t) for p in preds)


def _not(pred: Callable[[str], bool]) -> Callable[[str], bool]:
    return lambda t: not pred(t)


_hud = _rx(HUD_RE.pattern)
_obd = _rx(_OBD_RE.pattern)
_gps = _rx(_GPS_RE.pattern)
_gps_or_dual = _rx(f"{_GPS_RE.pattern}|{_DUAL_RE.pattern}")


def _is_scanner_without_display(t: str) -> bool:
    return SCANNER_TOKEN_RE.search(t) is not None and DISPLAY_CLAIM_RE.search(t) is None


_GD_TOKENS = (
    r"gauge display|gague|trip computer|on[- ]?board computer|race display|x-series|52mm|scangauge|\bsg2\b(?![-\d])|smart gauge|"
    r"dashcontrol|\bobd(?:2|ii)? gauge\b|multi-?function (?:digital )?gauge|"
    r"d-meter|fd evo|digital gauges?\b|combination (?:meter|instrument)|automotive computer"
)

# --------------------------------------------------------------------------------------
# Ordered rule table — first match wins. (rule_id, class code, predicate over the lower-cased title)
# Order notes:
#   * the AC accessory rules sit BEFORE the generic XN cable/adapter rule (Edge HDMI cables, HUD cables survive);
#   * XN-bulk sits after AC so a "2 pack" accessory is still an accessory;
#   * the XN scanner rule needs a scanner token AND no display-device claim.
# --------------------------------------------------------------------------------------
RULES: tuple[tuple[str, str, Callable[[str], bool]], ...] = (
    # ---- XN: specific non-gauge families ----
    ("XN-case", "XN", _rx(r"\b(?:carry(?:ing)?|travel|hard|storage|protective|eva)\s+(?:case|bag|pouch)\b|case compatible|"
                          r"\bcase only\b|\bbag only\b|\bcase for\b")),
    ("XN-breakout", "XN", _rx(r"break[- ]?out box|protocol detector")),
    ("XN-memsaver", "XN", _rx(r"memory saver|battery (?:swap|replacement) (?:tool|power)|emergency power supply")),
    ("XN-trailer", "XN", _rx(r"trailer (?:plug|connector|wiring|light)")),
    ("XN-portlock", "XN", _rx(r"port lock|\bobd2? lock\b|obd(?:ii|2)? (?:port )?guard")),
    ("XN-protector", "XN", _rx(r"screen protector|tempered glass|protective film")),
    ("XN-power", "XN", _rx(r"power upgrade|torque booster|plug[- ]and[- ]play.*power|performance chip|fuel sav|chip tuning|tuning box|"
                          r"power chip|eco obd2? (?:drive )?chip")),
    ("XN-throttle", "XN", _and(_rx(r"pedalmonster|pedal commander|throttle (?:controller|response|booster)"), _not(_rx(r"\bidash\b")))),
    ("XN-golfcart", "XN", _rx(r"(?:golf cart|club car).*(?:\bobc\b|on[- ]?board computer)|"
                              r"(?:\bobc\b|on[- ]?board computer).*(?:golf cart|club car)")),
    ("XN-dashcam", "XN", _rx(r"dash ?cam|dash camera|hardwire kit|hardwiring|thinkware|blackvue|radar detector")),
    ("XN-key", "XN", _rx(r"key programm|key program\b|immobili[sz]er|\bkey ?fob|fob programmer|transponder|key cutting|key matching|"
                        r"keys lost|\bvvdi\b")),
    ("XN-cluster", "XN", _rx(r"\bimmo\b|odometer (?:correction|adjust|calibrat|programm)|mileage (?:correction|blocker|stopper|filter)|"
                             r"\bkm filter\b|tacho ?pro|cluster (?:calibrat|repair|programm)|eeprom|bench (?:tool|harness|flash)|"
                             r"flash harness|\bim-?mo\b|\beis\b|\belv\b|ktag|kess v|galletto|fgtech|ecu (?:cover|opener|programming interface)")),
    ("XN-clusterrepl", "XN", _rx(r"dakota digital|\bvhx-|cluster replacement|replacement (?:digital )?(?:instrument )?cluster")),
    ("XN-srs", "XN", _rx(r"airbag|\bsrs (?:simulator|emulator|resistor)|seat occupancy|occupancy (?:sensor|mat)")),
    ("XN-calibration", "XN", _rx(r"\bprocal\b|speedometer calibrat|tire size calibrat")),
    ("XN-tracker", "XN", _rx(r"\b(?:gps|obd2?|vehicle|car) tracker\b|tracking device")),
    ("XN-trim", "XN", _rx(r"\bbezel\b|trim panel|dash(?:board)? (?:cover|mat)\b")),
    ("XN-nonobd", "XN", _rx(r"hour meter|tread depth|voltmeter|panel meter|torque (?:meter|wrench)")),
    # ---- AC: gauge accessories (before the generic XN cable/adapter rule) ----
    ("AC-block", "AC", _rx(r"replacement block|40400-105")),
    ("AC-cable", "AC", _rx(r"\bh0000800(?:0)?\b|(?:hdmi|hd\s+multimedia\s+interface|high definition multimedia).*\b(?:cs2|cts2|cts3)\b|"
                           r"\b(?:cs2|cts2|cts3)\b.*(?:hdmi|hd\s+multimedia|high definition multimedia)")),
    ("AC-shiftlight", "AC", _rx(r"shift light")),
    ("AC-eas", "AC", _rx(r"eas egt|expandable")),
    ("AC-module", "AC", _rx(r"data module|can bridge")),
    ("AC-mount", "AC", _rx(r"dash(?:board)? mount.*scangauge|scangauge.*\bmount")),
    ("AC-hudcable", "AC", _rx(r"cable for (?:car )?hud|sensor cable")),
    # ---- XN: generic wiring / bulk mechanical ----
    ("XN-cable", "XN", _rx(r"splitter|pigtail|extension cable|adapter cable|wire harness|\by[- ](?:adapter|cable|splitter)\b|"
                           r"male to female|underdash bracket|under dash mounting bracket|relocation (?:cable|kit)|female to open|fixed harness|"
                           r"(?:female|male) (?:wire )?(?:socket|connector)|plug shell|obd2? (?:female|male) to usb|\bto \d+\s?-?pin\b|\d+\s?-?pin to\b")),
    ("XN-bulk", "XN", _and(_rx(r"\d+\s?pcs|\d+\s?-?pack\b"), _not(_hud))),
    ("XN-mechanical", "XN", _and(_rx(r"\bmechanical\b"), _not(_hud))),
    # ---- XD: app dongle families, pinned before the generic scanner exclusion (BD3x0 family; AUTOPHIX/Viecar/Panlong only
    #      when the title claims a wireless/app link, so their wired handhelds stay XN-scanner) ----
    ("XD-family", "XD", _rx(r"\bbd3[013]0\b|(?:autophix|viecar|panlong).*(?:bluetooth|wireless|wi-?fi|\bapp\b|hud mode)|"
                            r"(?:bluetooth|wireless|wi-?fi|\bapp\b).*(?:autophix|viecar|panlong)")),
    # ---- XN: scanner without any display-device claim ----
    ("XN-scanner", "XN", _is_scanner_without_display),
    # ---- XD: generic app dongle (no physical screen) ----
    ("XD-dongle", "XD", _and(_rx(r"scanner|dongle|adapter|module"), _rx(r"bluetooth|\bapp\b|wi-?fi|wireless"),
                             _not(_rx(r"projector|windshield|screen|lcd|display\b")))),
    # ---- TD / TM: tuner and truck-monitor families (a bare brand never classifies) ----
    ("TD-tuner", "TD", _rx(r"evolution ct|\bcts[23] (?:gas |diesel )?evolution|triple dog|platinum gt|gt platinum|\bgt gas\b|\bgt diesel\b|hemi plus|"
                           r"\b4041\d\b|\b4042\d\b|\b4043\d\b|juice.*attitude|flashpaq|dashpaq")),
    ("TM-monitor", "TM", _rx(r"insight cts3|insight cs2|insight\+|\bidash\b|i-dash|datamonster|watchdog|data pro")),
    # ---- HUDs ----
    ("HG-1", "HG", _and(_hud, _obd, _gps_or_dual)),
    ("HO-kw206", "HO", _rx(r"\bkw206\b")),
    ("HO-1", "HO", _and(_hud, _obd, _not(_gps))),
    ("GH-1", "GH", _and(_hud, _gps, _not(_obd))),
    # ---- dash-top / in-dash gauge displays ----
    ("GD-1", "GD", _and(_rx(_GD_TOKENS), _not(_hud), _not(_is_scanner_without_display))),
)
# Bully Dog rows carry the TD-tuner rule; the rule id is refined for readability (TD-bullydog / TD-edge).
_TD_FAMILY_IDS = ((re.compile(r"bully ?dog|triple dog|\b404[123]\d\b|hemi plus", re.I), "TD-bullydog"),
                  (re.compile(r"evolution ct|juice.*attitude|\bedge\b", re.I), "TD-edge"))

RULE_CONFIDENCE = 0.9
MAP_CONFIDENCE = 1.0
PRIOR_CONFIDENCE = 1.0
AMB_CONFIDENCE = 0.0


def classify_title(title: str, brand: str = "") -> tuple[str, str]:
    """(gauge_class, rule_id) from the ordered rule table (title only), then:
    XN-noscan when title + brand is not a GAUGE_SCAN_RE candidate (superset-recall contract: a non-candidate cannot be a gauge
    device or accessory), else ("ambiguous", "AMB")."""
    t = (title or "").lower()
    for rule_id, code, pred in RULES:
        if pred(t):
            if rule_id == "TD-tuner":
                for rx, rid in _TD_FAMILY_IDS:
                    if rx.search(t):
                        rule_id = rid
                        break
            return GAUGE_CLASS_BY_CODE[code], rule_id
    if GAUGE_SCAN_RE.search(f"{title or ''} {brand or ''}") is None:
        return "excluded_non_gauge", "XN-noscan"
    return "ambiguous", "AMB"


# --------------------------------------------------------------------------------------
# Feature extraction (device-scope rows only; title-derived)
# --------------------------------------------------------------------------------------
_DIESEL_RE = re.compile(r"\bdiesel\b|\bdpf\b|\begt\b|\bdef\b|\bregen", re.I)
_GAS_RE = re.compile(r"\bgas\b|gasoline|petrol|\bhemi\b", re.I)          # HEMI = gasoline V8 (Bully Dog 40430 Hemi Plus)
_PROJECTOR_RE = re.compile(r"projector|windshield|reflect(?:ive|ion|or)", re.I)
_ROUND_RE = re.compile(r"52mm|x-series|in-dash|\bround\b", re.I)
_LCD_RE = re.compile(r"\blcd\b|\btft\b|screen|\bkw206\b|digital meter", re.I)
_ALARM_RE = re.compile(r"alarm|warning|reminder|fatigue", re.I)
_MULTI_RE = re.compile(r"multi|all[- ]in[- ]one|\d+\s?(?:gauges|parameters|functions)", re.I)
_GESTURE_RE = re.compile(r"gesture", re.I)
_KMH_RE = re.compile(r"km/?h|mph", re.I)


def _features(asin: str, title: str, gauge_class: str) -> dict:
    t = title or ""
    if gauge_class not in GAUGE_DEVICE_CLASSES:
        return {"data_source": "", "screen_type": "", "fuel_scope": "", "alarms": False, "multi_gauge": False,
                "gesture_control": False, "kmh_mph": False, "lordco_type_unit": False}
    has_obd = _OBD_RE.search(t) is not None
    has_gps = _GPS_RE.search(t) is not None or _DUAL_RE.search(t) is not None
    if gauge_class == "obd_gps_hud" or (has_obd and has_gps):
        data_source = "OBD+GPS"
    elif has_gps:
        data_source = "GPS"
    else:
        data_source = "OBD"            # TD/TM/GD/HO with an obd token or no token
    if _PROJECTOR_RE.search(t):
        screen = "windshield projector"
    elif gauge_class == "tuner_with_gauge_display":
        screen = "tuner touchscreen"
    elif _ROUND_RE.search(t):
        screen = "in-dash round gauge"
    elif gauge_class in ("obd_gps_hud", "obd_hud") and HUD_RE.search(t) and not _LCD_RE.search(t):
        screen = "windshield projector"   # a HUD claim without an LCD/screen claim reads as a projection HUD
    else:
        screen = "dash-top LCD"
    diesel, gas = _DIESEL_RE.search(t) is not None, _GAS_RE.search(t) is not None
    if diesel and gas:
        fuel = "unspecified"
        log.warning("gauge_fuel_conflict asin=%s gas+diesel evidence -> unspecified (review): %s", asin, t)
    elif diesel:
        fuel = "diesel-capable"
    elif gas:
        fuel = "gas"
    else:
        fuel = "unspecified"
    out = {"data_source": data_source, "screen_type": screen, "fuel_scope": fuel,
           "alarms": _ALARM_RE.search(t) is not None, "multi_gauge": _MULTI_RE.search(t) is not None,
           "gesture_control": _GESTURE_RE.search(t) is not None, "kmh_mph": _KMH_RE.search(t) is not None,
           "lordco_type_unit": gauge_class in GAUGE_LORDCO_TYPE_CLASSES}
    assert out["data_source"] in FEATURE_DATA_SOURCE and out["screen_type"] in FEATURE_SCREEN_TYPE
    assert out["fuel_scope"] in FEATURE_FUEL_SCOPE
    return out


# --------------------------------------------------------------------------------------
# CSV boolean / map parsing
# --------------------------------------------------------------------------------------
_TRUE = {"y", "true", "1"}
_FALSE = {"n", "false", "0"}


def parse_bool(value, *, blank_is_false: bool = False, what: str = "boolean") -> bool:
    """Explicit CSV boolean parsing: Y/N/true/false/1/0 (case-insensitive). Anything else raises ValueError."""
    if isinstance(value, bool):
        return value
    if value is None or (isinstance(value, float) and pd.isna(value)):
        s = ""
    else:
        s = str(value).strip().lower()
    if s in _TRUE:
        return True
    if s in _FALSE:
        return False
    if s == "" and blank_is_false:
        return False
    raise ValueError(f"cannot parse {what} {value!r}; expected one of Y/N/true/false/1/0")


def _str(v) -> str:
    if v is None or (isinstance(v, float) and pd.isna(v)):
        return ""
    return str(v).strip()


def select_map_decisions(gauge_map: pd.DataFrame, month: str | None) -> dict[str, tuple[str, bool]]:
    """{asin: (gauge_class, borderline)} using the row with the latest decided_month <= month (all rows when month is None).
    Two rows for one ASIN at the winning decided_month with different values -> ValueError."""
    if not isinstance(gauge_map, pd.DataFrame):
        raise TypeError("gauge_map must be a pandas DataFrame with GAUGE_MAP_COLUMNS")
    missing = [c for c in GAUGE_MAP_COLUMNS if c not in gauge_map.columns]
    if missing:
        raise ValueError(f"gauge_map is missing columns {missing}; expected {GAUGE_MAP_COLUMNS}")
    if month is not None and not MONTH_RE.match(str(month)):
        raise ValueError(f"invalid report month {month!r}")
    best: dict[str, tuple[str, list[tuple[str, bool]]]] = {}
    for i, r in gauge_map.iterrows():
        asin = _str(r["asin"]).upper()
        cls = _str(r["gauge_class"])
        dm = _str(r["decided_month"])
        if not asin:
            raise ValueError(f"gauge_map row {i}: empty asin")
        if cls not in GAUGE_CLASS_NAMES:
            raise ValueError(f"gauge_map row {i} ({asin}): unknown gauge_class {cls!r}")
        if not MONTH_RE.match(dm):
            raise ValueError(f"gauge_map row {i} ({asin}): invalid decided_month {dm!r}")
        bl = parse_bool(r["borderline"], blank_is_false=True, what=f"gauge_map borderline ({asin})")
        if month is not None and dm > month:
            continue
        cur = best.get(asin)
        if cur is None or dm > cur[0]:
            best[asin] = (dm, [(cls, bl)])
        elif dm == cur[0]:
            cur[1].append((cls, bl))
    out: dict[str, tuple[str, bool]] = {}
    for asin, (dm, vals) in best.items():
        if len(set(vals)) > 1:
            raise ValueError(f"gauge_map conflict for {asin}: decided_month {dm} has different decisions {sorted(set(vals))}")
        out[asin] = vals[0]
    return out


def _prior_decisions(prior: pd.DataFrame | None, df: pd.DataFrame) -> tuple[dict[str, str], str | None]:
    if prior is None:
        return {}, None
    missing = [c for c in GAUGE_DECISIONS_COLUMNS if c not in prior.columns]
    if missing:
        raise ValueError(f"prior decisions missing columns {missing}; expected {GAUGE_DECISIONS_COLUMNS}")
    if prior.empty:
        return {}, None
    months = {_str(m) for m in prior["month"]}
    markets = {_str(m) for m in prior["market"]}
    if len(months) != 1 or len(markets) != 1:
        raise ValueError(f"prior decisions must cover exactly one month/market, got months={sorted(months)} markets={sorted(markets)}")
    if "market" in df.columns:
        df_markets = {_str(m) for m in df["market"]} - {""}
        if df_markets and df_markets != markets:
            raise ValueError(f"prior decisions are for market {sorted(markets)} but the frame is {sorted(df_markets)}")
    out: dict[str, str] = {}
    for _, r in prior.iterrows():
        asin, cls = _str(r["asin"]).upper(), _str(r["gauge_class"])
        if cls not in GAUGE_CLASS_NAMES:
            raise ValueError(f"prior decision for {asin}: unknown gauge_class {cls!r}")
        frozen_scope = parse_bool(r["gauge_in_scope"], what=f"prior gauge_in_scope ({asin})")
        if frozen_scope != (cls in GAUGE_WORKBOOK_CLASSES):
            raise ValueError(f"prior decision for {asin}: gauge_in_scope={frozen_scope} contradicts class {cls}")
        if asin in out and out[asin] != cls:
            raise ValueError(f"prior decisions contain two different classes for {asin}")
        out[asin] = cls
    return out, months.pop()


# --------------------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------------------
def _require(df: pd.DataFrame, cols: tuple[str, ...]) -> None:
    missing = [c for c in cols if c not in df.columns]
    if missing:
        raise ValueError(f"frame is missing required columns {missing}")


def candidate_mask(df: pd.DataFrame, gauge_map: pd.DataFrame) -> pd.Series:
    """GAUGE_SCAN_RE hits over title + " " + brand_raw, union every ASIN present in the gauge map (superset recall)."""
    _require(df, ("asin", "title", "brand_raw"))
    if not isinstance(gauge_map, pd.DataFrame) or "asin" not in gauge_map.columns:
        raise ValueError("gauge_map must be a DataFrame with an 'asin' column")
    hay = df["title"].fillna("").astype(str) + " " + df["brand_raw"].fillna("").astype(str)
    hits = hay.str.contains(GAUGE_SCAN_RE, regex=True)
    mapped = {_str(a).upper() for a in gauge_map["asin"]} - {""}
    in_map = df["asin"].fillna("").astype(str).str.strip().str.upper().isin(mapped)
    return (hits | in_map).astype(bool)


def classify_gauges(df: pd.DataFrame, gauge_map: pd.DataFrame, prior: pd.DataFrame | None = None, *,
                    month: str | None = None) -> pd.DataFrame:
    """Return a copy of df (all input columns preserved) with gauge_class, gauge_in_scope, gauge_device_scope, gauge_rule_id,
    gauge_confidence, borderline, feature_verified_date and FEATURE_COLUMNS set.

    month: report month used to select map rows (decided_month <= month). When omitted, the prior's month is used if a prior
    is given; otherwise every map row is eligible (the latest decided_month wins).
    """
    _require(df, ("asin", "title"))
    prior_map, prior_month = _prior_decisions(prior, df)
    if month is None:
        month = prior_month
    elif prior_month is not None and prior_month != month:
        raise ValueError(f"prior decisions are for month {prior_month}, classify month is {month}")
    decisions = select_map_decisions(gauge_map, month)

    out = df.copy()
    rows = []
    brands = out["brand_raw"] if "brand_raw" in out.columns else pd.Series("", index=out.index)
    for asin_raw, title_raw, brand_raw in zip(out["asin"], out["title"], brands):
        asin = _str(asin_raw).upper()
        title = _str(title_raw)
        borderline = False
        if asin in decisions:
            cls, borderline = decisions[asin]
            rule_id, conf = "MAP", MAP_CONFIDENCE
        elif asin in prior_map:
            cls, rule_id, conf = prior_map[asin], "PRIOR", PRIOR_CONFIDENCE
        else:
            cls, rule_id = classify_title(title, _str(brand_raw))
            conf = AMB_CONFIDENCE if cls == "ambiguous" else RULE_CONFIDENCE
        row = {"gauge_class": cls, "gauge_in_scope": cls in GAUGE_WORKBOOK_CLASSES,
               "gauge_device_scope": cls in GAUGE_DEVICE_CLASSES, "gauge_rule_id": rule_id,
               "gauge_confidence": conf, "borderline": bool(borderline), "feature_verified_date": ""}
        row.update(_features(asin, title, cls))
        rows.append(row)
    cols = ("gauge_class", "gauge_in_scope", "gauge_device_scope", "gauge_rule_id", "gauge_confidence", "borderline",
            "feature_verified_date") + FEATURE_COLUMNS
    enrich = pd.DataFrame(rows, index=out.index, columns=list(cols))
    for c in cols:
        out[c] = enrich[c]
    for c in ("gauge_in_scope", "gauge_device_scope", "borderline", "alarms", "multi_gauge", "gesture_control", "kmh_mph",
              "lordco_type_unit"):
        out[c] = out[c].astype(bool)
    out["gauge_confidence"] = out["gauge_confidence"].astype(float)
    return out


def _git_short_sha() -> str:
    try:
        res = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=PACKAGE_ROOT, capture_output=True, text=True, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:  # explicit failure: a run id without provenance is not allowed
        raise RuntimeError(f"cannot determine git sha for run_id: {exc}") from exc
    sha = res.stdout.strip()
    if not sha:
        raise RuntimeError("git rev-parse returned an empty sha")
    return sha


def make_run_id() -> str:
    return f"{datetime.now().strftime('%Y%m%dT%H%M%S')}-{_git_short_sha()}"


def freeze_gauge_decisions(df: pd.DataFrame, runs_dir: Path, month: str, market: str, *, rederive: bool = False) -> pd.DataFrame:
    """Merge df's gauge decisions by (month, market, asin) into runs/<month>/gauge_decisions_<market>_gauge_<month>.csv.

    Replay semantics: an existing frozen row is kept (never silently overwritten) unless
      * rederive=True (every df ASIN is rewritten; df must come from a fresh classification, not a PRIOR replay), or
      * df's decision comes from the human map (rule "MAP") and differs from the frozen row -> rewritten, loud log line.
    New ASINs are appended; their count is logged as unfrozen_candidates=<n>. Returns the merged decision table.
    """
    if not MONTH_RE.match(str(month)):
        raise ValueError(f"invalid month {month!r}")
    _require(df, ("asin", "gauge_class", "gauge_in_scope", "gauge_rule_id", "gauge_confidence"))
    if rederive and (df["gauge_rule_id"] == "PRIOR").any():
        raise ValueError("rederive=True needs a fresh classification (prior=None); the frame contains PRIOR replays")
    path = run_file(Path(runs_dir), month, "gauge_decisions", f"{market}_gauge")
    run_id = make_run_id()

    if path.exists():
        existing = pd.read_csv(path, dtype=str, keep_default_na=False)
        missing = [c for c in GAUGE_DECISIONS_COLUMNS if c not in existing.columns]
        if missing:
            raise ValueError(f"{path}: missing columns {missing}")
        bad = existing[(existing["month"] != month) | (existing["market"] != market)]
        if not bad.empty:
            raise ValueError(f"{path}: contains rows for another month/market ({len(bad)} rows)")
        if existing["asin"].duplicated().any():
            raise ValueError(f"{path}: duplicate asin rows {sorted(existing.loc[existing['asin'].duplicated(), 'asin'])[:5]}")
    else:
        existing = pd.DataFrame(columns=list(GAUGE_DECISIONS_COLUMNS))
    merged: dict[str, dict] = {r["asin"]: {c: r[c] for c in GAUGE_DECISIONS_COLUMNS} for _, r in existing.iterrows()}

    new_rows: dict[str, dict] = {}
    for _, r in df.iterrows():
        asin = _str(r["asin"]).upper()
        if asin in new_rows:
            raise ValueError(f"freeze: duplicate asin {asin} in frame")
        new_rows[asin] = {"month": month, "market": market, "asin": asin, "gauge_class": r["gauge_class"],
                          "gauge_in_scope": "True" if bool(r["gauge_in_scope"]) else "False",
                          "gauge_rule_id": r["gauge_rule_id"], "gauge_confidence": f"{float(r['gauge_confidence']):.2f}",
                          "run_id": run_id}
    unfrozen = 0
    for asin, row in new_rows.items():
        old = merged.get(asin)
        if old is None:
            unfrozen += 1
            merged[asin] = row
        elif rederive:
            merged[asin] = row
        elif row["gauge_rule_id"] == "MAP" and (old["gauge_class"] != row["gauge_class"] or old["gauge_rule_id"] != "MAP"):
            log.warning("gauge_map_override asin=%s frozen=%s/%s -> map=%s (run_id %s)", asin, old["gauge_class"],
                        old["gauge_rule_id"], row["gauge_class"], run_id)
            merged[asin] = row
    log.warning("gauge_decisions %s %s: unfrozen_candidates=%d (rederive=%s) -> %s", market, month, unfrozen, rederive, path)
    out = pd.DataFrame([merged[a] for a in sorted(merged)], columns=list(GAUGE_DECISIONS_COLUMNS))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(path, index=False)
    return out
