from __future__ import annotations

from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from price_tier_scheme import LEGACY_LABELS, SCHEMES, resolve_scheme_name


ROOT = Path(__file__).resolve().parents[2]

SOURCE_TEMPLATE = ROOT / "_template" / "Amazon Competitor Analysis _TEMPLATE.xlsx"
STAGING_TEMPLATE = ROOT / "_template" / "Amazon Competitor Analysis _8BRAND_STAGING_TEMPLATE.xlsx"
DEFAULT_RAW_SUMMARY = ROOT / "script output reports" / "summary.xlsx"
DEFAULT_RAW_REPORT = ROOT / "script output reports" / "Amazon Competitor Report.xlsx"

FIXED_BRANDS = [
    ("Ancel", "ancel"),
    ("AUTEL", "autel"),
    ("Foxwell", "foxwell"),
    ("iCarsoft", "icarsoft"),
    ("LAUNCH", "launch"),
    ("TOPDON", "topdon"),
    ("Thinkcar", "thinkcar"),
    ("XTOOL", "xtool"),
]

ZERO_SENTINELS = {0, 0.0, None, ""}

# Category tab name for each family total; tier and sub-tier tabs are named
# after their scheme label verbatim (e.g. "Tablet $300-$400").
TOTAL_CATEGORY_TABS = {
    "Total Tablet": "Tablet Total",
    "Total Handheld": "Handheld Total",
    "Total Dongle": "Dongle",
    "Total Other Tools": "Other Tools",
}

SUMMARY_FIRST_ROW = 4  # first category row of the Summary table (row 3 = headers)


@dataclass(frozen=True)
class SchemeLayout:
    """Analysis-workbook layout derived from one price-tier scheme.

    Every structural table the filler and the validator need (tab order,
    category tabs, parent sections, child links, Summary rows, brand-tab
    category rows) is derived from ``price_tier_scheme`` so a scheme change
    never needs a hand-maintained list here.

    Tab order per family: "<Family> Total" first, then its tiers and
    sub-tiers in scheme order. A family-total tab carries one section per
    tier; a tier with sub-tiers carries one section per sub-tier. Every tier
    links to its family-total section, every sub-tier to its parent tier's.
    """

    name: str
    summary_labels: tuple[str, ...]  # Summary category rows, scheme order
    subtier_labels: tuple[str, ...]
    category_order: tuple[str, ...]  # brand-tab overview rows (sub-tiers excluded)
    category_tabs: dict[str, str]  # tab -> category label, in tab order
    listing_source_sheets: dict[str, str]  # tab -> raw summary sheet
    parent_sections: dict[str, tuple[str, ...]]  # tab -> section titles, in order
    child_section_links: dict[str, tuple[str, str]]  # child tab -> (parent tab, section title)
    total_tabs: frozenset[str]
    visible_sheets: tuple[str, ...]

    @property
    def summary_last_row(self) -> int:
        return SUMMARY_FIRST_ROW + len(self.summary_labels) - 1

    @property
    def is_legacy(self) -> bool:
        """Scheme V1 (published months before 202610): keep the template's
        positional Summary styling, the template's child-tab A3 cells and the
        historical staging-sheet names, so V1 rebuilds stay byte-identical."""
        return self.name == "v1"


def category_tab_name(label: str) -> str:
    return TOTAL_CATEGORY_TABS.get(label, label)


@lru_cache(maxsize=None)
def layout_for(scheme_name: str) -> SchemeLayout:
    tiers = SCHEMES[scheme_name]
    category_tabs: dict[str, str] = {}
    parent_sections: dict[str, tuple[str, ...]] = {}
    child_links: dict[str, tuple[str, str]] = {}
    total_tabs: set[str] = set()
    pending = []
    for tier in tiers:
        if tier.kind in ("tier", "subtier"):
            pending.append(tier)
            continue
        if tier.kind != "total":
            continue  # the grand "Total" has no tab
        total_tab = category_tab_name(tier.label)
        total_tabs.add(total_tab)
        category_tabs[total_tab] = tier.label
        family_tiers = tuple(t.label for t in pending if t.kind == "tier")
        if family_tiers:
            parent_sections[total_tab] = family_tiers
        for t in pending:
            category_tabs[t.label] = t.label
            if t.kind == "tier":
                child_links[t.label] = (total_tab, t.label)
            else:
                parent_tab = category_tab_name(t.parent)
                child_links[t.label] = (parent_tab, t.label)
                parent_sections[parent_tab] = parent_sections.get(parent_tab, ()) + (t.label,)
        pending = []
    return SchemeLayout(
        name=scheme_name,
        summary_labels=tuple(t.label for t in tiers),
        subtier_labels=tuple(t.label for t in tiers if t.kind == "subtier"),
        category_order=tuple(t.label for t in tiers if t.kind != "subtier"),
        category_tabs=category_tabs,
        listing_source_sheets=dict(category_tabs),
        parent_sections=parent_sections,
        child_section_links=child_links,
        total_tabs=frozenset(total_tabs),
        visible_sheets=("Summary", "Top 50", *category_tabs, *(display for display, _ in FIXED_BRANDS)),
    )


def layout_for_month(month: str | int | None, tier_scheme: str = "auto") -> SchemeLayout:
    """Layout for a report month (YYYYMM); ``tier_scheme`` 'v1'/'v2' forces one."""
    return layout_for(resolve_scheme_name(month, tier_scheme))


# Tier/sub-tier labels of every scheme, plus the superseded V2 wording
# ("Tablet $300+") so a template built with it is recognised (and renamed).
KNOWN_TIER_LABELS = frozenset(
    t.label for tiers in SCHEMES.values() for t in tiers if t.kind in ("tier", "subtier")
) | frozenset(LEGACY_LABELS)

# Scheme V1 (report months before 202610) - kept as module constants for
# existing callers (setup_staging, tests). Derived, so they cannot drift.
_V1 = layout_for("v1")
VISIBLE_SHEETS = list(_V1.visible_sheets)
CATEGORY_ORDER = list(_V1.category_order)
CATEGORY_TABS = dict(_V1.category_tabs)
LISTING_SOURCE_SHEETS = dict(_V1.listing_source_sheets)


def slug(value: str) -> str:
    out = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in {" ", "$", "+", "-", "|", "/"}:
            out.append("_")
    return "_".join("".join(out).split("_")).strip("_")
