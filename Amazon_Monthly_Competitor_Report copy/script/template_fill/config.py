from __future__ import annotations

from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]

SOURCE_TEMPLATE = ROOT / "_template" / "Amazon Competitor Analysis _TEMPLATE.xlsx"
STAGING_TEMPLATE = ROOT / "_template" / "Amazon Competitor Analysis _8BRAND_STAGING_TEMPLATE.xlsx"
DEFAULT_RAW_SUMMARY = ROOT / "script output reports" / "summary.xlsx"
DEFAULT_RAW_REPORT = ROOT / "script output reports" / "Amazon Competitor Report.xlsx"

VISIBLE_SHEETS = [
    "Summary",
    "Top 50",
    "Tablet Total",
    "Tablet $800+",
    "Tablet $400-$800",
    "Tablet $400-",
    "Handheld Total",
    "Handheld $75+",
    "Handheld $75-",
    "Dongle",
    "Other Tools",
    "Ancel",
    "AUTEL",
    "Foxwell",
    "iCarsoft",
    "LAUNCH",
    "TOPDON",
    "Thinkcar",
    "XTOOL",
]

CATEGORY_ORDER = [
    "Tablet $800+",
    "Tablet $400-$800",
    "Tablet $400-",
    "Total Tablet",
    "Handheld $75+",
    "Handheld $75-",
    "Total Handheld",
    "Total Dongle",
    "Total Other Tools",
    "Total",
]

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

CATEGORY_TABS = {
    "Tablet Total": "Total Tablet",
    "Tablet $800+": "Tablet $800+",
    "Tablet $400-$800": "Tablet $400-$800",
    "Tablet $400-": "Tablet $400-",
    "Handheld Total": "Total Handheld",
    "Handheld $75+": "Handheld $75+",
    "Handheld $75-": "Handheld $75-",
    "Dongle": "Total Dongle",
    "Other Tools": "Total Other Tools",
}

PARENT_CATEGORY_TABS = {"Tablet Total", "Handheld Total", "Dongle", "Other Tools"}

LISTING_SOURCE_SHEETS = {
    "Tablet Total": "Total Tablet",
    "Tablet $800+": "Tablet $800+",
    "Tablet $400-$800": "Tablet $400-$800",
    "Tablet $400-": "Tablet $400-",
    "Handheld Total": "Total Handheld",
    "Handheld $75+": "Handheld $75+",
    "Handheld $75-": "Handheld $75-",
    "Dongle": "Total Dongle",
    "Other Tools": "Total Other Tools",
}

ZERO_SENTINELS = {0, 0.0, None, ""}


def slug(value: str) -> str:
    out = []
    for ch in value.lower():
        if ch.isalnum():
            out.append(ch)
        elif ch in {" ", "$", "+", "-", "|", "/"}:
            out.append("_")
    return "_".join("".join(out).split("_")).strip("_")

