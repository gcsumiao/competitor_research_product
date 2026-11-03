"""Excel-like row insertion/deletion and chart-reference helpers for openpyxl.

openpyxl's ``insert_rows``/``delete_rows`` only move cells. ``insert_rows`` and
``delete_rows`` below also keep everything that points at rows in step, the
way Excel does: merged ranges, row heights, tables (and their autoFilter),
conditional formatting (ranges and rule formulas), data validations, chart and
image anchors, every formula in the workbook that refers to the sheet, every
chart series reference in the workbook that refers to the sheet, and defined
names.

Range semantics follow Excel: inserting N rows at row R moves references at or
below R down by N and grows a range that spans R; deleting rows R..R+N-1 moves
references below up by N and shrinks ranges that overlap the deleted band. A
single-cell reference INTO deleted rows is clamped to row R (Excel would show
#REF!); callers here only delete rows whose dependants they rewrite afterwards.

The pre-existing ``xlsx_rowshift.shift_row_artifacts`` (merges + anchors only)
is left untouched for the V1 code paths that rely on it.
"""
from __future__ import annotations

import re

from openpyxl.chart.data_source import MultiLevelStrRef, NumRef, StrRef
from openpyxl.formatting.formatting import ConditionalFormattingList
from openpyxl.formula.tokenizer import Token, Tokenizer
from openpyxl.utils import quote_sheetname
from openpyxl.utils.cell import range_boundaries
from openpyxl.worksheet.cell_range import CellRange, MultiCellRange

from xlsx_rowshift import _shift_anchor_list

_CELL_RE = re.compile(r"^(\$?)([A-Za-z]{1,3})(\$?)(\d+)$")
_ROW_RE = re.compile(r"^(\$?)(\d+)$")
_BARE_SHEET_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_.]*$")
_R1C1_RE = re.compile(r"^[Rr]\d*[Cc]\d*$")
_REF_TYPES = (NumRef, StrRef, MultiLevelStrRef)


def sheet_ref(title: str) -> str:
    """Sheet prefix as Excel writes it: bare when allowed (``Summary``), quoted
    otherwise (``'Tablet $300+'``). openpyxl's quote_sheetname always quotes,
    and Excel strips unneeded quotes on save, which shows up as drift."""
    if _BARE_SHEET_RE.match(title) and not _CELL_RE.match(title) and not _R1C1_RE.match(title):
        return title
    return quote_sheetname(title)


class RowShift:
    """Row mapping for one insert (delta > 0) or delete (delta < 0) at ``at``."""

    def __init__(self, at: int, delta: int) -> None:
        if at < 1 or delta == 0:
            raise ValueError(f"bad row shift at={at} delta={delta}")
        self.at = at
        self.delta = delta

    @property
    def deleted(self) -> int:
        return -self.delta if self.delta < 0 else 0

    def point(self, row: int) -> int:
        if self.delta > 0:
            return row + self.delta if row >= self.at else row
        n = self.deleted
        if row >= self.at + n:
            return row - n
        if row >= self.at:
            return self.at
        return row

    def span(self, r1: int, r2: int) -> tuple[int, int] | None:
        """New (r1, r2) for a row span, or None if every row was deleted."""
        if self.delta > 0:
            if r1 >= self.at:
                return r1 + self.delta, r2 + self.delta
            if r2 >= self.at:
                return r1, r2 + self.delta
            return r1, r2
        n = self.deleted
        new1 = r1 if r1 < self.at else (self.at if r1 < self.at + n else r1 - n)
        new2 = r2 if r2 < self.at else (self.at - 1 if r2 < self.at + n else r2 - n)
        if new2 < new1:
            return None
        return new1, new2


# ---------------------------------------------------------------- references


def split_sheet_prefix(ref: str) -> tuple[str | None, str, str]:
    """``"'Tablet Total'!A5"`` -> ("Tablet Total", "'Tablet Total'!", "A5")."""
    idx = ref.rfind("!")
    if idx < 0:
        return None, "", ref
    prefix = ref[:idx]
    title = prefix[1:-1].replace("''", "'") if prefix.startswith("'") and prefix.endswith("'") else prefix
    return title, ref[: idx + 1], ref[idx + 1 :]


def _shift_a1(text: str, shift: RowShift) -> str:
    """Shift the rows of an A1 reference without a sheet prefix."""
    parts = text.split(":")
    if len(parts) == 1:
        m = _CELL_RE.match(text)
        if not m:
            return text
        d1, col, d2, row = m.groups()
        return f"{d1}{col}{d2}{shift.point(int(row))}"
    if len(parts) != 2:
        return text
    a, b = parts
    ma, mb = _CELL_RE.match(a), _CELL_RE.match(b)
    if ma and mb:
        new = shift.span(int(ma.group(4)), int(mb.group(4)))
        r1, r2 = new if new is not None else (shift.at, shift.at)
        return f"{ma.group(1)}{ma.group(2)}{ma.group(3)}{r1}:{mb.group(1)}{mb.group(2)}{mb.group(3)}{r2}"
    ra, rb = _ROW_RE.match(a), _ROW_RE.match(b)
    if ra and rb:
        new = shift.span(int(ra.group(2)), int(rb.group(2)))
        r1, r2 = new if new is not None else (shift.at, shift.at)
        return f"{ra.group(1)}{r1}:{rb.group(1)}{r2}"
    return text  # whole columns, structured refs, names: row-independent


