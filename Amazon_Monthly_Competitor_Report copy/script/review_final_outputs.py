#!/usr/bin/env python3
"""Regenerate the two final formatted workbooks into a sandbox dir and diff
them against hand-fixed golden copies.

The golden files are opened read-only and never written. Typical use:

    .venv/bin/python script/review_final_outputs.py \
        --month 202606 \
        --golden-dir 26-06-reports \
        --out-dir script/runs/202606/formatted_review

Outputs a structured diff report (xlsx + console summary) covering cell
values, number formats, merged ranges, font colors, table refs, dimensions,
and embedded images, so every formatting regression can be traced back to
the generator code.
"""
from __future__ import annotations

import argparse
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path

from openpyxl import Workbook, load_workbook

from automate_final_outputs import build_final_outputs
from price_tier_scheme import SCHEME_CHOICES

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RAW_REPORT = ROOT / "script output reports" / "Amazon Competitor Report.xlsx"
DEFAULT_RAW_SUMMARY = ROOT / "script output reports" / "summary.xlsx"

MAX_ROWS_PER_CATEGORY = 400  # cap per (sheet, category) so the report stays readable


@dataclass
class Diff:
    file: str
    sheet: str
    category: str
    location: str
    generated: str
    golden: str


@dataclass
class DiffCollector:
    rows: list[Diff] = field(default_factory=list)
    counts: Counter = field(default_factory=Counter)

    def add(self, file: str, sheet: str, category: str, location: str, generated: object, golden: object) -> None:
        key = (file, sheet, category)
        self.counts[key] += 1
        if self.counts[key] <= MAX_ROWS_PER_CATEGORY:
            self.rows.append(Diff(file, sheet, category, location, _short(generated), _short(golden)))


def _short(value: object, limit: int = 120) -> str:
    text = "" if value is None else str(value)
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _norm_value(value: object):
    if isinstance(value, float) and value == int(value):
        return int(value)
    if isinstance(value, str):
        return value.strip()
    return value


def _values_equal(a: object, b: object) -> bool:
    a, b = _norm_value(a), _norm_value(b)
    if a == b:
        return True
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(float(a) - float(b)) <= max(1e-9, abs(float(b)) * 1e-9)
    return False


def _font_rgb(cell) -> str:
    color = cell.font.color
    if color is not None and color.type == "rgb" and isinstance(color.rgb, str):
        return color.rgb
    return "theme/none"


def _fill_rgb(cell) -> str:
    fill = cell.fill
    if fill is None or fill.fill_type is None:
        return "none"
    color = fill.fgColor
    if color is not None and color.type == "rgb" and isinstance(color.rgb, str):
        return f"{fill.fill_type}:{color.rgb}"
    return f"{fill.fill_type}:theme"


