import { closeDatabasePools } from "../lib/db/client.ts"
import { getBrandRolling12GrandTotals } from "../lib/code-reader-brand-rolling12.ts"
import {
  type DashboardData,
  type SnapshotSummary,
  loadDashboardDataFromFiles,
  loadDashboardDataFromPostgres,
} from "../lib/competitor-data.ts"
import { loadCodeReaderScannerSnapshotFromFiles } from "../lib/code-reader-scanner-data.ts"
import { resolveCodeReaderAdjustedHistoryPaths } from "./_code-reader-adjusted-history.mts"

type Mismatch = {
  scope: string
  message: string
}

const REVENUE_ROUNDING_TOLERANCE = 2

const EXPLICIT_EXPECTATIONS = [
  { date: "2026-02-28", brand: "Autel", revenueGrandTotal: 64_035_702, unitsGrandTotal: 217_875 },
  { date: "2026-02-28", brand: "Innova", revenueGrandTotal: 14_541_709, unitsGrandTotal: 86_642 },
  { date: "2026-01-31", brand: "Autel", revenueGrandTotal: 63_903_579, unitsGrandTotal: 211_566 },
  { date: "2025-12-31", brand: "Autel", revenueGrandTotal: 63_768_937, unitsGrandTotal: 211_716 },
] as const

async function main() {
  process.env.DASHBOARD_DEPLOYMENT_MODE ||= "full"

  const [fileData, postgresData] = await Promise.all([
    loadDashboardDataFromFiles(),
    loadDashboardDataFromPostgres(),
  ])

  const fileSnapshots = getCodeReaderSnapshotMap(fileData)
  const postgresSnapshots = getCodeReaderSnapshotMap(postgresData)
  const mismatches: Mismatch[] = []

  for (const entry of resolveCodeReaderAdjustedHistoryPaths()) {
    const directSnapshot = await loadCodeReaderScannerSnapshotFromFiles({
      month: entry.month,
      reportPath: entry.reportPath,
      analysisPath: entry.analysisPath,
      summaryPath: null,
    })

    if (!directSnapshot) {
      mismatches.push({
        scope: `adjusted.${entry.month}`,
        message: "Failed to parse adjusted report workbook.",
      })
      continue
    }

    const fileSnapshot = fileSnapshots.get(directSnapshot.date)
    const postgresSnapshot = postgresSnapshots.get(directSnapshot.date)
    if (!fileSnapshot) {
      mismatches.push({
        scope: `adjusted.${directSnapshot.date}.file`,
        message: "Snapshot missing from local file-backed dashboard data.",
      })
      continue
    }
    if (!postgresSnapshot) {
      mismatches.push({
        scope: `adjusted.${directSnapshot.date}.postgres`,
        message: "Snapshot missing from local postgres-backed dashboard data.",
      })
      continue
    }

    compareAllRolling12Brands(`adjusted.${directSnapshot.date}.file`, directSnapshot, fileSnapshot, mismatches)
    compareAllRolling12Brands(`adjusted.${directSnapshot.date}.postgres`, directSnapshot, postgresSnapshot, mismatches)
    compareRolling12OrderAndRanks(`adjusted.${directSnapshot.date}.file`, directSnapshot, fileSnapshot, mismatches)
    compareRolling12OrderAndRanks(`adjusted.${directSnapshot.date}.postgres`, directSnapshot, postgresSnapshot, mismatches)
    compareRolling12Series(`adjusted.${directSnapshot.date}.file`, directSnapshot, fileSnapshot, mismatches)
    compareRolling12Series(`adjusted.${directSnapshot.date}.postgres`, directSnapshot, postgresSnapshot, mismatches)
  }

  for (const expectation of EXPLICIT_EXPECTATIONS) {
    validateExplicitExpectation(`explicit.file.${expectation.date}.${expectation.brand}`, fileSnapshots.get(expectation.date), expectation, mismatches)
    validateExplicitExpectation(`explicit.postgres.${expectation.date}.${expectation.brand}`, postgresSnapshots.get(expectation.date), expectation, mismatches)
  }

  if (mismatches.length > 0) {
    console.error(`Adjusted Rolling 12 verification failed with ${mismatches.length} mismatches.`)
    for (const mismatch of mismatches.slice(0, 100)) {
      console.error(`[${mismatch.scope}] ${mismatch.message}`)
    }
    process.exitCode = 1
    return
  }

  console.log("Adjusted Rolling 12 verification passed for all mapped historical months.")
}

