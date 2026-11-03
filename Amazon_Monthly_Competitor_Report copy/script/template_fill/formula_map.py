from __future__ import annotations

from openpyxl.utils.cell import range_boundaries
from openpyxl.worksheet.table import Table
from openpyxl.worksheet.worksheet import Worksheet


def sorted_tables(ws: Worksheet) -> list[Table]:
    return sorted(ws.tables.values(), key=lambda t: range_boundaries(t.ref)[1])


def table_bounds(table: Table) -> tuple[int, int, int, int]:
    min_col, min_row, max_col, max_row = range_boundaries(table.ref)
    return min_col, min_row, max_col, max_row


def hyperlink_formula(row: int, url_col: str = "K") -> str:
    return f'=IF({url_col}{row}="","",HYPERLINK({url_col}{row},{url_col}{row}))'
