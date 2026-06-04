import { closeDatabasePools } from "../lib/db/client.ts"
import { validateBrandRolling12Expectations } from "../lib/code-reader-brand-rolling12.ts"
import {
  type CategorySummary,
  type DashboardData,
  type SnapshotSummary,
  loadDashboardDataFromFiles,
  loadDashboardDataFromPostgres,
} from "../lib/competitor-data.ts"
import { loadReportFilesFromFiles, loadReportFilesFromPostgres } from "../lib/report-files.ts"
import {
  loadTypeSummariesFromFiles,
  loadTypeSummariesFromPostgres,
  type CategoryTypeSummary,
} from "../lib/type-summaries.ts"

type Mismatch = {
  scope: string
  message: string
}

const CODE_READER_GRAND_TOTAL_EXPECTATIONS = [
  {
    brand: "Innova",
    revenueGrandTotal: 14_541_709,
    unitsGrandTotal: 86_642,
  },
  {
    brand: "Autel",
    revenueGrandTotal: 64_035_702,
    unitsGrandTotal: 217_875,
  },
] as const

const CODE_READER_ROLLING12_PARITY_START_DATE = "2026-05-31"

async function main() {
  process.env.DASHBOARD_DEPLOYMENT_MODE ||= "full"

  const [fileData, postgresData, fileReports, postgresReports, fileTypeSummaries, postgresTypeSummaries] =
    await Promise.all([
      loadDashboardDataFromFiles(),
      loadDashboardDataFromPostgres(),
      loadReportFilesFromFiles(),
      loadReportFilesFromPostgres(),
      loadTypeSummariesFromFiles(),
      loadTypeSummariesFromPostgres(),
    ])

  const mismatches: Mismatch[] = []
  compareDashboard(fileData, postgresData, mismatches)
  compareReports(fileReports, postgresReports, mismatches)
  compareTypeSummaries(fileTypeSummaries, postgresTypeSummaries, mismatches)
  validateCodeReaderGrandTotals("file", fileData, mismatches)
  validateCodeReaderGrandTotals("postgres", postgresData, mismatches)

  if (mismatches.length > 0) {
    console.error(`Parity check failed with ${mismatches.length} mismatches.`)
    for (const mismatch of mismatches.slice(0, 50)) {
      console.error(`[${mismatch.scope}] ${mismatch.message}`)
    }
    process.exitCode = 1
    return
  }

  console.log("Parity check passed for dashboard data, report catalog, and type summaries.")
}

function compareDashboard(fileData: DashboardData, postgresData: DashboardData, mismatches: Mismatch[]) {
  compareStringLists(
    "dashboard.categories",
    fileData.categories.map((category) => category.id),
    postgresData.categories.map((category) => category.id),
    mismatches
  )

  const postgresByCategory = new Map(postgresData.categories.map((category) => [category.id, category]))
  for (const fileCategory of fileData.categories) {
    const postgresCategory = postgresByCategory.get(fileCategory.id)
    if (!postgresCategory) {
      mismatches.push({
        scope: `dashboard.${fileCategory.id}`,
        message: "Category missing from postgres dataset.",
      })
      continue
    }
    compareCategory(fileCategory, postgresCategory, mismatches)
  }
}

function compareCategory(fileCategory: CategorySummary, postgresCategory: CategorySummary, mismatches: Mismatch[]) {
  compareStringLists(
    `dashboard.${fileCategory.id}.snapshots`,
    fileCategory.snapshots.map((snapshot) => snapshot.date),
    postgresCategory.snapshots.map((snapshot) => snapshot.date),
    mismatches
  )

  const postgresByDate = new Map(postgresCategory.snapshots.map((snapshot) => [snapshot.date, snapshot]))
  for (const fileSnapshot of fileCategory.snapshots) {
    const postgresSnapshot = postgresByDate.get(fileSnapshot.date)
    if (!postgresSnapshot) {
      mismatches.push({
        scope: `dashboard.${fileCategory.id}.${fileSnapshot.date}`,
        message: "Snapshot missing from postgres dataset.",
      })
      continue
    }
    compareSnapshot(fileCategory.id, fileSnapshot, postgresSnapshot, mismatches)
  }
}

