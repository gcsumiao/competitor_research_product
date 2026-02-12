import { readFile } from "fs/promises"
import path from "path"

import * as XLSX from "xlsx"

import type {
  CategoryId,
  CategorySummary,
  SnapshotSummary,
  BrandSummary as SnapshotBrandSummary,
} from "@/lib/competitor-data"
import type { DataCoverage } from "@/lib/chatbot/types"
import { detectWorkbookSchema } from "@/lib/chatbot/schema-detector"

export type NormalizedProduct = {
  asin: string
  title: string
  brand: string
  type: string
  price: number
  revenue: number
  units: number
  rating: number
  reviews: number
  link?: string
  featureValues: Record<string, string>
}

export type NormalizedBrandSummary = {
  brand: string
  revenue: number
  units: number
  share: number
  avgPrice: number
  avgRating: number
  listings: number
}

export type NormalizedTypeMix = {
  type: string
  revenue: number
  units: number
  revenueShare: number
  unitShare: number
  avgPrice: number
}

export type NormalizedPriceTier = {
  tier: string
  revenue: number
  units: number
  revenueShare: number
  unitShare: number
  avgPrice: number
}

export type NormalizedFeaturePremium = {
  feature: string
  withFeatureAvgPrice: number
  withoutFeatureAvgPrice: number
  premiumPct: number
  withFeatureRevenueShare: number
  withFeatureUnitShare: number
}

export type NormalizedCategoryData = {
  categoryId: CategoryId
  categoryLabel: string
  snapshotDate: string
  sourceFile: string
  sourceType: "category_workbook" | "dashboard_snapshot_fallback"
  topByRevenue: NormalizedProduct[]
  topByUnits: NormalizedProduct[]
  brands: NormalizedBrandSummary[]
  marketRevenue: number
  marketUnits: number
  typeMix: NormalizedTypeMix[]
  priceTiers: NormalizedPriceTier[]
  featurePremiums: NormalizedFeaturePremium[]
  warnings: string[]
  dataCoverage: DataCoverage
}

type WorkbookContext = {
  workbook: XLSX.WorkBook
  workbookPath: string
  category: CategorySummary
  snapshot: SnapshotSummary
}

type HeaderMap = {
  asin?: number
  title?: number
  brand?: number
  type?: number
  price?: number
  revenue?: number
  units?: number
  rating?: number
  reviews?: number
  link?: number
}

const TOP_REVENUE_SHEET_NAME_PATTERNS = [
  /top\s*50\s*revenue/i,
  /^top\s*50$/i,
  /top_asins/i,
]

const TOP_UNITS_SHEET_NAME_PATTERNS = [/top\s*50\s*units/i]

const SUMMARY_SHEET_NAME_PATTERNS = [/^summary$/i, /brand_summary/i]
const TYPE_SHEET_NAME_PATTERNS = [/top\s*50\s*summary/i, /product_type/i, /type summary/i]
const PRICE_TIER_SHEET_NAME_PATTERNS = [/price[_\s-]*tiers?/i]

const RESERVED_SUMMARY_LABELS = new Set([
  "total",
  "other",
  "-",
  "all",
  "all asins",
])

export async function normalizeCategoryWorkbookData(
  category: CategorySummary,
  snapshot: SnapshotSummary,
  workbookPath: string
): Promise<NormalizedCategoryData | null> {
  try {
    const fileData = await readFile(workbookPath)
    const workbook = XLSX.read(fileData, { type: "buffer" })
    return normalizeWorkbook({
      workbook,
      workbookPath,
      category,
      snapshot,
    })
  } catch {
    return null
  }
}

