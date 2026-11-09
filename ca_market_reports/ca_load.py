"""Helium 10 Black Box CSV -> normalized, deduped, brand-canonicalized, typed, tiered frames (+ freeze/replay audits).

Pipeline of load_month (one call per market/month):
  1. discover every *.csv under the code-reader and gauge raw dirs (lexical by relative path, AppleDouble '._*' skipped)
  2. read each file robustly (utf-8-sig, utf-8, cp1252, latin-1), columns BY NAME via H10_COLUMNS, normalize to
     BASE_ROW_COLUMNS (see _normalize_file for the per-field rules; Parent Level * columns are never read)
  3. dedupe each source with the frozen ordering (revenue DESC, bsr ASC NaN last, export_date ASC, relative path ASC,
     source row ASC); every multi-occurrence ASIN -> one DEDUPE_AUDIT_COLUMNS row; invalid ASINs -> 'bad_asin' rows
  4. brand_key / brand_display from maps/ca_brand_aliases.csv + maps/ca_brand_display.csv, then generic-brand recovery
  5. CA + assign_types: Type assignment on the code-reader frame (ca_types), frozen per (month, market, asin)
  6. CR price tiers (ca_tiers) on the code-reader frame. Gauge-set frames never get types or CR tiers.
Freeze/replay (freeze=True) reads and writes runs/<m>/<stem>_<market>_<source_set>_<m>.csv; freeze=False neither
replays nor writes (a pure derivation). Row references in audits are "<relative path>:<0-based data row index>".
"""
from __future__ import annotations

import hashlib
import logging
import re
import subprocess
from datetime import date, datetime
from pathlib import Path
from typing import Iterable

import numpy as np
import pandas as pd

from . import ca_brands, ca_tiers, ca_types
from .ca_common import (ASIN_RE, BASE_ROW_COLUMNS, BRAND_RECOVERY_COLUMNS, DEDUPE_AUDIT_COLUMNS, EXPORT_DATE_RE,
                        H10_COLUMNS, MAIN_CHECKOUT, MAPS_DIR, MARKETS, MONTH_RE, PACKAGE_ROOT, REPO_ROOT, RUNS_DIR,
                        TYPE_DECISIONS_COLUMNS, TYPE_REVIEW_COLUMNS, US_TYPE_MAP_DEFAULT, CaDataset, run_file)

LOG = logging.getLogger("ca_market_reports")

REQUIRED_H10: tuple[str, ...] = ("ASIN", "Title", "Brand", "Price", "ASIN Sales", "ASIN Revenue")
ENCODINGS: tuple[str, ...] = ("utf-8-sig", "utf-8", "cp1252", "latin-1")
ZERO_IF_MISSING: tuple[str, ...] = ("units_month", "revenue_month", "review_count", "rating", "list_price", "variation_count")
NAN_IF_MISSING: tuple[str, ...] = ("bsr", "subcategory_bsr", "last_year_units", "listing_age_months")
PCT_FIELDS: tuple[str, ...] = ("price_trend_90d_pct", "sales_trend_90d_pct", "yoy_units_pct")
TEXT_FIELDS: tuple[str, ...] = ("title", "brand_raw", "seller", "fulfillment", "category", "subcategory", "image_url")
MISSING_TOKENS = frozenset({"-", "n/a", ""})
_NUM_STRIP_RE = re.compile(r"[\$,%\s]")
BRAND_ALIASES_PATH = MAPS_DIR / "ca_brand_aliases.csv"
BRAND_DISPLAY_PATH = MAPS_DIR / "ca_brand_display.csv"
# normalized fields compared by union_gauge_frames to decide values_identical (everything sourced from H10 columns)
_H10_FIELDS: tuple[str, ...] = tuple(H10_COLUMNS)
_PRIVATE = ("_rel", "_row", "_sig")


# --------------------------------------------------------------------------------------------------------------------
# Discovery, hashing, run ids
# --------------------------------------------------------------------------------------------------------------------
def discover_raw_files(raw_dir: Path) -> list[Path]:
    """Every *.csv under raw_dir (recursive), sorted lexically by relative POSIX path; AppleDouble '._*' skipped."""
    raw_dir = Path(raw_dir)
    if not raw_dir.is_dir():
        raise FileNotFoundError(f"raw data dir not found: {raw_dir}")
    files = [p for p in raw_dir.rglob("*") if p.is_file() and p.suffix.lower() == ".csv" and not p.name.startswith("._")]
    return sorted(files, key=lambda p: p.relative_to(raw_dir).as_posix())


def _hash_key(p: Path) -> str:
    rp = p.resolve()
    for root in (REPO_ROOT.resolve(), MAIN_CHECKOUT.resolve()):
        try:
            return rp.relative_to(root).as_posix()
        except ValueError:
            continue
    return rp.as_posix()


