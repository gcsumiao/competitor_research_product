#!/usr/bin/env python3
"""Price-tier schemes for the monthly code-reader summary (single source of truth).

Each tier is a product-``Type`` filter plus a half-open price range
``[low, high)``: a listing belongs to a tier when ``Type in types`` and
``low <= Price < high``. A boundary price therefore always lands in the UPPER
bucket (a $400.00 tablet is "Tablet $400-$800", not "Tablet $400-").
``high=None`` means open-ended: the legacy ``category`` dict gives it an upper
bound of ``math.inf``, so the most expensive listing always lands in it (the
old bound, ``math.ceil(max(market.Price))``, dropped a listing priced at a whole
dollar amount, and capped last month / last year at this month's maximum).

Scheme V1 (report months before 202610; kept verbatim so published months
reproduce exactly):
    Tablet $800+ | Tablet $400-$800 | Tablet $400- | Total Tablet |
    Handheld $75+ | Handheld $75- | Total Handheld |
    Total Dongle | Total Other Tools | Total

Scheme V2 (report month 202610 onward, analyst decision 2026-11-03):
    Tablet $800+ | Tablet $400-$800 | Tablet $400- |
        Tablet $300-$400 | Tablet $200-$300 | Tablet $200- |
    Total Tablet |
    Handheld $100+ | Handheld $100- |
        Handheld $65-$100 | Handheld $35-$65 | Handheld $35- |
    Total Handheld |
    Total Dongle | Total Other Tools | Total

Sub-tiers (``kind="subtier"``) partition their parent tier exactly and carry
``parent`` = the parent tier label. Labels are verbatim analyst wording. The
first V2 preview (2026-11-03) used "Tablet $300+" / "Handheld $65+" for the
$300-$400 / $65-$100 sub-tiers; the analyst relabelled them the same day
(ranges unchanged). ``LEGACY_LABELS`` maps the old wording to the new so a
workbook built with it can be upgraded in place. Scheme order is the row order
of summary.xlsx Sheet1 / Category and the per-category sheet order, and each
label is also a sheet name.

Share denominators (summary.xlsx Sheet1 "Qty by %" / "Revenue by %"): V1
divides every tag's rows by that tag's whole frame, listings outside every
category (type OBD1) included, so a "Total" row reads e.g. 99.87%. From V2
the denominator is the tag's own "Total"-category sums for the frame, so every
"Total" row reads exactly 100% (``categorized_share_basis``).

Stdlib + typing only so any script can import it without pandas.
"""
from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Union

PRICE_TIER_V2_START_MONTH = "202610"

TierKind = Literal["tier", "subtier", "total", "grand_total"]
SchemeName = Literal["v1", "v2"]


@dataclass(frozen=True)
class Tier:
    label: str
    types: tuple[str, ...]
    low: float
    high: float | None  # None = open-ended (no upper bound)
    parent: str | None
    kind: TierKind


TABLET_TYPES: tuple[str, ...] = ("Tablet",)
HANDHELD_TYPES: tuple[str, ...] = ("Handheld",)
DONGLE_TYPES: tuple[str, ...] = ("Dongle",)
OTHER_TOOL_TYPES: tuple[str, ...] = ("Key", "Cable/Adapter", "Other", "Probe", "VCI")
ALL_TYPES: tuple[str, ...] = TABLET_TYPES + HANDHELD_TYPES + DONGLE_TYPES + OTHER_TOOL_TYPES

_TOTAL_TABLET = Tier("Total Tablet", TABLET_TYPES, 0, None, None, "total")
_TOTAL_HANDHELD = Tier("Total Handheld", HANDHELD_TYPES, 0, None, None, "total")
_TOTAL_DONGLE = Tier("Total Dongle", DONGLE_TYPES, 0, None, None, "total")
_TOTAL_OTHER_TOOLS = Tier("Total Other Tools", OTHER_TOOL_TYPES, 0, None, None, "total")
_GRAND_TOTAL = Tier("Total", ALL_TYPES, 0, None, None, "grand_total")

