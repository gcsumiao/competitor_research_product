import { readdir, readFile, stat } from "fs/promises"
import path from "path"
import { unstable_cache } from "next/cache"

import { queryDb } from "@/lib/db/client"
import { DASHBOARD_DATA_TAG, DEFAULT_CACHE_REVALIDATE_SECONDS } from "@/lib/db/constants"
import { loadCodeReaderScannerSnapshots } from "@/lib/code-reader-scanner-data"
import {
  isPostgresDashboardSource,
  getDashboardDeploymentMode,
  resolveCodeReaderDataDir,
  resolveNonCodeCategoryDir,
} from "@/lib/dashboard-runtime"
import {
  isNonCodeCategoryId,
  listNonCodeCategoryConfigs,
  type NonCodeCategoryId,
} from "@/lib/non-code-category-config"
import {
  classifyBackpackProduct,
  isBackpackCategory,
} from "@/lib/backpack-classification"
import {
  averagePriceForCategory,
  classifyJumpStarterProduct,
  isJumpStartersCategory,
} from "@/lib/jump-starters-classification"
import {
  classifyMechanicStoolProduct,
  isMechanicStoolCategory,
} from "@/lib/mechanic-stool-classification"
import {
  classifyOilProduct,
  isOilCategory,
} from "@/lib/oil-classification"
import {
  classifyStethoscopeProduct,
  isStethoscopeCategory,
} from "@/lib/stethoscope-classification"
import { formatSnapshotLabelMonthEnd, normalizeSnapshotDate } from "@/lib/snapshot-date"
import type { TypeSummarySection } from "@/lib/type-summaries"

export type CategoryId = NonCodeCategoryId | "code_reader_scanner"

export type ProductSummary = {
  asin: string
  title: string
  brand: string
  price: number
  revenue: number
  units: number
  reviewCount: number
  rating: number
  toolType?: string
  avgPrice?: number
  estimatedRevenue12mo?: number
  monthlyRevenue?: number
  estimatedUnits12mo?: number
  monthlyUnits?: number
  toolRating?: number
  fulfillment?: string
  sizeTier?: string
  subcategory?: string
  url?: string
  imageUrl?: string
}

export type BrandSummary = {
  brand: string
  revenue: number
  units: number
  share: number
}

export type PriceTierSummary = {
  label: string
  revenue: number
  share: number
}

export type DataQualityIssue = {
  code: string
  message: string
  severity: "warning" | "error"
}

export type Rolling12BrandRank = {
  brand: string
  monthly: number
  grandTotal: number
  rank: number
  monthlySeries?: number[]
}

export type Rolling12Metric = {
  monthLabels: string[]
  currentMonthLabel: string
  marketSeries: number[]
  marketTotalMonthly: number
  overallTotalMonthly: number
  brands: Rolling12BrandRank[]
}

export type Rolling12Summary = {
  revenue?: Rolling12Metric
  units?: Rolling12Metric
}

export type TypeBreakdownMetric = {
  scopeKey: string
  label: string
  avgPrice: number
  avgPriceMoM: number | null
  avgPriceYoY: number | null
  units: number
  unitsShare: number
  unitsMoM: number | null
  unitsYoY: number | null
  revenue: number
  revenueShare: number
  revenueMoM: number | null
  revenueYoY: number | null
}

export type CategoryBrandMixMetric = {
  scopeKey: string
  scopeLabel: string
  brand: string
  avgPrice: number
  units: number
  unitsShare: number
  revenue: number
  revenueShare: number
}

export type TypeBreakdownSummary = {
  allAsins: TypeBreakdownMetric[]
  top50: TypeBreakdownMetric[]
  categoryBrandMix: CategoryBrandMixMetric[]
  source: "analysis" | "summary" | "fallback"
}

export type SnapshotMetadata = Record<string, unknown> & {
  typeSummarySections?: TypeSummarySection[]
  typeSummaryFileName?: string
}

export type SnapshotSummary = {
  date: string
  label: string
  totals: {
    revenue: number
    units: number
    asinCount: number
    avgPrice: number
    ratingAvg: number
    reviewCount: number
    top3Share: number
    meaningfulCompetitors: number
    brandCount: number
  }
  topProducts: ProductSummary[]
  top50ByUnits?: ProductSummary[]
  brandTotals: BrandSummary[]
  brandListings: Array<{ brand: string; products: ProductSummary[] }>
  brandSheetListings?: Array<{ brand: string; products: ProductSummary[] }>
  priceTiers: PriceTierSummary[]
  rolling12?: Rolling12Summary
  typeBreakdowns?: TypeBreakdownSummary
  qualityIssues?: DataQualityIssue[]
  metadata?: SnapshotMetadata
}

