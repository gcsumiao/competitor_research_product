"""Brand canonicalization, display names and generic-brand recovery.

canonical_brand_key: casefold, strip, strip ®/™/© glyphs, collapse internal whitespace, then ONE alias lookup.
recover_generic_brands: port of the US leading-title recovery (Amazon_Monthly_Competitor_Report copy/script/
full_report_month.py, GENERIC_RECOVERY_* constants and _recover_generic_brands) with the CA deltas:
  * reassign only — the US "blocked brand -> remove row" branch does not exist here (a Generic row titled
    "INNOVA ..." is reassigned to innova);
  * the vocabulary is a set of canonical brand keys supplied by the caller (ca_load builds it from this month's
    brand keys ∪ alias canonical keys ∪ display-map keys ∪ GENERIC_RECOVERY_EXTRA_BRANDS);
  * frozen (replayed) decisions are applied verbatim before any new one is derived.
Only a LEADING brand matches (after skippable prefix tokens such as "new"/"upgraded" and model years); a brand
that merely appears mid-title ("Case for Innova 5610", "for BMW") never matches.
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

import pandas as pd

from .ca_common import BRAND_ALIASES_COLUMNS, BRAND_DISPLAY_COLUMNS, BRAND_RECOVERY_COLUMNS

LOG = logging.getLogger("ca_market_reports")

# Ported verbatim from full_report_month.py (US); BLOCKED brands are intentionally not ported (reassign only).
GENERIC_RECOVERY_STOPWORDS: frozenset[str] = frozenset({
    "other", "car", "cars", "auto", "tool", "tools", "obd", "obd2", "obdii", "scanner", "code", "reader", "pro", "plus",
    "mini", "max", "universal", "professional", "diagnostic", "heavy", "duty", "truck", "wireless", "bluetooth", "smart",
    "digital",
})
GENERIC_RECOVERY_EXTRA_BRANDS: frozenset[str] = frozenset({"nexiq", "temeda"})
GENERIC_RECOVERY_IGNORABLE_PREFIX_TOKENS: frozenset[str] = frozenset({"new", "upgraded", "upgrade", "latest", "original"})
GENERIC_BRAND_KEY = "generic"
_YEAR_RE = re.compile(r"(19|20)\d{2}")
_GLYPH_RE = re.compile("[®™©]")      # ® ™ ©
_WS_RE = re.compile(r"\s+")


# --------------------------------------------------------------------------------------------------------------------
# Canonical keys and display names
# --------------------------------------------------------------------------------------------------------------------
def normalize_brand_text(raw) -> str:
    """casefold + strip + glyph strip + whitespace collapse (no alias lookup). NaN/None -> ''."""
    if raw is None:
        return ""
    if not isinstance(raw, str):
        if pd.isna(raw):
            return ""
        raw = str(raw)
    text = _GLYPH_RE.sub(" ", raw.casefold())
    return _WS_RE.sub(" ", text).strip()


def canonical_brand_key(raw, aliases: dict[str, str]) -> str:
    key = normalize_brand_text(raw)
    return aliases.get(key, key)


def display_brand(key: str, display: dict[str, str]) -> str:
    if key in display:
        return display[key]
    return " ".join(w.capitalize() for w in str(key).split())


def _read_map(path: Path, required: tuple[str, ...]) -> pd.DataFrame:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"brand map not found: {path}")
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    df.columns = [c.strip() for c in df.columns]
    missing = [c for c in required if c not in df.columns]
    if missing:
        raise ValueError(f"{path.name}: missing column(s) {missing}; expected {list(required)}")
    return df


def load_aliases(path: Path) -> dict[str, str]:
    """raw_key -> canonical_key. Both sides are normalized (glyphs/case/whitespace) so a raw_key such as 'motopower®'
    is reachable after canonical_brand_key's glyph stripping. Conflicting rows and alias chains are errors."""
    df = _read_map(path, BRAND_ALIASES_COLUMNS)
    out: dict[str, str] = {}
    for i, row in df.iterrows():
        raw, canon = normalize_brand_text(row["raw_key"]), normalize_brand_text(row["canonical_key"])
        if not raw or not canon:
            raise ValueError(f"{Path(path).name}: data row {i}: empty raw_key/canonical_key")
        if raw in out and out[raw] != canon:
            raise ValueError(f"{Path(path).name}: data row {i}: raw_key {raw!r} maps to both {out[raw]!r} and {canon!r}")
        out[raw] = canon
    chains = {k: v for k, v in out.items() if v in out and out[v] != v}
    if chains:
        raise ValueError(f"{Path(path).name}: alias chains are not allowed (canonical_key is itself an alias): {chains}")
    return out


def load_display(path: Path) -> dict[str, str]:
    """canonical_key -> display name; conflicting rows for one key are an error."""
    df = _read_map(path, BRAND_DISPLAY_COLUMNS)
    out: dict[str, str] = {}
    for i, row in df.iterrows():
        key, disp = normalize_brand_text(row["canonical_key"]), str(row["display"]).strip()
        if not key or not disp:
            raise ValueError(f"{Path(path).name}: data row {i}: empty canonical_key/display")
        if key in out and out[key] != disp:
            raise ValueError(f"{Path(path).name}: data row {i}: {key!r} has displays {out[key]!r} and {disp!r}")
        out[key] = disp
    return out


# --------------------------------------------------------------------------------------------------------------------
# Generic-brand recovery
# --------------------------------------------------------------------------------------------------------------------
def _strip_token_punctuation(token: str) -> str:
    start, end = 0, len(token)
    while start < end and not token[start].isalnum():
        start += 1
    while end > start and not token[end - 1].isalnum():
        end -= 1
    return token[start:end]


