from __future__ import annotations

import shutil
from copy import copy
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import ZIP_DEFLATED, ZipFile

from openpyxl import load_workbook
from openpyxl.formatting.rule import CellIsRule
from openpyxl.styles import Alignment, Font
from openpyxl.utils import quote_sheetname
from openpyxl.styles import PatternFill
from openpyxl.styles.colors import Color

from .config import (
    DEFAULT_RAW_REPORT,
    DEFAULT_RAW_SUMMARY,
    FIXED_BRANDS,
    ROOT,
    STAGING_TEMPLATE,
    SUMMARY_FIRST_ROW,
    SchemeLayout,
    layout_for_month,
    slug,
)
from .formula_map import hyperlink_formula, sorted_tables, table_bounds
from .month_labels import replace_month_labels
from .raw_loader import (
    BRAND_LISTING_HEADERS,
    LISTING_HEADERS,
    REPORT_SUMMARY_HEADERS,
    SUMMARY_HEADERS,
    RawData,
    ordered_brand_summary,
)
from .scheme_upgrade import (
    SUMMARY_WIDTH,
    UpgradeReport,
    apply_summary_chart_plan,
    fit_overview_chart_refs,
    summary_row_kind,
    upgrade_template,
)
from .stg_writer import ensure_sheet, write_staging_block
from .validate import validate_output_file, validate_workbook
from brand_headers import refresh_brand_headers
from month_context import MonthContext, infer_month_context, month_context_from_labels, validate_month_headers
from xlsx_rowshift import shift_row_artifacts


TOP50_OVERVIEW_CATEGORIES = ["Total Tablet", "Total Handheld", "Total Dongle", "Total Other Tools", "Total"]

# Parent sections, child links, category tabs and the tab order come from the
# price-tier scheme of the report month (config.layout_for_month). Sections
# are pulled from the raw summary "Category" sheet by section name (zero rows
# dropped) - absolute row numbers drift month to month and caused the
# Tablet/Handheld Total misalignment.

# Summary rows below the category table sit at fixed offsets from its last
# row (row 13 in a 10-row V1 table): brand Revenue block 47-71, Units 78-102.
SUMMARY_V1_LAST_ROW = 13

OWN_BRAND_COLORS = {
    "blcktec": "FF0000FF",
    "blacktec": "FF0000FF",
    "innova": "FFFF0000",
}

DEFAULT_TEXT_COLOR = "FF000000"
NEGATIVE_TEXT_COLOR = "FFFF0000"
NO_FILL = PatternFill(fill_type=None)
# Canonical fills, matching the hand-formatted reports (Excel's standard
# 5% / 25% background tints of the theme background color).
TOTAL_FILL_RGB = "FFB5A7D7"  # grand-total purple
SUBTOTAL_TINT = -0.249977111117893  # "Total Tablet/Handheld/..." gray
BAND_GRAY_TINT = -4.9989318521683403e-2  # alternating row light gray
# Per-column number formats for the overview blocks (brand tabs and category
# tabs share the same layout). Column K (11) is hidden and varies; skip it.
OVERVIEW_NUMBER_FORMATS = {
    2: '"$"#,##0.00',  # Avg Price
    3: "0%",  # Avg Price MoM
    4: "0%",  # Avg Price YoY
    5: '_(* #,##0_);_(* \\(#,##0\\);_(* "-"??_);_(@_)',  # Quantity/Mo
    6: "0%",  # Qty by %
    7: "0%",  # Qty MoM
    8: "0%",  # Qty YoY
    9: '"$"#,##0',  # Revenue/Mo
    10: "0%",  # Revenue by %
    12: "0%",  # Revenue MoM
    13: "0%",  # Revenue YoY
}
CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DRAWING_NS = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"


def build_monthly_output(
    month_label: str | None,
    month_name: str | None,
    date_tag: str,
    template: Path = STAGING_TEMPLATE,
    raw_summary: Path = DEFAULT_RAW_SUMMARY,
    raw_report: Path = DEFAULT_RAW_REPORT,
    out_dir: Path | None = None,
    brand_header_dir: Path | None = None,
    month: str | None = None,
    tier_scheme: str = "auto",
) -> Path:
    """Fill ``template`` (last month's Analysis workbook) for the raw month.

    ``month`` (YYYYMM) picks the price-tier scheme (V2 from 202610); when None
    it is inferred from the raw report title. ``tier_scheme`` 'v1'/'v2' forces
    a scheme (previews of older months). The template is upgraded in place to
    the scheme's layout first (see scheme_upgrade.upgrade_template).
    """
    context = _resolve_month_context(raw_report, month_label, month_name)
    month_key = _resolve_month_key(month, context)
    layout = layout_for_month(month_key, tier_scheme)
    raw = RawData.load(raw_summary, raw_report)
    raw.require_fixed_brands()
    _require_raw_scheme(raw, layout, raw_summary)

    if out_dir is None:
        out_dir = template.parents[1] / context.output_folder_name
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / context.analysis_output_name(date_tag)
    shutil.copy2(template, out_path)

    wb = load_workbook(out_path)
    try:
        upgrade = upgrade_template(wb, layout)
        for line in upgrade.describe():
            print(f"[template-upgrade] {line}")
        _prepare_visible_sheets(wb, layout)
        _write_staging(wb, raw, layout)
        _write_visible_values(wb, raw, layout, upgrade)
        replace_month_labels(wb, context.short_label, context.month_name)
        refresh_brand_headers(
            wb,
            [display for display, _ in FIXED_BRANDS],
            brand_header_dir or ROOT / "script" / "brand_header_assets" / "analysis",
        )
        _sanitize_error_tokens(wb)
        _apply_negative_number_formatting(wb)
        _set_chart_frames_rectangular(wb)
        wb.calculation.fullCalcOnLoad = True
        wb.calculation.forceFullCalc = True
        issues = validate_workbook(wb, month=month_key, tier_scheme=layout.name)
        validate_month_headers(wb, context, issues)
        if issues:
            raise ValueError("Validation failed:\n- " + "\n- ".join(issues))
        wb.save(out_path)
        _patch_package_xml(out_path)
        file_issues = validate_output_file(out_path)
        if file_issues:
            raise ValueError("Output file validation failed:\n- " + "\n- ".join(file_issues))
    finally:
        wb.close()
    return out_path


def _resolve_month_context(raw_report: Path, month_label: str | None, month_name: str | None) -> MonthContext:
    if month_label and month_name:
        return month_context_from_labels(month_label, month_name)
    if month_label or month_name:
        raise ValueError("--month-label and --month-name must be provided together")
    return infer_month_context(raw_report)


