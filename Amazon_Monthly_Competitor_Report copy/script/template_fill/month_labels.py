from __future__ import annotations

import re

from openpyxl.workbook import Workbook


MONTHS = (
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
)

SHORT_MONTHS = {
    "January": "Jan",
    "February": "Feb",
    "March": "Mar",
    "April": "Apr",
    "May": "May",
    "June": "Jun",
    "July": "Jul",
    "August": "Aug",
    "September": "Sep",
    "October": "Oct",
    "November": "Nov",
    "December": "Dec",
}


def long_label(month_name: str, month_label: str) -> str:
    year = month_label.split()[-1] if " " in month_label else ""
    return f"{month_name} {year}".strip()


def replace_month_labels(wb: Workbook, month_label: str, month_name: str) -> None:
    long = long_label(month_name, month_label)
    short_re = re.compile(r"\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) '\d{2}\b")
    long_re = re.compile(r"\b(?:" + "|".join(MONTHS) + r") '\d{2}\b")
    month_name_re = re.compile(r"\b(?:" + "|".join(MONTHS) + r")\b")
    for ws in wb.worksheets:
        if ws.sheet_state != "visible":
            continue
        for row in ws.iter_rows():
            for cell in row:
                value = cell.value
                if not isinstance(value, str) or value.startswith("="):
                    continue
                # "Rank By Monthly ..." titles use the short label ("Jun '26");
                # everything else (Summary titles, "Top 50 Products - ...")
                # uses the long label. This also disambiguates "May '26",
                # which matches both the short and long pattern.
                if "Rank By Monthly" in value or "Rank by Monthly" in value:
                    value = long_re.sub(month_label, value)
                    value = short_re.sub(month_label, value)
                else:
                    value = long_re.sub(long, value)
                    value = short_re.sub(month_label, value)
                if "Amazon Competitor Analysis " in value:
                    value = month_name_re.sub(month_name, value)
                cell.value = value