def recovery_tokens(value) -> tuple[str, ...]:
    """Whitespace tokens, casefolded, with leading/trailing punctuation stripped (US _generic_recovery_tokens)."""
    if value is None or (not isinstance(value, str) and pd.isna(value)):
        return ()
    return tuple(t for t in (_strip_token_punctuation(p.casefold()) for p in str(value).split()) if t)


def _candidates(vocabulary: set[str]) -> list[tuple[tuple[str, ...], str, str]]:
    """[(brand tokens, match_text, canonical key)] sorted longest-first then lexically (US candidate order)."""
    out = []
    for key in vocabulary:
        canonical = normalize_brand_text(key)
        tokens = recovery_tokens(canonical)
        match_text = " ".join(tokens)
        if (len(match_text) < 3 or match_text in GENERIC_RECOVERY_STOPWORDS or canonical in ("", GENERIC_BRAND_KEY)
                or canonical in GENERIC_RECOVERY_STOPWORDS):
            continue
        out.append((tokens, match_text, canonical))
    out.sort(key=lambda c: (-len(c[0]), c[1], c[2]))
    return out


def match_leading_brand(title, candidates) -> tuple[str, str] | None:
    """(canonical key, matched text) of the longest candidate that starts the title, else None."""
    tokens = recovery_tokens(title)
    start = 0
    while start < len(tokens) and (tokens[start] in GENERIC_RECOVERY_IGNORABLE_PREFIX_TOKENS or _YEAR_RE.fullmatch(tokens[start])):
        start += 1
    for brand_tokens, match_text, canonical in candidates:
        if tokens[start:start + len(brand_tokens)] == brand_tokens:
            return canonical, match_text
    return None


def recover_generic_brands(df: pd.DataFrame, vocabulary: set[str], frozen: pd.DataFrame | None, *,
                           display: dict[str, str] | None = None, month: str = "") -> tuple[pd.DataFrame, pd.DataFrame]:
    """Reassign brand_key/brand_display of Generic rows whose title STARTS with a known brand.

    frozen: rows (BRAND_RECOVERY_COLUMNS) from the replay file; each is applied verbatim to the row with that ASIN when
    the row's current brand_key still equals the frozen old_brand. Frozen rows that no longer apply are skipped with a
    warning (the caller decides whether to drop them from the decision file). New decisions are derived only for the
    remaining Generic rows. Returns (copy of df, audit DataFrame[BRAND_RECOVERY_COLUMNS]); no row is ever removed.
    `display` (optional, additive to the frozen signature) maps keys to display names; without it display_brand's
    capitalisation fallback is used. `month` fills the audit's month column for newly derived rows.
    """
    out = df.copy()
    display = display or {}
    audit_rows: list[dict] = []
    done: set[str] = set()
    pos_by_asin = {a: i for i, a in enumerate(out["asin"].astype(str))}
    if len(pos_by_asin) != len(out):
        raise ValueError("recover_generic_brands: df has duplicate ASINs (dedupe first)")
    key_col = out.columns.get_loc("brand_key")
    disp_col = out.columns.get_loc("brand_display")

    if frozen is not None and len(frozen):
        missing = [c for c in BRAND_RECOVERY_COLUMNS if c not in frozen.columns]
        if missing:
            raise ValueError(f"recover_generic_brands: frozen rows missing columns {missing}")
        for _, fz in frozen.iterrows():
            asin = str(fz["asin"])
            if fz["action"] != "reassigned":
                raise ValueError(f"recover_generic_brands: frozen row for {asin} has unknown action {fz['action']!r}")
            if asin in done:
                raise ValueError(f"recover_generic_brands: frozen rows contain {asin} twice")
            pos = pos_by_asin.get(asin)
            if pos is None:
                continue        # ASIN absent from this frame; the decision stays in its file, nothing to apply
            current = out.iat[pos, key_col]
            if current != fz["old_brand"]:
                LOG.warning("brand_recovery: frozen decision for %s not applied: brand_key is now %r (frozen old_brand %r)",
                            asin, current, fz["old_brand"])
                continue
            new_key = str(fz["new_brand"])
            out.iat[pos, key_col] = new_key
            out.iat[pos, disp_col] = display_brand(new_key, display)
            audit_rows.append({c: fz[c] for c in BRAND_RECOVERY_COLUMNS})
            done.add(asin)

    candidates = _candidates(set(vocabulary))
    generic = out["brand_key"].astype(str).eq(GENERIC_BRAND_KEY)
    for pos in [i for i, g in enumerate(generic) if g]:
        asin = str(out.iat[pos, out.columns.get_loc("asin")])
        if asin in done:
            continue
        title = out.iat[pos, out.columns.get_loc("title")]
        match = match_leading_brand(title, candidates)
        if match is None:
            continue
        new_key, matched_text = match
        old_key = out.iat[pos, key_col]
        out.iat[pos, key_col] = new_key
        out.iat[pos, disp_col] = display_brand(new_key, display)
        audit_rows.append({
            "month": str(month), "asin": asin, "title": title, "old_brand": old_key, "new_brand": new_key,
            "matched_text": matched_text, "monthly_units": out.iat[pos, out.columns.get_loc("units_month")],
            "monthly_revenue": out.iat[pos, out.columns.get_loc("revenue_month")], "action": "reassigned",
        })
        done.add(asin)
    return out, pd.DataFrame(audit_rows, columns=list(BRAND_RECOVERY_COLUMNS))
