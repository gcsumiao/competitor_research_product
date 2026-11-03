from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
import math
import re
from typing import Iterable

from openpyxl import load_workbook

from .config import CATEGORY_ORDER, FIXED_BRANDS


Row = list[object]
ASIN_PATTERN = re.compile(r"^[A-Z0-9]{10}$")


SUMMARY_HEADERS = [
    "Brand",
    "Category",
    "Avg Price",
    "Avg Price MoM",
    "Avg Price YoY",
    "Quantity/Mo",
    "Qty by %",
    "Qty MoM",
    "Qty YoY",
    "Revenue/Mo",
    "Revenue by %",
    "Revenue MoM",
    "Revenue YoY",
]

LISTING_HEADERS = [
    "ASIN",
    "Title",
    "Brand",
    "Type",
    "Price",
    "Monthly Revenue",
    "Monthly Sales",
    "Review Count",
    "Reviews Rating",
    "URL",
]

BRAND_LISTING_HEADERS = [
    "Title",
    "ASIN",
    "Type",
    "Price",
    "12mo Revenue",
    "Monthly Revenue",
    "12mo Units",
    "Monthly Sales",
    "Review Count",
    "Reviews Rating",
    "URL",
]

REPORT_SUMMARY_HEADERS = [
    "Brand",
    "# of Listings",
    "Monthly Revenue",
    "12mo Revenue",
    "Monthly Sales",
    "Market Rev Share %",
    "Price Per Unit",
    "Review Count",
    "Ave Rating",
]


@dataclass
class RawData:
    summary_sheets: dict[str, list[Row]]
    report_sheets: dict[str, list[Row]]

    @classmethod
    def load(cls, raw_summary: Path, raw_report: Path) -> "RawData":
        return cls(_read_workbook(raw_summary), _read_workbook(raw_report))

    def sheet1_by_brand(self, brand: str, include_zero: bool = False) -> list[Row]:
        rows = self.summary_sheets["Sheet1"][1:]
        return [
            _trim(r)
            for r in rows
            if _norm(r[0]) == _norm(brand) and (include_zero or not is_zero_row(r))
        ]

    def sheet1_categories_for_brand(self, brand: str, categories: list[str]) -> list[Row]:
        by_category = {str(row[1] or "").strip().lower(): row for row in self.sheet1_by_brand(brand)}
        rows = []
        for category in categories:
            row = by_category.get(category.lower())
            if row is None:
                raise ValueError(f"Missing {brand} summary row for category: {category}")
            rows.append(row)
        return rows

    def summary_sheet_rows(self, sheet_name: str, row_numbers: list[int]) -> list[Row]:
        sheet = self.summary_sheets[sheet_name]
        rows: list[Row] = []
        for row_number in row_numbers:
            if row_number < 1 or row_number > len(sheet):
                raise ValueError(f"{sheet_name} row {row_number} is outside the source sheet")
            rows.append(_trim(sheet[row_number - 1]))
        return rows

    def category_rows(self, category: str) -> list[Row]:
        rows = self.summary_sheets["Category"][1:]
        return [_trim(r) for r in rows if _norm(r[0]) == _norm(category) and not is_zero_row(r)]

    def total_category_labels(self) -> list[str]:
        """Sheet1 'Total' category labels in raw order, zero rows included -
        the price-tier scheme the raw summary was built with."""
        return [str(row[1] or "").strip() for row in self.sheet1_by_brand("Total", include_zero=True)]

    def summary_total_for_category(self, category: str, include_zero: bool = False) -> Row | None:
        for row in self.sheet1_by_brand("Total", include_zero=include_zero):
            if _norm(row[1]) == _norm(category):
                return row
        return None

    def report_summary_blocks(self) -> tuple[list[Row], list[Row]]:
        return split_report_summary_dual(self.report_sheets["Summary"])

    def report_dual_blocks(self, sheet_name: str) -> tuple[list[Row], list[Row]]:
        revenue, units = split_rank_dual_block(self.report_sheets[sheet_name])
        if _norm(sheet_name) == "top 50":
            return normalize_listing_rows(revenue, 0, 9), normalize_listing_rows(units, 0, 9)
        return normalize_listing_rows(revenue, 1, 10), normalize_listing_rows(units, 1, 10)

    def summary_dual_listing_blocks(self, sheet_name: str) -> tuple[list[Row], list[Row]]:
        revenue, units = split_repeated_header_blocks(self.summary_sheets[sheet_name])
        return normalize_listing_rows(revenue, 0, 9), normalize_listing_rows(units, 0, 9)

    def require_fixed_brands(self) -> None:
        missing = [display for display, key in FIXED_BRANDS if key not in self.report_sheets]
        if missing:
            raise ValueError(f"Fixed brand sheets missing in raw report: {', '.join(missing)}")


def _read_workbook(path: Path) -> dict[str, list[Row]]:
    wb = load_workbook(path, data_only=True, read_only=False)
    try:
        out: dict[str, list[Row]] = {}
        for ws in wb.worksheets:
            out[ws.title] = [
                [_clean(ws.cell(r, c).value) for c in range(1, ws.max_column + 1)]
                for r in range(1, ws.max_row + 1)
            ]
        return out
    finally:
        wb.close()


def _clean(value: object) -> object:
    if isinstance(value, float) and (math.isinf(value) or math.isnan(value)):
        return None
    if isinstance(value, str) and value.strip().lower() in {"inf", "+inf", "-inf", "na", "n/a", "#n/a"}:
        return None
    return value