def shift_formula(formula: object, *, formula_sheet: str | None, target_sheet: str, shift: RowShift) -> object:
    """Shift every reference to ``target_sheet`` in an ``=...`` formula.

    Unprefixed references count as ``formula_sheet``'s own cells.
    """
    if not isinstance(formula, str) or not formula.startswith("="):
        return formula
    target = target_sheet.lower()
    if formula_sheet is None or formula_sheet.lower() != target:
        if target_sheet.lower() not in formula.lower():
            return formula
    try:
        tok = Tokenizer(formula)
    except Exception:  # unparsable formula: leave it alone
        return formula
    changed = False
    for item in tok.items:
        if item.type != Token.OPERAND or item.subtype != Token.RANGE:
            continue
        title, prefix, rest = split_sheet_prefix(item.value)
        sheet = title if title is not None else formula_sheet
        if sheet is None or sheet.lower() != target:
            continue
        new_rest = _shift_a1(rest, shift)
        if new_rest != rest:
            item.value = prefix + new_rest
            changed = True
    return tok.render() if changed else formula


def _shift_bare_formula(text: str | None, *, formula_sheet: str | None, target_sheet: str, shift: RowShift):
    """Same as ``shift_formula`` for formulas stored without the leading '='
    (chart refs, CF rules, data validations, defined names)."""
    if not isinstance(text, str) or not text:
        return text
    shifted = shift_formula("=" + text, formula_sheet=formula_sheet, target_sheet=target_sheet, shift=shift)
    return shifted[1:]


def chart_refs(chart) -> list:
    """Every NumRef/StrRef/MultiLevelStrRef reachable from a chart (series
    names, categories, values, titles, combined sub-charts)."""
    found: list = []
    seen: set[int] = set()

    def walk(obj) -> None:
        if obj is None or isinstance(obj, (str, bytes, int, float, bool)):
            return
        if id(obj) in seen:
            return
        seen.add(id(obj))
        if isinstance(obj, _REF_TYPES):
            found.append(obj)
            return
        if isinstance(obj, (list, tuple, set)):
            for item in obj:
                walk(item)
            return
        if isinstance(obj, dict):
            for item in obj.values():
                walk(item)
            return
        if not type(obj).__module__.startswith("openpyxl.chart"):
            return
        for value in vars(obj).values():
            walk(value)

    walk(chart)
    return found


def retarget_chart_sheet(chart, old_title: str, new_title: str) -> int:
    """Point every chart reference at ``old_title`` to ``new_title``."""
    changed = 0
    for ref in chart_refs(chart):
        new_f = rename_sheet_in_formula(ref.f, old_title, new_title)
        if new_f != ref.f:
            ref.f = new_f
            changed += 1
    return changed


def rename_sheet_in_formula(text: str | None, old_title: str, new_title: str) -> str | None:
    if not isinstance(text, str) or not text:
        return text
    bare = not text.startswith("=")
    formula = "=" + text if bare else text
    try:
        tok = Tokenizer(formula)
    except Exception:
        return text
    changed = False
    for item in tok.items:
        if item.type != Token.OPERAND or item.subtype != Token.RANGE:
            continue
        title, _prefix, rest = split_sheet_prefix(item.value)
        if title is not None and title.lower() == old_title.lower():
            item.value = f"{sheet_ref(new_title)}!{rest}"
            changed = True
    if not changed:
        return text
    rendered = tok.render()
    return rendered[1:] if bare else rendered


# ---------------------------------------------------------- row insert/delete


def insert_rows(ws, at: int, count: int) -> None:
    """Insert ``count`` rows before row ``at`` and keep the workbook in step."""
    if count <= 0:
        return
    shift = RowShift(at, count)
    ws.insert_rows(at, count)
    _apply_shift(ws, shift)
    _shift_anchor_list(getattr(ws, "_charts", []), at, count)
    _shift_anchor_list(getattr(ws, "_images", []), at, count)


def delete_rows(ws, at: int, count: int) -> None:
    """Delete rows ``at``..``at+count-1`` and keep the workbook in step."""
    if count <= 0:
        return
    shift = RowShift(at, -count)
    ws.delete_rows(at, count)
    _apply_shift(ws, shift)
    _shift_anchor_list(getattr(ws, "_charts", []), at + count, -count)
    _shift_anchor_list(getattr(ws, "_images", []), at + count, -count)