export type CategorySummary = {
  id: CategoryId
  label: string
  snapshots: SnapshotSummary[]
}

export type DashboardData = {
  categories: CategorySummary[]
}

export type DashboardPageScope =
  | "overview"
  | "brands"
  | "sales"
  | "specs"
  | "reports"
  | "surveys"
  | "consult_me"

export type RawRecord = {
  asin: string
  title: string
  brand: string
  price: number
  asinSales: number
  asinRevenue: number
  reviewCount: number
  rating: number
  fulfillment?: string
  sizeTier?: string
  subcategory?: string
  url?: string
  imageUrl?: string
  bsr?: number
  subcategoryBsr?: number
  shippingDetails?: string
  length?: number
  width?: number
  height?: number
  weight?: number
  bestSalesPeriod?: string
  listingAgeMonths?: number
  imageCount?: number
  variationCount?: number
  lastYearSales?: number
  salesYearOverYearPct?: number
  salesToReviews?: number
  typeLabel?: string
  excludeFromAvgPrice?: boolean
  categoryMetadata?: Record<string, string | number | boolean | null>
}

type CsvCategoryConfig = {
  id: NonCodeCategoryId
  label: string
  source: "csv"
}

type WorkbookCategoryConfig = {
  id: "code_reader_scanner"
  label: string
  source: "workbook"
}

type CategoryConfig = CsvCategoryConfig | WorkbookCategoryConfig

const CATEGORY_CONFIG: CategoryConfig[] = [
  ...listNonCodeCategoryConfigs().map<CategoryConfig>((category) => ({
    id: category.id,
    label: category.label,
    source: "csv",
  })),
  {
    id: "code_reader_scanner",
    label: "Code Reader & Scanner",
    source: "workbook",
  },
]

const PRICE_TIERS = [
  { label: "$0-40", min: 0, max: 40 },
  { label: "$40-60", min: 40, max: 60 },
  { label: "$60-90", min: 60, max: 90 },
  { label: "$90+", min: 90, max: Number.POSITIVE_INFINITY },
]

const TOP_PRODUCTS_COUNT = 50
const IGNORED_SOURCE_DIRS = new Set([".git", ".venv", "__pycache__", "_archive"])
const NON_CODE_READER_PRICE_CEILING = 1000

type DashboardDataMemo = {
  at: number
  promise: Promise<DashboardData>
}

let dashboardDataMemo: DashboardDataMemo | null = null
const dashboardDataForCategoryMemo = new Map<string, DashboardDataMemo>()

const CSV_DATE_REGEX = /(\d{4}-\d{2}-\d{2})/

function monthKeyFromDate(dateValue: string) {
  // YYYY-MM from YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue
  return dateValue.slice(0, 7)
}

function getDashboardMemoTtlMs() {
  const raw = (process.env.DASHBOARD_MEMO_TTL_MS ?? "").trim()
  if (!raw) return 60_000
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 60_000
}

async function loadDashboardDataUncached(): Promise<DashboardData> {
  if (!isPostgresDashboardSource()) {
    return loadDashboardDataFromFiles()
  }

  const postgresData = await loadDashboardDataFromPostgres()
  if (!needsNonCodeDashboardFallback(postgresData)) {
    return postgresData
  }

  const fileData = await loadNonCodeDashboardDataFromFiles()
  return mergeDashboardData(postgresData, fileData)
}

export async function loadDashboardData(): Promise<DashboardData> {
  const ttlMs = getDashboardMemoTtlMs()
  if (ttlMs <= 0) {
    return loadDashboardDataUncached()
  }

  const now = Date.now()
  if (dashboardDataMemo && now - dashboardDataMemo.at < ttlMs) {
    return dashboardDataMemo.promise
  }

  const promise = loadDashboardDataUncached()
  dashboardDataMemo = { at: now, promise }
  void promise.catch(() => {
    if (dashboardDataMemo?.promise === promise) {
      dashboardDataMemo = null
    }
  })
  return promise
}

async function loadDashboardDataForCategoryUncached(categoryId: string): Promise<DashboardData> {
  const deploymentMode = getDashboardDeploymentMode()
  const category = CATEGORY_CONFIG.find(
    (item) =>
      item.id === categoryId &&
      (deploymentMode === "full" || item.id === "code_reader_scanner")
  )
  if (!category) {
    return { categories: [] }
  }

  if (!isPostgresDashboardSource()) {
    return { categories: [await loadCategoryDashboardDataFromFiles(category)] }
  }

  const postgresData = await loadDashboardDataFromPostgres([category.id])
  const postgresCategory = postgresData.categories[0]
  if (postgresCategory?.snapshots.length) {
    return postgresData
  }

  return { categories: [await loadCategoryDashboardDataFromFiles(category)] }
}

