// Guards the workbook share/MoM/YoY parsing contract (percent cells must land
// as ratios) across every archived month. Regression teeth, by parse path:
// analysis-side corruption trips the exactly-1.0 signature and brand-mix sum
// checks; report-side (rank tables, parsed via the same parseShare since the
// 2026-08 unification) trips the rank-table sum inflation/deflation traps and
// the coverage-normalized row check — rank shares parsed correctly even before
// the unification, so historical drills overstate nothing on that side.
import { readdir, readFile, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import * as XLSX from "xlsx"

import { loadCodeReaderScannerSnapshotFromFiles } from "../lib/code-reader-scanner-data.ts"

type CodeReaderManifest = {
  month?: string
  snapshotDate?: string
  sourceMode?: string
  reportFileName?: string
  analysisFileName?: string
  summaryFileName?: string
}

type Violation = {
  month: string
  scope: string
  label: string
  field: string
  value: unknown
  detail?: string
}

type WorkbookCellCounts = {
  percentCells: number
  bareShareCells: number
}

const PERCENT_CELL_PATTERN = /^-?\d+(\.\d+)?%$/
const SHARE_HEADER_ALIASES = [
  "qtyby",
  "marketunitshare",
  "revenueby",
  "marketrevshare",
  "mom",
  "yoy",
]
const SHARE_MIN = -0.005
const SHARE_MAX = 1.5
const CHANGE_MIN = -1.0001
// Growth-from-tiny-base rows are real in these workbooks (observed +62663%
// MoM = 626.63 as a ratio), so the ceiling only guards against another
// 100x scaling regression, not against legitimate spikes.
const CHANGE_MAX = 1000
const XLSXRuntime = (XLSX as typeof XLSX & { default?: typeof XLSX }).default ?? XLSX

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const archiveDir = path.join(appRoot, "data", "code_reader_scanner")

async function main() {
  const entries = await readdir(archiveDir, { withFileTypes: true })
  const months = entries
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const allViolations: Violation[] = []
  let auditedMonths = 0

  for (const month of months) {
    const monthDir = path.join(archiveDir, month)
    const analysisPath = await resolveOptionalFile(monthDir, "analysis.xlsx")
    const reportPath = await resolveOptionalFile(monthDir, "report.xlsx")
    const summaryPath = await resolveOptionalFile(monthDir, "summary.xlsx")

    // Report-only months (e.g. 202505) are still served by the app loader, so
    // they must be audited too — the production bug lived in report-sheet
    // share cells as much as in analysis blocks. A month directory with no
    // workbook at all is broken archive data and fails the audit.
    if (!analysisPath && !reportPath) {
      const violation: Violation = {
        month,
        scope: "archive",
        label: month,
        field: "workbooks",
        value: null,
        detail: "Month directory has neither report.xlsx nor analysis.xlsx.",
      }
      console.error(formatViolation(violation))
      allViolations.push(violation)
      console.log(`month=${month} SKIPPED (no workbooks) violations=1`)
      continue
    }
    auditedMonths += 1
    const manifest = await readManifest(path.join(monthDir, "manifest.json"))
    const workbookPaths = [analysisPath, reportPath].filter(
      (filePath): filePath is string => Boolean(filePath)
    )
    const counts = workbookPaths.reduce<WorkbookCellCounts>(
      (total, workbookPath) => {
        const next = countWorkbookCells(workbookPath)
        total.percentCells += next.percentCells
        total.bareShareCells += next.bareShareCells
        return total
      },
      { percentCells: 0, bareShareCells: 0 }
    )

    const monthViolations: Violation[] = []
    const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
      month,
      reportPath,
      analysisPath,
      summaryPath,
      manifest,
    })

    if (!snapshot) {
      monthViolations.push({
        month,
        scope: "snapshot",
        label: month,
        field: "load",
        value: null,
        detail: "Snapshot loader returned null.",
      })
    } else {
      const typeBreakdowns = snapshot.typeBreakdowns
      if (typeBreakdowns) {
        for (const collection of ["allAsins", "top50"] as const) {
          for (const row of typeBreakdowns[collection]) {
            const scope = `typeBreakdowns.${collection}.${row.scopeKey}`
            checkRatio(monthViolations, month, scope, row.label, "unitsShare", row.unitsShare)
            checkRatio(
              monthViolations,
              month,
              scope,
              row.label,
              "revenueShare",
              row.revenueShare
            )
            for (const field of [
              "revenueMoM",
              "revenueYoY",
              "unitsMoM",
              "unitsYoY",
              "avgPriceMoM",
              "avgPriceYoY",
            ] as const) {
              checkChange(monthViolations, month, scope, row.label, field, row[field])
            }
          }
        }

        for (const row of typeBreakdowns.categoryBrandMix) {
          const scope = `categoryBrandMix.${row.scopeKey}`
          checkRatio(monthViolations, month, scope, row.brand, "unitsShare", row.unitsShare)
          checkRatio(
            monthViolations,
            month,
            scope,
            row.brand,
            "revenueShare",
            row.revenueShare
          )
          checkChange(
            monthViolations,
            month,
            scope,
            row.brand,
            "revenueMoM",
            row.revenueMoM
          )
          checkChange(
            monthViolations,
            month,
            scope,
            row.brand,
            "revenueYoY",
            row.revenueYoY
          )
        }

        checkBrandMixSums(monthViolations, month, typeBreakdowns.categoryBrandMix)

        if (month === "202607") {
          printSentinel(
            typeBreakdowns.categoryBrandMix,
            "total_tablet",
            "innova",
            "revenueShare"
          )
          printSentinel(
            typeBreakdowns.categoryBrandMix,
            "total_dongle",
            "blcktec",
            "revenueShare"
          )
        }
      } else if (analysisPath || summaryPath) {
        // typeBreakdowns come from the analysis/summary workbooks; report-only
        // months legitimately lack them.
        monthViolations.push({
          month,
          scope: "typeBreakdowns",
          label: month,
          field: "presence",
          value: null,
          detail: "Parsed snapshot has no typeBreakdowns.",
        })
      }

      for (const metric of ["revenue", "units"] as const) {
        const rows = snapshot.summaryBrandRanks?.[metric] ?? []
        for (const row of rows) {
          checkRatio(
            monthViolations,
            month,
            `summaryBrandRanks.${metric}`,
            row.brand,
            "share",
            row.share
          )
        }
        checkRankTableShares(monthViolations, month, `summaryBrandRanks.${metric}`, metric, rows)
      }

      const brandTotalShareSum = snapshot.brandTotals.reduce(
        (total, row) => total + (Number.isFinite(row.share) ? row.share : 0),
        0
      )
      if (snapshot.brandTotals.length >= 3 && brandTotalShareSum > 1.2) {
        monthViolations.push({
          month,
          scope: "brandTotals",
          label: "sum",
          field: "shareSum",
          value: brandTotalShareSum,
          detail: `brandTotals shares sum to ${brandTotalShareSum.toFixed(3)} (> 1.2) — scaling regression signature.`,
        })
      }
      for (const row of snapshot.brandTotals) {
        checkRatio(monthViolations, month, "brandTotals", row.brand, "share", row.share)
      }
    }

    for (const violation of monthViolations) {
      console.error(formatViolation(violation))
    }
    console.log(
      `month=${month} percentCells=${counts.percentCells} bareShareCells=${counts.bareShareCells} violations=${monthViolations.length}`
    )
    allViolations.push(...monthViolations)
  }

  if (auditedMonths === 0) {
    console.error("No months audited — archive layout changed? Refusing to report a pass.")
    process.exitCode = 1
    return
  }

  if (allViolations.length > 0) {
    console.error(`Share parity audit failed with ${allViolations.length} violation(s).`)
    process.exitCode = 1
    return
  }

  console.log(`Share parity audit passed with 0 violations across ${auditedMonths} month(s).`)
}