def _apply_shift(ws, shift: RowShift) -> None:
    _shift_merges(ws, shift)
    _shift_row_dimensions(ws, shift)
    _shift_tables(ws, shift)
    _shift_conditional_formatting(ws, shift)
    _shift_data_validations(ws, shift)
    wb = ws.parent
    for other in wb.worksheets:
        _shift_sheet_formulas(other, ws.title, shift)
        for chart in getattr(other, "_charts", []):
            for ref in chart_refs(chart):
                ref.f = _shift_bare_formula(ref.f, formula_sheet=None, target_sheet=ws.title, shift=shift)
    _shift_defined_names(wb, ws.title, shift)


def _shift_range(rng: CellRange, shift: RowShift) -> CellRange | None:
    new = shift.span(rng.min_row, rng.max_row)
    if new is None:
        return None
    return CellRange(min_col=rng.min_col, min_row=new[0], max_col=rng.max_col, max_row=new[1])


def _shift_multi(sqref, shift: RowShift) -> MultiCellRange | None:
    ranges = [r for r in (_shift_range(rng, shift) for rng in MultiCellRange(str(sqref)).ranges) if r is not None]
    if not ranges:
        return None
    return MultiCellRange(" ".join(r.coord for r in ranges))


def _shift_merges(ws, shift: RowShift) -> None:
    kept = []
    for rng in list(ws.merged_cells.ranges):
        new = _shift_range(rng, shift)
        if new is not None:
            kept.append(new)
    ws.merged_cells.ranges.clear()
    for rng in kept:
        ws.merged_cells.ranges.add(rng)


def _shift_row_dimensions(ws, shift: RowShift) -> None:
    dims = dict(ws.row_dimensions.items())
    moved = {}
    for row_idx, dim in dims.items():
        if shift.delta < 0 and shift.at <= row_idx < shift.at + shift.deleted:
            continue  # the row was deleted
        new_idx = shift.point(row_idx)
        dim.index = new_idx
        moved[new_idx] = dim
    ws.row_dimensions.clear()
    for row_idx in sorted(moved):
        ws.row_dimensions[row_idx] = moved[row_idx]


def _shift_tables(ws, shift: RowShift) -> None:
    for table in ws.tables.values():
        min_col, min_row, max_col, max_row = range_boundaries(table.ref)
        new = shift.span(min_row, max_row)
        if new is None:
            raise ValueError(f"{ws.title}: row delete would remove table {table.name} entirely")
        ref = CellRange(min_col=min_col, min_row=new[0], max_col=max_col, max_row=new[1]).coord
        table.ref = ref
        if getattr(table, "autoFilter", None) is not None:
            table.autoFilter.ref = ref


def _shift_conditional_formatting(ws, shift: RowShift) -> None:
    old = ws.conditional_formatting
    new = ConditionalFormattingList()
    for cf in old:
        sqref = _shift_multi(cf.sqref, shift)
        if sqref is None:
            continue
        for rule in cf.rules:
            formulas = list(rule.formula or [])
            shifted = [
                _shift_bare_formula(f, formula_sheet=ws.title, target_sheet=ws.title, shift=shift) for f in formulas
            ]
            if shifted != formulas:
                rule.formula = shifted
            new.add(str(sqref), rule)
    new.max_priority = max(getattr(old, "max_priority", 0), new.max_priority)
    ws.conditional_formatting = new


def _shift_data_validations(ws, shift: RowShift) -> None:
    kept = []
    for dv in ws.data_validations.dataValidation:
        sqref = _shift_multi(dv.sqref, shift)
        if sqref is None:
            continue
        dv.sqref = sqref
        for attr in ("formula1", "formula2"):
            value = getattr(dv, attr, None)
            if value:
                setattr(dv, attr, _shift_bare_formula(value, formula_sheet=ws.title, target_sheet=ws.title, shift=shift))
        kept.append(dv)
    ws.data_validations.dataValidation = kept


def _shift_sheet_formulas(ws, target_title: str, shift: RowShift) -> None:
    same_sheet = ws.title.lower() == target_title.lower()
    needle = target_title.lower()
    for row in ws.iter_rows():
        for cell in row:
            value = cell.value
            if not isinstance(value, str) or not value.startswith("="):
                continue
            if not same_sheet and needle not in value.lower():
                continue
            new_value = shift_formula(value, formula_sheet=ws.title, target_sheet=target_title, shift=shift)
            if new_value != value:
                cell.value = new_value


def _shift_defined_names(wb, target_title: str, shift: RowShift) -> None:
    holders = [wb.defined_names] + [getattr(ws, "defined_names", {}) for ws in wb.worksheets]
    for holder in holders:
        for defined_name in list(holder.values()):
            text = getattr(defined_name, "attr_text", None)
            new_text = _shift_bare_formula(text, formula_sheet=None, target_sheet=target_title, shift=shift)
            if new_text != text:
                defined_name.attr_text = new_text

