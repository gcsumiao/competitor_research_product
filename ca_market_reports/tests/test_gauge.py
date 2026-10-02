"""Gauge classifier tests: golden boundary titles, candidate recall, map/prior precedence, features, freeze/replay, map seed."""
from __future__ import annotations

import csv
import logging
import re
import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ca_market_reports.ca_common import (
    FEATURE_COLUMNS,
    FEATURE_DATA_SOURCE,
    FEATURE_FUEL_SCOPE,
    FEATURE_SCREEN_TYPE,
    FIXTURES_DIR,
    GAUGE_CLASS_NAMES,
    GAUGE_DECISIONS_COLUMNS,
    GAUGE_DEVICE_CLASSES,
    GAUGE_ENRICHMENT_COLUMNS,
    GAUGE_MAP_COLUMNS,
    GAUGE_WORKBOOK_CLASSES,
    MAPS_DIR,
    run_file,
)
from ca_market_reports.ca_gauge_classification import (
    GAUGE_SCAN_RE,
    candidate_mask,
    classify_gauges,
    classify_title,
    freeze_gauge_decisions,
    select_map_decisions,
)

GOLDEN_PATH = FIXTURES_DIR / "gauge_golden_titles.csv"
# The map-only golden rows, in file order, and the ASIN whose seeded map row resolves each one.
MAP_ONLY_ASINS = ["B0957S3F3H", "B07FFF4457", "B09ZDNM987", "B088FZRTNZ", "B09XDXTV77"]
OUTPUT_COLUMNS = ("gauge_class", "gauge_in_scope", "gauge_device_scope", "gauge_rule_id", "gauge_confidence", "borderline",
                  "feature_verified_date") + FEATURE_COLUMNS


def golden() -> list[dict]:
    with open(GOLDEN_PATH, newline="", encoding="utf-8") as fh:
        return list(csv.DictReader(fh))


def empty_map() -> pd.DataFrame:
    return pd.DataFrame(columns=list(GAUGE_MAP_COLUMNS))


def seed_map() -> pd.DataFrame:
    return pd.read_csv(MAPS_DIR / "ca_gauge_map.csv", dtype=str, keep_default_na=False)


def frame(rows: list[tuple[str, str, str]]) -> pd.DataFrame:
    return pd.DataFrame(rows, columns=["asin", "title", "brand_raw"])


def map_rows(*rows: tuple[str, str, str, str]) -> pd.DataFrame:
    """rows: (asin, gauge_class, borderline, decided_month)"""
    return pd.DataFrame([{"asin": a, "gauge_class": c, "borderline": b, "reason": "test", "decided_by": "test", "decided_month": m}
                         for a, c, b, m in rows], columns=list(GAUGE_MAP_COLUMNS))


def golden_title(asin: str) -> str:
    for r in golden():
        if r["note"].startswith(f"{asin}:"):
            return r["title"]
    raise KeyError(asin)


WIIYII_P6 = "wiiyii Car HUD Head Up Display P6, OBD+GPS Smart Gauge, Works Great for Most Cars"
BULLY_40410 = "Bully Dog 40410 Triple Dog GT Gas Gauge Tuner"
EDGE_CTS3 = "Edge 84130-3 Insight CTS3"


class GoldenFixtureTest(unittest.TestCase):
    def test_fixture_shape(self):
        rows = golden()
        self.assertGreaterEqual(len(rows), 45)
        self.assertEqual(list(rows[0].keys()), ["title", "brand", "expected_class", "note"])
        for r in rows:
            self.assertIn(r["expected_class"], GAUGE_CLASS_NAMES, r)
            self.assertTrue(r["title"].strip(), r)
        self.assertEqual(sum(r["note"] == "map-only" for r in rows), len(MAP_ONLY_ASINS))

    def test_golden_titles_pure_rules(self):
        failures = []
        for r in golden():
            if r["note"] == "map-only":
                continue
            cls, rid = classify_title(r["title"], r["brand"])
            if cls != r["expected_class"]:
                failures.append(f"{r['note']}: expected {r['expected_class']} got {cls} ({rid}) | {r['title'][:90]}")
        self.assertEqual(failures, [], "\n".join(failures))

    def test_golden_titles_through_classify_gauges_without_map(self):
        rows = [r for r in golden() if r["note"] != "map-only"]
        df = frame([(f"B0GOLD{i:04d}", r["title"], r["brand"]) for i, r in enumerate(rows)])
        out = classify_gauges(df, empty_map())
        self.assertEqual(list(out["gauge_class"]), [r["expected_class"] for r in rows])
        self.assertFalse((out["gauge_rule_id"] == "MAP").any())

    def test_map_only_golden_rows_resolve_through_the_seed_map(self):
        rows = [r for r in golden() if r["note"] == "map-only"]
        df = frame([(a, r["title"], r["brand"]) for a, r in zip(MAP_ONLY_ASINS, rows)])
        out = classify_gauges(df, seed_map(), month="202609")
        self.assertEqual(list(out["gauge_class"]), [r["expected_class"] for r in rows])
        self.assertTrue((out["gauge_rule_id"] == "MAP").all())

    def test_candidate_recall_for_every_device_and_accessory_title(self):
        rows = [r for r in golden() if r["expected_class"] in GAUGE_WORKBOOK_CLASSES]
        self.assertGreater(len(rows), 40)
        missed = [r["title"] for r in rows if not GAUGE_SCAN_RE.search(f"{r['title']} {r['brand']}")]
        self.assertEqual(missed, [])
        df = frame([(f"B0GOLD{i:04d}", r["title"], r["brand"]) for i, r in enumerate(rows)])
        self.assertTrue(candidate_mask(df, empty_map()).all())


