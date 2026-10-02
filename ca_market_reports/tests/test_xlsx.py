"""Workbook engine + builder tests (track T4: ca-workbooks).

Builds, from the normalized fixtures only (the loader/classifier are not needed):
  * both CA code-reader workbooks (report + analysis)
  * a US gauge workbook
  * a CA gauge workbook with the US fixture as benchmark
into tmp/ca_scratch/test_out/ and checks the formula/style/registry/manifest contracts of ca_common.

Run: ca_market_reports/run.sh -m unittest ca_market_reports.tests.test_xlsx -v
"""
from __future__ import annotations

import contextlib
import hashlib
import io
import json
import math
import re
import shutil
import unittest
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import openpyxl
import pandas as pd

from ca_market_reports import ca_common as C
from ca_market_reports import ca_xlsx_style as X
from ca_market_reports import build_ca_code_reader_report as CR
from ca_market_reports import build_gauge_report as G
from ca_market_reports import render_preview as RP

MONTH = "202609"
OUT = C.SCRATCH_DIR / "test_out"
RUNS = OUT / "runs"
CA_FIXTURE = C.FIXTURES_DIR / "normalized_rows.csv"
US_FIXTURE = C.FIXTURES_DIR / "normalized_rows_us.csv"
OWN_MODULES = ("ca_xlsx_style.py", "build_ca_code_reader_report.py", "build_gauge_report.py", "render_preview.py")
BUILD_MODULES = ("ca_xlsx_style.py", "build_ca_code_reader_report.py", "build_gauge_report.py")
CHART_NS = "http://schemas.openxmlformats.org/drawingml/2006/chart"
AXIS_TAGS = ("catAx", "valAx", "dateAx", "serAx")


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


class _Built:
    """Builds every workbook once for the whole module."""
    done = False

    @classmethod
    def ensure(cls):
        if cls.done:
            return
        if OUT.exists():
            shutil.rmtree(OUT)
        OUT.mkdir(parents=True)
        ca = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        us = X.dataset_from_normalized(X.read_normalized_csv(US_FIXTURE), "US", MONTH)
        with contextlib.redirect_stdout(io.StringIO()):
            cls.cr_paths = CR.build_code_reader_workbooks(ca, OUT, overwrite=True, dated_copy=False, runs_dir=RUNS,
                                                          input_paths=[CA_FIXTURE])
            cls.us_gauge = G.build_gauge_workbook(us, OUT, benchmark=None, overwrite=True, dated_copy=False, runs_dir=RUNS,
                                                  preclassified=True, input_paths=[US_FIXTURE])
            cls.ca_gauge = G.build_gauge_workbook(ca, OUT, benchmark=us, overwrite=True, dated_copy=False, runs_dir=RUNS,
                                                  preclassified=True, input_paths=[CA_FIXTURE, US_FIXTURE])
        cls.ca_rows = X.read_normalized_csv(CA_FIXTURE)
        cls.us_rows = X.read_normalized_csv(US_FIXTURE)
        cls.reg = {m: json.loads(C.run_file(RUNS, MONTH, "table_registry", m, "json").read_text()) for m in ("CA", "US")}
        cls.done = True


def _all_paths():
    return list(_Built.cr_paths) + [_Built.ca_gauge, _Built.us_gauge]


def _tables(market: str, workbook: str):
    return [t for t in _Built.reg[market]["tables"] if t["workbook"] == workbook]


def _market_of(path: Path) -> str:
    return path.name.split("_", 1)[0]


