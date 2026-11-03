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
    PRICE_TIER_V2_START_MONTH,
    SCHEME_V1,
    SCHEME_V2,
    Tier,
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
    ("Tablet $300+", ["Tablet"], 300, 400),
    ("Tablet $200-$300", ["Tablet"], 200, 300),
    ("Tablet $200-", ["Tablet"], 0, 200),
    ("Total Tablet", ["Tablet"], 0, math.inf),
    ("Handheld $100+", ["Handheld"], 100, math.inf),
    ("Handheld $100-", ["Handheld"], 0, 100),
    ("Handheld $65+", ["Handheld"], 65, 100),
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
            ["Tablet $300+", "Tablet $200-$300", "Tablet $200-", "Handheld $65+", "Handheld $35-$65", "Handheld $35-"],
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
                "Tablet $300+",
                "Tablet $200-$300",
                "Tablet $200-",
                "Handheld $100+",
                "Handheld $65+",
                "Handheld $35-$65",
                "Handheld $35-",
            ],
        )
        self.assertEqual(parent_of("Tablet $300+", "v2"), "Tablet $400-")
        self.assertEqual(parent_of("Handheld $35-", "v2"), "Handheld $100-")
        self.assertIsNone(parent_of("Tablet $400-", "v2"))
        self.assertIsNone(parent_of("Total", "v2"))
        self.assertEqual(children_of("Tablet $400-", "v2"), ["Tablet $300+", "Tablet $200-$300", "Tablet $200-"])
        self.assertEqual(children_of("Handheld $100-", "v2"), ["Handheld $65+", "Handheld $35-$65", "Handheld $35-"])
        self.assertEqual(children_of("Tablet $800+", "v2"), [])
        self.assertEqual(children_of("Tablet $400-", "v1"), [])
        with self.assertRaises(KeyError):
            parent_of("Handheld $75+", "v2")
        with self.assertRaises(KeyError):
            children_of("Tablet $300+", "v1")
        with self.assertRaises(ValueError):
            tier_labels("auto")


class PriceTierSchemeBucketingTest(unittest.TestCase):
    """Real append_summary_list over a synthetic market."""

    BOUNDARY_EXPECTATIONS = [
        # (Type, price, the V2 leaf it must land in, the parent tier if any)
        ("Tablet", 800.0, "Tablet $800+", None),
        ("Tablet", 400.0, "Tablet $400-$800", None),
        ("Tablet", 300.0, "Tablet $300+", "Tablet $400-"),
        ("Tablet", 200.0, "Tablet $200-$300", "Tablet $400-"),
        ("Handheld", 100.0, "Handheld $100+", None),
        ("Handheld", 65.0, "Handheld $65+", "Handheld $100-"),
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


if __name__ == "__main__":
    unittest.main()
