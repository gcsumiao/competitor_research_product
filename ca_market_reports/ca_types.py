"""Code-reader Type assignment (CA only), the type review queue and the conflict flag.

Precedence (first hit wins): override > us_map > prior_month > keyword > token_profile > default_other.
  type_source     strict TYPE_SOURCES value (keyword hits are "keyword"; the rule name goes to type_rule_id)
  type_rule_id    keyword rule name / "profile:<brand_key>" for profile hits; "" otherwise
  type_confidence 1.0 override/us_map/prior_month, 0.9 keyword (0.8 for scanner_lt380), score for token_profile,
                  0.0 default_other

Keyword rules are a port of Amazon_Monthly_Competitor_Report copy/script/auto_categorize_extra.py:_keyword_rule
(same order, same substring semantics) with two CA rules: `gauge_hud` inserted after `vci` and before `tablet`, and
`scanner_lt380` appended as the LAST rule (after `price_tablet_hint`): title matches
r"\bscanner\b|\bscan tool\b|\bobd2? reader\b|bi-?directional tool" and realized price < 380 -> Handheld (0.8). Because
it runs last, the dongle/tablet/key/cable rules still win for Bluetooth dongles, tablets, key tools and cables.
CA deltas: rules match the TITLE only (the CA url is rebuilt as amazon.ca/dp/<ASIN> and carries nothing but the
ASIN, whose letters could hit '8in' etc.), and both price-gated rules use the row's realized `price` (NaN never hits).

Token profiles: per (brand_key, type) over the rows already typed by override/us_map/prior_month in this frame
(load_us_type_map only exposes ASIN -> Type, so US-map titles reach profiles through the CA rows they type). A
profile = tokens present in >= 2 of that brand/type's titles (US rule), tokens = re.ASCII [a-z0-9]{3,} of the
casefolded title minus the US STOPWORDS. score = |profile ∩ title tokens| / |title tokens| (US semantics: the share
of the ROW's title tokens explained by the profile); a hit needs score >= 0.5 and >= 3 overlapping tokens; ties ->
lexically smallest type; confidence = score; rule id "profile:<brand_key>".
"""
from __future__ import annotations

import logging
import re
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from .ca_common import (ASIN_RE, MONTH_RE, TYPE_DECISIONS_COLUMNS, TYPE_LOUD_REVENUE, TYPE_OVERRIDES_COLUMNS,
                        TYPE_REVIEW_COLUMNS, TYPE_REVIEW_CONFIDENCE, TYPE_SOURCES, TYPES, run_file)

LOG = logging.getLogger("ca_market_reports")

KEYWORD_CONFIDENCE = 0.9
PROFILE_MIN_SCORE = 0.5
PROFILE_MIN_OVERLAP = 3
PROFILE_MIN_TITLES = 2
PROFILE_SEED_SOURCES = ("override", "us_map", "prior_month")
CONFLICT_TYPES = ("Tablet", "Handheld", "Dongle")
REVIEW_REASONS = ("default_other", "low_confidence", "gauge_type_conflict")

# auto_categorize_extra.py STOPWORDS (US), applied to profile tokens
PROFILE_STOPWORDS: frozenset[str] = frozenset({
    "and", "for", "with", "from", "that", "this", "your", "you", "all", "new", "the", "tool", "tools", "scan", "scanner",
    "reader", "code", "car", "cars", "vehicle", "vehicles", "obd", "obd2", "obdii",
})
_TOKEN_RE = re.compile(r"[a-z0-9]{3,}", re.ASCII)
GAUGE_HUD_RE = re.compile(
    r"\bgauge\b|\bgague\b|\bhud\b|heads?[- ]?up|scangauge|insight ct|\bcts[23]\b|idash|trip computer|on[- ]?board computer")

SCANNER_LT380_RE = re.compile(r"\bscanner\b|\bscan tool\b|\bobd2? reader\b|bi-?directional tool")
SCANNER_LT380_EXCLUDE_RE = re.compile(r"\bcase\b|cases\b|screen protector|hydrogel|tempered glass|microchip|credit card|barcode|bar code|\bbattery\b|\bpet\b|document scanner|\bqr\b", re.I)   # orchestrator one-liner: scanner_lt380 false positives

