"""Real-data smoke test (202609). Skipped unless the gitignored raw exports exist in the main checkout.

Writes ONLY under <worktree>/tmp/ca_scratch/runs (never under NewProductCategory/).
"""
from __future__ import annotations

import unittest
from pathlib import Path

from ca_market_reports.ca_common import MARKETS, NEW_PRODUCT_DIR, SCRATCH_DIR, US_TYPE_MAP_DEFAULT
from ca_market_reports import ca_load, ca_types

MONTH = "202609"
CA_CR_DIR = NEW_PRODUCT_DIR / "CA-CODE-READER" / "raw_data" / MONTH
RUNS = SCRATCH_DIR / "runs"


def _snapshot(root: Path) -> dict[str, tuple[int, int]]:
    return {str(p): (p.stat().st_size, p.stat().st_mtime_ns) for p in root.rglob("*") if p.is_file()}


@unittest.skipUnless(CA_CR_DIR.exists(), f"real data not present: {CA_CR_DIR}")
class RealDataSmokeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.before = _snapshot(NEW_PRODUCT_DIR / "CA-CODE-READER") | _snapshot(NEW_PRODUCT_DIR / "CA-OBD-GAUGE")
        cls.ca = ca_load.load_month("CA", MONTH, runs_dir=RUNS, rederive=True)

    def test_ca_code_reader_counts(self):
        cr = self.ca.code_reader
        self.assertEqual(len(ca_load.discover_raw_files(MARKETS["CA"].cr_raw_dir(MONTH))), 10)
        self.assertEqual(len(self.ca.raw_files), 15, "raw_files lists CR files then gauge files, in read order")
        self.assertEqual(sum(n for _, n in self.ca.raw_files[:10]), 1838)
        self.assertEqual(len(cr), 1828)
        self.assertEqual(cr["asin"].nunique(), 1828)
        self.assertLessEqual(abs(cr["revenue_month"].sum() - 4_299_107), 1.0, cr["revenue_month"].sum())
        self.assertEqual(int(cr["units_month"].sum()), 30_111)

    def test_innova_rows(self):
        cr = self.ca.code_reader
        self.assertEqual(int((cr["brand_key"] == "innova").sum()), 23)
        for raw in ("Innovate Motorsports", "Innovative Products of America"):
            rows = cr[cr["brand_raw"] == raw]
            self.assertTrue((rows["brand_key"] != "innova").all(), raw)

    def test_dedupe_audit(self):
        a = self.ca.audits["dedupe_audit"]
        cra = a[a["source_set"] == "code_reader"]
        self.assertEqual(int((cra["winning_rule"] == "identical").sum()), 10)
        self.assertEqual(int((~cra["winning_rule"].isin(["identical"])).sum()), 0)

    def test_ca_gauge(self):
        g = self.ca.gauge_set
        names = [p.name for p in ca_load.discover_raw_files(MARKETS["CA"].gauge_raw_dir(MONTH))]
        self.assertEqual(len(names), 5)
        self.assertIn("CA_AMAZON_blackBoxProducts_bullydog_2026-10-02.csv", names)
        self.assertEqual(sum(n for name, n in self.ca.raw_files[10:]), 58)
        self.assertEqual(len(g), 51)
        self.assertEqual(int((g["brand_key"] == "bully dog").sum()), 3)

    def test_union(self):
        audit: list[dict] = []
        u = ca_load.union_gauge_frames(self.ca.code_reader, self.ca.gauge_set, audit)
        self.assertEqual(len(u), 1864)
        self.assertEqual(int((u["source_set"] == "both").sum()), 15)
        self.assertEqual(len(audit), 15)

    def test_type_coverage(self):
        cr = self.ca.code_reader
        us_map = ca_types.load_us_type_map(US_TYPE_MAP_DEFAULT)
        covered = int(cr["asin"].isin(set(us_map)).sum())
        self.assertGreaterEqual(covered, 1200)
        self.assertEqual(int((cr["type_source"] == "us_map").sum()), covered, "no overrides/prior exist for 202609")
        self.assertTrue((cr["price_tier"] != "").all())
        dist = cr["type_source"].value_counts().to_dict()
        print(f"\n[smoke] us_map coverage={covered} type_source={dist} type_review_rows={len(self.ca.audits['type_review'])}")
        print("[smoke] type distribution", cr["type"].value_counts().to_dict())

    def test_us_guard_and_us_exports(self):
        with self.assertRaises(ValueError):
            ca_load.load_month("US", MONTH, assign_types=True, runs_dir=RUNS, freeze=False)
        us = ca_load.load_month("US", MONTH, assign_types=False, gauge_raw_dir=MARKETS["US"].gauge_raw_dir(MONTH),
                                runs_dir=RUNS, rederive=True)
        self.assertEqual(len(ca_load.discover_raw_files(MARKETS["US"].cr_raw_dir(MONTH))), 28)
        self.assertEqual(len(us.code_reader), 5547)
        self.assertEqual(len(ca_load.discover_raw_files(MARKETS["US"].gauge_raw_dir(MONTH))), 3)
        self.assertEqual(len(us.gauge_set), 92)
        for frame in (us.code_reader, us.gauge_set):
            self.assertTrue((frame["type"] == "").all())
            self.assertTrue(frame["type_confidence"].isna().all())
            self.assertTrue(frame["url"].str.startswith("https://amazon.com/dp/").all())
        self.assertEqual(len(us.audits["type_decisions"]), 0)

    def test_nothing_written_under_new_product_dir(self):
        after = _snapshot(NEW_PRODUCT_DIR / "CA-CODE-READER") | _snapshot(NEW_PRODUCT_DIR / "CA-OBD-GAUGE")
        self.assertEqual(after, self.before)
        self.assertTrue(str(RUNS).startswith(str(SCRATCH_DIR)))


if __name__ == "__main__":
    unittest.main()