function countWorkbookCells(workbookPath: string): WorkbookCellCounts {
  const workbook = XLSXRuntime.readFile(workbookPath, { raw: false })
  let percentCells = 0
  let bareShareCells = 0

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const rows = XLSXRuntime.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as Array<Array<string | number | boolean | null>>
    const textRows = rows.map((row) => row.map((cell) => `${cell ?? ""}`.trim()))

    for (const row of textRows) {
      for (const cell of row) {
        if (PERCENT_CELL_PATTERN.test(cell)) percentCells += 1
      }
    }

    const countedBareCells = new Set<string>()
    for (let headerIndex = 0; headerIndex < textRows.length; headerIndex += 1) {
      const header = textRows[headerIndex]
      const shareColumns = header
        .map((cell, columnIndex) => ({ cell: normalizeText(cell), columnIndex }))
        .filter(({ cell }) =>
          SHARE_HEADER_ALIASES.some((alias) => cell.includes(alias))
        )
        .map(({ columnIndex }) => columnIndex)

      if (!shareColumns.length) continue

      let blankRun = 0
      for (let rowIndex = headerIndex + 1; rowIndex < textRows.length; rowIndex += 1) {
        const row = textRows[rowIndex]
        if (row.every((cell) => cell === "")) {
          blankRun += 1
          if (blankRun >= 2) break
          continue
        }
        blankRun = 0

        const normalizedRow = row.map(normalizeText)
        if (
          normalizedRow.some((cell) =>
            SHARE_HEADER_ALIASES.some((alias) => cell.includes(alias))
          )
        ) {
          break
        }

        for (const columnIndex of shareColumns) {
          const cell = row[columnIndex]?.trim() ?? ""
          if (!isBareNumericCell(cell)) continue
          const key = `${rowIndex}:${columnIndex}`
          if (countedBareCells.has(key)) continue
          countedBareCells.add(key)
          bareShareCells += 1
        }
      }
    }
  }

  return { percentCells, bareShareCells }
}

