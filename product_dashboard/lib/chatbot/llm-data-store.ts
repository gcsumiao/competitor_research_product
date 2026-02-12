import { createHash } from "crypto"
import { readdir, readFile, stat } from "fs/promises"
import path from "path"

import type { LlmTableName } from "@/lib/chatbot/llm-data-catalog"
import { loadDashboardData, type ProductSummary } from "@/lib/competitor-data"

type Primitive = string | number | boolean | null
export type LlmRow = Record<string, Primitive>
export type LlmTableMap = Record<LlmTableName, LlmRow[]>

export type LlmDataStore = {
  loadedAt: number
  fingerprint: string
  tables: LlmTableMap
  sourceFiles: string[]
}

const CACHE_TTL_MS = 120_000

let cachedStore: LlmDataStore | null = null

const RAW_CATEGORY_DIRS: Record<string, string> = {
  dmm: "DMM_h10/raw_data",
  borescope: "DMM_h10/Borescope/raw_data",
  thermal_imager: "DMM_h10/Thermal Imager/raw_data",
  night_vision: "DMM_h10/Night Vision Monoculars/raw_data",
}

const SNAPSHOT_DATE_REGEX = /(\d{4}-\d{2}-\d{2})/

export async function loadLlmDataStore(): Promise<LlmDataStore> {
  const repoRoot = resolveRepoRoot()
  const sourceFiles = await discoverSourceFiles(repoRoot)
  const fingerprint = await computeFingerprint(sourceFiles)
  const now = Date.now()

  if (
    cachedStore &&
    now - cachedStore.loadedAt <= CACHE_TTL_MS &&
    cachedStore.fingerprint === fingerprint
  ) {
    return cachedStore
  }

  const dashboard = await loadDashboardData()
  const tables = createEmptyTables()

  for (const category of dashboard.categories) {
    tables.categories.push({
      category_id: category.id,
      label: category.label,
    })

    for (const snapshot of category.snapshots) {
      const sourceTag = `dashboard_snapshot:${category.id}:${snapshot.date}`

      tables.snapshots.push({
        category_id: category.id,
        snapshot_date: snapshot.date,
        snapshot_label: snapshot.label,
        source_type: "dashboard_snapshot",
        source_file: sourceTag,
      })

      tables.market_monthly.push({
        category_id: category.id,
        snapshot_date: snapshot.date,
        revenue: safeNumber(snapshot.totals.revenue),
        units: safeNumber(snapshot.totals.units),
        asin_count: safeNumber(snapshot.totals.asinCount),
        avg_price: safeNumber(snapshot.totals.avgPrice),
        rating_avg: safeNumber(snapshot.totals.ratingAvg),
        brand_count: safeNumber(snapshot.totals.brandCount),
        source_type: "dashboard_snapshot",
        source_file: sourceTag,
      })

      const brandRanksByRevenue = new Map(
        snapshot.brandTotals
          .slice()
          .sort((a, b) => b.revenue - a.revenue)
          .map((row, index) => [normalize(row.brand), index + 1] as const)
      )
      const brandRanksByUnits = new Map(
        snapshot.brandTotals
          .slice()
          .sort((a, b) => b.units - a.units)
          .map((row, index) => [normalize(row.brand), index + 1] as const)
      )

      for (const row of snapshot.brandTotals) {
        tables.brands_monthly.push({
          category_id: category.id,
          snapshot_date: snapshot.date,
          brand: row.brand,
          revenue: safeNumber(row.revenue),
          units: safeNumber(row.units),
          share: safeNumber(row.share),
          rank_revenue: safeNumber(brandRanksByRevenue.get(normalize(row.brand))),
          rank_units: safeNumber(brandRanksByUnits.get(normalize(row.brand))),
          source_type: "dashboard_snapshot",
          source_file: sourceTag,
        })
      }

      const products = mergeSnapshotProducts(snapshot)
      const byRevenue = [...products].sort((a, b) => safeNumber(b.revenue) - safeNumber(a.revenue))
      const byUnits = [...products].sort((a, b) => safeNumber(b.units) - safeNumber(a.units))
      const revenueRank = new Map(byRevenue.map((row, index) => [normalize(row.asin), index + 1] as const))
      const unitsRank = new Map(byUnits.map((row, index) => [normalize(row.asin), index + 1] as const))

      for (const product of products) {
        tables.products_monthly.push({
          category_id: category.id,
          snapshot_date: snapshot.date,
          asin: product.asin,
          title: product.title,
          brand: product.brand,
          type: product.toolType ?? product.subcategory ?? "",
          price: safeNumber(product.avgPrice ?? product.price),
          revenue: safeNumber(product.monthlyRevenue ?? product.revenue),
          units: safeNumber(product.monthlyUnits ?? product.units),
          review_count: safeNumber(product.reviewCount),
          rating: safeNumber(product.toolRating ?? product.rating),
          rank_revenue: safeNumber(revenueRank.get(normalize(product.asin))),
          rank_units: safeNumber(unitsRank.get(normalize(product.asin))),
          source_type: "dashboard_snapshot",
          source_file: sourceTag,
        })
      }

      for (const metric of snapshot.typeBreakdowns?.allAsins ?? []) {
        tables.type_breakdowns.push({
          category_id: category.id,
          snapshot_date: snapshot.date,
          scope_key: metric.scopeKey,
          scope_label: metric.label,
          metric_set: "all_asins",
          avg_price: safeNumber(metric.avgPrice),
          units: safeNumber(metric.units),
          units_share: safeNumber(metric.unitsShare),
          revenue: safeNumber(metric.revenue),
          revenue_share: safeNumber(metric.revenueShare),
          source_type: "dashboard_snapshot",
          source_file: sourceTag,
        })
      }
      for (const metric of snapshot.typeBreakdowns?.top50 ?? []) {
        tables.type_breakdowns.push({
          category_id: category.id,
          snapshot_date: snapshot.date,
          scope_key: metric.scopeKey,
          scope_label: metric.label,
          metric_set: "top50",
          avg_price: safeNumber(metric.avgPrice),
          units: safeNumber(metric.units),
          units_share: safeNumber(metric.unitsShare),
          revenue: safeNumber(metric.revenue),
          revenue_share: safeNumber(metric.revenueShare),
          source_type: "dashboard_snapshot",
          source_file: sourceTag,
        })
      }

      if (category.id === "code_reader_scanner") {
        appendCodeReaderRows(tables, snapshot, sourceTag)
      }
    }
  }

  await appendRawCsvRows(tables, repoRoot)

  const store: LlmDataStore = {
    loadedAt: now,
    fingerprint,
    tables,
    sourceFiles,
  }
  cachedStore = store
  return store
}