class CandidateMaskTest(unittest.TestCase):
    def test_scan_hits_union_mapped_asins(self):
        df = frame([("B0AAAAAAA1", "Edge 84130-3 Insight CTS3", "EDGE"),
                    ("B0AAAAAAA2", "Plain socket wrench set", "Acme"),
                    ("B0AAAAAAA3", "Plain socket wrench set", "Acme")])
        m = candidate_mask(df, map_rows(("B0AAAAAAA3", "excluded_non_gauge", "N", "202609")))
        self.assertEqual(list(m), [True, False, True])
        self.assertEqual(m.dtype, bool)

    def test_brand_widens_scan(self):
        df = frame([("B0AAAAAAA1", "Model 9 unit", "wiiyii")])
        self.assertTrue(candidate_mask(df, empty_map()).iloc[0])

    def test_extended_family_tokens(self):
        for t in ("Edge Insight CS2", "KIMISS cable H00008000", "Banks iDash 1.8", "Shadow FD EVO", "AEM 30-0311 X-Series",
                  "Bully Dog 40417", "40400-105", "dual system speedometer", "OBD+GPS", "Lufi gague"):
            self.assertIsNotNone(GAUGE_SCAN_RE.search(t), t)

    def test_missing_columns_fail_explicitly(self):
        with self.assertRaises(ValueError):
            candidate_mask(pd.DataFrame({"asin": ["B0AAAAAAA1"], "title": ["x"]}), empty_map())


