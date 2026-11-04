"""Brand canonicalization, display names and generic-brand recovery (leading-title reassign only)."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from ca_market_reports.ca_common import BRAND_RECOVERY_COLUMNS, MAPS_DIR
from ca_market_reports import ca_brands


def _frame(rows):
    """rows: (asin, title, brand_key, units, revenue)"""
    return pd.DataFrame(
        [{"asin": a, "title": t, "brand_raw": k, "brand_key": k, "brand_display": k.title(), "units_month": u,
          "revenue_month": r, "other": "keep"} for a, t, k, u, r in rows])


class CanonicalKeyTest(unittest.TestCase):
    def setUp(self):
        self.aliases = ca_brands.load_aliases(MAPS_DIR / "ca_brand_aliases.csv")

    def test_normalization(self):
        k = ca_brands.canonical_brand_key
        self.assertEqual(k("  INNOVA ", {}), "innova")
        self.assertEqual(k("Bully   Dog", {}), "bully dog")
        self.assertEqual(k("MOTOPOWER®", {}), "motopower")
        self.assertEqual(k("Foo™ Bar©", {}), "foo bar")
        self.assertEqual(k("Foo ® Bar", {}), "foo bar")
        self.assertEqual(k(None, {}), "")
        self.assertEqual(k(float("nan"), {}), "")

    def test_aliases(self):
        k = ca_brands.canonical_brand_key
        self.assertEqual(k("EDGE", self.aliases), "edge products")
        self.assertEqual(k("Edge Products", self.aliases), "edge products")
        self.assertEqual(k("BULLY DOG", self.aliases), "bully dog")
        self.assertEqual(k("BullyDog", self.aliases), "bully dog")
        self.assertEqual(k("AUTO METER", self.aliases), "autometer")
        self.assertEqual(k("MotoPower®", self.aliases), "motopower")
        self.assertEqual(k("Innovate Motorsports", self.aliases), "innovate motorsports")
        self.assertEqual(k("Innovative Products of America", self.aliases), "innovative products of america")

    def test_alias_keys_are_canonicalized_on_load(self):
        # maps/ca_brand_aliases.csv carries raw_key 'motopower®' (glyph); lookup happens after glyph stripping
        self.assertIn("motopower", self.aliases)
        self.assertNotIn("motopower®", self.aliases)

    def test_conflicting_alias_rows_raise(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "aliases.csv"
            p.write_text("raw_key,canonical_key,note\nfoo,bar,\nFOO,baz,\n", encoding="utf-8")
            with self.assertRaises(ValueError):
                ca_brands.load_aliases(p)
            p.write_text("raw_key,canonical_key\nfoo,bar\n", encoding="utf-8")   # missing column
            with self.assertRaises(ValueError):
                ca_brands.load_aliases(p)

    def test_display(self):
        display = ca_brands.load_display(MAPS_DIR / "ca_brand_display.csv")
        self.assertEqual(ca_brands.display_brand("innova", display), "Innova")
        self.assertEqual(ca_brands.display_brand("obdlink", display), "OBDLink")
        self.assertEqual(ca_brands.display_brand("innovate motorsports", display), "Innovate Motorsports")
        self.assertEqual(ca_brands.display_brand("diesel laptops", {}), "Diesel Laptops")
        self.assertEqual(ca_brands.display_brand("", display), "")


class GenericRecoveryTest(unittest.TestCase):
    VOCAB = {"foxwell", "innova", "edge products", "edge", "autel", "car", "ab", "bmw", "nexiq", "generic"}

    def test_leading_match_reassigns(self):
        df = _frame([
            ("B0GEN00001", "FOXWELL NT530 Multi-System OBD2 Scanner for BMW", "generic", 4, 796.0),
            ("B0GEN00002", "Case for Innova 5610 Scanner, Hard EVA Travel Case", "generic", 2, 39.98),
            ("B0GEN00003", "INNOVA 5210 OBD2 Scanner", "generic", 1, 99.0),          # US 'blocked -> remove' is NOT carried over
            ("B0GEN00004", "for BMW OBD2 Scanner", "generic", 1, 10.0),
            ("B0GEN00005", "New 2024 Upgraded Autel AL319 Code Reader", "generic", 3, 90.0),
            ("B0GEN00006", "Edge Products Insight CTS3", "generic", 1, 600.0),        # longest match wins
            ("B0GEN00007", "Car OBD2 Scanner", "generic", 1, 20.0),                   # stopword brand never matches
            ("B0GEN00008", "AB tool kit", "generic", 1, 20.0),                        # shorter than 3 chars
            ("B0GEN00009", "Autel MaxiCOM", "autel", 5, 500.0),                       # not generic -> untouched
            ("B0GEN00010", "Nexiq USB Link 3", "generic", 1, 900.0),
            ("B0GEN00011", "Foxwellish NT301", "generic", 1, 9.0),                    # whole-token match only
        ])
        out, audit = ca_brands.recover_generic_brands(df, set(self.VOCAB), None, month="202609")
        got = dict(zip(out["asin"], out["brand_key"]))
        self.assertEqual(got["B0GEN00001"], "foxwell")
        self.assertEqual(got["B0GEN00002"], "generic")
        self.assertEqual(got["B0GEN00003"], "innova")
        self.assertEqual(got["B0GEN00004"], "generic")
        self.assertEqual(got["B0GEN00005"], "autel")
        self.assertEqual(got["B0GEN00006"], "edge products")
        self.assertEqual(got["B0GEN00007"], "generic")
        self.assertEqual(got["B0GEN00008"], "generic")
        self.assertEqual(got["B0GEN00009"], "autel")
        self.assertEqual(got["B0GEN00010"], "nexiq")
        self.assertEqual(got["B0GEN00011"], "generic")
        self.assertEqual(len(out), len(df), "reassign only: no row is ever removed")
        self.assertTrue((out["other"] == "keep").all())
        self.assertEqual(tuple(audit.columns), BRAND_RECOVERY_COLUMNS)
        self.assertEqual(sorted(audit["asin"]), ["B0GEN00001", "B0GEN00003", "B0GEN00005", "B0GEN00006", "B0GEN00010"])
        self.assertTrue((audit["action"] == "reassigned").all())
        self.assertTrue((audit["month"] == "202609").all())
        row = audit.set_index("asin").loc["B0GEN00006"]
        self.assertEqual((row["old_brand"], row["new_brand"], row["matched_text"]), ("generic", "edge products", "edge products"))
        self.assertEqual(float(audit.set_index("asin").loc["B0GEN00001", "monthly_revenue"]), 796.0)

    def test_display_updated(self):
        df = _frame([("B0GEN00001", "FOXWELL NT530", "generic", 4, 796.0)])
        display = ca_brands.load_display(MAPS_DIR / "ca_brand_display.csv")
        out, _ = ca_brands.recover_generic_brands(df, {"foxwell"}, None, display=display, month="202609")
        self.assertEqual(out.loc[0, "brand_display"], "FOXWELL")
        out2, _ = ca_brands.recover_generic_brands(df, {"foxwell"}, None)
        self.assertEqual(out2.loc[0, "brand_display"], "Foxwell")

    def test_frozen_rows_applied_verbatim_before_new(self):
        df = _frame([
            ("B0GEN00001", "FOXWELL NT530", "generic", 4, 796.0),
            ("B0GEN00002", "Autel AL319", "generic", 1, 50.0),
        ])
        frozen = pd.DataFrame([{"month": "202609", "asin": "B0GEN00001", "title": "old title", "old_brand": "generic",
                                "new_brand": "launch", "matched_text": "launch", "monthly_units": 9, "monthly_revenue": 9.0,
                                "action": "reassigned"}], columns=BRAND_RECOVERY_COLUMNS)
        out, audit = ca_brands.recover_generic_brands(df, {"foxwell", "autel"}, frozen, month="202609")
        got = dict(zip(out["asin"], out["brand_key"]))
        self.assertEqual(got, {"B0GEN00001": "launch", "B0GEN00002": "autel"})
        a = audit.set_index("asin")
        self.assertEqual(a.loc["B0GEN00001", "title"], "old title", "frozen row is carried verbatim")
        self.assertEqual(a.loc["B0GEN00002", "new_brand"], "autel")
        self.assertEqual(len(audit), 2)


if __name__ == "__main__":
    unittest.main()