function appendCodeReaderRows(
  tables: LlmTableMap,
  snapshot: Awaited<ReturnType<typeof loadDashboardData>>["categories"][number]["snapshots"][number],
  sourceTag: string
) {
  for (const product of snapshot.topProducts) {
    tables.code_reader_workbook_rows.push({
      category_id: "code_reader_scanner",
      snapshot_date: snapshot.date,
      sheet_type: "top50_revenue",
      brand: product.brand,
      asin: product.asin,
      title: product.title,
      metric_name: "monthly_revenue",
      metric_value: safeNumber(product.monthlyRevenue ?? product.revenue),
      source_file: sourceTag,
    })
  }
  for (const product of snapshot.top50ByUnits ?? []) {
    tables.code_reader_workbook_rows.push({
      category_id: "code_reader_scanner",
      snapshot_date: snapshot.date,
      sheet_type: "top50_units",
      brand: product.brand,
      asin: product.asin,
      title: product.title,
      metric_name: "monthly_units",
      metric_value: safeNumber(product.monthlyUnits ?? product.units),
      source_file: sourceTag,
    })
  }
  for (const row of snapshot.brandTotals) {
    tables.code_reader_workbook_rows.push({
      category_id: "code_reader_scanner",
      snapshot_date: snapshot.date,
      sheet_type: "summary",
      brand: row.brand,
      asin: "",
      title: "",
      metric_name: "monthly_revenue",
      metric_value: safeNumber(row.revenue),
      source_file: sourceTag,
    })
    tables.code_reader_workbook_rows.push({
      category_id: "code_reader_scanner",
      snapshot_date: snapshot.date,
      sheet_type: "summary",
      brand: row.brand,
      asin: "",
      title: "",
      metric_name: "monthly_units",
      metric_value: safeNumber(row.units),
      source_file: sourceTag,
    })
  }
  for (const row of snapshot.rolling12?.revenue?.brands ?? []) {
    tables.code_reader_workbook_rows.push({
      category_id: "code_reader_scanner",
      snapshot_date: snapshot.date,
      sheet_type: "rolling12_revenue",
      brand: row.brand,
      asin: "",
      title: "",
      metric_name: "grand_total",
      metric_value: safeNumber(row.grandTotal),
      source_file: sourceTag,
    })
  }
  for (const row of snapshot.rolling12?.units?.brands ?? []) {
    tables.code_reader_workbook_rows.push({
      category_id: "code_reader_scanner",
      snapshot_date: snapshot.date,
      sheet_type: "rolling12_units",
      brand: row.brand,
      asin: "",
      title: "",
      metric_name: "grand_total",
      metric_value: safeNumber(row.grandTotal),
      source_file: sourceTag,
    })
  }
}

