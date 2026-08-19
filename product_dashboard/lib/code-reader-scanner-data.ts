import { constants as fsConstants } from "fs"
import { access, readdir, readFile } from "fs/promises"
import path from "path"
import * as XLSX from "xlsx"

import type {
  BrandSummary,
  CategoryBrandMixMetric,
  DataQualityIssue,
  ProductSummary,
  Rolling12Metric,
  SnapshotSummary,
  SummaryBrandRankRow,
  SummaryBrandRanks,
  TierAsinRankRow,
  TierAsinRankSection,
  TypeBreakdownMetric,
  TypeBreakdownSummary,
} from "@/lib/competitor-data"
import { formatSnapshotLabelMonthEnd, normalizeSnapshotDate } from "@/lib/snapshot-date"

type ManifestFile = {
  month?: string
  snapshotDate?: string
  sourceMode?: string
  reportFileName?: string
  analysisFileName?: string
  summaryFileName?: string
}

type SummaryRow = {
  brand: string
  listings: number
  revenue: number
  units: number
  share?: number
  pricePerUnit?: number
  reviewCount?: number
  rating?: number
}

type RollingRow = {
  brand: string
  values: number[]
  monthly: number
  grandTotal: number
}

type ParsedRollingSection = {
  monthLabels: string[]
  currentMonthLabel: string
  brandRows: RollingRow[]
  totalRow?: RollingRow
  totalMarketRow?: RollingRow
}

type ParsedRolling = {
  revenue?: ParsedRollingSection
  units?: ParsedRollingSection
}

type ParsedReport = {
  summaryRows: SummaryRow[]
  summaryBrandRanks?: SummaryBrandRanks
  top50ByRevenue: ProductSummary[]
  top50ByUnits: ProductSummary[]
  rolling12: ParsedRolling
  brandSheetListings: Array<{ brand: string; products: ProductSummary[] }>
}

type ParsedTypeBreakdowns = {
  allAsins: TypeBreakdownMetric[]
  top50: TypeBreakdownMetric[]
  categoryBrandMix: CategoryBrandMixMetric[]
  tierAsinRanks: TierAsinRankSection[]
  source: "analysis" | "summary" | "fallback"
}

type CategoryBrandMixBlock = {
  scopeKey: string
  rows: CategoryBrandMixMetric[]
  fromDedicatedTab: boolean
}

type MixDedupeEntry = {
  row: CategoryBrandMixMetric
  fromDedicatedTab: boolean
}

const RESERVED_SHEETS = new Set(
  [
    "summary",
    "rolling 12 mo",
    "top 50",
    "sheet1",
    "category",
    "tablet total",
    "tablet $800+",
    "tablet $400-$800",
    "tablet $400-",
    "handheld total",
    "handheld $75+",
    "handheld $75-",
    "dongle",
    "other tools",
  ].map((value) => normalizeSheetName(value))
)

const DETAILED_PRICE_TIER_KEYS = new Set([
  "tablet_800_plus",
  "tablet_400_800",
  "tablet_under_400",
  "handheld_75_plus",
  "handheld_under_75",
  "total_dongle",
  "total_other_tools",
])

const TIER_SCOPE_KEYS = new Set([
  "total_tablet",
  "tablet_800_plus",
  "tablet_400_800",
  "tablet_under_400",
  "total_handheld",
  "handheld_75_plus",
  "handheld_under_75",
  "total_dongle",
  "total_other_tools",
])

const FALLBACK_PRICE_TIERS = [
  { label: "$0-40", min: 0, max: 40 },
  { label: "$40-60", min: 40, max: 60 },
  { label: "$60-90", min: 60, max: 90 },
  { label: "$90+", min: 90, max: Number.POSITIVE_INFINITY },
]

const KNOWN_TYPE_SHEETS = [
  "Tablet Total",
  "Tablet $800+",
  "Tablet $400-$800",
  "Tablet $400-",
  "Handheld Total",
  "Handheld $75+",
  "Handheld $75-",
  "Dongle",
  "Other Tools",
]

export async function loadCodeReaderScannerSnapshots(baseDir: string): Promise<SnapshotSummary[]> {
  const entries = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
  const monthDirs = entries
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const snapshots: SnapshotSummary[] = []

  for (const month of monthDirs) {
    const monthDir = path.join(baseDir, month)
    const manifest = await readManifest(path.join(monthDir, "manifest.json"))
    const reportPath = await resolvePreferredFile(monthDir, [
      "report.xlsx",
      asRelativeFileName(manifest?.reportFileName),
    ])
    const analysisPath = await resolvePreferredFile(monthDir, [
      "analysis.xlsx",
      asRelativeFileName(manifest?.analysisFileName),
    ])
    const summaryPath = await resolvePreferredFile(monthDir, [
      "summary.xlsx",
      asRelativeFileName(manifest?.summaryFileName),
    ])
    const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
      month,
      reportPath,
      analysisPath,
      summaryPath,
      manifest,
    })
    if (snapshot) {
      snapshots.push(snapshot)
    }
  }

  return snapshots.sort((a, b) => a.date.localeCompare(b.date))
}

export async function loadCodeReaderScannerSnapshotFromFiles(params: {
  month: string
  reportPath: string | null
  analysisPath?: string | null
  summaryPath?: string | null
  manifest?: ManifestFile | null
}) {
  const issues: DataQualityIssue[] = []

  if (!params.reportPath) {
    issues.push({
      code: "missing_report",
      severity: "error",
      message: `Missing report workbook for month ${params.month}`,
    })
    return null
  }

  let parsedReport: ParsedReport
  try {
    parsedReport = await parseReportWorkbook(params.reportPath, issues)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown parse error"
    console.error(
      `[code_reader_scanner] Skipping month ${params.month}. Failed to parse ${params.reportPath}: ${message}`
    )
    issues.push({
      code: "report_parse_failed",
      severity: "error",
      message,
    })
    return null
  }

  let typeBreakdowns: ParsedTypeBreakdowns | undefined
  if (params.analysisPath) {
    typeBreakdowns = await parseTypeWorkbook(params.analysisPath, "analysis", issues)
  } else if (params.summaryPath) {
    typeBreakdowns = await parseTypeWorkbook(params.summaryPath, "summary", issues)
  } else {
    issues.push({
      code: "missing_type_source",
      severity: "warning",
      message: `Month ${params.month} is missing both analysis.xlsx and summary.xlsx`,
    })
  }

  const snapshotDate = resolveSnapshotDate(params.month, params.manifest?.snapshotDate)
  return buildSnapshot(snapshotDate, parsedReport, typeBreakdowns, issues)
}

async function parseReportWorkbook(reportPath: string, issues: DataQualityIssue[]): Promise<ParsedReport> {
  const workbook = await readWorkbook(reportPath)

  const summarySheet = findSheet(workbook, "Summary")
  const rollingSheet = findSheet(workbook, "Rolling 12 mo")
  const top50Sheet = findSheet(workbook, "Top 50")

  if (!summarySheet) {
    issues.push({
      code: "missing_summary_sheet",
      severity: "warning",
      message: "Workbook is missing Summary sheet",
    })
  }
  if (!rollingSheet) {
    issues.push({
      code: "missing_rolling_sheet",
      severity: "warning",
      message: "Workbook is missing Rolling 12 mo sheet",
    })
  }
  if (!top50Sheet) {
    issues.push({
      code: "missing_top50_sheet",
      severity: "warning",
      message: "Workbook is missing Top 50 sheet",
    })
  }

  const summarySheetRows = summarySheet ? sheetRows(summarySheet) : []
  const summaryRows = summarySheet ? parseSummaryRows(summarySheetRows) : []
  const summaryBrandRanks = summarySheet
    ? parseSummaryBrandRankTables(summarySheetRows)
    : undefined
  const rolling12 = rollingSheet ? parseRollingSheet(sheetRows(rollingSheet), issues) : {}
  const { revenueProducts, unitsProducts } = top50Sheet
    ? parseDualProductTables(sheetRows(top50Sheet), issues)
    : { revenueProducts: [] as ProductSummary[], unitsProducts: [] as ProductSummary[] }

  const brandSheetListings = parseBrandSheetListings(workbook, issues)

  return {
    summaryRows,
    summaryBrandRanks,
    top50ByRevenue: revenueProducts,
    top50ByUnits: unitsProducts,
    rolling12,
    brandSheetListings,
  }
}