export async function loadDashboardDataForCategory(categoryId: string): Promise<DashboardData> {
  if (categoryId !== "code_reader_scanner" && !isNonCodeCategoryId(categoryId)) {
    return loadDashboardDataForCategoryUncached(categoryId)
  }

  const ttlMs = getDashboardMemoTtlMs()
  if (ttlMs <= 0) {
    return loadDashboardDataForCategoryUncached(categoryId)
  }

  const now = Date.now()
  const memo = dashboardDataForCategoryMemo.get(categoryId)
  if (memo && now - memo.at < ttlMs) {
    return memo.promise
  }

  for (const [memoCategoryId, entry] of dashboardDataForCategoryMemo) {
    if (now - entry.at >= ttlMs) {
      dashboardDataForCategoryMemo.delete(memoCategoryId)
    }
  }

  const promise = loadDashboardDataForCategoryUncached(categoryId)
  dashboardDataForCategoryMemo.set(categoryId, { at: now, promise })
  void promise.catch(() => {
    if (dashboardDataForCategoryMemo.get(categoryId)?.promise === promise) {
      dashboardDataForCategoryMemo.delete(categoryId)
    }
  })
  return promise
}

export async function loadOverviewDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "overview")
}

export async function loadBrandsDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "brands")
}

export async function loadSalesDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "sales")
}

export async function loadTypesDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "specs")
}

export async function loadReportsDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "reports")
}

export async function loadSurveysDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "surveys")
}

export async function loadConsultMeDashboardData() {
  return pruneDashboardDataForPage(await loadDashboardData(), "consult_me")
}

export async function loadDashboardDataFromFiles(): Promise<DashboardData> {
  const deploymentMode = getDashboardDeploymentMode()
  const enabledCategories = CATEGORY_CONFIG.filter(
    (category) => deploymentMode === "full" || category.id === "code_reader_scanner"
  )
  const categories = await Promise.all(enabledCategories.map(loadCategoryDashboardDataFromFiles))

  return {
    categories,
  }
}

async function loadNonCodeDashboardDataFromFiles(): Promise<DashboardData> {
  const deploymentMode = getDashboardDeploymentMode()
  const enabledCategories = CATEGORY_CONFIG.filter(
    (category) => deploymentMode === "full" && category.source === "csv"
  )
  const categories = await Promise.all(enabledCategories.map(loadCategoryDashboardDataFromFiles))

  return {
    categories,
  }
}

async function loadCategoryDashboardDataFromFiles(category: CategoryConfig): Promise<CategorySummary> {
  const snapshots =
    category.source === "csv"
      ? await loadCsvCategorySnapshots(resolveNonCodeCategoryDir(category.id, "raw_data"), category.id)
      : await loadCodeReaderScannerSnapshots(resolveCodeReaderDataDir())

  return {
    id: category.id,
    label: category.label,
    snapshots,
  }
}

export async function loadCsvCategorySnapshots(baseDir: string | null, categoryId?: NonCodeCategoryId) {
  if (!baseDir) return []
  const grouped = await listGroupedSnapshotFiles(baseDir)
  const snapshots = await Promise.all(
    Array.from(grouped.entries()).map(async ([date, dateFiles]) => {
      const fingerprint = await Promise.all(dateFiles.map(async (f) => {
        const s = await stat(f).catch(() => null)
        return s ? `${f}:${s.mtimeMs}:${s.size}` : `${f}:missing`
      }))
      return loadCsvSnapshotSummary(categoryId, date, dateFiles, fingerprint)
    })
  )

  return snapshots
    .filter((snapshot) => snapshot.totals.asinCount > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function loadCsvCategorySnapshotRecords(baseDir: string | null, categoryId?: NonCodeCategoryId) {
  if (!baseDir) return [] as Array<{ date: string; records: RawRecord[] }>
  const grouped = await listGroupedSnapshotFiles(baseDir)
  const snapshots = await Promise.all(
    Array.from(grouped.entries()).map(async ([date, dateFiles]) => {
      const records = await loadSnapshotRecords(dateFiles, categoryId)
      return { date, records }
    })
  )

  return snapshots
    .filter((snapshot) => snapshot.records.length > 0)
    .sort((a, b) => a.date.localeCompare(b.date))
}

async function listGroupedSnapshotFiles(baseDir: string) {
  const files = await listCsvFiles(baseDir).catch(() => [])
  return groupFilesBySnapshot(files, baseDir)
}

async function listCsvFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_SOURCE_DIRS.has(entry.name)) continue
      const nested = await listCsvFiles(fullPath)
      files.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      files.push(fullPath)
    }
  }

  return files
}

