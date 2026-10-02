"""Type assignment: precedence, keyword rules (incl. gauge_hud), token profiles, review queue, overrides CLI."""
from __future__ import annotations

import io
import math
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import pandas as pd

from ca_market_reports.ca_common import (FIXTURES_DIR, TYPE_DECISIONS_COLUMNS, TYPE_OVERRIDES_COLUMNS, TYPE_REVIEW_COLUMNS,
                                         TYPE_SOURCES, run_file)
from ca_market_reports import apply_type_review, ca_types


def _frame(rows):
    """rows: (asin, title, brand_key, price[, revenue])"""
    out = []
    for r in rows:
        asin, title, brand, price = r[:4]
        rev = r[4] if len(r) > 4 else 0.0
        out.append({"asin": asin, "title": title, "brand_key": brand, "brand_display": brand.title(), "price": price,
                    "revenue_month": rev, "url": f"https://amazon.ca/dp/{asin}", "type": "", "type_source": "",
                    "type_confidence": math.nan, "type_rule_id": "", "type_conflict": False, "other": "keep"})
    return pd.DataFrame(out)


class LoadUsTypeMapTest(unittest.TestCase):
    def test_fixture_csv(self):
        m = ca_types.load_us_type_map(FIXTURES_DIR / "us_type_map_mini.csv")
        self.assertEqual(m["B0TESTAUT1"], "Tablet")
        self.assertEqual(m["B0TESTOTH1"], "VCI")
        self.assertEqual(len(m), 16)

    def test_xlsx_last_occurrence_and_upper(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "map.xlsx"
            pd.DataFrame({"Title": ["a", "b", "c"], "ASIN": [" b0lower001 ", "B0LOWER001", "B0OTHER001"],
                          "Type": ["Tablet", "Dongle", "Key"]}).to_excel(p, index=False)
            m = ca_types.load_us_type_map(p)
            self.assertEqual(m, {"B0LOWER001": "Dongle", "B0OTHER001": "Key"})

    def test_unknown_type_raises(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "map.csv"
            p.write_text("ASIN,Type\nB0TEST0001,Scanner\n", encoding="utf-8")
            with self.assertRaises(ValueError) as cm:
                ca_types.load_us_type_map(p)
            self.assertIn("Scanner", str(cm.exception))


class OverridesTest(unittest.TestCase):
    def _write(self, td, rows):
        p = Path(td) / "ov.csv"
        pd.DataFrame(rows, columns=list(TYPE_OVERRIDES_COLUMNS)).to_csv(p, index=False)
        return p

    def test_latest_decided_month_not_after_report_wins(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, [
                ("B0OVR00001", "Tablet", "r", "x", "202607"),
                ("B0OVR00001", "Handheld", "r", "x", "202608"),
                ("B0OVR00001", "Dongle", "r", "x", "202611"),   # future decision: not applicable to 202609
                ("B0OVR00002", "Key", "r", "x", "202609"),
                ("B0OVR00002", "Key", "r", "y", "202609"),      # same month, same value: fine
            ])
            self.assertEqual(ca_types.load_overrides(p, "202609"), {"B0OVR00001": "Handheld", "B0OVR00002": "Key"})
            self.assertEqual(ca_types.load_overrides(p, "202611")["B0OVR00001"], "Dongle")
            self.assertEqual(ca_types.load_overrides(p, "202606"), {})

    def test_same_month_conflict_raises(self):
        with tempfile.TemporaryDirectory() as td:
            p = self._write(td, [("B0OVR00001", "Tablet", "r", "x", "202609"), ("B0OVR00001", "Dongle", "r", "x", "202609")])
            with self.assertRaises(ValueError) as cm:
                ca_types.load_overrides(p, "202609")
            self.assertIn("B0OVR00001", str(cm.exception))

    def test_bad_type_or_month_raises(self):
        with tempfile.TemporaryDirectory() as td:
            with self.assertRaises(ValueError):
                ca_types.load_overrides(self._write(td, [("B0OVR00001", "Widget", "r", "x", "202609")]), "202609")
            with self.assertRaises(ValueError):
                ca_types.load_overrides(self._write(td, [("B0OVR00001", "Tablet", "r", "x", "202613")]), "202609")

    def test_empty_map_file(self):
        from ca_market_reports.ca_common import MAPS_DIR
        self.assertEqual(ca_types.load_overrides(MAPS_DIR / "ca_type_overrides.csv", "202609"), {})


class PriorMonthTest(unittest.TestCase):
    def test_reads_previous_month_and_excludes_weak_rows(self):
        with tempfile.TemporaryDirectory() as td:
            runs = Path(td)
            p = run_file(runs, "202608", "type_decisions", "CA_code_reader")
            p.parent.mkdir(parents=True)
            pd.DataFrame([
                ("202608", "CA", "B0PRI00001", "Tablet", "us_map", "", 1.0, "N", "r1"),
                ("202608", "CA", "B0PRI00002", "Other", "default_other", "", 0.0, "N", "r1"),
                ("202608", "CA", "B0PRI00003", "Dongle", "token_profile", "profile:x", 0.6, "N", "r1"),
                ("202608", "CA", "B0PRI00004", "Handheld", "keyword", "handheld", 0.9, "N", "r1"),
            ], columns=list(TYPE_DECISIONS_COLUMNS)).to_csv(p, index=False)
            prior = ca_types.load_prior_month(runs, "202609", "CA")
            self.assertEqual(set(prior), {"B0PRI00001", "B0PRI00004"})
            self.assertEqual(prior["B0PRI00001"][0], "Tablet")
            self.assertEqual(ca_types.load_prior_month(runs, "202610", "CA"), {})

    def test_year_rollover(self):
        with tempfile.TemporaryDirectory() as td:
            runs = Path(td)
            p = run_file(runs, "202612", "type_decisions", "CA_code_reader")
            p.parent.mkdir(parents=True)
            pd.DataFrame([("202612", "CA", "B0PRI00001", "Key", "override", "", 1.0, "N", "r")],
                         columns=list(TYPE_DECISIONS_COLUMNS)).to_csv(p, index=False)
            self.assertEqual(ca_types.load_prior_month(runs, "202701", "CA")["B0PRI00001"][0], "Key")


class AssignTypesTest(unittest.TestCase):
    def test_precedence(self):
        df = _frame([
            ("B0TYP00001", "Bluetooth OBD2 dongle", "x", 50.0),       # override beats us_map beats keyword
            ("B0TYP00002", "Bluetooth OBD2 dongle", "x", 50.0),       # us_map beats prior and keyword
            ("B0TYP00003", "Bluetooth OBD2 dongle", "x", 50.0),       # prior beats keyword
            ("B0TYP00004", "Bluetooth OBD2 dongle", "x", 50.0),       # keyword
            ("B0TYP00005", "Mystery widget", "x", 50.0),              # default_other
        ])
        out = ca_types.assign_types(df, us_map={"B0TYP00001": "Tablet", "B0TYP00002": "Handheld"},
                                    overrides={"B0TYP00001": "Key"}, prior={"B0TYP00002": ("VCI", "us_map", 1.0),
                                                                            "B0TYP00003": ("OBD1", "keyword", 0.9)})
        o = out.set_index("asin")
        self.assertEqual(list(o["type"]), ["Key", "Handheld", "OBD1", "Dongle", "Other"])
        self.assertEqual(list(o["type_source"]), ["override", "us_map", "prior_month", "keyword", "default_other"])
        self.assertEqual(list(o["type_confidence"]), [1.0, 1.0, 1.0, 0.9, 0.0])
        self.assertEqual(list(o["type_rule_id"]), ["", "", "", "dongle", ""])
        self.assertTrue(set(out["type_source"]) <= set(TYPE_SOURCES))
        self.assertTrue((out["other"] == "keep").all())
        self.assertEqual(len(df), len(out))

    def test_prior_accepts_plain_type_strings(self):
        out = ca_types.assign_types(_frame([("B0TYP00001", "Mystery", "x", 1.0)]), us_map={}, overrides={},
                                    prior={"B0TYP00001": "Probe"})
        self.assertEqual((out.loc[0, "type"], out.loc[0, "type_source"]), ("Probe", "prior_month"))

    def test_keyword_rule_order(self):
        cases = [
            ("OBD1 adapter cable for GM", "OBD1", "obd1"),
            ("VCI interface with HUD display", "VCI", "vci"),
            ("Car HUD Head Up Display tablet mount", "Other", "gauge_hud"),
            ("Heads-Up speedometer", "Other", "gauge_hud"),
            ("ScanGauge II", "Other", "gauge_hud"),
            ("Edge Insight CTS3", "Other", "gauge_hud"),
            ("Lufi XF OBD2 gague Display", "Other", "gauge_hud"),
            ("iDash 1.8 Datalogger", "Other", "gauge_hud"),
            ("Golf trip computer", "Other", "gauge_hud"),
            ("On-board computer for RVs", "Other", "gauge_hud"),
            ("Autel 10in Android Tablet scanner", "Tablet", "tablet"),
            ("Key programmer for Ford all keys lost", "Key", "key"),
            ("Oscilloscope probe kit", "Probe", "probe"),
            ("WiFi OBD2 reader", "Dongle", "dongle"),
            ("16 pin extension cable", "Cable/Adapter", "cable_adapter"),
            ("Check engine code reader", "Handheld", "handheld"),
            ("Pro scanner", "Tablet", "price_tablet_hint"),
        ]
        rows = [(f"B0KW{i:06d}", t, "x", 500.0) for i, (t, _, _) in enumerate(cases)]
        out = ca_types.assign_types(_frame(rows), us_map={}, overrides={}, prior={})
        for (title, typ, rule), (_, r) in zip(cases, out.iterrows()):
            self.assertEqual((r["type"], r["type_source"], r["type_rule_id"]), (typ, "keyword", rule), title)
            self.assertEqual(r["type_confidence"], 0.9)

    def test_gauge_word_boundaries(self):
        out = ca_types.assign_types(_frame([("B0KW000001", "Gauges and thud sounds", "x", 10.0)]), us_map={}, overrides={}, prior={})
        self.assertEqual(out.loc[0, "type_source"], "default_other")

    def test_price_hint_needs_380(self):
        out = ca_types.assign_types(_frame([("B0KW000001", "Pro scanner", "x", 379.99)]), us_map={}, overrides={}, prior={})
        self.assertEqual(out.loc[0, "type_source"], "default_other")

    def test_keyword_ignores_url_asin(self):
        # ASIN 'B08IN...' lowercased contains '8in' (a tablet keyword); only the title is matched
        out = ca_types.assign_types(_frame([("B08INXYZ12", "Mystery", "x", 10.0)]), us_map={}, overrides={}, prior={})
        self.assertEqual(out.loc[0, "type_source"], "default_other")

    def test_token_profile(self):
        df = _frame([
            ("B0PRO00001", "Zentex ZX100 Lite Tester Pack Blue", "zentex", 50.0),
            ("B0PRO00002", "Zentex ZX100 Lite Tester Pack Red", "zentex", 50.0),
            ("B0PRO00003", "Zentex ZX100 Lite Tester Pack Green", "zentex", 50.0),   # untyped: profile {zentex,zx100,lite,tester,pack}
            ("B0PRO00004", "Zentex ZX100 something", "zentex", 50.0),                # overlap 2 (<3) -> default_other
            ("B0PRO00005", "Zentex ZX100 Lite Tester Pack", "other brand", 50.0),     # other brand -> no profile
        ])
        out = ca_types.assign_types(df, us_map={"B0PRO00001": "Probe", "B0PRO00002": "Probe"}, overrides={}, prior={})
        o = out.set_index("asin")
        self.assertEqual((o.loc["B0PRO00003", "type"], o.loc["B0PRO00003", "type_source"]), ("Probe", "token_profile"))
        self.assertAlmostEqual(o.loc["B0PRO00003", "type_confidence"], 1.0)
        self.assertEqual(o.loc["B0PRO00003", "type_rule_id"], "profile:zentex")
        self.assertEqual(o.loc["B0PRO00004", "type_source"], "default_other")
        self.assertEqual(o.loc["B0PRO00005", "type_source"], "default_other")

    def test_token_profile_partial_score_and_tie(self):
        df = _frame([
            ("B0PRO00001", "Qorvo alpha beta gamma delta epsilon", "qorvo", 1.0),
            ("B0PRO00002", "Qorvo alpha beta gamma delta epsilon", "qorvo", 1.0),
            ("B0PRO00003", "Qorvo alpha beta gamma delta epsilon", "qorvo", 1.0),
            ("B0PRO00004", "Qorvo alpha beta gamma delta epsilon", "qorvo", 1.0),
            ("B0PRO00005", "Qorvo alpha beta gamma zzz", "qorvo", 1.0),         # 4/6 = 0.667 for both profiles -> tie
        ])
        out = ca_types.assign_types(df, us_map={"B0PRO00001": "VCI", "B0PRO00002": "VCI", "B0PRO00003": "Key",
                                                "B0PRO00004": "Key"}, overrides={}, prior={})
        r = out.set_index("asin").loc["B0PRO00005"]
        self.assertEqual((r["type"], r["type_source"]), ("Key", "token_profile"), "tie -> lexically smallest type")
        self.assertAlmostEqual(r["type_confidence"], 4 / 6)

    def test_invalid_map_value_raises(self):
        with self.assertRaises(ValueError):
            ca_types.assign_types(_frame([("B0TYP00001", "x", "x", 1.0)]), us_map={"B0TYP00001": "Scanner"}, overrides={}, prior={})
        with self.assertRaises(ValueError):
            ca_types.assign_types(_frame([("B0TYP00001", "x", "x", 1.0)]), us_map={}, overrides={"B0TYP00001": "Bad"}, prior={})


class ConflictAndReviewTest(unittest.TestCase):
    def _typed(self):
        df = _frame([
            ("B0REV00001", "Car HUD", "a", 30.0, 5000.0),
            ("B0REV00002", "Mystery gadget", "b", 20.0, 1500.0),
            ("B0REV00003", "Mystery small", "c", 20.0, 10.0),
            ("B0REV00004", "Bluetooth OBD2 HUD", "d", 40.0, 100.0),
        ])
        df = ca_types.assign_types(df, us_map={"B0REV00004": "Dongle", "B0REV00001": "Tablet"}, overrides={}, prior={})
        return df

    def test_flag_type_conflicts(self):
        df = self._typed()
        self.assertFalse(ca_types.flag_type_conflicts(df)["type_conflict"].any(), "no gauge_device_scope column -> no-op")
        df["gauge_device_scope"] = [True, False, pd.NA, True]
        out = ca_types.flag_type_conflicts(df)
        self.assertEqual(out["type_conflict"].tolist(), [True, False, False, True])

    def test_build_type_review(self):
        df = self._typed()
        df.loc[df.asin == "B0REV00003", ["type", "type_source", "type_confidence", "type_rule_id"]] = ["Key", "token_profile", 0.55, "profile:c"]
        df["gauge_device_scope"] = [True, False, False, False]
        df = ca_types.flag_type_conflicts(df)
        with self.assertLogs("ca_market_reports", level="WARNING") as cm:
            review = ca_types.build_type_review(df)
        self.assertEqual(tuple(review.columns), TYPE_REVIEW_COLUMNS)
        reasons = dict(zip(review["asin"], review["review_reason"]))
        self.assertEqual(reasons, {"B0REV00001": "gauge_type_conflict", "B0REV00002": "default_other", "B0REV00003": "low_confidence"})
        self.assertTrue((review["reviewed_type"] == "").all())
        loud = [m for m in cm.output if "B0REV00002" in m]
        self.assertTrue(loud, cm.output)
        self.assertFalse([m for m in cm.output if "B0REV00003" in m], "only default_other >= TYPE_LOUD_REVENUE is loud")

    def test_write_type_review_merges_and_keeps_human_column(self):
        df = self._typed()
        review = ca_types.build_type_review(df)
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "sub" / "type_review_CA_code_reader_202609.csv"
            ca_types.write_type_review(review, p)
            saved = pd.read_csv(p, dtype=str, keep_default_na=False)
            saved.loc[saved.asin == "B0REV00002", "reviewed_type"] = "Probe"
            saved = pd.concat([saved, saved.iloc[[0]].assign(asin="B0REV09999")], ignore_index=True)   # stale row kept
            saved.to_csv(p, index=False)
            merged = ca_types.write_type_review(review, p)
            again = pd.read_csv(p, dtype=str, keep_default_na=False)
            self.assertEqual(tuple(again.columns), TYPE_REVIEW_COLUMNS)
            self.assertEqual(again.set_index("asin").loc["B0REV00002", "reviewed_type"], "Probe")
            self.assertIn("B0REV09999", set(again["asin"]))
            self.assertEqual(len(again), len(merged))
            self.assertEqual(again["asin"].duplicated().sum(), 0)


class ApplyTypeReviewTest(unittest.TestCase):
    def _review(self, td, rows):
        p = Path(td) / "type_review_CA_code_reader_202609.csv"
        base = dict.fromkeys(TYPE_REVIEW_COLUMNS, "")
        pd.DataFrame([{**base, "asin": a, "reviewed_type": t} for a, t in rows], columns=list(TYPE_REVIEW_COLUMNS)).to_csv(p, index=False)
        return p

    def _overrides(self, td, rows=()):
        p = Path(td) / "ov.csv"
        pd.DataFrame(list(rows), columns=list(TYPE_OVERRIDES_COLUMNS)).to_csv(p, index=False)
        return p

    def _run(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            rc = apply_type_review.main(list(argv))
        return rc, buf.getvalue()

    def test_appends_and_counts(self):
        with tempfile.TemporaryDirectory() as td:
            rv = self._review(td, [("B0APP00001", "Probe"), ("B0APP00002", ""), ("B0APP00003", "Key")])
            ov = self._overrides(td)
            rc, out = self._run("--review", str(rv), "--decided-by", "ginny", "--overrides", str(ov))
            self.assertEqual(rc, 0, out)
            self.assertIn("appended=2 skipped_blank=1 conflicts=0", out)
            got = pd.read_csv(ov, dtype=str, keep_default_na=False)
            self.assertEqual(tuple(got.columns), TYPE_OVERRIDES_COLUMNS)
            self.assertEqual(got["asin"].tolist(), ["B0APP00001", "B0APP00003"])
            self.assertEqual(set(got["reason"]), {"manual review 202609"})
            self.assertEqual(set(got["decided_by"]), {"ginny"})
            self.assertEqual(set(got["decided_month"]), {"202609"})
            self.assertEqual(ca_types.load_overrides(ov, "202609"), {"B0APP00001": "Probe", "B0APP00003": "Key"})
            rc, out = self._run("--review", str(rv), "--decided-by", "ginny", "--overrides", str(ov))   # idempotent rerun
            self.assertEqual(rc, 0)
            self.assertIn("appended=0 skipped_blank=1 conflicts=0", out)
            self.assertEqual(len(pd.read_csv(ov)), 2)

    def test_conflict_exit_1(self):
        with tempfile.TemporaryDirectory() as td:
            rv = self._review(td, [("B0APP00001", "Probe"), ("B0APP00002", "Key")])
            ov = self._overrides(td, [("B0APP00001", "Tablet", "x", "y", "202609")])
            rc, out = self._run("--review", str(rv), "--decided-by", "ginny", "--month", "202609", "--overrides", str(ov))
            self.assertEqual(rc, 1)
            self.assertIn("appended=1 skipped_blank=0 conflicts=1", out)
            got = pd.read_csv(ov, dtype=str, keep_default_na=False)
            self.assertEqual(got[got.asin == "B0APP00001"]["type"].tolist(), ["Tablet"])

    def test_invalid_reviewed_type(self):
        with tempfile.TemporaryDirectory() as td:
            rv = self._review(td, [("B0APP00001", "Scanner")])
            ov = self._overrides(td)
            with self.assertRaises(SystemExit):
                self._run("--review", str(rv), "--decided-by", "ginny", "--overrides", str(ov))
            self.assertEqual(len(pd.read_csv(ov)), 0, "nothing appended when validation fails")


if __name__ == "__main__":
    unittest.main()
