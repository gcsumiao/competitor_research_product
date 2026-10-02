"""Price-tier labelling: half-open [lo, hi) bands, boundaries go UP, exactly one leaf per typed row."""
from __future__ import annotations

import math
import unittest

import pandas as pd

from ca_market_reports.ca_common import CR_TIER_GROUPS, CR_TIERS, DONGLE_TIERS, GAUGE_TIERS, OTHER_TOOLS_TYPES, TYPES
from ca_market_reports import ca_tiers


def _tablet_tiers():
    return tuple((label, lo, hi) for label, (types, lo, hi) in CR_TIERS.items() if "Tablet" in types)


class TierLabelTest(unittest.TestCase):
    def test_boundaries_go_up(self):
        tiers = _tablet_tiers()
        self.assertEqual(ca_tiers.tier_label(399.99, tiers), "Tablet $400-")
        self.assertEqual(ca_tiers.tier_label(400.0, tiers), "Tablet $400-$800")
        self.assertEqual(ca_tiers.tier_label(799.99, tiers), "Tablet $400-$800")
        self.assertEqual(ca_tiers.tier_label(800.0, tiers), "Tablet $800+")
        self.assertEqual(ca_tiers.tier_label(0.0, tiers), "Tablet $400-")
        self.assertEqual(ca_tiers.tier_label(1e9, tiers), "Tablet $800+")

    def test_negative_and_nan_are_blank(self):
        tiers = _tablet_tiers()
        self.assertEqual(ca_tiers.tier_label(-0.01, tiers), "")
        self.assertEqual(ca_tiers.tier_label(math.nan, tiers), "")
        self.assertEqual(ca_tiers.tier_label(None, tiers), "")

    def test_gauge_tiers(self):
        self.assertEqual(ca_tiers.gauge_tier(49.99), "Under $50")
        self.assertEqual(ca_tiers.gauge_tier(50.0), "$50-99")
        self.assertEqual(ca_tiers.gauge_tier(99.99), "$50-99")
        self.assertEqual(ca_tiers.gauge_tier(100.0), "$100-249")
        self.assertEqual(ca_tiers.gauge_tier(250.0), "$250-499")
        self.assertEqual(ca_tiers.gauge_tier(500.0), "$500+")
        self.assertEqual(ca_tiers.gauge_tier(math.nan), "")
        self.assertEqual({ca_tiers.gauge_tier(p) for p in (1, 60, 120, 300, 900)}, {t[0] for t in GAUGE_TIERS})

    def test_dongle_tiers(self):
        self.assertEqual(ca_tiers.dongle_tier(49.99), "Under $50")
        self.assertEqual(ca_tiers.dongle_tier(100.0), "$100-149")
        self.assertEqual(ca_tiers.dongle_tier(150.0), "$150-249")
        self.assertEqual(ca_tiers.dongle_tier(249.99), "$150-249")
        self.assertEqual(ca_tiers.dongle_tier(250.0), "$250+")
        self.assertEqual({ca_tiers.dongle_tier(p) for p in (1, 60, 120, 200, 900)}, {t[0] for t in DONGLE_TIERS})


class AssignCrTiersTest(unittest.TestCase):
    def _frame(self, rows):
        return pd.DataFrame(rows, columns=["asin", "type", "price", "price_tier", "extra"])

    def test_every_typed_row_gets_exactly_one_leaf(self):
        prices = (0.0, 12.0, 74.99, 75.0, 399.99, 400.0, 799.99, 800.0, 5000.0)
        rows = [(f"B0TIER{i:04d}", t, p, "", "keep") for i, (t, p) in enumerate((t, p) for t in TYPES for p in prices)]
        out = ca_tiers.assign_cr_tiers(self._frame(rows))
        self.assertEqual(len(out), len(rows))
        self.assertTrue((out["extra"] == "keep").all(), "columns the module does not own must be preserved")
        for _, r in out.iterrows():
            hits = [label for label, (types, lo, hi) in CR_TIERS.items() if r["type"] in types and lo <= r["price"] < hi]
            self.assertEqual(len(hits), 1, (r["type"], r["price"]))
            self.assertEqual(r["price_tier"], hits[0])

    def test_specific_labels(self):
        out = ca_tiers.assign_cr_tiers(self._frame([
            ("B0TIER0001", "Tablet", 400.0, "", ""),
            ("B0TIER0002", "Handheld", 75.0, "", ""),
            ("B0TIER0003", "Handheld", 74.99, "", ""),
            ("B0TIER0004", "Dongle", 1999.0, "", ""),
            ("B0TIER0005", "OBD1", 10.0, "", ""),
            ("B0TIER0006", "Key", 10.0, "", ""),
            ("B0TIER0007", "", 10.0, "stale", ""),
        ]))
        self.assertEqual(out["price_tier"].tolist(), ["Tablet $400-$800", "Handheld $75+", "Handheld $75-", "Total Dongle",
                                                     "Total Other Tools", "Total Other Tools", ""])

    def test_unknown_type_raises(self):
        with self.assertRaises(ValueError) as cm:
            ca_tiers.assign_cr_tiers(self._frame([("B0TIER0001", "Scanner", 10.0, "", "")]))
        self.assertIn("B0TIER0001", str(cm.exception))

    def test_typed_row_without_a_tier_raises(self):
        with self.assertRaises(ValueError):
            ca_tiers.assign_cr_tiers(self._frame([("B0TIER0001", "Tablet", -5.0, "", "")]))
        with self.assertRaises(ValueError):
            ca_tiers.assign_cr_tiers(self._frame([("B0TIER0002", "Tablet", math.nan, "", "")]))

    def test_other_tools_cover_obd1(self):
        self.assertIn("OBD1", OTHER_TOOLS_TYPES)


class TierGroupTest(unittest.TestCase):
    def test_group_members(self):
        self.assertEqual(ca_tiers.cr_tier_group_members("Total Tablet"), CR_TIER_GROUPS["Total Tablet"])
        self.assertEqual(ca_tiers.cr_tier_group_members("Total"), CR_TIER_GROUPS["Total"])
        self.assertEqual(ca_tiers.cr_tier_group_members("Total Dongle"), ("Total Dongle",))
        with self.assertRaises(ValueError):
            ca_tiers.cr_tier_group_members("Total Widgets")


if __name__ == "__main__":
    unittest.main()