def diff_sheet(diffs: DiffCollector, file_label: str, ws_gen, ws_gold) -> None:
    sheet = ws_gold.title
    max_row = max(ws_gen.max_row, ws_gold.max_row)
    max_col = max(ws_gen.max_column, ws_gold.max_column)
    if ws_gen.max_row != ws_gold.max_row or ws_gen.max_column != ws_gold.max_column:
        diffs.add(
            file_label, sheet, "dimensions", "sheet",
            f"{ws_gen.max_row}x{ws_gen.max_column}", f"{ws_gold.max_row}x{ws_gold.max_column}",
        )

    for row_idx in range(1, max_row + 1):
        for col_idx in range(1, max_col + 1):
            c_gen = ws_gen.cell(row_idx, col_idx)
            c_gold = ws_gold.cell(row_idx, col_idx)
            coord = c_gold.coordinate
            if not _values_equal(c_gen.value, c_gold.value):
                # Golden A1 "#VALUE!" is the residue of a hand-pasted in-cell
                # logo image; the generator intentionally leaves A1 empty and
                # inserts a floating logo instead.
                if coord == "A1" and str(c_gold.value).strip() == "#VALUE!" and c_gen.value in (None, ""):
                    continue
                diffs.add(file_label, sheet, "cell_value", coord, c_gen.value, c_gold.value)
            has_content = c_gen.value is not None or c_gold.value is not None
            if has_content:
                if c_gen.number_format != c_gold.number_format:
                    diffs.add(file_label, sheet, "number_format", coord, c_gen.number_format, c_gold.number_format)
                if _font_rgb(c_gen) != _font_rgb(c_gold):
                    diffs.add(file_label, sheet, "font_color", coord, _font_rgb(c_gen), _font_rgb(c_gold))
                if bool(c_gen.font.bold) != bool(c_gold.font.bold):
                    diffs.add(file_label, sheet, "font_bold", coord, bool(c_gen.font.bold), bool(c_gold.font.bold))
                if _fill_rgb(c_gen) != _fill_rgb(c_gold):
                    diffs.add(file_label, sheet, "fill", coord, _fill_rgb(c_gen), _fill_rgb(c_gold))

    merged_gen = {str(r) for r in ws_gen.merged_cells.ranges}
    merged_gold = {str(r) for r in ws_gold.merged_cells.ranges}
    for ref in sorted(merged_gold - merged_gen):
        diffs.add(file_label, sheet, "merged_missing", ref, "", ref)
    for ref in sorted(merged_gen - merged_gold):
        diffs.add(file_label, sheet, "merged_extra", ref, ref, "")

    tables_gen = {t.name: t.ref for t in ws_gen.tables.values()}
    tables_gold = {t.name: t.ref for t in ws_gold.tables.values()}
    for name in sorted(set(tables_gen) | set(tables_gold)):
        if tables_gen.get(name) != tables_gold.get(name):
            diffs.add(
                file_label, sheet, "table_ref", name,
                tables_gen.get(name, "<missing>"), tables_gold.get(name, "<missing>"),
            )

    widths_gen = {k: v.width for k, v in ws_gen.column_dimensions.items() if v.width}
    widths_gold = {k: v.width for k, v in ws_gold.column_dimensions.items() if v.width}
    for key in sorted(set(widths_gen) | set(widths_gold)):
        a, b = widths_gen.get(key), widths_gold.get(key)
        if a is None or b is None or abs(a - b) > 0.5:
            diffs.add(file_label, sheet, "col_width", key, a, b)

    heights_gen = {k: v.height for k, v in ws_gen.row_dimensions.items() if v.height}
    heights_gold = {k: v.height for k, v in ws_gold.row_dimensions.items() if v.height}
    for key in sorted(set(heights_gen) | set(heights_gold)):
        a, b = heights_gen.get(key), heights_gold.get(key)
        if a is None or b is None or abs(a - b) > 0.5:
            diffs.add(file_label, sheet, "row_height", f"row {key}", a, b)


