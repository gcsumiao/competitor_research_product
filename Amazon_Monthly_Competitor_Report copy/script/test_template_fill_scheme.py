#!/usr/bin/env python3
"""Price-tier scheme V2 in the Analysis-workbook filler (template_fill).

Fast tests (layout derivation, staging names, row-shift helpers) need no data.
The build tests (~1-2 min) use real September 2026 inputs, copied into a work
dir first - nothing under YY-MM-reports/ is ever written:

- V1 raw outputs: $TEMPLATE_FILL_V1_RAW_DIR, else ``script output reports/``
  (used only while it still holds the 202609 V1 run).
- V2 raw outputs: $TEMPLATE_FILL_V2_RAW_DIR, else generated once into the work
  dir with ``full_report_month.py --month 202609 --tier-scheme v2`` (a few
  minutes; needs the 202609 inputs on this machine).
- Templates: the August final (a V1 template, 26-08-reports/) and the
  September final (26-09-reports/; hand-rebuilt Handheld $100+/- tabs, no
  sub-tier tabs, 10-row Summary table).
- Pre-change code for the V1 regression: ``git archive`` of
  $TEMPLATE_FILL_BASELINE_REF (default: the commit that started tracking the
  filler unchanged), run in a subprocess.
- Work dir: $TEMPLATE_FILL_TEST_DIR, else a fresh temp dir.
"""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
import zipfile
from pathlib import Path

from openpyxl import Workbook, load_workbook
from openpyxl.chart import BarChart, PieChart, Reference
from openpyxl.drawing.spreadsheet_drawing import AnchorMarker, OneCellAnchor
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import quote_sheetname
from openpyxl.worksheet.table import Table

from template_fill.config import (
    CATEGORY_ORDER,
    CATEGORY_TABS,
    LISTING_SOURCE_SHEETS,
    VISIBLE_SHEETS,
    layout_for,
    layout_for_month,
)
from template_fill.main import _stage_names, build_monthly_output
from template_fill.raw_loader import RawData
from template_fill.scheme_upgrade import find_sections, summary_row_kind, upgrade_template
from template_fill.sheet_ops import chart_refs, delete_rows, insert_rows, shift_formula, RowShift
from template_fill.validate import validate_workbook

SCRIPT_DIR = Path(__file__).resolve().parent
PACKAGE_DIR = SCRIPT_DIR.parent
REPO_DIR = PACKAGE_DIR.parent
PYTHON = sys.executable
MONTH = "202609"
BASELINE_REF = os.environ.get("TEMPLATE_FILL_BASELINE_REF", "4d05c75")
V1_TEMPLATE = PACKAGE_DIR / "26-08-reports" / "26-09-03 Amazon Competitor Analysis August.xlsx"
SEP_TEMPLATE = PACKAGE_DIR / "26-09-reports" / "26-11-01 Amazon Competitor Analysis September.xlsx"
BRAND_HEADERS = SCRIPT_DIR / "brand_header_assets" / "analysis"
RAW_NAMES = ("summary.xlsx", "Amazon Competitor Report.xlsx")

V2_TABS = [
    "Summary", "Top 50",
    "Tablet Total", "Tablet $800+", "Tablet $400-$800", "Tablet $400-",
    "Tablet $300+", "Tablet $200-$300", "Tablet $200-",
    "Handheld Total", "Handheld $100+", "Handheld $100-",
    "Handheld $65+", "Handheld $35-$65", "Handheld $35-",
    "Dongle", "Other Tools",
    "Ancel", "AUTEL", "Foxwell", "iCarsoft", "LAUNCH", "TOPDON", "Thinkcar", "XTOOL",
]
NEW_TABS = {
    "Tablet $300+": "Tablet $400-",
    "Tablet $200-$300": "Tablet $400-",
    "Tablet $200-": "Tablet $400-",
    "Handheld $65+": "Handheld $100-",
    "Handheld $35-$65": "Handheld $100-",
    "Handheld $35-": "Handheld $100-",
}


