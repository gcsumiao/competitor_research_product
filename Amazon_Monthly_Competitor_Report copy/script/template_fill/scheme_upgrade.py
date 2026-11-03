"""Self-upgrade an Analysis template to the active price-tier scheme layout.

The monthly filler copies last month's hand-checked Analysis workbook and
refills it. When the price-tier scheme changes (V2 from 202610 adds six
sub-tier rows/tabs) last month's workbook no longer has the structure the new
month needs, so ``upgrade_template`` reshapes it in place before any value is
written:

0. tabs, section titles and Summary rows that carry superseded wording of a
   current label (``price_tier_scheme.LEGACY_LABELS``, e.g. "Tablet $300+" ->
   "Tablet $300-$400" in the first V2 preview) are renamed in place, sheet
   references in formulas and charts included;
1. missing category tabs are cloned (sub-tiers from their parent tier tab,
   before that parent receives its new sections, so clones carry none);
2. category tabs of another scheme (e.g. "Handheld $75+" in a V2 build) are
   removed;
3. parent tabs get exactly the sections the scheme asks for, cloned from an
   existing section block ("Tablet Total" first section); sections already in
   scheme order are kept and only the missing ones are appended below them;
4. the Summary category table grows/shrinks to the scheme's row count (rows are
   inserted just above the grand "Total" row with every dependent range,
   formula and chart reference kept in step), and the Summary chart series are
   re-pointed at their labelled rows;
5. schemes with a FIXED brand block (V2+: all 16 labels on every brand tab)
   grow each brand tab's overview block to that size (rows inserted just above
   its "Total" row, same bookkeeping); the brand-tab charts are re-pointed by
   label on every build (``fit_brand_chart_refs``), not here.

A template that already matches the scheme is left untouched (idempotent).
"""
from __future__ import annotations

from copy import copy, deepcopy
from dataclasses import dataclass, field

from openpyxl.chart.pie_chart import DoughnutChart, PieChart, PieChart3D, ProjectedPieChart
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.formula.tokenizer import Token, Tokenizer
from openpyxl.utils import get_column_letter, quote_sheetname
from openpyxl.utils.cell import range_boundaries
from openpyxl.worksheet.cell_range import CellRange, MultiCellRange

from price_tier_scheme import LEGACY_LABELS, SCHEMES

from .config import FIXED_BRANDS, KNOWN_TIER_LABELS, SUMMARY_FIRST_ROW, SchemeLayout, slug
from .formula_map import sorted_tables
from .sheet_ops import (
    chart_refs,
    delete_rows,
    insert_rows,
    rename_sheet_in_formula,
    retarget_chart_sheet,
    sheet_ref,
    split_sheet_prefix,
)

SECTION_WIDTH = 13  # A..M on category tabs
SUMMARY_WIDTH = 12  # A..L on Summary
OVERVIEW_FIRST_ROW = 5
SECTION_SOURCE_PREFERENCE = ("Tablet Total", "Handheld Total")
PIE_TYPES = (PieChart, PieChart3D, DoughnutChart, ProjectedPieChart)
_TIERS = {t.label: t for tiers in SCHEMES.values() for t in tiers}
_TIERS.update({old: _TIERS[new] for old, new in LEGACY_LABELS.items()})
_MAX_SUMMARY_ROWS = 60


@dataclass
class SectionBlock:
    """Title / header / one body / Total rows of a parent-tab section."""

    rows: list[list[tuple[object, object]]]  # per row: (value, style array) for A..M
    heights: list[float | None]
    merges: list[tuple[int, int, int, int]]  # (min_col, row offset, max_col, row offset)

    @property
    def height(self) -> int:
        return len(self.rows)


