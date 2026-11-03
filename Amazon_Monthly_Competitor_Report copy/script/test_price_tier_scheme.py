#!/usr/bin/env python3
from __future__ import annotations

import math
import subprocess
import sys
import unittest
from pathlib import Path

import pandas as pd

import full_report_month
from full_report_month import append_summary_list
from price_tier_scheme import (
    LEGACY_LABELS,
    PRICE_TIER_V2_START_MONTH,
    SCHEME_V1,
    SCHEME_V2,
    Tier,
    categorized_share_basis,
    category_dict,
    children_of,
    describe_scheme,
    leaf_labels,
    parent_of,
    resolve_scheme_name,
    scheme_for_month,
    scheme_version,
    subtier_labels,
    tier_labels,
    total_labels,
)

# The dict that lived in full_report_month.main() before scheme V2, with one
# deliberate change: open-ended tiers are bounded by math.inf instead of the old
# price_range = ceil(max(Price)) cap, which dropped a listing priced at a whole
# dollar amount (202403: $9,987.00) from every open bucket. Months before 202610
# must keep producing exactly this (same keys, order, types and closed bounds).
V1_CATEGORY_DICT = {
    "Tablet $800+": [["Tablet"], 800, math.inf],
    "Tablet $400-$800": [["Tablet"], 400, 800],
    "Tablet $400-": [["Tablet"], 0, 400],
    "Total Tablet": [["Tablet"], 0, math.inf],
    "Handheld $75+": [["Handheld"], 75, math.inf],
    "Handheld $75-": [["Handheld"], 0, 75],
    "Total Handheld": [["Handheld"], 0, math.inf],
    "Total Dongle": [["Dongle"], 0, math.inf],
    "Total Other Tools": [["Key", "Cable/Adapter", "Other", "Probe", "VCI"], 0, math.inf],
    "Total": [["Tablet", "Handheld", "Dongle", "Key", "Cable/Adapter", "Other", "Probe", "VCI"], 0, math.inf],
}

V2_EXPECTED = [
    ("Tablet $800+", ["Tablet"], 800, math.inf),
    ("Tablet $400-$800", ["Tablet"], 400, 800),
    ("Tablet $400-", ["Tablet"], 0, 400),
    ("Tablet $300-$400", ["Tablet"], 300, 400),
    ("Tablet $200-$300", ["Tablet"], 200, 300),
    ("Tablet $200-", ["Tablet"], 0, 200),
    ("Total Tablet", ["Tablet"], 0, math.inf),
    ("Handheld $100+", ["Handheld"], 100, math.inf),
    ("Handheld $100-", ["Handheld"], 0, 100),
    ("Handheld $65-$100", ["Handheld"], 65, 100),
    ("Handheld $35-$65", ["Handheld"], 35, 65),
    ("Handheld $35-", ["Handheld"], 0, 35),
    ("Total Handheld", ["Handheld"], 0, math.inf),
    ("Total Dongle", ["Dongle"], 0, math.inf),
    ("Total Other Tools", ["Key", "Cable/Adapter", "Other", "Probe", "VCI"], 0, math.inf),
    ("Total", ["Tablet", "Handheld", "Dongle", "Key", "Cable/Adapter", "Other", "Probe", "VCI"], 0, math.inf),
]


def _summary(df: pd.DataFrame, category: dict) -> dict[str, tuple[float, float]]:
    rows: list[list] = []
    append_summary_list(df, category, "Total", rows)
    return {row[1]: (row[2], row[4]) for row in rows}


def _shares(df: pd.DataFrame, category: dict, tag: str, categorized: bool) -> dict[str, tuple[float, float]]:
    """label -> (Qty by %, Revenue by %) of one append_summary_list call."""
    rows: list[list] = []
    append_summary_list(df, category, tag, rows, categorized_shares=categorized)
    return {row[1]: (row[3], row[5]) for row in rows}


def _listing(type_: str, price: float, units: int) -> dict:
    return {"Type": type_, "Price": price, "Monthly Sales": units, "Monthly Revenue": round(price * units, 2)}


