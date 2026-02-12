import { readdir, readFile } from "fs/promises"
import path from "path"

export type CategoryId = "dmm" | "borescope" | "thermal_imager" | "night_vision"

export type ProductSummary = {
  asin: string
  title: string
  brand: string
  price: number
  revenue: number
  units: number
  reviewCount: number
  rating: number
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
  brandTotals: BrandSummary[]
  brandListings: Array<{ brand: string; products: ProductSummary[] }>
  priceTiers: PriceTierSummary[]
}

export type CategorySummary = {
  id: CategoryId
  label: string
  snapshots: SnapshotSummary[]
}

export type DashboardData = {
  categories: CategorySummary[]
  generatedAt: string
}

type RawRecord = {
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
}

const CATEGORY_CONFIG: Array<{ id: CategoryId; label: string; dir: string }> = [
  { id: "dmm", label: "DMM / Automotive", dir: "DMM_h10/raw_data" },
  { id: "borescope", label: "Borescope", dir: "DMM_h10/Borescope/raw_data" },
  { id: "thermal_imager", label: "Thermal Imager", dir: "DMM_h10/Thermal Imager/raw_data" },
  { id: "night_vision", label: "Night Vision", dir: "DMM_h10/Night Vision Monoculars/raw_data" },
]

const PRICE_TIERS = [
  { label: "$0-40", min: 0, max: 40 },
  { label: "$40-60", min: 40, max: 60 },
  { label: "$60-90", min: 60, max: 90 },
  { label: "$90+", min: 90, max: Number.POSITIVE_INFINITY },
]

const TOP_PRODUCTS_COUNT = 50

const CSV_DATE_REGEX = /(\d{4}-\d{2}-\d{2})/

export async function loadDashboardData(): Promise<DashboardData> {
  const categories = await Promise.all(
    CATEGORY_CONFIG.map(async (category) => {
      const baseDir = path.resolve(process.cwd(), "..", category.dir)
      const files = await listCsvFiles(baseDir).catch(() => [])
      const grouped = groupFilesBySnapshot(files)
      const snapshots = await Promise.all(
        Array.from(grouped.entries()).map(async ([date, dateFiles]) => {
          const records = await loadSnapshotRecords(dateFiles)
          return buildSnapshotSummary(date, records)
        })
      )

      const sortedSnapshots = snapshots
        .filter((snapshot) => snapshot.totals.asinCount > 0)
        .sort((a, b) => a.date.localeCompare(b.date))

      return {
        id: category.id,
        label: category.label,
        snapshots: sortedSnapshots,
      }
    })
  )

  return {
    categories,
    generatedAt: new Date().toISOString(),
  }
}

async function listCsvFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await listCsvFiles(fullPath)
      files.push(...nested)
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".csv")) {
      files.push(fullPath)
    }
  }

  return files
}

function groupFilesBySnapshot(files: string[]): Map<string, string[]> {
  const grouped = new Map<string, string[]>()

  for (const file of files) {
    const match = path.basename(file).match(CSV_DATE_REGEX)
    if (!match) continue
    const date = match[1]
    const existing = grouped.get(date)
    if (existing) {
      existing.push(file)
    } else {
      grouped.set(date, [file])
    }
  }

  return grouped
}

async function loadSnapshotRecords(files: string[]): Promise<RawRecord[]> {
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

      const asin = getValue("ASIN").trim()
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
        sizeTier: getValue("Size Tier").trim() || undefined,
        subcategory: getValue("Subcategory").trim() || undefined,
        url: getValue("URL").trim() || undefined,
        imageUrl: getValue("Image URL").trim() || undefined,
      }

      const existing = records.get(asin)
      if (!existing || record.asinRevenue > existing.asinRevenue) {
        records.set(asin, record)
      }
    }
  }

  return Array.from(records.values())
}

function buildSnapshotSummary(date: string, records: RawRecord[]): SnapshotSummary {
  const mapRecord = (record: RawRecord): ProductSummary => ({
    asin: record.asin,
    title: record.title,
    brand: record.brand,
    price: record.price,
    revenue: record.asinRevenue,
    units: record.asinSales,
    reviewCount: record.reviewCount,
    rating: record.rating,
    fulfillment: record.fulfillment,
    sizeTier: record.sizeTier,
    subcategory: record.subcategory,
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
  const avgPriceValues = records.filter((record) => record.price > 0)
  const avgPrice =
    avgPriceValues.reduce((sum, record) => sum + record.price, 0) /
    (avgPriceValues.length || 1)

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
    label: formatSnapshotLabel(date),
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

function formatSnapshotLabel(dateValue: string): string {
  const date = new Date(`${dateValue}T00:00:00Z`)
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(date)
}