def _trim(row: Iterable[object]) -> Row:
    values = list(row)
    while values and values[-1] in (None, ""):
        values.pop()
    return values


def canonical_product_url(asin: object) -> str | None:
    normalized = str(asin or "").strip().upper()
    if not ASIN_PATTERN.match(normalized):
        return None
    return f"https://amazon.com/dp/{normalized}"


def normalize_listing_rows(rows: list[Row], asin_idx: int, url_idx: int) -> list[Row]:
    normalized_rows: list[Row] = []
    for row in rows:
        values = _trim(row)
        if len(values) <= asin_idx:
            normalized_rows.append(values)
            continue
        url = canonical_product_url(values[asin_idx])
        if url:
            while len(values) <= url_idx:
                values.append(None)
            values[url_idx] = url
        normalized_rows.append(values)
    return normalized_rows


def _norm(value: object) -> str:
    return str(value or "").strip().lower()


def is_zero_row(row: Row) -> bool:
    if len(row) > 9:
        qty = row[5]
        rev = row[9]
        if _is_zeroish(qty) and _is_zeroish(rev):
            return True
    metrics = row[2:] if len(row) > 2 else row
    seen_number = False
    for val in metrics:
        if isinstance(val, (int, float)):
            seen_number = True
            if val != 0:
                return False
        elif val not in (None, ""):
                return False
    return seen_number


def _is_zeroish(value: object) -> bool:
    return value in (None, "", 0, 0.0)


def split_rank_dual_block(rows: list[Row]) -> tuple[list[Row], list[Row]]:
    rev_title_idx = None
    unit_title_idx = None
    for idx, row in enumerate(rows):
        marker = row[0] if row else None
        if not isinstance(marker, str):
            continue
        lower = marker.lower()
        if rev_title_idx is None and "rank" in lower and ("revenue" in lower or "rev" in lower):
            rev_title_idx = idx
        elif unit_title_idx is None and "rank" in lower and "unit" in lower:
            unit_title_idx = idx
    if rev_title_idx is None:
        rev_title_idx = 0
    rev_start = rev_title_idx + 2
    rev_end = unit_title_idx if unit_title_idx is not None else len(rows)
    rev = [_trim(r) for r in rows[rev_start:rev_end] if _is_listing_row(r)]
    units: list[Row] = []
    if unit_title_idx is not None:
        units = [_trim(r) for r in rows[unit_title_idx + 2 :] if _is_listing_row(r)]
    return rev, units


def _is_listing_row(row: Row) -> bool:
    if not row or row[0] in (None, ""):
        return False
    return str(row[0]).strip().lower() != "total"


def split_report_summary_dual(rows: list[Row]) -> tuple[list[Row], list[Row]]:
    revenue: list[Row] = []
    units: list[Row] = []
    target = revenue
    for idx, row in enumerate(rows):
        first = row[0] if row else None
        if isinstance(first, str) and "summary - units" in first.lower():
            target = units
            continue
        if not row or first in (None, "", "Brand", "Total"):
            continue
        if idx == 0:
            continue
        target.append(_trim(row[:9]))
    return revenue, units


def split_repeated_header_blocks(rows: list[Row]) -> tuple[list[Row], list[Row]]:
    header_idxs = [
        idx
        for idx, row in enumerate(rows)
        if row and str(row[0]).strip().upper() == "ASIN"
    ]
    if not header_idxs:
        data = [_trim(r) for r in rows[1:] if r and r[0] not in (None, "")]
        return data, []
    blocks: list[list[Row]] = []
    for pos, header_idx in enumerate(header_idxs[:2]):
        end = header_idxs[pos + 1] if pos + 1 < len(header_idxs) else len(rows)
        block = []
        for row in rows[header_idx + 1 : end]:
            if row and row[0] not in (None, ""):
                block.append(_trim(row[:10]))
        blocks.append(block)
    return blocks[0], blocks[1] if len(blocks) > 1 else []


def aggregate_top50_overview(top50_rows: list[Row]) -> list[Row]:
    by_cat = {row[1]: row for row in top50_rows}

    def aggregate(label: str, cats: list[str]) -> Row:
        rows = [by_cat[c] for c in cats if c in by_cat]
        qty = sum(v for r in rows if isinstance((v := r[5]), (int, float)))
        rev = sum(v for r in rows if isinstance((v := r[9]), (int, float)))
        avg_price = rev / qty if qty else None
        return [label, avg_price, None, None, qty, None, None, None, rev, None, None, None]

    def from_raw(label: str, cat: str) -> Row:
        row = by_cat.get(cat)
        if not row:
            return [label] + [None] * 11
        return [label, row[2], row[3], row[4], row[5], row[6], row[7], row[8], row[9], row[10], row[11], row[12]]

    return [
        aggregate("Tablets", ["Tablet $800+", "Tablet $400-$800", "Tablet $400-"]),
        aggregate("Handheld", ["Handheld $75+", "Handheld $75-"]),
        from_raw("Dongle", "Total Dongle"),
        from_raw("Other Tools", "Total Other Tools"),
        from_raw("Total", "Total"),
    ]


def ordered_brand_summary(rows: list[Row], category_order: Iterable[str] | None = None) -> list[Row]:
    """Brand overview rows in category order. ``category_order`` is the
    active scheme's parent-level labels (sub-tiers excluded); default V1."""
    by_cat = {row[1]: row for row in rows}
    order = CATEGORY_ORDER if category_order is None else list(category_order)
    return [by_cat[c] for c in order if c in by_cat]