class PriceTierSchemeDictTest(unittest.TestCase):
    def test_v1_dict_matches_the_pinned_literal(self) -> None:
        for month in ("202609", "202501", None):
            got = category_dict(month, 1000)
            self.assertEqual(got, V1_CATEGORY_DICT)
            self.assertEqual(list(got), list(V1_CATEGORY_DICT))
            for value in got.values():
                self.assertIsInstance(value[0], list)
                self.assertIsInstance(value[1], int)
                if value[2] == math.inf:
                    self.assertIsInstance(value[2], float)
                else:
                    self.assertIsInstance(value[2], int)

    def test_open_ended_bound_is_inf_whatever_the_price_range(self) -> None:
        for scheme in ("v1", "v2"):
            for price_range in (1000, 9987, 1, None):
                got = category_dict("202610", price_range, scheme=scheme)
                open_ended = [label for label, (_types, _low, high) in got.items() if high == math.inf]
                self.assertEqual(
                    open_ended,
                    [t.label for t in (SCHEME_V1 if scheme == "v1" else SCHEME_V2) if t.high is None],
                    (scheme, price_range),
                )

    def test_v2_dict_has_16_keys_in_order_with_ranges(self) -> None:
        got = category_dict("202610", 1000)
        self.assertEqual(len(got), 16)
        self.assertEqual(list(got), [label for label, *_ in V2_EXPECTED])
        for label, types, low, high in V2_EXPECTED:
            self.assertEqual(got[label], [types, low, high], label)

    def test_scheme_flips_exactly_at_start_month(self) -> None:
        self.assertEqual(PRICE_TIER_V2_START_MONTH, "202610")
        self.assertEqual(scheme_version("202609"), "v1")
        self.assertEqual(scheme_version("202610"), "v2")
        self.assertEqual(scheme_version("202701"), "v2")
        self.assertEqual(scheme_version(None), "v1")
        self.assertEqual(scheme_version(""), "v1")
        self.assertIs(scheme_for_month("202609"), SCHEME_V1)
        self.assertIs(scheme_for_month("202610"), SCHEME_V2)
        self.assertIs(scheme_for_month(None), SCHEME_V1)
        with self.assertRaises(ValueError):
            scheme_version("2026-10")

    def test_forced_scheme_overrides_month(self) -> None:
        self.assertEqual(list(category_dict("202609", 1000, scheme="v2")), [label for label, *_ in V2_EXPECTED])
        self.assertEqual(category_dict("202610", 1000, scheme="v1"), V1_CATEGORY_DICT)
        self.assertEqual(resolve_scheme_name("202609", "auto"), "v1")
        self.assertEqual(resolve_scheme_name("202609", "v2"), "v2")
        with self.assertRaises(ValueError):
            category_dict("202610", 1000, scheme="v3")
        self.assertEqual(describe_scheme("202610"), "v2 (202610+)")
        self.assertEqual(describe_scheme("202609"), "v1")
        self.assertTrue(describe_scheme("202609", "v2").startswith("v2 (202610+)"))

    def test_subtiers_partition_parent_exactly(self) -> None:
        by_label = {t.label: t for t in SCHEME_V2}
        for parent in ("Tablet $400-", "Handheld $100-"):
            kids = sorted((by_label[c] for c in children_of(parent, SCHEME_V2)), key=lambda t: t.low)
            self.assertEqual(len(kids), 3)
            self.assertEqual(kids[0].low, by_label[parent].low)
            self.assertEqual(kids[-1].high, by_label[parent].high)
            for lo, hi in zip(kids, kids[1:]):
                self.assertEqual(lo.high, hi.low, f"gap/overlap between {lo.label} and {hi.label}")
            for kid in kids:
                self.assertEqual(kid.types, by_label[parent].types)
        self.assertEqual(
            [(t.low, t.high) for t in sorted((by_label[c] for c in children_of("Tablet $400-", "v2")), key=lambda t: t.low)],
            [(0, 200), (200, 300), (300, 400)],
        )
        self.assertEqual(
            [(t.low, t.high) for t in sorted((by_label[c] for c in children_of("Handheld $100-", "v2")), key=lambda t: t.low)],
            [(0, 35), (35, 65), (65, 100)],
        )

    def test_legacy_labels_map_the_superseded_v2_wording(self) -> None:
        # Analyst relabel 2026-11-03: same ranges, explicit upper bound.
        self.assertEqual(LEGACY_LABELS, {"Tablet $300+": "Tablet $300-$400", "Handheld $65+": "Handheld $65-$100"})
        labels = tier_labels("v2")
        for old, new in LEGACY_LABELS.items():
            self.assertIn(new, labels)
            self.assertNotIn(old, labels)
            self.assertNotIn(old, tier_labels("v1"))
        by_label = {t.label: t for t in SCHEME_V2}
        self.assertEqual((by_label["Tablet $300-$400"].low, by_label["Tablet $300-$400"].high), (300, 400))
        self.assertEqual((by_label["Handheld $65-$100"].low, by_label["Handheld $65-$100"].high), (65, 100))

    def test_tier_dataclass_is_frozen(self) -> None:
        with self.assertRaises(Exception):
            SCHEME_V2[0].low = 1  # type: ignore[misc]
        self.assertIsInstance(SCHEME_V2[0], Tier)

    def test_builder_wires_the_scheme_module(self) -> None:
        self.assertIs(full_report_month.category_dict, category_dict)
        script = Path(full_report_month.__file__).resolve()
        out = subprocess.run([sys.executable, str(script), "--help"], capture_output=True, text=True, check=True).stdout
        self.assertIn("--tier-scheme", out)
        self.assertIn("{auto,v1,v2}", out)