class PrecedenceTest(unittest.TestCase):
    def test_map_beats_rules(self):
        df = frame([("B0AAAAAAA1", BULLY_40410, "Bully Dog")])
        out = classify_gauges(df, map_rows(("B0AAAAAAA1", "gauge_accessory", "N", "202609")))
        r = out.iloc[0]
        self.assertEqual((r.gauge_class, r.gauge_rule_id, r.gauge_confidence), ("gauge_accessory", "MAP", 1.0))
        self.assertTrue(r.gauge_in_scope)
        self.assertFalse(r.gauge_device_scope)

    def test_map_asin_match_is_case_insensitive(self):
        out = classify_gauges(frame([("b0aaaaaaa1", "x", "y")]), map_rows(("B0AAAAAAA1", "gauge_display", "N", "202609")))
        self.assertEqual(out.iloc[0].gauge_class, "gauge_display")

    def test_latest_decided_month_not_after_report_month_wins(self):
        gm = map_rows(("B0AAAAAAA1", "gauge_display", "N", "202608"), ("B0AAAAAAA1", "obd_hud", "N", "202609"),
                      ("B0AAAAAAA1", "excluded_non_gauge", "N", "202610"))
        df = frame([("B0AAAAAAA1", "x", "y")])
        self.assertEqual(classify_gauges(df, gm, month="202608").iloc[0].gauge_class, "gauge_display")
        self.assertEqual(classify_gauges(df, gm, month="202609").iloc[0].gauge_class, "obd_hud")
        self.assertEqual(classify_gauges(df, gm, month="202610").iloc[0].gauge_class, "excluded_non_gauge")
        self.assertEqual(classify_gauges(df, gm, month="202607").iloc[0].gauge_rule_id, "XN-noscan")   # no applicable map row

    def test_same_month_conflict_raises(self):
        gm = map_rows(("B0AAAAAAA1", "gauge_display", "N", "202609"), ("B0AAAAAAA1", "obd_hud", "N", "202609"))
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), gm)
        gm2 = map_rows(("B0AAAAAAA1", "gauge_display", "N", "202609"), ("B0AAAAAAA1", "gauge_display", "Y", "202609"))
        with self.assertRaises(ValueError):   # borderline differs -> still a conflict
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), gm2)

    def test_identical_same_month_duplicates_are_allowed(self):
        gm = map_rows(("B0AAAAAAA1", "gauge_display", "Y", "202609"), ("B0AAAAAAA1", "gauge_display", "y", "202609"))
        self.assertEqual(classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), gm).iloc[0].gauge_class, "gauge_display")

    def test_boolean_parsing(self):
        for raw, want in (("Y", True), ("N", False), ("true", True), ("False", False), ("1", True), ("0", False), ("", False)):
            out = classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), map_rows(("B0AAAAAAA1", "gauge_display", raw, "202609")))
            self.assertIs(bool(out.iloc[0].borderline), want, raw)
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), map_rows(("B0AAAAAAA1", "gauge_display", "maybe", "202609")))

    def test_bad_map_rows_fail_explicitly(self):
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), map_rows(("B0AAAAAAA1", "hud", "N", "202609")))
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), map_rows(("B0AAAAAAA1", "gauge_display", "N", "202613")))
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), pd.DataFrame({"asin": ["B0AAAAAAA1"]}))

    def test_prior_replayed_verbatim_and_map_still_wins(self):
        prior = pd.DataFrame([
            {"month": "202609", "market": "CA", "asin": "B0AAAAAAA1", "gauge_class": "obd_hud", "gauge_in_scope": "True",
             "gauge_rule_id": "HO-1", "gauge_confidence": "0.90", "run_id": "r1"},
            {"month": "202609", "market": "CA", "asin": "B0AAAAAAA2", "gauge_class": "ambiguous", "gauge_in_scope": "False",
             "gauge_rule_id": "AMB", "gauge_confidence": "0.00", "run_id": "r1"},
        ], columns=list(GAUGE_DECISIONS_COLUMNS))
        df = frame([("B0AAAAAAA1", BULLY_40410, "Bully Dog"), ("B0AAAAAAA2", EDGE_CTS3, "EDGE"), ("B0AAAAAAA3", EDGE_CTS3, "EDGE")])
        out = classify_gauges(df, empty_map(), prior)
        self.assertEqual(list(out.gauge_class), ["obd_hud", "ambiguous", "truck_gauge_monitor"])
        self.assertEqual(list(out.gauge_rule_id), ["PRIOR", "PRIOR", "TM-monitor"])
        self.assertEqual(list(out.gauge_confidence), [1.0, 1.0, 0.9])
        out2 = classify_gauges(df, map_rows(("B0AAAAAAA1", "gauge_display", "N", "202609")), prior)
        self.assertEqual((out2.iloc[0].gauge_class, out2.iloc[0].gauge_rule_id), ("gauge_display", "MAP"))

    def test_prior_must_be_one_month_and_market(self):
        prior = pd.DataFrame([
            {"month": "202608", "market": "CA", "asin": "B0AAAAAAA1", "gauge_class": "obd_hud", "gauge_in_scope": "True",
             "gauge_rule_id": "HO-1", "gauge_confidence": "0.90", "run_id": "r1"},
            {"month": "202609", "market": "CA", "asin": "B0AAAAAAA2", "gauge_class": "obd_hud", "gauge_in_scope": "True",
             "gauge_rule_id": "HO-1", "gauge_confidence": "0.90", "run_id": "r1"},
        ], columns=list(GAUGE_DECISIONS_COLUMNS))
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA1", "x", "y")]), empty_map(), prior)
        bad_scope = prior.iloc[[1]].assign(gauge_in_scope="False")
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA2", "x", "y")]), empty_map(), bad_scope)
        with self.assertRaises(ValueError):
            classify_gauges(frame([("B0AAAAAAA2", "x", "y")]), empty_map(), prior.iloc[[1]], month="202608")

    def test_borderline_from_map_only(self):
        gm = map_rows(("B07FFF4457", "gauge_display", "Y", "202609"))
        df = frame([("B07FFF4457", "AiM Solo 2 DL GPS Lap Timer with OBDII Harness", "AiM"), ("B0AAAAAAA1", EDGE_CTS3, "EDGE")])
        out = classify_gauges(df, gm)
        self.assertEqual(list(out.borderline), [True, False])
        self.assertTrue(out.iloc[0].gauge_device_scope)