def input_hashes(paths: Iterable[Path]) -> dict[str, str]:
    """{relative name -> sha256 hex}. Names are relative to the running checkout, else to the main checkout, else
    absolute, so two files with the same base name in different dirs never collapse (duplicates raise)."""
    out: dict[str, str] = {}
    for p in paths:
        p = Path(p)
        key = _hash_key(p)
        if key in out:
            raise ValueError(f"input_hashes: path listed twice: {key}")
        h = hashlib.sha256()
        with open(p, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        out[key] = h.hexdigest()
    return out


def _git_short_sha() -> str:
    try:
        r = subprocess.run(["git", "-C", str(PACKAGE_ROOT), "log", "-1", "--format=%h", "--", "."],
                           capture_output=True, text=True, timeout=15)
    except (OSError, subprocess.SubprocessError):
        return "nogit"
    sha = r.stdout.strip()
    return sha if r.returncode == 0 and re.fullmatch(r"[0-9a-f]{4,40}", sha) else "nogit"


def make_run_id(now: datetime | None = None) -> str:
    """<YYYYMMDD-HHMMSS>-<short sha of the last commit touching ca_market_reports, or 'nogit'>"""
    return f"{(now or datetime.now()).strftime('%Y%m%d-%H%M%S')}-{_git_short_sha()}"


# --------------------------------------------------------------------------------------------------------------------
# Reading + normalization
# --------------------------------------------------------------------------------------------------------------------
def _read_csv_robust(path: Path) -> pd.DataFrame:
    """All cells as str, nothing converted to NaN. Port of preprocess_month._read_csv_robust (no lossy 'replace' pass:
    latin-1 decodes any byte sequence, so the loop always returns)."""
    err: Exception | None = None
    for enc in ENCODINGS:
        try:
            return pd.read_csv(path, dtype=str, keep_default_na=False, na_filter=False, encoding=enc)
        except UnicodeDecodeError as e:
            err = e
    raise ValueError(f"{Path(path).name}: undecodable with {ENCODINGS}: {err}")


def parse_export_date(file_name: str) -> date:
    m = EXPORT_DATE_RE.search(file_name)
    if not m:
        raise ValueError(f"{file_name}: no export date (_YYYY-MM-DD) in the file name")
    try:
        return date.fromisoformat(m.group(1))
    except ValueError:
        raise ValueError(f"{file_name}: invalid export date {m.group(1)!r}") from None


def _parse_number(s: pd.Series | None, header: str, file_name: str, n: int, missing: float) -> pd.Series:
    """Strip $ , % and whitespace; '-', 'N/A', '' -> `missing`; anything else unparsable raises (file/row named)."""
    if s is None:
        return pd.Series(np.full(n, missing, dtype=float))
    cleaned = s.astype(str).str.replace(_NUM_STRIP_RE, "", regex=True)
    is_missing = cleaned.str.casefold().isin(MISSING_TOKENS)
    vals = pd.to_numeric(cleaned.where(~is_missing, None), errors="coerce")
    bad = vals.isna() & ~is_missing
    if bad.any():
        rows = list(np.flatnonzero(bad.to_numpy()))
        raise ValueError(f"{file_name}: column {header!r} has unparsable value(s) at data row(s) {rows[:10]}: "
                         f"{s[bad].head(10).tolist()}")
    return vals.astype(float).where(~is_missing, missing).reset_index(drop=True)


def _normalize_file(path: Path, raw_dir: Path, market: str, source_set: str) -> tuple[pd.DataFrame, int, date]:
    """One Helium 10 export -> BASE_ROW_COLUMNS rows (+ private _rel/_row/_sig used by the dedupe)."""
    name = path.name
    export_date = parse_export_date(name)
    raw = _read_csv_robust(path)
    raw.columns = [str(c).strip() for c in raw.columns]
    missing = [c for c in REQUIRED_H10 if c not in raw.columns]
    if missing:
        raise ValueError(f"{name}: missing required Helium 10 column(s) {missing}")
    n = len(raw)
    mk = MARKETS[market]

    def col(field: str) -> pd.Series | None:
        header = H10_COLUMNS[field]
        return raw[header].astype(str).str.strip().reset_index(drop=True) if header in raw.columns else None

    out: dict[str, object] = {}
    out["asin"] = col("asin").str.upper()
    for f in TEXT_FIELDS:
        s = col(f)
        out[f] = s if s is not None else pd.Series([""] * n, dtype=object)
    for f in ZERO_IF_MISSING:
        out[f] = _parse_number(col(f), H10_COLUMNS[f], name, n, 0.0)
    for f in NAN_IF_MISSING:
        out[f] = _parse_number(col(f), H10_COLUMNS[f], name, n, np.nan)
    for f in PCT_FIELDS:
        out[f] = _parse_number(col(f), H10_COLUMNS[f], name, n, np.nan) / 100.0
    fr = col("frequently_returned")
    out["frequently_returned"] = fr.eq("Yes") if fr is not None else pd.Series(np.zeros(n, dtype=bool))
    units, revenue, list_price = out["units_month"], out["revenue_month"], out["list_price"]
    out["price"] = (revenue / units.where(units > 0)).where(units > 0, list_price)
    out["url"] = out["asin"].map(mk.url)
    out["export_date"] = export_date.isoformat()
    out["source_file"] = name
    out["source_set"] = source_set
    out["market"] = mk.code
    out["currency"] = mk.currency

    frame = pd.DataFrame({c: out[c] for c in out}, index=pd.RangeIndex(n))
    frame["brand_key"] = ""
    frame["brand_display"] = ""
    for c in ("type", "type_source", "type_rule_id", "gauge_class", "gauge_rule_id", "price_tier"):
        frame[c] = ""
    frame["type_confidence"] = np.nan
    frame["gauge_confidence"] = np.nan
    frame["gauge_in_scope"] = pd.Series([pd.NA] * n, dtype=object)
    frame["type_conflict"] = False
    frame = frame[list(BASE_ROW_COLUMNS)]
    frame["_rel"] = path.relative_to(raw_dir).as_posix()
    frame["_row"] = np.arange(n)
    present = [H10_COLUMNS[f] for f in _H10_FIELDS if H10_COLUMNS[f] in raw.columns]
    frame["_sig"] = raw[present].astype(str).apply(lambda r: "\x1f".join(v.strip() for v in r), axis=1).to_numpy() if n else []
    return frame, n, export_date


# --------------------------------------------------------------------------------------------------------------------
# Dedupe
# --------------------------------------------------------------------------------------------------------------------
_ORDER_COLS = ["revenue_month", "bsr", "export_date", "_rel", "_row"]
_ORDER_ASC = [False, True, True, True, True]


def _first_difference(w: pd.Series, r: pd.Series) -> str:
    if w["revenue_month"] != r["revenue_month"]:
        return "revenue"
    wb, rb = w["bsr"], r["bsr"]
    if not (pd.isna(wb) and pd.isna(rb)) and (pd.isna(wb) or pd.isna(rb) or wb != rb):
        return "bsr"
    if w["export_date"] != r["export_date"]:
        return "export_date"
    if w["_rel"] != r["_rel"]:
        return "path"
    return "row"


def _audit_row(market: str, source_set: str, asin: str, **kw) -> dict:
    row = dict.fromkeys(DEDUPE_AUDIT_COLUMNS, "")
    row.update(market=market, source_set=source_set, asin=asin)
    row.update(kw)
    return row


def _dedupe_source(frame: pd.DataFrame, market: str, source_set: str) -> tuple[pd.DataFrame, list[dict]]:
    audit: list[dict] = []
    bad = ~frame["asin"].str.fullmatch(ASIN_RE.pattern)
    for _, r in frame[bad].iterrows():
        audit.append(_audit_row(market, source_set, r["asin"], n_rows=1, chosen_file="", chosen_row="",
                                dropped=f"{r['_rel']}:{r['_row']}", values_identical=False, revenue_chosen=np.nan,
                                revenue_dropped_max=r["revenue_month"], units_diff=np.nan, price_diff=np.nan,
                                title_diff="", winning_rule="bad_asin"))
    if bad.any():
        LOG.warning("dedupe[%s/%s]: dropped %d row(s) with an invalid ASIN: %s", market, source_set, int(bad.sum()),
                    [f"{a!r}@{f}:{i}" for a, f, i in zip(frame.loc[bad, "asin"], frame.loc[bad, "_rel"], frame.loc[bad, "_row"])][:10])
    valid = frame[~bad]
    order = valid.sort_values(_ORDER_COLS, ascending=_ORDER_ASC, na_position="last", kind="mergesort")
    counts = order["asin"].value_counts()
    identical = conflicting = 0
    for asin, grp in order[order["asin"].isin(counts[counts > 1].index)].groupby("asin", sort=True):
        w, dropped = grp.iloc[0], grp.iloc[1:]
        same = grp["_sig"].nunique() == 1
        identical += same
        conflicting += not same
        audit.append(_audit_row(
            market, source_set, asin, n_rows=len(grp), chosen_file=w["_rel"], chosen_row=int(w["_row"]),
            dropped=";".join(f"{f}:{i}" for f, i in zip(dropped["_rel"], dropped["_row"])), values_identical=bool(same),
            revenue_chosen=float(w["revenue_month"]), revenue_dropped_max=float(dropped["revenue_month"].max()),
            units_diff=float(w["units_month"] - dropped["units_month"].max()),
            price_diff=float(w["price"] - dropped["price"].max()),
            title_diff="Y" if (dropped["title"] != w["title"]).any() else "N",
            winning_rule="identical" if same else _first_difference(w, grp.iloc[1])))
    winners = order.drop_duplicates("asin", keep="first").sort_values(["_rel", "_row"], kind="mergesort")
    LOG.info("dedupe[%s/%s]: rows=%d unique=%d identical=%d conflicting=%d", market, source_set, len(valid),
             len(winners), identical, conflicting)
    return winners.reset_index(drop=True), audit


def _load_source(raw_dir: Path, market: str, source_set: str) -> tuple[pd.DataFrame, list[dict], list[tuple[str, int]], list[date]]:
    files = discover_raw_files(raw_dir)
    if not files:
        raise ValueError(f"no CSV exports found in {raw_dir}")
    frames, raw_files, dates = [], [], []
    for p in files:
        frame, n, d = _normalize_file(p, Path(raw_dir), market, source_set)
        frames.append(frame)
        raw_files.append((p.name, n))
        dates.append(d)
    deduped, audit = _dedupe_source(pd.concat(frames, ignore_index=True), market, source_set)
    return deduped, audit, raw_files, dates


# --------------------------------------------------------------------------------------------------------------------
# Freeze helpers
# --------------------------------------------------------------------------------------------------------------------
def _yn(v) -> str:
    if isinstance(v, (bool, np.bool_)):
        return "Y" if v else "N"
    return v


def _write_csv(df: pd.DataFrame, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == bool or out[c].map(lambda v: isinstance(v, (bool, np.bool_))).any():
            out[c] = out[c].map(_yn)
    out.to_csv(path, index=False, lineterminator="\n")


def _read_frozen(path: Path, columns: tuple[str, ...]) -> pd.DataFrame:
    df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    if tuple(df.columns) != tuple(columns):
        raise ValueError(f"{path.name}: columns {list(df.columns)} != {list(columns)}")
    return df


def _dedupe_key(row) -> str:
    extra = row["dropped"] if row["winning_rule"] == "bad_asin" else ""
    return "\x1f".join((str(row["market"]), str(row["source_set"]), str(row["asin"]), str(extra)))


def _freeze_dedupe_audit(rows: list[dict], path: Path, rederive: bool) -> None:
    cur = pd.DataFrame(rows, columns=list(DEDUPE_AUDIT_COLUMNS))
    if path.exists() and not rederive:
        old = _read_frozen(path, DEDUPE_AUDIT_COLUMNS)
        cur_by_key = {_dedupe_key(r): r for _, r in cur.iterrows()}
        merged, seen = [], set()
        for _, r in old.iterrows():
            k = _dedupe_key(r)
            if k in cur_by_key:
                c = cur_by_key[k]
                if (str(c["chosen_file"]), str(c["chosen_row"])) != (r["chosen_file"], r["chosen_row"]):
                    LOG.warning("dedupe_audit: %s winner changed %s:%s -> %s:%s (inputs changed since the frozen run)",
                                r["asin"], r["chosen_file"], r["chosen_row"], c["chosen_file"], c["chosen_row"])
                merged.append(c.to_dict())
                seen.add(k)
            else:
                merged.append(r.to_dict())
        merged.extend(r.to_dict() for k, r in cur_by_key.items() if k not in seen)
        cur = pd.DataFrame(merged, columns=list(DEDUPE_AUDIT_COLUMNS))
    _write_csv(cur, path)


def _read_frozen_brand_recovery(path: Path, month: str, aliases: dict[str, str], tag: str) -> pd.DataFrame:
    fz = _read_frozen(path, BRAND_RECOVERY_COLUMNS)
    bad = fz[fz["month"] != month]
    if len(bad):
        raise ValueError(f"{path.name}: rows for another month: {bad[['month', 'asin']].head().to_dict('records')}")
    if fz["asin"].duplicated().any():
        raise ValueError(f"{path.name}: duplicate ASINs {sorted(set(fz.loc[fz['asin'].duplicated(), 'asin']))[:10]}")
    for c in ("monthly_units", "monthly_revenue"):
        try:
            fz[c] = pd.to_numeric(fz[c].replace("", np.nan), errors="raise").astype(float)
        except (ValueError, TypeError):
            raise ValueError(f"{path.name}: non-numeric {c}") from None
    for i, r in fz.iterrows():
        canon = ca_brands.canonical_brand_key(r["new_brand"], aliases)
        if canon != r["new_brand"]:
            LOG.warning("brand_recovery[%s]: alias map rewrites frozen decision %s: %r -> %r", tag, r["asin"], r["new_brand"], canon)
            fz.at[i, "new_brand"] = canon
    return fz


def _recover_and_freeze(frame: pd.DataFrame, vocabulary: set[str], display: dict[str, str], aliases: dict[str, str], *,
                        market: str, source_set: str, month: str, runs_dir: Path, freeze: bool,
                        rederive: bool) -> tuple[pd.DataFrame, pd.DataFrame]:
    tag = f"{market}/{source_set}"
    path = run_file(runs_dir, month, "brand_recovery", f"{market}_{source_set}")
    frozen = None
    if freeze and not rederive and path.exists():
        frozen = _read_frozen_brand_recovery(path, month, aliases, tag)
    out, audit = ca_brands.recover_generic_brands(frame, vocabulary, frozen, display=display, month=month)
    if not freeze:
        return out, audit
    applied = set(frozen["asin"]) & set(audit["asin"]) if frozen is not None else set()
    present = set(frame["asin"])
    kept_file_rows, dropped = [], 0
    if frozen is not None:
        for _, r in frozen.iterrows():
            if r["asin"] in applied:
                kept_file_rows.append(audit[audit["asin"] == r["asin"]].iloc[0].to_dict())
            elif r["asin"] not in present:
                kept_file_rows.append(r.to_dict())
            else:
                dropped += 1
                LOG.warning("brand_recovery[%s]: frozen decision for %s removed (brand data/map changed)", tag, r["asin"])
    new_rows = audit[~audit["asin"].isin(applied)]
    merged = pd.DataFrame(kept_file_rows + new_rows.to_dict("records"), columns=list(BRAND_RECOVERY_COLUMNS))
    _write_csv(merged, path)
    LOG.info("brand_recovery[%s]: replayed=%d unfrozen_candidates=%d removed=%d", tag, len(applied), len(new_rows), dropped)
    return out, audit


def _decisions_from(df: pd.DataFrame, month: str, market: str, run_id: str) -> pd.DataFrame:
    return pd.DataFrame({"month": month, "market": market, "asin": df["asin"].to_numpy(), "type": df["type"].to_numpy(),
                         "type_source": df["type_source"].to_numpy(), "type_rule_id": df["type_rule_id"].to_numpy(),
                         "type_confidence": df["type_confidence"].astype(float).to_numpy(),
                         "type_conflict": df["type_conflict"].astype(bool).to_numpy(), "run_id": run_id},
                        columns=list(TYPE_DECISIONS_COLUMNS))


def _replay_type_decisions(fresh: pd.DataFrame, overrides: dict[str, str], *, market: str, month: str, runs_dir: Path,
                           run_id: str, freeze: bool, rederive: bool) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Merge freshly derived types with the frozen decision file. Returns (typed frame, decisions for its rows)."""
    tag = f"{market}/code_reader"
    current = _decisions_from(fresh, month, market, run_id)
    if not freeze:
        return fresh, current
    path = run_file(runs_dir, month, "type_decisions", f"{market}_code_reader")
    if rederive or not path.exists():
        _write_csv(current, path)
        LOG.info("type_decisions[%s]: replayed=0 unfrozen_candidates=%d map_rewrites=0%s", tag, len(current),
                 " (rederive)" if rederive else "")
        return fresh, current

    frozen = ca_types.read_type_decisions(path)
    bad = frozen[(frozen["month"] != month) | (frozen["market"] != market)]
    if len(bad):
        raise ValueError(f"{path.name}: rows for another month/market: {bad[['month', 'market', 'asin']].head().to_dict('records')}")
    fz_by_asin = {r["asin"]: r for _, r in frozen.iterrows()}
    cur_by_asin = {r["asin"]: r for _, r in current.iterrows()}
    final: dict[str, dict] = {}
    replayed = rewrites = 0
    for asin, cur in cur_by_asin.items():
        fz = fz_by_asin.get(asin)
        if fz is None:
            final[asin] = cur.to_dict()
            continue
        ov = overrides.get(asin)
        if ov is not None and (fz["type"] != ov or fz["type_source"] != "override"):
            LOG.warning("type_decisions[%s]: override map rewrites frozen decision %s: %s/%s -> %s/override",
                        tag, asin, fz["type"], fz["type_source"], ov)
            final[asin] = cur.to_dict()
            rewrites += 1
            continue
        if ov is None and fz["type_source"] == "override":
            LOG.warning("type_decisions[%s]: %s frozen as override %r but no applicable map row remains; frozen decision "
                        "kept (rerun with rederive=True to drop it)", tag, asin, fz["type"])
        final[asin] = fz.to_dict()
        replayed += 1
    new_asins = [a for a in cur_by_asin if a not in fz_by_asin]
    merged = [final.get(a, fz_by_asin[a].to_dict()) for a in frozen["asin"]] + [final[a] for a in new_asins]
    _write_csv(pd.DataFrame(merged, columns=list(TYPE_DECISIONS_COLUMNS)), path)
    LOG.info("type_decisions[%s]: replayed=%d unfrozen_candidates=%d map_rewrites=%d", tag, replayed, len(new_asins), rewrites)

    decisions = pd.DataFrame([final[a] for a in fresh["asin"]], columns=list(TYPE_DECISIONS_COLUMNS))
    decisions["type_confidence"] = decisions["type_confidence"].astype(float)
    decisions["type_conflict"] = decisions["type_conflict"].astype(bool)
    out = fresh.copy()
    for c in ("type", "type_source", "type_rule_id", "type_confidence", "type_conflict"):
        out[c] = decisions[c].to_numpy()
    out["type_confidence"] = out["type_confidence"].astype(float)
    out["type_conflict"] = out["type_conflict"].astype(bool)
    return out, decisions


# --------------------------------------------------------------------------------------------------------------------
# Read-only replay (additive; the combined CA + US gauge workbook): the frozen decisions are READ and applied exactly as
# freeze=True / rederive=False would apply them, nothing is written, and every case in which that freeze would APPEND a
# decision or REWRITE a frozen row is collected as a problem -> FrozenDecisionError.
# --------------------------------------------------------------------------------------------------------------------
class FrozenDecisionError(RuntimeError):
    """A read-only replay found decisions a freeze would append or rewrite (frozen decisions incomplete or changed).
    problems = [(stem, asin, reason), ...] in discovery order."""

    def __init__(self, market: str, month: str, problems: list[tuple[str, str, str]]):
        self.market, self.month, self.problems = market, month, list(problems)
        first = "; ".join(f"{stem} {asin}: {why}" for stem, asin, why in self.problems[:10])
        super().__init__(f"{market} {month}: {len(self.problems)} frozen decision(s) missing or changed (first 10: {first})")


def _dedupe_drift_read_only(rows: list[dict], path: Path, stem_scope: str) -> list[tuple[str, str, str]]:
    """What _freeze_dedupe_audit (rederive=False) would change: no file, a new key, or a changed winner."""
    tag = f"dedupe_audit[{stem_scope}]"
    if not path.exists():
        return [(tag, "*", f"no frozen file {path.name}")]
    old = _read_frozen(path, DEDUPE_AUDIT_COLUMNS)
    old_by_key = {_dedupe_key(r): r for _, r in old.iterrows()}
    out = []
    for r in rows:
        k = _dedupe_key(r)
        fz = old_by_key.get(k)
        if fz is None:
            out.append((tag, str(r["asin"]), "no frozen dedupe row"))
        elif (str(r["chosen_file"]), str(r["chosen_row"])) != (fz["chosen_file"], fz["chosen_row"]):
            out.append((tag, str(r["asin"]), f"winner changed {fz['chosen_file']}:{fz['chosen_row']} -> {r['chosen_file']}:{r['chosen_row']}"))
    return out


def _replay_brand_recovery_read_only(frame: pd.DataFrame, vocabulary: set[str], display: dict[str, str], aliases: dict[str, str],
                                     *, market: str, source_set: str, month: str,
                                     runs_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, list[tuple[str, str, str]]]:
    """_recover_and_freeze (freeze=True, rederive=False) without the write: (frame, audit, problems)."""
    tag = f"brand_recovery[{market}_{source_set}]"
    path = run_file(runs_dir, month, "brand_recovery", f"{market}_{source_set}")
    if not path.exists():
        out, audit = ca_brands.recover_generic_brands(frame, vocabulary, None, display=display, month=month)
        return out, audit, [(tag, "*", f"no frozen file {path.name}")]
    raw = _read_frozen(path, BRAND_RECOVERY_COLUMNS)
    frozen = _read_frozen_brand_recovery(path, month, aliases, f"{market}/{source_set}")
    out, audit = ca_brands.recover_generic_brands(frame, vocabulary, frozen, display=display, month=month)
    applied = set(frozen["asin"]) & set(audit["asin"])
    present = set(frame["asin"])
    problems = [(tag, a, f"alias map rewrites the frozen new_brand {old!r} -> {new!r}")
                for a, old, new in zip(raw["asin"], raw["new_brand"], frozen["new_brand"]) if old != new and a in applied]
    problems += [(tag, a, "frozen decision no longer applies (would be removed)") for a in frozen["asin"]
                 if a not in applied and a in present]
    problems += [(tag, a, "no frozen decision (would be appended)") for a in audit["asin"] if a not in applied]
    LOG.info("brand_recovery[%s/%s]: read-only replay, replayed=%d problems=%d", market, source_set, len(applied), len(problems))
    return out, audit, problems


def _replay_type_decisions_read_only(fresh: pd.DataFrame, overrides: dict[str, str], *, market: str, month: str, runs_dir: Path,
                                     run_id: str) -> tuple[pd.DataFrame, pd.DataFrame, list[tuple[str, str, str]]]:
    """_replay_type_decisions (freeze=True, rederive=False) without the write: (typed frame, decisions, problems).
    A problem = no frozen file, an ASIN without a frozen decision, or an override map row that would rewrite it."""
    tag = f"type_decisions[{market}_code_reader]"
    current = _decisions_from(fresh, month, market, run_id)
    path = run_file(runs_dir, month, "type_decisions", f"{market}_code_reader")
    if not path.exists():
        return fresh, current, [(tag, "*", f"no frozen file {path.name}")]
    frozen = ca_types.read_type_decisions(path)
    bad = frozen[(frozen["month"] != month) | (frozen["market"] != market)]
    if len(bad):
        raise ValueError(f"{path.name}: rows for another month/market: {bad[['month', 'market', 'asin']].head().to_dict('records')}")
    fz_by_asin = {r["asin"]: r for _, r in frozen.iterrows()}
    problems: list[tuple[str, str, str]] = []
    final: dict[str, dict] = {}
    for _, cur in current.iterrows():
        asin = cur["asin"]
        fz = fz_by_asin.get(asin)
        ov = overrides.get(asin)
        if fz is None:
            problems.append((tag, asin, "no frozen decision (would be appended)"))
            final[asin] = cur.to_dict()
        elif ov is not None and (fz["type"] != ov or fz["type_source"] != "override"):
            problems.append((tag, asin, f"override map {ov!r} would rewrite frozen {fz['type']}/{fz['type_source']}"))
            final[asin] = cur.to_dict()
        else:
            final[asin] = fz.to_dict()
    decisions = pd.DataFrame([final[a] for a in fresh["asin"]], columns=list(TYPE_DECISIONS_COLUMNS))
    decisions["type_confidence"] = decisions["type_confidence"].astype(float)
    decisions["type_conflict"] = decisions["type_conflict"].astype(bool)
    out = fresh.copy()
    for c in ("type", "type_source", "type_rule_id", "type_confidence", "type_conflict"):
        out[c] = decisions[c].to_numpy()
    out["type_confidence"] = out["type_confidence"].astype(float)
    out["type_conflict"] = out["type_conflict"].astype(bool)
    LOG.info("type_decisions[%s/code_reader]: read-only replay, replayed=%d problems=%d", market, len(current) - len(problems),
             len(problems))
    return out, decisions, problems


# --------------------------------------------------------------------------------------------------------------------
# Public API
# --------------------------------------------------------------------------------------------------------------------
def load_month(market: str, month: str, *, cr_raw_dir: Path | None = None, gauge_raw_dir: Path | None = None,
               us_type_map: Path | None = US_TYPE_MAP_DEFAULT, type_map: Path = MAPS_DIR / "ca_type_overrides.csv",
               gauge_map: Path = MAPS_DIR / "ca_gauge_map.csv", runs_dir: Path = RUNS_DIR, assign_types: bool = True,
               rederive: bool = False, freeze: bool = True, replay_read_only: bool = False) -> CaDataset:
    """Load one market/month (see module docstring).

    cr_raw_dir / gauge_raw_dir default to MARKETS[market].cr_raw_dir(month) / .gauge_raw_dir(month). When the DEFAULT
    gauge dir does not exist the gauge set is None (logged); an explicitly passed dir that does not exist raises.
    gauge_map is accepted for interface stability; gauge classification (ca_gauge_classification) reads it, the
    loader does not. US + assign_types raises ValueError (US Type assignment is out of scope).

    replay_read_only (additive; needs freeze=False, rederive=False): the frozen dedupe / brand-recovery / type decisions
    of runs/<m> are read and replayed exactly as freeze=True would replay them, and NOTHING is written; when that freeze
    would append a decision or rewrite a frozen row (incomplete or changed decisions) FrozenDecisionError is raised.
    """
    if replay_read_only and (freeze or rederive):
        raise ValueError("replay_read_only needs freeze=False and rederive=False (a read-only replay never writes or rederives)")
    problems: list[tuple[str, str, str]] = []
    if market not in MARKETS:
        raise ValueError(f"unknown market {market!r}; expected one of {sorted(MARKETS)}")
    if not isinstance(month, str) or not MONTH_RE.match(month):
        raise ValueError(f"bad month {month!r} (want a calendar month YYYYMM)")
    if market == "US" and assign_types:
        raise ValueError("US Type assignment is out of scope: call load_month('US', ..., assign_types=False)")
    mk = MARKETS[market]
    runs_dir = Path(runs_dir)
    cr_dir = Path(cr_raw_dir) if cr_raw_dir is not None else mk.cr_raw_dir(month)
    if gauge_raw_dir is not None:
        g_dir: Path | None = Path(gauge_raw_dir)
        if not g_dir.is_dir():
            raise FileNotFoundError(f"gauge raw dir not found: {g_dir}")
    else:
        g_dir = mk.gauge_raw_dir(month)
        if not g_dir.is_dir():
            LOG.warning("load_month[%s/%s]: default gauge raw dir absent (%s); gauge_set=None", market, month, g_dir)
            g_dir = None
    run_id = make_run_id()

    cr, cr_audit, raw_files, dates = _load_source(cr_dir, market, "code_reader")
    g = None
    g_audit: list[dict] = []
    if g_dir is not None:
        g, g_audit, g_files, g_dates = _load_source(g_dir, market, "gauge")
        raw_files += g_files
        dates += g_dates
    if freeze:
        _freeze_dedupe_audit(cr_audit, run_file(runs_dir, month, "dedupe_audit", f"{market}_code_reader"), rederive)
        if g is not None:
            _freeze_dedupe_audit(g_audit, run_file(runs_dir, month, "dedupe_audit", f"{market}_gauge"), rederive)
    elif replay_read_only:
        problems += _dedupe_drift_read_only(cr_audit, run_file(runs_dir, month, "dedupe_audit", f"{market}_code_reader"),
                                            f"{market}_code_reader")
        if g is not None:
            problems += _dedupe_drift_read_only(g_audit, run_file(runs_dir, month, "dedupe_audit", f"{market}_gauge"), f"{market}_gauge")

    # brands
    aliases = ca_brands.load_aliases(BRAND_ALIASES_PATH)
    display = ca_brands.load_display(BRAND_DISPLAY_PATH)
    frames = {"code_reader": cr} if g is None else {"code_reader": cr, "gauge": g}
    for name, f in frames.items():
        f["brand_key"] = [ca_brands.canonical_brand_key(b, aliases) for b in f["brand_raw"]]
        # ASSEMBLY (orchestrator): display map wins; otherwise keep the vendor's own casing from the Helium 10 Brand field
        # (BYZFCM, MH, KUOWEIHUD, wiiyii) instead of Title-casing it; the capitalised fallback only applies to blank raws.
        f["brand_display"] = [ca_brands.display_brand(k, display) if (k in display or not str(raw).strip() or str(raw).strip().lower() in ("n/a", "nan"))
                              else str(raw).strip()
                              for k, raw in zip(f["brand_key"], f["brand_raw"])]
    vocabulary = set().union(*(set(f["brand_key"]) for f in frames.values()))
    vocabulary |= set(aliases.values()) | set(display) | set(ca_brands.GENERIC_RECOVERY_EXTRA_BRANDS)
    recovery = []
    for name in list(frames):
        if replay_read_only:
            frames[name], audit, found = _replay_brand_recovery_read_only(frames[name], vocabulary, display, aliases, market=market,
                                                                          source_set=name, month=month, runs_dir=runs_dir)
            problems += found
        else:
            frames[name], audit = _recover_and_freeze(frames[name], vocabulary, display, aliases, market=market, source_set=name,
                                                      month=month, runs_dir=runs_dir, freeze=freeze, rederive=rederive)
        recovery.append(audit)
    cr, g = frames["code_reader"], frames.get("gauge")

    # types (CA code reader only) + tiers
    decisions = pd.DataFrame(columns=list(TYPE_DECISIONS_COLUMNS))
    review = pd.DataFrame(columns=list(TYPE_REVIEW_COLUMNS))
    if assign_types:
        if us_type_map is None:
            LOG.warning("load_month[%s/%s]: no US type map given; us_map coverage is 0", market, month)
            us_map: dict[str, str] = {}
        else:
            us_map = ca_types.load_us_type_map(us_type_map)
        overrides = ca_types.load_overrides(type_map, month)
        prior = ca_types.load_prior_month(runs_dir, month, market)
        fresh = ca_types.assign_types(cr, us_map=us_map, overrides=overrides, prior=prior)
        if replay_read_only:
            cr, decisions, found = _replay_type_decisions_read_only(fresh, overrides, market=market, month=month,
                                                                    runs_dir=runs_dir, run_id=run_id)
            problems += found
        else:
            cr, decisions = _replay_type_decisions(fresh, overrides, market=market, month=month, runs_dir=runs_dir,
                                                   run_id=run_id, freeze=freeze, rederive=rederive)
        review = ca_types.build_type_review(cr)
        if freeze:
            merged = ca_types.write_type_review(review, run_file(runs_dir, month, "type_review", f"{market}_code_reader"))
            human = {a: t for a, t in zip(merged["asin"], merged["reviewed_type"]) if isinstance(t, str) and t.strip()}
            review["reviewed_type"] = [human.get(a, "") for a in review["asin"]]
        elif replay_read_only:      # the human reviewed_type of the review queue, read (never merged or written)
            rpath = run_file(runs_dir, month, "type_review", f"{market}_code_reader")
            if rpath.exists():
                old = ca_types.read_type_review(rpath)
                human = {a: t for a, t in zip(old["asin"], old["reviewed_type"]) if isinstance(t, str) and t.strip()}
                review["reviewed_type"] = [human.get(a, "") for a in review["asin"]]
        LOG.info("types[%s/code_reader]: %s; type_review rows=%d", market, cr["type_source"].value_counts().to_dict(), len(review))
    if problems:
        raise FrozenDecisionError(market, month, problems)
    cr = ca_tiers.assign_cr_tiers(cr)

    dedupe_audit = pd.DataFrame(cr_audit + g_audit, columns=list(DEDUPE_AUDIT_COLUMNS))
    brand_recovery = pd.concat([a for a in recovery if len(a)], ignore_index=True) if any(len(a) for a in recovery) \
        else pd.DataFrame(columns=list(BRAND_RECOVERY_COLUMNS))
    return CaDataset(
        market=market, month=month,
        code_reader=cr[list(BASE_ROW_COLUMNS)].reset_index(drop=True),
        gauge_set=None if g is None else g[list(BASE_ROW_COLUMNS)].reset_index(drop=True),
        export_dates=(min(dates), max(dates)), raw_files=raw_files,
        audits={"dedupe_audit": dedupe_audit, "brand_recovery": brand_recovery[list(BRAND_RECOVERY_COLUMNS)],
                "type_decisions": decisions, "type_review": review},
    )


def _is_na(v) -> bool:
    return v is None or (not isinstance(v, str) and bool(pd.isna(v)))


def _same(a, b) -> bool:
    """Equality with missing == missing (NaN/None/pd.NA)."""
    if _is_na(a) or _is_na(b):
        return _is_na(a) and _is_na(b)
    return bool(a == b)


def _better_numerically(g: pd.Series, c: pd.Series) -> bool:
    """True when the gauge row would win the dedupe ordering on its numeric keys (revenue DESC, then bsr ASC NaN last)."""
    if g["revenue_month"] != c["revenue_month"]:
        return g["revenue_month"] > c["revenue_month"]
    gb, cb = g["bsr"], c["bsr"]
    if pd.isna(gb):
        return False
    return pd.isna(cb) or gb < cb


def union_gauge_frames(code_reader: pd.DataFrame, gauge_set: pd.DataFrame, audit: list[dict]) -> pd.DataFrame:
    """Union by ASIN with the CODE-READER row as master (source_set='both' on overlaps). For every overlap the gauge row
    is appended to `audit` (DEDUPE_AUDIT_COLUMNS, winning_rule='cr_master', discrepancy_flag='Y' when the gauge row
    would have won numerically). Every column of either frame is kept (CR column order first). Pure: no file IO and
    the inputs are not mutated. chosen_row is '' and dropped is the gauge source_file (normalized rows carry no row
    index)."""
    for name, f in (("code_reader", code_reader), ("gauge_set", gauge_set)):
        if f["asin"].duplicated().any():
            raise ValueError(f"union_gauge_frames: duplicate ASINs in {name}")
    cr = code_reader.copy()
    g = gauge_set.copy()
    g_by_asin = {a: i for i, a in enumerate(g["asin"])}
    overlap = [a for a in cr["asin"] if a in g_by_asin]
    ov = set(overlap)
    cr.loc[cr["asin"].isin(ov), "source_set"] = "both"
    c_by_asin = {a: i for i, a in enumerate(cr["asin"])}
    for asin in overlap:
        c, gr = cr.iloc[c_by_asin[asin]], g.iloc[g_by_asin[asin]]
        fields = [f for f in _H10_FIELDS if f in cr.columns and f in g.columns]
        identical = all(_same(c[f], gr[f]) for f in fields)
        audit.append(_audit_row(
            str(c["market"]), "both", asin, n_rows=2, chosen_file=str(c["source_file"]), chosen_row="",
            dropped=str(gr["source_file"]), values_identical=bool(identical), revenue_chosen=float(c["revenue_month"]),
            revenue_dropped_max=float(gr["revenue_month"]), units_diff=float(c["units_month"] - gr["units_month"]),
            price_diff=float(c["price"] - gr["price"]), title_diff="N" if c["title"] == gr["title"] else "Y",
            winning_rule="cr_master", discrepancy_flag="Y" if _better_numerically(gr, c) else ""))
    g_only = g[~g["asin"].isin(ov)]
    cols = list(cr.columns) + [c for c in g.columns if c not in cr.columns]
    out = pd.concat([cr, g_only], ignore_index=True, sort=False)
    return out[cols]