class PriceTierSchemeHelpersTest(unittest.TestCase):
    def test_labels_and_totals(self) -> None:
        self.assertEqual(tier_labels("v1"), list(V1_CATEGORY_DICT))
        self.assertEqual(tier_labels(SCHEME_V2), [label for label, *_ in V2_EXPECTED])
        self.assertEqual(subtier_labels("v1"), [])
        self.assertEqual(
            subtier_labels("v2"),
            ["Tablet $300-$400", "Tablet $200-$300", "Tablet $200-", "Handheld $65-$100", "Handheld $35-$65", "Handheld $35-"],
        )
        expected_totals = ["Total Tablet", "Total Handheld", "Total Dongle", "Total Other Tools", "Total"]
        self.assertEqual(total_labels("v1"), expected_totals)
        self.assertEqual(total_labels("v2"), expected_totals)

    def test_leaf_parent_children(self) -> None:
        self.assertEqual(
            leaf_labels("v1"),
            ["Tablet $800+", "Tablet $400-$800", "Tablet $400-", "Handheld $75+", "Handheld $75-"],
        )
        self.assertEqual(
            leaf_labels("v2"),
            [
                "Tablet $800+",
                "Tablet $400-$800",
                "Tablet $300-$400",
                "Tablet $200-$300",
                "Tablet $200-",
                "Handheld $100+",
                "Handheld $65-$100",
                "Handheld $35-$65",
                "Handheld $35-",
            ],
        )
        self.assertEqual(parent_of("Tablet $300-$400", "v2"), "Tablet $400-")
        self.assertEqual(parent_of("Handheld $35-", "v2"), "Handheld $100-")
        self.assertIsNone(parent_of("Tablet $400-", "v2"))
        self.assertIsNone(parent_of("Total", "v2"))
        self.assertEqual(children_of("Tablet $400-", "v2"), ["Tablet $300-$400", "Tablet $200-$300", "Tablet $200-"])
        self.assertEqual(children_of("Handheld $100-", "v2"), ["Handheld $65-$100", "Handheld $35-$65", "Handheld $35-"])
        self.assertEqual(children_of("Tablet $800+", "v2"), [])
        self.assertEqual(children_of("Tablet $400-", "v1"), [])
        with self.assertRaises(KeyError):
            parent_of("Handheld $75+", "v2")
        with self.assertRaises(KeyError):
            children_of("Tablet $300-$400", "v1")
        with self.assertRaises(ValueError):
            tier_labels("auto")