export function normalizeSnapshotFallback(
  category: CategorySummary,
  snapshot: SnapshotSummary,
  warning?: string
): NormalizedCategoryData {
  const topByRevenue = snapshot.topProducts
    .map((row) => ({
      asin: row.asin,
      title: row.title,
      brand: row.brand,
      type: row.subcategory || row.sizeTier || "Unknown",
      price: row.price || 0,
      revenue: row.revenue || 0,
      units: row.units || 0,
      rating: row.rating || 0,
      reviews: row.reviewCount || 0,
      link: row.url,
      featureValues: {},
    }))
    .sort((a, b) => b.revenue - a.revenue)

  const topByUnits = [...topByRevenue].sort((a, b) => b.units - a.units)
  const brands = buildBrandRowsFromSnapshot(snapshot.brandTotals, snapshot.totals.revenue)
  const typeMix = deriveTypeMixFromProducts(topByRevenue, snapshot.totals.revenue, snapshot.totals.units)
  const priceTiers = derivePriceTiersFromProducts(topByRevenue, snapshot.totals.revenue, snapshot.totals.units)

  const notes = [warning ?? "Using dashboard snapshot fallback data."]
  return {
    categoryId: category.id,
    categoryLabel: category.label,
    snapshotDate: snapshot.date,
    sourceFile: `${category.id}:${snapshot.date}`,
    sourceType: "dashboard_snapshot_fallback",
    topByRevenue,
    topByUnits,
    brands,
    marketRevenue: snapshot.totals.revenue,
    marketUnits: snapshot.totals.units,
    typeMix,
    priceTiers,
    featurePremiums: [],
    warnings: notes,
    dataCoverage: {
      source: "dashboard_snapshot_fallback",
      sourceLabel: "Dashboard Snapshot Fallback",
      sheets: [],
      signals: ["top_products", "brand_summary"],
      notes,
    },
  }
}

function normalizeWorkbook({ workbook, workbookPath, category, snapshot }: WorkbookContext): NormalizedCategoryData {
  const schema = detectWorkbookSchema(workbook)
  const warnings: string[] = []

  const topRevenueSheetName = findFirstSheet(workbook.SheetNames, TOP_REVENUE_SHEET_NAME_PATTERNS)
  const topUnitsSheetName = findFirstSheet(workbook.SheetNames, TOP_UNITS_SHEET_NAME_PATTERNS)
  const summarySheetName = findFirstSheet(workbook.SheetNames, SUMMARY_SHEET_NAME_PATTERNS)

  const topByRevenue = topRevenueSheetName
    ? parseTopProductsSheet(workbook.Sheets[topRevenueSheetName], "revenue")
    : []
  const topByUnits = topUnitsSheetName
    ? parseTopProductsSheet(workbook.Sheets[topUnitsSheetName], "units")
    : [...topByRevenue].sort((a, b) => b.units - a.units)

  if (!topByRevenue.length) {
    warnings.push("Top products were unavailable in workbook parsing.")
  }

  const brands = summarySheetName
    ? parseBrandSummarySheet(workbook.Sheets[summarySheetName])
    : parseBrandSummaryFromProducts(topByRevenue)

  const marketRevenue =
    brands.reduce((sum, row) => sum + row.revenue, 0) ||
    topByRevenue.reduce((sum, row) => sum + row.revenue, 0)
  const marketUnits =
    brands.reduce((sum, row) => sum + row.units, 0) ||
    topByRevenue.reduce((sum, row) => sum + row.units, 0)

  const normalizedBrands = normalizeBrandShares(brands, marketRevenue)
  const typeMix = parseTypeMix(workbook) || deriveTypeMixFromProducts(topByRevenue, marketRevenue, marketUnits)
  const priceTiers =
    parsePriceTierMix(workbook, marketRevenue, marketUnits) ||
    derivePriceTiersFromProducts(topByRevenue, marketRevenue, marketUnits)
  const featurePremiums = buildFeaturePremiums(topByRevenue, marketRevenue, marketUnits)

  if (!summarySheetName) {
    warnings.push("Workbook summary sheet not found; brand metrics were derived from top products.")
  }

  return {
    categoryId: category.id,
    categoryLabel: category.label,
    snapshotDate: snapshot.date,
    sourceFile: workbookPath,
    sourceType: "category_workbook",
    topByRevenue,
    topByUnits,
    brands: normalizedBrands,
    marketRevenue,
    marketUnits,
    typeMix,
    priceTiers,
    featurePremiums,
    warnings,
    dataCoverage: {
      source: "category_workbook",
      sourceLabel: path.basename(workbookPath),
      sheets: schema.sheetNames,
      signals: schema.signals,
      notes: warnings,
    },
  }
}