def _resolve_month_key(month: str | None, context: MonthContext) -> str:
    """YYYYMM of the report: ``month`` when given (must match the raw month),
    else the month of the raw report / labels."""
    inferred = f"{context.year}{context.month:02d}"
    if month is None:
        return inferred
    text = str(month).strip()
    if not (len(text) == 6 and text.isdigit()):
        raise ValueError(f"month must be YYYYMM, got {month!r}")
    if text != inferred:
        raise ValueError(f"month {text} does not match the raw report month {inferred}")
    return text


def _require_raw_scheme(raw: RawData, layout: SchemeLayout, raw_summary: Path) -> None:
    labels = raw.total_category_labels()
    expected = list(layout.summary_labels)
    if labels != expected:
        raise ValueError(
            f"Raw summary {raw_summary} was not built with price-tier scheme {layout.name}: "
            f"expected categories {expected}, got {labels}. Rebuild it with full_report_month.py "
            "(same --tier-scheme) or pass the matching --tier-scheme to the filler."
        )


def _month_number(month_name: str) -> int:
    months = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ]
    return months.index(month_name) + 1


def _prepare_visible_sheets(wb, layout: SchemeLayout) -> None:
    visible_sheets = list(layout.visible_sheets)
    for ws in wb.worksheets:
        ws.sheet_state = "visible" if ws.title in visible_sheets else "hidden"
    ordered = [wb[title] for title in visible_sheets]
    for sheet in ordered:
        wb._sheets.remove(sheet)
    for idx, sheet in enumerate(ordered):
        wb._sheets.insert(idx, sheet)


def _write_staging(wb, raw: RawData, layout: SchemeLayout) -> None:
    for sheet_name in list(wb.sheetnames):
        if sheet_name.startswith("_stg_"):
            del wb[sheet_name]

    blocks: dict[str, tuple[list[str], list[list[object]]]] = {}
    blocks["_stg_summary_total"] = (SUMMARY_HEADERS, raw.sheet1_by_brand("Total"))
    rev, units = raw.report_summary_blocks()
    blocks["_stg_report_summary_revenue"] = (REPORT_SUMMARY_HEADERS, rev)
    blocks["_stg_report_summary_units"] = (REPORT_SUMMARY_HEADERS, units)

    top50_rows = raw.sheet1_categories_for_brand("Top 50", TOP50_OVERVIEW_CATEGORIES)
    blocks["_stg_top50_overview"] = (SUMMARY_HEADERS, top50_rows)
    top_rev, top_units = raw.report_dual_blocks("Top 50")
    blocks["_stg_top50_revenue"] = (LISTING_HEADERS, top_rev)
    blocks["_stg_top50_units"] = (LISTING_HEADERS, top_units)

    stage_names = _stage_names(list(layout.category_tabs), legacy=layout.is_legacy)
    for tab, category in layout.category_tabs.items():
        name = stage_names[tab]
        overview = raw.category_rows(category)
        total = raw.summary_total_for_category(category)
        if total:
            overview = overview + [total]
        blocks[f"_stg_c_{name}_ov"] = (SUMMARY_HEADERS, overview)
        src = layout.listing_source_sheets[tab]
        rev_rows, unit_rows = raw.summary_dual_listing_blocks(src)
        blocks[f"_stg_c_{name}_rev"] = (LISTING_HEADERS, rev_rows)
        blocks[f"_stg_c_{name}_unit"] = (LISTING_HEADERS, unit_rows)

    for display, key in FIXED_BRANDS:
        name = _short_stage_slug(display)
        blocks[f"_stg_b_{name}_sum"] = (
            SUMMARY_HEADERS,
            ordered_brand_summary(raw.sheet1_by_brand(key), layout.category_order),
        )
        rev_rows, unit_rows = raw.report_dual_blocks(key)
        blocks[f"_stg_b_{name}_rev"] = (BRAND_LISTING_HEADERS, rev_rows)
        blocks[f"_stg_b_{name}_unit"] = (BRAND_LISTING_HEADERS, unit_rows)

    for sheet_name, (headers, rows) in blocks.items():
        write_staging_block(ensure_sheet(wb, sheet_name), headers, rows)


def _write_visible_values(wb, raw: RawData, layout: SchemeLayout, upgrade: UpgradeReport) -> None:
    _write_summary(wb["Summary"], raw, layout, upgrade)
    _write_top50(wb["Top 50"], raw)
    for tab, category in layout.category_tabs.items():
        _write_category_tab(wb[tab], raw, tab, category, layout)
    _write_parent_section_summary_total_links(wb, layout)
    _write_child_category_links(wb, layout, upgrade)
    for display, key in FIXED_BRANDS:
        _write_brand_tab(wb[display], raw, display, key, layout)


def _write_summary(ws, raw: RawData, layout: SchemeLayout, upgrade: UpgradeReport) -> None:
    last_row = layout.summary_last_row
    offset = last_row - SUMMARY_V1_LAST_ROW
    _write_summary_overview(ws, SUMMARY_FIRST_ROW, last_row, raw.sheet1_by_brand("Total"), summary_sheet=True)
    if not layout.is_legacy or upgrade.summary_resized:
        _format_summary_category_rows(ws, layout, upgrade.summary_styles)
        apply_summary_chart_plan(ws, layout, upgrade.summary_chart_plan)
    rev, units = raw.report_summary_blocks()
    _write_simple_block(ws, 47 + offset, 71 + offset, rev, width=9)
    _write_simple_block(ws, 78 + offset, 102 + offset, units, width=9)
    _mark_summary_owned_brand_rows(ws, 47 + offset, 71 + offset)
    _mark_summary_owned_brand_rows(ws, 78 + offset, 102 + offset)


