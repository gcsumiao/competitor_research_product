from __future__ import annotations

from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet


def ensure_sheet(wb: Workbook, title: str, hidden: bool = True) -> Worksheet:
    ws = wb[title] if title in wb.sheetnames else wb.create_sheet(title)
    ws.sheet_state = "hidden" if hidden else "visible"
    return ws


def clear_sheet(ws: Worksheet) -> None:
    for row in ws.iter_rows():
        for cell in row:
            cell.value = None


def write_staging_block(ws: Worksheet, headers: list[str], rows: list[list[object]]) -> None:
    clear_sheet(ws)
    for col, value in enumerate(headers, start=1):
        ws.cell(1, col, value)
    for r_idx, row in enumerate(rows, start=2):
        for c_idx, value in enumerate(row, start=1):
            ws.cell(r_idx, c_idx, value)
    ws.sheet_state = "hidden"

