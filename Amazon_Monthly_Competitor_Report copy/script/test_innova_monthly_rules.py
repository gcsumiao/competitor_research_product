#!/usr/bin/env python3
from __future__ import annotations

import unittest

import pandas as pd

from full_report_month import (
    INNOVA_ADDED_1P_COL,
    INNOVA_ADDED_3P_COL,
    INNOVA_RAW_PRESENT_COL,
    _apply_innova_monthly_rules,
    _build_innova_account_sheet,
    _classify_innova_3p_non_code_product,
    _filter_innova_3p_non_code_products,
    _innova_3p_non_code_exclusion_map,
)


class InnovaMonthlyRulesTest(unittest.TestCase):
    def setUp(self) -> None:
        self.market = pd.DataFrame(
            [
                {
                    "ASIN": "RAWONLY",
                    "Title": "Raw only Innova",
                    "Brand": "innova",
                    "Monthly Sales": 10,
                    "Monthly Revenue": 100,
                    "Price": 10,
                    "Type": "Handheld",
                },
                {
                    "ASIN": "RAW1P",
                    "Title": "Raw plus 1P",
                    "Brand": "innova",
                    "Monthly Sales": 20,
                    "Monthly Revenue": 200,
                    "Price": 10,
                    "Type": "Handheld",
                },
                {
                    "ASIN": "RAW3P",
                    "Title": "Raw plus 3P",
                    "Brand": "innova",
                    "Monthly Sales": 30,
                    "Monthly Revenue": 300,
                    "Price": 10,
                    "Type": "Tablet",
                },
                {
                    "ASIN": "OTHER3P",
                    "Title": "Other brand row that 3P actual should convert",
                    "Brand": "other",
                    "Monthly Sales": 40,
                    "Monthly Revenue": 400,
                    "Price": 10,
                    "Type": "Dongle",
                },
                {
                    "ASIN": "BOTHACCOUNTS",
                    "Title": "Prior month carryover row for shared ASIN",
                    "Brand": "other",
                    "Monthly Sales": 0,
                    "Monthly Revenue": 0,
                    "Price": 10,
                    "Type": "Handheld",
                },
            ]
        )
        self.one_p = pd.DataFrame(
            [
                {"ASIN": "RAW1P", "Title": "Raw plus 1P OBD2 actual", "Monthly Sales": 200, "Monthly Revenue": 2000},
                {"ASIN": "ONEPONLY", "Title": "Innova OBD2 Code Reader", "Monthly Sales": 500, "Monthly Revenue": 5000},
                {"ASIN": "BOTHACCOUNTS", "Title": "Innova shared OBD2 scanner 1P", "Monthly Sales": 50, "Monthly Revenue": 5000},
                {"ASIN": "BOTHNONOBD", "Title": "Innova Digital Multimeter 1P", "Monthly Sales": 80, "Monthly Revenue": 8000},
                {"ASIN": "ONEPNONOBD", "Title": "Innova Timing Light", "Monthly Sales": 800, "Monthly Revenue": 8000},
                {"ASIN": "B000EW0KHW", "Title": "Excluded Innova OBD2 Code Reader", "Monthly Sales": 900, "Monthly Revenue": 9000},
            ]
        )
        self.three_p = pd.DataFrame(
            [
                {"ASIN": "RAW3P", "Title": "Raw plus 3P actual", "Monthly Sales": 300, "Monthly Revenue": 3000},
                {"ASIN": "THREEPONLY", "Title": "3P only actual", "Monthly Sales": 600, "Monthly Revenue": 6600},
                {"ASIN": "OTHER3P", "Title": "3P existing non-Innova row", "Monthly Sales": 700, "Monthly Revenue": 7700},
                {"ASIN": "BOTHACCOUNTS", "Title": "Innova shared OBD2 scanner 3P", "Monthly Sales": 60, "Monthly Revenue": 7200},
                {"ASIN": "BOTHNONOBD", "Title": "Innova Digital Multimeter 3P", "Monthly Sales": 6, "Monthly Revenue": 600},
                {"ASIN": "B078BHTCK1", "Title": "Excluded 3P actual", "Monthly Sales": 1000, "Monthly Revenue": 10000},
            ]
        )
        self.spec = pd.DataFrame(
            [
                {"ASIN": "ONEPONLY", "Type": "Other"},
                {"ASIN": "ONEPNONOBD", "Type": "Other"},
                {"ASIN": "BOTHACCOUNTS", "Type": "Handheld"},
                {"ASIN": "BOTHNONOBD", "Type": "Other"},
                {"ASIN": "THREEPONLY", "Type": "Tablet"},
                {"ASIN": "OTHER3P", "Type": "Dongle"},
            ]
        )

    def test_innova_rules_use_actual_for_raw_overlap_and_add_only_3p_actual_only(self) -> None:
        out = _apply_innova_monthly_rules(self.market, self.one_p, self.three_p, self.spec)
        rows = out.set_index("ASIN")

        self.assertIn("RAWONLY", rows.index)
        self.assertEqual(rows.at["RAWONLY", "Monthly Sales"], 10)
        self.assertEqual(rows.at["RAWONLY", "Monthly Revenue"], 100)
        self.assertTrue(bool(rows.at["RAWONLY", INNOVA_RAW_PRESENT_COL]))

        self.assertIn("RAW1P", rows.index)
        self.assertEqual(rows.at["RAW1P", "Monthly Sales"], 200)
        self.assertEqual(rows.at["RAW1P", "Monthly Revenue"], 2000)
        self.assertEqual(rows.at["RAW1P", "Price"], 10)

        self.assertIn("RAW3P", rows.index)
        self.assertEqual(rows.at["RAW3P", "Monthly Sales"], 300)
        self.assertEqual(rows.at["RAW3P", "Monthly Revenue"], 3000)
        self.assertEqual(rows.at["RAW3P", "Price"], 10)

        self.assertIn("ONEPONLY", rows.index)
        self.assertEqual(rows.at["ONEPONLY", "Brand"], "innova")
        self.assertEqual(rows.at["ONEPONLY", "Monthly Sales"], 500)
        self.assertEqual(rows.at["ONEPONLY", "Monthly Revenue"], 5000)
        self.assertEqual(rows.at["ONEPONLY", "Price"], 10)
        self.assertTrue(bool(rows.at["ONEPONLY", INNOVA_ADDED_1P_COL]))

        self.assertNotIn("ONEPNONOBD", rows.index)
        self.assertNotIn("B000EW0KHW", rows.index)
        self.assertNotIn("B078BHTCK1", rows.index)

        self.assertIn("THREEPONLY", rows.index)
        self.assertEqual(rows.at["THREEPONLY", "Brand"], "innova")
        self.assertEqual(rows.at["THREEPONLY", "Monthly Sales"], 600)
        self.assertEqual(rows.at["THREEPONLY", "Monthly Revenue"], 6600)
        self.assertEqual(rows.at["THREEPONLY", "Price"], 11)
        self.assertFalse(bool(rows.at["THREEPONLY", INNOVA_RAW_PRESENT_COL]))
        self.assertTrue(bool(rows.at["THREEPONLY", INNOVA_ADDED_3P_COL]))

        self.assertIn("OTHER3P", rows.index)
        self.assertEqual(rows.at["OTHER3P", "Brand"], "innova")
        self.assertEqual(rows.at["OTHER3P", "Monthly Sales"], 700)
        self.assertEqual(rows.at["OTHER3P", "Monthly Revenue"], 7700)

        self.assertIn("BOTHACCOUNTS", rows.index)
        self.assertEqual(rows.at["BOTHACCOUNTS", "Brand"], "innova")
        self.assertEqual(rows.at["BOTHACCOUNTS", "Monthly Sales"], 110)
        self.assertEqual(rows.at["BOTHACCOUNTS", "Monthly Revenue"], 12200)
        self.assertEqual(rows.at["BOTHACCOUNTS", "Price"], 110.9090909090909)
        self.assertTrue(bool(rows.at["BOTHACCOUNTS", INNOVA_ADDED_1P_COL]))
        self.assertTrue(bool(rows.at["BOTHACCOUNTS", INNOVA_ADDED_3P_COL]))

        self.assertIn("BOTHNONOBD", rows.index)
        self.assertEqual(rows.at["BOTHNONOBD", "Brand"], "innova")
        self.assertEqual(rows.at["BOTHNONOBD", "Monthly Sales"], 6)
        self.assertEqual(rows.at["BOTHNONOBD", "Monthly Revenue"], 600)
        self.assertFalse(bool(rows.at["BOTHNONOBD", INNOVA_ADDED_1P_COL]))
        self.assertTrue(bool(rows.at["BOTHNONOBD", INNOVA_ADDED_3P_COL]))

    def test_account_sheets_use_account_actual_values(self) -> None:
        out = _apply_innova_monthly_rules(self.market, self.one_p, self.three_p, self.spec)
        innova = out[out["Brand"].astype(str).str.lower().eq("innova")].copy()

        one_p_sheet = _build_innova_account_sheet(innova, self.one_p, fulfillment="1P").set_index("ASIN")
        self.assertEqual(set(one_p_sheet.index), {"RAW1P", "ONEPONLY", "BOTHACCOUNTS"})
        self.assertEqual(one_p_sheet.at["RAW1P", "Monthly Sales"], 200)
        self.assertEqual(one_p_sheet.at["RAW1P", "Monthly Revenue"], 2000)
        self.assertEqual(one_p_sheet.at["ONEPONLY", "Monthly Sales"], 500)
        self.assertEqual(one_p_sheet.at["ONEPONLY", "Monthly Revenue"], 5000)
        self.assertEqual(one_p_sheet.at["BOTHACCOUNTS", "Monthly Sales"], 50)
        self.assertEqual(one_p_sheet.at["BOTHACCOUNTS", "Monthly Revenue"], 5000)

        three_p_sheet = _build_innova_account_sheet(innova, self.three_p, fulfillment="3P").set_index("ASIN")
        self.assertEqual(set(three_p_sheet.index), {"RAW3P", "THREEPONLY", "OTHER3P", "BOTHACCOUNTS", "BOTHNONOBD"})
        self.assertEqual(three_p_sheet.at["RAW3P", "Monthly Sales"], 300)
        self.assertEqual(three_p_sheet.at["THREEPONLY", "Monthly Sales"], 600)
        self.assertEqual(three_p_sheet.at["BOTHACCOUNTS", "Monthly Sales"], 60)
        self.assertEqual(three_p_sheet.at["BOTHACCOUNTS", "Monthly Revenue"], 7200)
        self.assertEqual(three_p_sheet.at["BOTHNONOBD", "Monthly Sales"], 6)

    def test_202607_excludes_explicit_3p_non_code_families_but_keeps_5420(self) -> None:
        excluded = pd.DataFrame(
            [
                {"ASIN": "B000EVYGZA", "Title": "INNOVA 3320 Auto-Ranging Digital Multimeter", "Monthly Sales": 9, "Monthly Revenue": 314.91},
                {"ASIN": "B000KIMHRQ", "Title": "INNOVA 3340 Automotive Digital Multimeter", "Monthly Sales": 6, "Monthly Revenue": 599.94},
                {"ASIN": "B082JCSB4Z", "Title": "INNOVA 3380 Inspection Camera Borescope", "Monthly Sales": 10, "Monthly Revenue": 876.90},
                {"ASIN": "B0FDLVW4G8", "Title": "INNOVA 3360 Thermal Imaging Camera", "Monthly Sales": 2, "Monthly Revenue": 214.98},
                {"ASIN": "B09ZQ3ZQV2", "Title": "INNOVA 5420 Power Circuit Tester with Multimeter Functions", "Monthly Sales": 12, "Monthly Revenue": 1113.20},
            ]
        )
        market = pd.DataFrame(
            [
                {"ASIN": row["ASIN"], "Title": row["Title"], "Brand": "innova", "Monthly Sales": 1, "Monthly Revenue": 1, "Price": 1}
                for row in excluded.to_dict("records")
            ]
        )

        exclusion_map = _innova_3p_non_code_exclusion_map(excluded, "202607")
        self.assertEqual(set(exclusion_map), {"B000EVYGZA", "B000KIMHRQ", "B082JCSB4Z", "B0FDLVW4G8"})
        self.assertNotIn("B09ZQ3ZQV2", exclusion_map)
        filtered = _filter_innova_3p_non_code_products(excluded, "202607")
        self.assertEqual(set(filtered["ASIN"]), {"B09ZQ3ZQV2"})

        out = _apply_innova_monthly_rules(
            market,
            pd.DataFrame(columns=excluded.columns),
            excluded,
            month="202607",
        )
        rows = out.set_index("ASIN")
        for asin in exclusion_map:
            self.assertNotIn(asin, rows.index)
        self.assertIn("B09ZQ3ZQV2", rows.index)
        self.assertEqual(rows.at["B09ZQ3ZQV2", "Monthly Sales"], 12)
        self.assertEqual(rows.at["B09ZQ3ZQV2", "Monthly Revenue"], 1113.20)

    def test_innova_3p_non_code_rule_does_not_rewrite_history(self) -> None:
        row = pd.DataFrame(
            [{"ASIN": "B000EVYGZA", "Title": "INNOVA 3320 Digital Multimeter", "Monthly Sales": 9, "Monthly Revenue": 314.91}]
        )
        self.assertEqual(_innova_3p_non_code_exclusion_map(row, "202606"), {})
        self.assertIsNotNone(_classify_innova_3p_non_code_product(row.iloc[0]["Title"]))


if __name__ == "__main__":
    unittest.main()