function getCodeReaderSnapshotMap(data: DashboardData) {
  const category = data.categories.find((item) => item.id === "code_reader_scanner")
  return new Map((category?.snapshots ?? []).map((snapshot) => [snapshot.date, snapshot]))
}

function compareAllRolling12Brands(
  scope: string,
  expectedSnapshot: SnapshotSummary,
  actualSnapshot: SnapshotSummary,
  mismatches: Mismatch[]
) {
  const brands = listRolling12Brands(expectedSnapshot)
  for (const brand of brands) {
    const expected = getBrandRolling12GrandTotals(expectedSnapshot, brand)
    const actual = getBrandRolling12GrandTotals(actualSnapshot, brand)
    if (!expected) continue
    if (!actual) {
      mismatches.push({
        scope,
        message: `Missing brand ${brand} in dashboard rolling 12 totals.`,
      })
      continue
    }
    if (!sameRoundedNumber(actual.revenueGrandTotal, expected.revenueGrandTotal, REVENUE_ROUNDING_TOLERANCE)) {
      mismatches.push({
        scope,
        message: `${brand} revenue grand total mismatch: expected=${Math.round(expected.revenueGrandTotal)} actual=${Math.round(actual.revenueGrandTotal)}`,
      })
    }
    if (Math.round(actual.unitsGrandTotal) !== Math.round(expected.unitsGrandTotal)) {
      mismatches.push({
        scope,
        message: `${brand} units grand total mismatch: expected=${Math.round(expected.unitsGrandTotal)} actual=${Math.round(actual.unitsGrandTotal)}`,
      })
    }
  }
}

function compareRolling12OrderAndRanks(
  scope: string,
  expectedSnapshot: SnapshotSummary,
  actualSnapshot: SnapshotSummary,
  mismatches: Mismatch[]
) {
  compareRolling12MetricOrder("revenue", scope, expectedSnapshot, actualSnapshot, mismatches)
  compareRolling12MetricOrder("units", scope, expectedSnapshot, actualSnapshot, mismatches)
}

function compareRolling12Series(
  scope: string,
  expectedSnapshot: SnapshotSummary,
  actualSnapshot: SnapshotSummary,
  mismatches: Mismatch[]
) {
  for (const metric of ["revenue", "units"] as const) {
    const expectedMetric = expectedSnapshot.rolling12?.[metric]
    const actualMetric = actualSnapshot.rolling12?.[metric]
    if (!expectedMetric || !actualMetric) continue

    if (expectedMetric.monthLabels.join("|") !== actualMetric.monthLabels.join("|")) {
      mismatches.push({
        scope: `${scope}.${metric}.monthLabels`,
        message: "Rolling 12 month labels do not match.",
      })
    }

    const actualRows = new Map(
      actualMetric.brands.map((row) => [normalizeBrandForOrder(row.brand), row])
    )
    for (const expectedRow of expectedMetric.brands) {
      const actualRow = actualRows.get(normalizeBrandForOrder(expectedRow.brand))
      if (!actualRow) continue
      const expectedSeries = expectedRow.monthlySeries ?? []
      const actualSeries = actualRow.monthlySeries ?? []
      if (expectedSeries.length !== actualSeries.length) {
        mismatches.push({
          scope: `${scope}.${metric}.${expectedRow.brand}.monthlySeries`,
          message: `Series length mismatch: expected=${expectedSeries.length} actual=${actualSeries.length}`,
        })
        continue
      }
      for (let index = 0; index < expectedSeries.length; index += 1) {
        if (Math.abs(expectedSeries[index] - actualSeries[index]) <= 0.01) {
          continue
        }
        mismatches.push({
          scope: `${scope}.${metric}.${expectedRow.brand}.monthlySeries`,
          message: `Series item ${index} mismatch: expected=${expectedSeries[index]} actual=${actualSeries[index]}`,
        })
        break
      }
    }
  }
}