# ------------------------------------------------------------------ fixtures


class _Fixtures:
    _work: Path | None = None
    _temp: tempfile.TemporaryDirectory | None = None
    _v2_raw: Path | None = None
    _v1_raw: Path | None = None

    @classmethod
    def work(cls) -> Path:
        if cls._work is None:
            env = os.environ.get("TEMPLATE_FILL_TEST_DIR")
            if env:
                cls._work = Path(env)
                cls._work.mkdir(parents=True, exist_ok=True)
            else:
                cls._temp = tempfile.TemporaryDirectory(prefix="template_fill_scheme_")
                cls._work = Path(cls._temp.name)
        return cls._work

    @classmethod
    def template(cls, source: Path) -> Path:
        if not source.exists():
            raise unittest.SkipTest(f"template not found: {source}")
        dest = cls.work() / "templates" / source.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copy2(source, dest)
        return dest

    @classmethod
    def _raw_month_and_labels(cls, raw_dir: Path) -> tuple[str, list[str]]:
        from month_context import infer_month_context

        ctx = infer_month_context(raw_dir / RAW_NAMES[1])
        raw = RawData.load(raw_dir / RAW_NAMES[0], raw_dir / RAW_NAMES[1])
        return f"{ctx.year}{ctx.month:02d}", raw.total_category_labels()

    @classmethod
    def v1_raw(cls) -> Path:
        if cls._v1_raw is None:
            source = Path(os.environ.get("TEMPLATE_FILL_V1_RAW_DIR", PACKAGE_DIR / "script output reports"))
            if not all((source / name).exists() for name in RAW_NAMES):
                raise unittest.SkipTest(f"V1 raw outputs not found in {source}")
            month, labels = cls._raw_month_and_labels(source)
            if month != MONTH or labels != list(layout_for("v1").summary_labels):
                raise unittest.SkipTest(f"{source} no longer holds the {MONTH} V1 raw run (month {month})")
            dest = cls.work() / "raw_v1"
            dest.mkdir(parents=True, exist_ok=True)
            for name in RAW_NAMES:
                shutil.copy2(source / name, dest / name)
            cls._v1_raw = dest
        return cls._v1_raw

    @classmethod
    def v2_raw(cls) -> Path:
        if cls._v2_raw is None:
            env = os.environ.get("TEMPLATE_FILL_V2_RAW_DIR")
            dest = cls.work() / "raw_v2"
            if env:
                source = Path(env)
                dest.mkdir(parents=True, exist_ok=True)
                for name in RAW_NAMES:
                    shutil.copy2(source / name, dest / name)
            elif not all((dest / name).exists() for name in RAW_NAMES):
                dest.mkdir(parents=True, exist_ok=True)
                cmd = [
                    PYTHON, str(SCRIPT_DIR / "full_report_month.py"), "--month", MONTH, "--tier-scheme", "v2",
                    "--out-report", str(dest / RAW_NAMES[1]), "--out-summary", str(dest / RAW_NAMES[0]),
                    "--out-dashboard-json", str(dest / "dashboard_snapshot_rows.json"),
                    "--amazon-obd2-dir", str(SCRIPT_DIR / "runs" / MONTH / "obd2_carryover_zero"),
                ]
                proc = subprocess.run(cmd, cwd=PACKAGE_DIR, capture_output=True, text=True)
                if proc.returncode != 0:
                    raise unittest.SkipTest(f"could not generate V2 raw outputs: {proc.stderr[-800:]}")
            month, labels = cls._raw_month_and_labels(dest)
            if month != MONTH or labels != list(layout_for("v2").summary_labels):
                raise unittest.SkipTest(f"{dest} is not a {MONTH} V2 raw run")
            cls._v2_raw = dest
        return cls._v2_raw


