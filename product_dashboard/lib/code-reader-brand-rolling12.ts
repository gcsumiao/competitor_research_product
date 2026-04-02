import type { SnapshotSummary } from "@/lib/competitor-data"
import { formatSnapshotLabelMonthEnd } from "@/lib/snapshot-date"

type RollingMetric = "revenue" | "units"

export type BrandRolling12GrandTotals = {
  brand: string
  revenueGrandTotal: number
  revenueMonthly: number
  unitsGrandTotal: number
  unitsMonthly: number
}

export type BrandRolling12TrendPoint = {
  date: string
  label: string
  revenueMonthly: number
  revenueGrandTotal: number
  unitsMonthly: number
  unitsGrandTotal: number
}

export type BrandRolling12Expectation = {
  brand: string
  revenueGrandTotal: number
  unitsGrandTotal: number
}

export type BrandRolling12ValidationResult = {
  brand: string
  revenuePassed: boolean
  unitsPassed: boolean
  actualRevenueGrandTotal: number | null
  actualUnitsGrandTotal: number | null
  expectedRevenueGrandTotal: number
  expectedUnitsGrandTotal: number
}

export function getBrandRolling12GrandTotals(
  snapshot: SnapshotSummary | undefined,
  brand: string
): BrandRolling12GrandTotals | null {
  if (!snapshot || !brand) return null

  const revenueRow = findRolling12BrandRow(snapshot, "revenue", brand)
  const unitsRow = findRolling12BrandRow(snapshot, "units", brand)
  if (!revenueRow && !unitsRow) return null

  return {
    brand: revenueRow?.brand ?? unitsRow?.brand ?? brand,
    revenueGrandTotal: revenueRow?.grandTotal ?? 0,
    revenueMonthly: revenueRow?.monthly ?? 0,
    unitsGrandTotal: unitsRow?.grandTotal ?? 0,
    unitsMonthly: unitsRow?.monthly ?? 0,
  }
}

export function buildBrandRolling12Trend(
  snapshots: SnapshotSummary[],
  brand: string
): BrandRolling12TrendPoint[] {
  return snapshots.map((snapshot) => {
    const totals = getBrandRolling12GrandTotals(snapshot, brand)
    return {
      date: snapshot.date,
      label: formatSnapshotLabelMonthEnd(snapshot.date),
      revenueMonthly: totals?.revenueMonthly ?? 0,
      revenueGrandTotal: totals?.revenueGrandTotal ?? 0,
      unitsMonthly: totals?.unitsMonthly ?? 0,
      unitsGrandTotal: totals?.unitsGrandTotal ?? 0,
    }
  })
}

export function validateBrandRolling12Expectations(
  snapshot: SnapshotSummary | undefined,
  expectations: BrandRolling12Expectation[]
): BrandRolling12ValidationResult[] {
  return expectations.map((expectation) => {
    const totals = getBrandRolling12GrandTotals(snapshot, expectation.brand)
    const actualRevenue = totals?.revenueGrandTotal ?? null
    const actualUnits = totals?.unitsGrandTotal ?? null
    return {
      brand: expectation.brand,
      revenuePassed:
        actualRevenue !== null && Math.round(actualRevenue) === expectation.revenueGrandTotal,
      unitsPassed: actualUnits === expectation.unitsGrandTotal,
      actualRevenueGrandTotal: actualRevenue,
      actualUnitsGrandTotal: actualUnits,
      expectedRevenueGrandTotal: expectation.revenueGrandTotal,
      expectedUnitsGrandTotal: expectation.unitsGrandTotal,
    }
  })
}

function findRolling12BrandRow(
  snapshot: SnapshotSummary,
  metric: RollingMetric,
  brand: string
) {
  const rows =
    metric === "revenue"
      ? snapshot.rolling12?.revenue?.brands ?? []
      : snapshot.rolling12?.units?.brands ?? []
  const brandKey = normalizeBrandKey(brand)
  return rows.find((row) => normalizeBrandKey(row.brand) === brandKey) ?? null
}

export function normalizeBrandKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "")
}
