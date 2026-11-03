from __future__ import annotations

import argparse
import shutil
from pathlib import Path

from openpyxl import load_workbook

from .config import SOURCE_TEMPLATE, STAGING_TEMPLATE, VISIBLE_SHEETS
from .validate import validate_workbook


def create_staging_template(source: Path = SOURCE_TEMPLATE, output: Path = STAGING_TEMPLATE) -> Path:
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(source, output)
    wb = load_workbook(output)
    try:
        for ws in wb.worksheets:
            ws.sheet_state = "visible" if ws.title in VISIBLE_SHEETS else "hidden"
        ordered = [wb[title] for title in VISIBLE_SHEETS]
        for sheet in ordered:
            wb._sheets.remove(sheet)
        for idx, sheet in enumerate(ordered):
            wb._sheets.insert(idx, sheet)
        wb.calculation.fullCalcOnLoad = True
        wb.calculation.forceFullCalc = True
        issues = validate_workbook(wb)
        blocking = [i for i in issues if not i.startswith("Expected HYPERLINK")]
        if blocking:
            raise ValueError("Staging template validation failed:\n- " + "\n- ".join(blocking))
        wb.save(output)
    finally:
        wb.close()
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Create the 8-brand staging template.")
    parser.add_argument("--source", type=Path, default=SOURCE_TEMPLATE)
    parser.add_argument("--output", type=Path, default=STAGING_TEMPLATE)
    args = parser.parse_args()
    out = create_staging_template(args.source, args.output)
    print(out)


if __name__ == "__main__":
    main()