def _run_build(template: Path, raw_dir: Path, out_dir: Path, *, code_dir: Path = SCRIPT_DIR, scheme_kwargs: str = "") -> Path:
    """One filler build in a fresh interpreter: the filler's chart-XML patcher
    registers ElementTree namespaces process-wide, which corrupts the drawing
    XML of a second workbook saved by the same process (pre-existing; the
    production entry points build one Analysis workbook per process)."""
    code = textwrap.dedent(
        f"""
        import sys
        from pathlib import Path
        sys.path[:0] = [{str(code_dir)!r}, {str(SCRIPT_DIR)!r}]
        from template_fill.main import build_monthly_output
        print(build_monthly_output(month_label=None, month_name=None, date_tag="99-99-99",
            template=Path({str(template)!r}), raw_summary=Path({str(raw_dir / RAW_NAMES[0])!r}),
            raw_report=Path({str(raw_dir / RAW_NAMES[1])!r}), out_dir=Path({str(out_dir)!r}),
            brand_header_dir=Path({str(BRAND_HEADERS)!r}){scheme_kwargs}))
        """
    )
    proc = subprocess.run([PYTHON, "-c", code], capture_output=True, text=True, cwd=str(_Fixtures.work()))
    if proc.returncode != 0:
        raise AssertionError(f"build failed ({template.name}):\n{proc.stderr[-3000:]}")
    return Path(proc.stdout.strip().splitlines()[-1])


def _build(template: Path, raw_dir: Path, out_dir: Path, *, tier_scheme: str = "auto") -> Path:
    return _run_build(template, raw_dir, out_dir, scheme_kwargs=f", month={MONTH!r}, tier_scheme={tier_scheme!r}")


def _zip_differences(a: Path, b: Path) -> list[str]:
    with zipfile.ZipFile(a) as za, zipfile.ZipFile(b) as zb:
        names_a, names_b = set(za.namelist()), set(zb.namelist())
        diffs = sorted(names_a ^ names_b)
        diffs += [n for n in sorted(names_a & names_b) if n != "docProps/core.xml" and za.read(n) != zb.read(n)]
    return diffs


def _fill_kind(cell) -> str:
    fill = cell.fill
    if fill is None or fill.fill_type is None:
        return "none"
    color = fill.fgColor
    if color.type == "rgb":
        return f"rgb:{color.rgb}"
    return f"theme{color.theme}:{round(color.tint or 0.0, 2)}"


# --------------------------------------------------------------- fast tests