class TestBuildOutputs(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _Built.ensure()

    # ---------------------------------------------------------------- names / sheets
    def test_output_names_and_sheet_order(self):
        names = [p.name for p in _Built.cr_paths]
        self.assertEqual(names, [C.cr_report_name("CA", MONTH), C.cr_analysis_name("CA", MONTH)])
        self.assertEqual(_Built.ca_gauge.name, C.gauge_report_name("CA", MONTH))
        self.assertEqual(_Built.us_gauge.name, C.gauge_report_name("US", MONTH))
        rep = openpyxl.load_workbook(_Built.cr_paths[0]).sheetnames
        self.assertEqual(rep[:3], list(C.CR_REPORT_FIXED_SHEETS))
        self.assertEqual(rep[-2:], list(C.CR_REPORT_TAIL_SHEETS))
        self.assertEqual(len(rep), 3 + min(C.CR_REPORT_BRAND_TABS, 10) + 2)   # fixture has exactly 10 non-Innova brands
        ana = openpyxl.load_workbook(_Built.cr_paths[1]).sheetnames
        self.assertEqual(ana, list(C.CR_ANALYSIS_SHEETS))
        cag = openpyxl.load_workbook(_Built.ca_gauge).sheetnames
        self.assertEqual(cag[:4], list(C.GAUGE_FIXED_SHEETS))
        self.assertEqual(cag[-5:], list(C.GAUGE_TAIL_SHEETS))
        tail = cag[-(5 + len(C.GAUGE_MODEL_SHEETS) + len(C.GAUGE_BENCHMARK_SHEETS)):-5]
        self.assertEqual(tail, list(C.GAUGE_MODEL_SHEETS + C.GAUGE_BENCHMARK_SHEETS))
        usg = openpyxl.load_workbook(_Built.us_gauge).sheetnames
        self.assertEqual(usg[:4], list(C.GAUGE_FIXED_SHEETS))
        self.assertEqual(usg[-5:], list(C.GAUGE_TAIL_SHEETS))
        for s in C.GAUGE_MODEL_SHEETS + C.GAUGE_BENCHMARK_SHEETS:
            self.assertNotIn(s, usg)

    def test_sheet_names_valid_and_unique(self):
        for p in _all_paths():
            names = openpyxl.load_workbook(p).sheetnames
            self.assertTrue(all(len(n) <= 31 for n in names), names)
            self.assertEqual(len({n.lower() for n in names}), len(names), names)
            self.assertFalse(any(re.search(r"[\[\]:*?/\\]", n) for n in names), names)

    # ---------------------------------------------------------------- charts
    def test_charts_registered_and_axes_kept(self):
        for p in _all_paths():
            tables = _tables(_market_of(p), p.name)
            charts = [c for t in tables for c in t["charts"]]
            with zipfile.ZipFile(p) as z:
                xmls = sorted(n for n in z.namelist() if re.match(r"xl/charts/chart\d+\.xml$", n))
                bodies = [z.read(n).decode("utf-8") for n in xmls]
            self.assertEqual(len(xmls), len(charts), f"{p.name}: registered {charts}")
            if p != _Built.cr_paths[1]:   # the Analysis workbook specifies no charts
                self.assertGreater(len(charts), 0, p.name)
            if p in (_Built.cr_paths[0], _Built.ca_gauge, _Built.us_gauge):
                summary = [c["type"] for t in tables if t["sheet"] == "Summary" for c in t["charts"]]
                self.assertEqual(sorted(summary), ["bar", "pie"], p.name)
            if p == _Built.ca_gauge:
                ladder = [c["type"] for t in tables if t["sheet"] == "Price Ladder (Model A)" for c in t["charts"]]
                self.assertEqual(ladder, ["scatter"])
            # namespace-aware: openpyxl writes the chart namespace as the default namespace (<delete val="0"/> == <c:delete val="0"/>)
            trees = [ET.fromstring(b) for b in bodies]
            with_axes = [t for t in trees if any(t.find(f".//{{{CHART_NS}}}{ax}") is not None for ax in AXIS_TAGS)]
            self.assertEqual(len(with_axes), sum(1 for c in charts if c["has_axes"]), p.name)
            for t in with_axes:
                for ax_tag in AXIS_TAGS:
                    for ax in t.iter(f"{{{CHART_NS}}}{ax_tag}"):
                        d = ax.find(f"{{{CHART_NS}}}delete")
                        self.assertIsNotNone(d, f"{p.name}: {ax_tag} without <c:delete>")
                        self.assertEqual(d.get("val"), "0", p.name)
                        self.assertEqual(ax.find(f"{{{CHART_NS}}}tickLblPos").get("val"), "nextTo", p.name)
            for t in trees:
                self.assertEqual(t.find(f"{{{CHART_NS}}}chart/{{{CHART_NS}}}plotVisOnly").get("val"), "0", p.name)
            for b, t in zip(bodies, trees):
                kinds = {el.tag.split("}")[1] for el in t.iter() if el.tag.endswith(("barChart", "pieChart"))}
                if kinds:   # bar/pie: one colour per point from BRAND_PALETTE
                    fills = [el.get("val") for el in t.iter("{http://schemas.openxmlformats.org/drawingml/2006/main}srgbClr")]
                    self.assertTrue(fills and set(fills) <= set(C.BRAND_PALETTE), p.name)
            for c in charts:
                self.assertIn(c["type"], ("bar", "pie", "scatter"))
                self.assertRegex(c["anchor"], r"^[A-Z]{1,3}\d+$")

    def test_chart_anchor_beside_table_header(self):
        for p in _all_paths():
            for t in _tables(_market_of(p), p.name):
                for c in t["charts"]:
                    m = re.match(r"^([A-Z]+)(\d+)$", c["anchor"])
                    col = openpyxl.utils.column_index_from_string(m.group(1))
                    self.assertEqual(int(m.group(2)), t["header_row"], (p.name, t["sheet"], c))
                    self.assertGreaterEqual(col, t["last_col"] + 2, (p.name, t["sheet"], c))

    # ---------------------------------------------------------------- formulas / text
    def test_only_hyperlink_formulas_with_row_asin(self):
        for p in _all_paths():
            market = _market_of(p)
            tables = _tables(market, p.name)
            wb = openpyxl.load_workbook(p)
            n_links = 0
            for ws in wb.worksheets:
                sheet_tables = [t for t in tables if t["sheet"] == ws.title]
                for row in ws.iter_rows():
                    for cell in row:
                        if cell.data_type != "f":
                            continue
                        m = None
                        for rx in C.ALLOWED_FORMULA_RES:
                            m = rx.match(str(cell.value))
                            if m:
                                break
                        self.assertIsNotNone(m, f"{p.name}!{ws.title}!{cell.coordinate}: {cell.value}")
                        owner = [t for t in sheet_tables if t["first_data_row"] and t["first_data_row"] <= cell.row <= t["last_data_row"]]
                        self.assertEqual(len(owner), 1, f"{p.name}!{ws.title}!{cell.coordinate}")
                        t = owner[0]
                        asin_col = t["first_col"] + t["columns"].index("ASIN")
                        self.assertEqual(ws.cell(cell.row, asin_col).value, m.group("asin"), f"{ws.title}!{cell.coordinate}")
                        header = ws.cell(t["header_row"], cell.column).value
                        if m.group("tld") == "com":
                            self.assertTrue(market == "US" or (ws.title in C.CA_SHEETS_ALLOWING_US and "US" in header),
                                            f"{p.name}!{ws.title}!{cell.coordinate} header={header}")
                        else:
                            self.assertEqual(market, "CA", f"{p.name}!{ws.title}!{cell.coordinate}")
                        self.assertEqual(cell.font.color.rgb[-6:], C.COLOR_LINK)
                        n_links += 1
            self.assertGreater(n_links, 0, p.name)

    def test_formula_like_titles_stay_strings(self):
        # the US fixture carries a product title "=1+1 trap ..."
        wb = openpyxl.load_workbook(_Built.us_gauge)
        hits = [c for ws in wb.worksheets for row in ws.iter_rows() for c in row
                if isinstance(c.value, str) and c.value.startswith("=1+1 trap")]
        self.assertGreater(len(hits), 0)
        for c in hits:
            self.assertEqual(c.data_type, "s", c.coordinate)
        # engine level: a table title and a text cell starting with "=" are strings
        book = X.Book("engine_trap.xlsx", C.MARKETS["CA"])
        ws = book.sheet("Summary")
        rows = pd.DataFrame([{"asin": "B0TESTTRP1", "title": "=1+1 trap", "rev": 1.0, "market": "CA"}])
        spec = X.TableSpec(sheet="Summary", role="summary_brands", title="=SUM(A1:A2) title trap",
                           columns=[X.ColumnSpec("ASIN", "asin", "text", 12), X.ColumnSpec("Product Name", "title", "text", 30),
                                    X.ColumnSpec("Monthly Rev (CAD)", "rev", "money", 12), X.ColumnSpec("Link", "asin", "link", 20)],
                           rows=rows, total_row=None, residual_row=None, allowed_markets=("CA",))
        tr = book.table(ws, spec, 1)
        path = OUT / "engine_trap.xlsx"
        book.save(path)
        ws2 = openpyxl.load_workbook(path)["Summary"]
        self.assertEqual(ws2.cell(tr.header_row - 1, 1).data_type, "s")
        self.assertEqual(ws2.cell(tr.header_row - 1, 1).value, "=SUM(A1:A2) title trap")
        self.assertEqual(ws2.cell(tr.first_data_row, 2).data_type, "s")
        self.assertEqual(ws2.cell(tr.first_data_row, 2).value, "=1+1 trap")
        self.assertEqual(ws2.cell(tr.first_data_row, 4).value,
                         '=HYPERLINK("https://amazon.ca/dp/B0TESTTRP1","Amazon.ca - B0TESTTRP1")')

    def test_no_error_tokens(self):
        for p in _all_paths():
            wb = openpyxl.load_workbook(p)
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    for v in row:
                        if isinstance(v, str):
                            self.assertFalse(any(tok in v for tok in ("#REF!", "#DIV/0!", "#NAME?", "#VALUE!")), (p.name, ws.title, v))
                        if isinstance(v, float):
                            self.assertTrue(math.isfinite(v), (p.name, ws.title, v))

    # ---------------------------------------------------------------- currency
    def test_money_formats_carry_market_currency(self):
        for p in _all_paths():
            market = _market_of(p)
            wb = openpyxl.load_workbook(p)
            ca_fmt = 0
            for ws in wb.worksheets:
                hdr_by_col = {}
                for t in _tables(market, p.name):
                    if t["sheet"] == ws.title and t["header_row"]:
                        for i, h in enumerate(t["columns"]):
                            hdr_by_col.setdefault(t["first_col"] + i, []).append(h)
                for row in ws.iter_rows():
                    for c in row:
                        fmt = c.number_format or ""
                        if "$" not in fmt:
                            continue
                        if market == "US":
                            self.assertNotIn("CA$", fmt, f"{p.name}!{ws.title}!{c.coordinate}")
                        elif "CA$" in fmt:
                            ca_fmt += 1
                        else:
                            self.assertIn(ws.title, C.CA_SHEETS_ALLOWING_US, f"{p.name}!{ws.title}!{c.coordinate} {fmt}")
                            self.assertTrue(any("(USD)" in h for h in hdr_by_col.get(c.column, [])),
                                            f"{p.name}!{ws.title}!{c.coordinate} {hdr_by_col.get(c.column)}")
            if market == "CA":
                self.assertGreater(ca_fmt, 0, p.name)

    def test_headers_carry_currency(self):
        for p in _all_paths():
            market = _market_of(p)
            ccy = C.MARKETS[market].currency
            for t in _tables(market, p.name):
                for h in t["columns"]:
                    if "(CAD)" in h or "(USD)" in h:
                        if market == "US":
                            self.assertNotIn("(CAD)", h, (p.name, t["sheet"], h))
                        elif "(USD)" in h:
                            self.assertIn(t["sheet"], C.CA_SHEETS_ALLOWING_US, (p.name, t["sheet"], h))
                self.assertFalse(any("{ccy}" in h for h in t["columns"]), (p.name, t["sheet"]))
            self.assertTrue(any(f"({ccy})" in h for t in _tables(market, p.name) for h in t["columns"]))

    # ---------------------------------------------------------------- totals / shares / residuals
    def _summary_check(self, path: Path, dataset: pd.DataFrame):
        market = _market_of(path)
        t = [t for t in _tables(market, path.name) if t["sheet"] == "Summary" and t["role"] == "summary_brands"][0]
        ws = openpyxl.load_workbook(path)["Summary"]
        col = {h: t["first_col"] + i for i, h in enumerate(t["columns"])}
        ccy = C.MARKETS[market].currency
        rev_c, units_c = col[f"Monthly Rev ({ccy})"], col["Monthly Units"]
        share_c, list_c = col["Monthly Rev Market Share %"], col["# of Listings"]
        tr = t["total_row"]
        self.assertAlmostEqual(ws.cell(tr, rev_c).value, float(dataset["revenue_month"].sum()), places=6)
        self.assertAlmostEqual(ws.cell(tr, units_c).value, float(dataset["units_month"].sum()), places=6)
        self.assertEqual(ws.cell(tr, list_c).value, dataset["asin"].nunique())
        last = t["residual_row"] or t["last_data_row"]
        shares = [ws.cell(r, share_c).value for r in range(t["first_data_row"], last + 1)]
        self.assertAlmostEqual(sum(shares), 1.0, delta=1e-9)
        revs = [ws.cell(r, rev_c).value for r in range(t["first_data_row"], last + 1)]
        self.assertAlmostEqual(sum(revs), ws.cell(tr, rev_c).value, places=6)
        self.assertEqual(ws.cell(tr, 1).value, C.TOTAL_ROW_LABEL)
        self.assertEqual(ws.cell(tr, 1).fill.fgColor.rgb[-6:], C.FILL_TOTAL)
        # hidden rows are exactly the zero-revenue data rows (never deleted)
        for r in range(t["first_data_row"], t["last_data_row"] + 1):
            self.assertEqual(bool(ws.row_dimensions[r].hidden), ws.cell(r, rev_c).value == 0, (path.name, r))
        return t, ws

    def test_cr_summary_totals_full_dataset(self):
        rows = _Built.ca_rows[_Built.ca_rows["source_set"].isin(["code_reader", "both"])]
        t, ws = self._summary_check(_Built.cr_paths[0], rows)
        # Innova row red
        brand_cells = [ws.cell(r, 1) for r in range(t["first_data_row"], t["last_data_row"] + 1)]
        innova = [c for c in brand_cells if c.value == "Innova"]
        self.assertEqual(len(innova), 1)
        self.assertEqual(innova[0].font.color.rgb[-6:], C.COLOR_INNOVA)

    def test_gauge_summary_totals_core_devices(self):
        for path, rows in ((_Built.ca_gauge, _Built.ca_rows), (_Built.us_gauge, _Built.us_rows)):
            core = rows[rows["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)]
            self._summary_check(path, core)

    def test_residual_rows_when_truncated(self):
        cr = _Built.ca_rows[_Built.ca_rows["source_set"].isin(["code_reader", "both"])]
        shown, residual, total = X.brand_summary(cr, top_n=3)
        self.assertEqual(len(shown), 3)
        n_brands = cr["brand_key"].nunique()
        self.assertEqual(residual["brand"], C.RESIDUAL_ROW_LABEL.format(noun="brands", n=n_brands - 3))
        self.assertAlmostEqual(shown["share"].sum() + residual["share"], 1.0, delta=1e-9)
        self.assertAlmostEqual(shown["rev"].sum() + residual["rev"], total["rev"], places=6)
        self.assertEqual(total["listings"], cr["asin"].nunique())
        # every truncated registered table has a residual row labelled "Other <noun> (n)"
        seen = 0
        for p in _all_paths():
            wb = openpyxl.load_workbook(p)
            for t in _tables(_market_of(p), p.name):
                if t["residual_row"]:
                    ws = wb[t["sheet"]]
                    cells = [ws.cell(t["residual_row"], c) for c in range(t["first_col"], t["last_col"] + 1)]
                    labels = [c for c in cells if isinstance(c.value, str) and re.match(r"^Other (brands|listings) \(\d+\)$", c.value)]
                    self.assertEqual(len(labels), 1, (p.name, t["sheet"], [c.value for c in cells]))
                    self.assertTrue(labels[0].font.i)
                    self.assertTrue(t["total_row"], (p.name, t["sheet"]))   # a truncated table always carries the full-dataset Total
                    seen += 1
        self.assertGreater(seen, 0)
        # Category tab: Total tier has 11 brands > CATEGORY_TOP_BRANDS -> residual present
        cat = [t for t in _tables("CA", _Built.cr_paths[1].name) if t["role"] == "category" and t["title"].startswith("Total —")]
        self.assertEqual(len(cat), 1)
        self.assertIsNotNone(cat[0]["residual_row"])

    def test_top50_rank1_and_rankings(self):
        rows = _Built.ca_rows[_Built.ca_rows["source_set"].isin(["code_reader", "both"])]
        p = _Built.cr_paths[0]
        t = [t for t in _tables("CA", p.name) if t["role"] == "top_by_revenue"][0]
        ws = openpyxl.load_workbook(p)["Top 50"]
        rev_c = t["first_col"] + t["columns"].index("Est. Monthly Retail Rev (CAD)")
        self.assertAlmostEqual(ws.cell(t["first_data_row"], rev_c).value, float(rows["revenue_month"].max()))
        u = [t for t in _tables("CA", p.name) if t["role"] == "top_by_units"][0]
        self.assertEqual(u["sheet"], "Top 50")
        prev_end = t["total_row"] or t["residual_row"] or t["last_data_row"]
        self.assertEqual(u["header_row"] - 1 - prev_end, 4)   # 3 blank rows then the table title row

    def test_trend_proxy_never_divides_units_by_last_year_sales(self):
        """Helium 10 'Last Year Sales' is not a same-month figure: it is shown as reported, never divided into monthly units,
        and listing 'Sales YoY %' values are only counted (never averaged or summed)."""
        p = _Built.cr_paths[1]
        t = [t for t in _tables("CA", p.name) if t["role"] == "trend_proxy"]
        self.assertEqual(len(t), 1)
        t = t[0]
        self.assertEqual(t["columns"], list(CR.TREND_PROXY_HEADERS))
        self.assertEqual(t["columns"], ["Brand", "Monthly Rev (CAD)", "Monthly Units",
                                        "Last Year Sales (Helium 10 field; semantics unverified)",
                                        "# Listings with Helium 10 YoY data", "# Listings with YoY > 0", "# Listings with YoY < 0",
                                        "Revenue share of listings with YoY > 0", "Revenue share of listings with YoY data"])
        ws = openpyxl.load_workbook(p)["Trend Proxy"]
        notes = [c for row in ws.iter_rows(min_row=1, max_row=t["header_row"] - 1, values_only=True) for c in row if isinstance(c, str)]
        self.assertIn(CR.TREND_NOTE, notes)
        rows = _Built.ca_rows[_Built.ca_rows["source_set"].isin(["code_reader", "both"])]
        col = {h: t["first_col"] + i for i, h in enumerate(t["columns"])}
        checked = 0
        for r in list(range(t["first_data_row"], t["last_data_row"] + 1)) + [t["total_row"]]:
            name = ws.cell(r, col["Brand"]).value
            sub = rows if name == C.TOTAL_ROW_LABEL else rows[rows["brand_display"] == name]
            ly = sub["last_year_units"].dropna()
            got_ly = ws.cell(r, col["Last Year Sales (Helium 10 field; semantics unverified)"]).value
            if len(ly):
                self.assertAlmostEqual(got_ly, float(ly.sum()), places=6, msg=name)
            else:
                self.assertIsNone(got_ly, name)          # no listing carries the field -> blank, never 0
            yoy = sub["yoy_units_pct"]
            rev = float(sub["revenue_month"].sum())
            self.assertEqual(ws.cell(r, col["# Listings with Helium 10 YoY data"]).value, int(yoy.notna().sum()))
            self.assertEqual(ws.cell(r, col["# Listings with YoY > 0"]).value, int((yoy > 0).sum()))
            self.assertEqual(ws.cell(r, col["# Listings with YoY < 0"]).value, int((yoy < 0).sum()))
            share_pos = ws.cell(r, col["Revenue share of listings with YoY > 0"]).value
            share_any = ws.cell(r, col["Revenue share of listings with YoY data"]).value
            if rev > 0:
                self.assertAlmostEqual(share_pos, float(sub.loc[yoy > 0, "revenue_month"].sum()) / rev, places=9, msg=name)
                self.assertAlmostEqual(share_any, float(sub.loc[yoy.notna(), "revenue_month"].sum()) / rev, places=9, msg=name)
            else:
                self.assertIsNone(share_pos, name)
                self.assertIsNone(share_any, name)
            # no cell of the row equals monthly units / last-year sales (or that ratio - 1)
            units, lysum = float(sub["units_month"].sum()), float(ly.sum())
            if lysum > 0:
                vals = [ws.cell(r, c).value for c in range(t["first_col"], t["last_col"] + 1)]
                for v in vals:
                    if isinstance(v, float):
                        self.assertNotAlmostEqual(v, units / lysum - 1.0, places=9, msg=(name, vals))
                        self.assertNotAlmostEqual(v, units / lysum, places=9, msg=(name, vals))
            checked += 1
        self.assertGreater(checked, 5)
        self.assertGreater(ws.cell(t["total_row"], col["# Listings with YoY < 0"]).value, 0)   # fixture has negative YoY rows

    def test_no_units_over_last_year_ratio_in_source(self):
        """Neither builder computes a ratio between units_month and last_year_units (gauge Price Ladder / brand tabs included)."""
        rx = re.compile(r"last_year_units[^\n]*/|/[^\n]*last_year_units|\bly_paired\b|units_paired|paired sums", re.I)
        for m in ("build_ca_code_reader_report.py", "build_gauge_report.py", "ca_xlsx_style.py"):
            src = (C.PACKAGE_ROOT / m).read_text()
            self.assertIsNone(rx.search(src), (m, rx.search(src) and rx.search(src).group(0)))
        for p in (_Built.ca_gauge, _Built.us_gauge, _Built.cr_paths[0]):
            for t in _tables(_market_of(p), p.name):
                for h in t["columns"]:
                    self.assertNotIn("paired", h.lower(), (p.name, t["sheet"], h))

    def test_brand_tab_layout(self):
        for p in (_Built.cr_paths[0], _Built.ca_gauge):
            for t in _tables(_market_of(p), p.name):
                if t["role"] in ("brand_tab_revenue",) or (t["role"] == "innova" and p == _Built.cr_paths[0]):
                    self.assertEqual(t["header_row"], C.BRAND_TAB_RESERVED_ROWS + 2, (p.name, t["sheet"]))
                brand_tab = any(x["sheet"] == t["sheet"] and x["role"] == "brand_tab_revenue" for x in _tables(_market_of(p), p.name))
                if t["role"] == "kpi" and (brand_tab or (t["sheet"] == "Innova" and p == _Built.cr_paths[0])):
                    self.assertEqual((t["first_data_row"], t["last_data_row"]), (3, 6), (p.name, t["sheet"]))

    # ---------------------------------------------------------------- app feature matrix (Model B) / numeric count cells
    def _matrix(self, path: Path):
        ts = [t for t in _tables("CA", path.name) if t["role"] == "modelb_app_matrix"]
        self.assertEqual(len(ts), 1)
        t = ts[0]
        ws = openpyxl.load_workbook(path)[t["sheet"]]
        rows = [[ws.cell(r, t["first_col"] + i) for i in range(len(t["columns"]))] for r in range(t["first_data_row"], t["last_data_row"] + 1)]
        return t, ws, rows

    def test_app_feature_matrix_from_csv(self):
        d = C.SCRATCH_DIR / "test_out_matrix"
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        csv_path = d / "app_matrix.csv"
        tiny = pd.DataFrame([
            {"app": "Torque Pro", "vendor": "Ian Hawkins", "live_gauges": "Y", "custom_dashboards": "Y", "hud_mirror_mode": "Y",
             "alarms": "Y", "data_logging": "Y", "enhanced_diesel_pids": "via plugins", "carplay_android_auto": "N",
             "subscription": "one-time CA$6.99", "canada_availability": "Google Play CA", "source_url": "https://play.google.com/store/apps/details?id=org.prowl.torque",
             "accessed": "2026-10-02", "note": "=not a formula"},
            {"app": "OBDLink", "vendor": "OBD Solutions", "live_gauges": "Y", "custom_dashboards": "Y", "hud_mirror_mode": "N",
             "alarms": "N", "data_logging": "Y", "enhanced_diesel_pids": "Y (OEM add-ons)", "carplay_android_auto": "N",
             "subscription": "free; add-ons USD 9.99", "canada_availability": "App Store CA", "source_url": "https://www.obdlink.com/app/",
             "accessed": "2026-10-02", "note": ""},
        ], columns=list(C.APP_FEATURE_MATRIX_COLUMNS))
        tiny.to_csv(csv_path, index=False)
        ca = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        with contextlib.redirect_stdout(io.StringIO()):
            p = G.build_gauge_workbook(ca, d, benchmark=None, overwrite=True, dated_copy=False, runs_dir=d / "runs",
                                       preclassified=True, input_paths=[CA_FIXTURE], app_feature_matrix=csv_path)
        reg = json.loads(C.run_file(d / "runs", MONTH, "table_registry", "CA", "json").read_text())
        ts = [t for t in reg["tables"] if t["role"] == "modelb_app_matrix"]
        self.assertEqual(len(ts), 1)
        t = ts[0]
        self.assertEqual(t["sheet"], "App-Gauge Proxy (Model B)")
        self.assertEqual(t["columns"], list(G.APP_MATRIX_HEADERS))
        self.assertEqual(t["columns"], ["App", "Vendor", "Live gauges", "Custom dashboards", "HUD/mirror mode", "Alarms", "Data logging",
                                        "Enhanced/diesel PIDs", "CarPlay/Android Auto", "Subscription", "Canada availability", "Source",
                                        "Accessed", "Note"])
        ws = openpyxl.load_workbook(p)[t["sheet"]]
        notes = [c for row in ws.iter_rows(min_row=t["header_row"] - 2, max_row=t["header_row"] - 1, values_only=True)
                 for c in row if isinstance(c, str)]
        self.assertIn(G.APP_MATRIX_NOTE, notes)
        rows = {ws.cell(r, t["first_col"]).value: [ws.cell(r, t["first_col"] + i) for i in range(len(t["columns"]))]
                for r in range(t["first_data_row"], t["last_data_row"] + 1)}
        self.assertEqual(list(rows), list(C.APP_FEATURE_MATRIX_APPS))           # frozen app order, every app present
        src_i, note_i, sub_i = t["columns"].index("Source"), t["columns"].index("Note"), t["columns"].index("Subscription")
        torque = rows["Torque Pro"]
        self.assertEqual(torque[1].value, "Ian Hawkins")
        self.assertEqual(torque[sub_i].value, "one-time CA$6.99")
        self.assertEqual(torque[src_i].value, "https://play.google.com/store/apps/details?id=org.prowl.torque")
        self.assertEqual(torque[note_i].value, "=not a formula")
        for app, cells in rows.items():
            for c in cells:
                self.assertNotEqual(c.data_type, "f", (app, c.coordinate))        # plain text, never a HYPERLINK
            self.assertTrue(cells[src_i].value is None or cells[src_i].data_type == "s", app)
            if app not in ("Torque Pro", "OBDLink"):
                self.assertEqual([c.value for c in cells[1:]], [G.APP_MATRIX_PLACEHOLDER] * (len(cells) - 1), app)
        # the shipped map (header-only today) renders every app as a GAP row in the main CA build
        t, ws, mrows = self._matrix(_Built.ca_gauge)
        self.assertEqual([r[0].value for r in mrows], list(C.APP_FEATURE_MATRIX_APPS))
        # schema guards: unknown app or missing column fail loudly
        bad = tiny.copy()
        bad.loc[0, "app"] = "Not An App"
        bad.to_csv(d / "bad_app.csv", index=False)
        with self.assertRaises(ValueError):
            G.read_app_feature_matrix(d / "bad_app.csv")
        tiny.drop(columns=["vendor"]).to_csv(d / "bad_cols.csv", index=False)
        with self.assertRaises(KeyError):
            G.read_app_feature_matrix(d / "bad_cols.csv")

    def test_dedupe_audit_money_headers_carry_currency(self):
        for p in (_Built.ca_gauge, _Built.us_gauge):
            ccy = C.MARKETS[_market_of(p)].currency
            ts = [t for t in _tables(_market_of(p), p.name) if t["sheet"] == "Dedupe & Classification Audit"]
            self.assertEqual(len(ts), 2, p.name)
            audit = [t for t in ts if t["title"].startswith("Dedupe audit")][0]
            self.assertIn(f"Revenue chosen ({ccy})", audit["columns"])
            self.assertIn(f"Revenue dropped max ({ccy})", audit["columns"])
            self.assertNotIn("revenue_chosen", audit["columns"])
            self.assertNotIn("revenue_dropped_max", audit["columns"])
            # every other audit header stays the raw DEDUPE_AUDIT_COLUMNS name, in order
            raw = [h for h in C.DEDUPE_AUDIT_COLUMNS if h not in ("revenue_chosen", "revenue_dropped_max")]
            self.assertEqual([h for h in audit["columns"] if "Revenue" not in h], raw)
            self.assertEqual(len(audit["columns"]), len(C.DEDUPE_AUDIT_COLUMNS))
            ws = openpyxl.load_workbook(p)["Dedupe & Classification Audit"]
            got = [ws.cell(audit["header_row"], audit["first_col"] + i).value for i in range(len(audit["columns"]))]
            self.assertEqual(got, audit["columns"])
            # no money column anywhere on the sheet lacks the currency token in its header
            for t in ts:
                for h in t["columns"]:
                    if re.search(r"\b(Rev|Price|Revenue)\b", h, re.I):
                        self.assertIn(f"({ccy})", h, (p.name, t["title"], h))
        # engine level: a populated audit frame writes money cells under the relabelled headers
        audit = pd.DataFrame([{"market": "CA", "source_set": "code_reader", "asin": "B0TESTAUT1", "n_rows": 2, "chosen_file": "a.csv",
                               "chosen_row": 3, "dropped": "b.csv:4", "values_identical": "N", "revenue_chosen": 100.0,
                               "revenue_dropped_max": 90.0, "units_diff": 1, "price_diff": 0.0, "title_diff": "N",
                               "winning_rule": "revenue", "discrepancy_flag": ""}])
        cols = G.dedupe_audit_columns("CAD")
        self.assertEqual([c.header for c in cols if c.kind == "money"], ["Revenue chosen (CAD)", "Revenue dropped max (CAD)"])
        self.assertEqual([c.field for c in cols], list(C.DEDUPE_AUDIT_COLUMNS))
        self.assertTrue(set(c.field for c in cols) <= set(audit.columns))

    def test_gauge_type_conflicts_land_in_ca_type_review(self):
        p = C.run_file(RUNS, MONTH, "type_review", "CA_code_reader")
        self.assertTrue(p.exists(), p)
        review = pd.read_csv(p, dtype=str, keep_default_na=False)
        self.assertEqual(tuple(review.columns), C.TYPE_REVIEW_COLUMNS)
        # CA fixture: ScanGauge 3 is a gauge_display typed Tablet -> gauge_type_conflict
        conflicts = review[review["review_reason"] == "gauge_type_conflict"]
        self.assertIn("B0TESTSCG1", set(conflicts["asin"]))
        ca = _Built.ca_rows
        expect = set(ca.loc[ca["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES) & ca["type"].isin(["Tablet", "Handheld", "Dongle"]), "asin"])
        self.assertEqual(set(conflicts["asin"]), expect)
        self.assertEqual(conflicts.loc[conflicts["asin"] == "B0TESTSCG1", "proposed_type"].iloc[0], "Tablet")
        # the All Products tab shows the flag
        wb = openpyxl.load_workbook(_Built.ca_gauge)
        t = [t for t in _tables("CA", _Built.ca_gauge.name) if t["role"] == "all_rows"][0]
        ws = wb["All Products"]
        a_c, f_c = t["first_col"] + t["columns"].index("ASIN"), t["first_col"] + t["columns"].index("Type Conflict")
        flags = {ws.cell(r, a_c).value: ws.cell(r, f_c).value for r in range(t["first_data_row"], t["last_data_row"] + 1)}
        self.assertEqual({a for a, v in flags.items() if v == "Y"}, expect)
        # the US build never writes a review file (CA or US) and never adds its ASINs
        self.assertFalse(C.run_file(RUNS, MONTH, "type_review", "US_code_reader").exists())
        self.assertFalse(set(review["asin"]) & set(_Built.us_rows["asin"]) - set(ca["asin"]))
        # merge keeps a human reviewed_type
        d = C.SCRATCH_DIR / "test_out_review"
        if d.exists():
            shutil.rmtree(d)
        rp = C.run_file(d / "runs", MONTH, "type_review", "CA_code_reader")
        rp.parent.mkdir(parents=True)
        seed = conflicts[conflicts["asin"] == "B0TESTSCG1"].copy()
        seed["reviewed_type"] = "Other"
        keep = seed.copy()
        keep["asin"], keep["review_reason"], keep["reviewed_type"] = "B0TESTKEEP", "default_other", "Key"
        pd.concat([seed, keep]).to_csv(rp, index=False)
        ca_ds = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            G.build_gauge_workbook(ca_ds, d, benchmark=None, overwrite=True, dated_copy=False, runs_dir=d / "runs",
                                   preclassified=True, input_paths=[CA_FIXTURE])
        self.assertIn(f"type_review: {len(expect)} gauge_type_conflict rows merged into {rp}", buf.getvalue())
        merged = pd.read_csv(rp, dtype=str, keep_default_na=False)
        self.assertEqual(merged.loc[merged["asin"] == "B0TESTSCG1", "reviewed_type"].iloc[0], "Other")
        self.assertEqual(merged.loc[merged["asin"] == "B0TESTKEEP", "reviewed_type"].iloc[0], "Key")

    def test_numeric_count_cells(self):
        for p, rows in ((_Built.ca_gauge, _Built.ca_rows), (_Built.us_gauge, _Built.us_rows)):
            wb = openpyxl.load_workbook(p)
            kpis = [t for t in _tables(_market_of(p), p.name) if t["role"] == "kpi" and t["sheet"] == "Innova"]
            self.assertEqual(len(kpis), 1, p.name)
            k = kpis[0]
            cell = wb["Innova"].cell(k["first_data_row"], k["first_col"])
            self.assertEqual(cell.coordinate, G.INNOVA_COUNT_CELL)
            self.assertIsInstance(cell.value, int)
            self.assertNotIsInstance(cell.value, bool)
            n = int(((rows["brand_key"] == "innova") & rows["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)).sum())
            self.assertEqual(cell.value, n)
            self.assertEqual(wb["Innova"]["A3"].value, f"Innova gauge/HUD device listings in this dataset: {n}")
        wb = openpyxl.load_workbook(_Built.ca_gauge)
        ws = wb["US vs CA Same-ASIN"]
        kpis = [t for t in _tables("CA", _Built.ca_gauge.name) if t["role"] == "kpi" and t["sheet"] == "US vs CA Same-ASIN"]
        self.assertEqual(len(kpis), 1)
        same = [t for t in _tables("CA", _Built.ca_gauge.name) if t["role"] == "same_asin"][0]
        cell = ws[G.SAME_ASIN_COUNT_CELL]
        self.assertEqual(ws.cell(cell.row, 1).value, "Listings in both marketplaces")
        self.assertIsInstance(cell.value, int)
        self.assertEqual(cell.value, same["last_data_row"] - same["first_data_row"] + 1)
        self.assertEqual(cell.value, 1)                                         # fixtures share exactly one device ASIN
        self.assertEqual((kpis[0]["first_data_row"], kpis[0]["last_data_row"]), (cell.row, cell.row))

    # ---------------------------------------------------------------- gauge share of the code-reader market / fuel split
    @staticmethod
    def _table(path: Path, sheet: str, role: str, title: str):
        ts = [t for t in _tables(_market_of(path), path.name) if t["sheet"] == sheet and t["role"] == role and t["title"] == title]
        return ts

    @staticmethod
    def _rows_by_label(ws, t) -> dict:
        out = {}
        for r in range(t["first_data_row"], t["last_data_row"] + 1):
            out[ws.cell(r, t["first_col"]).value] = {h: ws.cell(r, t["first_col"] + i) for i, h in enumerate(t["columns"])}
        if t["total_row"]:
            out[C.TOTAL_ROW_LABEL] = {h: ws.cell(t["total_row"], t["first_col"] + i) for i, h in enumerate(t["columns"])}
        return out

    @staticmethod
    def _expected_shares(rows: pd.DataFrame) -> dict:
        cr = rows[rows["source_set"].isin(["code_reader", "both"])]
        core = rows[rows["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)]          # fixtures carry no borderline rows
        a = core[core["source_set"].isin(["code_reader", "both"])]
        g_only = core[core["source_set"] == "gauge"]
        cr_n, cr_rev, cr_u = len(cr), float(cr["revenue_month"].sum()), float(cr["units_month"].sum())
        den_n, den_rev, den_u = cr_n + len(g_only), cr_rev + float(g_only["revenue_month"].sum()), cr_u + float(g_only["units_month"].sum())
        a_rev, a_u = float(a["revenue_month"].sum()), float(a["units_month"].sum())
        b_rev, b_u = float(core["revenue_month"].sum()), float(core["units_month"].sum())
        L = G.SHARE_ROW_LABELS
        return {L[0]: (cr_n, cr_rev, cr_u, 1.0, 1.0), L[1]: (len(a), a_rev, a_u, a_rev / cr_rev, a_u / cr_u),
                L[2]: (len(core), b_rev, b_u, b_rev / den_rev, b_u / den_u), L[3]: (den_n, den_rev, den_u, 1.0, 1.0)}

    def test_gauge_share_of_code_reader_market(self):
        for path, rows in ((_Built.ca_gauge, _Built.ca_rows), (_Built.us_gauge, _Built.us_rows)):
            ccy = C.MARKETS[_market_of(path)].currency
            ts = self._table(path, "Summary", "kpi", G.SHARE_TITLE)
            self.assertEqual(len(ts), 1, path.name)
            t = ts[0]
            self.assertEqual(t["columns"], ["Measure", "# ASINs", f"Monthly Rev ({ccy})", "Monthly Units", "Share of revenue",
                                            "Share of units"])
            self.assertFalse(any(h in ("CA share", "US share") or h.startswith("US ") for h in t["columns"]), t["columns"])
            ws = openpyxl.load_workbook(path)["Summary"]
            got = self._rows_by_label(ws, t)
            exp = self._expected_shares(rows)
            self.assertEqual(list(got), list(G.SHARE_ROW_LABELS))
            for label, (n, rev, units, s_rev, s_u) in exp.items():
                cells = got[label]
                self.assertEqual(cells["# ASINs"].value, n, (path.name, label))
                self.assertAlmostEqual(cells[f"Monthly Rev ({ccy})"].value, rev, places=6, msg=(path.name, label))
                self.assertAlmostEqual(cells["Monthly Units"].value, units, places=6, msg=(path.name, label))
                self.assertAlmostEqual(cells["Share of revenue"].value, s_rev, places=12, msg=(path.name, label))
                self.assertAlmostEqual(cells["Share of units"].value, s_u, places=12, msg=(path.name, label))
                self.assertEqual(cells["Share of revenue"].number_format, "0.00%")
                self.assertEqual(cells["Share of units"].number_format, "0.00%")
        # CA fixture by hand: (a) 4 ASINs CA$10,562.71 over CR CA$59,706.13; (b) 9 ASINs CA$14,970.86 over CA$64,114.28
        exp = self._expected_shares(_Built.ca_rows)
        self.assertEqual(exp[G.SHARE_ROW_LABELS[1]][0], 4)
        self.assertAlmostEqual(exp[G.SHARE_ROW_LABELS[1]][1], 10562.71, places=6)
        self.assertAlmostEqual(exp[G.SHARE_ROW_LABELS[3]][1], 64114.28, places=6)

    def test_benchmark_share_columns_only_with_benchmark(self):
        ts = self._table(_Built.ca_gauge, "US Benchmark", "kpi", G.BENCH_SHARE_TITLE)
        self.assertEqual(len(ts), 1)
        t = ts[0]
        self.assertEqual(t["columns"], ["Measure", "CA share", "US share"])
        ws = openpyxl.load_workbook(_Built.ca_gauge)["US Benchmark"]
        got = self._rows_by_label(ws, t)
        ca, us = self._expected_shares(_Built.ca_rows), self._expected_shares(_Built.us_rows)
        L = G.SHARE_ROW_LABELS
        want = {G.BENCH_SHARE_ROWS[0]: (ca[L[1]][3], us[L[1]][3]), G.BENCH_SHARE_ROWS[1]: (ca[L[1]][4], us[L[1]][4]),
                G.BENCH_SHARE_ROWS[2]: (ca[L[2]][3], us[L[2]][3]), G.BENCH_SHARE_ROWS[3]: (ca[L[2]][4], us[L[2]][4])}
        self.assertEqual(list(got), list(want))
        for label, (c_s, u_s) in want.items():
            self.assertAlmostEqual(got[label]["CA share"].value, c_s, places=12, msg=label)
            self.assertAlmostEqual(got[label]["US share"].value, u_s, places=12, msg=label)
            self.assertEqual(got[label]["US share"].number_format, "0.00%")
        # never in the US workbook, never without a benchmark
        def share_headers(path):
            return [h for t in _tables(_market_of(path), path.name) for h in t["columns"] if h in ("CA share", "US share")]
        self.assertEqual(share_headers(_Built.us_gauge), [])
        nob = C.SCRATCH_DIR / "test_out_nobench"
        if nob.exists():
            shutil.rmtree(nob)
        ca_ds = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        with contextlib.redirect_stdout(io.StringIO()):
            p = G.build_gauge_workbook(ca_ds, nob, benchmark=None, overwrite=True, dated_copy=False, runs_dir=nob / "runs",
                                       preclassified=True, input_paths=[CA_FIXTURE])
        reg = json.loads(C.run_file(nob / "runs", MONTH, "table_registry", "CA", "json").read_text())
        hdrs = [h for t in reg["tables"] if t["workbook"] == p.name for h in t["columns"]]
        self.assertNotIn("US share", hdrs)
        self.assertNotIn("US Benchmark", openpyxl.load_workbook(p).sheetnames)
        self.assertEqual(len([t for t in reg["tables"] if t["title"] == G.SHARE_TITLE]), 1)

    def test_fuel_split_sums_to_core_device_totals(self):
        for path, rows in ((_Built.ca_gauge, _Built.ca_rows), (_Built.us_gauge, _Built.us_rows)):
            ccy = C.MARKETS[_market_of(path)].currency
            ts = self._table(path, "Summary", "subtype_mix", G.FUEL_TITLE)
            self.assertEqual(len(ts), 1, path.name)
            t = ts[0]
            self.assertEqual(t["columns"], ["Sub-type"] + G.fuel_headers(ccy))
            ws = openpyxl.load_workbook(path)["Summary"]
            notes = [c for row in ws.iter_rows(min_row=t["header_row"] - 2, max_row=t["header_row"] - 1, values_only=True)
                     for c in row if isinstance(c, str)]
            self.assertIn(G.FUEL_NOTE, notes)
            got = self._rows_by_label(ws, t)
            self.assertEqual(list(got), [C.GAUGE_SUBTYPE_LABELS[c] for c in C.GAUGE_DEVICE_CLASSES] + [C.TOTAL_ROW_LABEL])
            core = rows[rows["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)]
            for cls in C.GAUGE_DEVICE_CLASSES + (None,):
                sub = core if cls is None else core[core["gauge_class"] == cls]
                cells = got[C.TOTAL_ROW_LABEL if cls is None else C.GAUGE_SUBTYPE_LABELS[cls]]
                n = sum(cells[f"{f}: # ASINs"].value for f in C.FEATURE_FUEL_SCOPE)
                rev = sum(cells[f"{f}: Monthly Rev ({ccy})"].value for f in C.FEATURE_FUEL_SCOPE)
                units = sum(cells[f"{f}: Monthly Units"].value for f in C.FEATURE_FUEL_SCOPE)
                self.assertEqual(n, len(sub), (path.name, cls))
                self.assertAlmostEqual(rev, float(sub["revenue_month"].sum()), places=6, msg=(path.name, cls))
                self.assertAlmostEqual(units, float(sub["units_month"].sum()), places=6, msg=(path.name, cls))
        # US fixture carries fuel_scope: tuner = diesel-capable, Lufi XF = gas, the rest unspecified
        ws = openpyxl.load_workbook(_Built.us_gauge)["Summary"]
        t = self._table(_Built.us_gauge, "Summary", "subtype_mix", G.FUEL_TITLE)[0]
        tot = self._rows_by_label(ws, t)[C.TOTAL_ROW_LABEL]
        us_core = _Built.us_rows[_Built.us_rows["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)]
        for f in C.FEATURE_FUEL_SCOPE:
            self.assertAlmostEqual(tot[f"{f}: Monthly Units"].value, float(us_core.loc[us_core["fuel_scope"] == f, "units_month"].sum()))
        self.assertEqual(tot["diesel-capable: Monthly Units"].value, 12)
        self.assertEqual(tot["gas: Monthly Units"].value, 20)
        # CA fixture has no fuel_scope column: everything is 'unspecified' and Metadata says so
        ws = openpyxl.load_workbook(_Built.ca_gauge)["Summary"]
        t = self._table(_Built.ca_gauge, "Summary", "subtype_mix", G.FUEL_TITLE)[0]
        tot = self._rows_by_label(ws, t)[C.TOTAL_ROW_LABEL]
        self.assertEqual(tot["unspecified: # ASINs"].value, 9)
        meta = {r[0]: r[1] for r in openpyxl.load_workbook(_Built.ca_gauge)["Metadata"].iter_rows(values_only=True) if r and r[0]}
        self.assertIn("fuel_scope absent", meta["Enrichment columns"])

    def test_innova_tab(self):
        rows = _Built.ca_rows[_Built.ca_rows["source_set"].isin(["code_reader", "both"])]
        inn = rows[rows["brand_key"] == "innova"]
        p = _Built.cr_paths[0]
        t = [t for t in _tables("CA", p.name) if t["role"] == "innova" and t["sheet"] == "Innova"][0]
        self.assertEqual(t["last_data_row"] - t["first_data_row"] + 1, len(inn))
        ws = openpyxl.load_workbook(p)["Innova"]
        item_c = t["first_col"] + t["columns"].index("Item #")
        sold_c = t["first_col"] + t["columns"].index("Sold by Amazon")
        items = {ws.cell(r, item_c).value for r in range(t["first_data_row"], t["last_data_row"] + 1)}
        self.assertEqual(items, {"5610", "1000 V2"})
        sold = {ws.cell(r, sold_c).value for r in range(t["first_data_row"], t["last_data_row"] + 1)}
        self.assertEqual(sold, {"Yes", "No"})
        self.assertEqual(CR.item_number("Innova 3020RS OBD2 Code Reader"), "3020RS")
        self.assertEqual(CR.sold_by_amazon("Amazon US"), "Amazon US (cross-border)")
        self.assertEqual(CR.sold_by_amazon("Amazon.ca"), "Yes")
        # gauge Innova tab: static device-count line
        for g in (_Built.ca_gauge, _Built.us_gauge):
            ws = openpyxl.load_workbook(g)["Innova"]
            vals = [c for row in ws.iter_rows(values_only=True) for c in row if isinstance(c, str)]
            self.assertIn("Innova gauge/HUD device listings in this dataset: 0", vals)

    def test_same_asin_and_benchmark(self):
        p = _Built.ca_gauge
        t = [t for t in _tables("CA", p.name) if t["role"] == "same_asin"][0]
        self.assertGreaterEqual(t["last_data_row"] - t["first_data_row"] + 1, 1)
        self.assertEqual(t["sheet"], "US vs CA Same-ASIN")
        self.assertEqual(tuple(t["allowed_markets"]), ("CA", "US"))
        bench = [t for t in _tables("CA", p.name) if t["role"].startswith("benchmark_")]
        self.assertEqual({t["role"] for t in bench}, {"benchmark_brands", "benchmark_subtypes", "benchmark_tiers"})
        for t in bench:
            self.assertTrue(any("(CAD)" in h for h in t["columns"]) and any("(USD)" in h for h in t["columns"]), t["columns"])
            self.assertFalse(any("ratio" in h.lower() and "rev" in h.lower() for h in t["columns"]), t["columns"])

    def test_all_products_and_excluded_reconcile(self):
        p = _Built.ca_gauge
        rows = _Built.ca_rows
        allp = [t for t in _tables("CA", p.name) if t["role"] == "all_rows"][0]
        self.assertEqual(allp["last_data_row"] - allp["first_data_row"] + 1, rows["asin"].nunique())
        exc = [t for t in _tables("CA", p.name) if t["role"] == "excluded"][0]
        n_exc = rows["gauge_class"].isin(C.GAUGE_EXCLUDED_CLASSES + ("ambiguous",)).sum()
        self.assertEqual(exc["last_data_row"] - exc["first_data_row"] + 1, n_exc)

    def test_no_duplicate_asin_within_a_table(self):
        for p in _all_paths():
            wb = openpyxl.load_workbook(p)
            for t in _tables(_market_of(p), p.name):
                if "ASIN" not in t["columns"] or not t["first_data_row"]:
                    continue
                ws = wb[t["sheet"]]
                c = t["first_col"] + t["columns"].index("ASIN")
                asins = [ws.cell(r, c).value for r in range(t["first_data_row"], t["last_data_row"] + 1)]
                asins = [a for a in asins if a]
                self.assertEqual(len(asins), len(set(asins)), (p.name, t["sheet"], t["role"]))

    # ---------------------------------------------------------------- registry / metadata / manifest
    def test_registry_every_table_and_brand_sheet_map(self):
        need = {
            C.cr_report_name("CA", MONTH): {"summary_brands", "top_by_revenue", "top_by_units", "innova", "kpi", "brand_tab_revenue",
                                            "brand_tab_units", "all_rows", "metadata"},
            C.cr_analysis_name("CA", MONTH): {"tier_pivot", "category", "tier_tab", "trend_proxy", "type_coverage", "metadata"},
            C.gauge_report_name("CA", MONTH): {"read_me", "summary_brands", "subtype_mix", "tier_matrix", "kpi", "top_by_revenue",
                                               "top_by_units", "innova", "modelb_top", "brand_tab_revenue", "brand_tab_units",
                                               "price_ladder", "feature_matrix", "modelb_tiers", "modelb_brands", "modelb_app_matrix",
                                               "benchmark_brands", "benchmark_subtypes", "benchmark_tiers", "same_asin", "all_rows",
                                               "dedupe_audit", "excluded", "source_method", "metadata"},
            C.gauge_report_name("US", MONTH): {"read_me", "summary_brands", "subtype_mix", "tier_matrix", "kpi", "top_by_revenue",
                                               "top_by_units", "innova", "all_rows", "dedupe_audit", "excluded", "source_method",
                                               "metadata"},
        }
        for p in _all_paths():
            market = _market_of(p)
            reg = _Built.reg[market]
            self.assertEqual((reg["market"], reg["month"]), (market, MONTH))
            tables = _tables(market, p.name)
            roles = {t["role"] for t in tables}
            self.assertTrue(roles <= set(C.TABLE_ROLES), roles - set(C.TABLE_ROLES))
            self.assertTrue(need[p.name] <= roles, need[p.name] - roles)
            self.assertIn(p.name, reg["workbooks"])
            bsm = reg["workbooks"][p.name]["brand_sheet_map"]
            self.assertIsInstance(bsm, dict)
            wb = openpyxl.load_workbook(p)
            self.assertEqual(reg["workbooks"][p.name]["sheets"], wb.sheetnames)
            for key, sheet in bsm.items():
                self.assertIn(sheet, wb.sheetnames, key)
            for t in tables:
                self.assertEqual(t["brand_sheet_map"], bsm)
                for k in ("workbook", "sheet", "role", "header_row", "first_data_row", "last_data_row", "total_row", "residual_row",
                          "columns", "dataset_filter", "allowed_markets", "charts", "brand_sheet_map"):
                    self.assertIn(k, t)
                if t["header_row"]:
                    ws = wb[t["sheet"]]
                    got = [ws.cell(t["header_row"], t["first_col"] + i).value for i in range(len(t["columns"]))]
                    self.assertEqual(got, t["columns"], (p.name, t["sheet"], t["role"]))
            if p.name.startswith("CA_Code_Reader_Competitor"):
                self.assertEqual(bsm["innova"], "Innova")
                self.assertEqual(len(bsm), 1 + 10)

    def test_metadata_required_keys(self):
        for p in _all_paths():
            ws = openpyxl.load_workbook(p)["Metadata"]
            keys = {r[0] for r in ws.iter_rows(values_only=True) if r and r[0]}
            for k in C.METADATA_REQUIRED_KEYS:
                self.assertIn(k, keys, p.name)
            vals = {r[0]: r[1] for r in ws.iter_rows(values_only=True) if r and r[0]}
            if _market_of(p) == "CA":
                self.assertTrue(vals["Currency"].startswith("CAD"))
            self.assertIn("normalized", vals["Input mode"].lower())
        g = {r[0]: r[1] for r in openpyxl.load_workbook(_Built.ca_gauge)["Metadata"].iter_rows(values_only=True) if r and r[0]}
        self.assertIn("US benchmark source", g)

    def test_manifest_hashes_and_excludes_itself(self):
        mpath = OUT / C.manifest_name(MONTH)
        man = json.loads(mpath.read_text())
        self.assertNotIn(mpath.name, man["outputs"])
        for p in _all_paths():
            self.assertEqual(man["outputs"][p.name]["sha256"], _sha(p), p.name)
        self.assertTrue(man["inputs"])
        self.assertIn(str(CA_FIXTURE), man["inputs"])
        self.assertEqual(man["inputs"][str(CA_FIXTURE)], _sha(CA_FIXTURE))
        self.assertRegex(man["pipeline_git_sha"], r"^[0-9a-f]{7,40}(-dirty)?$")
        self.assertIn("generated_at", man)


class TestSafeOutputPath(unittest.TestCase):
    def test_refuse_backup_and_hand_edited(self):
        d = C.SCRATCH_DIR / "test_out_safe"
        if d.exists():
            shutil.rmtree(d)
        d.mkdir(parents=True)
        name = "CA_Code_Reader_Competitor_Report_202609.xlsx"
        f = d / name
        f.write_bytes(b"original")
        with self.assertRaises(FileExistsError):
            X.safe_output_path(d, name, overwrite=False, manifest=None)
        manifest = {"outputs": {name: {"sha256": hashlib.sha256(b"something else").hexdigest()}}}
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            out = X.safe_output_path(d, name, overwrite=True, manifest=manifest)
        self.assertEqual(out, f)
        self.assertFalse(f.exists())
        self.assertIn(f"HAND-EDITED: {f}", buf.getvalue())
        backups = list((d / C.BACKUP_SUBDIR).glob("CA_Code_Reader_Competitor_Report_202609.*.xlsx"))
        self.assertEqual(len(backups), 1)
        self.assertRegex(backups[0].name, r"\.\d{8}-\d{6}\.xlsx$")
        self.assertEqual(backups[0].read_bytes(), b"original")
        # unchanged file (sha matches the manifest): backed up, no HAND-EDITED line
        f.write_bytes(b"v2")
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            X.safe_output_path(d, name, overwrite=True, manifest={"outputs": {name: {"sha256": hashlib.sha256(b"v2").hexdigest()}}})
        self.assertNotIn("HAND-EDITED", buf.getvalue())
        # Excel lock file -> refuse
        f.write_bytes(b"v3")
        (d / f"~${name}").write_bytes(b"")
        with self.assertRaises(RuntimeError):
            X.safe_output_path(d, name, overwrite=True, manifest=None)


class TestSourceHygiene(unittest.TestCase):
    def test_no_row_insertion_or_deletion(self):
        for m in OWN_MODULES:
            src = (C.PACKAGE_ROOT / m).read_text()
            self.assertNotIn("insert_rows", src, m)
            self.assertNotIn("delete_rows", src, m)

    def test_build_code_never_reopens_outputs(self):
        for m in BUILD_MODULES:
            src = (C.PACKAGE_ROOT / m).read_text()
            self.assertNotIn("load_workbook", src, m)

    def test_cli_dev_mode_end_to_end(self):
        out = C.SCRATCH_DIR / "test_out_cli"
        if out.exists():
            shutil.rmtree(out)
        with contextlib.redirect_stdout(io.StringIO()):
            rc = CR.main(["--month", MONTH, "--from-normalized", str(CA_FIXTURE), "--out-dir", str(out),
                          "--runs-dir", str(out / "runs"), "--overwrite"])
        self.assertEqual(rc, 0)
        self.assertTrue((out / C.cr_report_name("CA", MONTH)).exists())
        with self.assertRaises(SystemExit):
            with contextlib.redirect_stderr(io.StringIO()):
                CR.main(["--month", "202613", "--from-normalized", str(CA_FIXTURE), "--out-dir", str(out)])
        with self.assertRaises(ValueError):   # dev runs never write under NewProductCategory
            CR.main(["--month", MONTH, "--from-normalized", str(CA_FIXTURE), "--out-dir", str(C.NEW_PRODUCT_DIR / "x")])

    def test_gauge_union_public_contract_is_a_pair(self):
        """validate_outputs.derive_data unpacks `u, notes = gauge_union(...)`; the flags live in gauge_union_with_flags."""
        ds = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        out = G.gauge_union(ds, preclassified=True, gauge_map_path=G.GAUGE_MAP_DEFAULT, runs_dir=RUNS, rederive=False)
        self.assertEqual(len(out), 2)
        u, notes = out
        self.assertIsInstance(u, pd.DataFrame)
        self.assertIsInstance(notes, list)
        self.assertIn("B0TESTSCG1", set(u.loc[u["type_conflict"], "asin"]))
        self.assertEqual(len(G.gauge_union_with_flags(ds, preclassified=True, gauge_map_path=G.GAUGE_MAP_DEFAULT, runs_dir=RUNS,
                                                      rederive=False)), 3)

    def test_missing_column_fails_loudly(self):
        df = X.read_normalized_csv(CA_FIXTURE).drop(columns=["revenue_month"])
        with self.assertRaises(KeyError):
            X.dataset_from_normalized(df, "CA", MONTH)

    def test_market_mismatch_fails(self):
        ca = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        with self.assertRaises(ValueError):
            X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "US", MONTH)
        ca.market = "US"
        with self.assertRaises(ValueError):
            CR.build_code_reader_workbooks(ca, C.SCRATCH_DIR / "never", overwrite=True, dated_copy=False, runs_dir=RUNS)


class TestPreview(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _Built.ensure()

    def test_preview_and_excerpt(self):
        html = OUT / "preview.html"
        md = OUT / "excerpt.md"
        with contextlib.redirect_stdout(io.StringIO()):
            rc = RP.main(["--workbook", str(_Built.cr_paths[0]), "--out", str(html), "--excerpt", str(md)])
        self.assertEqual(rc, 0)
        text = html.read_text()
        for s in ("Summary", "Top 50", "Metadata", C.FILL_TITLE, C.FILL_TOTAL):
            self.assertIn(s, text)
        lines = [l for l in md.read_text().splitlines() if l.startswith("|")]
        self.assertLessEqual(len(lines), 20 + 10 + 4)
        self.assertIn("CA$", md.read_text())


if __name__ == "__main__":
    unittest.main()