@dataclass
class UpgradeReport:
    scheme: str
    renamed_labels: dict[str, list[str]] = field(default_factory=dict)  # "old -> new" -> where
    cloned_tabs: dict[str, str] = field(default_factory=dict)  # new tab -> source tab
    removed_tabs: list[str] = field(default_factory=list)
    sections_removed: dict[str, list[str]] = field(default_factory=dict)
    sections_added: dict[str, list[str]] = field(default_factory=dict)
    summary_rows_before: int = 0
    summary_rows_after: int = 0
    summary_styles: dict[str, list] = field(default_factory=dict)
    summary_chart_plan: list = field(default_factory=list)
    brand_rows_added: dict[str, int] = field(default_factory=dict)  # brand tab -> rows inserted

    @property
    def summary_resized(self) -> bool:
        return self.summary_rows_before != self.summary_rows_after

    @property
    def changed(self) -> bool:
        return bool(
            self.renamed_labels
            or self.cloned_tabs
            or self.removed_tabs
            or self.sections_removed
            or self.sections_added
            or self.summary_resized
            or self.brand_rows_added
        )

    def describe(self) -> list[str]:
        lines = []
        for rename, places in self.renamed_labels.items():
            lines.append(f"renamed {rename} in place: {', '.join(places)}")
        for tab, source in self.cloned_tabs.items():
            lines.append(f"cloned tab {tab!r} from {source!r}")
        for tab in self.removed_tabs:
            lines.append(f"removed tab {tab!r} (not in scheme {self.scheme})")
        for tab, titles in self.sections_removed.items():
            lines.append(f"{tab}: removed sections {titles}")
        for tab, titles in self.sections_added.items():
            lines.append(f"{tab}: added sections {titles}")
        if self.summary_resized:
            lines.append(f"Summary category table {self.summary_rows_before} -> {self.summary_rows_after} rows")
        for tab, added in self.brand_rows_added.items():
            lines.append(f"{tab}: brand overview block grew by {added} rows")
        return lines


def upgrade_template(wb, layout: SchemeLayout) -> UpgradeReport:
    report = UpgradeReport(layout.name)
    _rename_legacy_labels(wb, layout, report)
    block = capture_section_block(wb, layout)
    _ensure_category_tabs(wb, layout, report)
    _remove_stale_category_tabs(wb, layout, report)
    _ensure_parent_sections(wb, layout, report, block)
    _ensure_summary_rows(wb["Summary"], layout, report)
    _ensure_brand_blocks(wb, layout, report)
    return report


# ---------------------------------------------------------------- renames


def _rename_legacy_labels(wb, layout: SchemeLayout, report: UpgradeReport) -> None:
    """Rename superseded wording of a current label in place: the tab (with
    every formula / chart / defined-name reference to it and its A1 title),
    parent-tab section titles and the Summary category row. A template that
    has BOTH the old and the new tab keeps the new one; the old tab is then
    dropped as a stale tier tab."""
    wanted = set(layout.summary_labels)
    renames = {old: new for old, new in LEGACY_LABELS.items() if new in wanted}
    if not renames:
        return
    for old, new in renames.items():
        if old in wb.sheetnames and new not in wb.sheetnames:
            rename_tab(wb, old, new)
            report.renamed_labels.setdefault(f"{old!r} -> {new!r}", []).append("tab")
    for ws in wb.worksheets:
        if ws.title.startswith("_stg_"):
            continue  # staging sheets are rebuilt from the raw summary
        for title, title_row, _total_row in find_sections(ws):
            if title in renames:
                ws.cell(title_row, 1).value = renames[title]
                report.renamed_labels.setdefault(f"{title!r} -> {renames[title]!r}", []).append(
                    f"{ws.title}!A{title_row}"
                )
    if "Summary" in wb.sheetnames:
        summary = wb["Summary"]
        for offset, label in enumerate(summary_table(summary)):
            if label in renames:
                row_idx = SUMMARY_FIRST_ROW + offset
                summary.cell(row_idx, 1).value = renames[label]
                report.renamed_labels.setdefault(f"{label!r} -> {renames[label]!r}", []).append(f"Summary!A{row_idx}")


def rename_tab(wb, old: str, new: str) -> None:
    """``wb[old].title = new`` plus what openpyxl does not follow: formulas
    and hyperlink targets on every sheet, chart references, defined names and
    the tab's own "<label> Monthly Summary" title."""
    ws = wb[old]
    ws.title = new
    for sheet in wb.worksheets:
        for chart in getattr(sheet, "_charts", []):
            retarget_chart_sheet(chart, old, new)
        for row in sheet.iter_rows():
            for cell in row:
                value = cell.value
                if isinstance(value, str) and value.startswith("=") and old.lower() in value.lower():
                    cell.value = rename_sheet_in_formula(value, old, new)
                link = cell.hyperlink
                if link is not None and link.location and old.lower() in link.location.lower():
                    link.location = rename_sheet_in_formula(link.location, old, new)
    holders = [wb.defined_names] + [getattr(sheet, "defined_names", {}) for sheet in wb.worksheets]
    for holder in holders:
        for defined_name in holder.values():
            text = getattr(defined_name, "attr_text", None)
            if isinstance(text, str) and old.lower() in text.lower():
                defined_name.attr_text = rename_sheet_in_formula(text, old, new)
    if str(ws["A1"].value or "").strip() == f"{old} Monthly Summary":
        ws["A1"] = f"{new} Monthly Summary"