SCHEME_V1: tuple[Tier, ...] = (
    Tier("Tablet $800+", TABLET_TYPES, 800, None, None, "tier"),
    Tier("Tablet $400-$800", TABLET_TYPES, 400, 800, None, "tier"),
    Tier("Tablet $400-", TABLET_TYPES, 0, 400, None, "tier"),
    _TOTAL_TABLET,
    Tier("Handheld $75+", HANDHELD_TYPES, 75, None, None, "tier"),
    Tier("Handheld $75-", HANDHELD_TYPES, 0, 75, None, "tier"),
    _TOTAL_HANDHELD,
    _TOTAL_DONGLE,
    _TOTAL_OTHER_TOOLS,
    _GRAND_TOTAL,
)

SCHEME_V2: tuple[Tier, ...] = (
    Tier("Tablet $800+", TABLET_TYPES, 800, None, None, "tier"),
    Tier("Tablet $400-$800", TABLET_TYPES, 400, 800, None, "tier"),
    Tier("Tablet $400-", TABLET_TYPES, 0, 400, None, "tier"),
    Tier("Tablet $300-$400", TABLET_TYPES, 300, 400, "Tablet $400-", "subtier"),
    Tier("Tablet $200-$300", TABLET_TYPES, 200, 300, "Tablet $400-", "subtier"),
    Tier("Tablet $200-", TABLET_TYPES, 0, 200, "Tablet $400-", "subtier"),
    _TOTAL_TABLET,
    Tier("Handheld $100+", HANDHELD_TYPES, 100, None, None, "tier"),
    Tier("Handheld $100-", HANDHELD_TYPES, 0, 100, None, "tier"),
    Tier("Handheld $65-$100", HANDHELD_TYPES, 65, 100, "Handheld $100-", "subtier"),
    Tier("Handheld $35-$65", HANDHELD_TYPES, 35, 65, "Handheld $100-", "subtier"),
    Tier("Handheld $35-", HANDHELD_TYPES, 0, 35, "Handheld $100-", "subtier"),
    _TOTAL_HANDHELD,
    _TOTAL_DONGLE,
    _TOTAL_OTHER_TOOLS,
    _GRAND_TOTAL,
)

SCHEMES: dict[str, tuple[Tier, ...]] = {"v1": SCHEME_V1, "v2": SCHEME_V2}

# Superseded V2 sub-tier wording (first preview, 2026-11-03) -> current label.
LEGACY_LABELS: dict[str, str] = {"Tablet $300+": "Tablet $300-$400", "Handheld $65+": "Handheld $65-$100"}

SCHEME_CHOICES: tuple[str, ...] = ("auto", "v1", "v2")

SchemeLike = Union[str, Sequence[Tier]]


def _normalize_month(month: str | int | None) -> str | None:
    if month is None:
        return None
    text = str(month).strip()
    if not text:
        return None
    if not (len(text) == 6 and text.isdigit()):
        raise ValueError(f"month must be YYYYMM, got {month!r}")
    return text


def scheme_version(month: str | int | None) -> SchemeName:
    """'v2' from PRICE_TIER_V2_START_MONTH onward, else 'v1' (None -> 'v1')."""
    m = _normalize_month(month)
    return "v2" if m is not None and m >= PRICE_TIER_V2_START_MONTH else "v1"


def scheme_for_month(month: str | int | None) -> tuple[Tier, ...]:
    return SCHEMES[scheme_version(month)]


def resolve_scheme_name(month: str | int | None, scheme: str = "auto") -> SchemeName:
    """Scheme name to use: ``scheme`` 'auto' picks by month, 'v1'/'v2' force one."""
    key = str(scheme).strip().lower()
    if key == "auto":
        return scheme_version(month)
    if key in SCHEMES:
        return key  # type: ignore[return-value]
    raise ValueError(f"tier scheme must be one of {SCHEME_CHOICES}, got {scheme!r}")