function compareRolling12MetricOrder(
  metric: "revenue" | "units",
  scope: string,
  expectedSnapshot: SnapshotSummary,
  actualSnapshot: SnapshotSummary,
  mismatches: Mismatch[]
) {
  const expectedRows = metric === "revenue"
    ? expectedSnapshot.rolling12?.revenue?.brands ?? []
    : expectedSnapshot.rolling12?.units?.brands ?? []
  const actualRows = metric === "revenue"
    ? actualSnapshot.rolling12?.revenue?.brands ?? []
    : actualSnapshot.rolling12?.units?.brands ?? []

  if (expectedRows.length !== actualRows.length) {
    mismatches.push({
      scope,
      message: `${metric} rolling 12 row count mismatch: expected=${expectedRows.length} actual=${actualRows.length}`,
    })
  }

  const maxRows = Math.min(expectedRows.length, actualRows.length)
  for (let index = 0; index < maxRows; index += 1) {
    const expected = expectedRows[index]
    const actual = actualRows[index]
    if (normalizeBrandForOrder(expected.brand) !== normalizeBrandForOrder(actual.brand)) {
      mismatches.push({
        scope,
        message: `${metric} rolling 12 rank ${index + 1} brand mismatch: expected=${expected.brand} actual=${actual.brand}`,
      })
      continue
    }
    if (actual.rank !== expected.rank) {
      mismatches.push({
        scope,
        message: `${metric} rolling 12 ${expected.brand} rank mismatch: expected=${expected.rank} actual=${actual.rank}`,
      })
    }
  }
}

function validateExplicitExpectation(
  scope: string,
  snapshot: SnapshotSummary | undefined,
  expectation: (typeof EXPLICIT_EXPECTATIONS)[number],
  mismatches: Mismatch[]
) {
  if (!snapshot) {
    mismatches.push({
      scope,
      message: "Snapshot missing.",
    })
    return
  }

  const totals = getBrandRolling12GrandTotals(snapshot, expectation.brand)
  if (!totals) {
    mismatches.push({
      scope,
      message: "Brand missing from rolling 12 totals.",
    })
    return
  }

  if (!sameRoundedNumber(totals.revenueGrandTotal, expectation.revenueGrandTotal, REVENUE_ROUNDING_TOLERANCE)) {
    mismatches.push({
      scope,
      message: `Revenue mismatch: expected=${expectation.revenueGrandTotal} actual=${Math.round(totals.revenueGrandTotal)}`,
    })
  }
  if (Math.round(totals.unitsGrandTotal) !== expectation.unitsGrandTotal) {
    mismatches.push({
      scope,
      message: `Units mismatch: expected=${expectation.unitsGrandTotal} actual=${Math.round(totals.unitsGrandTotal)}`,
    })
  }
}

function sameRoundedNumber(left: number, right: number, tolerance: number) {
  return Math.abs(Math.round(left) - Math.round(right)) <= tolerance
}

function listRolling12Brands(snapshot: SnapshotSummary) {
  const brands = [
    ...(snapshot.rolling12?.revenue?.brands ?? []).map((row) => row.brand),
    ...(snapshot.rolling12?.units?.brands ?? []).map((row) => row.brand),
  ]
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const brand of brands) {
    const key = brand.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    ordered.push(brand)
  }
  return ordered
}

function normalizeBrandForOrder(value: string) {
  return value.trim().toLowerCase()
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await closeDatabasePools()
    } catch (error) {
      console.error("Failed to close database pools after adjusted verification:", error)
      process.exitCode = 1
    }
  })