def _format_summary_category_rows(ws, layout: SchemeLayout, styles: dict[str, list]) -> None:
    """Label-driven Summary table styling (V2+, or any resized table): tier and
    sub-tier rows unfilled and regular weight, sub-tier labels indented one
    level (label text unchanged), family subtotals bold on the gray subtotal
    fill, grand Total bold purple. V2: "Total Dongle" stays bold but has NO
    fill (analyst decision 2026-11-03); "Total Other Tools" keeps the gray."""
    for row_idx in range(SUMMARY_FIRST_ROW, layout.summary_last_row + 1):
        label = str(ws.cell(row_idx, 1).value or "").strip()
        kind = summary_row_kind(label, layout.subtier_labels)
        base = styles["tier" if kind == "subtier" else kind]
        for col in range(1, SUMMARY_WIDTH + 1):
            ws.cell(row_idx, col)._style = copy(base[col - 1])
        if kind == "grand":
            fill, bold = _overview_total_fill(), True
        elif kind == "subtotal":
            unshaded = label.lower() == "total dongle" and not layout.is_legacy
            fill, bold = (NO_FILL if unshaded else _overview_subtotal_fill()), True
        else:
            fill, bold = NO_FILL, False
        _set_row_fill(ws, row_idx, fill, max_col=SUMMARY_WIDTH, bold=bold)
        label_cell = ws.cell(row_idx, 1)
        current = label_cell.alignment
        label_cell.alignment = Alignment(
            horizontal="left",
            vertical=current.vertical,
            wrap_text=current.wrap_text,
            indent=1 if kind == "subtier" else 0,
        )


def _write_top50(ws, raw: RawData) -> None:
    rows = raw.sheet1_categories_for_brand("Top 50", TOP50_OVERVIEW_CATEGORIES)
    _write_summary_overview(ws, 4, 8, rows, summary_sheet=False)
    rev, units = raw.report_dual_blocks("Top 50")
    tables = sorted_tables(ws)
    _write_listing_table(ws, tables[0], rev, style="market")
    _write_listing_table(ws, tables[1], units, style="market")
    for table in sorted_tables(ws)[:2]:
        _mark_top50_owned_brand_rows(ws, table)


def _write_category_tab(ws, raw: RawData, tab: str, category: str, layout: SchemeLayout) -> None:
    rows = raw.category_rows(category)
    total = raw.summary_total_for_category(category)
    if total:
        rows = rows + [total]
    overview_start = 5
    overview_end = _find_last_metric_row(ws, overview_start)
    rows = _fit_category_overview_rows(category, rows, overview_end - overview_start + 1)
    _write_summary_overview(ws, overview_start, overview_end, rows, summary_sheet=False)
    _format_category_overview(ws, overview_start, overview_end, len(rows), has_total=bool(total))
    if tab in layout.total_tabs:
        _set_overview_total_share_to_100(ws, overview_start, overview_end)
    rev, units = raw.summary_dual_listing_blocks(layout.listing_source_sheets[tab])
    tables = sorted_tables(ws)
    _write_listing_table(ws, tables[0], rev, style="market")
    _write_listing_table(ws, tables[1], units, style="market")
    if tab in layout.parent_sections:
        _write_parent_category_sections(ws, raw, tab, layout)


def _overview_total_fill() -> PatternFill:
    return PatternFill("solid", fgColor=TOTAL_FILL_RGB)


def _overview_subtotal_fill() -> PatternFill:
    return PatternFill("solid", fgColor=Color(theme=0, tint=SUBTOTAL_TINT))


def _band_white_fill() -> PatternFill:
    return PatternFill("solid", fgColor=Color(theme=0, tint=0.0))


def _band_gray_fill() -> PatternFill:
    return PatternFill("solid", fgColor=Color(theme=0, tint=BAND_GRAY_TINT))


def _set_row_fill(
    ws,
    row_idx: int,
    fill: PatternFill,
    max_col: int = 13,
    bold: bool | None = None,
    skip_cols: set[int] | None = None,
) -> None:
    for col in range(1, max_col + 1):
        if skip_cols and col in skip_cols:
            continue
        cell = ws.cell(row_idx, col)
        cell.fill = copy(fill)
        if bold is not None and bool(cell.font.bold) != bold:
            font = copy(cell.font)
            font.bold = bold
            cell.font = font


def _format_brand_overview(ws, start_row: int, end_row: int) -> None:
    """Label-driven emphasis for the brand overview block. Fills and number
    formats used to be inherited from the template by position, so any month
    where a brand gained or lost a category row shifted every gray/purple
    band (and left the relocated Total row unformatted)."""
    for row_idx in range(start_row, end_row + 1):
        label = str(ws.cell(row_idx, 1).value or "").strip().lower()
        if not label:
            _set_row_fill(ws, row_idx, NO_FILL)
            continue
        if label == "total":
            _set_row_fill(ws, row_idx, _overview_total_fill(), bold=True)
        elif label.startswith("total"):
            _set_row_fill(ws, row_idx, _overview_subtotal_fill(), bold=True)
        else:
            _set_row_fill(ws, row_idx, NO_FILL, bold=False)
        _apply_overview_number_formats(ws, row_idx)


def _apply_overview_number_formats(ws, row_idx: int) -> None:
    """Column number formats plus the standard alignment: labels left, value
    columns on default horizontal (numbers right-align themselves), all
    vertically centered. Relocated Total rows used to keep the stale 'left'
    alignment of the template's blank row."""
    for col, number_format in OVERVIEW_NUMBER_FORMATS.items():
        cell = ws.cell(row_idx, col)
        cell.number_format = number_format
        cell.alignment = Alignment(horizontal=None, vertical="center")
    ws.cell(row_idx, 1).alignment = Alignment(horizontal="left", vertical="center")


def _apply_row_banding(ws, start_row: int, end_row: int, max_col: int = 13, skip_cols: set[int] | None = None) -> None:
    """White / light-gray alternating rows, starting white."""
    for offset, row_idx in enumerate(range(start_row, end_row + 1)):
        fill = _band_white_fill() if offset % 2 == 0 else _band_gray_fill()
        _set_row_fill(ws, row_idx, fill, max_col=max_col, skip_cols=skip_cols)


def _format_category_overview(ws, start_row: int, end_row: int, data_count: int, has_total: bool) -> None:
    """Banded brand rows + purple total for a category overview block; any
    leftover capacity rows are cleared."""
    body_count = data_count - (1 if has_total else 0)
    _apply_row_banding(ws, start_row, start_row + body_count - 1)
    if has_total:
        _set_row_fill(ws, start_row + data_count - 1, _overview_total_fill(), bold=True)
    for row_idx in range(start_row, start_row + data_count):
        _apply_overview_number_formats(ws, row_idx)
    for row_idx in range(start_row + data_count, end_row + 1):
        _set_row_fill(ws, row_idx, NO_FILL)