# (rule name, type, keywords) in US order; gauge_hud is a regex rule. The two price-gated rules follow (keyword_rule).
_KEYWORD_RULES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("obd1", "OBD1", ("obd1",)),
    ("vci", "VCI", ("vci",)),
    ("gauge_hud", "Other", ()),
    ("tablet", "Tablet", ("tablet", "8in", "10in", "12in", "touchscreen", "android 12", "android tablet")),
    ("key", "Key", ("key programmer", "key programming", "immobilizer", "key fob", "all keys lost")),
    ("probe", "Probe", ("probe", "oscilloscope probe", "scope probe")),
    ("dongle", "Dongle", ("bluetooth", "wireless", "wifi", "wi-fi", "dongle")),
    ("cable_adapter", "Cable/Adapter", ("cable", "adapter cable", "extension cable", "connector", "adapter")),
    ("handheld", "Handheld", ("scan tool", "diagnostic tool", "code reader", "check engine")),
)
PRICE_TABLET_HINT = 380.0
SCANNER_LT380_CONFIDENCE = 0.8
KEYWORD_RULE_NAMES: tuple[str, ...] = tuple(r[0] for r in _KEYWORD_RULES) + ("price_tablet_hint", "scanner_lt380")


def _is_blank(v) -> bool:
    return v is None or (not isinstance(v, str) and pd.isna(v)) or str(v).strip() == ""


def _norm_asin(v) -> str:
    return "" if _is_blank(v) else str(v).strip().upper()


def _check_type(value: str, where: str) -> str:
    if value not in TYPES:
        raise ValueError(f"{where}: type {value!r} is not one of {TYPES}")
    return value


def parse_bool(value, where: str) -> bool:
    """Booleans in CSVs are parsed explicitly from {Y,N,true,false,1,0} (case-insensitive); anything else raises."""
    if isinstance(value, bool):
        return value
    s = str(value).strip().casefold()
    if s in ("y", "true", "1"):
        return True
    if s in ("n", "false", "0"):
        return False
    raise ValueError(f"{where}: not a boolean: {value!r}")


def prev_month(month: str) -> str:
    if not MONTH_RE.match(str(month)):
        raise ValueError(f"bad month {month!r} (want YYYYMM)")
    y, m = int(month[:4]), int(month[4:])
    return f"{y - 1}12" if m == 1 else f"{y}{m - 1:02d}"


