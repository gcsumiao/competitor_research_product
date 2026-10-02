"""Price tiers (half-open [lo, hi); a price exactly on a boundary goes UP; the top tier has hi = inf).

Pure functions over the frozen tier tables in ca_common (CR_TIERS, CR_TIER_GROUPS, GAUGE_TIERS, DONGLE_TIERS).
"""
from __future__ import annotations

import math
from typing import Iterable

import pandas as pd

from .ca_common import CR_TIER_GROUPS, CR_TIERS, DONGLE_TIERS, GAUGE_TIERS, TYPES

Tiers = tuple[tuple[str, float, float], ...]

# Per-type leaf tiers derived once from CR_TIERS (a type may appear in several labels, e.g. Tablet in three bands).
_CR_TIERS_BY_TYPE: dict[str, Tiers] = {
    t: tuple((label, lo, hi) for label, (types, lo, hi) in CR_TIERS.items() if t in types) for t in TYPES
}


def tier_label(price, tiers: Iterable[tuple[str, float, float]]) -> str:
    """Label of the band with lo <= price < hi; '' for a missing/NaN/negative price or one outside every band."""
    if price is None or (not isinstance(price, str) and pd.isna(price)):
        return ""
    try:
        p = float(price)
    except (TypeError, ValueError):
        raise ValueError(f"tier_label: price is not numeric: {price!r}") from None
    if math.isnan(p) or p < 0:
        return ""
    for label, lo, hi in tiers:
        if lo <= p < hi:
            return label
    return ""


def gauge_tier(price) -> str:
    return tier_label(price, GAUGE_TIERS)


def dongle_tier(price) -> str:
    return tier_label(price, DONGLE_TIERS)


def cr_tier_group_members(label: str) -> tuple[str, ...]:
    """Leaf tiers that make up a CR tier row: a group (Total Tablet / Total Handheld / Total) or a leaf label itself."""
    if label in CR_TIER_GROUPS:
        return CR_TIER_GROUPS[label]
    if label in CR_TIERS:
        return (label,)
    raise ValueError(f"unknown code-reader tier label: {label!r}")


def assign_cr_tiers(df: pd.DataFrame) -> pd.DataFrame:
    """Return a copy with price_tier set from CR_TIERS by (type, price).

    Every row whose type is in TYPES gets exactly one leaf tier (ValueError otherwise, naming the ASIN); rows with an
    empty type get ''. Any other type value is an error. All other columns are preserved untouched.
    """
    out = df.copy()
    types = out["type"].fillna("").astype(str)
    unknown = sorted(set(types) - set(TYPES) - {""})
    if unknown:
        bad = out.loc[types.isin(unknown), "asin"].astype(str).tolist()[:10]
        raise ValueError(f"assign_cr_tiers: unknown type value(s) {unknown} (asin e.g. {bad})")
    labels: list[str] = []
    for asin, typ, price in zip(out["asin"].astype(str), types, out["price"]):
        if typ == "":
            labels.append("")
            continue
        hits = [lbl for lbl, lo, hi in _CR_TIERS_BY_TYPE[typ] if _in_band(price, lo, hi)]
        if len(hits) != 1:
            raise ValueError(f"assign_cr_tiers: asin {asin} type {typ!r} price {price!r} matched {len(hits)} tiers {hits}")
        labels.append(hits[0])
    out["price_tier"] = labels
    return out


def _in_band(price, lo: float, hi: float) -> bool:
    if price is None or (not isinstance(price, str) and pd.isna(price)):
        return False
    p = float(price)
    return p >= 0 and lo <= p < hi