def _write_brand_tab(ws, raw: RawData, _display: str, key: str, layout: SchemeLayout) -> None:
    # Brand tabs keep the 10-row parent-level table: sub-tiers are excluded.
    rows = ordered_brand_summary(raw.sheet1_by_brand(key), layout.category_order)
    _write_summary_overview(ws, 8, 17, rows, summary_sheet=False)
    _format_brand_overview(ws, 8, 17)
    rev, units = raw.report_dual_blocks(key)
    tables = sorted_tables(ws)
    _write_listing_table(ws, tables[0], rev, style="brand_revenue")
    _normalize_brand_table_gap(ws)
    tables = sorted_tables(ws)
    _write_listing_table(ws, tables[1], units, style="brand_units")
    _refresh_brand_listing_totals(ws)
    _ensure_brand_title_merges(ws)
    _highlight_monthly_columns(ws)


def _highlight_monthly_columns(ws) -> None:
    """The revenue table highlights its "Monthly Rev" column and the units
    table its "Monthly Units" column with the lavender fill on every data
    row. Enforce it instead of inheriting per-cell template fills, which
    drift as rows are added or the template accumulates broken cells."""
    for idx, table in enumerate(sorted_tables(ws)[:2]):
        _min_col, header_row, _max_col, max_row = table_bounds(table)
        wanted = {"monthly rev", "monthly revenue"} if idx == 0 else {"monthly units", "monthly unit sales"}
        col = None
        for c in range(1, 14):
            if str(ws.cell(header_row, c).value or "").strip().lower() in wanted:
                col = c
                break
        if col is None:
            continue
        for row_idx in range(header_row + 1, max_row + 1):
            ws.cell(row_idx, col).fill = PatternFill("solid", fgColor="FFDAD2E9")


def _normalize_brand_table_gap(ws) -> None:
    """Keep exactly [Total row][one blank row][title row] between the two
    brand tables so the units block lands where the hand-formatted reports
    put it, regardless of how the template drifted."""
    tables = sorted_tables(ws)
    if len(tables) < 2:
        return
    _min, _hdr, _max, rev_max_row = table_bounds(tables[0])
    total_row = rev_max_row + 1
    _min2, units_header, _max2, _umax = table_bounds(tables[1])
    title_row = units_header - 1
    if "rank by" not in str(ws.cell(title_row, 1).value or "").strip().lower():
        return
    desired_title_row = total_row + 2
    delta = desired_title_row - title_row
    if delta > 0:
        ws.insert_rows(title_row, delta)
        shift_row_artifacts(ws, title_row, delta)
        _shift_tables(ws, title_row, delta)
    elif delta < 0:
        delete_at = title_row + delta
        for row_idx in range(delete_at, title_row):
            for col in range(1, 13):
                if ws.cell(row_idx, col).value not in (None, ""):
                    return  # unexpected content above the title; leave as-is
        ws.delete_rows(delete_at, -delta)
        shift_row_artifacts(ws, title_row, delta)
        _shift_tables(ws, title_row, delta)


def _ensure_brand_title_merges(ws) -> None:
    for table in sorted_tables(ws)[:2]:
        _min_col, header_row, _max_col, _max_row = table_bounds(table)
        title_row = header_row - 1
        if "rank by" not in str(ws.cell(title_row, 1).value or "").strip().lower():
            continue
        covered = any(
            rng.min_row <= title_row <= rng.max_row and rng.min_col <= 1
            for rng in ws.merged_cells.ranges
        )
        if not covered:
            ws.merge_cells(start_row=title_row, start_column=1, end_row=title_row, end_column=12)


def _find_last_metric_row(ws, start_row: int) -> int:
    row = start_row
    while row <= ws.max_row and ws.cell(row, 1).value not in (None, ""):
        row += 1
    return row - 1


def _write_summary_overview(ws, start_row: int, end_row: int, rows: list[list[object]], summary_sheet: bool) -> None:
    prepared = [_prepare_summary_row(row, summary_sheet=summary_sheet) for row in rows]
    _write_metric_rows(ws, start_row, end_row, prepared, hidden_k=not summary_sheet)


def _fit_category_overview_rows(category: str, rows: list[list[object]], capacity: int) -> list[list[object]]:
    if len(rows) <= capacity:
        return rows
    total = rows[-1] if rows and rows[-1][0] == "Total" else None
    body = rows[:-1] if total else rows
    if capacity < 3:
        raise ValueError(f"Cannot fit category overview for {category}: capacity {capacity}")
    keep_count = capacity - (2 if total else 1)
    kept = body[:keep_count]
    overflow = body[keep_count:]
    other = _aggregate_other_row(category, overflow)
    return kept + [other] + ([total] if total else [])


def _aggregate_other_row(category: str, rows: list[list[object]]) -> list[object]:
    qty = _sum_numeric(rows, 5)
    rev = _sum_numeric(rows, 9)
    qty_share = _sum_numeric(rows, 6)
    rev_share = _sum_numeric(rows, 10)
    avg_price = rev / qty if qty else None
    return [category, "Other", avg_price, None, None, qty, qty_share, None, None, rev, rev_share, None, None]


def _sum_numeric(rows: list[list[object]], idx: int) -> float:
    return sum(row[idx] for row in rows if len(row) > idx and isinstance(row[idx], (int, float)))


def _set_overview_total_share_to_100(ws, start_row: int, end_row: int) -> None:
    for row_idx in range(end_row, start_row - 1, -1):
        label = str(ws.cell(row_idx, 1).value or "").strip().lower()
        if label.startswith("total"):
            ws.cell(row_idx, 6, 1)
            ws.cell(row_idx, 10, 1)
            return


def _write_parent_category_sections(ws, raw: RawData, tab: str, layout: SchemeLayout) -> None:
    for section_title in layout.parent_sections[tab]:
        rows = raw.category_rows(section_title)
        if not rows:
            raise ValueError(f"Raw Category sheet has no non-zero rows for section {section_title!r}")
        _write_parent_section(ws, section_title, rows)


def _write_parent_section_summary_total_links(wb, layout: SchemeLayout, tabs: list[str] | None = None) -> None:
    summary_ws = wb["Summary"]
    for tab, sections in layout.parent_sections.items():
        if tabs is not None and tab not in tabs:
            continue
        ws = wb[tab]
        for section_title in sections:
            summary_row = _find_summary_category_row(summary_ws, section_title, layout.summary_last_row)
            title_row = _find_row_by_label(ws, section_title)
            data_start = title_row + 2
            total_row = _find_section_total_row(ws, title_row)
            _write_parent_section_total_row(
                ws,
                total_row,
                data_start,
                total_row - 1,
                summary_row=summary_row,
            )