class SchemeLayoutTest(unittest.TestCase):
    def test_v1_layout_matches_the_legacy_constants(self) -> None:
        v1 = layout_for("v1")
        self.assertEqual(list(v1.visible_sheets), VISIBLE_SHEETS)
        self.assertEqual(list(v1.category_order), CATEGORY_ORDER)
        self.assertEqual(list(v1.category_tabs.items()), list(CATEGORY_TABS.items()))
        self.assertEqual(v1.listing_source_sheets, LISTING_SOURCE_SHEETS)
        self.assertEqual(
            v1.parent_sections,
            {
                "Tablet Total": ("Tablet $800+", "Tablet $400-$800", "Tablet $400-"),
                "Handheld Total": ("Handheld $75+", "Handheld $75-"),
            },
        )
        self.assertEqual(v1.summary_last_row, 13)
        self.assertTrue(v1.is_legacy)

    def test_v2_tab_order_sections_and_links(self) -> None:
        v2 = layout_for("v2")
        self.assertEqual(list(v2.visible_sheets), V2_TABS)
        self.assertEqual(
            v2.parent_sections,
            {
                "Tablet Total": ("Tablet $800+", "Tablet $400-$800", "Tablet $400-"),
                "Tablet $400-": ("Tablet $300+", "Tablet $200-$300", "Tablet $200-"),
                "Handheld Total": ("Handheld $100+", "Handheld $100-"),
                "Handheld $100-": ("Handheld $65+", "Handheld $35-$65", "Handheld $35-"),
            },
        )
        for child, parent in NEW_TABS.items():
            self.assertEqual(v2.child_section_links[child], (parent, child))
        self.assertEqual(v2.child_section_links["Tablet $400-"], ("Tablet Total", "Tablet $400-"))
        self.assertEqual(v2.child_section_links["Handheld $100+"], ("Handheld Total", "Handheld $100+"))
        # parents are linked before their sub-tiers
        order = list(v2.child_section_links)
        self.assertLess(order.index("Tablet $400-"), order.index("Tablet $300+"))
        self.assertLess(order.index("Handheld $100-"), order.index("Handheld $65+"))
        self.assertEqual(len(v2.summary_labels), 16)
        self.assertEqual(v2.summary_last_row, 19)
        self.assertEqual(
            list(v2.category_order),
            ["Tablet $800+", "Tablet $400-$800", "Tablet $400-", "Total Tablet", "Handheld $100+",
             "Handheld $100-", "Total Handheld", "Total Dongle", "Total Other Tools", "Total"],
        )
        self.assertEqual(v2.total_tabs, {"Tablet Total", "Handheld Total", "Dongle", "Other Tools"})
        self.assertFalse(v2.is_legacy)

    def test_layout_follows_the_month(self) -> None:
        self.assertEqual(layout_for_month("202609").name, "v1")
        self.assertEqual(layout_for_month("202610").name, "v2")
        self.assertEqual(layout_for_month("202609", "v2").name, "v2")
        self.assertEqual(layout_for_month(None).name, "v1")

    def test_staging_names_unique_for_v2_and_unchanged_for_v1(self) -> None:
        v2_names = _stage_names(list(layout_for("v2").category_tabs), legacy=False)
        self.assertEqual(len(set(v2_names.values())), len(v2_names))
        self.assertEqual(v2_names["Handheld $100+"], "h__100p")
        self.assertEqual(v2_names["Handheld $100-"], "h__100m")
        for name in v2_names.values():
            for suffix in ("ov", "rev", "unit"):
                self.assertLessEqual(len(f"_stg_c_{name}_{suffix}"), 31)
        v1_names = _stage_names(list(layout_for("v1").category_tabs), legacy=True)
        # historical names kept byte-for-byte (including the $75+/- collision)
        self.assertEqual(v1_names["Handheld $75+"], "h__75")
        self.assertEqual(v1_names["Handheld $75-"], "h__75")
        self.assertEqual(v1_names["Tablet $400-$800"], "t__400__800")