def diff_images(diffs: DiffCollector, file_label: str, gen_path: Path, gold_path: Path) -> None:
    def inventory(path: Path) -> tuple[set[str], dict[str, list[str]]]:
        with zipfile.ZipFile(path) as z:
            media = {n.rsplit("/", 1)[-1] for n in z.namelist() if n.startswith("xl/media/")}
            vm_cells: dict[str, list[str]] = {}
            from xml.etree import ElementTree as ET

            ns = {
                "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
                "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
            }
            wb_root = ET.fromstring(z.read("xl/workbook.xml"))
            relmap = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
            def part_path(target: str) -> str:
                if target.startswith("/"):
                    return target[1:]
                return target if target.startswith("xl/") else "xl/" + target

            for s in wb_root.find("m:sheets", ns):
                name = s.get("name")
                target = relmap[s.get(f"{{{ns['r']}}}id")]
                data = z.read(part_path(target)).decode()
                cells = re.findall(r'<c r="([A-Z]+\d+)"[^>]*\bvm="\d+"', data)
                if cells:
                    vm_cells[name] = cells
            # floating drawing pictures per sheet
            drawing_pics: dict[str, int] = {}
            xdr = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
            for s in wb_root.find("m:sheets", ns):
                name = s.get("name")
                target = relmap[s.get(f"{{{ns['r']}}}id")]
                sheet_part = part_path(target)
                base = sheet_part.rsplit("/", 1)[-1]
                rels_part = sheet_part.rsplit("/", 1)[0] + f"/_rels/{base}.rels"
                try:
                    srels = z.read(rels_part).decode()
                except KeyError:
                    continue
                for rel in ET.fromstring(srels):
                    if rel.get("Type", "").endswith("/drawing"):
                        dpath = part_path(rel.get("Target").replace("../", ""))
                        droot = ET.fromstring(z.read(dpath))
                        pics = len(droot.findall(f".//{{{xdr}}}pic"))
                        if pics:
                            drawing_pics[name] = drawing_pics.get(name, 0) + pics
            for name, count in drawing_pics.items():
                vm_cells.setdefault(name, []).append(f"floating x{count}")
            return media, vm_cells

    media_gen, logos_gen = inventory(gen_path)
    media_gold, logos_gold = inventory(gold_path)
    if len(media_gen) != len(media_gold):
        diffs.add(file_label, "<workbook>", "media_count", "xl/media", len(media_gen), len(media_gold))
    for sheet in sorted(set(logos_gen) | set(logos_gold)):
        a, b = logos_gen.get(sheet), logos_gold.get(sheet)
        # A floating drawing image and an in-cell (vm) image both count as a
        # present header logo; only flag presence/absence mismatches.
        if bool(a) != bool(b):
            diffs.add(file_label, sheet, "logo", "header image", a or "<none>", b or "<none>")


def diff_workbooks(diffs: DiffCollector, file_label: str, gen_path: Path, gold_path: Path, include_hidden: bool) -> None:
    wb_gen = load_workbook(gen_path)
    wb_gold = load_workbook(gold_path)
    try:
        def visible(wb):
            return [ws.title for ws in wb.worksheets if include_hidden or ws.sheet_state == "visible"]

        sheets_gen, sheets_gold = visible(wb_gen), visible(wb_gold)
        if sheets_gen != sheets_gold:
            diffs.add(file_label, "<workbook>", "sheet_order", "visible sheets", sheets_gen, sheets_gold)
        for name in sheets_gold:
            if name not in wb_gen.sheetnames:
                diffs.add(file_label, name, "sheet_missing", name, "<missing>", "present")
                continue
            diff_sheet(diffs, file_label, wb_gen[name], wb_gold[name])
        for name in sheets_gen:
            if name not in wb_gold.sheetnames:
                diffs.add(file_label, name, "sheet_extra", name, "present", "<missing>")
    finally:
        wb_gen.close()
        wb_gold.close()
    diff_images(diffs, file_label, gen_path, gold_path)


def find_golden(golden_dir: Path, kind: str, month_name: str) -> Path:
    pattern = (
        f"*Amazon Competitor Analysis {month_name}.xlsx"
        if kind == "analysis"
        else f"*Amazon Competitor Report {month_name} Innova Adjusted.xlsx"
    )
    candidates = [p for p in golden_dir.glob(pattern) if not p.name.startswith("~$")]
    if not candidates:
        raise SystemExit(f"No golden {kind} workbook in {golden_dir} matching {pattern!r}")
    return max(candidates, key=lambda p: (p.stat().st_mtime, p.name))