class FeatureTest(unittest.TestCase):
    def classify_one(self, title, brand="x", asin="B0AAAAAAA1", gm=None):
        return classify_gauges(frame([(asin, title, brand)]), empty_map() if gm is None else gm).iloc[0]

    def test_wiiyii_p6(self):
        r = self.classify_one(WIIYII_P6, "wiiyii")
        self.assertEqual((r.gauge_class, r.data_source, r.screen_type), ("obd_gps_hud", "OBD+GPS", "windshield projector"))
        self.assertFalse(r.lordco_type_unit)

    def test_bully_dog_40410(self):
        r = self.classify_one(BULLY_40410, "Bully Dog")
        self.assertEqual((r.gauge_class, r.gauge_rule_id), ("tuner_with_gauge_display", "TD-bullydog"))
        self.assertEqual((r.fuel_scope, r.screen_type), ("gas", "tuner touchscreen"))
        self.assertTrue(r.lordco_type_unit)

    def test_bully_dog_family_is_gas(self):
        for asin in ("B001P20QDS", "B06XWVYJGV", "B00AJLY628"):
            r = self.classify_one(golden_title(asin), "Bully Dog", asin=asin)
            self.assertEqual((r.gauge_class, r.fuel_scope), ("tuner_with_gauge_display", "gas"), asin)

    def test_edge_cts3(self):
        r = self.classify_one(EDGE_CTS3, "EDGE")
        self.assertEqual((r.gauge_class, r.data_source, r.screen_type), ("truck_gauge_monitor", "OBD", "dash-top LCD"))
        self.assertTrue(r.lordco_type_unit)
        self.assertEqual(r.fuel_scope, "universal")       # Edge Insight model rule

    def test_boost_turbo_is_not_diesel_evidence(self):
        r = self.classify_one("DPofirs Car HUD Display, OBD2 GPS Smart Gauge Speedometer RPM Turbo Alarm Boost Gauge for Cars")
        self.assertEqual((r.gauge_class, r.fuel_scope), ("obd_gps_hud", "unspecified"))
        self.assertTrue(r.alarms)

    def test_diesel_and_conflict(self):
        r = self.classify_one("OBD2 Gauge Display for diesel trucks, DPF regen monitor")
        self.assertEqual((r.gauge_class, r.fuel_scope), ("gauge_display", "diesel-capable"))
        r1 = self.classify_one("Edge Insight CTS3 monitor with EGT probe for diesel trucks")
        self.assertEqual(r1.fuel_scope, "universal")     # universal model + a single-fuel token is not a conflict
        with self.assertLogs("ca_market_reports.gauge", level=logging.WARNING) as cm:
            r2 = self.classify_one("Bully Dog GT gas and diesel 40420 Triple Dog tuner")
        self.assertEqual(r2.fuel_scope, "unspecified")
        self.assertTrue(any("gauge_fuel_conflict" in m for m in cm.output))

    # ---- model-number fuel evidence (TD/TM rows first, title tokens as cross-check) ----
    FUEL_MODEL_CASES = (
        ("B08YJQCTH2", "Edge 85400-100 Evolution CTS3 Programmer", "tuner_with_gauge_display", "diesel-capable"),
        ("B08YJLFVW7", "Edge 85401-201 Evolution CTS3 Programmer - CA Edition", "tuner_with_gauge_display", "diesel-capable"),
        ("B00XM16K2Q", "Edge Products 85450 CTS2 Gas Evolution Programmer", "tuner_with_gauge_display", "gas"),
        ("B0DLZFHVLV", None, "tuner_with_gauge_display", "diesel-capable"),
        ("B0DLZ9CFVQ", None, "tuner_with_gauge_display", "diesel-capable"),
        ("B087WMGLF1", None, "truck_gauge_monitor", "universal"),
        ("B06XWX7FHK", None, "truck_gauge_monitor", "universal"),
        ("B0GSSJ2MJ9", None, "truck_gauge_monitor", "universal"),
        ("B0GNCW4XKM", None, "truck_gauge_monitor", "universal"),
        ("B001P20QDS", None, "tuner_with_gauge_display", "gas"),
        ("B06XWVYJGV", None, "tuner_with_gauge_display", "gas"),
        ("B00AJLY628", None, "tuner_with_gauge_display", "gas"),
        ("B0SYNTH042", "Bully Dog 40420 GT Diesel Gauge Tuner", "tuner_with_gauge_display", "diesel-capable"),
        ("B0SYNTH851", "Edge Evolution CTS3 85400", "tuner_with_gauge_display", "diesel-capable"),          # bare number
        ("B0SYNTH852", "Edge Evolution CTS3 85401", "tuner_with_gauge_display", "diesel-capable"),
        ("B0SYNTH853", "Edge Evolution CTS3 85401-201", "tuner_with_gauge_display", "diesel-capable"),      # suffixed
        ("B0SYNTH854", "Edge Evolution CTS2 85450", "tuner_with_gauge_display", "gas"),                     # bare gas
        ("B0SYNTH855", "Edge Evolution CTS2 85452-100", "tuner_with_gauge_display", "gas"),                 # suffixed gas
        ("B0SYNTH856", "Edge Evolution CTS3 854001", "tuner_with_gauge_display", "unspecified"),            # not a model number
        ("B0957S3F3H", WIIYII_P6, "obd_gps_hud", "unspecified"),
        ("B0BFBQZZMC", None, "gauge_display", "unspecified"),     # ScanGauge is never 'universal' (no model rule)
    )

    def test_fuel_model_number_rules(self):
        for asin, title, cls, fuel in self.FUEL_MODEL_CASES:
            r = self.classify_one(title or golden_title(asin), asin=asin)
            self.assertEqual((r.gauge_class, r.fuel_scope), (cls, fuel), asin)

    def test_fuel_model_vs_title_conflict(self):
        with self.assertLogs("ca_market_reports.gauge", level=logging.WARNING) as cm:
            r = self.classify_one("Edge 85400-100 Evolution CTS3 Programmer for gasoline trucks")
        self.assertEqual((r.gauge_class, r.fuel_scope), ("tuner_with_gauge_display", "unspecified"))
        self.assertTrue(any("gauge_fuel_conflict" in m and "model=diesel-capable" in m for m in cm.output))
        with self.assertLogs("ca_market_reports.gauge", level=logging.WARNING):
            r2 = self.classify_one("Bully Dog 40410 Triple Dog GT Gas tuner, diesel")
        self.assertEqual(r2.fuel_scope, "unspecified")

    def test_fuel_model_rules_do_not_apply_to_other_classes(self):
        # a row the map pins to obd_hud keeps title-token fuel logic even if its title carries a model phrase
        gm = map_rows(("B0AAAAAAA1", "obd_hud", "N", "202609"))
        r = self.classify_one("OBD2 HUD Head Up Display Data Pro Edition Speedometer", gm=gm)
        self.assertEqual((r.gauge_class, r.fuel_scope), ("obd_hud", "unspecified"))
        r2 = self.classify_one("OBD2 HUD Head Up Display for Gasoline Vehicles")
        self.assertEqual(r2.fuel_scope, "gas")

    def test_flags(self):
        r = self.classify_one("OBD2 HUD Gesture Control Multi-Function Gauge KM/H MPH Overspeed Alarm Fatigue Driving Reminder")
        self.assertEqual(r.gauge_class, "obd_hud")
        self.assertTrue(r.gesture_control and r.multi_gauge and r.kmh_mph and r.alarms)
        r2 = self.classify_one("AEM X-Series 52mm OBD II Digital Gauge View Engine Parameters Codes CEL Black", "AEM")
        self.assertEqual((r2.gauge_class, r2.screen_type), ("gauge_display", "in-dash round gauge"))
        self.assertFalse(r2.gesture_control or r2.kmh_mph)

    def test_non_device_rows_have_blank_features(self):
        df = frame([("B0AAAAAAA1", "Lufi Shift Light (Blue) - Alarm Light Accessory for XF OBD2 Gauge", "Lufi"),
                    ("B0AAAAAAA2", "Digital GPS Speedometer Universal Heads Up Display for Car 5.5 inch LCD", "SinoTrack"),
                    ("B0AAAAAAA3", "Autel MaxiScan MS309 Code Reader", "Autel")])
        out = classify_gauges(df, empty_map())
        self.assertEqual(list(out.gauge_class), ["gauge_accessory", "gps_hud", "excluded_non_gauge"])
        for c in ("data_source", "screen_type", "fuel_scope"):
            self.assertEqual(list(out[c]), ["", "", ""], c)
        for c in ("alarms", "multi_gauge", "gesture_control", "kmh_mph", "lordco_type_unit", "gauge_device_scope"):
            self.assertFalse(out[c].any(), c)
        self.assertEqual(list(out.gauge_in_scope), [True, True, False])

    def test_feature_vocabularies_on_golden(self):
        rows = golden()
        df = frame([(f"B0GOLD{i:04d}", r["title"], r["brand"]) for i, r in enumerate(rows)])
        out = classify_gauges(df, empty_map())
        dev = out[out.gauge_device_scope]
        self.assertGreater(len(dev), 30)
        self.assertTrue(dev.data_source.isin(FEATURE_DATA_SOURCE).all())
        self.assertTrue(dev.screen_type.isin(FEATURE_SCREEN_TYPE).all())
        self.assertTrue(dev.fuel_scope.isin(FEATURE_FUEL_SCOPE).all())
        self.assertTrue((out.feature_verified_date == "").all())

    def test_ca_edition_changes_nothing(self):
        for base in (EDGE_CTS3, "Edge 85401-201 Evolution CTS3 Programmer", WIIYII_P6, BULLY_40410):
            a = self.classify_one(base)
            b = self.classify_one(base + " - CA Edition")
            for c in OUTPUT_COLUMNS:
                self.assertEqual(a[c], b[c], f"{base} / {c}")