# ------------------------------------------------------------------- tabs


def clone_tier_tab(wb, source_tab: str, new_tab: str, *, parent_link: tuple[str, int] | None = None):
    """Clone a tier tab (overview + two ranking tables + charts) as ``new_tab``.

    ``copy_worksheet`` only copies cells, styles, dimensions and merges, so the
    tables (renamed uniquely), charts (series/category/title references
    re-pointed at the new sheet), conditional formats, data validations and
    sheet view are copied here. Parent sections below the tables are stripped.
    A1 becomes "<new_tab> Monthly Summary"; A3 links to ``parent_link``
    (parent tab, section title row) when given, otherwise the build writes it.
    The clone is placed right after its source (the build re-orders tabs).
    """
    if new_tab in wb.sheetnames:
        raise ValueError(f"Cannot clone {source_tab!r}: {new_tab!r} already exists")
    if len(new_tab) > 31 or any(ch in new_tab for ch in "[]:*?/\\"):
        raise ValueError(f"Invalid sheet name {new_tab!r}")
    src = wb[source_tab]
    ws = wb.copy_worksheet(src)
    ws.title = new_tab
    wb._sheets.remove(ws)
    wb._sheets.insert(wb._sheets.index(src) + 1, ws)
    ws.sheet_state = src.sheet_state
    ws.views = deepcopy(src.views)
    for view in ws.views.sheetView:
        view.tabSelected = None
    _copy_tables(src, ws)
    for chart in getattr(src, "_charts", []):
        clone = deepcopy(chart)
        retarget_chart_sheet(clone, src.title, ws.title)
        ws.add_chart(clone)
    for cf in src.conditional_formatting:
        for rule in cf.rules:
            ws.conditional_formatting.add(str(cf.sqref), deepcopy(rule))
    for dv in src.data_validations.dataValidation:
        ws.add_data_validation(deepcopy(dv))
    for row in ws.iter_rows():
        for cell in row:
            if isinstance(cell.value, str) and cell.value.startswith("=") and src.title.lower() in cell.value.lower():
                cell.value = rename_sheet_in_formula(cell.value, src.title, ws.title)
    remove_sections(ws, find_sections(ws))
    ws["A1"] = f"{new_tab} Monthly Summary"
    if parent_link is not None:
        parent_tab, title_row = parent_link
        ws["A3"] = f"={quote_sheetname(parent_tab)}!A{title_row}"
    return ws


def _copy_tables(src, ws) -> None:
    wb = ws.parent
    used = {t.name.lower() for sheet in wb.worksheets for t in sheet.tables.values()}
    used |= {name.lower() for name in wb.defined_names}
    for idx, table in enumerate(sorted_tables(src), start=1):
        clone = deepcopy(table)
        base = f"Tbl_{slug(ws.title)}_{idx}"
        name, n = base, 2
        while name.lower() in used:
            name, n = f"{base}_{n}", n + 1
        used.add(name.lower())
        clone.name = name
        clone.displayName = name
        ws.add_table(clone)


def _ensure_category_tabs(wb, layout: SchemeLayout, report: UpgradeReport) -> None:
    for tab in layout.category_tabs:
        if tab in wb.sheetnames:
            continue
        if tab in layout.total_tabs:
            raise ValueError(f"Analysis template is missing the {tab!r} tab; family total tabs cannot be synthesized")
        source = _pick_clone_source(wb, layout, tab)
        clone_tier_tab(wb, source, tab)
        report.cloned_tabs[tab] = source


def _pick_clone_source(wb, layout: SchemeLayout, tab: str) -> str:
    tier = _TIERS[tab]
    candidates: list[str] = []
    if tier.parent:
        candidates.append(tier.parent)  # sub-tiers copy their parent tier's layout
    same_family = [label for label in layout.category_tabs if label in _TIERS and _TIERS[label].types == tier.types]
    candidates += same_family
    candidates += sorted(label for label in KNOWN_TIER_LABELS if _TIERS[label].types == tier.types)
    candidates += [label for label in layout.category_tabs if label in KNOWN_TIER_LABELS]
    candidates += sorted(KNOWN_TIER_LABELS)
    for candidate in candidates:
        if candidate != tab and candidate in wb.sheetnames:
            return candidate
    raise ValueError(f"Analysis template has no tier tab to clone {tab!r} from")


