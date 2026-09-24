import { normalizeSnapshotDate } from "@/lib/snapshot-date"

const FALLBACK_CATEGORY_ID = "code_reader_scanner"

type OverviewCategory = {
  id: string
  snapshots: ReadonlyArray<{ date: string }>
}

type OverviewSearchParams = {
  category?: string | string[]
  snapshot?: string | string[]
}

/**
 * Decides where the Dashboard (overview) page should redirect, or null to render.
 *
 * - A requested category that exists with at least one snapshot is kept; an
 *   unknown/empty category (or none) falls back to code reader.
 * - The snapshot must be one of the kept category's snapshot dates (after
 *   normalization); otherwise it is replaced by that category's latest.
 * - Returns null when the requested params already resolve to themselves, so
 *   the page never redirects to the URL it was requested with.
 */
export function resolveOverviewRedirect(
  categories: ReadonlyArray<OverviewCategory>,
  params: OverviewSearchParams
): string | null {
  const requestedCategory = firstSearchParam(params.category)
  const requestedSnapshotRaw = firstSearchParam(params.snapshot)
  const requestedSnapshot = normalizeSnapshotDate(requestedSnapshotRaw ?? "")

  const requested = categories.find(
    (category) => category.id === requestedCategory && category.snapshots.length > 0
  )
  const resolved =
    requested ??
    categories.find(
      (category) => category.id === FALLBACK_CATEGORY_ID && category.snapshots.length > 0
    )
  if (!resolved) return null

  const snapshotIsValid = resolved.snapshots.some(
    (snapshot) => snapshot.date === requestedSnapshot
  )
  if (resolved === requested && snapshotIsValid) return null

  const latestSnapshot = resolved.snapshots.at(-1)!.date
  const target = new URLSearchParams()
  target.set("category", resolved.id)
  target.set("snapshot", latestSnapshot)
  return `/?${target.toString()}`
}

function firstSearchParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}
