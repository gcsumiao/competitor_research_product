"""Loader: discovery, robust read, normalization, dedupe ordering + audit, brands, freeze/replay, union."""
from __future__ import annotations

import csv
import hashlib
import math
import shutil
import tempfile
import unittest
from datetime import date
from pathlib import Path

import pandas as pd

from ca_market_reports.ca_common import (BASE_ROW_COLUMNS, BRAND_RECOVERY_COLUMNS, DEDUPE_AUDIT_COLUMNS, FIXTURES_DIR,
                                         TYPE_DECISIONS_COLUMNS, TYPE_OVERRIDES_COLUMNS, TYPE_REVIEW_COLUMNS, TYPE_SOURCES,
                                         TYPES, run_file)
from ca_market_reports import ca_load

DATE = "2026-10-02"
CR_NAMES = {"cr_page1.csv": f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv",
            "cr_page2.csv": f"CA_AMAZON_blackBoxProducts_1_{DATE} (1).csv"}
G_NAMES = {"gauge_page1.csv": f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv",
           "gauge_bullydog.csv": f"CA_AMAZON_blackBoxProducts_bullydog_{DATE}.csv"}


def _read_fixture(name):
    with open(FIXTURES_DIR / name, newline="", encoding="utf-8-sig") as fh:
        rows = list(csv.DictReader(fh))
    return rows


def _write_rows(path, rows, header=None, encoding="utf-8-sig"):
    header = header or list(rows[0].keys())
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding=encoding) as fh:
        w = csv.DictWriter(fh, fieldnames=header, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)
    return path


class Stage:
    """Copies the synthetic fixtures into a temp tree with Helium 10 style dated file names."""

    def __init__(self, td: Path):
        self.root = td
        self.cr = td / "cr"
        self.gauge = td / "gauge"
        self.runs = td / "runs"
        self.cr.mkdir()
        self.gauge.mkdir()
        for src, dst in CR_NAMES.items():
            shutil.copy(FIXTURES_DIR / src, self.cr / dst)
        for src, dst in G_NAMES.items():
            shutil.copy(FIXTURES_DIR / src, self.gauge / dst)
        (self.cr / f"._CA_AMAZON_blackBoxProducts_1_{DATE}.csv").write_bytes(b"\x00\x05\x16\x07AppleDouble")
        self.overrides = td / "ca_type_overrides.csv"
        self.write_overrides([])

    def write_overrides(self, rows):
        pd.DataFrame(rows, columns=list(TYPE_OVERRIDES_COLUMNS)).to_csv(self.overrides, index=False)

    def load(self, month="202609", **kw):
        args = dict(cr_raw_dir=self.cr, gauge_raw_dir=self.gauge, us_type_map=FIXTURES_DIR / "us_type_map_mini.csv",
                    type_map=self.overrides, runs_dir=self.runs)
        args.update(kw)
        return ca_load.load_month("CA", month, **args)


class DiscoveryTest(unittest.TestCase):
    def test_discover_sorted_skips_appledouble(self):
        with tempfile.TemporaryDirectory() as td:
            st = Stage(Path(td))
            names = [p.name for p in ca_load.discover_raw_files(st.gauge)]
            self.assertEqual(names, sorted(G_NAMES.values()))
            names = [p.name for p in ca_load.discover_raw_files(st.cr)]
            self.assertEqual(names, [CR_NAMES["cr_page2.csv"], CR_NAMES["cr_page1.csv"]], "lexical: ' (1)' sorts before '.csv'")

    def test_missing_dir_raises(self):
        with self.assertRaises(FileNotFoundError):
            ca_load.discover_raw_files(Path("/nonexistent/ca_reports_dir"))

    def test_input_hashes(self):
        with tempfile.TemporaryDirectory() as td:
            st = Stage(Path(td))
            files = ca_load.discover_raw_files(st.gauge)
            h = ca_load.input_hashes(files)
            self.assertEqual(len(h), 2)
            for p in files:
                key = [k for k in h if k.endswith(p.name)]
                self.assertEqual(len(key), 1)
                self.assertEqual(h[key[0]], hashlib.sha256(p.read_bytes()).hexdigest())

    def test_input_hashes_never_collapse_same_names(self):
        with tempfile.TemporaryDirectory() as td:
            st = Stage(Path(td))
            both = ca_load.discover_raw_files(st.cr) + ca_load.discover_raw_files(st.gauge)
            self.assertEqual(len(ca_load.input_hashes(both)), 4)


class LoadFixtureTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._td = tempfile.TemporaryDirectory()
        cls.st = Stage(Path(cls._td.name))
        cls.ds = cls.st.load()

    @classmethod
    def tearDownClass(cls):
        cls._td.cleanup()

    def test_shape_and_columns(self):
        cr, g = self.ds.code_reader, self.ds.gauge_set
        self.assertEqual(tuple(cr.columns), BASE_ROW_COLUMNS)
        self.assertEqual(tuple(g.columns), BASE_ROW_COLUMNS)
        self.assertEqual(len(cr), 26)       # 20 + 8 rows, two duplicated ASINs
        self.assertEqual(len(g), 11)
        self.assertEqual(cr["asin"].duplicated().sum(), 0)
        self.assertEqual(self.ds.market, "CA")
        self.assertEqual(self.ds.month, "202609")
        self.assertEqual(self.ds.export_dates, (date(2026, 10, 2), date(2026, 10, 2)))
        self.assertEqual(self.ds.raw_files, [(CR_NAMES["cr_page2.csv"], 8), (CR_NAMES["cr_page1.csv"], 20),
                                             (G_NAMES["gauge_page1.csv"], 9), (G_NAMES["gauge_bullydog.csv"], 2)])
        self.assertEqual(set(self.ds.audits), {"dedupe_audit", "brand_recovery", "type_decisions", "type_review"})

    def test_asin_and_url(self):
        cr = self.ds.code_reader.set_index("asin")
        self.assertIn("B0TESTBAD1", cr.index)
        self.assertEqual(cr.loc["B0TESTAUT1", "url"], "https://amazon.ca/dp/B0TESTAUT1")
        self.assertTrue(self.ds.code_reader["url"].str.fullmatch(r"https://amazon\.ca/dp/[A-Z0-9]{10}").all())
        self.assertEqual(cr.loc["B0TESTAUT1", "image_url"], "https://m.media-amazon.com/images/I/TEST.jpg")

    def test_numbers(self):
        cr = self.ds.code_reader.set_index("asin")
        aut = cr.loc["B0TESTAUT1"]
        self.assertEqual((aut.units_month, aut.revenue_month, aut.list_price), (20.0, 13199.80, 659.99))
        self.assertAlmostEqual(aut.price, 13199.80 / 20, places=9, msg="realized price = revenue / units (unrounded)")
        self.assertAlmostEqual(aut.yoy_units_pct, 0.33)
        self.assertAlmostEqual(aut.sales_trend_90d_pct, 0.12)
        self.assertTrue(math.isnan(aut.price_trend_90d_pct), "blank pct -> NaN, never 0")
        self.assertEqual((aut.bsr, aut.subcategory_bsr, aut.last_year_units, aut.listing_age_months), (120.0, 50.0, 180.0, 60.0))
        anc = cr.loc["B0TESTANC1"]
        self.assertAlmostEqual(anc.yoy_units_pct, -0.20)
        self.assertTrue(math.isnan(anc.sales_trend_90d_pct))
        gen = cr.loc["B0TESTGEN1"]
        self.assertTrue(math.isnan(gen.last_year_units), "N/A last-year -> NaN")
        self.assertTrue(math.isnan(gen.yoy_units_pct))
        edg = cr.loc["B0TESTEDG2"]
        self.assertEqual((edg.units_month, edg.revenue_month), (0.0, 0.0), "'-' revenue -> 0")
        self.assertEqual(edg.price, 1085.34, "units == 0 -> list price")
        inn2 = cr.loc["B0TESTINN2"]
        self.assertAlmostEqual(inn2.price, 173.90)
        self.assertFalse(bool(cr.loc["B0TESTAUT1", "frequently_returned"]))
        self.assertEqual(cr["frequently_returned"].dtype, bool)

    def test_meta_columns(self):
        cr = self.ds.code_reader.set_index("asin")
        r = cr.loc["B0TESTDUP2"]
        self.assertEqual((r.export_date, r.source_file, r.source_set, r.market, r.currency),
                         (DATE, CR_NAMES["cr_page1.csv"], "code_reader", "CA", "CAD"))
        self.assertTrue((self.ds.gauge_set["source_set"] == "gauge").all())
        g = self.ds.gauge_set
        self.assertTrue((g["type"] == "").all() and (g["type_source"] == "").all() and g["type_confidence"].isna().all())
        self.assertTrue((g["price_tier"] == "").all())
        for frame in (cr.reset_index(), g):
            self.assertTrue((frame["gauge_class"] == "").all())
            self.assertTrue((frame["gauge_rule_id"] == "").all())
            self.assertTrue(frame["gauge_confidence"].isna().all())

    def test_dedupe_audit(self):
        audit = self.ds.audits["dedupe_audit"]
        self.assertEqual(tuple(audit.columns), DEDUPE_AUDIT_COLUMNS)
        a = audit.set_index("asin")
        self.assertEqual(sorted(a.index), ["B0TESTDUP1", "B0TESTDUP2"])
        d1 = a.loc["B0TESTDUP1"]
        self.assertEqual((d1.n_rows, d1.winning_rule, bool(d1.values_identical)), (2, "identical", True))
        self.assertEqual(d1.chosen_file, CR_NAMES["cr_page2.csv"], "identical rows: path ASC decides the chosen copy")
        d2 = a.loc["B0TESTDUP2"]
        self.assertEqual((d2.n_rows, d2.winning_rule, bool(d2.values_identical)), (2, "revenue", False))
        self.assertEqual(d2.chosen_file, CR_NAMES["cr_page1.csv"])
        self.assertEqual(int(d2.chosen_row), 19)
        self.assertEqual(d2.dropped, f"{CR_NAMES['cr_page2.csv']}:1")
        self.assertEqual((d2.revenue_chosen, d2.revenue_dropped_max), (399.90, 359.91))
        self.assertEqual(d2.units_diff, 1.0)
        self.assertAlmostEqual(d2.price_diff, 0.0)
        self.assertEqual(d2.title_diff, "N")
        self.assertEqual(d2.discrepancy_flag, "")
        self.assertEqual(self.ds.code_reader.set_index("asin").loc["B0TESTDUP2", "revenue_month"], 399.90)

    def test_brands(self):
        cr = self.ds.code_reader.set_index("asin")
        self.assertEqual(cr.loc["B0TESTEDG1", "brand_key"], "edge products")
        self.assertEqual(cr.loc["B0TESTEDG1", "brand_display"], "Edge Products")
        self.assertEqual(cr.loc["B0TESTEDG1", "brand_raw"], "EDGE")
        self.assertEqual(cr.loc["B0TESTGEN1", "brand_key"], "foxwell")
        self.assertEqual(cr.loc["B0TESTGEN1", "brand_display"], "FOXWELL")
        self.assertEqual(cr.loc["B0TESTGEN2", "brand_key"], "generic")
        self.assertEqual(int((self.ds.code_reader["brand_key"] == "innova").sum()), 2)
        self.assertEqual(cr.loc["B0TESTOTH1", "brand_display"], "Diesel Laptops")
        g = self.ds.gauge_set
        self.assertEqual(int((g["brand_key"] == "bully dog").sum()), 2)
        rec = self.ds.audits["brand_recovery"]
        self.assertEqual(tuple(rec.columns), BRAND_RECOVERY_COLUMNS)
        self.assertEqual(rec["asin"].tolist(), ["B0TESTGEN1"])

    def test_types_and_tiers(self):
        cr = self.ds.code_reader.set_index("asin")
        self.assertTrue(set(cr["type"]) <= set(TYPES))
        self.assertTrue(set(cr["type_source"]) <= set(TYPE_SOURCES))
        self.assertEqual((cr.loc["B0TESTAUT1", "type"], cr.loc["B0TESTAUT1", "type_source"]), ("Tablet", "us_map"))
        self.assertEqual((cr.loc["B0TESTEDG2", "type"], cr.loc["B0TESTEDG2", "type_rule_id"]), ("Other", "gauge_hud"))
        self.assertEqual((cr.loc["B0TESTTAB1", "type"], cr.loc["B0TESTTAB1", "type_rule_id"]), ("Tablet", "price_tablet_hint"))
        self.assertEqual(cr.loc["B0TESTCBL2", "type"], "Cable/Adapter")
        self.assertEqual(cr.loc["B0TESTHUD1", "type_rule_id"], "gauge_hud")
        self.assertEqual(cr.loc["B0TESTBRK1", "type_source"], "default_other")
        # 'Case for Innova 5610 Scanner' at CA$19.99: the scanner_lt380 keyword rule (last rule) types it Handheld
        self.assertEqual((cr.loc["B0TESTGEN2", "type"], cr.loc["B0TESTGEN2", "type_rule_id"], cr.loc["B0TESTGEN2", "type_confidence"]),
                         ("Handheld", "scanner_lt380", 0.8))
        self.assertEqual(cr.loc["B0TESTEX40", "price_tier"], "Tablet $400-$800")
        self.assertEqual(cr.loc["B0TESTTAB1", "price_tier"], "Tablet $800+")
        self.assertEqual(cr.loc["B0TESTINN1", "price_tier"], "Handheld $75+")
        self.assertTrue((cr["price_tier"] != "").all())
        self.assertFalse(cr["type_conflict"].any())
        dec = self.ds.audits["type_decisions"]
        self.assertEqual(tuple(dec.columns), TYPE_DECISIONS_COLUMNS)
        self.assertEqual(len(dec), 26)
        rv = self.ds.audits["type_review"]
        self.assertEqual(tuple(rv.columns), TYPE_REVIEW_COLUMNS)
        self.assertEqual(set(rv["asin"]), set(cr.index[cr["type_source"] == "default_other"]))

    def test_freeze_files_written(self):
        runs = self.st.runs
        for stem, scope in [("dedupe_audit", "CA_code_reader"), ("dedupe_audit", "CA_gauge"), ("brand_recovery", "CA_code_reader"),
                            ("brand_recovery", "CA_gauge"), ("type_decisions", "CA_code_reader"), ("type_review", "CA_code_reader")]:
            self.assertTrue(run_file(runs, "202609", stem, scope).exists(), (stem, scope))
        self.assertFalse(run_file(runs, "202609", "type_decisions", "CA_gauge").exists())
        dec = pd.read_csv(run_file(runs, "202609", "type_decisions", "CA_code_reader"), dtype=str, keep_default_na=False)
        self.assertRegex(dec["run_id"].iloc[0], r"^\d{8}-\d{6}-([0-9a-f]{4,}|nogit)$")