function groupFilesBySnapshot(files: string[], baseDir: string): Map<string, string[]> {
  // CSV exports can be created on different days within the same month.
  // For non-code-reader categories, month folders (YYYYMM) are the source of truth for snapshot period.
  // Within a month bucket, keep only the latest export run date.
  const monthLatest = new Map<string, { runDate: string; files: string[] }>()

  for (const file of files) {
    const match = path.basename(file).match(CSV_DATE_REGEX)
    const runDate = match?.[1] ?? "0000-00-00"
    const folderMonthKey = monthKeyFromFolderName(file, baseDir)
    const monthKey = folderMonthKey ?? (match ? monthKeyFromDate(runDate) : null)
    if (!monthKey) continue
    const existing = monthLatest.get(monthKey)
    if (!existing || runDate > existing.runDate) {
      monthLatest.set(monthKey, { runDate, files: [file] })
      continue
    }
    if (runDate === existing.runDate) {
      existing.files.push(file)
    }
  }

  const grouped = new Map<string, string[]>()
  for (const [monthKey, entry] of monthLatest.entries()) {
    grouped.set(normalizeSnapshotDate(monthKey), entry.files)
  }

  return grouped
}

function monthKeyFromFolderName(file: string, baseDir: string) {
  const relative = path.relative(baseDir, file)
  const segments = relative.split(path.sep).slice(0, -1)
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index]
    if (/^\d{6}$/.test(segment)) {
      return `${segment.slice(0, 4)}-${segment.slice(4, 6)}`
    }
  }
  return null
}