function compareSnapshot(
  categoryId: string,
  fileSnapshot: SnapshotSummary,
  postgresSnapshot: SnapshotSummary,
  mismatches: Mismatch[]
) {
  const scope = `dashboard.${categoryId}.${fileSnapshot.date}`
  compareNumber(scope, "totals.revenue", fileSnapshot.totals.revenue, postgresSnapshot.totals.revenue, mismatches)
  compareNumber(scope, "totals.units", fileSnapshot.totals.units, postgresSnapshot.totals.units, mismatches)
  compareNumber(scope, "totals.asinCount", fileSnapshot.totals.asinCount, postgresSnapshot.totals.asinCount, mismatches)
  compareNumber(scope, "totals.brandCount", fileSnapshot.totals.brandCount, postgresSnapshot.totals.brandCount, mismatches)
  compareNumber(scope, "totals.top3Share", fileSnapshot.totals.top3Share, postgresSnapshot.totals.top3Share, mismatches)

  compareStringLists(
    `${scope}.topProducts`,
    fileSnapshot.topProducts.slice(0, 10).map((item) => item.asin),
    postgresSnapshot.topProducts.slice(0, 10).map((item) => item.asin),
    mismatches
  )

  compareStringLists(
    `${scope}.brandTotals`,
    fileSnapshot.brandTotals.slice(0, 10).map((item) => `${item.brand}:${round(item.share)}`),
    postgresSnapshot.brandTotals.slice(0, 10).map((item) => `${item.brand}:${round(item.share)}`),
    mismatches
  )

  compareStringLists(
    `${scope}.priceTiers`,
    fileSnapshot.priceTiers.map((item) => `${item.label}:${round(item.share)}`),
    postgresSnapshot.priceTiers.map((item) => `${item.label}:${round(item.share)}`),
    mismatches
  )

  compareStringLists(
    `${scope}.qualityIssues`,
    (fileSnapshot.qualityIssues ?? []).map((item) => `${item.code}:${item.severity}`),
    (postgresSnapshot.qualityIssues ?? []).map((item) => `${item.code}:${item.severity}`),
    mismatches
  )

  if (
    categoryId === "code_reader_scanner" &&
    fileSnapshot.date >= CODE_READER_ROLLING12_PARITY_START_DATE
  ) {
    compareRolling12Metric(scope, "revenue", fileSnapshot, postgresSnapshot, mismatches)
    compareRolling12Metric(scope, "units", fileSnapshot, postgresSnapshot, mismatches)
  }
}

function compareRolling12Metric(
  scope: string,
  metric: "revenue" | "units",
  fileSnapshot: SnapshotSummary,
  postgresSnapshot: SnapshotSummary,
  mismatches: Mismatch[]
) {
  const fileRows = getRolling12Rows(fileSnapshot, metric)
  const postgresRows = getRolling12Rows(postgresSnapshot, metric)
  const metricScope = `${scope}.rolling12.${metric}`

  if (fileRows.length !== postgresRows.length) {
    mismatches.push({
      scope: metricScope,
      message: `Length mismatch: file=${fileRows.length} postgres=${postgresRows.length}`,
    })
  }

  const maxRows = Math.min(fileRows.length, postgresRows.length)
  for (let index = 0; index < maxRows; index += 1) {
    const fileRow = fileRows[index]
    const postgresRow = postgresRows[index]
    const rowScope = `${metricScope}.rank${index + 1}`

    if (fileRow.brand !== postgresRow.brand) {
      mismatches.push({
        scope: rowScope,
        message: `Brand order mismatch: file=${fileRow.brand} postgres=${postgresRow.brand}`,
      })
    }

    if (fileRow.rank !== postgresRow.rank) {
      mismatches.push({
        scope: rowScope,
        message: `Rank mismatch for ${fileRow.brand}: file=${fileRow.rank} postgres=${postgresRow.rank}`,
      })
    }

    compareNumber(
      rowScope,
      `${fileRow.brand}.grandTotal`,
      fileRow.grandTotal,
      postgresRow.grandTotal,
      mismatches
    )
  }
}

