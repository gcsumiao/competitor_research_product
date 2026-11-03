from __future__ import annotations

"""Helpers to keep worksheet artifacts aligned after row inserts/deletes.

openpyxl's ``insert_rows``/``delete_rows`` re-key the cell store (including
MergedCell markers) but leave merged-range definitions, chart anchors and
image anchors untouched, so everything below the edit drifts out of place.
Call ``shift_row_artifacts`` right after each insert/delete with the same
``from_row``/``delta`` semantics used for table shifting:

- insert of N rows at ``insert_at``   -> shift_row_artifacts(ws, insert_at, N)
- delete of N rows at ``delete_at``   -> shift_row_artifacts(ws, delete_at + N, -N)
"""


def shift_row_artifacts(ws, from_row: int, delta: int) -> None:
    if delta == 0:
        return
    _shift_merged_ranges(ws, from_row, delta)
    _shift_anchor_list(getattr(ws, "_charts", []), from_row, delta)
    _shift_anchor_list(getattr(ws, "_images", []), from_row, delta)


def _shift_merged_ranges(ws, from_row: int, delta: int) -> None:
    # The MergedCell markers were already moved by insert_rows/delete_rows,
    # so only the range bookkeeping needs to follow. CellRange hashes by its
    # bounds, so rebuild the set instead of mutating ranges in place.
    ranges = ws.merged_cells.ranges
    kept = []
    deleted_start = from_row + delta
    for rng in list(ranges):
        if delta < 0 and deleted_start <= rng.min_row < from_row:
            continue  # the merged block's rows were deleted
        if rng.min_row >= from_row:
            rng.shift(0, delta)
        kept.append(rng)
    ranges.clear()
    for rng in kept:
        ranges.add(rng)


def _shift_anchor_list(items, from_row: int, delta: int) -> None:
    for item in items:
        anchor = getattr(item, "anchor", None)
        if anchor is None or isinstance(anchor, str):
            continue
        markers = [getattr(anchor, "_from", None), getattr(anchor, "to", None)]
        first = markers[0]
        if first is None or first.row + 1 < from_row:
            continue
        for marker in markers:
            if marker is not None:
                marker.row = max(marker.row + delta, 0)