async function loadSnapshotRecords(files: string[], categoryId?: NonCodeCategoryId): Promise<RawRecord[]> {
  const records = new Map<string, RawRecord>()

  for (const file of files) {
    const contents = await readFile(file, "utf8")
    const rows = parseCsv(contents)
    if (!rows.length) continue
    const headers = rows[0].map(normalizeHeader)
    const columnIndex = new Map(headers.map((name, idx) => [name, idx]))

    for (const row of rows.slice(1)) {
      const getValue = (name: string) => {
        const index = columnIndex.get(name)
        if (index === undefined) return ""
        return row[index] ?? ""
      }

      const asin = getValue("ASIN").trim().toUpperCase()
      if (!asin) continue

      const record: RawRecord = {
        asin,
        title: getValue("Title").trim(),
        brand: getValue("Brand").trim() || "Unknown",
        price: parseNumber(getValue("Price")),
        asinSales: parseNumber(getValue("ASIN Sales")),
        asinRevenue: parseNumber(getValue("ASIN Revenue")),
        reviewCount: parseNumber(getValue("Review Count")),
        rating: parseNumber(getValue("Reviews Rating")),
        fulfillment: getValue("Fulfillment").trim() || undefined,
        sizeTier: getValue("Size Tier").trim() || getValue("Shipping Details").trim() || undefined,
        subcategory: getValue("Subcategory").trim() || undefined,
        url: getValue("URL").trim() || undefined,
        imageUrl: getValue("Image URL").trim() || undefined,
        bsr: parseOptionalNumber(getValue("BSR")),
        subcategoryBsr: parseOptionalNumber(getValue("Subcategory BSR")),
        shippingDetails: getValue("Shipping Details").trim() || undefined,
        length: parseOptionalNumber(getValue("Length")),
        width: parseOptionalNumber(getValue("Width")),
        height: parseOptionalNumber(getValue("Height")),
        weight: parseOptionalNumber(getValue("Weight")),
        bestSalesPeriod: getValue("Best Sales Period").trim() || undefined,
        listingAgeMonths: parseOptionalNumber(getValue("Listing Age (Months)")),
        imageCount: parseOptionalNumber(getValue("Number of Images")),
        variationCount: parseOptionalNumber(getValue("Variation Count")),
        lastYearSales: parseOptionalNumber(getValue("Last Year Sales")),
        salesYearOverYearPct: parseOptionalNumber(getValue("Sales Year Over Year (%)")),
        salesToReviews: parseOptionalNumber(getValue("Sales to Reviews")),
      }

      if (isBackpackCategory(categoryId)) {
        const classification = classifyBackpackProduct(record)
        if (!classification.includeInCategory) {
          continue
        }
        record.typeLabel = classification.typeLabel
        record.categoryMetadata = {
          tradeFocus: classification.tradeFocus,
          isRolling: classification.isRolling,
          hasLaptopCompartment: classification.hasLaptopCompartment,
          baseStyle: classification.baseStyle,
          shippingTier: classification.shippingTier,
          heightBand: classification.heightBand,
          weightBand: classification.weightBand,
          bestSalesSeason: classification.bestSalesSeason,
          bsrTier: classification.bsrTier,
          bsr: record.bsr ?? null,
          subcategoryBsr: record.subcategoryBsr ?? null,
          shippingDetails: record.shippingDetails ?? null,
          length: record.length ?? null,
          width: record.width ?? null,
          height: record.height ?? null,
          weight: record.weight ?? null,
          bestSalesPeriod: record.bestSalesPeriod ?? null,
          listingAgeMonths: record.listingAgeMonths ?? null,
          imageCount: record.imageCount ?? null,
          variationCount: record.variationCount ?? null,
          lastYearSales: record.lastYearSales ?? null,
          salesYearOverYearPct: record.salesYearOverYearPct ?? null,
          salesToReviews: record.salesToReviews ?? null,
        }
      }

      if (isJumpStartersCategory(categoryId)) {
        const classification = classifyJumpStarterProduct(record)
        if (!classification.includeInCategory) {
          continue
        }
        record.typeLabel = classification.typeLabel
        record.excludeFromAvgPrice = classification.excludeFromAvgPrice
        record.categoryMetadata = {
          isAccessory: classification.isAccessory,
          accessoryType: classification.accessoryType,
          hasInflator: classification.hasInflator,
          hasPowerStation: classification.hasPowerStation,
          voltageClass: classification.voltageClass,
        }
      }

      if (isMechanicStoolCategory(categoryId)) {
        const classification = classifyMechanicStoolProduct(record)
        if (!classification.includeInCategory) {
          continue
        }
        record.typeLabel = classification.typeLabel
        record.categoryMetadata = {
          isAdjustableHeight: classification.isAdjustableHeight,
          hasBackrest: classification.hasBackrest,
          storageType: classification.storageType,
          materialLabel: classification.materialLabel,
        }
      }

      if (isOilCategory(categoryId)) {
        const classification = classifyOilProduct(record)
        if (!classification.includeInCategory) {
          continue
        }
        record.typeLabel = classification.typeLabel
        record.categoryMetadata = {
          rawSubcategory: classification.rawSubcategory,
          productFamily: classification.productFamily,
          fluidApplication: classification.fluidApplication,
          viscosityGrade: classification.viscosityGrade,
          packSize: classification.packSize,
          seasonalUse: classification.seasonalUse,
        }
      }

      if (isStethoscopeCategory(categoryId)) {
        const classification = classifyStethoscopeProduct(record)
        if (!classification.includeInCategory) {
          continue
        }
        record.typeLabel = classification.typeLabel
        record.categoryMetadata = {
          diagnosticType: classification.diagnosticType,
          isElectronic: classification.isElectronic,
          channelCount: classification.channelCount,
          probeCount: classification.probeCount,
          vehicleContext: classification.vehicleContext,
        }
      }

      // Enforce category-wide ceiling for non-code-reader snapshots.
      if (record.price >= NON_CODE_READER_PRICE_CEILING) {
        continue
      }

      const existing = records.get(asin)
      if (!existing || record.asinRevenue > existing.asinRevenue) {
        records.set(asin, record)
      }
    }
  }

  return Array.from(records.values())
}

async function loadCsvSnapshotSummaryUncached(
  categoryId: NonCodeCategoryId | undefined,
  snapshotDate: string,
  files: string[],
  _fingerprint: string[]
) {
  const records = await loadSnapshotRecords(files, categoryId)
  return buildSnapshotSummary(snapshotDate, records, categoryId)
}

const MAX_CACHED_CSV_SNAPSHOT_ENVELOPE_SIZE = 1.9 * 1024 * 1024
const oversizedCsvSnapshotKeys = new Set<string>()
const warnedOversizedCsvSnapshotKeys = new Set<string>()

class OversizedCsvSnapshotSummaryError extends Error {
  constructor(
    readonly cacheKey: string,
    readonly envelopeSize: number,
    readonly result: SnapshotSummary
  ) {
    super(`CSV snapshot summary exceeds cache size limit: ${cacheKey}`)
  }
}