def _find_summary_category_row(summary_ws, label: str, last_row: int) -> int:
    target = label.strip().lower()
    for row_idx in range(SUMMARY_FIRST_ROW, last_row + 1):
        value = str(summary_ws.cell(row_idx, 1).value or "").strip().lower()
        if value == target:
            return row_idx
    raise ValueError(f"Summary is missing category row: {label}")


def _write_parent_section(ws, section_title: str, source_rows: list[list[object]]) -> None:
    title_row = _find_row_by_label(ws, section_title)
    header_row = title_row + 1
    data_start = header_row + 1
    total_row = _find_section_total_row(ws, title_row)
    current_body_count = max(total_row - data_start, 0)
    target_body_count = len(source_rows)

    if target_body_count > current_body_count:
        insert_at = total_row
        count = target_body_count - current_body_count
        ws.insert_rows(insert_at, count)
        shift_row_artifacts(ws, insert_at, count)
        _shift_tables(ws, insert_at, count)
        _copy_row_style(ws, insert_at - 1, insert_at, count)
    elif target_body_count < current_body_count:
        delete_at = data_start + target_body_count
        count = current_body_count - target_body_count
        ws.delete_rows(delete_at, count)
        shift_row_artifacts(ws, delete_at + count, -count)
        _shift_tables(ws, delete_at + count, -count)

    total_row = data_start + target_body_count
    for offset, source in enumerate(source_rows):
        _write_prepared_metric_row(ws, data_start + offset, _prepare_summary_row(source, summary_sheet=False))
    _write_parent_section_total_row(ws, total_row, data_start, total_row - 1)
    # Recompute the alternating banding, purple total fill and the column
    # number formats — the template's positional styles go stale whenever
    # row counts or brand order change.
    _apply_row_banding(ws, data_start, total_row - 1)
    _set_row_fill(ws, total_row, _overview_total_fill(), bold=True)
    for row_idx in range(data_start, total_row + 1):
        _apply_overview_number_formats(ws, row_idx)


def _write_parent_section_total_row(
    ws,
    row_idx: int,
    data_start: int,
    data_end: int,
    summary_row: int | None = None,
) -> None:
    for col in range(1, 14):
        ws.cell(row_idx, col).value = None
    # Excel drops quotes around sheet names that don't need them; write
    # =Summary!A4 (not ='Summary'!A4) so re-saved files don't drift.
    summary_name = "Summary"
    if summary_row is None:
        ws.cell(row_idx, 1, "Total")
    else:
        for col in (1, 2, 3, 4, 7, 8):
            col_letter = ws_col_letter(col)
            ws.cell(row_idx, col, f"={summary_name}!{col_letter}{summary_row}")
        ws.cell(row_idx, 12, f"={summary_name}!K{summary_row}")
        ws.cell(row_idx, 13, f"={summary_name}!L{summary_row}")
    if data_end >= data_start:
        if summary_row is None:
            ws.cell(row_idx, 2, f'=IF(E{row_idx}=0,"",I{row_idx}/E{row_idx})')
        ws.cell(row_idx, 5, f"=SUM(E{data_start}:E{data_end})")
        ws.cell(row_idx, 6, f"=SUM(F{data_start}:F{data_end})")
        ws.cell(row_idx, 9, f"=SUM(I{data_start}:I{data_end})")
        ws.cell(row_idx, 10, f"=SUM(J{data_start}:J{data_end})")


def _write_child_category_links(wb, layout: SchemeLayout, upgrade: UpgradeReport) -> None:
    # Scheme order: a tier that is also a parent (V2 "Tablet $400-") is linked
    # (and its overview resized) before its sub-tiers link to its sections.
    for child_tab, (parent_tab, section_title) in layout.child_section_links.items():
        parent_ws = wb[parent_tab]
        child_ws = wb[child_tab]
        title_row = _find_row_by_label(parent_ws, section_title)
        data_start = title_row + 2
        total_row = _find_section_total_row(parent_ws, title_row)
        source_rows = list(range(data_start, total_row + 1))
        _resize_overview_rows(child_ws, 5, len(source_rows))
        parent_name = quote_sheetname(parent_tab)
        for offset, parent_row in enumerate(source_rows):
            child_row = 5 + offset
            for col in range(1, 14):
                col_letter = ws_col_letter(col)
                child_ws.cell(child_row, col, f"={parent_name}!{col_letter}{parent_row}")
        _format_child_overview_rows(child_ws, parent_ws, source_rows)
        _refresh_listing_hyperlinks(child_ws)
        if child_tab in layout.parent_sections:
            # The overview resize moved this tab's own sections; re-point
            # their Total rows (SUM ranges + Summary links) at the new rows.
            _write_parent_section_summary_total_links(wb, layout, tabs=[child_tab])
        if child_tab in upgrade.cloned_tabs:
            fit_overview_chart_refs(child_ws, 5, 5 + len(source_rows) - 1)
    # A3 = link to the parent section title, written once every overview has
    # its final size. V1 keeps the template's A3 (published months rebuild
    # identically); V2 rewrites it, which also fixes the drifted links such
    # as Tablet $400-!A3 -> 'Tablet Total'!A91 while the title sits on row 92.
    for child_tab, (parent_tab, section_title) in layout.child_section_links.items():
        if layout.is_legacy and child_tab not in upgrade.cloned_tabs:
            continue
        title_row = _find_row_by_label(wb[parent_tab], section_title)
        wb[child_tab]["A3"] = f"={quote_sheetname(parent_tab)}!A{title_row}"


def _format_child_overview_rows(child_ws, parent_ws, source_rows: list[int]) -> None:
    if not source_rows:
        return
    total_child_row = 5 + len(source_rows) - 1
    total_parent_row = source_rows[-1]
    for row_idx in range(5, total_child_row):
        for col in range(1, 14):
            cell = child_ws.cell(row_idx, col)
            font = copy(cell.font)
            font.bold = False
            cell.font = font
    # Brand rows carry the same white/light-gray banding as the parent block
    # (the hidden URL column K stays unfilled, matching the hand format).
    _apply_row_banding(child_ws, 5, total_child_row - 1, skip_cols={11})
    for row_idx in range(5, total_child_row):
        child_ws.cell(row_idx, 11).fill = copy(NO_FILL)
    for col in range(1, 14):
        src = parent_ws.cell(total_parent_row, col)
        dst = child_ws.cell(total_child_row, col)
        if src.has_style:
            dst._style = copy(src._style)
        if src.number_format:
            dst.number_format = src.number_format
        if src.alignment:
            dst.alignment = copy(src.alignment)
        if src.font:
            dst.font = copy(src.font)
        if src.fill:
            dst.fill = copy(src.fill)
        if src.border:
            dst.border = copy(src.border)