class SheetOpsTest(unittest.TestCase):
    def _sheet(self):
        wb = Workbook()
        ws = wb.active
        ws.title = "Summary"
        for row in range(1, 31):
            ws.cell(row, 1, f"r{row}")
            ws.cell(row, 2, row)
        ws["C25"] = "=SUM(B4:B13)"
        ws["C26"] = "=B13+B20"
        other = wb.create_sheet("Other Tab")
        other["A1"] = "=Summary!A4"
        other["A2"] = "=Summary!B13"
        other["A3"] = "='Summary'!B20"
        other["A4"] = "=B13"  # its own sheet: untouched
        ws.merge_cells("A20:D20")
        ws.row_dimensions[20].height = 26
        table = Table(displayName="T1", ref="A22:B24")
        ws.add_table(table)
        ws.conditional_formatting.add("C4:L13", CellIsRule(operator="lessThan", formula=["0"]))
        bar = BarChart()
        bar.add_data(Reference(ws, min_col=2, min_row=4, max_row=13))
        bar.set_categories(Reference(ws, min_col=1, min_row=4, max_row=13))
        ws.add_chart(bar, OneCellAnchor(_from=AnchorMarker(col=4, row=13)))  # E14
        return wb, ws, other, bar

    def test_insert_rows_keeps_everything_in_step(self) -> None:
        wb, ws, other, bar = self._sheet()
        insert_rows(ws, 13, 6)
        self.assertEqual(ws["A19"].value, "r13")
        self.assertEqual(ws["C31"].value, "=SUM(B4:B19)")  # range grows
        self.assertEqual(ws["C32"].value, "=B19+B26")
        self.assertEqual(other["A1"].value, "=Summary!A4")
        self.assertEqual(other["A2"].value, "=Summary!B19")
        self.assertEqual(other["A3"].value, "='Summary'!B26")
        self.assertEqual(other["A4"].value, "=B13")
        self.assertIn("A26:D26", {str(r) for r in ws.merged_cells.ranges})
        self.assertEqual(ws.row_dimensions[26].height, 26)
        self.assertEqual(ws.tables["T1"].ref, "A28:B30")
        self.assertEqual([str(cf.sqref) for cf in ws.conditional_formatting], ["C4:L19"])
        self.assertEqual(sorted(r.f for r in chart_refs(bar)), ["'Summary'!$A$4:$A$19", "'Summary'!$B$4:$B$19"])
        self.assertEqual(bar.anchor._from.row, 19)  # E14 (0-based 13) moved 6 rows down

    def test_delete_rows_shrinks_ranges(self) -> None:
        wb, ws, other, _bar = self._sheet()
        delete_rows(ws, 7, 3)
        self.assertEqual(ws["A7"].value, "r10")
        self.assertEqual(ws["C22"].value, "=SUM(B4:B10)")
        self.assertEqual(other["A2"].value, "=Summary!B10")
        self.assertEqual(ws.tables["T1"].ref, "A19:B21")
        self.assertEqual([str(cf.sqref) for cf in ws.conditional_formatting], ["C4:L10"])

    def test_shift_formula_cases(self) -> None:
        shift = RowShift(13, 6)
        cases = {
            "=Summary!A4": "=Summary!A4",
            "=Summary!$A$13": "=Summary!$A$19",
            "=(Summary!$A$7,Summary!$A$10:$A$12)": "=(Summary!$A$7,Summary!$A$10:$A$12)",
            "=SUM(Summary!A4:A13)": "=SUM(Summary!A4:A19)",
            "=Summary!13:13": "=Summary!19:19",
            "=Summary!A:A": "=Summary!A:A",
            "='Tablet Total'!A13": "='Tablet Total'!A13",
        }
        for formula, expected in cases.items():
            self.assertEqual(
                shift_formula(formula, formula_sheet="X", target_sheet="Summary", shift=shift), expected, formula
            )


# --------------------------------------------------------------- build tests


class V1RegressionTest(unittest.TestCase):
    """Scheme V1 (months < 202610) builds byte-for-byte what the pre-change
    filler built: every package part identical except docProps/core.xml
    (timestamps)."""

    def _baseline_code(self) -> Path:
        dest = _Fixtures.work() / f"baseline_{BASELINE_REF}"
        script = dest / PACKAGE_DIR.name / "script"
        if (script / "template_fill" / "main.py").exists():
            return script
        rel = PACKAGE_DIR.relative_to(REPO_DIR) / "script"
        paths = [str(rel / "template_fill"), str(rel / "xlsx_rowshift.py")]
        verify = subprocess.run(
            ["git", "-C", str(REPO_DIR), "rev-parse", "--verify", f"{BASELINE_REF}^{{commit}}"], capture_output=True
        )
        if verify.returncode != 0:
            self.skipTest(f"baseline ref {BASELINE_REF} not available (set TEMPLATE_FILL_BASELINE_REF)")
        dest.mkdir(parents=True, exist_ok=True)
        archive = subprocess.run(
            ["git", "-C", str(REPO_DIR), "archive", BASELINE_REF, "--", *paths], capture_output=True, check=True
        )
        subprocess.run(["tar", "-x", "-C", str(dest)], input=archive.stdout, check=True)
        return script

    def _baseline_build(self, template: Path, raw_dir: Path, out_dir: Path) -> Path:
        return _run_build(template, raw_dir, out_dir, code_dir=self._baseline_code())

    def _assert_identical(self, template_source: Path, label: str) -> None:
        raw = _Fixtures.v1_raw()
        template = _Fixtures.template(template_source)
        work = _Fixtures.work() / f"v1_{label}"
        new = _build(template, raw, work / "new")
        old = self._baseline_build(template, raw, work / "baseline")
        self.assertEqual(_zip_differences(new, old), [], f"V1 build from {template.name} differs from the pre-change filler")
        wb, source = load_workbook(new), load_workbook(template)
        try:
            self.assertEqual(validate_workbook(wb, month=MONTH), [])
            # V1 keeps the template's positional Summary styling (no Total Dongle rule)
            self.assertEqual(wb["Summary"]["A11"].value, "Total Dongle")
            self.assertEqual(_fill_kind(wb["Summary"]["B11"]), _fill_kind(source["Summary"]["B11"]))
        finally:
            wb.close()
            source.close()

    def test_v1_from_the_august_template_is_unchanged(self) -> None:
        self._assert_identical(V1_TEMPLATE, "august")

    def test_v1_from_the_staging_template_is_unchanged(self) -> None:
        self._assert_identical(PACKAGE_DIR / "_template" / "Amazon Competitor Analysis _8BRAND_STAGING_TEMPLATE.xlsx", "staging")


