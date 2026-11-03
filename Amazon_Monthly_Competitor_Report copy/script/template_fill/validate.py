from __future__ import annotations

import re
from pathlib import Path
from xml.etree import ElementTree as ET
from zipfile import BadZipFile, ZipFile

from openpyxl.workbook import Workbook

from .config import FIXED_BRANDS, VISIBLE_SHEETS
from .formula_map import sorted_tables, table_bounds


CANONICAL_URL = re.compile(r"^https://amazon\.com/dp/[A-Z0-9]{10}$")
CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
OWN_BRAND_COLORS = {
    "blcktec": "FF0000FF",
    "blacktec": "FF0000FF",
    "innova": "FFFF0000",
}


def validate_workbook(wb: Workbook) -> list[str]:
    issues: list[str] = []
    visible = [ws.title for ws in wb.worksheets if ws.sheet_state == "visible"]
    if visible != VISIBLE_SHEETS:
        issues.append(f"Visible sheet order mismatch: {visible}")

    for ws in wb.worksheets:
        if ws.title.startswith("_stg_") and ws.sheet_state != "hidden":
            issues.append(f"Staging sheet is not hidden: {ws.title}")

    for sheet_name in VISIBLE_SHEETS[1:11] + [display for display, _ in FIXED_BRANDS]:
        ws = wb[sheet_name]
        if sheet_name != "Summary" and not ws.column_dimensions["K"].hidden:
            issues.append(f"Column K should be hidden on {sheet_name}")

    for display, _key in FIXED_BRANDS:
        if display not in wb.sheetnames:
            issues.append(f"Missing fixed brand tab: {display}")

    _validate_no_merged_table_cells(wb, issues)
    _validate_no_blank_error_tokens(wb, issues)
    _validate_negative_number_formatting(wb, issues)

    hyperlink_cells = [
        ("Top 50", "L42"),
        ("Tablet Total", "L47"),
        ("Ancel", "L53"),
    ]
    for sheet, coord in hyperlink_cells:
        value = wb[sheet][coord].value
        if not (isinstance(value, str) and "HYPERLINK" in value and ",K" in value):
            issues.append(f"Expected URL-displaying HYPERLINK formula at {sheet}!{coord}")

    _validate_urls(wb, issues)
    _validate_top50(wb, issues)
    _validate_summary_brand_colors(wb, issues)
    _validate_total_shares(wb, issues)
    _validate_parent_section_total_links(wb, issues)
    _validate_child_links(wb, issues)
    _validate_listing_hyperlinks(wb, issues)
    _validate_brand_tabs(wb, issues)
    _validate_brand_logos(wb, issues)
    _validate_brand_overview_fills(wb, issues)
    _validate_parent_section_total_fills(wb, issues)

    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            continue
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                if isinstance(value, str) and "#REF!" in value:
                    issues.append(f"#REF! found at {ws.title}!{cell.coordinate}")
    return issues


def _validate_no_blank_error_tokens(wb: Workbook, issues: list[str]) -> None:
    bad_tokens = {"inf", "+inf", "-inf", "na", "n/a", "#n/a"}
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                if isinstance(value, str) and value.strip().lower() in bad_tokens:
                    issues.append(f"{ws.title}!{cell.coordinate} should be blank instead of {value!r}")


def _validate_negative_number_formatting(wb: Workbook, issues: list[str]) -> None:
    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            continue
        found = False
        for cf in ws.conditional_formatting:
            for rule in ws.conditional_formatting[cf]:
                formulas = [str(item).strip() for item in (rule.formula or [])]
                color = _rule_font_rgb(rule)
                if (
                    rule.type == "cellIs"
                    and rule.operator == "lessThan"
                    and formulas == ["0"]
                    and color == "FFFF0000"
                ):
                    found = True
                    break
            if found:
                break
        if not found:
            issues.append(f"{ws.title} is missing negative-number red conditional formatting")


def _rule_font_rgb(rule) -> str | None:
    dxf = getattr(rule, "dxf", None)
    font = getattr(dxf, "font", None)
    color = getattr(font, "color", None)
    if color is not None and color.type == "rgb":
        return color.rgb
    return None