function checkRankTableShares(
  violations: Violation[],
  month: string,
  scope: string,
  metric: "revenue" | "units",
  rows: Array<{ brand: string; share: number; monthlyRevenue: number; monthlyUnits: number }>
) {
  if (rows.length < 3) return

  const shareSum = rows.reduce((total, row) => total + (Number.isFinite(row.share) ? row.share : 0), 0)
  if (shareSum > 1.2) {
    violations.push({
      month,
      scope,
      label: "sum",
      field: "shareSum",
      value: shareSum,
      detail: `Rank-table shares sum to ${shareSum.toFixed(3)} (> 1.2) — scaling regression signature.`,
    })
    return
  }
  // Deflation trap: a /100-class regression drops a real ~0.7-0.9 top-25 sum
  // to ~0.008, which no per-row range check would notice.
  if (shareSum < 0.3 && rows.length >= 10) {
    violations.push({
      month,
      scope,
      label: "sum",
      field: "shareSum",
      value: shareSum,
      detail: `Rank-table shares sum to ${shareSum.toFixed(4)} (< 0.3 across ${rows.length} rows) — deflation regression signature.`,
    })
    return
  }

  // Row-level agreement, coverage-normalized so it works on truncated top-N
  // tables: reported shares are fractions of the FULL market while the
  // denominator below only spans listed rows, so compare
  // recomputed * shareSum ≈ value/market against the reported share. The
  // truncation term cancels; what remains is integer-percent rounding
  // (<= 0.005), so 0.01 is a comfortable tolerance. (Real tables sum to
  // 0.698-0.875 — top-25 truncations — measured across all 13 months.)
  const valueOf = (row: { monthlyRevenue: number; monthlyUnits: number }) =>
    metric === "revenue" ? row.monthlyRevenue : row.monthlyUnits
  const denominator = rows.reduce((total, row) => total + Math.max(0, valueOf(row)), 0)
  if (!(denominator > 0) || shareSum <= 0.3) return
  for (const row of rows) {
    const recomputed = (Math.max(0, valueOf(row)) / denominator) * shareSum
    if (Math.abs(recomputed - row.share) <= 0.01) continue
    violations.push({
      month,
      scope,
      label: row.brand,
      field: "share",
      value: row.share,
      detail: `Share ${row.share.toFixed(4)} disagrees with coverage-normalized recomputed ${recomputed.toFixed(4)} (tolerance 0.01).`,
    })
  }
}