def _refresh_listing_hyperlinks(ws) -> None:
    for table in sorted_tables(ws):
        _min_col, header_row, _max_col, max_row = table_bounds(table)
        for row_idx in range(header_row + 1, max_row + 1):
            ws.cell(row_idx, 12, hyperlink_formula(row_idx))


def _set_chart_frames_rectangular(wb) -> None:
    for ws in wb.worksheets:
        for chart in getattr(ws, "_charts", []):
            if hasattr(chart, "roundedCorners"):
                chart.roundedCorners = False


def _patch_package_xml(path: Path) -> None:
    ET.register_namespace("", CHART_NS)
    ET.register_namespace("a", A_NS)
    ET.register_namespace("r", R_NS)
    ET.register_namespace("xdr", DRAWING_NS)

    temp_path = path.with_name(f"{path.stem}.tmp{path.suffix}")
    with ZipFile(path, "r") as source, ZipFile(temp_path, "w", ZIP_DEFLATED) as target:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename.startswith("xl/charts/chart") and item.filename.endswith(".xml"):
                data = _patch_single_chart_xml(data)
            elif item.filename.startswith("xl/drawings/drawing") and item.filename.endswith(".xml"):
                data = _patch_single_drawing_xml(data)
            target.writestr(item, data)
    temp_path.replace(path)


def _patch_single_chart_xml(data: bytes) -> bytes:
    root = ET.fromstring(data)
    rounded_tag = f"{{{CHART_NS}}}roundedCorners"
    rounded = root.find(rounded_tag)
    if rounded is None:
        rounded = ET.Element(rounded_tag, {"val": "0"})
        root.insert(_chart_rounded_corners_insert_index(root), rounded)
    else:
        rounded.set("val", "0")
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _patch_single_drawing_xml(data: bytes) -> bytes:
    root = ET.fromstring(data)
    changed = False
    expected_avlst = f"{{{A_NS}}}avLst"
    for geometry in root.iter(f"{{{A_NS}}}prstGeom"):
        for child in list(geometry):
            if child.tag.rsplit("}", 1)[-1] == "avLst" and child.tag != expected_avlst:
                child.tag = expected_avlst
                changed = True
    if not changed:
        return data
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _chart_rounded_corners_insert_index(root) -> int:
    insert_idx = 0
    for idx, child in enumerate(list(root)):
        local_name = child.tag.rsplit("}", 1)[-1]
        if local_name in {"date1904", "lang"}:
            insert_idx = idx + 1
            continue
        if local_name in {
            "roundedCorners",
            "style",
            "clrMapOvr",
            "pivotSource",
            "protection",
            "chart",
            "spPr",
            "txPr",
            "externalData",
            "printSettings",
            "userShapes",
            "extLst",
        }:
            break
    return insert_idx


def _sanitize_error_tokens(wb) -> None:
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                if _is_blank_error_token(cell.value):
                    cell.value = None


def _is_blank_error_token(value: object) -> bool:
    if not isinstance(value, str):
        return False
    return value.strip().lower() in {"inf", "+inf", "-inf", "na", "n/a", "#n/a"}


def _apply_negative_number_formatting(wb) -> None:
    red_font = Font(color=NEGATIVE_TEXT_COLOR)
    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            continue
        max_row = _last_used_row(ws)
        max_col = _last_used_col(ws)
        if max_row < 1 or max_col < 1:
            continue
        ref = f"A1:{ws_col_letter(max_col)}{max_row}"
        ws.conditional_formatting.add(
            ref,
            CellIsRule(operator="lessThan", formula=["0"], font=red_font),
        )


def _last_used_row(ws) -> int:
    for row_idx in range(ws.max_row, 0, -1):
        for col in range(1, ws.max_column + 1):
            if ws.cell(row_idx, col).value not in (None, ""):
                return row_idx
    return 0


def _last_used_col(ws) -> int:
    for col in range(ws.max_column, 0, -1):
        for row_idx in range(1, ws.max_row + 1):
            if ws.cell(row_idx, col).value not in (None, ""):
                return col
    return 0


def _resize_overview_rows(ws, start_row: int, target_count: int) -> None:
    current_end = _find_last_metric_row(ws, start_row)
    current_count = max(current_end - start_row + 1, 0)
    if target_count > current_count:
        insert_at = start_row + current_count
        count = target_count - current_count
        ws.insert_rows(insert_at, count)
        shift_row_artifacts(ws, insert_at, count)
        _shift_tables(ws, insert_at, count)
        _copy_row_style(ws, insert_at - 1, insert_at, count)
    elif target_count < current_count:
        delete_at = start_row + target_count
        count = current_count - target_count
        ws.delete_rows(delete_at, count)
        shift_row_artifacts(ws, delete_at + count, -count)
        _shift_tables(ws, delete_at + count, -count)


def _find_row_by_label(ws, label: str) -> int:
    target = label.strip().lower()
    for row_idx in range(1, ws.max_row + 1):
        value = str(ws.cell(row_idx, 1).value or "").strip().lower()
        if value == target:
            return row_idx
    raise ValueError(f"{ws.title} is missing section: {label}")


def _find_section_total_row(ws, title_row: int) -> int:
    row_idx = title_row + 2
    while row_idx <= ws.max_row:
        value = ws.cell(row_idx, 1).value
        # Excel drops the quotes around Summary when a hand-edited file is
        # re-saved, so accept both ='Summary'!A4 and =Summary!A4.
        normalized = str(value or "").strip().lower().replace("'", "")
        if normalized == "total" or normalized.startswith("=summary!a"):
            return row_idx
        row_idx += 1
    raise ValueError(f"{ws.title} section at row {title_row} is missing a Total row")


def _prepare_summary_row(row: list[object], summary_sheet: bool) -> list[object]:
    label = row[1] if len(row) > 1 else None
    if summary_sheet:
        return [label] + row[2:13]
    return [row[1] if row and row[0] != "Total" else row[1]] + row[2:11] + [None] + row[11:13]


def _write_prepared_metric_row(ws, row_idx: int, source: list[object]) -> None:
    for col in range(1, 14):
        ws.cell(row_idx, col).value = source[col - 1] if col <= len(source) else None