function parseTopProductsSheet(sheet: XLSX.WorkSheet | undefined, sortBy: "revenue" | "units") {
  if (!sheet) return []
  const rows = sheetRows(sheet)
  const headerInfo = findHeaderRow(rows, ["asin", "brand"])
  if (!headerInfo) return []

  const { headerRowIndex, headers } = headerInfo
  const map = mapTopProductHeaders(headers)
  const featureIndexes = findFeatureColumns(headers, map)
  const products: NormalizedProduct[] = []

  for (const row of rows.slice(headerRowIndex + 1)) {
    const asin = getCell(row, map.asin)
    const title = getCell(row, map.title)
    const brand = getCell(row, map.brand)
    const revenue = toNumber(getCell(row, map.revenue))
    const units = toNumber(getCell(row, map.units))
    const price = toNumber(getCell(row, map.price))

    if (!asin && !title) continue
    if (!brand && revenue <= 0 && units <= 0) continue

    const featureValues: Record<string, string> = {}
    for (const entry of featureIndexes) {
      const raw = getCell(row, entry.index)
      if (!raw) continue
      featureValues[entry.label] = raw
    }

    products.push({
      asin: asin || title.slice(0, 12),
      title: title || asin,
      brand: brand || "Unknown",
      type: getCell(row, map.type) || "Unknown",
      price,
      revenue,
      units,
      rating: toNumber(getCell(row, map.rating)),
      reviews: toNumber(getCell(row, map.reviews)),
      link: getCell(row, map.link) || undefined,
      featureValues,
    })
  }

  return products
    .filter((row) => row.revenue > 0 || row.units > 0)
    .sort((a, b) => (sortBy === "revenue" ? b.revenue - a.revenue : b.units - a.units))
    .slice(0, 200)
}

function mapTopProductHeaders(headers: string[]): HeaderMap {
  return {
    asin: findIndex(headers, ["asin"]),
    title: findIndex(headers, ["title", "product name", "product"]),
    brand: findIndex(headers, ["brand", "brand_clean"]),
    type: findIndex(headers, ["type", "product_type"]),
    price: findIndex(headers, ["price", "avg price", "price per unit"]),
    revenue: findIndex(headers, [
      "est. monthly retail rev",
      "monthly rev",
      "asin revenue",
      "total_revenue",
      "revenue/mo",
      "revenue",
    ]),
    units: findIndex(headers, [
      "est. monthly units sold",
      "monthly units",
      "asin sales",
      "total_sales",
      "quantity/mo",
      "qty by %",
      "units",
    ]),
    rating: findIndex(headers, ["avg. rating", "reviews rating", "tool rating", "avg rating"]),
    reviews: findIndex(headers, ["# of reviews", "review count", "reviews"]),
    link: findIndex(headers, ["link", "url"]),
  }
}

function findFeatureColumns(headers: string[], map: HeaderMap) {
  const used = new Set<number>(Object.values(map).filter((value): value is number => value !== undefined))
  const entries: Array<{ index: number; label: string }> = []
  headers.forEach((header, index) => {
    if (used.has(index)) return
    const normalized = normalize(header)
    if (!normalized) return
    if (
      normalized.startsWith("is") ||
      normalized.includes("laser") ||
      normalized.includes("wifi") ||
      normalized.includes("camera") ||
      normalized.includes("rms") ||
      normalized.includes("automotive")
    ) {
      entries.push({ index, label: header.trim() || `feature_${index}` })
    }
  })
  return entries
}

function parseBrandSummarySheet(sheet: XLSX.WorkSheet | undefined) {
  if (!sheet) return []
  const rows = sheetRows(sheet)
  const headerInfo = findHeaderRow(rows, ["brand"])
  if (!headerInfo) return []

  const { headerRowIndex, headers } = headerInfo
  const brandIndex = findIndex(headers, ["brand", "brand_clean"])
  const revenueIndex = findIndex(headers, ["monthly rev", "total_revenue", "revenue", "monthly revenue"])
  const unitsIndex = findIndex(headers, ["monthly units", "total_sales", "units", "sales"])
  const avgPriceIndex = findIndex(headers, ["price per unit", "avg price", "average price"])
  const avgRatingIndex = findIndex(headers, ["avg rating", "reviews rating", "tool rating"])
  const shareIndex = findIndex(headers, ["monthly rev market share %", "rev_share_%", "market share"])
  const listingsIndex = findIndex(headers, ["# of listings", "asin_count", "listing"])

  const rowsOut: NormalizedBrandSummary[] = []
  for (const row of rows.slice(headerRowIndex + 1)) {
    const brand = getCell(row, brandIndex)
    if (!brand) continue
    if (RESERVED_SUMMARY_LABELS.has(normalize(brand))) continue

    const revenue = toNumber(getCell(row, revenueIndex))
    const units = toNumber(getCell(row, unitsIndex))
    if (revenue <= 0 && units <= 0) continue

    const share = toPercent(getCell(row, shareIndex))
    rowsOut.push({
      brand,
      revenue,
      units,
      share,
      avgPrice: toNumber(getCell(row, avgPriceIndex)),
      avgRating: toNumber(getCell(row, avgRatingIndex)),
      listings: toNumber(getCell(row, listingsIndex)),
    })
  }

  return rowsOut.sort((a, b) => b.revenue - a.revenue).slice(0, 100)
}

