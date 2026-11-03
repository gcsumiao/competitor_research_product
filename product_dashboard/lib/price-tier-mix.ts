/**
 * Pure helpers behind the Dashboard "Price tier mix" card (Option A).
 *
 * The card always draws ONE pie whose slices are mutually exclusive:
 *   All ASINs        -> the 7 parent-level slices of the snapshot's scheme
 *   Total Tablet     -> Tablet $800+ / $400-$800 / $400-
 *   Total Handheld   -> V1 $75+/$75-, V2 $100+/$100-
 *   Tablet $400-     -> (V2) Tablet $300-$400 / $200-$300 / $200-
 *   Handheld $100-   -> (V2) Handheld $65-$100 / $35-$65 / $35-
 *   Total Dongle / Total Other Tools -> the single total slice
 * A parent and its own sub-tiers never share a pie, and a partition scope
 * (type total with tiers, V2 parent tier) with a missing slice row draws no
 * pie at all rather than a partial one that does not add up to its row.
 */
import type { SnapshotSummary, TypeBreakdownMetric } from "@/lib/competitor-data"
import {
  dashboardScopeOptions,
  isPartitionScope,
  labelForKey,
  pieKeysForScope,
  resolveSnapshotScheme,
  type PriceTierScheme,
  type PriceTierScopeOption,
  type SchemeLike,
} from "@/lib/price-tier-scheme"

export type PriceTierItem = {
  scopeKey: string
  label: string
  units: number
  unitsShare: number
  unitsMoM: number | null
  unitsYoY: number | null
  revenue: number
  revenueShare: number
  revenueMoM: number | null
  revenueYoY: number | null
}

type SnapshotLike = Pick<SnapshotSummary, "date" | "priceTiers" | "typeBreakdowns">

export function schemeForSnapshot(snapshot: Pick<SnapshotSummary, "date" | "typeBreakdowns"> | undefined): PriceTierScheme {
  return resolveSnapshotScheme({
    snapshotDate: snapshot?.date ?? null,
    scopeKeys: (snapshot?.typeBreakdowns?.allAsins ?? []).map((row) => row.scopeKey),
  })
}

/**
 * Scope dropdown for the card, rebuilt per snapshot from the scheme and the
 * rows actually present (old months never offer V2-only scopes).
 */
export function buildPriceScopeOptions(snapshot: SnapshotLike | undefined): PriceTierScopeOption[] {
  const rows = snapshot?.typeBreakdowns?.allAsins ?? []
  if (!rows.length) {
    return [{ value: "all_asins", label: "All ASINs", depth: 0 }]
  }
  const presentKeys = new Set(rows.map((row) => row.scopeKey))
  return dashboardScopeOptions(schemeForSnapshot(snapshot), presentKeys)
}

function toPriceTierItem(metric: TypeBreakdownMetric): PriceTierItem {
  return {
    scopeKey: metric.scopeKey,
    // Known keys render the module's current label, so rows stored under a
    // tier's legacy wording still show today's label.
    label: labelForKey(metric.scopeKey) ?? metric.label,
    units: metric.units,
    unitsShare: metric.unitsShare,
    unitsMoM: metric.unitsMoM,
    unitsYoY: metric.unitsYoY,
    revenue: metric.revenue,
    revenueShare: metric.revenueShare,
    revenueMoM: metric.revenueMoM,
    revenueYoY: metric.revenueYoY,
  }
}

function legacyPriceTierItems(snapshot: SnapshotLike): PriceTierItem[] {
  return (snapshot.priceTiers ?? []).map((tier) => ({
    scopeKey: tier.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
    label: tier.label,
    units: 0,
    unitsShare: 0,
    unitsMoM: null,
    unitsYoY: null,
    revenue: tier.revenue,
    revenueShare: tier.share,
    revenueMoM: null,
    revenueYoY: null,
  }))
}

/** Relative gap above which a partition's slices "do not add up" to its row. */
export const PIE_SUM_TOLERANCE = 0.01