async function loadCacheableCsvSnapshotSummary(
  categoryId: NonCodeCategoryId | undefined,
  snapshotDate: string,
  files: string[],
  fingerprint: string[]
) {
  const result = await loadCsvSnapshotSummaryUncached(categoryId, snapshotDate, files, fingerprint)
  const serialized = JSON.stringify(result)
  const envelopeSize = JSON.stringify({ headers: {}, body: serialized, status: 200, url: "" }).length
  if (envelopeSize > MAX_CACHED_CSV_SNAPSHOT_ENVELOPE_SIZE) {
    const cacheKey = `${categoryId ?? "-"}|${snapshotDate}`
    oversizedCsvSnapshotKeys.add(cacheKey)
    // Throwing prevents unstable_cache from attempting to store an oversized entry.
    throw new OversizedCsvSnapshotSummaryError(cacheKey, envelopeSize, result)
  }
  return result
}

const loadCsvSnapshotSummaryCached = unstable_cache(
  loadCacheableCsvSnapshotSummary,
  ["csv-snapshot-summary", "v1"],
  {
    tags: [DASHBOARD_DATA_TAG],
    revalidate: DEFAULT_CACHE_REVALIDATE_SECONDS,
  }
)

async function loadCsvSnapshotSummary(
  categoryId: NonCodeCategoryId | undefined,
  snapshotDate: string,
  files: string[],
  fingerprint: string[]
) {
  // Plain-Node scripts import this module outside the Next runtime.
  if (!process.env.NEXT_RUNTIME) {
    return loadCsvSnapshotSummaryUncached(categoryId, snapshotDate, files, fingerprint)
  }

  const cacheKey = `${categoryId ?? "-"}|${snapshotDate}`
  if (oversizedCsvSnapshotKeys.has(cacheKey)) {
    return loadCsvSnapshotSummaryUncached(categoryId, snapshotDate, files, fingerprint)
  }

  try {
    return await loadCsvSnapshotSummaryCached(categoryId, snapshotDate, files, fingerprint)
  } catch (error) {
    if (!(error instanceof OversizedCsvSnapshotSummaryError)) throw error
    if (!warnedOversizedCsvSnapshotKeys.has(error.cacheKey)) {
      warnedOversizedCsvSnapshotKeys.add(error.cacheKey)
      console.warn(
        `Bypassing unstable_cache for oversized CSV snapshot summary ${error.cacheKey} (${error.envelopeSize} bytes)`
      )
    }
    return error.result
  }
}

export async function loadDashboardDataFromPostgres(categoryIds?: readonly CategoryId[]): Promise<DashboardData> {
  const deploymentMode = getDashboardDeploymentMode()
  const enabledCategories = CATEGORY_CONFIG.filter(
    (category) => deploymentMode === "full" || category.id === "code_reader_scanner"
  ).filter((category) => !categoryIds || categoryIds.includes(category.id))
  if (!enabledCategories.length) {
    return { categories: [] }
  }
  const result = await queryDb<{
    category_id: CategoryId
    label: string
    snapshot_date: string | Date
    snapshot_payload: SnapshotSummary | string
    metadata: SnapshotMetadata | string | null
  }>(
    `
      SELECT category_id, label, snapshot_date, snapshot_payload, metadata
      FROM category_snapshots
      WHERE category_id = ANY($1::text[])
      ORDER BY category_id ASC, snapshot_date ASC
    `,
    [enabledCategories.map((category) => category.id)]
  )
  const categories = new Map<CategoryId, CategorySummary>()

  for (const row of result.rows) {
    const snapshotDate = coerceSnapshotDate(row.snapshot_date)
    if (!snapshotDate) continue
    const snapshot = parseSnapshotPayload(row.snapshot_payload)
    if (!snapshot) continue
    snapshot.date = snapshotDate
    const metadata = parseSnapshotMetadata(row.metadata)
    if (metadata) {
      snapshot.metadata = metadata
    }

    const existing = categories.get(row.category_id)
    if (existing) {
      existing.snapshots.push(snapshot)
      continue
    }

    categories.set(row.category_id, {
      id: row.category_id,
      label: row.label,
      snapshots: [snapshot],
    })
  }

  return {
    categories: enabledCategories
      .map((category) => categories.get(category.id))
      .filter((category): category is CategorySummary => Boolean(category)),
  }
}

function needsNonCodeDashboardFallback(data: DashboardData) {
  if (getDashboardDeploymentMode() !== "full") {
    return false
  }

  const categoriesById = new Map(data.categories.map((category) => [category.id, category]))
  return listNonCodeCategoryConfigs().some((category) => {
    const existing = categoriesById.get(category.id)
    return !existing || existing.snapshots.length === 0
  })
}