class V2BuildTest(unittest.TestCase):
    """September data built with scheme V2 from the September final (which has
    Handheld $100+/- but no sub-tier tabs and a 10-row Summary table)."""

    out: Path
    wb = None

    @classmethod
    def setUpClass(cls) -> None:
        raw = _Fixtures.v2_raw()
        template = _Fixtures.template(SEP_TEMPLATE)
        cls.raw = RawData.load(raw / RAW_NAMES[0], raw / RAW_NAMES[1])
        cls.out = _build(template, raw, _Fixtures.work() / "v2_sep", tier_scheme="v2")
        cls.wb = load_workbook(cls.out)

    @classmethod
    def tearDownClass(cls) -> None:
        if cls.wb is not None:
            cls.wb.close()

    def test_validates(self) -> None:
        self.assertEqual(validate_workbook(self.wb, month=MONTH, tier_scheme="v2"), [])
        self.assertEqual(validate_workbook(self.wb, month="202610"), [])

    def test_tab_order_and_new_tabs(self) -> None:
        visible = [ws.title for ws in self.wb.worksheets if ws.sheet_state == "visible"]
        self.assertEqual(visible, V2_TABS)
        for tab, parent in NEW_TABS.items():
            ws = self.wb[tab]
            self.assertEqual(len(ws._charts), 6, tab)
            self.assertEqual(len(ws.tables), 2, tab)
            self.assertEqual(ws["A1"].value, f"{tab} Monthly Summary")
            title_row = next(row for title, row, _t in find_sections(self.wb[parent]) if title == tab)
            self.assertEqual(ws["A3"].value, f"={quote_sheetname(parent)}!A{title_row}")
            self.assertEqual(find_sections(ws), [], f"{tab} must not carry sections")
            for chart in ws._charts:
                for ref in chart_refs(chart):
                    self.assertIn(quote_sheetname(tab), ref.f)
        names = [t.name.lower() for ws in self.wb.worksheets for t in ws.tables.values()]
        self.assertEqual(len(names), len(set(names)))

    def test_parents_have_the_subtier_sections(self) -> None:
        v2 = layout_for("v2")
        for tab, titles in v2.parent_sections.items():
            self.assertEqual([t for t, _r, _tot in find_sections(self.wb[tab])], list(titles), tab)

    def test_summary_table(self) -> None:
        ws = self.wb["Summary"]
        v2 = layout_for("v2")
        labels = [ws.cell(row, 1).value for row in range(4, 20)]
        self.assertEqual(labels, list(v2.summary_labels))
        self.assertIn(ws["A20"].value, (None, ""))
        for row, label in zip(range(4, 20), labels):
            kind = summary_row_kind(label, v2.subtier_labels)
            indent = ws.cell(row, 1).alignment.indent or 0
            if kind == "subtier":
                self.assertGreaterEqual(indent, 1, label)
                self.assertFalse(ws.cell(row, 2).font.bold, label)
                self.assertEqual(_fill_kind(ws.cell(row, 2)), "none", label)
            else:
                self.assertEqual(indent, 0, label)
        self.assertEqual(_fill_kind(ws["B17"]), "none")  # Total Dongle: unshaded in V2
        self.assertTrue(ws["B17"].font.bold)
        for row in (10, 16, 18):  # Total Tablet / Handheld / Other Tools
            self.assertEqual(_fill_kind(ws.cell(row, 2)), "theme0:-0.25", ws.cell(row, 1).value)
        self.assertEqual(_fill_kind(ws["B19"]), "rgb:FFB5A7D7")
        # the brand blocks moved down with the table (6 rows)
        self.assertIn("Summary - Revenue", ws["A51"].value)
        self.assertIn("Summary - Units", ws["A82"].value)
        self.assertEqual(ws["A79"].value, "Total")
        self.assertEqual(ws["B79"].value, "=SUM(B52:B77)")

    def test_summary_pies_point_at_labelled_total_rows(self) -> None:
        ws = self.wb["Summary"]
        pies = [c for c in ws._charts if isinstance(c, PieChart)]
        bars = [c for c in ws._charts if isinstance(c, BarChart)]
        self.assertEqual((len(pies), len(bars)), (2, 4))
        for pie in pies:
            for ref in chart_refs(pie):
                self.assertRegex(ref.f, r"^\(Summary!\$[A-L]\$10,Summary!\$[A-L]\$16:\$[A-L]\$18\)$")
        self.assertEqual([ws.cell(r, 1).value for r in (10, 16, 17, 18)],
                         ["Total Tablet", "Total Handheld", "Total Dongle", "Total Other Tools"])
        for bar in bars:
            for ref in chart_refs(bar):
                self.assertRegex(ref.f, r"^Summary!\$[A-L]\$4:\$[A-L]\$19$")

    def test_subtier_overview_totals_equal_parent_section_totals(self) -> None:
        v2 = layout_for("v2")
        summary = self.wb["Summary"]
        summary_row = {summary.cell(r, 1).value: r for r in range(4, 20)}
        for child, (parent, title) in v2.child_section_links.items():
            parent_ws, child_ws = self.wb[parent], self.wb[child]
            title_row, total_row = next((r, t) for s, r, t in find_sections(parent_ws) if s == title)
            n = total_row - title_row - 1  # body rows + Total
            prefix = f"={quote_sheetname(parent)}!"
            # the child's overview Total row IS the parent's section Total row
            self.assertEqual(child_ws.cell(5 + n - 1, 5).value, f"{prefix}E{total_row}", child)
            self.assertEqual(child_ws.cell(5 + n - 1, 9).value, f"{prefix}I{total_row}", child)
            self.assertIn(child_ws.cell(5 + n, 1).value, (None, ""), child)
            # ... whose SUMs cover exactly the section body, which adds up to the Summary row
            self.assertEqual(parent_ws.cell(total_row, 5).value, f"=SUM(E{title_row + 2}:E{total_row - 1})")
            self.assertEqual(parent_ws.cell(total_row, 1).value, f"=Summary!A{summary_row[title]}")
            qty = sum(parent_ws.cell(r, 5).value or 0 for r in range(title_row + 2, total_row))
            rev = sum(parent_ws.cell(r, 9).value or 0 for r in range(title_row + 2, total_row))
            self.assertAlmostEqual(qty, summary.cell(summary_row[title], 5).value, places=6, msg=title)
            self.assertAlmostEqual(rev, summary.cell(summary_row[title], 9).value, delta=0.01, msg=title)
        for parent in ("Tablet $400-", "Handheld $100-"):
            kids = [summary.cell(summary_row[k], 5).value for k in v2.parent_sections[parent]]
            self.assertEqual(sum(kids), summary.cell(summary_row[parent], 5).value, parent)

    def test_brand_tabs_keep_the_ten_parent_level_rows(self) -> None:
        allowed = set(layout_for("v2").category_order)
        for display in ("Ancel", "AUTEL", "Foxwell", "iCarsoft", "LAUNCH", "TOPDON", "Thinkcar", "XTOOL"):
            ws = self.wb[display]
            labels = [ws.cell(r, 1).value for r in range(8, 18) if ws.cell(r, 1).value]
            self.assertTrue(set(labels) <= allowed, (display, labels))
            self.assertEqual(labels[-1], "Total", display)

    def test_rebuilding_from_the_v2_output_is_a_no_op_upgrade(self) -> None:
        template = _Fixtures.work() / "templates" / "v2_output_as_template.xlsx"
        shutil.copy2(self.out, template)
        wb = load_workbook(template)
        try:
            self.assertFalse(upgrade_template(wb, layout_for("v2")).changed)
        finally:
            wb.close()
        second = _build(template, _Fixtures.v2_raw(), _Fixtures.work() / "v2_sep_again", tier_scheme="v2")
        wb2 = load_workbook(second)
        try:
            self.assertEqual(wb2.sheetnames, self.wb.sheetnames)
            for ws in self.wb.worksheets:
                if ws.sheet_state != "visible":
                    continue
                other = wb2[ws.title]
                self.assertEqual(len(other._charts), len(ws._charts), ws.title)
                self.assertEqual({t.name: t.ref for t in other.tables.values()}, {t.name: t.ref for t in ws.tables.values()})
                self.assertEqual({str(r) for r in other.merged_cells.ranges}, {str(r) for r in ws.merged_cells.ranges}, ws.title)
                self.assertEqual(
                    [sorted(r.f for r in chart_refs(c)) for c in other._charts],
                    [sorted(r.f for r in chart_refs(c)) for c in ws._charts],
                    ws.title,
                )
                for row in ws.iter_rows():
                    for cell in row:
                        twin = other[cell.coordinate]
                        self.assertEqual(twin.value, cell.value, f"{ws.title}!{cell.coordinate}")
                        self.assertEqual(_fill_kind(twin), _fill_kind(cell), f"{ws.title}!{cell.coordinate}")
        finally:
            wb2.close()
        # Only the per-build red-negatives conditional-format rule differs
        # (pre-existing: every build appends one per visible tab).
        for part in _zip_differences(self.out, second):
            self.assertRegex(part, r"^xl/worksheets/sheet\d+\.xml$")