def write_diff_report(diffs: DiffCollector, out_path: Path) -> None:
    wb = Workbook()
    ws = wb.active
    ws.title = "diffs"
    ws.append(["File", "Sheet", "Category", "Location", "Generated", "Golden"])
    for d in diffs.rows:
        ws.append([d.file, d.sheet, d.category, d.location, d.generated, d.golden])
    summary = wb.create_sheet("summary")
    summary.append(["File", "Sheet", "Category", "Count", "Truncated"])
    for (file, sheet, category), count in sorted(diffs.counts.items()):
        summary.append([file, sheet, category, count, "yes" if count > MAX_ROWS_PER_CATEGORY else ""])
    wb.save(out_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", required=True, help="YYYYMM, e.g. 202606")
    parser.add_argument("--golden-dir", type=Path, required=True, help="Folder with the hand-fixed final workbooks (read-only)")
    parser.add_argument("--out-dir", type=Path, default=None, help="Sandbox output dir (default script/runs/<month>/formatted_review)")
    parser.add_argument("--raw-report", type=Path, default=DEFAULT_RAW_REPORT)
    parser.add_argument("--raw-summary", type=Path, default=DEFAULT_RAW_SUMMARY)
    parser.add_argument("--date-tag", default=None, help="Filename date tag; defaults to the golden file's tag")
    parser.add_argument("--skip-generate", action="store_true", help="Diff existing sandbox outputs without regenerating")
    parser.add_argument("--include-hidden", action="store_true", help="Also diff hidden (staging) sheets")
    parser.add_argument(
        "--tier-scheme",
        choices=SCHEME_CHOICES,
        default="auto",
        help="Price-tier scheme for the regenerated Analysis workbook (default: by --month; v2 from 202610).",
    )
    args = parser.parse_args()

    month = args.month.strip()
    if not re.fullmatch(r"\d{6}", month):
        raise SystemExit("--month must be YYYYMM")
    out_dir = (args.out_dir or (ROOT / "script" / "runs" / month / "formatted_review")).resolve()
    golden_dir = args.golden_dir if args.golden_dir.is_absolute() else ROOT / args.golden_dir
    golden_dir = golden_dir.resolve()
    if out_dir == golden_dir or golden_dir in out_dir.parents:
        raise SystemExit("Refusing to use the golden dir (or a subdir of it) as the sandbox out dir.")

    from month_context import MONTHS

    month_name = MONTHS[int(month[4:]) - 1]
    golden_analysis = find_golden(golden_dir, "analysis", month_name)
    golden_report = find_golden(golden_dir, "report", month_name)
    date_tag = args.date_tag
    if date_tag is None:
        match = re.match(r"(\d{2}-\d{2}-\d{2})", golden_analysis.name)
        date_tag = match.group(1) if match else None

    if not args.skip_generate:
        out_dir.mkdir(parents=True, exist_ok=True)
        print(f"[info] Regenerating {month} outputs into sandbox: {out_dir}")
        build_final_outputs(
            month=month,
            raw_report=args.raw_report.resolve(),
            raw_summary=args.raw_summary.resolve(),
            template_report=None,
            template_analysis=None,
            out_dir=out_dir,
            date_tag=date_tag or "99-99-99",
            brand_header_dir=None,
            overwrite_final=True,
            tier_scheme=args.tier_scheme,
        )

    gen_analysis = find_golden(out_dir, "analysis", month_name)
    gen_report = find_golden(out_dir, "report", month_name)

    diffs = DiffCollector()
    print(f"[info] Diffing analysis: {gen_analysis.name} vs golden {golden_analysis.name}")
    diff_workbooks(diffs, "analysis", gen_analysis, golden_analysis, args.include_hidden)
    print(f"[info] Diffing report:   {gen_report.name} vs golden {golden_report.name}")
    diff_workbooks(diffs, "report", gen_report, golden_report, args.include_hidden)

    report_path = out_dir / "diff_report.xlsx"
    write_diff_report(diffs, report_path)

    print(f"\n[result] {sum(diffs.counts.values())} differences in {len(diffs.counts)} (file, sheet, category) groups")
    by_cat: Counter = Counter()
    for (file, _sheet, category), count in diffs.counts.items():
        by_cat[(file, category)] += count
    for (file, category), count in sorted(by_cat.items()):
        print(f"  {file:9s} {category:16s} {count}")
    print(f"[ok] Wrote {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