def validate_output_file(path: str | Path) -> list[str]:
    issues: list[str] = []
    try:
        with ZipFile(path, "r") as archive:
            bad_member = archive.testzip()
            if bad_member:
                issues.append(f"Zip integrity failed at {bad_member}")
            for name in archive.namelist():
                if name.endswith(".xml"):
                    data = archive.read(name)
                    try:
                        root = ET.fromstring(data)
                    except ET.ParseError as exc:
                        issues.append(f"XML parse failed at {name}: {exc}")
                        continue
                    if name.startswith("xl/charts/chart"):
                        _validate_chart_xml(name, data, root, issues)
                    if name.startswith("xl/drawings/drawing"):
                        _validate_drawing_xml(name, root, issues)
                    if name.startswith("xl/tables/table"):
                        table_ref = root.attrib.get("ref")
                        auto_filter = root.find("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}autoFilter")
                        if auto_filter is not None and auto_filter.attrib.get("ref") != table_ref:
                            issues.append(
                                f"{name} autoFilter ref {auto_filter.attrib.get('ref')} should match table ref {table_ref}"
                            )
    except BadZipFile as exc:
        issues.append(f"Bad xlsx zip: {exc}")
    return issues


def _validate_chart_xml(name: str, data: bytes, root, issues: list[str]) -> None:
    text = data.decode("utf-8", errors="ignore")
    if "roundedRect" in text:
        issues.append(f"Rounded rectangle geometry found in {name}")
    rounded = root.find(f"{{{CHART_NS}}}roundedCorners")
    if rounded is None:
        issues.append(f"Missing disabled roundedCorners in {name}")
        return
    value = str(rounded.attrib.get("val", "")).strip().lower()
    if value not in {"0", "false"}:
        issues.append(f"roundedCorners should be disabled in {name}, got {rounded.attrib.get('val')}")


def _validate_drawing_xml(name: str, root, issues: list[str]) -> None:
    expected_avlst = f"{{{A_NS}}}avLst"
    for geometry in root.iter(f"{{{A_NS}}}prstGeom"):
        for child in list(geometry):
            if child.tag.rsplit("}", 1)[-1] == "avLst" and child.tag != expected_avlst:
                issues.append(f"{name} prstGeom avLst is in the wrong namespace: {child.tag}")


def _validate_urls(wb: Workbook, issues: list[str]) -> None:
    for ws in wb.worksheets:
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                if not isinstance(value, str):
                    continue
                if "amazon.com/dp/" in value and not value.startswith("=") and not CANONICAL_URL.match(value):
                    issues.append(f"Non-canonical Amazon URL at {ws.title}!{cell.coordinate}: {value}")


def _validate_no_merged_table_cells(wb: Workbook, issues: list[str]) -> None:
    for ws in wb.worksheets:
        table_ranges = [(table.name, table.ref, table_bounds(table)) for table in ws.tables.values()]
        for merged_range in ws.merged_cells.ranges:
            merged_bounds = (merged_range.min_col, merged_range.min_row, merged_range.max_col, merged_range.max_row)
            for table_name, table_ref, table_range in table_ranges:
                if _ranges_overlap(merged_bounds, table_range):
                    issues.append(f"Merged cells inside table at {ws.title}!{merged_range} ({table_name} {table_ref})")


def _ranges_overlap(a: tuple[int, int, int, int], b: tuple[int, int, int, int]) -> bool:
    return not (a[2] < b[0] or b[2] < a[0] or a[3] < b[1] or b[3] < a[1])