class PriceTierSchemeBucketingTest(unittest.TestCase):
    """Real append_summary_list over a synthetic market."""

    BOUNDARY_EXPECTATIONS = [
        # (Type, price, the V2 leaf it must land in, the parent tier if any)
        ("Tablet", 800.0, "Tablet $800+", None),
        ("Tablet", 400.0, "Tablet $400-$800", None),
        ("Tablet", 300.0, "Tablet $300-$400", "Tablet $400-"),
        ("Tablet", 200.0, "Tablet $200-$300", "Tablet $400-"),
        ("Handheld", 100.0, "Handheld $100+", None),
        ("Handheld", 65.0, "Handheld $65-$100", "Handheld $100-"),
        ("Handheld", 35.0, "Handheld $35-$65", "Handheld $100-"),
    ]

    def setUp(self) -> None:
        rows = [
            _listing("Tablet", 1234.5, 3),
            _listing("Tablet", 800.0, 5),
            _listing("Tablet", 799.99, 7),
            _listing("Tablet", 400.0, 11),
            _listing("Tablet", 399.99, 13),
            _listing("Tablet", 300.0, 17),
            _listing("Tablet", 299.99, 19),
            _listing("Tablet", 200.0, 23),
            _listing("Tablet", 199.99, 29),
            _listing("Tablet", 49.0, 31),
            _listing("Handheld", 250.0, 37),
            _listing("Handheld", 100.0, 41),
            _listing("Handheld", 99.99, 43),
            _listing("Handheld", 65.0, 47),
            _listing("Handheld", 64.99, 53),
            _listing("Handheld", 35.0, 59),
            _listing("Handheld", 34.99, 61),
            _listing("Handheld", 9.99, 67),
            _listing("Dongle", 29.99, 71),
            _listing("Key", 15.0, 73),
            _listing("VCI", 120.0, 79),
        ]
        self.market = pd.DataFrame(rows)
        self.price_range = math.ceil(max(self.market.Price))
        self.v2 = category_dict("202610", self.price_range)
        self.v1 = category_dict("202609", self.price_range)

    def test_subtier_sums_equal_parent(self) -> None:
        got = _summary(self.market, self.v2)
        for parent in ("Tablet $400-", "Handheld $100-"):
            kids = children_of(parent, "v2")
            units = sum(got[k][0] for k in kids)
            rev = sum(got[k][1] for k in kids)
            self.assertEqual(units, got[parent][0], parent)
            self.assertAlmostEqual(rev, got[parent][1], places=6, msg=parent)
            self.assertGreater(got[parent][0], 0)

    def test_leaves_partition_type_totals_and_totals_match_v1(self) -> None:
        v2 = _summary(self.market, self.v2)
        v1 = _summary(self.market, self.v1)
        tablet_leaves = [label for label in leaf_labels("v2") if label.startswith("Tablet")]
        handheld_leaves = [label for label in leaf_labels("v2") if label.startswith("Handheld")]
        self.assertEqual(sum(v2[k][0] for k in tablet_leaves), v2["Total Tablet"][0])
        self.assertEqual(sum(v2[k][0] for k in handheld_leaves), v2["Total Handheld"][0])
        self.assertAlmostEqual(sum(v2[k][1] for k in tablet_leaves), v2["Total Tablet"][1], places=6)
        self.assertAlmostEqual(sum(v2[k][1] for k in handheld_leaves), v2["Total Handheld"][1], places=6)
        for label in total_labels("v2"):
            self.assertEqual(v2[label], v1[label], label)
        # Unchanged tiers are identical across schemes.
        for label in ("Tablet $800+", "Tablet $400-$800", "Tablet $400-"):
            self.assertEqual(v2[label], v1[label], label)

    def test_boundary_prices_land_in_upper_bucket(self) -> None:
        leaves = set(leaf_labels("v2"))
        for type_, price, leaf, parent in self.BOUNDARY_EXPECTATIONS:
            with self.subTest(type=type_, price=price):
                one = pd.DataFrame([_listing(type_, price, 1), _listing("Dongle", 5000.0, 1)])
                got = _summary(one, category_dict("202610", math.ceil(max(one.Price))))
                hit_leaves = {label for label in leaves if got[label][0] > 0}
                self.assertEqual(hit_leaves, {leaf})
                hit_parents = {label for label in ("Tablet $400-", "Handheld $100-") if got[label][0] > 0}
                self.assertEqual(hit_parents, {parent} if parent else set())

    def test_max_price_listing_stays_in_open_tier(self) -> None:
        got = _summary(self.market, self.v2)
        self.assertEqual(got["Tablet $800+"][0], 3 + 5)
        self.assertEqual(got["Handheld $100+"][0], 37 + 41)

    def test_whole_dollar_max_price_listing_stays_in_open_tiers(self) -> None:
        # The old open-ended bound ceil(max Price) equalled a whole-dollar max
        # (202403: $9,987.00), so ``Price < high`` dropped that listing from
        # every open bucket. The caller still passes that price_range.
        market = pd.DataFrame(
            [
                _listing("Tablet", 1000.0, 3),
                _listing("Tablet", 850.5, 5),
                _listing("Tablet", 450.0, 7),
                _listing("Handheld", 120.0, 11),
                _listing("Dongle", 30.0, 13),
            ]
        )
        price_range = math.ceil(max(market.Price))
        self.assertEqual(price_range, 1000)
        total_units = 3 + 5 + 7 + 11 + 13
        for month in ("202609", "202610"):  # v1, v2
            with self.subTest(scheme=scheme_version(month)):
                got = _summary(market, category_dict(month, price_range))
                self.assertEqual(got["Tablet $800+"][0], 3 + 5)
                self.assertAlmostEqual(got["Tablet $800+"][1], 3000.0 + 4252.5, places=6)
                self.assertEqual(got["Total Tablet"][0], 3 + 5 + 7)
                self.assertEqual(got["Total"][0], total_units)
                self.assertAlmostEqual(got["Total"][1], market["Monthly Revenue"].sum(), places=6)