function checkBrandMixSums(
  violations: Violation[],
  month: string,
  rows: Array<{
    scopeKey: string
    scopeLabel: string
    brand: string
    unitsShare: number
    revenueShare: number
  }>
) {
  const rowsByScope = new Map<string, typeof rows>()
  for (const row of rows) {
    const group = rowsByScope.get(row.scopeKey) ?? []
    group.push(row)
    rowsByScope.set(row.scopeKey, group)
  }

  for (const [scopeKey, group] of rowsByScope) {
    const nonTotalRows = group.filter((row) => {
      const brand = row.brand.trim()
      if (brand.toLowerCase().startsWith("total")) return false
      // Tier subtotal rows are labeled with the scope itself (for example,
      // brand="Tablet $800+") rather than with a "Total" prefix.
      return normalizeText(brand) !== normalizeText(row.scopeLabel)
    })
    if (nonTotalRows.length < 3) continue

    for (const field of ["revenueShare", "unitsShare"] as const) {
      // A single brand holding exactly 100% of a multi-brand scope is the
      // signature of the "1%" -> 1.0 scaling bug. Caveat: these sheets format
      // shares as integer percents, so a genuinely dominant brand at >=99.5%
      // would also print "100%" and trip this — accepted, since such a scope
      // would be effectively single-brand and deserves human eyes anyway.
      for (const row of nonTotalRows) {
        if (row[field] === 1) {
          violations.push({
            month,
            scope: `categoryBrandMix.${scopeKey}`,
            label: row.brand,
            field,
            value: row[field],
            detail: `Non-total row parsed as exactly 1.0 (100%) in a ${nonTotalRows.length}-row scope — percent-scaling regression signature.`,
          })
        }
      }

      const sum = nonTotalRows.reduce((total, row) => total + row[field], 0)
      if (Number.isFinite(sum) && sum >= 0.5 && sum <= 1.05) continue
      if (Number.isFinite(sum) && sum > 1.5) {
        // Rounding and denominator quirks top out around 1.24 in real
        // workbooks; anything past 1.5 means share values got scaled wrong.
        violations.push({
          month,
          scope: `categoryBrandMix.${scopeKey}`,
          label: nonTotalRows[0]?.scopeLabel ?? scopeKey,
          field: `${field}Sum`,
          value: sum,
          detail: `Expected ${field} sum for ${nonTotalRows.length} non-total rows to stay below 1.5.`,
        })
        continue
      }
      // Report-side quirk, not a parser defect: the workbooks' own blocks can
      // sum past 100% (integer rounding, and "Other" rows computed against a
      // different denominator — 202604 Dongle sums to 124% in the sheet
      // itself, matching our parse cell-for-cell). Surface it, don't fail.
      console.warn(
        `WARNING month=${month} scope=categoryBrandMix.${scopeKey} ` +
          `${field} sum=${sum.toFixed(4)} for ${nonTotalRows.length} non-total rows ` +
          `is outside [0.5, 1.05] — mirrors the report workbook, review upstream.`
      )
    }
  }
}

function checkRatio(
  violations: Violation[],
  month: string,
  scope: string,
  label: string,
  field: string,
  value: number
) {
  checkRange(violations, month, scope, label, field, value, SHARE_MIN, SHARE_MAX)
}

function checkChange(
  violations: Violation[],
  month: string,
  scope: string,
  label: string,
  field: string,
  value: number | null
) {
  if (value === null) return
  checkRange(violations, month, scope, label, field, value, CHANGE_MIN, CHANGE_MAX)
}

function checkRange(
  violations: Violation[],
  month: string,
  scope: string,
  label: string,
  field: string,
  value: number,
  min: number,
  max: number
) {
  if (Number.isFinite(value) && value >= min && value <= max) return
  violations.push({
    month,
    scope,
    label,
    field,
    value,
    detail: `Expected a value within [${min}, ${max}].`,
  })
}

function printSentinel(
  rows: Array<{ scopeKey: string; brand: string; revenueShare: number }>,
  scopeKey: string,
  brand: string,
  field: "revenueShare"
) {
  const row = rows.find(
    (candidate) =>
      candidate.scopeKey === scopeKey &&
      candidate.brand.trim().toLowerCase() === brand.toLowerCase()
  )
  console.log(
    `SENTINEL month=202607 scope=${scopeKey} brand=${brand} field=${field} value=${row?.[field] ?? "MISSING"}`
  )
}

function isBareNumericCell(value: string) {
  if (!value || value.includes("%")) return false
  return /^-?\d+(,\d{3})*(\.\d+)?$/.test(value)
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function formatViolation(violation: Violation) {
  const detail = violation.detail ? ` detail=${violation.detail}` : ""
  return `VIOLATION month=${violation.month} scope=${violation.scope} label=${JSON.stringify(violation.label)} field=${violation.field} value=${String(violation.value)}${detail}`
}

async function resolveOptionalFile(dir: string, fileName: string) {
  const filePath = path.join(dir, fileName)
  try {
    const fileStat = await stat(filePath)
    return fileStat.isFile() ? filePath : null
  } catch {
    return null
  }
}

async function readManifest(filePath: string): Promise<CodeReaderManifest | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as CodeReaderManifest
  } catch {
    return null
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