def _validate_top50(wb: Workbook, issues: list[str]) -> None:
    ws = wb["Top 50"]
    for row_idx in range(4, 9):
        if ws.cell(row_idx, 11).value not in (None, ""):
            issues.append(f"Top 50 hidden K cell should be blank: K{row_idx}")
    expected = ["Total Tablet", "Total Handheld", "Total Dongle", "Total Other Tools", "Total"]
    actual = [ws.cell(row_idx, 1).value for row_idx in range(4, 9)]
    if actual != expected:
        issues.append(f"Top 50 overview labels mismatch: {actual}")
    for table in sorted_tables(ws)[:2]:
        min_col, header_row, max_col, max_row = table_bounds(table)
        for row_idx in range(header_row + 1, max_row + 1):
            brand = str(ws.cell(row_idx, 4).value or "").strip().lower()
            expected_color = OWN_BRAND_COLORS.get(brand, "FF000000")
            color = _font_rgb(ws.cell(row_idx, 4))
            if color != expected_color:
                issues.append(f"Top 50 brand color mismatch at {ws.title}!D{row_idx}: {brand} {color}")


def _validate_total_shares(wb: Workbook, issues: list[str]) -> None:
    checks = {
        "Tablet Total": "Total Tablet",
        "Handheld Total": "Total Handheld",
        "Dongle": "Total Dongle",
        "Other Tools": "Total Other Tools",
    }
    for sheet_name, label in checks.items():
        ws = wb[sheet_name]
        row_idx = _find_label_row(ws, label, 5, 20)
        if ws.cell(row_idx, 6).value != 1:
            issues.append(f"{sheet_name}!F{row_idx} should be 100%")
        if ws.cell(row_idx, 10).value != 1:
            issues.append(f"{sheet_name}!J{row_idx} should be 100%")


def _validate_child_links(wb: Workbook, issues: list[str]) -> None:
    links = {
        "Tablet $800+": "Tablet Total",
        "Tablet $400-$800": "Tablet Total",
        "Tablet $400-": "Tablet Total",
        "Handheld $75+": "Handheld Total",
        "Handheld $75-": "Handheld Total",
    }
    for child, parent in links.items():
        ws = wb[child]
        first = ws.cell(5, 1).value
        if not (isinstance(first, str) and first.startswith(f"='{parent}'!A")):
            issues.append(f"{child}!A5 should link to {parent}")


def _validate_summary_brand_colors(wb: Workbook, issues: list[str]) -> None:
    ws = wb["Summary"]
    blocks = _summary_brand_blocks(ws)
    if len(blocks) < 2:
        issues.append("Summary should have Revenue and Units brand blocks")
    for start_row, end_row in blocks:
        for row_idx in range(start_row, end_row + 1):
            brand = str(ws.cell(row_idx, 1).value or "").strip().lower()
            if not brand:
                continue
            expected = OWN_BRAND_COLORS.get(brand, "FF000000")
            for col in range(1, 10):
                color = _font_rgb(ws.cell(row_idx, col))
                if color != expected:
                    issues.append(f"Summary color mismatch at {ws.cell(row_idx, col).coordinate}: {brand} {color}")


def _summary_brand_blocks(ws) -> list[tuple[int, int]]:
    """Locate the brand rows under the "... Summary - Revenue" and
    "... Summary - Units" titles (row ranges drift when brand counts change)."""
    blocks: list[tuple[int, int]] = []
    for row_idx in range(1, ws.max_row + 1):
        value = str(ws.cell(row_idx, 1).value or "")
        if "Summary - Revenue" not in value and "Summary - Units" not in value:
            continue
        start = row_idx + 2  # skip the Brand header row
        end = start
        while end <= ws.max_row:
            label = str(ws.cell(end, 1).value or "").strip()
            if not label or label.lower() in {"total", "total market"}:
                break
            end += 1
        if end > start:
            blocks.append((start, end - 1))
    return blocks