def _remove_stale_category_tabs(wb, layout: SchemeLayout, report: UpgradeReport) -> None:
    for title in list(wb.sheetnames):
        if title in KNOWN_TIER_LABELS and title not in layout.category_tabs:
            del wb[title]
            report.removed_tabs.append(title)


# --------------------------------------------------------------- sections


def find_section_total_row(ws, title_row: int) -> int:
    row_idx = title_row + 2
    while row_idx <= ws.max_row:
        normalized = str(ws.cell(row_idx, 1).value or "").strip().lower().replace("'", "")
        if normalized == "total" or normalized.startswith("=summary!a"):
            return row_idx
        row_idx += 1
    raise ValueError(f"{ws.title} section at row {title_row} is missing a Total row")


def find_sections(ws) -> list[tuple[str, int, int]]:
    """(title, title row, Total row) of every tier-labelled section block."""
    found = []
    row_idx = OVERVIEW_FIRST_ROW
    while row_idx <= ws.max_row:
        value = ws.cell(row_idx, 1).value
        if (
            isinstance(value, str)
            and value.strip() in KNOWN_TIER_LABELS
            and str(ws.cell(row_idx + 1, 2).value or "").strip().lower() == "avg price"
        ):
            total_row = find_section_total_row(ws, row_idx)
            found.append((value.strip(), row_idx, total_row))
            row_idx = total_row + 1
            continue
        row_idx += 1
    return found


def remove_sections(ws, sections: list[tuple[str, int, int]]) -> None:
    for _title, title_row, total_row in reversed(sections):
        end = total_row
        if end + 1 <= ws.max_row and _row_is_blank(ws, end + 1):
            end += 1  # the gap row that follows the block
        delete_rows(ws, title_row, end - title_row + 1)


def capture_section_block(wb, layout: SchemeLayout) -> SectionBlock | None:
    order = list(SECTION_SOURCE_PREFERENCE) + list(layout.parent_sections) + list(wb.sheetnames)
    for tab in dict.fromkeys(order):
        if tab not in wb.sheetnames:
            continue
        ws = wb[tab]
        sections = find_sections(ws)
        if not sections:
            continue
        _title, title_row, total_row = sections[0]
        source_rows = [title_row, title_row + 1, title_row + 2, total_row]
        rows, heights = [], []
        for offset, row_idx in enumerate(source_rows):
            cells = []
            for col in range(1, SECTION_WIDTH + 1):
                cell = ws.cell(row_idx, col)
                if offset == 1:
                    value = cell.value  # header labels
                elif offset == 3 and col == 1:
                    value = "Total"
                else:
                    value = None
                cells.append((value, copy(cell._style) if cell.has_style else None))
            rows.append(cells)
            dim = ws.row_dimensions.get(row_idx)  # .get: indexing would create a row entry
            heights.append(dim.height if dim is not None else None)
        merges = [
            (rng.min_col, rng.min_row - title_row, rng.max_col, rng.max_row - title_row)
            for rng in ws.merged_cells.ranges
            if rng.min_row == rng.max_row == title_row
        ]
        return SectionBlock(rows, heights, merges)
    return None


def paste_section(ws, top_row: int, block: SectionBlock, title: str) -> None:
    for offset, cells in enumerate(block.rows):
        row_idx = top_row + offset
        if block.heights[offset] is not None or row_idx in ws.row_dimensions:
            ws.row_dimensions[row_idx].height = block.heights[offset]
        for col, (value, style) in enumerate(cells, start=1):
            cell = ws.cell(row_idx, col)
            if style is not None:
                cell._style = copy(style)
            cell.value = title if (offset == 0 and col == 1) else value
    for min_col, r1, max_col, r2 in block.merges:
        ws.merge_cells(start_row=top_row + r1, start_column=min_col, end_row=top_row + r2, end_column=max_col)