class FrameContractTest(unittest.TestCase):
    def test_all_input_columns_preserved(self):
        df = frame([("B0AAAAAAA1", EDGE_CTS3, "EDGE"), ("B0AAAAAAA2", "socket wrench", "Acme")])
        df["custom"] = [1, 2]
        df["gauge_class"] = ["stale", "stale"]      # owned columns are overwritten
        df.index = [10, 20]
        before = df.copy()
        out = classify_gauges(df, empty_map())
        pd.testing.assert_frame_equal(df, before)    # input untouched (pure)
        self.assertEqual(list(out.index), [10, 20])
        self.assertEqual(list(out.columns[:len(df.columns)]), list(df.columns))
        self.assertEqual(list(out.custom), [1, 2])
        for c in OUTPUT_COLUMNS + GAUGE_ENRICHMENT_COLUMNS:
            self.assertIn(c, out.columns)
        self.assertEqual(list(out.gauge_class), ["truck_gauge_monitor", "excluded_non_gauge"])

    def test_normalized_rows_fixture(self):
        df = pd.read_csv(FIXTURES_DIR / "normalized_rows.csv", dtype=str, keep_default_na=False)
        out = classify_gauges(df, empty_map())
        self.assertEqual(len(out), len(df))
        self.assertEqual(list(out.columns[:len(df.columns)]), list(df.columns))
        got = dict(zip(out.asin, out.gauge_class))
        want = {"B0TESTEDG1": "truck_gauge_monitor", "B0TESTEDG2": "tuner_with_gauge_display", "B0TESTSCG1": "gauge_display",
                "B0TESTCAB1": "gauge_accessory", "B0TESTHUD1": "obd_gps_hud", "B0TESTHUD2": "obd_hud", "B0TESTHUD3": "gps_hud",
                "B0TESTLUF2": "gauge_display", "B0TESTSHF1": "gauge_accessory", "B0TESTCAS1": "excluded_non_gauge",
                "B0TESTAEM1": "gauge_display", "B0TESTBDG1": "tuner_with_gauge_display", "B0TESTBDG2": "tuner_with_gauge_display",
                "B0TESTANC1": "excluded_non_gauge", "B0TESTAUT1": "excluded_non_gauge", "B0TESTTAB1": "excluded_non_gauge",
                "B0TESTAIM1": "ambiguous"}
        for asin, cls in want.items():
            self.assertEqual(got[asin], cls, asin)
        self.assertTrue(out.gauge_class.isin(GAUGE_CLASS_NAMES).all())
        self.assertTrue((out.gauge_device_scope == out.gauge_class.isin(GAUGE_DEVICE_CLASSES)).all())
        self.assertTrue((out.gauge_in_scope == out.gauge_class.isin(GAUGE_WORKBOOK_CLASSES)).all())

    def test_missing_required_columns(self):
        with self.assertRaises(ValueError):
            classify_gauges(pd.DataFrame({"asin": ["B0AAAAAAA1"]}), empty_map())


class FreezeTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.runs = Path(self.tmp.name) / "runs"

    def tearDown(self):
        self.tmp.cleanup()

    def test_freeze_merge_replay_and_map_override(self):
        df = frame([("B0AAAAAAA1", EDGE_CTS3, "EDGE"), ("B0AAAAAAA2", BULLY_40410, "Bully Dog")])
        with self.assertLogs("ca_market_reports.gauge", level=logging.WARNING) as cm:
            d1 = freeze_gauge_decisions(classify_gauges(df, empty_map()), self.runs, "202609", "CA")
        self.assertTrue(any("unfrozen_candidates=2" in m for m in cm.output))
        path = run_file(self.runs, "202609", "gauge_decisions", "CA_gauge")
        self.assertTrue(path.exists())
        self.assertEqual(path.name, "gauge_decisions_CA_gauge_202609.csv")
        on_disk = pd.read_csv(path, dtype=str, keep_default_na=False)
        self.assertEqual(tuple(on_disk.columns), GAUGE_DECISIONS_COLUMNS)
        self.assertEqual(list(d1.gauge_class), ["truck_gauge_monitor", "tuner_with_gauge_display"])
        self.assertRegex(d1.run_id.iloc[0], r"^\d{8}T\d{6}-[0-9a-f]{4,}$")

        # replay: prior decisions reproduce the frozen classes even when the rules would now say something else
        changed = frame([("B0AAAAAAA1", "socket wrench", "Acme"), ("B0AAAAAAA2", BULLY_40410, "Bully Dog"),
                         ("B0AAAAAAA3", WIIYII_P6, "wiiyii")])
        replay = classify_gauges(changed, empty_map(), on_disk)
        self.assertEqual(list(replay.gauge_class), ["truck_gauge_monitor", "tuner_with_gauge_display", "obd_gps_hud"])
        with self.assertLogs("ca_market_reports.gauge", level=logging.WARNING) as cm:
            d2 = freeze_gauge_decisions(replay, self.runs, "202609", "CA")
        self.assertTrue(any("unfrozen_candidates=1" in m for m in cm.output))
        self.assertEqual(d2.set_index("asin").loc["B0AAAAAAA1", "gauge_rule_id"], "TM-monitor")   # frozen row kept verbatim

        # a non-replayed reclassification never silently overwrites a frozen row
        fresh = classify_gauges(changed, empty_map())
        d3 = freeze_gauge_decisions(fresh, self.runs, "202609", "CA")
        self.assertEqual(d3.set_index("asin").loc["B0AAAAAAA1", "gauge_class"], "truck_gauge_monitor")

        # a human map row that changes a decision rewrites it (loud log line)
        mapped = classify_gauges(changed, map_rows(("B0AAAAAAA1", "excluded_non_gauge", "N", "202609")), on_disk)
        with self.assertLogs("ca_market_reports.gauge", level=logging.WARNING) as cm:
            d4 = freeze_gauge_decisions(mapped, self.runs, "202609", "CA")
        self.assertTrue(any("gauge_map_override asin=B0AAAAAAA1" in m for m in cm.output))
        row = d4.set_index("asin").loc["B0AAAAAAA1"]
        self.assertEqual((row.gauge_class, row.gauge_rule_id, row.gauge_in_scope), ("excluded_non_gauge", "MAP", "False"))
        self.assertEqual(len(d4), 3)

        # rederive rewrites every frame ASIN; it refuses PRIOR replays
        with self.assertRaises(ValueError):
            freeze_gauge_decisions(replay, self.runs, "202609", "CA", rederive=True)
        d5 = freeze_gauge_decisions(fresh, self.runs, "202609", "CA", rederive=True)
        self.assertEqual(d5.set_index("asin").loc["B0AAAAAAA1", "gauge_class"], "excluded_non_gauge")
        self.assertEqual(d5.set_index("asin").loc["B0AAAAAAA1", "gauge_rule_id"], "XN-noscan")

    def test_markets_do_not_collide(self):
        df = classify_gauges(frame([("B0AAAAAAA1", EDGE_CTS3, "EDGE")]), empty_map())
        freeze_gauge_decisions(df, self.runs, "202609", "CA")
        freeze_gauge_decisions(df, self.runs, "202609", "US")
        self.assertTrue(run_file(self.runs, "202609", "gauge_decisions", "CA_gauge").exists())
        self.assertTrue(run_file(self.runs, "202609", "gauge_decisions", "US_gauge").exists())

    def test_bad_month_and_duplicate_asins(self):
        df = classify_gauges(frame([("B0AAAAAAA1", EDGE_CTS3, "EDGE"), ("B0AAAAAAA1", EDGE_CTS3, "EDGE")]), empty_map())
        with self.assertRaises(ValueError):
            freeze_gauge_decisions(df.iloc[[0]], self.runs, "2026-09", "CA")
        with self.assertRaises(ValueError):
            freeze_gauge_decisions(df, self.runs, "202609", "CA")