function parseRollingSheet(rows: string[][], issues: DataQualityIssue[]): ParsedRolling {
  const headers: Array<{ index: number; metric: "revenue" | "units" }> = []

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i]
    if (!isRollingHeaderRow(row)) continue

    const metric = detectRollingMetric(rows, i, headers.length)
    if (!metric) continue
    if (headers.some((item) => item.metric === metric)) continue
    headers.push({ index: i, metric })
    if (headers.length >= 2) break
  }

  const parsed: ParsedRolling = {}
  for (const entry of headers) {
    const section = parseRollingSection(rows, entry.index)
    if (!section) continue
    parsed[entry.metric] = section
  }

  if (!parsed.revenue && !parsed.units) {
    issues.push({
      code: "rolling_parse_failed",
      severity: "warning",
      message: "Unable to parse Rolling 12 mo sections",
    })
  }

  return parsed
}

function parseRollingSection(rows: string[][], headerIndex: number): ParsedRollingSection | null {
  const header = rows[headerIndex]
  const brandCol = findStrictColumn(header, ["brand"])
  if (brandCol < 0) return null

  let grandTotalCol = findColumn(header, ["grandtotal", "12morevenue", "12mounits"])
  if (grandTotalCol < 0) {
    grandTotalCol = header.length - 1
  }

  const monthColumns: number[] = []
  for (let i = brandCol + 1; i < grandTotalCol; i += 1) {
    if (getCell(header, i)) monthColumns.push(i)
  }

  if (!monthColumns.length) return null

  const monthLabels = monthColumns.map((columnIndex) => getCell(header, columnIndex))
  const currentMonthLabel = monthLabels[monthLabels.length - 1]

  const brandRows: RollingRow[] = []
  let totalRow: RollingRow | undefined
  let totalMarketRow: RollingRow | undefined
  let blankRun = 0

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const row = rows[rowIndex]

    if (isRollingHeaderRow(row) && rowIndex > headerIndex + 1) {
      break
    }

    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    const brand = getCell(row, brandCol).trim()
    if (!brand) continue

    const normalizedBrand = normalizeText(brand)
    if (normalizedBrand === "brand") continue
    if (normalizedBrand.includes("monthlyrevenue") || normalizedBrand.includes("monthlyunits")) {
      break
    }

    const values = monthColumns.map((columnIndex) => parseNumber(getCell(row, columnIndex)))
    const monthly = values[values.length - 1] ?? 0
    const computedGrandTotal = values.reduce((sum, value) => sum + value, 0)
    const grandTotalCell = grandTotalCol >= 0 ? getCell(row, grandTotalCol).trim() : ""
    const parsedGrandTotal =
      grandTotalCell && grandTotalCell.toLowerCase() !== "n/a"
        ? parseNumber(grandTotalCell)
        : null
    const grandTotal =
      parsedGrandTotal && parsedGrandTotal !== 0
        ? parsedGrandTotal
        : computedGrandTotal

    const parsedRow: RollingRow = {
      brand,
      values,
      monthly,
      grandTotal,
    }

    if (normalizedBrand === "total") {
      totalRow = parsedRow
      continue
    }
    if (normalizedBrand === "totalmarket") {
      totalMarketRow = parsedRow
      continue
    }

    brandRows.push(parsedRow)
  }

  if (!brandRows.length) return null

  return {
    monthLabels,
    currentMonthLabel,
    brandRows,
    totalRow,
    totalMarketRow,
  }
}

function detectRollingMetric(
  rows: string[][],
  headerIndex: number,
  parsedSections: number
): "revenue" | "units" | null {
  const joined = normalizeText(rows[headerIndex].join(" "))
  if (joined.includes("monthlysales") || joined.includes("monthlyunits")) {
    return "units"
  }
  if (joined.includes("monthlyrevenue")) {
    return "revenue"
  }

  for (let i = headerIndex - 1; i >= Math.max(0, headerIndex - 3); i -= 1) {
    const previous = normalizeText(rows[i].join(" "))
    if (previous.includes("monthlyunits") || previous.includes("monthlysales")) {
      return "units"
    }
    if (previous.includes("monthlyrevenue")) {
      return "revenue"
    }
  }

  if (parsedSections === 0) return "revenue"
  if (parsedSections === 1) return "units"
  return null
}

function isRollingHeaderRow(row: string[]): boolean {
  const brandCol = findStrictColumn(row, ["brand"])
  if (brandCol < 0) return false
  const normalized = row.map(normalizeText)
  const hasGrandTotal = normalized.some(
    (cell) =>
      cell.includes("grandtotal") || cell.includes("12morevenue") || cell.includes("12mounits")
  )
  if (!hasGrandTotal) return false

  const hasPeriodLabels = normalized.some(
    (cell) =>
      cell.includes("monthlyrevenue") ||
      cell.includes("monthlysales") ||
      cell.includes("monthlyunits") ||
      cell.includes("january") ||
      cell.includes("february") ||
      cell.includes("march") ||
      cell.includes("april") ||
      cell.includes("may") ||
      cell.includes("june") ||
      cell.includes("july") ||
      cell.includes("august") ||
      cell.includes("september") ||
      cell.includes("october") ||
      cell.includes("november") ||
      cell.includes("december")
  )
  if (!hasPeriodLabels) return false

  const nonEmptyCells = row.filter((cell) => cell.trim() !== "")
  return nonEmptyCells.length >= 4
}

function parseDualProductTables(
  rows: string[][],
  issues: DataQualityIssue[],
  options?: { defaultBrand?: string; maxRows?: number }
) {
  const revenueMarker = findMarkerRow(rows, ["rank", "revenue"])
  const unitsMarker = findMarkerRow(rows, ["rank", "units"])

  const headerRows = findProductHeaderRows(rows, !options?.defaultBrand)

  const revenueHeader =
    revenueMarker >= 0
      ? findNextHeaderAfter(headerRows, revenueMarker)
      : (headerRows[0] ?? -1)
  const unitsHeader =
    unitsMarker >= 0
      ? findNextHeaderAfter(headerRows, unitsMarker)
      : (headerRows[1] ?? revenueHeader)

  if (revenueHeader < 0) {
    issues.push({
      code: "top50_parse_failed",
      severity: "warning",
      message: "Unable to locate Top 50 revenue header row",
    })
    return {
      revenueProducts: [] as ProductSummary[],
      unitsProducts: [] as ProductSummary[],
    }
  }

  const revenueProducts = parseProductTable(
    rows,
    revenueHeader,
    "revenue",
    options?.defaultBrand,
    options?.maxRows ?? 50
  )
  const unitsProducts = unitsHeader >= 0
    ? parseProductTable(rows, unitsHeader, "units", options?.defaultBrand, options?.maxRows ?? 50)
    : []

  if (!unitsProducts.length && revenueProducts.length) {
    return {
      revenueProducts,
      unitsProducts: [...revenueProducts]
        .sort((a, b) => b.units - a.units)
        .slice(0, options?.maxRows ?? 50),
    }
  }

  return {
    revenueProducts,
    unitsProducts,
  }
}

function parseBrandSheetListings(
  workbook: XLSX.WorkBook,
  issues: DataQualityIssue[]
): Array<{ brand: string; products: ProductSummary[] }> {
  const output: Array<{ brand: string; products: ProductSummary[] }> = []

  for (const sheetName of workbook.SheetNames) {
    if (RESERVED_SHEETS.has(normalizeSheetName(sheetName))) continue

    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const rows = sheetRows(sheet)
    const { revenueProducts, unitsProducts } = parseDualProductTables(rows, [], {
      defaultBrand: sheetName.trim(),
      maxRows: Number.POSITIVE_INFINITY,
    })

    const merged = mergeProductLists(revenueProducts, unitsProducts)
    if (!merged.length) continue

    output.push({
      brand: sheetName.trim(),
      products: merged,
    })
  }

  if (!output.length) {
    issues.push({
      code: "brand_tab_parse_failed",
      severity: "warning",
      message: "Unable to parse brand-specific tabs",
    })
  }

  return output.sort((a, b) => a.brand.localeCompare(b.brand))
}