async function appendRawCsvRows(tables: LlmTableMap, repoRoot: string) {
  for (const [categoryId, relativeDir] of Object.entries(RAW_CATEGORY_DIRS)) {
    const baseDir = path.join(repoRoot, relativeDir)
    const files = await listCsvFiles(baseDir).catch(() => [])
    for (const file of files) {
      const raw = await readFile(file, "utf8").catch(() => "")
      if (!raw) continue
      const rows = parseCsv(raw)
      if (rows.length <= 1) continue
      const headers = rows[0].map((value) => normalizeHeader(value))
      const idx = new Map(headers.map((header, index) => [header, index] as const))
      const snapshotDate = detectSnapshotDate(path.basename(file))

      for (const row of rows.slice(1)) {
        const get = (name: string) => {
          const index = idx.get(name)
          if (index === undefined) return ""
          return row[index] ?? ""
        }
        const asin = get("asin").trim()
        if (!asin) continue
        tables.raw_rows_csv.push({
          category_id: categoryId,
          snapshot_date: snapshotDate,
          source_file: file,
          asin,
          title: get("title").trim(),
          brand: get("brand").trim(),
          price: safeNumber(get("price")),
          asin_sales: safeNumber(get("asinsales")),
          asin_revenue: safeNumber(get("asinrevenue")),
          review_count: safeNumber(get("reviewcount")),
          rating: safeNumber(get("reviewsrating")),
          fulfillment: get("fulfillment").trim(),
          subcategory: get("subcategory").trim(),
          url: get("url").trim(),
        })
      }
    }
  }
}

async function listCsvFiles(baseDir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(baseDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(baseDir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listCsvFiles(fullPath)))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      out.push(fullPath)
    }
  }
  return out
}

async function discoverSourceFiles(repoRoot: string) {
  const targets = [
    path.join(repoRoot, "DMM_h10"),
    path.join(repoRoot, "product_dashboard/data/code_reader_scanner"),
  ]
  const files: string[] = []
  for (const target of targets) {
    files.push(...(await listRelevantFiles(target).catch(() => [])))
  }
  files.sort()
  return files
}

async function listRelevantFiles(baseDir: string): Promise<string[]> {
  const out: string[] = []
  const entries = await readdir(baseDir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(baseDir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await listRelevantFiles(full)))
      continue
    }
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (
      lower.endsWith(".csv") ||
      lower.endsWith(".xlsx") ||
      lower.endsWith(".json")
    ) {
      out.push(full)
    }
  }
  return out
}

async function computeFingerprint(files: string[]) {
  const hasher = createHash("sha1")
  for (const file of files) {
    const stats = await stat(file).catch(() => null)
    if (!stats) continue
    hasher.update(file)
    hasher.update(String(stats.mtimeMs))
    hasher.update(String(stats.size))
  }
  return hasher.digest("hex")
}

function mergeSnapshotProducts(
  snapshot: Awaited<ReturnType<typeof loadDashboardData>>["categories"][number]["snapshots"][number]
) {
  const map = new Map<string, ProductSummary>()
  const add = (product: ProductSummary) => {
    const key = normalize(product.asin)
    if (!key) return
    const existing = map.get(key)
    if (!existing) {
      map.set(key, product)
      return
    }
    if (safeNumber(product.monthlyRevenue ?? product.revenue) > safeNumber(existing.monthlyRevenue ?? existing.revenue)) {
      map.set(key, product)
    }
  }
  for (const product of snapshot.topProducts) add(product)
  for (const product of snapshot.top50ByUnits ?? []) add(product)
  for (const listing of snapshot.brandSheetListings ?? []) {
    for (const product of listing.products) add(product)
  }
  return Array.from(map.values())
}

function createEmptyTables(): LlmTableMap {
  return {
    categories: [],
    snapshots: [],
    products_monthly: [],
    brands_monthly: [],
    market_monthly: [],
    type_breakdowns: [],
    raw_rows_csv: [],
    code_reader_workbook_rows: [],
  }
}

function resolveRepoRoot() {
  const cwd = process.cwd()
  return path.basename(cwd) === "product_dashboard" ? path.resolve(cwd, "..") : cwd
}

function parseCsv(input: string) {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false
  let i = 0
  while (i < input.length) {
    const char = input[i]
    const next = input[i + 1]
    if (char === '"') {
      if (inQuotes && next === '"') {
        field += '"'
        i += 2
        continue
      }
      inQuotes = !inQuotes
      i += 1
      continue
    }
    if (char === "," && !inQuotes) {
      row.push(field)
      field = ""
      i += 1
      continue
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ""
      i += 1
      continue
    }
    field += char
    i += 1
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function safeNumber(value: unknown) {
  const numeric = Number(String(value ?? "").replace(/[^0-9.-]/g, ""))
  return Number.isFinite(numeric) ? numeric : 0
}

function detectSnapshotDate(fileName: string) {
  const match = fileName.match(SNAPSHOT_DATE_REGEX)
  return match ? match[1] : ""
}
