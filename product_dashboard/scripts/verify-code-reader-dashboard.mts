import { getBrandRolling12GrandTotals } from "../lib/code-reader-brand-rolling12.ts"
import {
  loadDashboardDataFromFiles,
  loadDashboardDataFromPostgres,
  type SnapshotSummary,
} from "../lib/competitor-data.ts"
import {
  formatCodeReaderCurrencyCompact,
  formatCodeReaderUnitsCompact,
  percentChange,
} from "../lib/dashboard-format.ts"
import { closeDatabasePools } from "../lib/db/client.ts"

type Failure = {
  scope: string
  message: string
}

const TARGET_BRANDS = ["Innova", "BLCKTEC"] as const

async function main() {
  process.env.DASHBOARD_DEPLOYMENT_MODE ||= "full"
  const fileData = await loadDashboardDataFromFiles()
  const fileSnapshots = getCodeReaderSnapshots(fileData)
  const failures: Failure[] = []

  for (const snapshot of fileSnapshots) {
    validateSnapshotSeries(snapshot, failures)
  }

  validateJulyAcceptance(fileSnapshots, failures, "file")
  validateFormatters(failures)

  let postgresSnapshotCount = 0
  if (process.env.VERIFY_CODE_READER_POSTGRES === "1") {
    const postgresData = await loadDashboardDataFromPostgres(["code_reader_scanner"])
    const postgresSnapshots = getCodeReaderSnapshots(postgresData)
    postgresSnapshotCount = postgresSnapshots.length

    for (const snapshot of postgresSnapshots) {
      validateSnapshotSeries(snapshot, failures)
    }
    validateJulyAcceptance(postgresSnapshots, failures, "postgres")
    compareSnapshotSeries(fileSnapshots, postgresSnapshots, failures)
  }

  if (failures.length > 0) {
    console.error(`Code Reader dashboard verification failed with ${failures.length} issue(s).`)
    for (const failure of failures) {
      console.error(`[${failure.scope}] ${failure.message}`)
    }
    process.exitCode = 1
    return
  }

  const postgresSuffix = postgresSnapshotCount
    ? ` and ${postgresSnapshotCount} PostgreSQL snapshots`
    : ""
  console.log(
    `Code Reader dashboard verification passed for ${fileSnapshots.length} file snapshots${postgresSuffix}.`
  )
}

function getCodeReaderSnapshots(data: Awaited<ReturnType<typeof loadDashboardDataFromFiles>>) {
  return data.categories.find((category) => category.id === "code_reader_scanner")?.snapshots ?? []
}

function validateSnapshotSeries(snapshot: SnapshotSummary, failures: Failure[]) {
  for (const metricName of ["revenue", "units"] as const) {
    const metric = snapshot.rolling12?.[metricName]
    if (!metric) {
      failures.push({
        scope: `${snapshot.date}.${metricName}`,
        message: "Rolling 12 metric is missing.",
      })
      continue
    }

    for (const brandName of TARGET_BRANDS) {
      const row = metric.brands.find(
        (brand) => brand.brand.trim().toLowerCase() === brandName.toLowerCase()
      )
      if (!row) {
        failures.push({
          scope: `${snapshot.date}.${metricName}.${brandName}`,
          message: "Brand row is missing.",
        })
        continue
      }

      const series = row.monthlySeries ?? []
      if (series.length !== metric.monthLabels.length) {
        failures.push({
          scope: `${snapshot.date}.${metricName}.${brandName}`,
          message: `Expected ${metric.monthLabels.length} monthly points, received ${series.length}.`,
        })
        continue
      }
      if (series.length !== 12) {
        failures.push({
          scope: `${snapshot.date}.${metricName}.${brandName}`,
          message: `Expected a 12-month window, received ${series.length} points.`,
        })
      }

      const seriesTotal = series.reduce((sum, value) => sum + value, 0)
      const tolerance = metricName === "revenue" ? 2 : 0
      if (Math.abs(seriesTotal - row.grandTotal) > tolerance) {
        failures.push({
          scope: `${snapshot.date}.${metricName}.${brandName}`,
          message: `Series total ${seriesTotal} does not match grand total ${row.grandTotal}.`,
        })
      }
      if (series.at(-1) !== row.monthly) {
        failures.push({
          scope: `${snapshot.date}.${metricName}.${brandName}`,
          message: `Latest series value ${series.at(-1)} does not match monthly ${row.monthly}.`,
        })
      }
    }
  }
}

