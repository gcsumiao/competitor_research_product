"""validate_outputs tests: fixture workbooks built through the builders' normalized (dev) path into
tmp/ca_scratch/validate_test/, then validated with a tiny memo fixture. Tampered copies (openpyxl edit of a copied
workbook, edited manifest) must make the matching checks FAIL. Writes only under tmp/ca_scratch/validate_test/.
"""
from __future__ import annotations

import contextlib
import io
import json
import re
import shutil
import unittest
from pathlib import Path

import pandas as pd
from openpyxl import load_workbook

from ca_market_reports import build_ca_code_reader_report as CR
from ca_market_reports import build_gauge_report as G
from ca_market_reports import ca_common as C
from ca_market_reports import ca_xlsx_style as X
from ca_market_reports import validate_outputs as V

MONTH = "202609"
ROOT = C.SCRATCH_DIR / "validate_test"
BUILD = ROOT / "build"
RUNS = BUILD / "runs"
CA_FIXTURE = C.FIXTURES_DIR / "normalized_rows.csv"
US_FIXTURE = C.FIXTURES_DIR / "normalized_rows_us.csv"
ABSENT = ROOT / "absent_raw"          # never created: the "raw dir absent" case
CR_REPORT = C.cr_report_name("CA", MONTH)
CHECK_LINE_RE = re.compile(r"^(PASS|FAIL|SKIP) (V\d{2}) ([^:]+): (.*)$")
SRC_URL = "https://example.org/gauge-source"


class _Built:
    done = False

    @classmethod
    def ensure(cls) -> None:
        if cls.done:
            return
        if ROOT.exists():
            shutil.rmtree(ROOT)
        for d in ("cr", "gauge_ca", "gauge_us"):
            (BUILD / d).mkdir(parents=True)
        ca = X.dataset_from_normalized(X.read_normalized_csv(CA_FIXTURE), "CA", MONTH)
        us = X.dataset_from_normalized(X.read_normalized_csv(US_FIXTURE), "US", MONTH)
        with contextlib.redirect_stdout(io.StringIO()):
            CR.build_code_reader_workbooks(ca, BUILD / "cr", overwrite=True, dated_copy=False, runs_dir=RUNS,
                                           input_paths=[CA_FIXTURE])
            G.build_gauge_workbook(us, BUILD / "gauge_us", benchmark=None, overwrite=True, dated_copy=False, runs_dir=RUNS,
                                   preclassified=True, input_paths=[US_FIXTURE])
            G.build_gauge_workbook(ca, BUILD / "gauge_ca", benchmark=us, overwrite=True, dated_copy=False, runs_dir=RUNS,
                                   preclassified=True, input_paths=[CA_FIXTURE, US_FIXTURE])
        reg = json.loads(C.run_file(RUNS, MONTH, "table_registry", "CA", "json").read_text(encoding="utf-8"))
        summ = next(t for t in reg["tables"] if t["workbook"] == CR_REPORT and t["role"] == "summary_brands")
        cls.summary = summ
        rev_col = summ["first_col"] + summ["columns"].index("Monthly Rev (CAD)")
        lst_col = summ["first_col"] + summ["columns"].index("# of Listings")
        wb = load_workbook(BUILD / "cr" / CR_REPORT)
        ws = wb["Summary"]
        cls.rev_ref = f"{ws.cell(summ['total_row'], rev_col).coordinate}"
        cls.lst_ref = f"{ws.cell(summ['total_row'], lst_col).coordinate}"
        cls.rev_value = float(ws.cell(summ["total_row"], rev_col).value)
        cls.lst_value = int(ws.cell(summ["total_row"], lst_col).value)
        all_asins = next(t for t in reg["tables"] if t["workbook"] == CR_REPORT and t["role"] == "all_rows")
        cls.all_rev_cell = (all_asins["first_data_row"], all_asins["first_col"] + all_asins["columns"].index("Monthly Rev (CAD)"))
        sources = ROOT / "sources.csv"
        sources.write_text(",".join(C.SOURCES_COLUMNS) + "\n" + f"{SRC_URL},2026-10-02,Example,claim,,1\n", encoding="utf-8")
        cls.sources = sources
        cls.done = True