function getRolling12Rows(snapshot: SnapshotSummary, metric: "revenue" | "units") {
  return metric === "revenue"
    ? snapshot.rolling12?.revenue?.brands ?? []
    : snapshot.rolling12?.units?.brands ?? []
}

function compareReports(
  fileReports: Array<{ relativePath: string; name: string; category: string }>,
  postgresReports: Array<{ relativePath: string; name: string; category: string }>,
  mismatches: Mismatch[]
) {
  compareStringLists(
    "reports.catalog",
    fileReports.map((item) => `${item.relativePath}|${item.name}|${item.category}`).sort(),
    postgresReports.map((item) => `${item.relativePath}|${item.name}|${item.category}`).sort(),
    mismatches
  )
}

function compareTypeSummaries(
  fileSummaries: Record<string, CategoryTypeSummary | null>,
  postgresSummaries: Record<string, CategoryTypeSummary | null>,
  mismatches: Mismatch[]
) {
  const categoryIds = new Set([...Object.keys(fileSummaries), ...Object.keys(postgresSummaries)])
  for (const categoryId of categoryIds) {
    const fileSummary = fileSummaries[categoryId] ?? null
    const postgresSummary = postgresSummaries[categoryId] ?? null
    if (!fileSummary && !postgresSummary) continue
    if (!fileSummary || !postgresSummary) {
      mismatches.push({
        scope: `typeSummaries.${categoryId}`,
        message: "Summary exists on one side only.",
      })
      continue
    }

    compareStringLists(
      `typeSummaries.${categoryId}.sections`,
      fileSummary.sections.map((section) => `${section.title}:${section.rows.length}`),
      postgresSummary.sections.map((section) => `${section.title}:${section.rows.length}`),
      mismatches
    )
  }
}

function validateCodeReaderGrandTotals(
  scope: "file" | "postgres",
  data: DashboardData,
  mismatches: Mismatch[]
) {
  const category = data.categories.find((item) => item.id === "code_reader_scanner")
  const snapshot = category?.snapshots.find((item) => item.date === "2026-02-28")
  if (!snapshot) {
    mismatches.push({
      scope: `codeReaderGrandTotals.${scope}`,
      message: "Snapshot 2026-02-28 is missing for code reader.",
    })
    return
  }

  const results = validateBrandRolling12Expectations(
    snapshot,
    CODE_READER_GRAND_TOTAL_EXPECTATIONS.map((item) => ({ ...item }))
  )

  for (const result of results) {
    if (!result.revenuePassed) {
      mismatches.push({
        scope: `codeReaderGrandTotals.${scope}.${result.brand}`,
        message: `Revenue grand total mismatch: expected=${result.expectedRevenueGrandTotal} actual=${result.actualRevenueGrandTotal ?? "missing"}`,
      })
    }
    if (!result.unitsPassed) {
      mismatches.push({
        scope: `codeReaderGrandTotals.${scope}.${result.brand}`,
        message: `Units grand total mismatch: expected=${result.expectedUnitsGrandTotal} actual=${result.actualUnitsGrandTotal ?? "missing"}`,
      })
    }
  }
}

function compareNumber(scope: string, field: string, left: number, right: number, mismatches: Mismatch[]) {
  if (Math.abs(left - right) <= 0.01) return
  mismatches.push({
    scope,
    message: `${field} mismatch: file=${left} postgres=${right}`,
  })
}

function compareStringLists(scope: string, left: string[], right: string[], mismatches: Mismatch[]) {
  if (left.length !== right.length) {
    mismatches.push({
      scope,
      message: `Length mismatch: file=${left.length} postgres=${right.length}`,
    })
    return
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] === right[index]) continue
    mismatches.push({
      scope,
      message: `Item ${index} mismatch: file=${left[index]} postgres=${right[index]}`,
    })
    return
  }
}

function round(value: number) {
  return value.toFixed(6)
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
      console.error("Failed to close database pools after parity verification:", error)
      process.exitCode = 1
    }
  })