def _copy_row_style(ws, source_row: int, start_row: int, count: int) -> None:
    if source_row < 1:
        return
    for offset in range(count):
        target_row = start_row + offset
        ws.row_dimensions[target_row].height = ws.row_dimensions[source_row].height
        for col in range(1, ws.max_column + 1):
            src = ws.cell(source_row, col)
            dst = ws.cell(target_row, col)
            if src.has_style:
                dst._style = copy(src._style)
            if src.number_format:
                dst.number_format = src.number_format
            if src.alignment:
                dst.alignment = copy(src.alignment)
            if src.font:
                dst.font = copy(src.font)
            if src.fill:
                dst.fill = copy(src.fill)
            if src.border:
                dst.border = copy(src.border)


def _copy_single_row_style(ws, source_row: int, target_row: int, max_col: int | None = None) -> None:
    if source_row < 1:
        return
    ws.row_dimensions[target_row].height = ws.row_dimensions[source_row].height
    last_col = max_col or ws.max_column
    for col in range(1, last_col + 1):
        src = ws.cell(source_row, col)
        dst = ws.cell(target_row, col)
        if src.has_style:
            dst._style = copy(src._style)
        if src.number_format:
            dst.number_format = src.number_format
        if src.alignment:
            dst.alignment = copy(src.alignment)
        if src.font:
            dst.font = copy(src.font)
        if src.fill:
            dst.fill = copy(src.fill)
        if src.border:
            dst.border = copy(src.border)


def ws_col_letter(col: int) -> str:
    return chr(ord("A") + col - 1)


def _short_stage_slug(value: str) -> str:
    return slug(value).replace("tablet_", "t_").replace("handheld_", "h_")[:14]


def _stage_names(tabs: list[str], legacy: bool) -> dict[str, str]:
    """Staging-sheet slug per category tab.

    The short slug drops "+"/"-", so "Handheld $75+"/"$75-" (V1) and
    "Handheld $100+"/"$100-" (V2) collide and the second tab's staging blocks
    overwrite the first's. V1 keeps the historical names (published months
    rebuild identically); later schemes disambiguate with p/m suffixes and
    every name is unique and fits Excel's 31-character sheet-name limit.
    """
    names = {tab: _short_stage_slug(tab) for tab in tabs}
    if legacy:
        return names
    counts: dict[str, int] = {}
    for name in names.values():
        counts[name] = counts.get(name, 0) + 1
    for tab, name in list(names.items()):
        if counts[name] > 1:
            stripped = tab.rstrip()
            names[tab] = name + {"+": "p", "-": "m"}.get(stripped[-1:], "")
    seen: dict[str, int] = {}
    for tab, name in list(names.items()):
        seen[name] = seen.get(name, 0) + 1
        if seen[name] > 1:
            names[tab] = f"{name}{seen[name]}"
    if len(set(names.values())) != len(names):
        raise ValueError(f"Staging names are not unique: {names}")
    too_long = [f"_stg_c_{name}_unit" for name in names.values() if len(f"_stg_c_{name}_unit") > 31]
    if too_long:
        raise ValueError(f"Staging sheet names exceed 31 characters: {too_long}")
    return names


def _write_metric_rows(ws, start_row: int, end_row: int, rows: list[list[object]], hidden_k: bool) -> None:
    capacity = end_row - start_row + 1
    if len(rows) > capacity:
        raise ValueError(f"{ws.title} overview overflow: {len(rows)} rows > capacity {capacity}")
    width = 13 if hidden_k else 12
    for offset in range(capacity):
        row_idx = start_row + offset
        source = rows[offset] if offset < len(rows) else []
        for col in range(1, width + 1):
            ws.cell(row_idx, col).value = source[col - 1] if col <= len(source) else None


def _write_simple_block(ws, start_row: int, end_row: int, rows: list[list[object]], width: int) -> None:
    capacity = end_row - start_row + 1
    if len(rows) > capacity:
        raise ValueError(f"{ws.title} block overflow: {len(rows)} rows > capacity {capacity}")
    for offset in range(capacity):
        row_idx = start_row + offset
        source = rows[offset] if offset < len(rows) else []
        for col in range(1, width + 1):
            ws.cell(row_idx, col).value = source[col - 1] if col <= len(source) else None


def _write_listing_table(ws, table, rows: list[list[object]], style: str) -> None:
    is_brand = style in {"brand_revenue", "brand_units"}
    # Brand tables keep their independent Total row one row below the table;
    # _ensure_table_capacity shifts it (and everything else below) in place,
    # so it must NOT be deleted up front — deleting it used to pull the next
    # block's title row up into the position later overwritten by the new
    # Total row, which is how "Rank by Units" titles kept disappearing.
    table = _ensure_table_capacity(ws, table, len(rows), shrink=is_brand)
    min_col, header_row, max_col, max_row = table_bounds(table)
    data_start = header_row + 1
    capacity = max_row - header_row
    required_rows = len(rows)
    if required_rows > capacity:
        raise ValueError(f"{ws.title} table {table.name} overflow: {required_rows} rows > capacity {capacity}")
    _unmerge_rows(ws, header_row, max_row)
    _write_table_headers(ws, table, header_row, enforce_bold=is_brand)

    for offset in range(capacity):
        row_idx = data_start + offset
        source = rows[offset] if offset < len(rows) else []
        for col in range(min_col, max_col + 1):
            ws.cell(row_idx, col).value = None
        if not source:
            continue
        if style == "market":
            ws.cell(row_idx, 1, offset + 1)
            for c_idx, value in enumerate(source[:10], start=2):
                ws.cell(row_idx, c_idx, value)
            ws.cell(row_idx, 12, hyperlink_formula(row_idx))
        elif is_brand:
            for c_idx, value in enumerate(source[:11], start=1):
                ws.cell(row_idx, c_idx, value)
            ws.cell(row_idx, 12, hyperlink_formula(row_idx))
        else:
            raise ValueError(f"Unknown listing style: {style}")

    actual_last = data_start + max(len(rows), 1) - 1
    _set_table_ref(table, f"A{header_row}:L{actual_last}")
    if is_brand:
        total_row = actual_last + 1
        mode = "revenue" if style == "brand_revenue" else "units"
        _write_brand_listing_total_row(ws, total_row, data_start, actual_last, mode)