function mergeDashboardData(primary: DashboardData, fallback: DashboardData): DashboardData {
  const merged = new Map<CategoryId, CategorySummary>(
    primary.categories.map((category) => [
      category.id,
      {
        ...category,
        snapshots: [...category.snapshots].sort((a, b) => a.date.localeCompare(b.date)),
      },
    ])
  )

  for (const category of fallback.categories) {
    if (category.id === "code_reader_scanner") continue
    const existing = merged.get(category.id)
    if (!existing) {
      merged.set(category.id, {
        ...category,
        snapshots: [...category.snapshots].sort((a, b) => a.date.localeCompare(b.date)),
      })
      continue
    }

    const snapshotsByDate = new Map(existing.snapshots.map((snapshot) => [snapshot.date, snapshot]))
    for (const snapshot of category.snapshots) {
      if (!snapshotsByDate.has(snapshot.date)) {
        existing.snapshots.push(snapshot)
      }
    }
    existing.snapshots.sort((a, b) => a.date.localeCompare(b.date))
  }

  const enabledCategories = CATEGORY_CONFIG.filter(
    (category) => getDashboardDeploymentMode() === "full" || category.id === "code_reader_scanner"
  )

  return {
    categories: enabledCategories
      .map((category) => merged.get(category.id))
      .filter((category): category is CategorySummary => Boolean(category)),
  }
}

function pruneDashboardDataForPage(data: DashboardData, scope: DashboardPageScope): DashboardData {
  if (scope === "consult_me") {
    const codeReaderCategory = data.categories.find((category) => category.id === "code_reader_scanner")
    if (!codeReaderCategory) {
      return { categories: [] }
    }
    const latestSnapshot = codeReaderCategory.snapshots[codeReaderCategory.snapshots.length - 1]
    return {
      categories: [
        {
          id: codeReaderCategory.id,
          label: codeReaderCategory.label,
          snapshots: latestSnapshot
            ? [pruneSnapshotForPage(latestSnapshot, scope)]
            : [],
        },
      ],
    }
  }

  return {
    categories: data.categories.map((category) => ({
      id: category.id,
      label: category.label,
      snapshots: category.snapshots.map((snapshot) => pruneSnapshotForPage(snapshot, scope)),
    })),
  }
}

function pruneSnapshotForPage(
  snapshot: SnapshotSummary,
  scope: DashboardPageScope
): SnapshotSummary {
  const pruned: SnapshotSummary = {
    date: snapshot.date,
    label: snapshot.label,
    totals: snapshot.totals,
    topProducts: [],
    brandTotals: [],
    brandListings: [],
    priceTiers: [],
  }

  switch (scope) {
    case "overview":
      pruned.topProducts = snapshot.topProducts
      pruned.top50ByUnits = snapshot.top50ByUnits
      pruned.brandTotals = snapshot.brandTotals
      pruned.priceTiers = snapshot.priceTiers
      pruned.rolling12 = snapshot.rolling12
      pruned.typeBreakdowns = snapshot.typeBreakdowns
      pruned.qualityIssues = snapshot.qualityIssues
      break
    case "brands":
      pruned.brandTotals = snapshot.brandTotals
      pruned.brandListings = snapshot.brandListings
      pruned.rolling12 = snapshot.rolling12
      pruned.typeBreakdowns = snapshot.typeBreakdowns
      break
    case "sales":
      pruned.topProducts = snapshot.topProducts
      pruned.top50ByUnits = snapshot.top50ByUnits
      pruned.qualityIssues = snapshot.qualityIssues
      break
    case "specs":
      pruned.topProducts = snapshot.topProducts
      pruned.typeBreakdowns = snapshot.typeBreakdowns
      pruned.metadata = snapshot.metadata
      break
    case "reports":
      pruned.topProducts = snapshot.topProducts
      break
    case "surveys":
      pruned.topProducts = snapshot.topProducts
      break
    case "consult_me":
      pruned.brandTotals = snapshot.brandTotals
      pruned.rolling12 = snapshot.rolling12
      break
  }

  return pruned
}

function parseSnapshotPayload(value: SnapshotSummary | string | null) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as SnapshotSummary
    } catch {
      return null
    }
  }
  if (value && typeof value === "object") {
    return value as SnapshotSummary
  }
  return null
}

function parseSnapshotMetadata(value: SnapshotMetadata | string | null) {
  if (!value) return null
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as SnapshotMetadata)
        : null
    } catch {
      return null
    }
  }
  return value
}

function coerceSnapshotDate(value: string | Date) {
  if (typeof value === "string") {
    return normalizeSnapshotDate(value)
  }
  if (value instanceof Date) {
    return normalizeSnapshotDate(value.toISOString().slice(0, 10))
  }
  return null
}

