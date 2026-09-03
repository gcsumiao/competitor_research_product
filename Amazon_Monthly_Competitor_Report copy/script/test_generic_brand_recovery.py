#!/usr/bin/env python3
from __future__ import annotations

import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

import pandas as pd

import full_report_month
from full_report_month import (
    GENERIC_BRAND_RECOVERY_AUDIT_COLUMNS,
    _build_generic_recovery_vocabulary,
    _generic_brand_recovery_is_active,
    _process_generic_brand_recovery_month,
    _recover_generic_brands,
)


class GenericBrandRecoveryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.vocabulary = _build_generic_recovery_vocabulary(
            [
                pd.DataFrame(
                    {
                        "Brand": [
                            "foxwell",
                            "bmw",
                            "innova",
                            "blcktec",
                            "acme",
                            "acme labs",
                            "scanner",
                        ]
                    }
                )
            ]
        )

    @staticmethod
    def _frame(*rows: dict) -> pd.DataFrame:
        defaults = {
            "ASIN": "TESTASIN",
            "Title": "",
            "Brand": "generic",
            "Type": "Handheld",
            "Monthly Sales": 7,
            "Monthly Revenue": 699.93,
        }
        return pd.DataFrame([{**defaults, **row} for row in rows])

    @staticmethod
    def _audit_row(**overrides) -> dict:
        defaults = {
            "month": "202608",
            "asin": "TESTASIN",
            "title": "FOXWELL NT530 scanner",
            "old_brand": "generic",
            "new_brand": "foxwell",
            "matched_text": "foxwell",
            "monthly_units": 7,
            "monthly_revenue": 699.93,
            "action": "reassigned",
        }
        return {**defaults, **overrides}

    @staticmethod
    def _write_audit(audit_path: Path, rows: list[dict]) -> None:
        audit_path.parent.mkdir(parents=True, exist_ok=True)
        pd.DataFrame(rows, columns=GENERIC_BRAND_RECOVERY_AUDIT_COLUMNS).to_csv(audit_path, index=False)

    def test_leading_single_token_brand_recovers_but_mid_title_brand_does_not(self) -> None:
        frame = self._frame(
            {"ASIN": "LEADING", "Title": "FOXWELL NT530 Plus for BMW - All Systems"},
            {"ASIN": "MIDTITLE", "Title": "Diagnostic scanner for BMW vehicles"},
        )

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        rows = recovered.set_index("ASIN")
        self.assertEqual(rows.at["LEADING", "Brand"], "foxwell")
        self.assertEqual(rows.at["MIDTITLE", "Brand"], "generic")
        self.assertEqual(audit["asin"].tolist(), ["LEADING"])

    def test_blocked_actuals_brand_rows_are_removed_and_audited(self) -> None:
        frame = self._frame(
            {"ASIN": "INN", "Title": "INNOVA 5610 Bidirectional Scan Tool"},
            {"ASIN": "BLK", "Title": "BLCKTEC 440 Bluetooth Scanner"},
        )

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertTrue(recovered.empty)
        self.assertEqual(audit["action"].tolist(), ["removed_actuals_brand_row"] * 2)
        self.assertEqual(audit["matched_text"].tolist(), ["innova", "blcktec"])
        self.assertEqual(audit["new_brand"].tolist(), ["generic", "generic"])

    def test_blocked_first_token_brand_is_removed_without_blocking_similar_tokens(self) -> None:
        vocabulary = _build_generic_recovery_vocabulary(
            [
                pd.DataFrame(
                    {
                        "Brand": [
                            "Innova Electronics",
                            "Innovate Motorsports",
                            "Innovative Products of America",
                        ]
                    }
                )
            ]
        )
        frame = self._frame(
            {"ASIN": "INN", "Title": "Innova Electronics 5610 Bidirectional Scan Tool"},
            {"ASIN": "INNOVATE", "Title": "Innovate Motorsports gauge kit"},
        )

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=vocabulary)

        self.assertNotIn("innova electronics", vocabulary)
        self.assertEqual(vocabulary["innovate motorsports"], "innovate motorsports")
        self.assertEqual(vocabulary["innovative products of america"], "innovative products of america")
        self.assertEqual(recovered["ASIN"].tolist(), ["INNOVATE"])
        self.assertEqual(recovered.at[0, "Brand"], "innovate motorsports")
        self.assertEqual(audit["action"].tolist(), ["removed_actuals_brand_row", "reassigned"])
        self.assertEqual(audit["matched_text"].tolist(), ["innova", "innovate motorsports"])

    def test_raw_blocked_brand_survives_alias_resolution(self) -> None:
        with patch.dict(full_report_month.BRAND_ALIASES, {"innova": ""}, clear=True):
            recovered, audit = _recover_generic_brands(
                self._frame({"Title": "INNOVA 5610 scan tool"}),
                month="202608",
                vocabulary=_build_generic_recovery_vocabulary([]),
            )

        self.assertTrue(recovered.empty)
        self.assertEqual(audit.at[0, "action"], "removed_actuals_brand_row")
        self.assertEqual(audit.at[0, "matched_text"], "innova")

    def test_month_gate_leaves_202607_untouched_and_writes_no_audit(self) -> None:
        frame = self._frame({"Title": "INNOVA 5610 Bidirectional Scan Tool"})
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "runs" / "202607" / "generic_brand_recovery.csv"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                recovered = _process_generic_brand_recovery_month(
                    frame,
                    month="202607",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

            pd.testing.assert_frame_equal(recovered, frame)
            self.assertFalse(audit_path.exists())
            self.assertEqual(stdout.getvalue(), "")

    def test_unparseable_month_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            _generic_brand_recovery_is_active("not-a-month")

    def test_extra_brands_recover_without_window_brand_values(self) -> None:
        frame = self._frame(
            {"ASIN": "NEX", "Title": "NEXIQ USB Link 3"},
            {"ASIN": "TEM", "Title": "TEMEDA PT 30 ELD"},
        )

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertEqual(recovered["Brand"].tolist(), ["nexiq", "temeda"])
        self.assertEqual(audit["matched_text"].tolist(), ["nexiq", "temeda"])

    def test_extra_brand_canonicalizing_to_blocked_brand_is_not_added(self) -> None:
        with (
            patch.object(full_report_month, "GENERIC_RECOVERY_EXTRA_BRANDS", {"innova", "innova alias", "safe"}),
            patch.dict(full_report_month.BRAND_ALIASES, {"innova alias": "innova"}, clear=True),
        ):
            vocabulary = _build_generic_recovery_vocabulary([])
            recovered, audit = _recover_generic_brands(
                self._frame({"Title": "INNOVA Alias diagnostic tool"}),
                month="202608",
                vocabulary=vocabulary,
            )

        self.assertEqual(vocabulary, {"safe": "safe"})
        self.assertTrue(recovered.empty)
        self.assertEqual(audit.at[0, "action"], "removed_actuals_brand_row")
        self.assertEqual(audit.at[0, "matched_text"], "innova alias")

    def test_multiword_brand_uses_longest_leading_match(self) -> None:
        frame = self._frame({"Title": "Original ACME Labs Professional Scanner"})

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertEqual(recovered.at[0, "Brand"], "acme labs")
        self.assertEqual(audit.at[0, "matched_text"], "acme labs")

    def test_stopword_brand_is_not_recovered(self) -> None:
        frame = self._frame({"Title": "Scanner Professional OBD2 Tool"})

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertEqual(recovered.at[0, "Brand"], "generic")
        self.assertTrue(audit.empty)

    def test_year_and_ignorable_prefixes_can_precede_brand(self) -> None:
        frame = self._frame({"Title": "2026 New Upgraded FOXWELL NT530 scanner"})

        recovered, _ = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertEqual(recovered.at[0, "Brand"], "foxwell")

    def test_trailing_punctuation_is_stripped_and_carryover_row_recovers(self) -> None:
        frame = self._frame({"Title": "TEMEDA- PT 30 ELD", "_Carryover Zero": True})

        recovered, _ = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertEqual(recovered.at[0, "Brand"], "temeda")
        self.assertTrue(bool(recovered.at[0, "_Carryover Zero"]))

    def test_non_generic_rows_are_never_modified(self) -> None:
        frame = self._frame({"Title": "FOXWELL NT530 scanner", "Brand": "Autel"})

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        pd.testing.assert_frame_equal(recovered, frame)
        self.assertTrue(audit.empty)

    def test_duplicate_index_does_not_drop_unrelated_non_generic_row(self) -> None:
        frame = self._frame(
            {"ASIN": "INN", "Title": "INNOVA 5610 scan tool"},
            {"ASIN": "KEEP", "Title": "Autel MaxiSys", "Brand": "Autel"},
        )
        frame.index = [0, 0]

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        self.assertEqual(recovered.index.tolist(), [0])
        self.assertEqual(recovered["ASIN"].tolist(), ["KEEP"])
        self.assertEqual(recovered["Brand"].tolist(), ["Autel"])
        self.assertEqual(audit["asin"].tolist(), ["INN"])

    def test_recovery_is_idempotent(self) -> None:
        frame = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "INN", "Title": "INNOVA 5610 scan tool"},
        )

        once, first_audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)
        twice, second_audit = _recover_generic_brands(once, month="202608", vocabulary=self.vocabulary)

        pd.testing.assert_frame_equal(twice, once)
        self.assertEqual(first_audit["action"].tolist(), ["reassigned", "removed_actuals_brand_row"])
        self.assertTrue(second_audit.empty)

    def test_market_totals_change_only_by_exactly_removed_rows(self) -> None:
        frame = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner", "Monthly Sales": 2, "Monthly Revenue": 499.98},
            {"ASIN": "INN", "Title": "INNOVA 5610 scan tool", "Monthly Sales": 3, "Monthly Revenue": 899.97},
            {"ASIN": "BLK", "Title": "BLCKTEC 440 scanner", "Monthly Sales": 5, "Monthly Revenue": 1299.95},
            {"ASIN": "GEN", "Title": "Hinson HPT Bundle", "Monthly Sales": 7, "Monthly Revenue": 1499.93},
        )

        recovered, audit = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)
        removed = audit[audit["action"].eq("removed_actuals_brand_row")]

        self.assertEqual(recovered["ASIN"].tolist(), ["FOX", "GEN"])
        self.assertAlmostEqual(
            recovered["Monthly Revenue"].sum(),
            frame["Monthly Revenue"].sum() - removed["monthly_revenue"].sum(),
        )
        self.assertEqual(
            recovered["Monthly Sales"].sum(),
            frame["Monthly Sales"].sum() - removed["monthly_units"].sum(),
        )

        reassigned_only = frame.iloc[[0, 3]].copy()
        reassigned_result, _ = _recover_generic_brands(
            reassigned_only,
            month="202608",
            vocabulary=self.vocabulary,
        )
        self.assertEqual(reassigned_result["Monthly Revenue"].sum(), reassigned_only["Monthly Revenue"].sum())
        self.assertEqual(reassigned_result["Monthly Sales"].sum(), reassigned_only["Monthly Sales"].sum())

    def test_audit_csv_has_required_columns_and_actions(self) -> None:
        frame = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner", "Monthly Sales": 2, "Monthly Revenue": 499.98},
            {"ASIN": "INN", "Title": "INNOVA 5610 scan tool", "Monthly Sales": 3, "Monthly Revenue": 899.97},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "runs" / "202608" / "generic_brand_recovery.csv"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                recovered = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )
            audit = pd.read_csv(audit_path)

        self.assertEqual(audit.columns.tolist(), GENERIC_BRAND_RECOVERY_AUDIT_COLUMNS)
        self.assertEqual(audit["action"].tolist(), ["reassigned", "removed_actuals_brand_row"])
        self.assertEqual(audit.loc[0, "new_brand"], "foxwell")
        self.assertEqual(audit.loc[1, "new_brand"], "generic")
        self.assertEqual(audit["monthly_units"].tolist(), [2, 3])
        self.assertEqual(audit["monthly_revenue"].tolist(), [499.98, 899.97])
        self.assertEqual(recovered["Brand"].tolist(), ["foxwell"])
        self.assertEqual(
            stdout.getvalue(),
            "Generic brand recovery 202608 (derived): reassigned=1, removed=1, mismatches=0, "
            "unfrozen_candidates=0, revenue_moved=499.98, revenue_removed=899.97\n",
        )

    def test_derive_then_replay_ignores_changed_vocabulary_and_preserves_csv_bytes(self) -> None:
        frame = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "HIN", "Title": "Hinson HPT Bundle"},
            {"ASIN": "INN", "Title": "INNOVA 5610 scan tool"},
        )
        changed_vocabulary = {**self.vocabulary, "hinson": "hinson"}
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "script" / "runs" / "202608" / "generic_brand_recovery.csv"
            with redirect_stdout(io.StringIO()):
                derived = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )
            frozen_bytes = audit_path.read_bytes()
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=changed_vocabulary,
                    audit_path=audit_path,
                )

            pd.testing.assert_frame_equal(replayed, derived)
            self.assertEqual(audit_path.read_bytes(), frozen_bytes)
            self.assertIn("Generic brand recovery 202608 (replayed):", stdout.getvalue())
            self.assertEqual(replayed.set_index("ASIN").at["HIN", "Brand"], "generic")

    def test_replay_validates_and_canonicalizes_new_brand(self) -> None:
        frame = self._frame(
            {"ASIN": "BLOCKED", "Title": "FOXWELL blocked target"},
            {"ASIN": "EMPTY", "Title": "FOXWELL empty target"},
            {"ASIN": "GENERIC", "Title": "FOXWELL generic target"},
            {"ASIN": "VALID", "Title": "FOXWELL valid target"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            self._write_audit(
                audit_path,
                [
                    self._audit_row(asin="BLOCKED", new_brand="innova"),
                    self._audit_row(asin="EMPTY", new_brand=""),
                    self._audit_row(asin="GENERIC", new_brand="generic"),
                    self._audit_row(asin="VALID", new_brand="Foxwell"),
                ],
            )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        rows = replayed.set_index("ASIN")
        self.assertEqual(rows.at["BLOCKED", "Brand"], "generic")
        self.assertEqual(rows.at["EMPTY", "Brand"], "generic")
        self.assertEqual(rows.at["GENERIC", "Brand"], "generic")
        self.assertEqual(rows.at["VALID", "Brand"], "foxwell")
        lines = stdout.getvalue().splitlines()
        self.assertEqual(sum("reason=invalid_new_brand" in line for line in lines), 3)
        self.assertIn("reassigned=1, removed=0, mismatches=3, unfrozen_candidates=0", lines[-1])

    def test_replay_reports_manual_audit_unfrozen_blocked_candidate_without_applying_it(self) -> None:
        frame = self._frame(
            {"ASIN": "FROZEN", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "UNFROZEN", "Title": "INNOVA 5610 scan tool"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            self._write_audit(audit_path, [self._audit_row(asin="FROZEN")])
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        rows = replayed.set_index("ASIN")
        self.assertEqual(rows.at["FROZEN", "Brand"], "foxwell")
        self.assertEqual(rows.at["UNFROZEN", "Brand"], "generic")
        output = stdout.getvalue()
        self.assertIn("unfrozen_candidates=1", output)
        self.assertIn("1 generic rows would match under the current vocabulary", output)
        self.assertIn("UNFROZEN", output)

    def test_subset_derive_then_superset_replay_reports_unfrozen_candidate(self) -> None:
        subset = self._frame({"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"})
        superset = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "TEM", "Title": "TEMEDA PT 30 ELD"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            with redirect_stdout(io.StringIO()):
                _process_generic_brand_recovery_month(
                    subset,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    superset,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        self.assertEqual(replayed.set_index("ASIN").at["TEM", "Brand"], "generic")
        self.assertIn("unfrozen_candidates=1", stdout.getvalue())
        self.assertIn("TEM", stdout.getvalue())

    def test_faithful_replay_has_zero_unfrozen_candidates_and_no_warning(self) -> None:
        frame = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "INN", "Title": "INNOVA 5610 scan tool"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            with redirect_stdout(io.StringIO()):
                derived = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        pd.testing.assert_frame_equal(replayed, derived)
        self.assertIn("unfrozen_candidates=0", stdout.getvalue())
        self.assertNotIn("WARNING: GENERIC BRAND RECOVERY REPLAY month=", stdout.getvalue())

    def test_zero_byte_audit_fails_loud_with_rederive_remedy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            audit_path.write_bytes(b"")
            with self.assertRaises(SystemExit) as raised:
                _process_generic_brand_recovery_month(
                    self._frame({"Title": "FOXWELL NT530 scanner"}),
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        self.assertIn(str(audit_path), str(raised.exception))
        self.assertIn("delete it to re-derive", str(raised.exception))

    def test_audit_missing_action_fails_loud_with_rederive_remedy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            pd.DataFrame([{"asin": "FOX", "new_brand": "foxwell"}]).to_csv(audit_path, index=False)
            with self.assertRaises(SystemExit) as raised:
                _process_generic_brand_recovery_month(
                    self._frame({"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"}),
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        self.assertIn(str(audit_path), str(raised.exception))
        self.assertIn("action", str(raised.exception))
        self.assertIn("delete it to re-derive", str(raised.exception))

    def test_audit_missing_monthly_revenue_replays_with_zero_revenue_total(self) -> None:
        frame = self._frame({"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"})
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            pd.DataFrame(
                [
                    {
                        "month": "202608",
                        "asin": "FOX",
                        "new_brand": "Foxwell",
                        "monthly_units": 7,
                        "action": "reassigned",
                    }
                ]
            ).to_csv(audit_path, index=False)
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        self.assertEqual(replayed.at[0, "Brand"], "foxwell")
        self.assertIn("revenue_moved=0.00", stdout.getvalue())

    def test_unknown_and_blank_actions_warn_once_each(self) -> None:
        frame = self._frame(
            {"ASIN": "UNKNOWN", "Title": "FOXWELL unknown action"},
            {"ASIN": "BLANK", "Title": "FOXWELL blank action"},
            {"ASIN": "VALID", "Title": "FOXWELL valid action"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            self._write_audit(
                audit_path,
                [
                    self._audit_row(asin="UNKNOWN", action="unexpected"),
                    self._audit_row(asin="BLANK", action=""),
                    self._audit_row(asin="VALID"),
                ],
            )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        rows = replayed.set_index("ASIN")
        self.assertEqual(rows.at["UNKNOWN", "Brand"], "generic")
        self.assertEqual(rows.at["BLANK", "Brand"], "generic")
        self.assertEqual(rows.at["VALID", "Brand"], "foxwell")
        self.assertEqual(stdout.getvalue().count("reason=unknown_action"), 2)
        self.assertIn("mismatches=2", stdout.getvalue())

    def test_decision_month_mismatch_warns_and_skips(self) -> None:
        frame = self._frame(
            {"ASIN": "WRONG", "Title": "FOXWELL wrong month"},
            {"ASIN": "VALID", "Title": "FOXWELL valid month"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            self._write_audit(
                audit_path,
                [
                    self._audit_row(month="202607", asin="WRONG"),
                    self._audit_row(asin="VALID"),
                ],
            )
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        rows = replayed.set_index("ASIN")
        self.assertEqual(rows.at["WRONG", "Brand"], "generic")
        self.assertEqual(rows.at["VALID", "Brand"], "foxwell")
        self.assertIn("asin=WRONG, reason=month_mismatch", stdout.getvalue())
        self.assertIn("mismatches=1", stdout.getvalue())

    def test_all_digit_asin_keeps_leading_zero_during_replay(self) -> None:
        frame = self._frame({"ASIN": "0012345678", "Title": "FOXWELL numeric ASIN"})
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            self._write_audit(audit_path, [self._audit_row(asin="0012345678")])
            with redirect_stdout(io.StringIO()):
                replayed = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

        self.assertEqual(replayed.at[0, "Brand"], "foxwell")

    def test_replay_mismatches_warn_once_each_and_other_decisions_still_apply(self) -> None:
        source = self._frame(
            {"ASIN": "MISSING", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "NONGENERIC", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "DUP", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "APPLY", "Title": "FOXWELL NT530 scanner"},
        )
        replay_frame = self._frame(
            {"ASIN": "NONGENERIC", "Title": "FOXWELL NT530 scanner", "Brand": "Autel"},
            {"ASIN": "DUP", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "DUP", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "APPLY", "Title": "FOXWELL NT530 scanner"},
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "script" / "runs" / "202608" / "generic_brand_recovery.csv"
            with redirect_stdout(io.StringIO()):
                _process_generic_brand_recovery_month(
                    source,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )
            frozen_bytes = audit_path.read_bytes()
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                replayed = _process_generic_brand_recovery_month(
                    replay_frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )

            self.assertEqual(audit_path.read_bytes(), frozen_bytes)

        rows = replayed.set_index("ASIN")
        self.assertEqual(rows.at["NONGENERIC", "Brand"], "Autel")
        self.assertEqual(rows.loc["DUP", "Brand"].tolist(), ["generic", "generic"])
        self.assertEqual(rows.at["APPLY", "Brand"], "foxwell")
        lines = stdout.getvalue().splitlines()
        self.assertEqual(sum("WARNING: GENERIC BRAND RECOVERY REPLAY MISMATCH" in line for line in lines), 3)
        self.assertTrue(any("asin=MISSING, reason=missing_from_frame" in line for line in lines))
        self.assertTrue(any("asin=NONGENERIC, reason=no_longer_generic" in line for line in lines))
        self.assertTrue(any("asin=DUP, reason=duplicated_in_frame" in line for line in lines))
        self.assertIn("reassigned=1, removed=0, mismatches=3", lines[-1])

    def test_frozen_audit_makes_base_and_extra_frame_vocabularies_identical(self) -> None:
        frame = self._frame(
            {"ASIN": "FOX", "Title": "FOXWELL NT530 scanner"},
            {"ASIN": "HIN", "Title": "Hinson HPT Bundle"},
        )
        base_window = pd.DataFrame({"Brand": ["foxwell"]})
        base_vocabulary = _build_generic_recovery_vocabulary([base_window])
        expanded_vocabulary = _build_generic_recovery_vocabulary(
            [base_window, pd.DataFrame({"Brand": ["hinson"]})]
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "script" / "runs" / "202608" / "generic_brand_recovery.csv"
            with redirect_stdout(io.StringIO()):
                _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=base_vocabulary,
                    audit_path=audit_path,
                )
            frozen_bytes = audit_path.read_bytes()
            with redirect_stdout(io.StringIO()):
                base_result = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=base_vocabulary,
                    audit_path=audit_path,
                )
            base_audit_bytes = audit_path.read_bytes()
            with redirect_stdout(io.StringIO()):
                expanded_result = _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=expanded_vocabulary,
                    audit_path=audit_path,
                )

            pd.testing.assert_frame_equal(expanded_result, base_result)
            self.assertEqual(base_audit_bytes, frozen_bytes)
            self.assertEqual(audit_path.read_bytes(), frozen_bytes)

    def test_main_loop_wiring_shape_gates_history_and_keeps_mid_title_blocked_text(self) -> None:
        markets = [
            self._frame({"ASIN": "JUL", "Title": "TEMEDA PT 30 ELD"}),
            self._frame(
                {"ASIN": "AUG", "Title": "TEMEDA PT 30 ELD"},
                {"ASIN": "CASE", "Title": "Case for Innova 5610 Scan Tool"},
            ),
        ]
        originals = [frame.copy(deep=True) for frame in markets]
        vocabulary = _build_generic_recovery_vocabulary(markets)
        history = ["202607", "202608"]
        with tempfile.TemporaryDirectory() as tmp:
            base_dir = Path(tmp)
            with redirect_stdout(io.StringIO()):
                for idx, month in enumerate(history):
                    markets[idx] = _process_generic_brand_recovery_month(
                        markets[idx],
                        month=month,
                        vocabulary=vocabulary,
                        audit_path=base_dir / "script" / "runs" / month / "generic_brand_recovery.csv",
                    )

            self.assertFalse((base_dir / "script" / "runs" / "202607" / "generic_brand_recovery.csv").exists())
            audit_path = base_dir / "script" / "runs" / "202608" / "generic_brand_recovery.csv"
            self.assertTrue(audit_path.exists())
            audit = pd.read_csv(audit_path)

        pd.testing.assert_frame_equal(markets[0], originals[0])
        self.assertFalse(markets[1].equals(originals[1]))
        rows = markets[1].set_index("ASIN")
        self.assertEqual(rows.at["AUG", "Brand"], "temeda")
        self.assertEqual(rows.at["CASE", "Brand"], "generic")
        self.assertEqual(audit["asin"].tolist(), ["AUG"])

    def test_audit_metrics_are_numeric_before_write_and_summary(self) -> None:
        frame = self._frame(
            {
                "ASIN": "FOX",
                "Title": "FOXWELL NT530 scanner",
                "Monthly Sales": "1,234",
                "Monthly Revenue": "$12,345.67",
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            audit_path = Path(tmp) / "generic_brand_recovery.csv"
            stdout = io.StringIO()
            with redirect_stdout(stdout):
                _process_generic_brand_recovery_month(
                    frame,
                    month="202608",
                    vocabulary=self.vocabulary,
                    audit_path=audit_path,
                )
            audit = pd.read_csv(audit_path)

        self.assertEqual(audit.at[0, "monthly_units"], 1234)
        self.assertEqual(audit.at[0, "monthly_revenue"], 12345.67)
        self.assertIn("revenue_moved=12,345.67", stdout.getvalue())

    def test_only_brand_changes(self) -> None:
        frame = self._frame(
            {
                "Title": "FOXWELL NT530 scanner",
                "Type": "Tablet",
                "Monthly Sales": 123,
                "Monthly Revenue": 45678.91,
            }
        )
        recovered, _ = _recover_generic_brands(frame, month="202608", vocabulary=self.vocabulary)

        pd.testing.assert_frame_equal(
            recovered.drop(columns=["Brand"]),
            frame.drop(columns=["Brand"]),
            check_exact=True,
        )
        self.assertEqual(recovered.at[0, "Brand"], "foxwell")


if __name__ == "__main__":
    unittest.main()