def _validate_parent_section_total_links(wb: Workbook, issues: list[str]) -> None:
    sections = {
        "Tablet Total": ("Tablet $800+", "Tablet $400-$800", "Tablet $400-"),
        "Handheld Total": ("Handheld $75+", "Handheld $75-"),
    }
    summary = wb["Summary"]
    for sheet_name, titles in sections.items():
        ws = wb[sheet_name]
        for title in titles:
            summary_row = _find_label_row(summary, title, 4, 13)
            title_row = _find_label_row(ws, title, 1, ws.max_row)
            total_row = _find_section_total_row(ws, title_row)
            def _norm_ref(value: object) -> str:
                return str(value or "").replace("'", "")

            for col in (1, 2, 3, 4, 7, 8):
                letter = _col_letter(col)
                expected = f"=Summary!{letter}{summary_row}"
                if _norm_ref(ws.cell(total_row, col).value) != expected:
                    issues.append(f"{sheet_name}!{letter}{total_row} should link to Summary!{letter}{summary_row}")
            if ws.cell(total_row, 11).value not in (None, ""):
                issues.append(f"{sheet_name}!K{total_row} should stay blank")
            if _norm_ref(ws.cell(total_row, 12).value) != f"=Summary!K{summary_row}":
                issues.append(f"{sheet_name}!L{total_row} should link to Summary!K{summary_row}")
            if _norm_ref(ws.cell(total_row, 13).value) != f"=Summary!L{summary_row}":
                issues.append(f"{sheet_name}!M{total_row} should link to Summary!L{summary_row}")
            for col in (5, 6, 9, 10):
                value = ws.cell(total_row, col).value
                if not (isinstance(value, str) and value.startswith(f"=SUM({_col_letter(col)}")):
                    issues.append(f"{sheet_name}!{_col_letter(col)}{total_row} should be a SUM formula")


def _validate_parent_section_total_fills(wb: Workbook, issues: list[str]) -> None:
    sections = {
        "Tablet Total": ("Tablet $800+", "Tablet $400-$800", "Tablet $400-"),
        "Handheld Total": ("Handheld $75+", "Handheld $75-"),
    }
    for sheet_name, titles in sections.items():
        ws = wb[sheet_name]
        for title in titles:
            title_row = _find_label_row(ws, title, 1, ws.max_row)
            total_row = _find_section_total_row(ws, title_row)
            kind = _fill_kind(ws.cell(total_row, 2))
            if kind != "rgb:FFB5A7D7":
                issues.append(f"{sheet_name}!B{total_row} section total should have the purple fill, got {kind}")


def _validate_listing_hyperlinks(wb: Workbook, issues: list[str]) -> None:
    for ws in wb.worksheets:
        if ws.sheet_state != "visible" or ws.title == "Summary":
            continue
        for table in sorted_tables(ws):
            _min_col, header_row, _max_col, max_row = table_bounds(table)
            for row_idx in range(header_row + 1, max_row + 1):
                url = ws.cell(row_idx, 11).value
                formula = ws.cell(row_idx, 12).value
                if url not in (None, "") or (isinstance(formula, str) and "HYPERLINK" in formula):
                    expected = f'=IF(K{row_idx}="","",HYPERLINK(K{row_idx},K{row_idx}))'
                    if formula != expected:
                        issues.append(f"{ws.title}!L{row_idx} should hyperlink same-row K{row_idx}")


def _validate_brand_logos(wb: Workbook, issues: list[str]) -> None:
    for display, _key in FIXED_BRANDS:
        ws = wb[display]
        if not getattr(ws, "_images", []):
            issues.append(f"{display} is missing its brand logo header image")


def _fill_kind(cell) -> str:
    fill = cell.fill
    if fill is None or fill.fill_type != "solid":
        return "none"
    color = fill.fgColor
    if color.type == "rgb" and isinstance(color.rgb, str):
        return f"rgb:{color.rgb}"
    if color.type == "theme":
        return f"theme{color.theme}:{round(color.tint or 0.0, 2)}"
    return "other"