class CategoryShareBasisTest(unittest.TestCase):
    """Sheet1 "Qty by %" / "Revenue by %" denominators (analyst decision
    2026-11-03, option 2): V2+ divides by the frame's own "Total"-category
    sums, so a market holding an OBD1 listing (a type in no category) still
    has a Total row of exactly 100%; V1 keeps the whole-frame basis."""

    def setUp(self) -> None:
        self.market = pd.DataFrame(
            [
                {**_listing("Tablet", 900.0, 4), "Brand": "autel"},
                {**_listing("Tablet", 350.0, 6), "Brand": "autel"},
                {**_listing("Handheld", 80.0, 10), "Brand": "autel"},
                {**_listing("OBD1", 45.0, 12), "Brand": "autel"},  # in no category
                {**_listing("Handheld", 30.0, 20), "Brand": "innova"},
                {**_listing("Dongle", 25.0, 8), "Brand": "innova"},
                {**_listing("Key", 12.0, 5), "Brand": "other"},
                {**_listing("OBD1", 60.0, 7), "Brand": "other"},  # in no category
            ]
        )
        self.v2 = category_dict("202610", None)
        self.v1 = category_dict("202609", None)
        obd1 = self.market.Type.eq("OBD1")
        self.cat_units = self.market.loc[~obd1, "Monthly Sales"].sum()
        self.cat_rev = self.market.loc[~obd1, "Monthly Revenue"].sum()

    def test_basis_follows_the_scheme(self) -> None:
        self.assertFalse(categorized_share_basis("202609"))
        self.assertTrue(categorized_share_basis("202610"))
        self.assertTrue(categorized_share_basis("202609", "v2"))
        self.assertFalse(categorized_share_basis("202610", "v1"))
        self.assertFalse(categorized_share_basis(None))

    def test_v2_total_row_is_exactly_100_percent_with_an_obd1_listing(self) -> None:
        got = _shares(self.market, self.v2, "Total", categorized=True)
        self.assertEqual(got["Total"], (1.0, 1.0))
        rows: list[list] = []
        append_summary_list(self.market, self.v2, "Total", rows, categorized_shares=True)
        total = next(row for row in rows if row[1] == "Total")
        self.assertEqual(total[2], self.cat_units)  # the amounts themselves are unchanged
        self.assertAlmostEqual(total[4], self.cat_rev, places=6)

    def test_v2_rows_are_shares_of_the_total_category(self) -> None:
        got = _shares(self.market, self.v2, "Total", categorized=True)
        amounts = _summary(self.market, self.v2)
        for label, (units, rev) in amounts.items():
            self.assertAlmostEqual(got[label][0], units / self.cat_units, places=12, msg=label)
            self.assertAlmostEqual(got[label][1], rev / self.cat_rev, places=12, msg=label)
        # sub-tiers still add up to their parent, families to the Total
        for parent in ("Tablet $400-", "Handheld $100-"):
            kids = children_of(parent, "v2")
            self.assertAlmostEqual(sum(got[k][1] for k in kids), got[parent][1], places=12)
        families = ("Total Tablet", "Total Handheld", "Total Dongle", "Total Other Tools")
        self.assertAlmostEqual(sum(got[f][0] for f in families), 1.0, places=12)
        self.assertAlmostEqual(sum(got[f][1] for f in families), 1.0, places=12)

    def test_v2_brand_rows_divide_by_the_brands_categorized_sums(self) -> None:
        # Each tag's own "Total"-category sums (the brand tab's Total row is
        # 100% too): autel's OBD1 listing drops out of its denominator.
        autel = self.market[self.market.Brand.eq("autel")]
        got = _shares(autel, self.v2, "autel", categorized=True)
        categorized = autel[~autel.Type.eq("OBD1")]
        brand_rev = categorized["Monthly Revenue"].sum()
        tablet_rev = categorized.loc[categorized.Type.eq("Tablet"), "Monthly Revenue"].sum()
        self.assertEqual(got["Total"], (1.0, 1.0))
        self.assertAlmostEqual(got["Total Tablet"][1], tablet_rev / brand_rev, places=12)
        self.assertAlmostEqual(got["Total Tablet"][0], (4 + 6) / (4 + 6 + 10), places=12)
        self.assertEqual(got["Total Dongle"], (0, 0))

    def test_v2_lm_and_ly_frames_use_their_own_total_category(self) -> None:
        last_month = self.market.assign(**{"Monthly Sales": self.market["Monthly Sales"] * 2})
        last_month["Monthly Revenue"] = last_month["Price"] * last_month["Monthly Sales"]
        got = _shares(last_month, self.v2, "Total", categorized=True)
        self.assertEqual(got["Total"], (1.0, 1.0))
        obd1 = last_month.Type.eq("OBD1")
        dongle = last_month.Type.eq("Dongle")
        self.assertAlmostEqual(
            got["Total Dongle"][1],
            last_month.loc[dongle, "Monthly Revenue"].sum() / last_month.loc[~obd1, "Monthly Revenue"].sum(),
            places=12,
        )

    def test_v1_keeps_the_whole_market_basis(self) -> None:
        got = _shares(self.market, self.v1, "Total", categorized=False)
        rows: list[list] = []
        append_summary_list(self.market, self.v1, "Total", rows)  # keyword default = V1 basis
        self.assertEqual({row[1]: (row[3], row[5]) for row in rows}, got)
        units, rev = self.market["Monthly Sales"].sum(), self.market["Monthly Revenue"].sum()
        amounts = _summary(self.market, self.v1)
        for label, (u, r) in amounts.items():
            self.assertEqual(got[label], (u / units, r / rev), label)
        self.assertLess(got["Total"][0], 1.0)
        self.assertLess(got["Total"][1], 1.0)

    def test_builder_gates_the_basis_on_the_resolved_scheme(self) -> None:
        source = Path(full_report_month.__file__).read_text(encoding="utf-8")
        self.assertIn("categorized_share_basis(month, args.tier_scheme)", source)
        self.assertEqual(source.count("categorized_shares=categorized_shares"), 3)


if __name__ == "__main__":
    unittest.main()