# --------------------------------------------------------------------------------------------------------------------
# Inputs: US map, override map, prior month decisions
# --------------------------------------------------------------------------------------------------------------------
def load_us_type_map(path: Path) -> dict[str, str]:
    """ASIN (upper/strip) -> Type from amazon_scanner_type.xlsx (or a .csv with the same columns). The LAST occurrence
    of an ASIN wins; every Type must be in TYPES."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"US type map not found: {path}")
    suffix = path.suffix.lower()
    if suffix in (".xlsx", ".xlsm"):
        df = pd.read_excel(path, dtype=str, keep_default_na=False, engine="openpyxl")
    elif suffix == ".csv":
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    else:
        raise ValueError(f"US type map must be .xlsx or .csv: {path}")
    for col in ("ASIN", "Type"):
        if col not in df.columns:
            raise ValueError(f"{path.name}: missing column {col!r}")
    out: dict[str, str] = {}
    for i, (asin, typ) in enumerate(zip(df["ASIN"], df["Type"])):
        a = _norm_asin(asin)
        if not ASIN_RE.match(a):
            raise ValueError(f"{path.name}: data row {i}: bad ASIN {asin!r}")
        out[a] = _check_type(str(typ).strip(), f"{path.name}: data row {i} ({a})")
    return out


def load_overrides(path: Path, report_month: str) -> dict[str, str]:
    """Human Type overrides applicable to report_month: per ASIN the row with the latest decided_month <= report_month
    wins; two rows with that same decided_month and different types are an error."""
    path = Path(path)
    if not MONTH_RE.match(str(report_month)):
        raise ValueError(f"bad report month {report_month!r}")
    if not path.exists():
        raise FileNotFoundError(f"type override map not found: {path}")
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    missing = [c for c in TYPE_OVERRIDES_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"{path.name}: missing column(s) {missing}")
    best: dict[str, tuple[str, str, int]] = {}      # asin -> (decided_month, type, row)
    for i, row in df.iterrows():
        where = f"{path.name}: data row {i}"
        asin = _norm_asin(row["asin"])
        if not ASIN_RE.match(asin):
            raise ValueError(f"{where}: bad ASIN {row['asin']!r}")
        typ = _check_type(str(row["type"]).strip(), where)
        dm = str(row["decided_month"]).strip()
        if not MONTH_RE.match(dm):
            raise ValueError(f"{where}: bad decided_month {dm!r}")
        if dm > report_month:
            continue
        cur = best.get(asin)
        if cur is None or dm > cur[0]:
            best[asin] = (dm, typ, i)
        elif dm == cur[0] and typ != cur[1]:
            raise ValueError(f"{where}: {asin} has two decisions for decided_month {dm}: {cur[1]!r} (row {cur[2]}) and {typ!r}")
    return {a: v[1] for a, v in best.items()}


def read_type_decisions(path: Path) -> pd.DataFrame:
    """Read and validate a type_decisions_<scope>_<m>.csv; confidence as float, type_conflict as bool."""
    path = Path(path)
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    if tuple(df.columns) != TYPE_DECISIONS_COLUMNS:
        raise ValueError(f"{path.name}: columns {list(df.columns)} != {list(TYPE_DECISIONS_COLUMNS)}")
    conf, conflict = [], []
    for i, row in df.iterrows():
        where = f"{path.name}: data row {i} ({row['asin']})"
        if not ASIN_RE.match(row["asin"]):
            raise ValueError(f"{where}: bad ASIN")
        _check_type(row["type"], where)
        if row["type_source"] not in TYPE_SOURCES:
            raise ValueError(f"{where}: type_source {row['type_source']!r} not in {TYPE_SOURCES}")
        try:
            c = float(row["type_confidence"])
        except ValueError:
            raise ValueError(f"{where}: type_confidence {row['type_confidence']!r} is not a number") from None
        conf.append(c)
        conflict.append(parse_bool(row["type_conflict"], where))
    if df["asin"].duplicated().any():
        raise ValueError(f"{path.name}: duplicate ASINs {sorted(set(df.loc[df['asin'].duplicated(), 'asin']))[:10]}")
    df["type_confidence"] = pd.Series(conf, index=df.index, dtype=float)
    df["type_conflict"] = pd.Series(conflict, index=df.index, dtype=bool)
    return df


def load_prior_month(runs_dir: Path, month: str, market: str) -> dict[str, tuple[str, str, float]]:
    """asin -> (type, type_source, type_confidence) from the PREVIOUS month's frozen decisions, if that file exists.
    default_other rows and rows with confidence < TYPE_REVIEW_CONFIDENCE are not carried forward."""
    pm = prev_month(month)
    path = run_file(Path(runs_dir), pm, "type_decisions", f"{market}_code_reader")
    if not path.exists():
        return {}
    df = read_type_decisions(path)
    bad = df[(df["month"] != pm) | (df["market"] != market)]
    if len(bad):
        raise ValueError(f"{path.name}: rows for another month/market: {bad[['month', 'market', 'asin']].head().to_dict('records')}")
    keep = df[(df["type_source"] != "default_other") & (df["type_confidence"] >= TYPE_REVIEW_CONFIDENCE)]
    return {a: (t, s, float(c)) for a, t, s, c in zip(keep["asin"], keep["type"], keep["type_source"], keep["type_confidence"])}


# --------------------------------------------------------------------------------------------------------------------
# Assignment
# --------------------------------------------------------------------------------------------------------------------
def keyword_rule(title, price) -> tuple[str, str, float] | None:
    """(type, rule name, confidence) of the first matching keyword rule on the title, else None (order: KEYWORD_RULE_NAMES)."""
    text = "" if _is_blank(title) else str(title).strip().lower()
    for name, typ, words in _KEYWORD_RULES:
        if name == "gauge_hud":
            if GAUGE_HUD_RE.search(text):
                return typ, name, KEYWORD_CONFIDENCE
        elif any(w in text for w in words):
            return typ, name, KEYWORD_CONFIDENCE
    p = float(price) if not _is_blank(price) else float("nan")
    if p >= PRICE_TABLET_HINT and "scanner" in text:
        return "Tablet", "price_tablet_hint", KEYWORD_CONFIDENCE
    if p < PRICE_TABLET_HINT and SCANNER_LT380_RE.search(text) and not SCANNER_LT380_EXCLUDE_RE.search(text):     # NaN compares False: no realized price, no hit; non-automotive "scanners" and accessories fall through to review
        return "Handheld", "scanner_lt380", SCANNER_LT380_CONFIDENCE
    return None


def title_tokens(title) -> set[str]:
    if _is_blank(title):
        return set()
    return set(_TOKEN_RE.findall(str(title).casefold())) - PROFILE_STOPWORDS


def build_profiles(titles_by_brand_type: dict[tuple[str, str], list]) -> dict[tuple[str, str], frozenset[str]]:
    profiles: dict[tuple[str, str], frozenset[str]] = {}
    for key, titles in titles_by_brand_type.items():
        cnt: Counter = Counter()
        for t in titles:
            cnt.update(title_tokens(t))
        prof = frozenset(tok for tok, n in cnt.items() if n >= PROFILE_MIN_TITLES)
        if prof:
            profiles[key] = prof
    return profiles


def profile_match(brand_key: str, title, profiles_by_brand: dict[str, list[tuple[str, frozenset[str]]]]) -> tuple[str, float] | None:
    if not brand_key or brand_key not in profiles_by_brand:
        return None
    toks = title_tokens(title)
    if not toks:
        return None
    best: tuple[float, str] | None = None
    for typ, prof in profiles_by_brand[brand_key]:
        overlap = len(prof & toks)
        score = overlap / len(toks)
        if overlap < PROFILE_MIN_OVERLAP or score < PROFILE_MIN_SCORE:
            continue
        if best is None or score > best[0] or (score == best[0] and typ < best[1]):
            best = (score, typ)
    return None if best is None else (best[1], best[0])


def assign_types(df: pd.DataFrame, *, us_map: dict[str, str], overrides: dict[str, str], prior: dict) -> pd.DataFrame:
    """Return a copy with type / type_source / type_rule_id / type_confidence filled for EVERY row (see module doc).

    prior: asin -> type, or asin -> (type, type_source, confidence) as returned by load_prior_month.
    type_conflict is left as is (added as False when absent); flag_type_conflicts sets it later."""
    for name, mapping in (("us_map", us_map), ("overrides", overrides)):
        for a, t in mapping.items():
            _check_type(t, f"assign_types {name}[{a}]")
    prior_types: dict[str, str] = {}
    for a, v in prior.items():
        t = v[0] if isinstance(v, tuple) else v
        prior_types[a] = _check_type(t, f"assign_types prior[{a}]")

    out = df.copy()
    n = len(out)
    asins = out["asin"].astype(str).tolist()
    titles = out["title"].tolist()
    brands = out["brand_key"].fillna("").astype(str).tolist()
    prices = out["price"].tolist()
    typ = [""] * n
    src = [""] * n
    rule = [""] * n
    conf = [float("nan")] * n

    for i, a in enumerate(asins):
        if a in overrides:
            typ[i], src[i], conf[i] = overrides[a], "override", 1.0
        elif a in us_map:
            typ[i], src[i], conf[i] = us_map[a], "us_map", 1.0
        elif a in prior_types:
            typ[i], src[i], conf[i] = prior_types[a], "prior_month", 1.0

    seed: dict[tuple[str, str], list] = defaultdict(list)
    for i in range(n):
        if src[i] in PROFILE_SEED_SOURCES and brands[i]:
            seed[(brands[i], typ[i])].append(titles[i])
    profiles_by_brand: dict[str, list[tuple[str, frozenset[str]]]] = defaultdict(list)
    for (b, t), prof in sorted(build_profiles(seed).items()):
        profiles_by_brand[b].append((t, prof))

    for i in range(n):
        if src[i]:
            continue
        kw = keyword_rule(titles[i], prices[i])
        if kw is not None:
            typ[i], src[i], rule[i], conf[i] = kw[0], "keyword", kw[1], kw[2]
            continue
        pm = profile_match(brands[i], titles[i], profiles_by_brand)
        if pm is not None:
            typ[i], src[i], rule[i], conf[i] = pm[0], "token_profile", f"profile:{brands[i]}", pm[1]
            continue
        typ[i], src[i], rule[i], conf[i] = "Other", "default_other", "", 0.0

    out["type"] = typ
    out["type_source"] = src
    out["type_rule_id"] = rule
    out["type_confidence"] = pd.Series(conf, index=out.index, dtype=float)
    if "type_conflict" not in out.columns:
        out["type_conflict"] = False
    return out


def flag_type_conflicts(df: pd.DataFrame) -> pd.DataFrame:
    """type_conflict=True where gauge_device_scope is True and type in {Tablet, Handheld, Dongle}. No-op (copy) when
    the gauge_device_scope column is absent. Other rows keep their current flag."""
    out = df.copy()
    if "gauge_device_scope" not in out.columns:
        return out
    scope = out["gauge_device_scope"].map(lambda v: isinstance(v, (bool, np.bool_)) and bool(v))
    hit = scope & out["type"].isin(CONFLICT_TYPES)
    if "type_conflict" not in out.columns:
        out["type_conflict"] = False
    out["type_conflict"] = out["type_conflict"].astype(bool) | hit.astype(bool)
    return out


# --------------------------------------------------------------------------------------------------------------------
# Review queue
# --------------------------------------------------------------------------------------------------------------------
def review_reason(row) -> str:
    """'' or one REVIEW_REASONS value; priority gauge_type_conflict > default_other > low_confidence."""
    if bool(row.get("type_conflict", False)):
        return "gauge_type_conflict"
    if row["type_source"] == "default_other":
        return "default_other"
    c = row["type_confidence"]
    if row["type_source"] and not pd.isna(c) and float(c) < TYPE_REVIEW_CONFIDENCE:
        return "low_confidence"
    return ""


def warn_loud_default_other(df: pd.DataFrame) -> int:
    loud = df[(df["type_source"] == "default_other") & (df["revenue_month"] >= TYPE_LOUD_REVENUE)]
    for _, r in loud.sort_values(["revenue_month", "asin"], ascending=[False, True]).iterrows():
        LOG.warning("type default_other at revenue >= %.0f: asin=%s revenue=%.2f title=%s", TYPE_LOUD_REVENUE, r["asin"],
                    float(r["revenue_month"]), r["title"])
    return len(loud)


def build_type_review(df: pd.DataFrame) -> pd.DataFrame:
    """TYPE_REVIEW_COLUMNS rows for every default_other, low-confidence and gauge-type-conflict row (revenue DESC, asin).
    Logs a loud warning for each default_other row with revenue_month >= TYPE_LOUD_REVENUE."""
    warn_loud_default_other(df)
    rows = []
    for _, r in df.iterrows():
        reason = review_reason(r)
        if not reason:
            continue
        rows.append({"asin": r["asin"], "title": r["title"], "brand_display": r["brand_display"], "price": r["price"],
                     "revenue_month": r["revenue_month"], "url": r["url"], "proposed_type": r["type"],
                     "type_source": r["type_source"], "type_rule_id": r["type_rule_id"],
                     "type_confidence": r["type_confidence"], "review_reason": reason, "reviewed_type": ""})
    out = pd.DataFrame(rows, columns=list(TYPE_REVIEW_COLUMNS))
    if len(out):
        out = out.sort_values(["revenue_month", "asin"], ascending=[False, True], kind="mergesort").reset_index(drop=True)
    return out


def read_type_review(path: Path) -> pd.DataFrame:
    path = Path(path)
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    if tuple(df.columns) != TYPE_REVIEW_COLUMNS:
        raise ValueError(f"{path.name}: columns {list(df.columns)} != {list(TYPE_REVIEW_COLUMNS)}")
    if df["asin"].duplicated().any():
        raise ValueError(f"{path.name}: duplicate ASINs")
    for i, t in enumerate(df["reviewed_type"]):
        if t.strip():
            _check_type(t.strip(), f"{path.name}: data row {i} reviewed_type")
    return df


def write_type_review(df: pd.DataFrame, path: Path) -> pd.DataFrame:
    """Merge review rows into `path` by ASIN: machine columns are refreshed from df, a non-empty human reviewed_type in
    the existing file is kept, rows only in the file are kept, new ASINs are appended. Returns the merged frame."""
    path = Path(path)
    new = df[list(TYPE_REVIEW_COLUMNS)].copy()
    if new["asin"].duplicated().any():
        raise ValueError("write_type_review: duplicate ASINs in review rows")
    if path.exists():
        old = read_type_review(path)
        reviewed = {a: t for a, t in zip(old["asin"], old["reviewed_type"]) if t.strip()}
        new_by_asin = {a: i for i, a in enumerate(new["asin"])}
        rows = []
        for _, r in old.iterrows():
            if r["asin"] in new_by_asin:
                rows.append(new.iloc[new_by_asin[r["asin"]]].to_dict())
            else:
                rows.append(r.to_dict())
        seen = set(old["asin"])
        rows.extend(new.iloc[i].to_dict() for i, a in enumerate(new["asin"]) if a not in seen)
        merged = pd.DataFrame(rows, columns=list(TYPE_REVIEW_COLUMNS))
        merged["reviewed_type"] = [reviewed.get(a, str(t) if not _is_blank(t) else "") for a, t in zip(merged["asin"], merged["reviewed_type"])]
    else:
        merged = new
    path.parent.mkdir(parents=True, exist_ok=True)
    merged.to_csv(path, index=False, lineterminator="\n")
    return merged