def memo_text(*, fixed: bool) -> str:
    b = _Built
    good = f"Observed revenue CA${round(b.rev_value):,} [WB: {CR_REPORT}!Summary!{b.rev_ref}] in the exports."
    listings = b.lst_value if fixed else b.lst_value + 7
    wrong = f"Listing count {listings} [WB: {CR_REPORT}!Summary!{b.lst_ref}]."
    lines = ["# Memo fixture", "", good, wrong, f"Lordco carries the unit [SRC: {SRC_URL}, accessed 2026-10-02]."]
    if not fixed:
        lines.append("Gauge share placeholder [WB: TBD].")
    return "\n".join(lines) + "\n"


def write_memo(name: str, *, fixed: bool) -> Path:
    p = ROOT / name
    p.write_text(memo_text(fixed=fixed), encoding="utf-8")
    return p


def run_validator(*, cr: Path = BUILD / "cr", gauge_ca: Path = BUILD / "gauge_ca", gauge_us: Path = BUILD / "gauge_us",
                  memo: Path, extra: list[str] | None = None, json_path: Path | None = None) -> tuple[int, list[str]]:
    argv = ["--month", MONTH, "--cr-out-dir", str(cr), "--gauge-out-dir", str(gauge_ca), "--us-gauge-out-dir", str(gauge_us),
            "--runs-dir", str(RUNS), "--raw-dir", str(ABSENT / "ca_cr"), "--gauge-raw-dir", str(ABSENT / "ca_gauge"),
            "--us-gauge-raw-dir", str(ABSENT / "us_gauge"), "--us-cr-raw-dir", str(ABSENT / "us_cr"),
            "--from-normalized", str(CA_FIXTURE), "--us-from-normalized", str(US_FIXTURE),
            "--memo", str(memo), "--sources", str(_Built.sources)] + (extra or [])
    if json_path is not None:
        argv += ["--json", str(json_path)]
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        rc = V.main(argv)
    return rc, buf.getvalue().splitlines()


def _core(df):
    """Core devices of a normalized fixture: device class and not borderline (columns derived when absent)."""
    dev = df["gauge_class"].isin(C.GAUGE_DEVICE_CLASSES)
    border = df["borderline"].astype(bool) if "borderline" in df.columns else pd.Series(False, index=df.index)
    return df[dev & ~border]


def _registry(mk: str) -> dict:
    return json.loads(C.run_file(RUNS, MONTH, "table_registry", mk, "json").read_text(encoding="utf-8"))


def _special_cells() -> dict:
    """Values of the tables covered by the new V09 rules, read from the fixture workbooks via the registry."""
    reg = _registry("CA")
    gname, aname = C.gauge_report_name("CA", MONTH), C.cr_analysis_name("CA", MONTH)
    wb = load_workbook(BUILD / "gauge_ca" / gname)
    out: dict = {}

    def rows(t, ws):
        return {ws.cell(r, t["first_col"]).value: {h: ws.cell(r, t["first_col"] + j).value for j, h in enumerate(t["columns"])}
                for r in range(t["first_data_row"], t["last_data_row"] + 1)}

    for t in reg["tables"]:
        if t["workbook"] != gname:
            continue
        ws = wb[t["sheet"]]
        if t["title"] == V.SHARE_TABLE_TITLE:
            out["share"] = rows(t, ws)
        elif t["title"] == V.BENCH_SHARE_TABLE_TITLE:
            out["bench"] = rows(t, ws)
        elif t["title"] == V.FUEL_TABLE_TITLE:
            out["fuel_total"] = {h: ws.cell(t["total_row"], t["first_col"] + j).value for j, h in enumerate(t["columns"])}
        elif t["role"] == "kpi" and t["sheet"] == "Innova":
            out["innova_b3"] = ws.cell(t["first_data_row"], t["first_col"]).value
        elif t["role"] == "kpi" and t["sheet"] == "US vs CA Same-ASIN":
            out["same_asin_b3"] = ws.cell(t["first_data_row"], t["first_col"] + 1).value
        elif t["role"] == "modelb_app_matrix":
            out["apps"] = [ws.cell(r, t["first_col"]).value for r in range(t["first_data_row"], t["last_data_row"] + 1)]
    trend = next(t for t in reg["tables"] if t["workbook"] == aname and t["role"] == "trend_proxy")
    ws = load_workbook(BUILD / "cr" / aname)["Trend Proxy"]
    out["trend_total"] = {h: ws.cell(trend["total_row"], trend["first_col"] + j).value for j, h in enumerate(trend["columns"])}
    return out


def statuses(lines: list[str]) -> dict[str, tuple[str, str]]:
    out = {}
    for ln in lines[:-1]:
        m = CHECK_LINE_RE.match(ln)
        if m:
            out[m.group(2)] = (m.group(1), m.group(4))
    return out


class ValidatorFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _Built.ensure()
        cls.rc_bad, cls.lines_bad = run_validator(memo=write_memo("memo_bad.md", fixed=False),
                                                  json_path=ROOT / "result_bad.json")
        cls.rc_ok, cls.lines_ok = run_validator(memo=write_memo("memo_ok.md", fixed=True))

    def test_exactly_23_check_lines_in_order_then_final_line(self):
        for lines in (self.lines_bad, self.lines_ok):
            self.assertEqual(len(lines), 24, "\n".join(lines))
            ids = []
            for ln in lines[:23]:
                m = CHECK_LINE_RE.match(ln)
                self.assertIsNotNone(m, ln)
                ids.append(m.group(2))
            self.assertEqual(ids, list(C.VALIDATION_CHECKS))
            self.assertRegex(lines[-1], C.VALIDATION_FINAL_RE)

    def test_memo_defects_fail_v20_and_the_fixed_memo_passes(self):
        st, ev = statuses(self.lines_bad)["V20"]
        self.assertEqual(st, "FAIL", ev)
        self.assertIn(f"{CR_REPORT}!Summary!{_Built.lst_ref}", ev)     # the wrong number
        self.assertIn("1 [WB: TBD]", ev)                                  # the placeholder count
        self.assertNotIn(f"Summary!{_Built.rev_ref}", ev)                 # the correct tag is not reported
        self.assertEqual(self.rc_bad, 1)
        self.assertRegex(self.lines_bad[-1], r"^VALIDATION: FAIL \(\d+/23; failed: .*V20.*\)$")
        st, ev = statuses(self.lines_ok)["V20"]
        self.assertEqual(st, "PASS", ev)

    def test_clean_fixture_passes_with_real_data_only_checks_skipped(self):
        st = statuses(self.lines_ok)
        failed = {k: v for k, v in st.items() if v[0] == "FAIL"}
        self.assertEqual(failed, {}, "\n".join(self.lines_ok))
        self.assertEqual(self.rc_ok, 0)
        self.assertEqual(st["V17"][0], "SKIP")
        self.assertIn("raw dir absent", st["V17"][1])
        self.assertIn(str(ABSENT / "ca_cr"), st["V17"][1])
        self.assertIn("raw-input hashes skipped", st["V19"][1])
        self.assertIn("Bully Dog check skipped", st["V12"][1])
        self.assertRegex(self.lines_ok[-1], r"^VALIDATION: PASS \(22/23\)$")

    def test_json_results(self):
        data = json.loads((ROOT / "result_bad.json").read_text(encoding="utf-8"))
        self.assertEqual([r["id"] for r in data["checks"]], list(C.VALIDATION_CHECKS))
        self.assertEqual(data["final"], self.lines_bad[-1])
        self.assertEqual(data["exit_code"], 1)

    def test_tampered_summary_total_fails_v01_and_v09(self):
        d = ROOT / "tamper_total"
        shutil.copytree(BUILD / "cr", d)
        wb = load_workbook(d / CR_REPORT)
        ws = wb["Summary"]
        ws[_Built.rev_ref].value = _Built.rev_value + 250.0
        wb.save(d / CR_REPORT)
        rc, lines = run_validator(cr=d, memo=write_memo("memo_ok2.md", fixed=True))
        st = statuses(lines)
        self.assertEqual(rc, 1)
        self.assertEqual(st["V01"][0], "FAIL", st["V01"])
        self.assertEqual(st["V09"][0], "FAIL", st["V09"])
        self.assertEqual(st["V19"][0], "FAIL", st["V19"])          # the edited file no longer matches its manifest hash

    def test_tampered_all_asins_row_fails_v18_and_v09(self):
        d = ROOT / "tamper_row"
        shutil.copytree(BUILD / "cr", d)
        wb = load_workbook(d / CR_REPORT)
        ws = wb["All ASINs"]
        r, c = _Built.all_rev_cell
        ws.cell(r, c).value = float(ws.cell(r, c).value) + 99.0
        wb.save(d / CR_REPORT)
        rc, lines = run_validator(cr=d, memo=write_memo("memo_ok3.md", fixed=True))
        st = statuses(lines)
        self.assertEqual(rc, 1)
        self.assertEqual(st["V18"][0], "FAIL", st["V18"])
        self.assertEqual(st["V09"][0], "FAIL", st["V09"])
        self.assertEqual(st["V01"][0], "PASS", st["V01"])

    def test_tampered_manifest_fails_v19(self):
        d = ROOT / "tamper_manifest"
        shutil.copytree(BUILD / "gauge_us", d)
        mp = d / C.manifest_name(MONTH)
        m = json.loads(mp.read_text(encoding="utf-8"))
        name = next(iter(m["outputs"]))
        m["outputs"][name]["sha256"] = "0" * 64
        mp.write_text(json.dumps(m, indent=1), encoding="utf-8")
        rc, lines = run_validator(gauge_us=d, memo=write_memo("memo_ok4.md", fixed=True))
        st = statuses(lines)
        self.assertEqual(st["V19"][0], "FAIL", st["V19"])
        self.assertIn(name, st["V19"][1])
        self.assertEqual(rc, 1)

    def test_v09_covers_share_fuel_count_and_app_matrix_tables(self):
        st, ev = statuses(self.lines_ok)["V09"]
        self.assertEqual(st, "PASS", ev)
        # CA: share table, fuel split, Innova!B3, app matrix, US Benchmark share, Same-ASIN!B3; US: share, fuel, Innova!B3
        self.assertIn("+ 9 share/fuel/count/app-matrix tables", ev)

    def test_new_rule_fixture_values(self):
        """The cells the new V09 rules check hold the values computed here straight from the fixture CSVs."""
        ca = X.read_normalized_csv(CA_FIXTURE)
        us = X.read_normalized_csv(US_FIXTURE)
        cr = ca[ca["source_set"].isin(["code_reader", "both"])]
        core = _core(ca)
        a = core[core["source_set"].isin(["code_reader", "both"])]
        g = core[core["source_set"] == "gauge"]
        self.assertEqual((len(cr), round(cr["revenue_month"].sum(), 2), cr["units_month"].sum()), (13, 59706.13, 382))
        self.assertEqual((len(a), round(a["revenue_month"].sum(), 2), len(core), len(cr) + len(g)), (4, 10562.71, 9, 18))
        cells = _special_cells()
        self.assertEqual(cells["share"]["(a) Gauge devices inside the code-reader export"]["# ASINs"], 4)
        self.assertAlmostEqual(cells["share"]["(a) Gauge devices inside the code-reader export"]["Share of revenue"],
                               a["revenue_month"].sum() / cr["revenue_month"].sum(), places=12)
        den_rev = cr["revenue_month"].sum() + g["revenue_month"].sum()
        self.assertAlmostEqual(cells["share"]["(b) All core gauge devices (CR ∪ gauge export)"]["Share of revenue"],
                               core["revenue_month"].sum() / den_rev, places=12)
        self.assertEqual(cells["share"]["(b) denominator: CR total + gauge-only rows"]["# ASINs"], 18)
        # CA fixture has no fuel_scope column: every core device is 'unspecified'
        self.assertEqual(cells["fuel_total"]["unspecified: # ASINs"], 9)
        self.assertEqual(cells["fuel_total"]["gas: # ASINs"], 0)
        us_core = _core(us)
        us_cr = us[us["source_set"].isin(["code_reader", "both"])]
        us_a = us_core[us_core["source_set"].isin(["code_reader", "both"])]
        self.assertAlmostEqual(cells["bench"]["(a) Gauge devices inside the code-reader export: share of units"]["US share"],
                               us_a["units_month"].sum() / us_cr["units_month"].sum(), places=12)
        self.assertEqual(cells["innova_b3"], 0)
        self.assertEqual(cells["same_asin_b3"], 1)
        self.assertEqual(cells["apps"], list(C.APP_FEATURE_MATRIX_APPS))
        yoy = cr["yoy_units_pct"]
        self.assertEqual(cells["trend_total"]["# Listings with Helium 10 YoY data"], int(yoy.notna().sum()))
        self.assertEqual(cells["trend_total"]["# Listings with YoY > 0"], int((yoy > 0).sum()))
        self.assertEqual(cells["trend_total"]["# Listings with YoY < 0"], int((yoy < 0).sum()))
        self.assertEqual(cells["trend_total"]["Last Year Sales (Helium 10 field; semantics unverified)"],
                         cr["last_year_units"].dropna().sum())

    def test_tampered_special_tables_fail_v09(self):
        d_g, d_cr = ROOT / "tamper_special_gauge", ROOT / "tamper_special_cr"
        shutil.copytree(BUILD / "gauge_ca", d_g)
        shutil.copytree(BUILD / "cr", d_cr)
        reg = _registry("CA")
        gname = C.gauge_report_name("CA", MONTH)
        wb = load_workbook(d_g / gname)
        edits = []
        for t in reg["tables"]:
            if t["workbook"] != gname:
                continue
            ws = wb[t["sheet"]]
            if t["title"] == V.SHARE_TABLE_TITLE:
                c = ws.cell(t["first_data_row"] + 1, t["first_col"] + t["columns"].index("Share of revenue"))
                c.value = c.value + 0.01
                edits.append("Summary/kpi")
            elif t["title"] == V.FUEL_TABLE_TITLE:
                c = ws.cell(t["total_row"], t["first_col"] + t["columns"].index("unspecified: # ASINs"))
                c.value = c.value + 1
                edits.append("Summary/subtype_mix")
            elif t["title"] == V.BENCH_SHARE_TABLE_TITLE:
                c = ws.cell(t["first_data_row"], t["first_col"] + t["columns"].index("US share"))
                c.value = c.value + 0.02
                edits.append("US Benchmark/kpi")
            elif t["role"] == "kpi" and t["sheet"] == "Innova":
                ws.cell(t["first_data_row"], t["first_col"]).value = 5
                edits.append("Innova/kpi")
            elif t["role"] == "kpi" and t["sheet"] == "US vs CA Same-ASIN":
                ws.cell(t["first_data_row"], t["first_col"] + 1).value = 7
                edits.append("US vs CA Same-ASIN/kpi")
            elif t["role"] == "modelb_app_matrix":
                src = t["first_col"] + t["columns"].index("Source")
                ws.cell(t["first_data_row"], src).value = 3.5
                edits.append("App-Gauge Proxy (Model B)/modelb_app_matrix")
        self.assertEqual(len(edits), 6, edits)
        wb.save(d_g / gname)
        aname = C.cr_analysis_name("CA", MONTH)
        trend = next(t for t in reg["tables"] if t["workbook"] == aname and t["role"] == "trend_proxy")
        wb = load_workbook(d_cr / aname)
        c = wb["Trend Proxy"].cell(trend["total_row"], trend["first_col"] + trend["columns"].index("# Listings with YoY > 0"))
        c.value = c.value + 1
        wb.save(d_cr / aname)
        rc, lines = run_validator(cr=d_cr, gauge_ca=d_g, memo=write_memo("memo_ok6.md", fixed=True))
        st, ev = statuses(lines)["V09"]
        self.assertEqual(rc, 1)
        self.assertEqual(st, "FAIL", ev)
        self.assertIn("7 problem(s)", ev)
        for label in edits:
            self.assertIn(f"{gname}!{label}", ev)
        self.assertIn(f"{aname}!Trend Proxy/trend_proxy Total '# Listings with YoY > 0'", ev)

    def test_skip_needs_a_documented_reason(self):
        rc, lines = run_validator(memo=write_memo("memo_bad2.md", fixed=False), extra=["--skip", "V20"])
        st = statuses(lines)
        self.assertEqual(st["V20"][0], "SKIP")
        self.assertIn(V.SKIPPABLE["V20"], st["V20"][1])
        self.assertEqual(rc, 0)
        with self.assertRaises(SystemExit), contextlib.redirect_stderr(io.StringIO()):
            V.main(["--month", MONTH, "--skip", "V01"])

    def test_missing_dataset_source_fails_explicitly(self):
        argv = ["--month", MONTH, "--cr-out-dir", str(BUILD / "cr"), "--gauge-out-dir", str(BUILD / "gauge_ca"),
                "--us-gauge-out-dir", str(BUILD / "gauge_us"), "--runs-dir", str(RUNS),
                "--raw-dir", str(ABSENT / "ca_cr"), "--gauge-raw-dir", str(ABSENT / "ca_gauge"),
                "--us-gauge-raw-dir", str(ABSENT / "us_gauge"), "--us-cr-raw-dir", str(ABSENT / "us_cr"),
                "--memo", str(write_memo("memo_ok5.md", fixed=True)), "--sources", str(_Built.sources)]
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            rc = V.main(argv)
        st = statuses(buf.getvalue().splitlines())
        self.assertEqual(rc, 1)
        self.assertEqual(st["V01"][0], "FAIL")
        self.assertIn("no dataset source", st["V01"][1])
        self.assertEqual(st["V10"][0], "PASS")      # workbook-only checks still run


if __name__ == "__main__":
    unittest.main()