function buildSnapshotSummary(date: string, records: RawRecord[], categoryId?: NonCodeCategoryId): SnapshotSummary {
  const mapRecord = (record: RawRecord): ProductSummary => ({
    asin: record.asin,
    title: record.title,
    brand: record.brand,
    price: record.price,
    revenue: record.asinRevenue,
    units: record.asinSales,
    monthlyRevenue: record.asinRevenue,
    monthlyUnits: record.asinSales,
    reviewCount: record.reviewCount,
    rating: record.rating,
    fulfillment: record.fulfillment,
    sizeTier: record.sizeTier,
    subcategory: record.subcategory,
    toolType: record.typeLabel,
    url: record.url,
    imageUrl: record.imageUrl,
  })

  const totalRevenue = records.reduce((sum, record) => sum + record.asinRevenue, 0)
  const totalUnits = records.reduce((sum, record) => sum + record.asinSales, 0)
  const totalReviews = records.reduce((sum, record) => sum + record.reviewCount, 0)
  const ratingWeighted = records.reduce(
    (sum, record) => sum + record.rating * record.reviewCount,
    0
  )
  const avgPrice = averagePriceForCategory(categoryId, records)

  const brandMap = new Map<string, { revenue: number; units: number }>()
  for (const record of records) {
    const current = brandMap.get(record.brand) ?? { revenue: 0, units: 0 }
    current.revenue += record.asinRevenue
    current.units += record.asinSales
    brandMap.set(record.brand, current)
  }

  const brandTotals: BrandSummary[] = Array.from(brandMap.entries())
    .map(([brand, values]) => ({
      brand,
      revenue: values.revenue,
      units: values.units,
      share: totalRevenue ? values.revenue / totalRevenue : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const top3Share = totalRevenue
    ? brandTotals.slice(0, 3).reduce((sum, brand) => sum + brand.share, 0)
    : 0

  const meaningfulCompetitors = brandTotals.filter((brand) => brand.share >= 0.01).length

  const topBrandListings = brandTotals.slice(0, 10).map((brand) => {
    const products = records
      .filter((record) => record.brand === brand.brand)
      .sort((a, b) => b.asinRevenue - a.asinRevenue)
      .map(mapRecord)
    return { brand: brand.brand, products }
  })

  const topProducts = [...records]
    .sort((a, b) => b.asinRevenue - a.asinRevenue)
    .slice(0, TOP_PRODUCTS_COUNT)
    .map(mapRecord)

  const priceTierTotals = PRICE_TIERS.map((tier) => {
    const revenue = records
      .filter((record) => record.price >= tier.min && record.price < tier.max)
      .reduce((sum, record) => sum + record.asinRevenue, 0)
    return {
      label: tier.label,
      revenue,
      share: totalRevenue ? revenue / totalRevenue : 0,
    }
  })

  return {
    date,
    label: formatSnapshotLabelMonthEnd(date),
    totals: {
      revenue: totalRevenue,
      units: totalUnits,
      asinCount: records.length,
      avgPrice,
      ratingAvg: totalReviews ? ratingWeighted / totalReviews : 0,
      reviewCount: totalReviews,
      top3Share,
      meaningfulCompetitors,
      brandCount: brandTotals.length,
    },
    topProducts,
    brandTotals,
    brandListings: topBrandListings,
    priceTiers: priceTierTotals,
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 1
        } else {
          inQuotes = false
        }
      } else {
        field += char
      }
      continue
    }

    if (char === '"') {
      inQuotes = true
      continue
    }

    if (char === ",") {
      row.push(field)
      field = ""
      continue
    }

    if (char === "\n") {
      row.push(field)
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row)
      }
      row = []
      field = ""
      continue
    }

    if (char === "\r") {
      if (text[i + 1] === "\n") {
        i += 1
      }
      row.push(field)
      if (row.some((cell) => cell.trim() !== "")) {
        rows.push(row)
      }
      row = []
      field = ""
      continue
    }

    field += char
  }

  if (field.length || row.length) {
    row.push(field)
    if (row.some((cell) => cell.trim() !== "")) {
      rows.push(row)
    }
  }

  return rows
}

function normalizeHeader(value: string): string {
  return value.replace(/^\ufeff/, "").replace(/^"|"$/g, "").trim()
}

function parseNumber(value: string): number {
  const cleaned = value.replace(/[$,%]/g, "").trim()
  if (!cleaned || cleaned.toLowerCase() === "n/a") {
    return 0
  }
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseOptionalNumber(value: string): number | undefined {
  const cleaned = value.replace(/[$,%]/g, "").trim()
  if (!cleaned || cleaned.toLowerCase() === "n/a" || cleaned === "-") {
    return undefined
  }
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : undefined
}