function parseBrandSummaryFromProducts(products: NormalizedProduct[]) {
  const byBrand = new Map<string, { revenue: number; units: number; reviews: number; ratingSum: number; count: number }>()
  for (const row of products) {
    const key = row.brand || "Unknown"
    const existing = byBrand.get(key) ?? { revenue: 0, units: 0, reviews: 0, ratingSum: 0, count: 0 }
    existing.revenue += row.revenue
    existing.units += row.units
    existing.reviews += row.reviews
    existing.ratingSum += row.rating
    existing.count += 1
    byBrand.set(key, existing)
  }

  const totalRevenue = products.reduce((sum, row) => sum + row.revenue, 0)
  return Array.from(byBrand.entries())
    .map(([brand, values]) => ({
      brand,
      revenue: values.revenue,
      units: values.units,
      share: totalRevenue > 0 ? values.revenue / totalRevenue : 0,
      avgPrice: values.units > 0 ? values.revenue / values.units : 0,
      avgRating: values.count > 0 ? values.ratingSum / values.count : 0,
      listings: values.count,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function normalizeBrandShares(brands: NormalizedBrandSummary[], marketRevenue: number) {
  if (marketRevenue <= 0) return brands
  return brands.map((brand) => ({
    ...brand,
    share: brand.share > 0 ? brand.share : brand.revenue / marketRevenue,
  }))
}

function parseTypeMix(workbook: XLSX.WorkBook): NormalizedTypeMix[] | null {
  const sheetName = findFirstSheet(workbook.SheetNames, TYPE_SHEET_NAME_PATTERNS)
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) return null

  const rows = sheetRows(sheet)
  const headerInfo = findHeaderRow(rows, ["type"])
  if (!headerInfo) return null

  const { headerRowIndex, headers } = headerInfo
  const typeIndex = findIndex(headers, ["type", "product_type"])
  const revenueIndex = findIndex(headers, ["revenue/mo", "revenue", "total_revenue", "monthly rev"])
  const unitsIndex = findIndex(headers, ["quantity/mo", "monthly units", "total_sales", "sales", "units"])
  const revenueShareIndex = findIndex(headers, ["revenue by %", "rev_share_%", "monthly rev market share %"])
  const unitShareIndex = findIndex(headers, ["qty by %", "unit_share_%", "monthly unit market share %"])
  const avgPriceIndex = findIndex(headers, ["avg price", "price per unit"])

  const out: NormalizedTypeMix[] = []
  for (const row of rows.slice(headerRowIndex + 1)) {
    const type = getCell(row, typeIndex)
    if (!type) continue
    if (normalize(type) === "total") continue
    const revenue = toNumber(getCell(row, revenueIndex))
    const units = toNumber(getCell(row, unitsIndex))
    const revenueShare = toPercent(getCell(row, revenueShareIndex))
    const unitShare = toPercent(getCell(row, unitShareIndex))
    if (revenue <= 0 && units <= 0 && revenueShare <= 0 && unitShare <= 0) continue
    out.push({
      type,
      revenue,
      units,
      revenueShare,
      unitShare,
      avgPrice: toNumber(getCell(row, avgPriceIndex)),
    })
  }

  if (!out.length) return null
  const totalRevenue = out.reduce((sum, row) => sum + row.revenue, 0)
  const totalUnits = out.reduce((sum, row) => sum + row.units, 0)

  return out.map((row) => ({
    ...row,
    revenueShare: row.revenueShare > 0 ? row.revenueShare : totalRevenue > 0 ? row.revenue / totalRevenue : 0,
    unitShare: row.unitShare > 0 ? row.unitShare : totalUnits > 0 ? row.units / totalUnits : 0,
  }))
}

function parsePriceTierMix(
  workbook: XLSX.WorkBook,
  marketRevenue: number,
  marketUnits: number
): NormalizedPriceTier[] | null {
  const sheetName = findFirstSheet(workbook.SheetNames, PRICE_TIER_SHEET_NAME_PATTERNS)
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) return null

  const rows = sheetRows(sheet)
  const headerInfo = findHeaderRow(rows, ["price"])
  if (!headerInfo) return null

  const { headerRowIndex, headers } = headerInfo
  const tierIndex = findIndex(headers, ["price_tier", "price tier", "tier"])
  const revenueIndex = findIndex(headers, ["total_revenue", "revenue", "monthly rev", "revenue/mo"])
  const unitsIndex = findIndex(headers, ["total_sales", "sales", "units", "quantity/mo"])
  const revenueShareIndex = findIndex(headers, ["rev_share_%", "revenue by %"])
  const unitShareIndex = findIndex(headers, ["unit_share_%", "qty by %"])
  const avgPriceIndex = findIndex(headers, ["avg_price", "avg price", "price per unit"])

  const out: NormalizedPriceTier[] = []
  for (const row of rows.slice(headerRowIndex + 1)) {
    const tier = getCell(row, tierIndex)
    if (!tier) continue
    const revenue = toNumber(getCell(row, revenueIndex))
    const units = toNumber(getCell(row, unitsIndex))
    if (revenue <= 0 && units <= 0) continue
    out.push({
      tier,
      revenue,
      units,
      revenueShare: toPercent(getCell(row, revenueShareIndex)),
      unitShare: toPercent(getCell(row, unitShareIndex)),
      avgPrice: toNumber(getCell(row, avgPriceIndex)),
    })
  }

  if (!out.length) return null
  return out.map((row) => ({
    ...row,
    revenueShare:
      row.revenueShare > 0 ? row.revenueShare : marketRevenue > 0 ? row.revenue / marketRevenue : 0,
    unitShare: row.unitShare > 0 ? row.unitShare : marketUnits > 0 ? row.units / marketUnits : 0,
  }))
}

function deriveTypeMixFromProducts(
  products: NormalizedProduct[],
  marketRevenue: number,
  marketUnits: number
): NormalizedTypeMix[] {
  const byType = new Map<string, { revenue: number; units: number }>()
  for (const row of products) {
    const key = row.type || "Unknown"
    const bucket = byType.get(key) ?? { revenue: 0, units: 0 }
    bucket.revenue += row.revenue
    bucket.units += row.units
    byType.set(key, bucket)
  }

  return Array.from(byType.entries())
    .map(([type, values]) => ({
      type,
      revenue: values.revenue,
      units: values.units,
      revenueShare: marketRevenue > 0 ? values.revenue / marketRevenue : 0,
      unitShare: marketUnits > 0 ? values.units / marketUnits : 0,
      avgPrice: values.units > 0 ? values.revenue / values.units : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

function derivePriceTiersFromProducts(
  products: NormalizedProduct[],
  marketRevenue: number,
  marketUnits: number
): NormalizedPriceTier[] {
  const tiers: Array<{ key: string; min: number; max: number }> = [
    { key: "<$75", min: 0, max: 75 },
    { key: "$75-$199", min: 75, max: 200 },
    { key: "$200-$399", min: 200, max: 400 },
    { key: "$400+", min: 400, max: Number.POSITIVE_INFINITY },
  ]

  return tiers
    .map((tier) => {
      const rows = products.filter((item) => item.price >= tier.min && item.price < tier.max)
      const revenue = rows.reduce((sum, item) => sum + item.revenue, 0)
      const units = rows.reduce((sum, item) => sum + item.units, 0)
      return {
        tier: tier.key,
        revenue,
        units,
        revenueShare: marketRevenue > 0 ? revenue / marketRevenue : 0,
        unitShare: marketUnits > 0 ? units / marketUnits : 0,
        avgPrice: units > 0 ? revenue / units : 0,
      }
    })
    .filter((row) => row.revenue > 0 || row.units > 0)
}

function buildFeaturePremiums(
  products: NormalizedProduct[],
  marketRevenue: number,
  marketUnits: number
): NormalizedFeaturePremium[] {
  if (!products.length) return []

  const keys = new Set<string>()
  for (const row of products) {
    for (const key of Object.keys(row.featureValues)) {
      keys.add(key)
    }
  }

  const result: NormalizedFeaturePremium[] = []
  for (const feature of keys) {
    const withRows = products.filter((row) => isTruthyFeature(row.featureValues[feature]))
    const withoutRows = products.filter((row) => isFalsyFeature(row.featureValues[feature]))
    if (!withRows.length || !withoutRows.length) continue

    const withAvgPrice = average(withRows.map((row) => row.price).filter((value) => value > 0))
    const withoutAvgPrice = average(withoutRows.map((row) => row.price).filter((value) => value > 0))
    if (withAvgPrice <= 0 || withoutAvgPrice <= 0) continue

    const withRevenue = withRows.reduce((sum, row) => sum + row.revenue, 0)
    const withUnits = withRows.reduce((sum, row) => sum + row.units, 0)
    result.push({
      feature,
      withFeatureAvgPrice: withAvgPrice,
      withoutFeatureAvgPrice: withoutAvgPrice,
      premiumPct: (withAvgPrice - withoutAvgPrice) / withoutAvgPrice,
      withFeatureRevenueShare: marketRevenue > 0 ? withRevenue / marketRevenue : 0,
      withFeatureUnitShare: marketUnits > 0 ? withUnits / marketUnits : 0,
    })
  }

  return result.sort((a, b) => Math.abs(b.premiumPct) - Math.abs(a.premiumPct))
}

function buildBrandRowsFromSnapshot(rows: SnapshotBrandSummary[], marketRevenue: number) {
  return rows.map((row) => ({
    brand: row.brand,
    revenue: row.revenue,
    units: row.units,
    share: row.share > 0 ? row.share : marketRevenue > 0 ? row.revenue / marketRevenue : 0,
    avgPrice: row.units > 0 ? row.revenue / row.units : 0,
    avgRating: 0,
    listings: 0,
  }))
}

function sheetRows(sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  }) as unknown[][]

  return rows.map((row) => row.map((cell) => `${cell ?? ""}`.trim()))
}

function findHeaderRow(rows: string[][], requiredAliases: string[]) {
  for (let index = 0; index < Math.min(24, rows.length); index += 1) {
    const row = rows[index]
    if (!row.length) continue
    const normalized = row.map(normalize)
    const matches = requiredAliases.every((alias) => normalized.some((cell) => cell.includes(normalize(alias))))
    if (matches) {
      return { headerRowIndex: index, headers: row }
    }
  }
  return null
}

function findFirstSheet(sheetNames: string[], patterns: RegExp[]) {
  for (const pattern of patterns) {
    const hit = sheetNames.find((name) => pattern.test(name))
    if (hit) return hit
  }
  return undefined
}

function findIndex(headers: string[], aliases: string[]) {
  const normalizedHeaders = headers.map(normalize)
  for (const alias of aliases) {
    const needle = normalize(alias)
    const index = normalizedHeaders.findIndex((header) => header.includes(needle))
    if (index >= 0) return index
  }
  return undefined
}

function getCell(row: string[], index: number | undefined) {
  if (index === undefined) return ""
  return `${row[index] ?? ""}`.trim()
}

function toNumber(value: string) {
  const cleaned = `${value ?? ""}`.replace(/[$,%\s]/g, "").replace(/,/g, "")
  const numeric = Number(cleaned)
  return Number.isFinite(numeric) ? numeric : 0
}

function toPercent(value: string) {
  const raw = `${value ?? ""}`.trim()
  if (!raw) return 0
  if (raw.includes("%")) {
    return toNumber(raw) / 100
  }
  const numeric = toNumber(raw)
  if (!Number.isFinite(numeric)) return 0
  if (numeric > 1) return numeric / 100
  return numeric
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function isTruthyFeature(value: string | undefined) {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === "true" || normalized === "yes" || normalized === "y" || normalized === "1"
}

function isFalsyFeature(value: string | undefined) {
  if (!value) return true
  const normalized = value.trim().toLowerCase()
  return normalized === "false" || normalized === "no" || normalized === "n" || normalized === "0"
}