def describe_scheme(month: str | int | None, scheme: str = "auto") -> str:
    """One-line description for build logs, e.g. 'v2 (202610+)' or 'v1'."""
    name = resolve_scheme_name(month, scheme)
    text = f"v2 ({PRICE_TIER_V2_START_MONTH}+)" if name == "v2" else "v1"
    if str(scheme).strip().lower() != "auto" and name != scheme_version(month):
        text += f" [forced; month {_normalize_month(month)} defaults to {scheme_version(month)}]"
    return text


def category_dict(
    month: str | int | None, price_range: float | None = None, *, scheme: str = "auto"
) -> dict[str, list]:
    """Legacy ``category`` dict: ``label -> [list(types), low, high]`` in scheme order.

    Open-ended tiers (``high=None``) get ``math.inf`` as their upper bound, for
    every scheme. Consumers filter with
    ``Type.isin(types) & (Price >= low) & (Price < high)``, so a whole-dollar
    maximum price (202403: $9,987.00) no longer falls out of every open bucket.
    ``price_range`` (the old ``math.ceil(max(market.Price))`` cap) is accepted
    for call-site compatibility and ignored.
    """
    del price_range  # kept in the signature for existing callers; no longer a bound
    tiers = SCHEMES[resolve_scheme_name(month, scheme)]
    return {
        t.label: [list(t.types), t.low, math.inf if t.high is None else t.high]
        for t in tiers
    }


def _tiers(scheme: SchemeLike) -> tuple[Tier, ...]:
    if isinstance(scheme, str):
        key = scheme.strip().lower()
        if key not in SCHEMES:
            raise ValueError(f"scheme must be 'v1', 'v2' or a tuple of Tier, got {scheme!r}")
        return SCHEMES[key]
    return tuple(scheme)


def tier_labels(scheme: SchemeLike) -> list[str]:
    """Every label in scheme order (tiers, sub-tiers and totals)."""
    return [t.label for t in _tiers(scheme)]


def subtier_labels(scheme: SchemeLike) -> list[str]:
    return [t.label for t in _tiers(scheme) if t.kind == "subtier"]


def total_labels(scheme: SchemeLike) -> list[str]:
    """Totals including the grand 'Total', in scheme order."""
    return [t.label for t in _tiers(scheme) if t.kind in ("total", "grand_total")]


def parent_of(label: str, scheme: SchemeLike) -> str | None:
    """Parent tier label of a sub-tier; None for tiers and totals."""
    for t in _tiers(scheme):
        if t.label == label:
            return t.parent
    raise KeyError(label)


def children_of(label: str, scheme: SchemeLike) -> list[str]:
    """Sub-tier labels whose parent is ``label`` (empty for leaves and totals)."""
    tiers = _tiers(scheme)
    if label not in {t.label for t in tiers}:
        raise KeyError(label)
    return [t.label for t in tiers if t.parent == label]


def leaf_labels(scheme: SchemeLike) -> list[str]:
    """Finest non-overlapping price buckets: tiers/sub-tiers that are not a parent.

    V1: Tablet $800+, Tablet $400-$800, Tablet $400-, Handheld $75+, Handheld $75-.
    V2: Tablet $800+, Tablet $400-$800, Tablet $300-$400, Tablet $200-$300,
        Tablet $200-, Handheld $100+, Handheld $65-$100, Handheld $35-$65, Handheld $35-.
    """
    tiers = _tiers(scheme)
    parents = {t.parent for t in tiers if t.parent is not None}
    return [t.label for t in tiers if t.kind in ("tier", "subtier") and t.label not in parents]


def categorized_share_basis(month: str | int | None, scheme: str = "auto") -> bool:
    """True when summary.xlsx share columns divide by the "Total" category.

    V1 (published months): "Qty by %" / "Revenue by %" divide by the tag's
    whole frame, listings outside every category (type OBD1) included. V2+:
    they divide by the tag's own "Total"-category sums for that frame (current
    month, LM, LY each their own), so the "Total" row reads exactly 100% and
    the other rows are shares of the categorized market.
    """
    return resolve_scheme_name(month, scheme) != "v1"