class LoadValidationTest(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.st = Stage(Path(self._td.name))

    def tearDown(self):
        self._td.cleanup()

    def test_month_market_and_us_guard(self):
        with self.assertRaises(ValueError):
            ca_load.load_month("CA", "202613", cr_raw_dir=self.st.cr, gauge_raw_dir=None, runs_dir=self.st.runs, freeze=False)
        with self.assertRaises(ValueError):
            ca_load.load_month("MX", "202609", cr_raw_dir=self.st.cr, gauge_raw_dir=None, runs_dir=self.st.runs, freeze=False)
        with self.assertRaises(ValueError) as cm:
            ca_load.load_month("US", "202609", cr_raw_dir=self.st.cr, gauge_raw_dir=None, runs_dir=self.st.runs, freeze=False)
        self.assertIn("US", str(cm.exception))

    def test_us_without_types(self):
        ds = ca_load.load_month("US", "202609", cr_raw_dir=self.st.cr, gauge_raw_dir=self.st.gauge, runs_dir=self.st.runs,
                                assign_types=False, freeze=False)
        cr = ds.code_reader
        self.assertTrue((cr["type"] == "").all() and (cr["type_source"] == "").all() and cr["type_confidence"].isna().all())
        self.assertTrue((cr["price_tier"] == "").all())
        self.assertTrue(cr["url"].str.startswith("https://amazon.com/dp/").all())
        self.assertTrue((cr["currency"] == "USD").all())
        self.assertFalse(self.st.runs.exists(), "freeze=False writes nothing")

    def test_gauge_dir_none_uses_default_and_absent_default_gives_none(self):
        # None means "the market default dir"; 199001 has no gauge export in NewProductCategory -> gauge_set None
        with self.assertLogs("ca_market_reports", level="WARNING") as cm:
            ds = self.st.load(month="199001", gauge_raw_dir=None, freeze=False)
        self.assertIsNone(ds.gauge_set)
        self.assertEqual(len(ds.raw_files), 2)
        self.assertTrue([m for m in cm.output if "gauge_set=None" in m], cm.output)

    def test_explicit_missing_gauge_dir_raises(self):
        with self.assertRaises(FileNotFoundError):
            self.st.load(gauge_raw_dir=self.st.root / "no_such_dir", freeze=False)

    def test_missing_required_column(self):
        rows = _read_fixture("cr_page1.csv")
        header = [c for c in rows[0] if c != "ASIN Revenue"]
        bad = self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE} (7).csv"
        _write_rows(bad, rows, header)
        with self.assertRaises(ValueError) as cm:
            self.st.load(freeze=False)
        self.assertIn(bad.name, str(cm.exception))
        self.assertIn("ASIN Revenue", str(cm.exception))

    def test_missing_optional_column(self):
        rows = _read_fixture("cr_page1.csv")
        header = [c for c in rows[0] if c not in ("Frequently Returned Item Badge", "Last Year Sales")]
        for p in list(self.st.cr.glob("CA_*.csv")):
            p.unlink()
        _write_rows(self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv", rows, header)
        ds = self.st.load(freeze=False)
        self.assertFalse(ds.code_reader["frequently_returned"].any())
        self.assertTrue(ds.code_reader["last_year_units"].isna().all())

    def test_frequently_returned_yes(self):
        rows = _read_fixture("cr_page1.csv")
        rows[0]["Frequently Returned Item Badge"] = "Yes"
        rows[1]["Frequently Returned Item Badge"] = "-"
        _write_rows(self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv", rows)
        cr = self.st.load(freeze=False).code_reader.set_index("asin")
        self.assertTrue(bool(cr.loc[rows[0]["ASIN"], "frequently_returned"]))
        self.assertFalse(bool(cr.loc[rows[1]["ASIN"], "frequently_returned"]))

    def test_file_without_date_raises(self):
        shutil.copy(FIXTURES_DIR / "cr_page1.csv", self.st.cr / "cr_page1.csv")
        with self.assertRaises(ValueError) as cm:
            self.st.load(freeze=False)
        self.assertIn("cr_page1.csv", str(cm.exception))

    def test_unparsable_number_raises_with_row(self):
        rows = _read_fixture("cr_page1.csv")
        rows[3]["ASIN Sales"] = "lots"
        bad = _write_rows(self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv", rows)
        with self.assertRaises(ValueError) as cm:
            self.st.load(freeze=False)
        msg = str(cm.exception)
        self.assertIn(bad.name, msg)
        self.assertIn("ASIN Sales", msg)
        self.assertIn("3", msg)

    def test_parent_level_never_read(self):
        rows = _read_fixture("cr_page1.csv")
        for r in rows:
            r["Parent Level Sales"] = "999999"
            r["Parent Level Revenue"] = "999999999"
        _write_rows(self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv", rows)
        cr = self.st.load(freeze=False).code_reader.set_index("asin")
        self.assertEqual(cr.loc["B0TESTAUT1", "revenue_month"], 13199.80)
        self.assertEqual(cr.loc["B0TESTAUT1", "units_month"], 20.0)

    def test_bad_asin_goes_to_audit(self):
        rows = _read_fixture("cr_page2.csv")
        rows.append(dict(rows[0], ASIN="NOT-AN-ASIN", Title="junk"))
        rows.append(dict(rows[0], ASIN="", Title="blank"))
        _write_rows(self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE} (1).csv", rows)
        ds = self.st.load(freeze=False)
        self.assertNotIn("NOT-AN-ASIN", set(ds.code_reader["asin"]))
        self.assertEqual(len(ds.code_reader), 26)
        bad = ds.audits["dedupe_audit"]
        bad = bad[bad["winning_rule"] == "bad_asin"]
        self.assertEqual(len(bad), 2)
        self.assertIn(f"CA_AMAZON_blackBoxProducts_1_{DATE} (1).csv:8", set(bad["dropped"]))

    def test_cp1252_file(self):
        rows = _read_fixture("cr_page1.csv")[:2]
        rows[0]["Title"] = "Autel MaxiCOM édition ®"
        for p in list(self.st.cr.glob("CA_*.csv")):
            p.unlink()
        _write_rows(self.st.cr / f"CA_AMAZON_blackBoxProducts_1_{DATE}.csv", rows, encoding="cp1252")
        cr = self.st.load(freeze=False).code_reader.set_index("asin")
        self.assertEqual(cr.loc[rows[0]["ASIN"], "title"], "Autel MaxiCOM édition ®")

    def test_dedupe_ordering_tiebreaks(self):
        rows = _read_fixture("cr_page1.csv")[:1]
        base = dict(rows[0], ASIN="B0ORD00001", **{"ASIN Revenue": "100", "ASIN Sales": "2", "BSR": "50"})
        for p in list(self.st.cr.glob("CA_*.csv")):
            p.unlink()
        # bsr: NaN last; then export date ASC; then path ASC; then row ASC
        _write_rows(self.st.cr / "CA_x_2026-10-03.csv", [dict(base, BSR="40"), dict(base, BSR="N/A", Title="t2")])
        _write_rows(self.st.cr / "CA_y_2026-10-01.csv", [dict(base, BSR="40", Title="older export"),
                                                          dict(base, ASIN="B0ORD00002"), dict(base, ASIN="B0ORD00002", Title="row1")])
        _write_rows(self.st.cr / "CA_a_2026-10-01.csv", [dict(base, ASIN="B0ORD00003")])
        _write_rows(self.st.cr / "CA_b_2026-10-01.csv", [dict(base, ASIN="B0ORD00003", Title="b")])
        _write_rows(self.st.cr / "CA_z_2026-10-01.csv", [dict(base, ASIN="B0ORD00004", BSR="N/A"), dict(base, ASIN="B0ORD00004", BSR="70")])
        with self.assertLogs("ca_market_reports", level="INFO") as cm:
            ds = self.st.load(freeze=False)
        a = ds.audits["dedupe_audit"]
        a = a[a["source_set"] == "code_reader"].set_index("asin")
        self.assertEqual((a.loc["B0ORD00001", "winning_rule"], a.loc["B0ORD00001", "chosen_file"]), ("export_date", "CA_y_2026-10-01.csv"))
        self.assertEqual(a.loc["B0ORD00001", "n_rows"], 3)
        self.assertEqual((a.loc["B0ORD00002", "winning_rule"], int(a.loc["B0ORD00002", "chosen_row"])), ("row", 1))
        self.assertEqual((a.loc["B0ORD00003", "winning_rule"], a.loc["B0ORD00003", "chosen_file"]), ("path", "CA_a_2026-10-01.csv"))
        self.assertEqual((a.loc["B0ORD00004", "winning_rule"], int(a.loc["B0ORD00004", "chosen_row"])), ("bsr", 1))
        self.assertEqual(ds.export_dates, (date(2026, 10, 1), date(2026, 10, 3)))
        cr = ds.code_reader.set_index("asin")
        self.assertEqual(cr.loc["B0ORD00001", "title"], "older export")
        self.assertEqual(cr.loc["B0ORD00004", "bsr"], 70.0)
        line = [m for m in cm.output if "dedupe[CA/code_reader]" in m]
        self.assertEqual(len(line), 1)
        self.assertTrue(line[0].endswith("dedupe[CA/code_reader]: rows=9 unique=4 identical=0 conflicting=4"), line[0])


class FreezeReplayTest(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.st = Stage(Path(self._td.name))

    def tearDown(self):
        self._td.cleanup()

    def _dec_path(self):
        return run_file(self.st.runs, "202609", "type_decisions", "CA_code_reader")

    def test_replay_keeps_frozen_and_appends_new(self):
        self.st.load()
        p = self._dec_path()
        dec = pd.read_csv(p, dtype=str, keep_default_na=False)
        # pretend an earlier run typed B0TESTGEN2 as Probe and never saw B0TESTOBD2
        dec.loc[dec.asin == "B0TESTGEN2", ["type", "type_source", "type_confidence", "run_id"]] = ["Probe", "keyword", "0.9", "old-run"]
        dec = dec[dec.asin != "B0TESTOBD2"]
        dec.to_csv(p, index=False)
        with self.assertLogs("ca_market_reports", level="INFO") as cm:
            ds = self.st.load()
        cr = ds.code_reader.set_index("asin")
        self.assertEqual((cr.loc["B0TESTGEN2", "type"], cr.loc["B0TESTGEN2", "type_source"]), ("Probe", "keyword"))
        self.assertEqual(cr.loc["B0TESTGEN2", "price_tier"], "Total Other Tools")
        self.assertEqual(cr.loc["B0TESTOBD2", "type"], "Cable/Adapter")
        self.assertTrue([m for m in cm.output if "unfrozen_candidates=1" in m], cm.output)
        again = pd.read_csv(p, dtype=str, keep_default_na=False)
        self.assertEqual(len(again), 26)
        self.assertEqual(again.set_index("asin").loc["B0TESTGEN2", "run_id"], "old-run")
        self.assertEqual(again["asin"].iloc[-1], "B0TESTOBD2", "new ASINs are appended")

    def test_override_map_beats_replay(self):
        self.st.load()
        self.st.write_overrides([("B0TESTAUT1", "Handheld", "analyst says", "ginny", "202609")])
        with self.assertLogs("ca_market_reports", level="WARNING") as cm:
            ds = self.st.load()
        cr = ds.code_reader.set_index("asin")
        self.assertEqual((cr.loc["B0TESTAUT1", "type"], cr.loc["B0TESTAUT1", "type_source"]), ("Handheld", "override"))
        self.assertEqual(cr.loc["B0TESTAUT1", "price_tier"], "Handheld $75+")
        self.assertTrue([m for m in cm.output if "B0TESTAUT1" in m], cm.output)
        dec = pd.read_csv(self._dec_path(), dtype=str, keep_default_na=False).set_index("asin")
        self.assertEqual((dec.loc["B0TESTAUT1", "type"], dec.loc["B0TESTAUT1", "type_source"]), ("Handheld", "override"))

    def test_rederive_ignores_frozen(self):
        self.st.load()
        p = self._dec_path()
        dec = pd.read_csv(p, dtype=str, keep_default_na=False)
        dec.loc[dec.asin == "B0TESTBRK1", ["type", "type_source"]] = ["Probe", "keyword"]
        dec.to_csv(p, index=False)
        ds = self.st.load(rederive=True)
        self.assertEqual(ds.code_reader.set_index("asin").loc["B0TESTBRK1", "type_source"], "default_other")
        self.assertEqual(pd.read_csv(p, dtype=str, keep_default_na=False).set_index("asin").loc["B0TESTBRK1", "type"], "Other")

    def test_corrupt_decision_file_raises(self):
        self.st.load()
        p = self._dec_path()
        dec = pd.read_csv(p, dtype=str, keep_default_na=False)
        dec.loc[0, "type"] = "Scanner"
        dec.to_csv(p, index=False)
        with self.assertRaises(ValueError):
            self.st.load()

    def test_brand_recovery_replay(self):
        self.st.load()
        p = run_file(self.st.runs, "202609", "brand_recovery", "CA_code_reader")
        rec = pd.read_csv(p, dtype=str, keep_default_na=False)
        rec.loc[rec.asin == "B0TESTGEN1", "new_brand"] = "launch"
        rec.to_csv(p, index=False)
        ds = self.st.load()
        cr = ds.code_reader.set_index("asin")
        self.assertEqual((cr.loc["B0TESTGEN1", "brand_key"], cr.loc["B0TESTGEN1", "brand_display"]), ("launch", "LAUNCH"))
        ds2 = self.st.load(rederive=True)
        self.assertEqual(ds2.code_reader.set_index("asin").loc["B0TESTGEN1", "brand_key"], "foxwell")

    def test_type_review_keeps_reviewed_type(self):
        self.st.load()
        p = run_file(self.st.runs, "202609", "type_review", "CA_code_reader")
        rv = pd.read_csv(p, dtype=str, keep_default_na=False)
        rv.loc[rv.asin == "B0TESTBRK1", "reviewed_type"] = "Other"
        rv.to_csv(p, index=False)
        ds = self.st.load()
        self.assertEqual(pd.read_csv(p, dtype=str, keep_default_na=False).set_index("asin").loc["B0TESTBRK1", "reviewed_type"], "Other")
        self.assertEqual(ds.audits["type_review"].set_index("asin").loc["B0TESTBRK1", "reviewed_type"], "Other")


class UnionTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._td = tempfile.TemporaryDirectory()
        cls.ds = Stage(Path(cls._td.name)).load(freeze=False)

    @classmethod
    def tearDownClass(cls):
        cls._td.cleanup()

    def test_union_cr_master(self):
        cr, g = self.ds.code_reader.copy(), self.ds.gauge_set.copy()
        g["gauge_only_col"] = "x"
        audit: list[dict] = []
        u = ca_load.union_gauge_frames(cr, g, audit)
        self.assertEqual(len(u), 26 + 11 - 1)
        self.assertEqual(u["asin"].duplicated().sum(), 0)
        self.assertIn("gauge_only_col", u.columns)
        self.assertEqual(list(u.columns[: len(BASE_ROW_COLUMNS)]), list(BASE_ROW_COLUMNS))
        hud = u.set_index("asin").loc["B0TESTHUD1"]
        self.assertEqual(hud["source_set"], "both")
        self.assertEqual(hud["type"], cr.set_index("asin").loc["B0TESTHUD1", "type"], "CR row is master")
        self.assertEqual(len(audit), 1)
        row = audit[0]
        self.assertEqual(set(row), set(DEDUPE_AUDIT_COLUMNS))
        self.assertEqual((row["asin"], row["winning_rule"], row["discrepancy_flag"], row["n_rows"]), ("B0TESTHUD1", "cr_master", "", 2))
        self.assertTrue(row["values_identical"])
        self.assertEqual(set(u.loc[u.asin.isin(g.asin) & ~u.asin.isin(cr.asin), "source_set"]), {"gauge"})
        self.assertEqual(set(cr["source_set"]), {"code_reader"}, "inputs are not mutated")

    def test_discrepancy_flag(self):
        cr, g = self.ds.code_reader.copy(), self.ds.gauge_set.copy()
        g.loc[g.asin == "B0TESTHUD1", "revenue_month"] = 9999.0
        audit: list[dict] = []
        u = ca_load.union_gauge_frames(cr, g, audit)
        self.assertEqual(audit[0]["discrepancy_flag"], "Y")
        self.assertFalse(audit[0]["values_identical"])
        self.assertEqual(u.set_index("asin").loc["B0TESTHUD1", "revenue_month"], 7138.81)
        self.assertEqual(audit[0]["revenue_dropped_max"], 9999.0)


if __name__ == "__main__":
    unittest.main()
