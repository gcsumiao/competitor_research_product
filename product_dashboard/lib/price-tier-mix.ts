/**
 * Pure helpers behind the Dashboard "Price tier mix" card (Option A).
 *
 * The card always draws ONE pie whose slices are mutually exclusive:
 *   All ASINs        -> the 7 parent-level slices of the snapshot's scheme
 *   Total Tablet     -> Tablet $800+ / $400-$800 / $400-
 *   Total Handheld   -> V1 $75+/$75-, V2 $100+/$100-
 *   Tablet $400-     -> (V2) Tablet $300+ / $200-$300 / $200-
 *   Handheld $100-   -> (V2) Handheld $65+ / $35-$65 / $35-
 *   Total Dongle / Total Other Tools -> the single total slice
 * A parent and its own sub-tiers never share a pie.
 */
import type { SnapshotSummary, TypeBreakdownMetric } from "@/lib/competitor-data"
import {
  dashboardScopeOptions,
  pieKeysForScope,
  resolveSnapshotScheme,
  type PriceTierScheme,
  type PriceTierScopeOption,
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
    label: metric.label,
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

/**
 * Pie rows for a scope, in scheme order (callers sort for display). Snapshots
 * without type breakdowns (non-code categories, fallback months) keep the
 * label-based snapshot.priceTiers rows.
 */
export function buildPriceTierItems(snapshot: SnapshotLike | undefined, scope: string): PriceTierItem[] {
  if (!snapshot) return []

  const metrics = snapshot.typeBreakdowns?.allAsins ?? []
  if (!metrics.length) return legacyPriceTierItems(snapshot)

  const byKey = new Map(metrics.map((metric) => [metric.scopeKey, metric]))
  const keys = pieKeysForScope(scope, schemeForSnapshot(snapshot))
  const rows = keys.flatMap((key) => {
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