def _ensure_parent_sections(wb, layout: SchemeLayout, report: UpgradeReport, block: SectionBlock | None) -> None:
    for tab in layout.category_tabs:
        ws = wb[tab]
        expected = list(layout.parent_sections.get(tab, ()))
        existing = find_sections(ws)
        titles = [title for title, _r, _t in existing]
        if titles == expected:
            continue
        if existing and titles == expected[: len(titles)] and existing[-1][2] >= last_used_row(ws, SECTION_WIDTH):
            # The sections present are the scheme's first ones and end the
            # tab (e.g. a V1 "Tablet Total" gaining the V2 sub-tier sections):
            # keep them - and any hand formatting - and append the rest.
            missing = expected[len(titles) :]
        else:
            if existing:
                remove_sections(ws, existing)
                report.sections_removed[tab] = titles
            missing = expected
        if not missing:
            continue
        if block is None:
            raise ValueError(f"Analysis template has no section block to copy for {tab!r}")
        top = last_used_row(ws, SECTION_WIDTH) + 2
        for title in missing:
            paste_section(ws, top, block, title)
            top += block.height + 1
        report.sections_added[tab] = missing


def last_used_row(ws, max_col: int) -> int:
    for row_idx in range(ws.max_row, 0, -1):
        if not _row_is_blank(ws, row_idx, max_col):
            return row_idx
    return 0


def _row_is_blank(ws, row_idx: int, max_col: int = SECTION_WIDTH) -> bool:
    return all(ws.cell(row_idx, col).value in (None, "") for col in range(1, max_col + 1))


# ---------------------------------------------------------------- Summary


def summary_table(ws) -> list[str]:
    """Labels of the Summary category table: row 4 down to the grand Total."""
    labels = []
    for row_idx in range(SUMMARY_FIRST_ROW, SUMMARY_FIRST_ROW + _MAX_SUMMARY_ROWS):
        label = str(ws.cell(row_idx, 1).value or "").strip()
        labels.append(label)
        if label.lower() == "total":
            return labels
    raise ValueError("Summary category table has no grand 'Total' row")


def summary_row_kind(label: str, subtier_labels) -> str:
    if label.strip().lower() == "total":
        return "grand"
    if label.strip().lower().startswith("total"):
        return "subtotal"
    if label in subtier_labels:
        return "subtier"
    return "tier"


def _ensure_summary_rows(ws, layout: SchemeLayout, report: UpgradeReport) -> None:
    labels = summary_table(ws)
    report.summary_rows_before = len(labels)
    report.summary_rows_after = len(layout.summary_labels)
    report.summary_styles = _capture_summary_styles(ws, labels)
    plan = _capture_summary_chart_plan(ws, labels)
    total_row = SUMMARY_FIRST_ROW + len(labels) - 1
    delta = len(layout.summary_labels) - len(labels)
    if delta > 0:
        insert_rows(ws, total_row, delta)
    elif delta < 0:
        delete_rows(ws, total_row + delta, -delta)
    report.summary_chart_plan = plan


def _capture_summary_styles(ws, labels: list[str]) -> dict[str, list]:
    styles: dict[str, list] = {}
    fallback_subtotal = None
    for offset, label in enumerate(labels):
        kind = summary_row_kind(label, ())
        row_idx = SUMMARY_FIRST_ROW + offset
        captured = [copy(ws.cell(row_idx, col)._style) for col in range(1, SUMMARY_WIDTH + 1)]
        if kind == "subtotal" and label.strip().lower() == "total dongle":
            fallback_subtotal = fallback_subtotal or captured  # its fill differs by scheme
            continue
        styles.setdefault(kind, captured)
    if "subtotal" not in styles and fallback_subtotal is not None:
        styles["subtotal"] = fallback_subtotal
    missing = {"tier", "subtotal", "grand"} - set(styles)
    if missing:
        raise ValueError(f"Summary category table lacks a {sorted(missing)} row to copy styles from")
    return styles


def _ref_areas(text: str) -> list[tuple[str, int, int, int, int]] | None:
    """Areas of a chart reference like ``(Summary!$A$7,Summary!$A$10:$A$12)``."""
    try:
        tokens = Tokenizer("=" + text).items
    except Exception:
        return None
    areas = []
    for item in tokens:
        if item.type == Token.OPERAND and item.subtype == Token.RANGE:
            title, _prefix, rest = split_sheet_prefix(item.value)
            if title is None:
                return None
            try:
                min_col, min_row, max_col, max_row = range_boundaries(rest.replace("$", ""))
            except ValueError:
                return None
            if None in (min_col, min_row, max_col, max_row):
                return None
            areas.append((title, min_col, min_row, max_col, max_row))
        elif item.type in (Token.PAREN, Token.SEP) or (item.type == Token.OP_IN and item.value == ","):
            continue
        else:
            return None
    return areas or None