export type PieCompleteness = {
  /** The slices read as 100% of the scope's own row (see isPartitionScope). */
  partition: boolean
  /** Every expected slice row is present (zero-revenue rows count as present). */
  complete: boolean
  /** Expected slice keys with no row, in scheme order. */
  missing: string[]
  /** Revenue of the slice rows that are present. */
  sumRevenue: number
  /** Revenue of the scope's own row (partition scopes only; null when absent). */
  parentRevenue: number | null
  /** Complete partition whose slices differ from the parent row by > PIE_SUM_TOLERANCE. */
  mismatch: boolean
}

type RevenueRow = Pick<TypeBreakdownMetric, "scopeKey" | "revenue">

/**
 * Cheap completeness / sum check of a scope's pie against its rows. Used by
 * the Dashboard card and the Types page so a partition with a missing slice
 * never draws, and a complete one that disagrees with its parent row by more
 * than 1% can say so.
 */
export function pieCompletenessForRows(
  rows: readonly RevenueRow[],
  scope: string,
  scheme: SchemeLike
): PieCompleteness {
  const byKey = new Map(rows.map((row) => [row.scopeKey, row]))
  const keys = pieKeysForScope(scope, scheme)
  const missing = keys.filter((key) => !byKey.has(key))
  const sumRevenue = keys.reduce((sum, key) => sum + (byKey.get(key)?.revenue ?? 0), 0)
  const partition = isPartitionScope(scope, scheme)
  const parentRevenue = partition ? (byKey.get(scope)?.revenue ?? null) : null
  const complete = missing.length === 0
  let mismatch = false
  if (partition && complete && parentRevenue !== null) {
    mismatch = parentRevenue > 0
      ? Math.abs(sumRevenue - parentRevenue) / parentRevenue > PIE_SUM_TOLERANCE
      : sumRevenue > 0
  }
  return { partition, complete, missing, sumRevenue, parentRevenue, mismatch }
}

export function pieCompleteness(snapshot: SnapshotLike | undefined, scope: string): PieCompleteness {
  return pieCompletenessForRows(
    snapshot?.typeBreakdowns?.allAsins ?? [],
    scope,
    schemeForSnapshot(snapshot)
  )
}

/**
 * Pie rows for a scope, in scheme order (callers sort for display). A
 * partition scope missing any slice row returns [] (the card's empty state);
 * All ASINs draws whatever parent-level rows exist. Snapshots without type
 * breakdowns (non-code categories, fallback months) keep the label-based
 * snapshot.priceTiers rows (parent level only, so levels never mix).
 */
export function buildPriceTierItems(snapshot: SnapshotLike | undefined, scope: string): PriceTierItem[] {
  if (!snapshot) return []

  const metrics = snapshot.typeBreakdowns?.allAsins ?? []
  if (!metrics.length) return legacyPriceTierItems(snapshot)

  const scheme = schemeForSnapshot(snapshot)
  const completeness = pieCompletenessForRows(metrics, scope, scheme)
  if (completeness.partition && !completeness.complete) return []

  const byKey = new Map(metrics.map((metric) => [metric.scopeKey, metric]))
  const rows = pieKeysForScope(scope, scheme).flatMap((key) => {
    const metric = byKey.get(key)
    return metric ? [toPriceTierItem(metric)] : []
  })

  if (rows.length) return rows
  return scope === "all_asins" ? legacyPriceTierItems(snapshot) : []
}

/**
 * The row whose totals and sheet-sourced MoM/YoY headline the card: the grand
 * "total" row for All ASINs, otherwise the scope's own row (type totals and
 * V2 parent tiers both have one in allAsins).
 */
export function findPriceScopeMetric(
  snapshot: SnapshotLike | undefined,
  scope: string,
  scopedRows: PriceTierItem[]
): TypeBreakdownMetric | undefined {
  const rows = snapshot?.typeBreakdowns?.allAsins ?? []
  if (!rows.length) return undefined
  if (scope === "all_asins") {
    return rows.find((row) => row.scopeKey === "total")
      ?? rows.find((row) => row.scopeKey === "all_asins")
      ?? undefined
  }
  return rows.find((row) => row.scopeKey === scope)
    ?? (scopedRows.length === 1
      ? rows.find((row) => row.scopeKey === scopedRows[0].scopeKey)
      : undefined)
}
