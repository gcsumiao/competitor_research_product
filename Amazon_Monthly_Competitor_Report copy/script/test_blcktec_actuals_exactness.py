#!/usr/bin/env python3
from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

import pandas as pd

import full_report_month
from full_report_month import _apply_actuals, _read_blcktec


class BlcktecActualsExactnessTest(unittest.TestCase):
    @staticmethod
    def _write_model_actuals(path: Path, rows: list[tuple[str, int, float]], month: str = "202608") -> None:
        period = pd.Period(month, freq="M")
        date_range = f"{period.start_time:%m/%d/%Y} - {period.end_time:%m/%d/%Y}"
        workbook_rows = [
            [date_range, None, None],
            ["Model", "Unit Sold", "Revenue"],
            *rows,
            ["Total", sum(row[1] for row in rows), sum(row[2] for row in rows)],
        ]
        pd.DataFrame(workbook_rows).to_excel(path, header=False, index=False)

    @staticmethod
    def _market_row(
        asin: str,
        title: str,
        brand: str,
        monthly_sales: int,
        monthly_revenue: float,
    ) -> dict:
        return {
            "ASIN": asin,
            "Title": title,
            "Brand": brand,
            "Monthly Sales": monthly_sales,
            "Monthly Revenue": monthly_revenue,
            "Price": monthly_revenue / monthly_sales if monthly_sales else 0,
        }

    def _drop_unmatched(
        self,
        market: pd.DataFrame,
        actuals: pd.DataFrame,
        *,
        month: str,
        audit_path: Path,
    ) -> pd.DataFrame:
        return full_report_month._drop_unmatched_blcktec_rows(
            market,
            actuals,
            month=month,
            audit_path=audit_path,
        )

    def test_duplicate_code_maps_to_highest_raw_revenue_asin(self) -> None:
        market = pd.DataFrame(
            [
                self._market_row("LOW420", "BLCKTEC 420 carryover", "BLCKTEC", 0, 0.0),
                self._market_row("HIGH420", "BLCKTEC 420 scan tool", "blcktec", 401, 16159.92),
            ]
        )

        with tempfile.TemporaryDirectory() as tmp:
            actuals_path = Path(tmp) / "blcktec202608.xlsx"
            self._write_model_actuals(actuals_path, [("420", 354, 14211.27)])
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                actuals = _read_blcktec(actuals_path, month="202608", market_df_for_mapping=market)

        self.assertEqual(actuals["ASIN"].tolist(), ["HIGH420"])
        self.assertIn("code=420", stdout.getvalue())
        self.assertIn("chosen_asin=HIGH420", stdout.getvalue())
        self.assertIn("losing_asins=LOW420", stdout.getvalue())

    def test_unmapped_workbook_code_raises_with_code_revenue_and_units(self) -> None:
        market = pd.DataFrame(
            [self._market_row("ASIN400", "BLCKTEC 400 scanner", "blcktec", 1, 1000.0)]
        )

        with tempfile.TemporaryDirectory() as tmp:
            actuals_path = Path(tmp) / "blcktec202608.xlsx"
            self._write_model_actuals(
                actuals_path,
                [("400", 10, 1000.0), ("420XL", 20, 5000.0)],
            )
            with self.assertRaises(KeyError) as caught:
                _read_blcktec(actuals_path, month="202608", market_df_for_mapping=market)

        message = str(caught.exception)
        self.assertIn("420XL", message)
        self.assertIn("revenue=5,000.00", message)
        self.assertIn("units=20", message)

    def test_unmatched_blcktec_is_dropped_audited_and_total_matches_actuals(self) -> None:
        market = pd.DataFrame(
            [
                self._market_row("MATCH", "BLCKTEC 400", "blcktec", 1, 10.0),
                self._market_row("EXTRA", "BLCKTEC extra row", "BLCKTEC", 5, 50.25),
            ]
        )
        actuals = pd.DataFrame(
            [{"ASIN": "MATCH", "Monthly Sales": 10, "Monthly Revenue": 100.75}]
        )

        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "runs" / "202608" / "blcktec_unmatched_dropped.csv"
            overlaid = _apply_actuals(market, actuals, "blcktec")
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                out = self._drop_unmatched(overlaid, actuals, month="202608", audit_path=audit_path)
            audit = pd.read_csv(audit_path, dtype={"asin": str})

        self.assertEqual(out["ASIN"].tolist(), ["MATCH"])
        self.assertEqual(audit.to_dict("records"), [
            {
                "month": 202608,
                "asin": "EXTRA",
                "title": "BLCKTEC extra row",
                "raw_monthly_revenue": 50.25,
                "raw_monthly_units": 5,
            }
        ])
        self.assertEqual(out["Monthly Revenue"].sum(), actuals["Monthly Revenue"].sum())
        self.assertEqual(out["Monthly Sales"].sum(), actuals["Monthly Sales"].sum())
        self.assertIn("dropped=1, revenue_dropped=50.25", stdout.getvalue())

    def test_august_shape_is_exact_and_winning_420_asin_carries_actuals(self) -> None:
        model_actuals = [
            ("400", 500, 100000.01),
            ("410", 600, 80000.02),
            ("420", 354, 14211.27),
            ("420X", 400, 70000.03),
            ("430", 700, 90000.04),
            ("440", 500, 60000.05),
            ("460T", 543, 71689.26),
        ]
        market_rows = [
            self._market_row(f"ASIN{code}", f"BLCKTEC {code} scanner", "blcktec", 1, 1.0)
            for code, _, _ in model_actuals
        ]
        market_rows[2] = self._market_row(
            "B0BNGW4VF4", "BLCKTEC 420 scan tool", "blcktec", 401, 16159.92
        )
        market_rows.insert(
            2,
            self._market_row("B0GH817QMH", "BLCKTEC 420 carryover", "blcktec", 0, 0.0),
        )
        market = pd.DataFrame(market_rows)

        with tempfile.TemporaryDirectory() as tmp:
            actuals_path = Path(tmp) / "blcktec202608.xlsx"
            audit_path = Path(tmp) / "runs" / "202608" / "blcktec_unmatched_dropped.csv"
            self._write_model_actuals(actuals_path, model_actuals)
            with redirect_stdout(io.StringIO()):
                actuals = _read_blcktec(actuals_path, month="202608", market_df_for_mapping=market)
                overlaid = _apply_actuals(market, actuals, "blcktec")
                out = self._drop_unmatched(overlaid, actuals, month="202608", audit_path=audit_path)

        rows = out.set_index("ASIN")
        blcktec = out[out["Brand"].astype(str).str.casefold().str.strip().eq("blcktec")]
        self.assertAlmostEqual(actuals["Monthly Revenue"].sum(), 485900.68, places=2)
        self.assertEqual(actuals["Monthly Sales"].sum(), 3597)
        self.assertEqual(blcktec["Monthly Revenue"].sum(), actuals["Monthly Revenue"].sum())
        self.assertEqual(blcktec["Monthly Sales"].sum(), actuals["Monthly Sales"].sum())
        self.assertNotIn("B0GH817QMH", rows.index)
        self.assertEqual(rows.at["B0BNGW4VF4", "Monthly Revenue"], 14211.27)
        self.assertEqual(rows.at["B0BNGW4VF4", "Monthly Sales"], 354)

    def test_innova_rows_are_completely_untouched(self) -> None:
        market = pd.DataFrame(
            [
                self._market_row("BLK", "BLCKTEC 400", "blcktec", 10, 100.0),
                self._market_row("DROP", "BLCKTEC unmatched", "blcktec", 2, 20.0),
                self._market_row("INN", "INNOVA 5610", "Innova", 77, 7777.77),
            ]
        )
        actuals = pd.DataFrame(
            [{"ASIN": "BLK", "Monthly Sales": 9, "Monthly Revenue": 99.0}]
        )
        expected_innova = market.loc[market["ASIN"].eq("INN")].copy()

        with tempfile.TemporaryDirectory() as tmp:
            with redirect_stdout(io.StringIO()):
                out = self._drop_unmatched(
                    market,
                    actuals,
                    month="202608",
                    audit_path=Path(tmp) / "blcktec_unmatched_dropped.csv",
                )

        pd.testing.assert_frame_equal(out.loc[out["ASIN"].eq("INN")], expected_innova)

    def test_empty_actuals_skips_drop_and_csv(self) -> None:
        market = pd.DataFrame(
            [self._market_row("RAWBLK", "BLCKTEC raw row", "blcktec", 12, 345.67)]
        )
        actuals = pd.DataFrame(columns=["ASIN", "Monthly Sales", "Monthly Revenue"])

        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "runs" / "202608" / "blcktec_unmatched_dropped.csv"
            audit_path.parent.mkdir(parents=True)
            audit_path.write_text("stale audit\n", encoding="utf-8")
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                out = self._drop_unmatched(market, actuals, month="202608", audit_path=audit_path)
            self.assertFalse(audit_path.exists())
            self.assertEqual(
            stdout.getvalue(),
            "WARNING: BLCKTEC actuals empty for 202608; exactness not enforced.\n",
        )

        pd.testing.assert_frame_equal(out, market)
        self.assertIsNot(out, market)

    def test_non_blcktec_brands_are_never_dropped(self) -> None:
        market = pd.DataFrame(
            [
                self._market_row("BLK", "BLCKTEC 400", "blcktec", 10, 100.0),
                self._market_row("OTHER", "Other brand scanner", "Other Brand", 33, 4444.44),
            ]
        )
        actuals = pd.DataFrame(
            [{"ASIN": "BLK", "Monthly Sales": 9, "Monthly Revenue": 99.0}]
        )
        expected_other = market.loc[market["ASIN"].eq("OTHER")].copy()

        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "blcktec_unmatched_dropped.csv"
            with redirect_stdout(io.StringIO()):
                out = self._drop_unmatched(
                    market,
                    actuals,
                    month="202608",
                    audit_path=audit_path,
                )
            audit = pd.read_csv(audit_path)

        pd.testing.assert_frame_equal(out.loc[out["ASIN"].eq("OTHER")], expected_other)
        self.assertTrue(audit.empty)
        self.assertEqual(audit.columns.tolist(), full_report_month.BLCKTEC_UNMATCHED_AUDIT_COLUMNS)


if __name__ == "__main__":
    unittest.main()
