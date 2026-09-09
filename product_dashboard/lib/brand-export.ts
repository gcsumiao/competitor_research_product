/**
 * Shape and builder for `GET /api/export/brands`.
 *
 * The auto-intel pipeline pins this payload with fixtures, so the member set and the
 * member names are FROZEN. Add nothing, rename nothing, drop nothing without changing
 * the pipeline's fixtures in lockstep.
 *
 * Kept out of the route file so it can be tested without Next's request plumbing.
 */

import { buildAlerts, findSnapshot } from "@/lib/spotlight-alerts"
import type { SpotlightAlert } from "@/lib/spotlight-alerts"
import type {
  CategoryId,
  Rolling12Metric,
  Rolling12Summary,
  SnapshotSummary,
} from "@/lib/competitor-data"

/** The eight market totals the export carries (`meaningfulCompetitors` is dashboard-only). */
export type BrandExportTotals = {
  revenue: number
  units: number
  asinCount: number
  avgPrice: number
  ratingAvg: number
  reviewCount: number
  top3Share: number
  brandCount: number
}

export type BrandExportBrandTotal = {
  brand: string
  revenue: number
  units: number
  /** Revenue share of the snapshot, as a 0-1 fraction. */
  share: number
}

export type BrandExportRolling12Brand = {
  brand: string
  monthly: number
  grandTotal: number
  rank: number
  monthlySeries: number[]
}

export type BrandExportRolling12Metric = {
  monthLabels: string[]
  currentMonthLabel: string
  marketSeries: number[]
  marketTotalMonthly: number
  overallTotalMonthly: number
  brands: BrandExportRolling12Brand[]
}

/** A metric is absent when the snapshot has no rolling-12 series for it. */
export type BrandExportRolling12 = {
  revenue?: BrandExportRolling12Metric
  units?: BrandExportRolling12Metric
}

export type BrandExportSnapshot = {
  totals: BrandExportTotals
  brandTotals: BrandExportBrandTotal[]
  rolling12: BrandExportRolling12
}

export type BrandExportPayload = {
  categoryId: string
  snapshotDate: string
  previousSnapshotDate: string | null
  totals: BrandExportTotals
  brandTotals: BrandExportBrandTotal[]
  rolling12: BrandExportRolling12
  previous: BrandExportSnapshot | null
  alerts: SpotlightAlert[]
}

export function buildBrandExportPayload(
  categoryId: CategoryId,
  snapshots: SnapshotSummary[],
  requestedSnapshotDate: string | null
): BrandExportPayload | null {
  const { active, previous } = findSnapshot(snapshots, requestedSnapshotDate)
  if (!active) return null

  const activeSnapshot = toExportSnapshot(active)

  return {
    categoryId,
    snapshotDate: active.date,
    previousSnapshotDate: previous?.date ?? null,
    totals: activeSnapshot.totals,
    brandTotals: activeSnapshot.brandTotals,
    rolling12: activeSnapshot.rolling12,
    previous: previous ? toExportSnapshot(previous) : null,
    alerts: buildAlerts(categoryId, active, previous),
  }
}

function toExportSnapshot(snapshot: SnapshotSummary): BrandExportSnapshot {
  return {
    totals: toTotals(snapshot),
    brandTotals: (snapshot.brandTotals ?? []).map((brand) => ({
      brand: brand.brand,
      revenue: brand.revenue,
      units: brand.units,
      share: brand.share,
    })),
    rolling12: toRolling12(snapshot.rolling12),
  }
}

function toTotals(snapshot: SnapshotSummary): BrandExportTotals {
  const totals = snapshot.totals
  return {
    revenue: totals.revenue,
    units: totals.units,
    asinCount: totals.asinCount,
    avgPrice: totals.avgPrice,
    ratingAvg: totals.ratingAvg,
    reviewCount: totals.reviewCount,
    top3Share: totals.top3Share,
    brandCount: totals.brandCount,
  }
}

function toRolling12(rolling12: Rolling12Summary | undefined): BrandExportRolling12 {
  const exported: BrandExportRolling12 = {}
  if (rolling12?.revenue) exported.revenue = toRolling12Metric(rolling12.revenue)
  if (rolling12?.units) exported.units = toRolling12Metric(rolling12.units)
  return exported
}

function toRolling12Metric(metric: Rolling12Metric): BrandExportRolling12Metric {
  return {
    monthLabels: metric.monthLabels ?? [],
    currentMonthLabel: metric.currentMonthLabel,
    marketSeries: metric.marketSeries ?? [],
    marketTotalMonthly: metric.marketTotalMonthly,
    overallTotalMonthly: metric.overallTotalMonthly,
    brands: (metric.brands ?? []).map((brand) => ({
      brand: brand.brand,
      monthly: brand.monthly,
      grandTotal: brand.grandTotal,
      rank: brand.rank,
      // Optional upstream; the export always carries an array.
      monthlySeries: brand.monthlySeries ?? [],
    })),
  }
}