class V2FromV1TemplateTest(unittest.TestCase):
    def test_v2_build_from_a_v1_template(self) -> None:
        out = _build(_Fixtures.template(V1_TEMPLATE), _Fixtures.v2_raw(), _Fixtures.work() / "v2_aug", tier_scheme="v2")
        wb = load_workbook(out)
        try:
            self.assertEqual(validate_workbook(wb, month=MONTH, tier_scheme="v2"), [])
            self.assertNotIn("Handheld $75+", wb.sheetnames)
            self.assertNotIn("Handheld $75-", wb.sheetnames)
            self.assertEqual([t for t, _r, _x in find_sections(wb["Handheld Total"])], ["Handheld $100+", "Handheld $100-"])
        finally:
            wb.close()

    def test_scheme_mismatch_fails_before_writing(self) -> None:
        out_dir = _Fixtures.work() / "mismatch"
        raw = _Fixtures.v1_raw()
        with self.assertRaisesRegex(ValueError, "price-tier scheme v2"):
            build_monthly_output(
                month_label=None, month_name=None, date_tag="99-99-99", template=_Fixtures.template(SEP_TEMPLATE),
                raw_summary=raw / RAW_NAMES[0], raw_report=raw / RAW_NAMES[1], out_dir=out_dir,
                brand_header_dir=BRAND_HEADERS, month=MONTH, tier_scheme="v2",
            )
        self.assertFalse(out_dir.exists() and any(out_dir.iterdir()))


if __name__ == "__main__":
    unittest.main()