def _capture_summary_chart_plan(ws, labels: list[str]) -> list:
    """For every Summary chart reference that lies inside the category table,
    remember WHICH labelled rows it plots (or 'the whole table')."""
    first = SUMMARY_FIRST_ROW
    last = first + len(labels) - 1
    row_label = {first + i: label for i, label in enumerate(labels)}
    plan = []
    for chart in getattr(ws, "_charts", []):
        for ref in chart_refs(chart):
            areas = _ref_areas(ref.f or "")
            if not areas or any(title.lower() != ws.title.lower() for title, *_ in areas):
                continue
            if any(not (first <= r1 and r2 <= last) or c1 != c2 for _t, c1, r1, c2, r2 in areas):
                continue  # not a single-column slice of the category table
            spec = []
            for _title, col, r1, _c2, r2 in areas:
                if (r1, r2) == (first, last):
                    spec.append((col, None))  # the whole table
                else:
                    spec.append((col, [row_label[r] for r in range(r1, r2 + 1)]))
            plan.append((ref, spec))
    return plan


def apply_summary_chart_plan(ws, layout: SchemeLayout, plan: list) -> None:
    """Point each planned Summary chart reference at its labelled rows in the
    (resized) table - pies at Total Tablet/Handheld/Dongle/Other Tools, bars
    at the full category table."""
    first = SUMMARY_FIRST_ROW
    row_of = {label: first + i for i, label in enumerate(layout.summary_labels)}
    sheet = sheet_ref(ws.title)
    for ref, spec in plan:
        parts = []
        for col, labels in spec:
            letter = get_column_letter(col)
            if labels is None:
                parts.append(f"{sheet}!${letter}${first}:${letter}${layout.summary_last_row}")
                continue
            missing = [label for label in labels if label not in row_of]
            if missing:
                raise ValueError(f"Summary chart plots rows {missing} that scheme {layout.name} does not have")
            for r1, r2 in _runs(sorted(row_of[label] for label in labels)):
                parts.append(f"{sheet}!${letter}${r1}" if r1 == r2 else f"{sheet}!${letter}${r1}:${letter}${r2}")
        ref.f = parts[0] if len(parts) == 1 else "(" + ",".join(parts) + ")"


def _runs(rows: list[int]) -> list[tuple[int, int]]:
    runs: list[tuple[int, int]] = []
    for row in rows:
        if runs and row == runs[-1][1] + 1:
            runs[-1] = (runs[-1][0], row)
        else:
            runs.append((row, row))
    return runs


# ------------------------------------------------------------ clone charts


def fit_overview_chart_refs(ws, first_row: int, total_row: int) -> None:
    """Cloned tier tabs: bars plot the whole overview (brands, Other, Total),
    pies the brand rows without the Total - the convention of the tabs whose
    charts have not drifted (Tablet Total, Tablet $800+, Dongle, Other Tools)."""
    for chart in getattr(ws, "_charts", []):
        end = total_row - 1 if isinstance(chart, PIE_TYPES) else total_row
        for ref in chart_refs(chart):
            areas = _ref_areas(ref.f or "")
            if not areas or len(areas) != 1:
                continue
            title, c1, r1, c2, _r2 = areas[0]
            if title.lower() != ws.title.lower() or r1 != first_row or c1 != c2:
                continue
            letter = get_column_letter(c1)
            ref.f = f"{sheet_ref(ws.title)}!${letter}${first_row}:${letter}${end}"


# ------------------------------------------------------------ brand tabs


def brand_block_labels(ws, first_row: int, max_rows: int = 40) -> list[str]:
    """Labels of a brand tab's overview block: column A from ``first_row``
    down to the first blank cell."""
    labels = []
    for row_idx in range(first_row, first_row + max_rows):
        label = str(ws.cell(row_idx, 1).value or "").strip()
        if not label:
            break
        labels.append(label)
    return labels