def _write_brand_listing_total_row(ws, row_idx: int, data_start: int, data_end: int, mode: str) -> None:
    _unmerge_rows(ws, row_idx, row_idx)
    if data_end >= data_start:
        _copy_single_row_style(ws, data_end, row_idx, max_col=12)
    for col in range(1, 13):
        ws.cell(row_idx, col).value = None
        font = copy(ws.cell(row_idx, col).font)
        font.bold = True
        ws.cell(row_idx, col).font = font
    ws.cell(row_idx, 1, "Total")
    if data_end >= data_start:
        total_cols = (5, 6) if mode == "revenue" else (7, 8)
        for col in total_cols:
            letter = ws_col_letter(col)
            ws.cell(row_idx, col, f"=SUM({letter}{data_start}:{letter}{data_end})")


def _refresh_brand_listing_totals(ws) -> None:
    for idx, table in enumerate(sorted_tables(ws)[:2]):
        _min_col, header_row, _max_col, max_row = table_bounds(table)
        mode = "revenue" if idx == 0 else "units"
        _write_brand_listing_total_row(ws, max_row + 1, header_row + 1, max_row, mode)


def _ensure_table_capacity(ws, table, required_rows: int, shrink: bool = False):
    min_col, header_row, max_col, max_row = table_bounds(table)
    capacity = max_row - header_row
    if required_rows <= capacity:
        if shrink and required_rows < capacity:
            delete_at = header_row + required_rows + 1
            count = capacity - required_rows
            ws.delete_rows(delete_at, count)
            shift_row_artifacts(ws, delete_at + count, -count)
            _shift_tables(ws, delete_at + count, -count, skip={table.name})
            _set_table_ref(table, f"A{header_row}:L{header_row + required_rows}")
        return table
    extra = required_rows - capacity
    insert_at = max_row + 1
    source_row = max_row
    ws.insert_rows(insert_at, extra)
    shift_row_artifacts(ws, insert_at, extra)
    for offset in range(extra):
        target_row = insert_at + offset
        ws.row_dimensions[target_row].height = ws.row_dimensions[source_row].height
        for col in range(min_col, max_col + 1):
            src = ws.cell(source_row, col)
            dst = ws.cell(target_row, col)
            if src.has_style:
                dst._style = copy(src._style)
            if src.number_format:
                dst.number_format = src.number_format
            if src.alignment:
                dst.alignment = copy(src.alignment)
            if src.font:
                dst.font = copy(src.font)
            if src.fill:
                dst.fill = copy(src.fill)
            if src.border:
                dst.border = copy(src.border)
    for other in ws.tables.values():
        o_min_col, o_min_row, o_max_col, o_max_row = table_bounds(other)
        if other.name == table.name:
            other.ref = f"A{header_row}:L{max_row + extra}"
        elif o_min_row >= insert_at:
            other.ref = f"A{o_min_row + extra}:L{o_max_row + extra}"
        elif o_min_row < insert_at <= o_max_row:
            other.ref = f"A{o_min_row}:L{o_max_row + extra}"
    return ws.tables[table.name]


def _shift_tables(ws, from_row: int, delta: int, skip: set[str] | None = None) -> None:
    if delta == 0:
        return
    skip = skip or set()
    for table in ws.tables.values():
        if table.name in skip:
            continue
        min_col, min_row, max_col, max_row = table_bounds(table)
        if min_row >= from_row:
            _set_table_ref(table, f"A{min_row + delta}:L{max_row + delta}")
        elif min_row < from_row <= max_row:
            _set_table_ref(table, f"A{min_row}:L{max_row + delta}")


def _set_table_ref(table, ref: str) -> None:
    table.ref = ref
    if getattr(table, "autoFilter", None) is not None:
        table.autoFilter.ref = ref


def _mark_top50_owned_brand_rows(ws, table) -> None:
    min_col, header_row, max_col, max_row = table_bounds(table)
    for row_idx in range(header_row + 1, max_row + 1):
        brand = str(ws.cell(row_idx, 4).value or "").strip().lower()
        color = OWN_BRAND_COLORS.get(brand, "FF000000")
        _apply_row_font_color(ws, row_idx, min_col, min(max_col, 10), color)
        if max_col >= 12:
            _sync_link_column_color(ws, row_idx, 12, brand)


def _mark_summary_owned_brand_rows(ws, start_row: int, end_row: int) -> None:
    for row_idx in range(start_row, end_row + 1):
        brand = str(ws.cell(row_idx, 1).value or "").strip().lower()
        if not brand:
            continue
        color = OWN_BRAND_COLORS.get(brand, DEFAULT_TEXT_COLOR)
        _apply_row_font_color(ws, row_idx, 1, 9, color)


def _apply_row_font_color(ws, row_idx: int, min_col: int, max_col: int, color: str) -> None:
    for col in range(min_col, max_col + 1):
        cell = ws.cell(row_idx, col)
        font = copy(cell.font)
        font.color = color
        cell.font = font


def _sync_link_column_color(ws, row_idx: int, col: int, brand: str) -> None:
    """Color the hyperlink column on own-brand rows; on other rows restore
    the standard blue link style where the template's old row order left a
    stale own-brand color behind."""
    cell = ws.cell(row_idx, col)
    own_color = OWN_BRAND_COLORS.get(brand)
    if own_color:
        font = copy(cell.font)
        font.color = own_color
        cell.font = font
        return
    current = cell.font.color
    if current is not None and current.type == "rgb" and current.rgb in set(OWN_BRAND_COLORS.values()):
        font = copy(cell.font)
        font.color = Color(theme=10)
        font.underline = "single"
        cell.font = font


def _unmerge_rows(ws, start_row: int, end_row: int) -> None:
    for merged_range in list(ws.merged_cells.ranges):
        if merged_range.max_row < start_row or merged_range.min_row > end_row:
            continue
        ws.unmerge_cells(str(merged_range))


def _write_table_headers(ws, table, header_row: int, enforce_bold: bool = False) -> None:
    for offset, column in enumerate(table.tableColumns, start=1):
        cell = ws.cell(header_row, offset, column.name)
        # Brand-table headers are bold with the lavender fill across all
        # columns; templates drift (lost bold / missing fill cells), so
        # enforce both.
        if enforce_bold:
            if not cell.font.bold:
                font = copy(cell.font)
                font.bold = True
                cell.font = font
            # Header row is FFD9D2E9 except the "Monthly Units" column header,
            # which carries the slightly different FFDAD2E9 in the hand format.
            header_fill = "FFDAD2E9" if str(column.name or "").strip().lower() in {"monthly units", "monthly unit sales"} else "FFD9D2E9"
            cell.fill = PatternFill("solid", fgColor=header_fill)