def _validate_brand_overview_fills(wb: Workbook, issues: list[str]) -> None:
    for display, _key in FIXED_BRANDS:
        ws = wb[display]
        for row_idx in range(8, 18):
            label = str(ws.cell(row_idx, 1).value or "").strip().lower()
            kind = _fill_kind(ws.cell(row_idx, 2))
            if label == "total":
                if kind != "rgb:FFB5A7D7":
                    issues.append(f"{display}!B{row_idx} Total row should have the purple fill, got {kind}")
                if not ws.cell(row_idx, 2).font.bold:
                    issues.append(f"{display}!B{row_idx} Total row should be bold")
            elif label.startswith("total"):
                if kind != "theme0:-0.25":
                    issues.append(f"{display}!B{row_idx} subtotal row should have the gray fill, got {kind}")
                if not ws.cell(row_idx, 2).font.bold:
                    issues.append(f"{display}!B{row_idx} subtotal row should be bold")
            elif label and kind != "none":
                issues.append(f"{display}!B{row_idx} type row should have no fill, got {kind}")
            if label:
                if ws.cell(row_idx, 2).number_format != '"$"#,##0.00':
                    issues.append(f"{display}!B{row_idx} should use the Avg Price currency format")
                if ws.cell(row_idx, 10).number_format != "0%":
                    issues.append(f"{display}!J{row_idx} should use the percent format")


def _validate_brand_tabs(wb: Workbook, issues: list[str]) -> None:
    for display, _key in FIXED_BRANDS:
        ws = wb[display]
        for row_idx in range(8, 18):
            label = ws.cell(row_idx, 1).value
            values = [ws.cell(row_idx, col).value for col in (5, 6, 9, 10)]
            if label not in (None, "") and all(value in (None, "", 0, 0.0) for value in values):
                issues.append(f"Empty brand overview row should not be pasted: {display}!A{row_idx}")
        for idx, table in enumerate(sorted_tables(ws)[:2]):
            _min_col, header_row, _max_col, max_row = table_bounds(table)
            title_row = header_row - 1
            if "rank by" in str(ws.cell(title_row, 1).value or "").strip().lower():
                covered = any(
                    rng.min_row == title_row and rng.max_row == title_row and rng.min_col == 1 and rng.max_col >= 12
                    for rng in ws.merged_cells.ranges
                )
                if not covered:
                    issues.append(f"{display}!A{title_row} rank title should be merged across the table width")
            for row_idx in range(header_row + 1, max_row + 1):
                if str(ws.cell(row_idx, 1).value or "").strip().lower() == "total":
                    issues.append(f"{display} table {table.name} should not include the Total row")
            total_row = max_row + 1
            for merged_range in ws.merged_cells.ranges:
                if merged_range.min_row <= total_row <= merged_range.max_row:
                    issues.append(f"{display}!{total_row} independent Total row should not be merged")
            if ws.cell(total_row, 1).value != "Total":
                issues.append(f"{display} table {table.name} should have an independent Total row at {total_row}")
            expected_sum_cols = (5, 6) if idx == 0 else (7, 8)
            for col in expected_sum_cols:
                value = ws.cell(total_row, col).value
                if not (isinstance(value, str) and value.startswith("=SUM(")):
                    issues.append(f"{display}!{ws.cell(total_row, col).coordinate} should be a SUM total formula")
            for col in range(2, 13):
                if col in expected_sum_cols:
                    continue
                value = ws.cell(total_row, col).value
                if value not in (None, ""):
                    issues.append(f"{display}!{ws.cell(total_row, col).coordinate} should be blank on independent Total row")


def _find_section_total_row(ws, title_row: int) -> int:
    row_idx = title_row + 2
    while row_idx <= ws.max_row:
        # Accept both ='Summary'!A4 and =Summary!A4 (Excel strips the quotes
        # when a hand-edited file is re-saved).
        value = str(ws.cell(row_idx, 1).value or "").strip().lower().replace("'", "")
        if value == "total" or value.startswith("=summary!a"):
            return row_idx
        row_idx += 1
    raise ValueError(f"{ws.title} section at row {title_row} missing total row")


def _find_label_row(ws, label: str, start_row: int, end_row: int) -> int:
    for row_idx in range(start_row, end_row + 1):
        if ws.cell(row_idx, 1).value == label:
            return row_idx
    raise ValueError(f"{ws.title} missing label {label}")


def _font_rgb(cell) -> str | None:
    color = cell.font.color
    if color is None:
        return None
    if color.type == "rgb":
        return color.rgb
    return None


def _col_letter(col: int) -> str:
    return chr(ord("A") + col - 1)