class SeedMapTest(unittest.TestCase):
    # Brief anchors: ASIN -> expected class after map + rules (titles come from the golden fixture, so the check is end-to-end)
    ANCHORS = {
        "B087WMGLF1": "truck_gauge_monitor", "B08YJLFVW7": "tuner_with_gauge_display", "B0DLZFHVLV": "tuner_with_gauge_display",
        "B0DLZ9CFVQ": "tuner_with_gauge_display", "B00XM16K2Q": "tuner_with_gauge_display", "B001P20QDS": "tuner_with_gauge_display",
        "B06XWVYJGV": "tuner_with_gauge_display", "B00AJLY628": "tuner_with_gauge_display", "B004800AHG": "gauge_accessory",
        "B0BFBQZZMC": "gauge_display", "B000AAMY86": "gauge_display", "B07CGR1T5T": "gauge_display", "B01MZ3ZURG": "gauge_display",
        "B01BI2PQNY": "gauge_display", "B0957S3F3H": "obd_gps_hud", "B0CJMM4RLM": "obd_hud", "B08GYLXJ1V": "obd_hud",
        "B0GZC9VPRS": "obd_gps_hud", "B0CFX3VVG2": "obd_gps_hud", "B0CTQSKD13": "gauge_accessory", "B0BWYLSHTP": "gauge_accessory",
        "B09Y8WTFLQ": "gauge_accessory", "B0B2MMYSK7": "gauge_accessory", "B09XTWXTB3": "gauge_accessory",
        "B0C74BG4Z2": "gauge_accessory", "B0CFQK5Q6Z": "excluded_non_gauge", "B0DZ78J8BY": "excluded_non_gauge",
        "B0BR9NDLFC": "excluded_non_gauge", "B0CR9N9ZR8": "excluded_non_gauge", "B07Q5H7M5S": "excluded_non_gauge",
        "B0C3BZSPT9": "excluded_non_gauge", "B07Q2L41VJ": "excluded_non_gauge", "B0CT39TV55": "excluded_app_dongle",
        "B0GNCW4XKM": "truck_gauge_monitor", "B08NWG8KXG": "excluded_non_gauge", "B0831QHY7G": "excluded_non_gauge",
        "B0CLJ9SM1G": "excluded_non_gauge", "B0D8VWT838": "excluded_non_gauge", "B0FXR44R95": "excluded_non_gauge",
        "B0DHGX3R88": "excluded_non_gauge", "B089VKS44X": "gauge_display", "B0BJDCMDKP": "gauge_display",
        "B0DKZ77M4N": "obd_hud",
    }
    MAP_ONLY_ANCHORS = {"B07FFF4457": ("gauge_display", True), "B00ZDNJ820": ("tuner_with_gauge_display", False),
                        "B084KPRZ9J": ("truck_gauge_monitor", False), "B06XWX7FHK": ("truck_gauge_monitor", False),
                        "B0CS5VB5D7": ("obd_gps_hud", True), "B0DYDPPMSX": ("obd_gps_hud", True),
                        "B0FMPJ6BLJ": ("truck_gauge_monitor", True), "B0957S3F3H": ("obd_gps_hud", False)}

    def test_header_and_counts(self):
        with open(MAPS_DIR / "ca_gauge_map.csv", newline="", encoding="utf-8") as fh:
            header = next(csv.reader(fh))
        self.assertEqual(tuple(header), GAUGE_MAP_COLUMNS)
        gm = seed_map()
        self.assertEqual((gm.decided_by == "us_map_port").sum(), 314)
        self.assertTrue(gm.decided_by.isin(["us_map_port", "t2_review_202609"]).all())
        self.assertTrue((gm.decided_month == "202609").all())
        self.assertTrue(gm.gauge_class.isin(GAUGE_CLASS_NAMES).all())
        self.assertFalse(gm.asin.duplicated().any())
        self.assertTrue(gm.asin.str.fullmatch(r"[A-Z0-9]{10}").all())
        self.assertTrue((gm.reason.str.strip() != "").all())
        self.assertEqual(len(select_map_decisions(gm, "202609")), len(gm))

    def test_anchor_decisions(self):
        df = frame([(a, golden_title(a), "") for a in self.ANCHORS])
        out = classify_gauges(df, seed_map(), month="202609")
        got = dict(zip(out.asin, out.gauge_class))
        self.assertEqual({a: got[a] for a in self.ANCHORS}, self.ANCHORS)
        decisions = select_map_decisions(seed_map(), "202609")
        for asin, (cls, borderline) in self.MAP_ONLY_ANCHORS.items():
            self.assertEqual(decisions[asin], (cls, borderline), asin)


if __name__ == "__main__":
    unittest.main()