function validateJulyAcceptance(
  snapshots: SnapshotSummary[],
  failures: Failure[],
  source: "file" | "postgres"
) {
  const june = snapshots.find((snapshot) => snapshot.date === "2026-06-30")
  const july = snapshots.find((snapshot) => snapshot.date === "2026-07-31")
  if (!june || !july) {
    failures.push({
      scope: `${source}.2026-07-31`,
      message: "June or July acceptance snapshot is missing.",
    })
    return
  }

  const expectations = [
    { brand: "Innova", revenue: 19_177_986.08, units: 117_097, revenueLabel: "$19.2M", unitsLabel: "117K", revenueChange: 2.6, unitsChange: 1.7 },
    { brand: "BLCKTEC", revenue: 5_289_089.26, units: 45_945, revenueLabel: "$5.3M", unitsLabel: "46K", revenueChange: 3.2, unitsChange: 0.4 },
  ] as const

  for (const expectation of expectations) {
    const current = getBrandRolling12GrandTotals(july, expectation.brand)
    const previous = getBrandRolling12GrandTotals(june, expectation.brand)
    if (!current || !previous) {
      failures.push({
        scope: `2026-07-31.${expectation.brand}`,
        message: "Rolling 12 totals are missing.",
      })
      continue
    }

    const scope = `${source}.${expectation.brand}`
    assertClose(`${scope}.revenue`, current.revenueGrandTotal, expectation.revenue, 2, failures)
    assertClose(`${scope}.units`, current.unitsGrandTotal, expectation.units, 0, failures)
    assertEqual(
      `${scope}.revenueLabel`,
      formatCodeReaderCurrencyCompact(current.revenueGrandTotal),
      expectation.revenueLabel,
      failures
    )
    assertEqual(
      `${scope}.unitsLabel`,
      formatCodeReaderUnitsCompact(current.unitsGrandTotal),
      expectation.unitsLabel,
      failures
    )
    assertClose(
      `${scope}.revenueChange`,
      percentChange(current.revenueGrandTotal, previous.revenueGrandTotal) ?? 0,
      expectation.revenueChange,
      0.05,
      failures
    )
    assertClose(
      `${scope}.unitsChange`,
      percentChange(current.unitsGrandTotal, previous.unitsGrandTotal) ?? 0,
      expectation.unitsChange,
      0.05,
      failures
    )
  }
}

function compareSnapshotSeries(
  fileSnapshots: SnapshotSummary[],
  postgresSnapshots: SnapshotSummary[],
  failures: Failure[]
) {
  const postgresByDate = new Map(postgresSnapshots.map((snapshot) => [snapshot.date, snapshot]))
  if (fileSnapshots.length !== postgresSnapshots.length) {
    failures.push({
      scope: "parity.snapshots",
      message: `Snapshot count mismatch: file=${fileSnapshots.length} postgres=${postgresSnapshots.length}.`,
    })
  }

  for (const fileSnapshot of fileSnapshots) {
    const postgresSnapshot = postgresByDate.get(fileSnapshot.date)
    if (!postgresSnapshot) {
      failures.push({
        scope: `parity.${fileSnapshot.date}`,
        message: "Snapshot is missing from PostgreSQL.",
      })
      continue
    }

    for (const metricName of ["revenue", "units"] as const) {
      const fileMetric = fileSnapshot.rolling12?.[metricName]
      const postgresMetric = postgresSnapshot.rolling12?.[metricName]
      const metricScope = `parity.${fileSnapshot.date}.${metricName}`
      if (!fileMetric || !postgresMetric) {
        failures.push({ scope: metricScope, message: "Rolling 12 metric is missing." })
        continue
      }

      compareStringArray(
        `${metricScope}.monthLabels`,
        fileMetric.monthLabels,
        postgresMetric.monthLabels,
        failures
      )
      if (fileMetric.brands.length !== postgresMetric.brands.length) {
        failures.push({
          scope: `${metricScope}.brands`,
          message: `Brand count mismatch: file=${fileMetric.brands.length} postgres=${postgresMetric.brands.length}.`,
        })
      }

      const postgresByBrand = new Map(
        postgresMetric.brands.map((row) => [row.brand.trim().toLowerCase(), row])
      )
      for (const fileRow of fileMetric.brands) {
        const postgresRow = postgresByBrand.get(fileRow.brand.trim().toLowerCase())
        const rowScope = `${metricScope}.${fileRow.brand}`
        if (!postgresRow) {
          failures.push({ scope: rowScope, message: "Brand row is missing from PostgreSQL." })
          continue
        }
        assertClose(`${rowScope}.rank`, postgresRow.rank, fileRow.rank, 0, failures)
        assertClose(`${rowScope}.monthly`, postgresRow.monthly, fileRow.monthly, 0.01, failures)
        assertClose(`${rowScope}.grandTotal`, postgresRow.grandTotal, fileRow.grandTotal, 0.01, failures)
        compareNumberArray(
          `${rowScope}.monthlySeries`,
          fileRow.monthlySeries ?? [],
          postgresRow.monthlySeries ?? [],
          failures
        )
      }
    }
  }
}

function compareStringArray(
  scope: string,
  actual: string[],
  expected: string[],
  failures: Failure[]
) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    failures.push({ scope, message: "Array values do not match." })
  }
}

function compareNumberArray(
  scope: string,
  actual: number[],
  expected: number[],
  failures: Failure[]
) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => Math.abs(value - expected[index]) > 0.01)
  ) {
    failures.push({ scope, message: "Array values do not match." })
  }
}

function validateFormatters(failures: Failure[]) {
  assertEqual("format.revenue.38m", formatCodeReaderCurrencyCompact(38_000_000), "$38.0M", failures)
  assertEqual("format.revenue.32m", formatCodeReaderCurrencyCompact(32_352_069), "$32.4M", failures)
  assertEqual("format.revenue.438k", formatCodeReaderCurrencyCompact(438_513), "$438.5K", failures)
  assertEqual("format.units.117k", formatCodeReaderUnitsCompact(117_097), "117K", failures)
  assertEqual("format.units.294k", formatCodeReaderUnitsCompact(294_281), "294K", failures)
}

function assertEqual(scope: string, actual: string, expected: string, failures: Failure[]) {
  if (actual === expected) return
  failures.push({ scope, message: `Expected ${expected}, received ${actual}.` })
}

function assertClose(
  scope: string,
  actual: number,
  expected: number,
  tolerance: number,
  failures: Failure[]
) {
  if (Math.abs(actual - expected) <= tolerance) return
  failures.push({ scope, message: `Expected ${expected}, received ${actual}.` })
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDatabasePools()
  })