def _ensure_brand_blocks(wb, layout: SchemeLayout, report: UpgradeReport) -> None:
    """Fixed brand blocks (V2+): grow every brand tab's overview block to the
    scheme's row count. The rows go in just above the block's "Total" row, so
    everything below (blank gap, charts, rank titles, tables, conditional
    formats, formulas, chart references) moves down in step; the new rows take
    the style of the block's first row. Conditional-format ranges that cover
    the block from its first row are stretched to its new last row (some
    hand-formatted tabs stop them above the Total row). A block that already
    has the scheme's size is left untouched (idempotent). V1 (compacted 10-row
    block) is never touched."""
    if not layout.brand_block_fixed:
        return
    first, last = layout.brand_block_rows
    size = layout.brand_block_capacity
    for display, _key in FIXED_BRANDS:
        if display not in wb.sheetnames:
            continue  # validation reports the missing tab
        ws = wb[display]
        labels = brand_block_labels(ws, first)
        if not labels or labels[-1].lower() != "total":
            raise ValueError(
                f"{display}: overview block at A{first} should end with a 'Total' row, got {labels}"
            )
        if len(labels) > size:
            raise ValueError(f"{display}: overview block has {len(labels)} rows, more than the {size} of scheme {layout.name}")
        delta = size - len(labels)
        if delta == 0:
            continue
        total_row = first + len(labels) - 1
        insert_rows(ws, total_row, delta)
        source_height = ws.row_dimensions[first].height if first in ws.row_dimensions else None
        for row_idx in range(total_row, total_row + delta):
            for col in range(1, SECTION_WIDTH + 1):
                src = ws.cell(first, col)
                if src.has_style:
                    ws.cell(row_idx, col)._style = copy(src._style)
            if source_height is not None:
                ws.row_dimensions[row_idx].height = source_height
        _stretch_block_conditional_formats(ws, first, last)
        report.brand_rows_added[display] = delta


def _stretch_block_conditional_formats(ws, first: int, last: int) -> None:
    old = ws.conditional_formatting
    new = ConditionalFormattingList()
    changed = False
    for cf in old:
        ranges = []
        for rng in MultiCellRange(str(cf.sqref)).ranges:
            if rng.min_row == first and first <= rng.max_row < last:
                rng = CellRange(min_col=rng.min_col, min_row=first, max_col=rng.max_col, max_row=last)
                changed = True
            ranges.append(rng.coord)
        for rule in cf.rules:
            new.add(" ".join(ranges), rule)
    if changed:
        new.max_priority = max(getattr(old, "max_priority", 0), new.max_priority)
        ws.conditional_formatting = new


def fit_brand_chart_refs(ws, first_row: int, last_row: int) -> None:
    """Re-point a brand tab's overview charts by row label (V2+, every
    build): bar charts plot the whole block (first row .. "Total"), pies the
    four family-total rows (Total Tablet / Handheld / Dongle / Other Tools).
    Each reference keeps its own column; only single-column references that
    start inside the block are touched (series titles on the header row are
    not; a hand-drawn range that ran past the Total row is pulled back).
    Also fixes templates whose compacted V1 blocks left the pies on the wrong
    rows (October 2026 final: Foxwell, iCarsoft, TOPDON, LAUNCH, Thinkcar)."""
    row_of = {}
    for row_idx in range(first_row, last_row + 1):
        label = str(ws.cell(row_idx, 1).value or "").strip()
        if label:
            row_of.setdefault(label, row_idx)
    total_row = next((r for label, r in row_of.items() if label.lower() == "total"), None)
    family_rows = sorted(r for label, r in row_of.items() if summary_row_kind(label, ()) == "subtotal")
    if total_row is None or not family_rows:
        raise ValueError(f"{ws.title}: overview block {first_row}-{last_row} has no Total / family-total rows")
    sheet = sheet_ref(ws.title)
    for chart in getattr(ws, "_charts", []):
        rows = family_rows if isinstance(chart, PIE_TYPES) else list(range(first_row, total_row + 1))
        for ref in chart_refs(chart):
            areas = _ref_areas(ref.f or "")
            if not areas or any(title.lower() != ws.title.lower() for title, *_ in areas):
                continue
            cols = {c1 for _t, c1, _r1, c2, _r2 in areas if c1 == c2}
            if len(cols) != 1 or any(c1 != c2 for _t, c1, _r1, c2, _r2 in areas):
                continue
            if any(not (first_row <= r1 <= last_row) for _t, _c1, r1, _c2, r2 in areas):
                continue  # not anchored in the block (a header cell, a table column)
            letter = get_column_letter(cols.pop())
            parts = [
                f"{sheet}!${letter}${r1}" if r1 == r2 else f"{sheet}!${letter}${r1}:${letter}${r2}"
                for r1, r2 in _runs(rows)
            ]
            ref.f = parts[0] if len(parts) == 1 else "(" + ",".join(parts) + ")"