async function parseTypeWorkbook(
  workbookPath: string,
  preferredSource: "analysis" | "summary",
  issues: DataQualityIssue[]
): Promise<ParsedTypeBreakdowns | undefined> {
  try {
    const workbook = await readWorkbook(workbookPath)

    if (preferredSource === "analysis") {
      const parsed = parseAnalysisTypeBreakdowns(workbook)
      if (parsed) return parsed
      issues.push({
        code: "analysis_parse_failed",
        severity: "warning",
        message: `Unable to parse analysis workbook ${path.basename(workbookPath)}`,
      })
    }

    const parsedSummary = parseRawSummaryBreakdowns(workbook)
    if (parsedSummary) return parsedSummary

    issues.push({
      code: "summary_parse_failed",
      severity: "warning",
      message: `Unable to parse summary workbook ${path.basename(workbookPath)}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown workbook parse error"
    issues.push({
      code: "type_workbook_read_failed",
      severity: "warning",
      message,
    })
  }

  return undefined
}

function parseAnalysisTypeBreakdowns(workbook: XLSX.WorkBook): ParsedTypeBreakdowns | undefined {
  const summarySheet = findSheet(workbook, "Summary")
  const top50Sheet = findSheet(workbook, "Top 50")

  const allAsins = summarySheet ? parseScopeMetricTable(sheetRows(summarySheet)) : []
  const top50 = top50Sheet ? parseScopeMetricTable(sheetRows(top50Sheet)) : []

  const brandMixBlocks: CategoryBrandMixBlock[] = []
  const tierAsinRanks: TierAsinRankSection[] = []
  for (const sheetName of KNOWN_TYPE_SHEETS) {
    const sheet = findSheet(workbook, sheetName)
    if (!sheet) continue
    const rows = sheetRows(sheet)
    brandMixBlocks.push(...parseCategoryBrandMixBlocks(rows, sheetName))
    tierAsinRanks.push(...parseTierAsinRankSections(rows, toScopeKey(sheetName)))
  }
  const categoryBrandMix = dedupeCategoryBrandMixRows(brandMixBlocks)

  if (!allAsins.length && !top50.length && !categoryBrandMix.length && !tierAsinRanks.length) {
    return undefined
  }

  return {
    allAsins,
    top50,
    categoryBrandMix,
    tierAsinRanks,
    source: "analysis",
  }
}

function parseRawSummaryBreakdowns(workbook: XLSX.WorkBook): ParsedTypeBreakdowns | undefined {
  const sheet1 = findSheet(workbook, "Sheet1")
  if (!sheet1) return undefined

  const rows = sheetRows(sheet1)
  const headerIndex = findHeaderRow(rows, [["brand"], ["category"], ["revenuemo"]])
  if (headerIndex < 0) return undefined

  const header = rows[headerIndex]
  const brandCol = findColumn(header, ["brand"])
  const categoryCol = findColumn(header, ["category"])

  const allAsins: TypeBreakdownMetric[] = []
  const top50: TypeBreakdownMetric[] = []

  let blankRun = 0
  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    const brand = getCell(row, brandCol).trim()
    const category = getCell(row, categoryCol).trim()
    if (!brand || !category) continue

    const metric = metricFromRow(header, row, category)
    if (!metric) continue

    const normalizedBrand = normalizeText(brand)
    if (normalizedBrand === "total") {
      allAsins.push(metric)
    }
    if (normalizedBrand === "top50") {
      top50.push(metric)
    }
  }

  const categorySheet = findSheet(workbook, "Category")
  const categoryBrandMix = categorySheet
    ? parseRawCategoryBrandMix(sheetRows(categorySheet))
    : []

  if (!allAsins.length && !top50.length && !categoryBrandMix.length) {
    return undefined
  }

  return {
    allAsins,
    top50,
    categoryBrandMix,
    tierAsinRanks: [],
    source: "summary",
  }
}

function parseScopeMetricTable(rows: string[][]): TypeBreakdownMetric[] {
  const headerIndex = findHeaderRow(rows, [["avgprice"], ["quantitymo", "monthlysales"], ["revenuemo", "monthlyrevenue"]])
  if (headerIndex < 0) return []

  const header = rows[headerIndex]
  const labelCol = findLabelColumn(header)
  if (labelCol < 0) return []

  const output: TypeBreakdownMetric[] = []
  let blankRun = 0

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    const label = getCell(row, labelCol).trim()
    if (!label || normalizeText(label) === "brand") continue
    if (normalizeText(label).includes("monthlysummary")) break

    const metric = metricFromRow(header, row, label)
    if (!metric) continue
    output.push(metric)
  }

  return output
}

/**
 * Tier tabs stack 1-4 brand-mix blocks (e.g. "Tablet Total" repeats its three sub-tiers
 * below the overall block). Every block is parsed and attributed to the scope key derived
 * from the block's own label row, not from the containing tab.
 */
function parseCategoryBrandMixBlocks(rows: string[][], sheetName: string): CategoryBrandMixBlock[] {
  const headerIndices = findCategoryBrandMixHeaderRows(rows)
  if (!headerIndices.length) return []

  const tabScopeKey = toScopeKey(sheetName)
  const blocks: CategoryBrandMixBlock[] = []

  for (let position = 0; position < headerIndices.length; position += 1) {
    const headerIndex = headerIndices[position]
    const nextHeaderIndex = headerIndices[position + 1] ?? -1
    // Stop one row short of the next header so its label row is not read as a brand.
    const endExclusive = nextHeaderIndex > 0 ? nextHeaderIndex - 1 : rows.length

    const blockLabel = resolveBlockScopeLabel(rows, headerIndex, sheetName)
    const scopeKey = toScopeKey(blockLabel)
    const blockRows = parseCategoryBrandMixBlockRows(
      rows,
      headerIndex,
      endExclusive,
      scopeKey,
      blockLabel
    )
    if (!blockRows.length) continue

    blocks.push({
      scopeKey,
      rows: blockRows,
      fromDedicatedTab: scopeKey === tabScopeKey,
    })
  }

  return blocks
}

function parseCategoryBrandMixBlockRows(
  rows: string[][],
  headerIndex: number,
  endExclusive: number,
  scopeKey: string,
  scopeLabel: string
): CategoryBrandMixMetric[] {
  const header = rows[headerIndex]
  const brandCol = findLabelColumn(header)
  if (brandCol < 0) return []

  const output: CategoryBrandMixMetric[] = []
  let blankRun = 0

  for (let i = headerIndex + 1; i < Math.min(endExclusive, rows.length); i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    if (normalizeText(row.join(" ")).includes("rankby")) break

    const brand = getCell(row, brandCol).trim()
    if (!brand || normalizeText(brand) === "brand" || normalizeText(brand) === "0") continue

    output.push({
      scopeKey,
      scopeLabel: prettyScopeLabel(scopeLabel),
      brand,
      avgPrice: readMetricCell(header, row, ["avgprice"]),
      units: readMetricCell(header, row, ["quantitymo", "monthlysales"]),
      unitsShare: readMetricShare(header, row, ["qtyby", "marketunitshare"]),
      revenue: readMetricCell(header, row, ["revenuemo", "monthlyrevenue"]),
      revenueShare: readMetricShare(header, row, ["revenueby", "marketrevshare"]),
      revenueMoM: readMetricNullablePercent(header, row, ["revenuemom"]),
      revenueYoY: readMetricNullablePercent(header, row, ["revenueyoy"]),
    })
  }

  return output
}

function findCategoryBrandMixHeaderRows(rows: string[][]): number[] {
  const indices: number[] = []
  for (let i = 0; i < rows.length; i += 1) {
    const normalized = rows[i].map(normalizeText)
    const has = (alias: string) => normalized.some((cell) => cell.includes(alias))
    if (!has("avgprice")) continue
    if (!has("quantitymo")) continue
    if (!has("revenuemo")) continue
    indices.push(i)
  }
  return indices
}

/**
 * Block labels sit on the first non-empty row above the block header
 * (e.g. "Tablet Overall", "Tablet $800+"). Anything that does not resolve to a known
 * tier scope key falls back to the containing tab name.
 */
function resolveBlockScopeLabel(
  rows: string[][],
  headerIndex: number,
  fallbackLabel: string
): string {
  for (let i = headerIndex - 1; i >= Math.max(0, headerIndex - 4); i -= 1) {
    const cell = rows[i].find((value) => value.trim() !== "")
    if (!cell) continue
    return TIER_SCOPE_KEYS.has(toScopeKey(cell)) ? cell.trim() : fallbackLabel
  }
  return fallbackLabel
}

function dedupeCategoryBrandMixRows(blocks: CategoryBrandMixBlock[]): CategoryBrandMixMetric[] {
  const order: string[] = []
  const byKey = new Map<string, MixDedupeEntry>()

  for (const block of blocks) {
    for (const row of block.rows) {
      const key = `${row.scopeKey}::${normalizeText(row.brand)}`
      const existing = byKey.get(key)
      if (!existing) {
        byKey.set(key, { row, fromDedicatedTab: block.fromDedicatedTab })
        order.push(key)
        continue
      }
      if (!existing.fromDedicatedTab && block.fromDedicatedTab) {
        byKey.set(key, { row, fromDedicatedTab: true })
      }
    }
  }

  const byBrand = order
    .map((key) => byKey.get(key))
    .filter((entry): entry is MixDedupeEntry => Boolean(entry))

  return dropDuplicateValueRows(byBrand)
}

/**
 * A few months name the same underlying row differently between the containing tab and the
 * dedicated tab (Dec 2025 - Mar 2026 handheld $75-: "vdiagtool" vs "zmoon"), which the
 * brand-keyed pass cannot merge. Collapse rows only when their ENTIRE numeric tuple is
 * identical within a scope, keeping the dedicated tab's row and its brand name. Any
 * difference in any field (including null vs 0) leaves both rows intact.
 */
function dropDuplicateValueRows(entries: MixDedupeEntry[]): CategoryBrandMixMetric[] {
  const winnerIndexByValue = new Map<string, number>()

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    const valueKey = `${entry.row.scopeKey}::${categoryBrandMixValueKey(entry.row)}`
    const currentIndex = winnerIndexByValue.get(valueKey)
    if (currentIndex === undefined) {
      winnerIndexByValue.set(valueKey, index)
      continue
    }
    if (!entries[currentIndex].fromDedicatedTab && entry.fromDedicatedTab) {
      winnerIndexByValue.set(valueKey, index)
    }
  }

  const survivors = new Set(winnerIndexByValue.values())
  return entries.filter((_, index) => survivors.has(index)).map((entry) => entry.row)
}

const MIX_VALUE_FIELDS = [
  "avgPrice",
  "units",
  "unitsShare",
  "revenue",
  "revenueShare",
  "revenueMoM",
  "revenueYoY",
] as const

// Sentinel is non-numeric, so a null can never compare equal to any number's String() form.
const MIX_VALUE_NULL_SENTINEL = "<null>"

function categoryBrandMixValueKey(row: CategoryBrandMixMetric): string {
  return MIX_VALUE_FIELDS.map((field) => {
    const value = row[field]
    return value === null ? MIX_VALUE_NULL_SENTINEL : String(value)
  }).join("|")
}

/**
 * Every tier tab carries "Rank By Monthly Revenue - <Mon> 'YY ONLY" and
 * "Rank By Monthly Units - ..." sections (10 ASINs each). Missing sections are tolerated.
 */
function parseTierAsinRankSections(rows: string[][], scopeKey: string): TierAsinRankSection[] {
  const sections: TierAsinRankSection[] = []

  for (let i = 0; i < rows.length; i += 1) {
    const normalized = normalizeText(rows[i].join(" "))
    if (!normalized.includes("rankby")) continue

    const metric: "revenue" | "units" | null =
      normalized.includes("monthlyunits") || normalized.includes("monthlysales")
        ? "units"
        : normalized.includes("monthlyrev")
          ? "revenue"
          : null
    if (!metric) continue
    if (sections.some((section) => section.metric === metric)) continue

    const headerIndex = findAsinRankHeaderRow(rows, i)
    if (headerIndex < 0) continue

    const parsedRows = parseTierAsinRankRows(rows, headerIndex)
    if (!parsedRows.length) continue

    sections.push({ scopeKey, metric, rows: parsedRows })
    i = headerIndex
  }

  return sections
}

function findAsinRankHeaderRow(rows: string[][], markerIndex: number): number {
  for (let i = markerIndex + 1; i < Math.min(rows.length, markerIndex + 4); i += 1) {
    const normalized = rows[i].map(normalizeText)
    const has = (alias: string) => normalized.some((cell) => cell.includes(alias))
    if (has("asin") && has("rank") && has("price")) return i
  }
  return -1
}

function parseTierAsinRankRows(rows: string[][], headerIndex: number): TierAsinRankRow[] {
  const header = rows[headerIndex]
  const rankCol = findColumn(header, ["ranking"])
  const asinCol = findColumn(header, ["asin"])
  const titleCol = findColumn(header, ["productname", "title"])
  const brandCol = findColumn(header, ["brand"])
  const typeCol = findColumn(header, ["type"])
  const priceCol = findColumn(header, ["price"])
  const revenueCol = findColumn(header, [
    "estmonthlyretailrev",
    "monthlyrevenue",
    "monthlyrev",
    "revenuemo",
  ])
  const unitsCol = findColumn(header, [
    "estmonthlyunitssold",
    "monthlyunits",
    "monthlysales",
    "quantitymo",
  ])
  const reviewsCol = findColumn(header, ["ofreviews", "reviewcount", "totalreviews", "reviews"])
  const ratingCol = findColumn(header, ["avgrating", "toolrating", "rating"])

  if (asinCol < 0 || revenueCol < 0 || unitsCol < 0) return []

  const output: TierAsinRankRow[] = []

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) break
    if (normalizeText(row.join(" ")).includes("rankby")) break

    const asin = getCell(row, asinCol).trim()
    if (!asin || normalizeText(asin) === "asin") break

    const parsedRank = rankCol >= 0 ? parseNumber(getCell(row, rankCol)) : 0
    output.push({
      rank: parsedRank > 0 ? parsedRank : output.length + 1,
      asin,
      title: titleCol >= 0 ? getCell(row, titleCol).trim() : "",
      brand: brandCol >= 0 ? getCell(row, brandCol).trim() : "",
      type: readNullableTextCell(row, typeCol),
      price: readNullableNumberCell(row, priceCol),
      revenue: parseNumber(getCell(row, revenueCol)),
      units: parseNumber(getCell(row, unitsCol)),
      reviews: readNullableNumberCell(row, reviewsCol),
      rating: readNullableNumberCell(row, ratingCol),
    })

    if (output.length >= 50) break
  }

  return output
}

function parseRawCategoryBrandMix(rows: string[][]): CategoryBrandMixMetric[] {
  const headerIndex = findHeaderRow(rows, [["category"], ["brand"], ["revenuemo"]])
  if (headerIndex < 0) return []

  const header = rows[headerIndex]
  const categoryCol = findColumn(header, ["category"])
  const brandCol = findColumn(header, ["brand"])
  if (categoryCol < 0 || brandCol < 0) return []

  const output: CategoryBrandMixMetric[] = []
  let blankRun = 0

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    const scopeLabel = getCell(row, categoryCol).trim()
    const brand = getCell(row, brandCol).trim()
    if (!scopeLabel || !brand || normalizeText(brand) === "0") continue

    output.push({
      scopeKey: toScopeKey(scopeLabel),
      scopeLabel: prettyScopeLabel(scopeLabel),
      brand,
      avgPrice: readMetricCell(header, row, ["avgprice"]),
      units: readMetricCell(header, row, ["quantitymo", "monthlysales"]),
      unitsShare: readMetricShare(header, row, ["qtyby", "marketunitshare"]),
      revenue: readMetricCell(header, row, ["revenuemo", "monthlyrevenue"]),
      revenueShare: readMetricShare(header, row, ["revenueby", "marketrevshare"]),
      revenueMoM: readMetricNullablePercent(header, row, ["revenuemom"]),
      revenueYoY: readMetricNullablePercent(header, row, ["revenueyoy"]),
    })
  }

  return output
}

function metricFromRow(header: string[], row: string[], label: string): TypeBreakdownMetric | null {
  const units = readMetricCell(header, row, ["quantitymo", "monthlysales"])
  const revenue = readMetricCell(header, row, ["revenuemo", "monthlyrevenue"])
  const avgPrice = readMetricCell(header, row, ["avgprice", "priceperunit"])

  if (units === 0 && revenue === 0 && avgPrice === 0) {
    return null
  }

  return {
    scopeKey: toScopeKey(label),
    label: prettyScopeLabel(label),
    avgPrice,
    avgPriceMoM: readMetricNullableShare(header, row, ["avgpricemom"]),
    avgPriceYoY: readMetricNullableShare(header, row, ["avgpriceyoy"]),
    units,
    unitsShare: readMetricShare(header, row, ["qtyby", "marketunitshare"]),
    unitsMoM: readMetricNullableShare(header, row, ["qtymom"]),
    unitsYoY: readMetricNullableShare(header, row, ["qtyyoy"]),
    revenue,
    revenueShare: readMetricShare(header, row, ["revenueby", "marketrevshare"]),
    revenueMoM: readMetricNullableShare(header, row, ["revenuemom"]),
    revenueYoY: readMetricNullableShare(header, row, ["revenueyoy"]),
  }
}

function readMetricCell(header: string[], row: string[], aliases: string[]): number {
  const idx = findColumn(header, aliases)
  if (idx < 0) return 0
  return parseNumber(getCell(row, idx))
}

function readMetricShare(header: string[], row: string[], aliases: string[]): number {
  const idx = findColumn(header, aliases)
  if (idx < 0) return 0
  return parseShare(getCell(row, idx))
}

function readMetricNullableShare(
  header: string[],
  row: string[],
  aliases: string[]
): number | null {
  const idx = findColumn(header, aliases)
  if (idx < 0) return null
  const cell = getCell(row, idx)
  if (!cell) return null
  const value = parseShare(cell)
  return Number.isFinite(value) ? value : null
}

function readMetricNullablePercent(
  header: string[],
  row: string[],
  aliases: string[]
): number | null {
  const idx = findColumn(header, aliases)
  if (idx < 0) return null
  const cell = getCell(row, idx).trim()
  if (!cell) return null
  const value = parsePercentValue(cell)
  return Number.isFinite(value) ? value : null
}

function readNullableNumberCell(row: string[], index: number): number | null {
  if (index < 0) return null
  const cell = getCell(row, index).trim()
  if (!cell || cell.toLowerCase() === "n/a") return null
  return parseNumber(cell)
}

function readNullableTextCell(row: string[], index: number): string | null {
  if (index < 0) return null
  const cell = getCell(row, index).trim()
  return cell || null
}

function buildSnapshot(
  date: string,
  parsed: ParsedReport,
  parsedType: ParsedTypeBreakdowns | undefined,
  issues: DataQualityIssue[]
): SnapshotSummary {
  const rollingRevenue = toRollingMetric(parsed.rolling12.revenue)
  const rollingUnits = toRollingMetric(parsed.rolling12.units)

  const top50Revenue = parsed.top50ByRevenue
  const top50Units = parsed.top50ByUnits.length
    ? parsed.top50ByUnits
    : [...top50Revenue].sort((a, b) => b.units - a.units).slice(0, 50)

  const normalizedSummaryRows = parsed.summaryRows.filter(
    (row) => row.brand && normalizeText(row.brand) !== "total"
  )

  const summaryRevenueTotal = normalizedSummaryRows.reduce((sum, row) => sum + row.revenue, 0)
  const summaryUnitsTotal = normalizedSummaryRows.reduce((sum, row) => sum + row.units, 0)
  const summaryListingsTotal = normalizedSummaryRows.reduce((sum, row) => sum + row.listings, 0)

  const top50RevenueTotal = top50Revenue.reduce((sum, row) => sum + row.revenue, 0)
  const top50UnitsTotal = top50Revenue.reduce((sum, row) => sum + row.units, 0)

  const totalRevenue =
    rollingRevenue?.marketTotalMonthly || summaryRevenueTotal || top50RevenueTotal
  const totalUnits =
    rollingUnits?.marketTotalMonthly || summaryUnitsTotal || top50UnitsTotal

  const asinCount = summaryListingsTotal || top50Revenue.length

  const brandTotals = buildBrandTotals(
    normalizedSummaryRows,
    parsed.rolling12,
    top50Revenue,
    totalRevenue,
    parsed.summaryBrandRanks
  )

  const top3Share = totalRevenue
    ? brandTotals.slice(0, 3).reduce((sum, brand) => sum + brand.share, 0)
    : 0

  const meaningfulCompetitors = brandTotals.filter((brand) => brand.share >= 0.01).length

  const brandListings = buildBrandListings(
    brandTotals,
    parsed.brandSheetListings,
    top50Revenue
  )

  const reviewCountFromSummary = normalizedSummaryRows.reduce(
    (sum, row) => sum + (row.reviewCount ?? 0),
    0
  )
  const ratingWeightedFromSummary = normalizedSummaryRows.reduce(
    (sum, row) => sum + (row.rating ?? 0) * (row.reviewCount ?? 0),
    0
  )
  const reviewCountFromTop50 = top50Revenue.reduce((sum, row) => sum + row.reviewCount, 0)
  const ratingWeightedFromTop50 = top50Revenue.reduce(
    (sum, row) => sum + row.rating * row.reviewCount,
    0
  )

  const reviewCount = reviewCountFromSummary || reviewCountFromTop50
  const ratingAvg = reviewCount
    ? (ratingWeightedFromSummary || ratingWeightedFromTop50) / reviewCount
    : 0

  const averagePrice =
    totalUnits > 0
      ? totalRevenue / totalUnits
      : top50Revenue.length > 0
        ? top50Revenue.reduce((sum, row) => sum + row.price, 0) / top50Revenue.length
        : 0

  const priceTiers = buildPriceTierSummary(parsedType, top50Revenue, totalRevenue)

  const tierAsinRanks = parsedType?.tierAsinRanks?.length ? parsedType.tierAsinRanks : undefined

  const fallbackTypeBreakdowns: TypeBreakdownSummary | undefined = parsedType
    ? {
        allAsins: parsedType.allAsins,
        top50: parsedType.top50,
        categoryBrandMix: parsedType.categoryBrandMix,
        source: parsedType.source,
      }
    : top50Revenue.length
      ? {
          allAsins: [],
          top50: deriveFallbackTypeBreakdowns(top50Revenue, "Top 50"),
          categoryBrandMix: [],
          source: "fallback",
        }
      : undefined

  return {
    date,
    label: formatSnapshotLabelMonthEnd(date),
    totals: {
      revenue: totalRevenue,
      units: totalUnits,
      asinCount,
      avgPrice: averagePrice,
      ratingAvg,
      reviewCount,
      top3Share,
      meaningfulCompetitors,
      brandCount: brandTotals.length,
    },
    topProducts: top50Revenue,
    top50ByUnits: top50Units,
    brandTotals,
    brandListings,
    brandSheetListings: parsed.brandSheetListings,
    priceTiers,
    rolling12: {
      ...(rollingRevenue ? { revenue: rollingRevenue } : {}),
      ...(rollingUnits ? { units: rollingUnits } : {}),
    },
    typeBreakdowns: fallbackTypeBreakdowns,
    ...(parsed.summaryBrandRanks ? { summaryBrandRanks: parsed.summaryBrandRanks } : {}),
    ...(tierAsinRanks ? { tierAsinRanks } : {}),
    qualityIssues: issues,
  }
}

function buildBrandTotals(
  summaryRows: SummaryRow[],
  rolling12: ParsedRolling,
  top50Revenue: ProductSummary[],
  totalRevenue: number,
  summaryBrandRanks?: SummaryBrandRanks
): BrandSummary[] {
  const revenueRows = rolling12.revenue?.brandRows ?? []
  const unitRows = rolling12.units?.brandRows ?? []

  if (revenueRows.length) {
    const unitMap = new Map<string, number>(
      unitRows.map((row) => [normalizeText(row.brand), row.monthly])
    )

    const rollingTotals = revenueRows
      .map((row) => ({
        brand: row.brand,
        revenue: row.monthly,
        units: unitMap.get(normalizeText(row.brand)) ?? 0,
        share: totalRevenue ? row.monthly / totalRevenue : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)

    // Rolling 12 mo only tracks brands with a full trailing-12 history, so brands that
    // appear in the Summary revenue table alone (e.g. bosch, gearwrench) are appended
    // in summary order after the rolling brands rather than dropped.
    return [
      ...rollingTotals,
      ...summaryOnlyBrandTotals(rollingTotals, summaryRows, summaryBrandRanks, totalRevenue),
    ]
  }

  if (summaryRows.length) {
    return summaryRows
      .map((row) => ({
        brand: row.brand,
        revenue: row.revenue,
        units: row.units,
        share: totalRevenue ? row.revenue / totalRevenue : 0,
      }))
      .sort((a, b) => b.revenue - a.revenue)
  }

  const brandMap = new Map<string, { revenue: number; units: number }>()
  for (const product of top50Revenue) {
    const current = brandMap.get(product.brand) ?? { revenue: 0, units: 0 }
    current.revenue += product.revenue
    current.units += product.units
    brandMap.set(product.brand, current)
  }

  return Array.from(brandMap.entries())
    .map(([brand, values]) => ({
      brand,
      revenue: values.revenue,
      units: values.units,
      share: totalRevenue ? values.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

/**
 * Internal Innova splits are listing groupings, not market brands, so they never join
 * brandTotals even when the Summary table lists them.
 */
const BRAND_TOTALS_EXCLUDED_KEYS = new Set(["innova1p", "innova3p"])

function summaryOnlyBrandTotals(
  existing: BrandSummary[],
  summaryRows: SummaryRow[],
  summaryBrandRanks: SummaryBrandRanks | undefined,
  totalRevenue: number
): BrandSummary[] {
  const seen = new Set(existing.map((row) => normalizeText(row.brand)))
  const output: BrandSummary[] = []

  const rankRows = summaryBrandRanks?.revenue ?? []
  const shareByBrand = new Map(
    rankRows.map((row) => [normalizeText(row.brand), row.share] as const)
  )

  const candidates: Array<{ brand: string; revenue: number; units: number }> = rankRows.length
    ? rankRows.map((row) => ({
        brand: row.brand,
        revenue: row.monthlyRevenue,
        units: row.monthlyUnits,
      }))
    : summaryRows.map((row) => ({ brand: row.brand, revenue: row.revenue, units: row.units }))

  for (const candidate of candidates) {
    const key = normalizeText(candidate.brand)
    if (!key || seen.has(key)) continue
    if (BRAND_TOTALS_EXCLUDED_KEYS.has(key)) continue
    if (key === "total" || key === "totalmarket") continue
    seen.add(key)

    const sheetShare = shareByBrand.get(key)
    output.push({
      brand: candidate.brand,
      revenue: candidate.revenue,
      units: candidate.units,
      share:
        sheetShare && Number.isFinite(sheetShare) && sheetShare > 0
          ? sheetShare
          : totalRevenue
            ? candidate.revenue / totalRevenue
            : 0,
    })
  }

  return output
}

function buildBrandListings(
  brandTotals: BrandSummary[],
  brandSheetListings: Array<{ brand: string; products: ProductSummary[] }>,
  top50Revenue: ProductSummary[]
): Array<{ brand: string; products: ProductSummary[] }> {
  if (brandSheetListings.length) {
    const byBrand = new Map(
      brandSheetListings.map((entry) => [normalizeText(entry.brand), entry])
    )

    const ordered: Array<{ brand: string; products: ProductSummary[] }> = []
    for (const brand of brandTotals) {
      const match = byBrand.get(normalizeText(brand.brand))
      if (match) {
        ordered.push(match)
      }
    }

    for (const entry of brandSheetListings) {
      if (!ordered.find((item) => normalizeText(item.brand) === normalizeText(entry.brand))) {
        ordered.push(entry)
      }
    }

    return groupInnovaSplitListings(ordered)
  }

  return brandTotals.slice(0, 12).map((brand) => ({
    brand: brand.brand,
    products: top50Revenue
      .filter((product) => normalizeText(product.brand) === normalizeText(brand.brand))
      .sort((a, b) => b.revenue - a.revenue),
  }))
}

/**
 * "Innova 1P" / "Innova 3P" are splits of the Innova listing set. They otherwise land at
 * the tail (they never appear in brandTotals), so pull them up next to Innova, 1P first.
 */
function groupInnovaSplitListings<T extends { brand: string }>(entries: T[]): T[] {
  const innovaIndex = entries.findIndex((entry) => normalizeText(entry.brand) === "innova")
  if (innovaIndex < 0) return entries

  const firstParty = entries.find((entry) => normalizeText(entry.brand) === "innova1p")
  const thirdParty = entries.find((entry) => normalizeText(entry.brand) === "innova3p")
  const splits = [firstParty, thirdParty].filter((entry): entry is T => Boolean(entry))
  if (!splits.length) return entries

  const rest = entries.filter((entry) => !splits.includes(entry))
  const anchorIndex = rest.findIndex((entry) => normalizeText(entry.brand) === "innova")
  return [...rest.slice(0, anchorIndex + 1), ...splits, ...rest.slice(anchorIndex + 1)]
}

function buildPriceTierSummary(
  parsedType: ParsedTypeBreakdowns | undefined,
  topProducts: ProductSummary[],
  totalRevenue: number
) {
  if (parsedType?.allAsins.length) {
    const rows = parsedType.allAsins
      .filter((metric) => DETAILED_PRICE_TIER_KEYS.has(metric.scopeKey))
      .map((metric) => ({
        label: metric.label,
        revenue: metric.revenue,
        share: totalRevenue ? metric.revenue / totalRevenue : metric.revenueShare,
      }))
      .filter((metric) => metric.revenue > 0)

    if (rows.length) {
      return rows
    }
  }

  return FALLBACK_PRICE_TIERS.map((tier) => {
    const revenue = topProducts
      .filter((product) => product.price >= tier.min && product.price < tier.max)
      .reduce((sum, product) => sum + product.revenue, 0)

    return {
      label: tier.label,
      revenue,
      share: totalRevenue ? revenue / totalRevenue : 0,
    }
  })
}

function deriveFallbackTypeBreakdowns(products: ProductSummary[], labelPrefix: string) {
  const totals = new Map<string, { revenue: number; units: number; count: number; priceSum: number }>()
  const totalRevenue = products.reduce((sum, row) => sum + row.revenue, 0)

  for (const product of products) {
    const label = product.subcategory?.trim() || "Other Tools"
    const key = toScopeKey(label)
    const current = totals.get(key) ?? { revenue: 0, units: 0, count: 0, priceSum: 0 }
    current.revenue += product.revenue
    current.units += product.units
    current.count += 1
    current.priceSum += product.price
    totals.set(key, current)
  }

  return Array.from(totals.entries())
    .map(([scopeKey, values]) => ({
      scopeKey,
      label: `${labelPrefix} ${prettyScopeLabel(scopeKey)}`,
      avgPrice: values.count ? values.priceSum / values.count : 0,
      avgPriceMoM: null,
      avgPriceYoY: null,
      units: values.units,
      unitsShare: 0,
      unitsMoM: null,
      unitsYoY: null,
      revenue: values.revenue,
      revenueShare: totalRevenue ? values.revenue / totalRevenue : 0,
      revenueMoM: null,
      revenueYoY: null,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function toRollingMetric(section: ParsedRollingSection | undefined): Rolling12Metric | undefined {
  if (!section || !section.brandRows.length) return undefined

  const sortedBrands = [...section.brandRows]
    .sort((a, b) => b.grandTotal - a.grandTotal)
    .map((row, index) => ({
      brand: row.brand,
      monthly: row.monthly,
      grandTotal: row.grandTotal,
      rank: index + 1,
      monthlySeries: row.values,
    }))

  const marketSeries = section.totalMarketRow
    ? section.totalMarketRow.values
    : section.monthLabels.map((_, idx) =>
        section.brandRows.reduce((sum, row) => sum + (row.values[idx] ?? 0), 0)
      )

  const marketTotalMonthly = marketSeries[marketSeries.length - 1] ?? 0
  const overallTotalMonthly =
    section.totalRow?.monthly ?? sortedBrands.reduce((sum, row) => sum + row.monthly, 0)

  return {
    monthLabels: section.monthLabels,
    currentMonthLabel: section.currentMonthLabel,
    marketSeries,
    marketTotalMonthly,
    overallTotalMonthly,
    brands: sortedBrands,
  }
}

function mergeProductLists(
  revenueProducts: ProductSummary[],
  unitsProducts: ProductSummary[]
): ProductSummary[] {
  const merged = new Map<string, ProductSummary>()

  for (const product of [...revenueProducts, ...unitsProducts]) {
    const existing = merged.get(product.asin)
    if (!existing) {
      merged.set(product.asin, product)
      continue
    }

    merged.set(product.asin, {
      ...existing,
      title: existing.title || product.title,
      brand: existing.brand || product.brand,
      price: existing.price || product.price,
      revenue: Math.max(existing.revenue, product.revenue),
      units: Math.max(existing.units, product.units),
      reviewCount: Math.max(existing.reviewCount, product.reviewCount),
      rating: Math.max(existing.rating, product.rating),
      toolType: existing.toolType || product.toolType,
      avgPrice: existing.avgPrice || product.avgPrice,
      estimatedRevenue12mo: existing.estimatedRevenue12mo || product.estimatedRevenue12mo,
      monthlyRevenue: Math.max(existing.monthlyRevenue ?? 0, product.monthlyRevenue ?? 0) || undefined,
      estimatedUnits12mo: existing.estimatedUnits12mo || product.estimatedUnits12mo,
      monthlyUnits: Math.max(existing.monthlyUnits ?? 0, product.monthlyUnits ?? 0) || undefined,
      toolRating: Math.max(existing.toolRating ?? 0, product.toolRating ?? 0) || undefined,
      subcategory: existing.subcategory || product.subcategory,
      url: existing.url || product.url,
    })
  }

  return Array.from(merged.values()).sort((a, b) => b.revenue - a.revenue)
}

function resolveProductUrl(asin: string, rawUrl: string) {
  const trimmed = rawUrl.trim()
  if (trimmed) return trimmed
  if (!asin) return undefined
  return `https://amazon.com/dp/${asin}`
}

function findMarkerRow(rows: string[][], tokens: string[]) {
  const normalizedTokens = tokens.map((token) => normalizeText(token))
  for (let i = 0; i < Math.min(rows.length, 220); i += 1) {
    const normalized = normalizeText(rows[i].join(" "))
    if (!normalized.includes("rankby")) continue
    if (normalizedTokens.every((token) => normalized.includes(token))) {
      return i
    }
  }
  return -1
}

function findProductHeaderRows(rows: string[][], requireBrand: boolean): number[] {
  const indices: number[] = []
  for (let i = 0; i < Math.min(rows.length, 240); i += 1) {
    if (isProductHeaderRow(rows[i], requireBrand)) {
      indices.push(i)
    }
  }
  return indices
}

function findNextHeaderAfter(headers: number[], markerIndex: number) {
  return headers.find((index) => index > markerIndex) ?? -1
}

function isProductHeaderRow(row: string[], requireBrand = true) {
  const asinCol = findColumn(row, ["asin"])
  const brandCol = findColumn(row, ["brand"])
  const priceCol = findColumn(row, ["price"])
  const revenueCol = findColumn(row, ["monthlyrevenue", "estmonthlyretailrev", "monthlyrev"])
  const unitsCol = findColumn(row, [
    "monthlysales",
    "monthlyunitsales",
    "monthlyunits",
    "estmonthlyunitssold",
  ])
  const hasBrand = requireBrand ? brandCol >= 0 : true
  return asinCol >= 0 && hasBrand && priceCol >= 0 && revenueCol >= 0 && unitsCol >= 0
}

function parseProductTable(
  rows: string[][],
  headerIndex: number,
  sortBy: "revenue" | "units",
  defaultBrand?: string,
  maxRows = 50
): ProductSummary[] {
  const header = rows[headerIndex]

  const asinCol = findColumn(header, ["asin"])
  const titleCol = findColumn(header, ["title", "productname"])
  const brandCol = findColumn(header, ["brand"])
  const typeCol = findColumn(header, ["type"])
  const avgPriceCol = findColumn(header, ["avgprice", "priceperunit", "price"])
  const estimatedRevenue12moCol = findColumn(header, [
    "estimated12morevenue",
    "estimatedannualrevenue",
    "12morevenue",
  ])
  const monthlyRevenueCol = findColumn(header, ["monthlyrevenue", "estmonthlyretailrev", "monthlyrev", "revenuemo"])
  const estimatedUnits12moCol = findColumn(header, ["estimated12mounits", "estimatedannualunits", "12mounits"])
  const monthlyUnitsCol = findColumn(header, [
    "monthlysales",
    "monthlyunitsales",
    "monthlyunits",
    "estmonthlyunitssold",
    "quantitymo",
  ])
  const reviewsCol = findColumn(header, ["reviewcount", "#ofreviews", "totalreviews"])
  const toolRatingCol = findColumn(header, ["toolrating", "reviewsrating", "avgrating"])
  const imageCol = findColumn(header, ["imageurl", "image", "imageurllink"])
  const urlCol = findColumn(header, ["url", "link", "column1", "column2"])

  if (
    asinCol < 0 ||
    (brandCol < 0 && !defaultBrand) ||
    monthlyRevenueCol < 0 ||
    monthlyUnitsCol < 0
  ) {
    return []
  }

  const deduped = new Map<string, ProductSummary>()
  let blankRun = 0

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]

    if (isProductHeaderRow(row, !defaultBrand) && i > headerIndex + 1) {
      break
    }

    const marker = normalizeText(row.join(" "))
    if (marker.includes("rankby") && (marker.includes("revenue") || marker.includes("units"))) {
      break
    }

    const asin = getCell(row, asinCol).trim()
    if (!asin) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    const product: ProductSummary = {
      asin,
      title: titleCol >= 0 ? getCell(row, titleCol).trim() : "",
      brand:
        brandCol >= 0
          ? getCell(row, brandCol).trim() || defaultBrand || "Unknown"
          : defaultBrand || "Unknown",
      price: parseNumber(getCell(row, avgPriceCol)),
      revenue: parseNumber(getCell(row, monthlyRevenueCol)),
      units: parseNumber(getCell(row, monthlyUnitsCol)),
      reviewCount: reviewsCol >= 0 ? parseNumber(getCell(row, reviewsCol)) : 0,
      rating: toolRatingCol >= 0 ? parseNumber(getCell(row, toolRatingCol)) : 0,
      toolType: typeCol >= 0 ? getCell(row, typeCol).trim() || undefined : undefined,
      avgPrice: avgPriceCol >= 0 ? parseNumber(getCell(row, avgPriceCol)) : undefined,
      estimatedRevenue12mo:
        estimatedRevenue12moCol >= 0
          ? parseNumber(getCell(row, estimatedRevenue12moCol))
          : undefined,
      monthlyRevenue:
        monthlyRevenueCol >= 0 ? parseNumber(getCell(row, monthlyRevenueCol)) : undefined,
      estimatedUnits12mo:
        estimatedUnits12moCol >= 0 ? parseNumber(getCell(row, estimatedUnits12moCol)) : undefined,
      monthlyUnits:
        monthlyUnitsCol >= 0 ? parseNumber(getCell(row, monthlyUnitsCol)) : undefined,
      toolRating: toolRatingCol >= 0 ? parseNumber(getCell(row, toolRatingCol)) : undefined,
      subcategory: typeCol >= 0 ? getCell(row, typeCol).trim() || undefined : undefined,
      imageUrl: imageCol >= 0 ? getCell(row, imageCol).trim() || undefined : undefined,
      url: resolveProductUrl(asin, urlCol >= 0 ? getCell(row, urlCol).trim() : ""),
    }

    const existing = deduped.get(asin)
    if (!existing) {
      deduped.set(asin, product)
      continue
    }

    const existingMetric = sortBy === "revenue" ? existing.revenue : existing.units
    const nextMetric = sortBy === "revenue" ? product.revenue : product.units
    if (nextMetric > existingMetric) {
      deduped.set(asin, product)
    }
  }

  return Array.from(deduped.values())
    .sort((a, b) => (sortBy === "revenue" ? b.revenue - a.revenue : b.units - a.units))
    .slice(0, maxRows)
}

function parseSummaryRows(rows: string[][]): SummaryRow[] {
  const revenueHeaderIndex = findHeaderRow(rows, [
    ["brand"],
    ["monthlyrevenue", "monthlyrev", "revenuemo"],
    ["monthlysales", "monthlyunits", "quantitymo"],
  ])
  if (revenueHeaderIndex < 0) return []

  const header = rows[revenueHeaderIndex]
  const brandCol = findColumn(header, ["brand"])
  const listingsCol = findColumn(header, ["listings", "#oflistings"])
  const revenueCol = findColumn(header, ["monthlyrevenue", "monthlyrev", "revenuemo"])
  const unitsCol = findColumn(header, ["monthlysales", "monthlyunits", "quantitymo"])
  const shareCol = findColumn(header, ["marketrevshare", "revenueby"])
  const priceCol = findColumn(header, ["priceperunit", "avgprice"])
  const reviewsCol = findColumn(header, ["totalreviews", "reviewcount", "reviews"])
  const ratingCol = findColumn(header, ["avgrating", "reviewsrating"])

  if (brandCol < 0 || revenueCol < 0 || unitsCol < 0) {
    return []
  }

  const output: SummaryRow[] = []
  let blankRun = 0

  for (let i = revenueHeaderIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    const brand = getCell(row, brandCol)
    if (!brand || normalizeText(brand) === "brand") continue

    const normalizedBrand = normalizeText(brand)
    if (normalizedBrand.includes("summaryunits") || normalizedBrand.includes("summaryrevenue")) {
      continue
    }

    output.push({
      brand: brand.trim(),
      listings: listingsCol >= 0 ? parseNumber(getCell(row, listingsCol)) : 0,
      revenue: parseNumber(getCell(row, revenueCol)),
      units: parseNumber(getCell(row, unitsCol)),
      share: shareCol >= 0 ? parseShare(getCell(row, shareCol)) : undefined,
      pricePerUnit: priceCol >= 0 ? parseNumber(getCell(row, priceCol)) : undefined,
      reviewCount: reviewsCol >= 0 ? parseNumber(getCell(row, reviewsCol)) : undefined,
      rating: ratingCol >= 0 ? parseNumber(getCell(row, ratingCol)) : undefined,
    })
  }

  return output
}

/**
 * The Summary sheet stacks two brand tables: "<Mon> 'YY Monthly Summary - Revenue" and
 * "<Mon> 'YY Summary - Units". parseSummaryRows only reads the first one; this reads both
 * and preserves sheet order as rank 1..N (Total row excluded).
 */
function parseSummaryBrandRankTables(rows: string[][]): SummaryBrandRanks | undefined {
  const ranks: SummaryBrandRanks = { revenue: [], units: [] }

  for (let i = 0; i < rows.length; i += 1) {
    if (!isSummaryBrandRankHeaderRow(rows[i])) continue
    const metric = summaryBrandRankMetric(rows, i)
    if (ranks[metric].length) continue
    ranks[metric] = parseSummaryBrandRankRows(rows, i)
  }

  if (!ranks.revenue.length && !ranks.units.length) return undefined
  return ranks
}

function isSummaryBrandRankHeaderRow(row: string[]): boolean {
  const normalized = row.map(normalizeText)
  if (!normalized.some((cell) => cell === "brand")) return false
  if (!normalized.some((cell) => cell.includes("marketshare"))) return false
  return (
    normalized.some((cell) => cell.includes("monthlyrev")) &&
    normalized.some((cell) => cell.includes("monthlyunit"))
  )
}

function summaryBrandRankMetric(rows: string[][], headerIndex: number): "revenue" | "units" {
  const normalized = rows[headerIndex].map(normalizeText)
  if (normalized.some((cell) => cell.includes("unitmarketshare"))) return "units"
  if (normalized.some((cell) => cell.includes("revmarketshare"))) return "revenue"

  for (let i = headerIndex - 1; i >= Math.max(0, headerIndex - 3); i -= 1) {
    const title = normalizeText(rows[i].join(" "))
    if (!title) continue
    return title.includes("units") ? "units" : "revenue"
  }
  return "revenue"
}

function parseSummaryBrandRankRows(rows: string[][], headerIndex: number): SummaryBrandRankRow[] {
  const header = rows[headerIndex]
  const brandCol = findStrictColumn(header, ["brand"])
  const listingsCol = findColumn(header, ["oflistings", "listings"])
  const revenueCol = findColumn(header, ["monthlyrev", "monthlyrevenue", "revenuemo"])
  const unitsCol = findColumn(header, ["monthlyunits", "monthlysales", "quantitymo"])
  const shareCol = findColumn(header, ["marketshare"])
  const priceCol = findColumn(header, ["priceperunit", "avgprice"])
  const reviewsCol = findColumn(header, ["reviews"])
  const ratingCol = findColumn(header, ["avgrating", "reviewsrating"])

  if (brandCol < 0 || revenueCol < 0 || unitsCol < 0) return []

  const output: SummaryBrandRankRow[] = []
  let blankRun = 0

  for (let i = headerIndex + 1; i < rows.length; i += 1) {
    const row = rows[i]
    if (row.every((cell) => cell.trim() === "")) {
      blankRun += 1
      if (blankRun >= 2) break
      continue
    }
    blankRun = 0

    if (isSummaryBrandRankHeaderRow(row)) break

    const brand = getCell(row, brandCol).trim()
    if (!brand) continue

    const normalizedBrand = normalizeText(brand)
    if (normalizedBrand === "brand") continue
    if (normalizedBrand === "total" || normalizedBrand === "totalmarket") break

    output.push({
      rank: output.length + 1,
      brand,
      listings: readNullableNumberCell(row, listingsCol),
      monthlyRevenue: parseNumber(getCell(row, revenueCol)),
      monthlyUnits: parseNumber(getCell(row, unitsCol)),
      share: shareCol >= 0 ? parsePercentValue(getCell(row, shareCol)) : 0,
      pricePerUnit: readNullableNumberCell(row, priceCol),
      reviews: readNullableNumberCell(row, reviewsCol),
      avgRating: readNullableNumberCell(row, ratingCol),
    })
  }

  return output
}

function sheetRows(sheet: XLSX.WorkSheet): string[][] {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  }) as Array<Array<string | number | boolean | null>>

  return rows.map((row) => row.map((cell) => `${cell ?? ""}`.trim()))
}

function findSheet(workbook: XLSX.WorkBook, expectedName: string): XLSX.WorkSheet | undefined {
  const trimmedExpected = expectedName.trim().toLowerCase()
  const exactName = workbook.SheetNames.find(
    (sheetName) => sheetName.trim().toLowerCase() === trimmedExpected
  )
  if (exactName) return workbook.Sheets[exactName]

  const normalizedExpected = normalizeSheetName(expectedName)
  const name = workbook.SheetNames.find(
    (sheetName) => normalizeSheetName(sheetName) === normalizedExpected
  )
  if (!name) return undefined
  return workbook.Sheets[name]
}

/**
 * Sheet-name canonicalizer that preserves price-tier signs. normalizeText() strips "+"/"-",
 * which collapses "Handheld $75+" and "Handheld $75-" onto the same key and makes the
 * under-$75 lookup return the plus-$75 sheet.
 */
function normalizeSheetName(value: string): string {
  return normalizeText(value.replace(/\+/g, " plus ").replace(/-/g, " minus "))
}

function findHeaderRow(rows: string[][], requirements: string[][]): number {
  for (let i = 0; i < Math.min(rows.length, 260); i += 1) {
    const normalizedCells = rows[i].map(normalizeText)
    const hasAllRequirements = requirements.every((aliases) =>
      aliases.some((alias) =>
        normalizedCells.some((cell) => cell.includes(alias))
      )
    )

    if (hasAllRequirements) return i
  }
  return -1
}

function findLabelColumn(header: string[]): number {
  for (let i = 0; i < header.length; i += 1) {
    const normalized = normalizeText(header[i])
    if (!normalized) continue
    if (normalized.includes("category") || normalized.includes("brand") || normalized.includes("tablets") || normalized.includes("handheld") || normalized.includes("dongle") || normalized.includes("other")) {
      return i
    }
  }
  return 0
}

function findColumn(row: string[], aliases: string[]): number {
  const normalized = row.map(normalizeText)
  return normalized.findIndex((value) => aliases.some((alias) => value.includes(alias)))
}

function findStrictColumn(row: string[], aliases: string[]): number {
  const normalized = row.map(normalizeText)
  return normalized.findIndex((value) => aliases.some((alias) => value === alias))
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function getCell(row: string[], index: number): string {
  if (index < 0 || index >= row.length) return ""
  return row[index] ?? ""
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[$,%]/g, "").replace(/,/g, "").trim()
  if (!cleaned || cleaned.toLowerCase() === "n/a") return 0
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Percent cells that carry an explicit "%" are unambiguous and are always divided by 100.
 * Bare numbers fall back to the legacy parseShare heuristic.
 */
function parsePercentValue(value: string): number {
  return parseShare(value)
}

function parseShare(value: string): number {
  const trimmed = value.trim()
  if (!trimmed) return 0
  const parsed = parseNumber(trimmed)
  if (!Number.isFinite(parsed)) return 0
  // A literal percent sign is unambiguous: "1%" means 1 percent -> 0.01.
  if (trimmed.includes("%")) return parsed / 100
  // Bare-number fallback (legacy sheets): "23" means 23% -> 0.23; values in
  // [-1, 1] are assumed to already be ratios.
  if (Math.abs(parsed) > 1) return parsed / 100
  return parsed
}

function toScopeKey(label: string): string {
  const lower = label.toLowerCase().trim().replace(/\s+/g, " ")
  if (lower.includes("tablet $800+")) return "tablet_800_plus"
  if (lower.includes("tablet $400-$800")) return "tablet_400_800"
  if (lower.includes("tablet $400-")) return "tablet_under_400"
  if (lower.includes("handheld $75+")) return "handheld_75_plus"
  if (lower.includes("handheld $75-")) return "handheld_under_75"

  const normalized = normalizeText(lower)
  if (
    normalized === "totaltablet" ||
    normalized === "tablettotal" ||
    normalized === "tabletoverall" ||
    normalized === "tablets"
  ) {
    return "total_tablet"
  }
  if (
    normalized === "totalhandheld" ||
    normalized === "handheldtotal" ||
    normalized === "handheldoverall" ||
    normalized === "handheld"
  ) {
    return "total_handheld"
  }
  if (
    normalized === "totaldongle" ||
    normalized === "dongleoverall" ||
    normalized === "dongle" ||
    normalized === "dongles"
  ) {
    return "total_dongle"
  }
  if (
    normalized === "totalothertools" ||
    normalized === "othertoolsoverall" ||
    normalized === "othertools"
  ) {
    return "total_other_tools"
  }
  return normalized.replace(/^top50/, "top_50_")
}

function prettyScopeLabel(value: string): string {
  const key = toScopeKey(value)
  const map: Record<string, string> = {
    total_tablet: "Total Tablet",
    total_handheld: "Total Handheld",
    total_dongle: "Total Dongle",
    total_other_tools: "Total Other Tools",
    tablet_800_plus: "Tablet $800+",
    tablet_400_800: "Tablet $400-$800",
    tablet_under_400: "Tablet $400-",
    handheld_75_plus: "Handheld $75+",
    handheld_under_75: "Handheld $75-",
  }
  return map[key] ?? value.trim()
}

async function resolvePreferredFile(dir: string, names: Array<string | null | undefined>) {
  for (const name of names) {
    if (!name) continue
    const candidate = path.isAbsolute(name) ? name : path.join(dir, name)
    if (await isReadable(candidate)) {
      return candidate
    }
  }
  return null
}

function asRelativeFileName(value: string | undefined) {
  if (!value || !value.trim()) return null
  return path.basename(value.trim())
}

async function readWorkbook(filePath: string): Promise<XLSX.WorkBook> {
  const fileData = await readFile(filePath)
  return XLSX.read(fileData, { type: "buffer" })
}

async function isReadable(filePath: string) {
  try {
    await access(filePath, fsConstants.R_OK)
    return true
  } catch {
    return false
  }
}

async function readManifest(filePath: string): Promise<ManifestFile | null> {
  if (!(await isReadable(filePath))) return null
  try {
    const contents = await readFile(filePath, "utf8")
    return JSON.parse(contents) as ManifestFile
  } catch {
    return null
  }
}

function resolveSnapshotDate(month: string, snapshotDate?: string) {
  const candidate = snapshotDate?.trim() || month
  return normalizeSnapshotDate(candidate)
}
