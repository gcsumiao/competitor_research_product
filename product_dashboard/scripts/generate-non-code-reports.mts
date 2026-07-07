import { mkdir, readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import * as XLSX from "xlsx"

import { classifyBackpackProduct } from "../lib/backpack-classification.ts"
import {
  loadCsvCategorySnapshotRecords,
  type RawRecord,
} from "../lib/competitor-data.ts"
import {
  inferThermalPhoneAdaptedLabel,
  inferThermalTypeLabel,
} from "../lib/thermal-imager-classification.ts"
import {
  averagePriceForCategory,
  classifyJumpStarterProduct,
  JUMP_STARTERS_ACCESSORY_TYPE_LABEL,
} from "../lib/jump-starters-classification.ts"
import { classifyMechanicStoolProduct } from "../lib/mechanic-stool-classification.ts"
import { classifyOilProduct } from "../lib/oil-classification.ts"
import { classifyStethoscopeProduct } from "../lib/stethoscope-classification.ts"
import {
  getNonCodeCategoryConfig,
  isNonCodeCategoryId,
  listNonCodeCategoryIds,
  type NonCodeCategoryId,
} from "../lib/non-code-category-config.ts"

type CliArgs = {
  month: string
  categories: NonCodeCategoryId[]
  sourceRoot: string
}

type EnrichedRecord = RawRecord & {
  typeLabel: string
  extraColumns: Record<string, string>
}

type SummaryRow = {
  label: string
  avgPrice: number
  units: number
  unitsShare: number
  revenue: number
  revenueShare: number
}

type Section = {
  title: string
  rows: SummaryRow[]
}

type BrandDetailTab = {
  sheetName: string
  brandName: string
  headers?: readonly string[]
}

type DuplicateAudit = {
  totalRawRows: number
  uniqueAsins: number
  duplicateAsinGroups: number
  duplicateExtraRows: number
  duplicateRows: Array<{
    asin: string
    duplicateRowCount: number
    keptRevenue: number
    files: string
    sampleTitle: string
  }>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")

const PRICE_TIERS = [
  { label: "$0-40", min: 0, max: 40 },
  { label: "$40-60", min: 40, max: 60 },
  { label: "$60-90", min: 60, max: 90 },
  { label: "$90+", min: 90, max: Number.POSITIVE_INFINITY },
]

const OIL_PRICE_TIERS = [
  { label: "$0-20", min: 0, max: 20 },
  { label: "$20-40", min: 20, max: 40 },
  { label: "$40-80", min: 40, max: 80 },
  { label: "$80-150", min: 80, max: 150 },
  { label: "$150-250", min: 150, max: 250 },
  { label: "$250+", min: 250, max: Number.POSITIVE_INFINITY },
]

const BORESCOPE_DIMENSION_HEADERS = [
  "2/4-way",
  "Display",
  "Lens Diameter",
  "Lens Count",
  "Cable Length",
] as const

const SMOKE_MACHINE_FEATURE_HEADERS = [
  "Subcategory",
  "Size Tier",
  "Is Accessory",
  "Is Built-in Pump",
  "Is Includes Smoke Fluid",
  "Is Pressure Gauge",
] as const

const JUMP_STARTERS_FEATURE_HEADERS = [
  "Has Inflator",
  "Voltage Class",
  "Has Power Station",
  "Is Accessory",
  "Accessory Type",
  "Subcategory",
  "Size Tier",
] as const

const MECHANIC_STOOL_FEATURE_HEADERS = [
  "Adjustable Height",
  "Backrest",
  "Storage Type",
  "Material",
  "Subcategory",
  "Size Tier",
] as const

const BACKPACK_FEATURE_HEADERS = [
  "Trade Focus",
  "Is Rolling",
  "Has Laptop Compartment",
  "Base Style",
  "Shipping Tier",
  "BSR",
  "Subcategory BSR",
  "Length",
  "Width",
  "Height",
  "Weight",
  "Best Sales Period",
  "Best Sales Season",
  "Listing Age (Months)",
  "Variation Count",
  "Number of Images",
  "Sales YoY %",
  "Sales to Reviews",
] as const

const OIL_FEATURE_HEADERS = [
  "Raw Subcategory",
  "Product Family",
  "Fluid Application",
  "Viscosity / Grade",
  "Pack Size",
  "Seasonal Use",
] as const

const STETHOSCOPE_FEATURE_HEADERS = [
  "Diagnostic Type",
  "Electronic",
  "Channel Count",
  "Probe Count",
  "Vehicle Context",
  "Subcategory",
  "Size Tier",
] as const

const THERMAL_DIMENSION_HEADERS = [
  "Phone adapted",
  "Basic Resolution",
  "Super Resolution",
  "Laser",
  "Wi-Fi",
  "Visual Camera",
  "Display",
  "Subcategory",
  "Size Tier",
] as const

const BRAND_DETAIL_HEADERS = [
  "ASIN",
  "Title",
  "Brand",
  "Type",
  "Price",
  "Monthly Rev",
  "Monthly Units",
  "Avg Rating",
  "# of Reviews",
  "Link",
  "Subcategory",
  "Size Tier",
] as const

const OIL_BRAND_DETAIL_HEADERS = [
  "ASIN",
  "Title",
  "Brand",
  "Type",
  "Price",
  "Monthly Rev",
  "Monthly Units",
  "Avg Rating",
  "# of Reviews",
  "Link",
  ...OIL_FEATURE_HEADERS,
] as const

const OIL_TYPE_SHEET_LABELS: Record<string, string> = {
  "Air Conditioning Oils": "AC Oils",
  "Antifreezes & Coolants": "Coolants",
  "Brake Fluids": "Brake Fluids",
  "Corrosion & Rust Inhibitors": "Rust Inhibitors",
  "Gear Oils": "Gear Oils",
  "Greases & Lubricants": "Greases-Lubes",
  "Hydraulic Oils": "Hydraulic Oils",
  "Motor Oils": "Motor Oils",
  "Power Steering Fluids": "Power Steering",
  "Radiator Conditioners & Protectants": "Radiator Protect",
  "Refrigerants": "Refrigerants",
  "Transmission Fluids": "Transmission",
  "Windshield Washer Fluids": "Washer Fluids",
  "Winter Products": "Winter Products",
}

const BASIC_RESOLUTION_REGEX = /\b(80x60|96x96|120x90|128x96|160x120|256x192|320x240)\b/i
const SUPER_RESOLUTION_REGEX =
  /\b(160x120|192x192|240x180|240x240|320x240|480x360|512x384)\b/i

async function main() {
  const args = parseArgs(process.argv.slice(2))

  for (const categoryId of args.categories) {
    await generateCategoryReports({
      categoryId,
      month: args.month,
      sourceRoot: args.sourceRoot,
    })
  }
}

async function generateCategoryReports(params: {
  categoryId: NonCodeCategoryId
  month: string
  sourceRoot: string
}) {
  const config = getNonCodeCategoryConfig(params.categoryId)
  if (!config) {
    throw new Error(`Unknown non-code category: ${params.categoryId}`)
  }

  const categoryDir = path.join(params.sourceRoot, config.folderName)
  const rawDataDir = path.join(categoryDir, "raw_data")
  const outputsDir = path.join(categoryDir, "outputs")
  const monthKey = `${params.month.slice(0, 4)}-${params.month.slice(4, 6)}`
  const snapshots = await loadCsvCategorySnapshotRecords(rawDataDir, params.categoryId)
  const snapshot = snapshots.find((item) => item.date.startsWith(monthKey))
  if (!snapshot) {
    throw new Error(`No snapshot records found for ${params.categoryId} month ${params.month} in ${rawDataDir}`)
  }

  const rawMonthDir = path.join(rawDataDir, params.month)
  const runDate = await resolveLatestRunDate(rawMonthDir, snapshot.date)
  const duplicateAudit = undefined
  const enrichedRecords = snapshot.records.map((record) => enrichRecord(params.categoryId, record))
  const topByRevenue = [...enrichedRecords].sort((a, b) => b.asinRevenue - a.asinRevenue).slice(0, 50)
  const topByUnits = [...enrichedRecords].sort((a, b) => b.asinSales - a.asinSales).slice(0, 50)

  await mkdir(outputsDir, { recursive: true })

  const workbook = buildWorkbook({
    categoryId: params.categoryId,
    label: config.label,
    month: params.month,
    snapshotDate: snapshot.date,
    runDate,
    records: enrichedRecords,
    topByRevenue,
    topByUnits,
    duplicateAudit,
  })

  const { analysisPath, formattedPath } = resolveOutputPaths({
    categoryId: params.categoryId,
    label: config.label,
    month: params.month,
    runDate,
    categoryDir,
    outputsDir,
  })

  XLSX.writeFile(workbook, analysisPath, { compression: true })
  XLSX.writeFile(workbook, formattedPath, { compression: true })

  console.log(`Generated ${config.label} analysis workbook: ${analysisPath}`)
  console.log(`Generated ${config.label} formatted report: ${formattedPath}`)
}

function buildWorkbook(params: {
  categoryId: NonCodeCategoryId
  label: string
  month: string
  snapshotDate: string
  runDate: string
  records: EnrichedRecord[]
  topByRevenue: EnrichedRecord[]
  topByUnits: EnrichedRecord[]
  duplicateAudit?: DuplicateAudit
}) {
  const workbook = XLSX.utils.book_new()

  const summaryRows = buildBrandSummary(params.categoryId, params.records)
  const topRevenueRows = buildTopSheetRows(params.categoryId, params.topByRevenue)
  const topUnitsRows = buildTopSheetRows(params.categoryId, params.topByUnits)
  const summarySections = buildTop50SummarySections(params.categoryId, params.topByRevenue)
  const priceTierRows = buildPriceTierRows(params.categoryId, params.records)
  const metadataRows = [
    ["Category", params.label],
    ["Category ID", params.categoryId],
    ["Snapshot Month", params.month],
    ["Snapshot Date", params.snapshotDate],
    ["Latest Run Date", params.runDate],
    ["Generated At", new Date().toISOString()],
    ["ASIN Count", params.records.length],
  ]
  const allRows = buildTopSheetRows(params.categoryId, params.records.slice().sort((a, b) => b.asinRevenue - a.asinRevenue))

  appendJsonSheet(workbook, "Summary", summaryRows, [
    "Brand",
    "# of Listings",
    "Monthly Rev",
    "Monthly Units",
    "Monthly Rev Market Share %",
    "Price Per Unit",
    "Avg Rating",
  ])
  appendJsonSheet(workbook, "Top 50 Revenue", topRevenueRows)
  appendJsonSheet(workbook, "Top 50 Units", topUnitsRows)
  appendAoaSheet(workbook, "Top 50 Summary", buildSummarySheetMatrix(summarySections))
  appendJsonSheet(workbook, "Price Tiers", priceTierRows, [
    "Price Tier",
    "Total Revenue",
    "Total Sales",
    "Rev Share %",
    "Unit Share %",
    "Avg Price",
  ])
  appendJsonSheet(workbook, "All ASINs", allRows)
  appendAoaSheet(workbook, "Metadata", metadataRows)
  if (params.duplicateAudit) {
    appendAoaSheet(workbook, "Duplicate Audit", buildDuplicateAuditSheetMatrix(params.duplicateAudit))
  }

  for (const brandTab of resolveBrandDetailTabs(params.categoryId, params.month)) {
    const brandRows = allRows
      .filter((row) => normalizeBrandName(String(row.Brand ?? "")) === normalizeBrandName(brandTab.brandName))
      .sort((left, right) => Number(right["Monthly Rev"]) - Number(left["Monthly Rev"]))

    appendJsonSheet(workbook, brandTab.sheetName, brandRows, [...(brandTab.headers ?? BRAND_DETAIL_HEADERS)])
  }

  appendTypeTop50Sheets(workbook, params.categoryId, params.records)

  return workbook
}

function appendTypeTop50Sheets(workbook: XLSX.WorkBook, categoryId: NonCodeCategoryId, records: EnrichedRecord[]) {
  if (categoryId !== "oil") return

  const typeGroups = new Map<string, EnrichedRecord[]>()
  for (const record of records) {
    const typeLabel = record.typeLabel || "Other"
    const group = typeGroups.get(typeLabel) ?? []
    group.push(record)
    typeGroups.set(typeLabel, group)
  }

  const orderedGroups = Array.from(typeGroups.entries())
    .map(([typeLabel, group]) => ({
      typeLabel,
      group,
      revenue: group.reduce((sum, record) => sum + record.asinRevenue, 0),
    }))
    .sort((left, right) => right.revenue - left.revenue || left.typeLabel.localeCompare(right.typeLabel))

  const usedSheetNames = new Set(workbook.SheetNames)
  for (const { typeLabel, group } of orderedGroups) {
    const revenueRows = buildTopSheetRows(
      categoryId,
      group.slice().sort((left, right) => right.asinRevenue - left.asinRevenue).slice(0, 50)
    )
    const unitRows = buildTopSheetRows(
      categoryId,
      group.slice().sort((left, right) => right.asinSales - left.asinSales).slice(0, 50)
    )

    appendJsonSheet(workbook, makeTypeTop50SheetName("Rev", typeLabel, usedSheetNames), revenueRows)
    appendJsonSheet(workbook, makeTypeTop50SheetName("Units", typeLabel, usedSheetNames), unitRows)
  }
}

function makeTypeTop50SheetName(prefix: "Rev" | "Units", typeLabel: string, usedSheetNames: Set<string>) {
  const fullPrefix = `Top50 ${prefix}`
  const baseLabel = OIL_TYPE_SHEET_LABELS[typeLabel] ?? typeLabel
  const normalizedBase = baseLabel.replace(/[\[\]:*?/\\]/g, "-").replace(/\s+/g, " ").trim()
  const maxBaseLength = 31 - fullPrefix.length - 1
  const truncatedBase = normalizedBase.slice(0, maxBaseLength).trim()
  const baseName = `${fullPrefix} ${truncatedBase}`.slice(0, 31)

  let sheetName = baseName
  let suffix = 2
  while (usedSheetNames.has(sheetName)) {
    const suffixText = ` ${suffix}`
    sheetName = `${baseName.slice(0, 31 - suffixText.length)}${suffixText}`
    suffix += 1
  }
  usedSheetNames.add(sheetName)
  return sheetName
}

function appendJsonSheet(workbook: XLSX.WorkBook, sheetName: string, rows: Record<string, unknown>[], headers?: string[]) {
  const sheet = XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : undefined)
  sheet["!cols"] = inferColumnWidths([headers ?? Object.keys(rows[0] ?? {}), ...rows.map((row) => Object.values(row).map(String))])
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
}

function appendAoaSheet(workbook: XLSX.WorkBook, sheetName: string, rows: Array<Array<string | number>>) {
  const sheet = XLSX.utils.aoa_to_sheet(rows)
  sheet["!cols"] = inferColumnWidths(rows)
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName)
}

function resolveBrandDetailTabs(categoryId: NonCodeCategoryId, month: string): BrandDetailTab[] {
  if (categoryId === "night_vision" && month === "202603") {
    return [
      { sheetName: "Topdon", brandName: "TOPDON" },
      { sheetName: "Guide Sensmart", brandName: "Guide Sensmart" },
    ]
  }
  if (categoryId === "oil") {
    return [{ sheetName: "Liqui Moly", brandName: "Liqui Moly", headers: OIL_BRAND_DETAIL_HEADERS }]
  }
  return []
}

function buildBrandSummary(categoryId: NonCodeCategoryId, records: EnrichedRecord[]) {
  const byBrand = new Map<
    string,
    { brand: string; listings: number; revenue: number; units: number; weightedRating: number; ratingWeight: number }
  >()
  const totalRevenue = records.reduce((sum, record) => sum + record.asinRevenue, 0)

  for (const record of records) {
    const brand = record.brand || "Unknown"
    const key = categoryId === "oil" ? normalizeBrandName(brand) : brand
    const bucket = byBrand.get(key) ?? {
      brand: normalizeBrandDisplayName(brand),
      listings: 0,
      revenue: 0,
      units: 0,
      weightedRating: 0,
      ratingWeight: 0,
    }
    bucket.listings += 1
    bucket.revenue += record.asinRevenue
    bucket.units += record.asinSales
    bucket.weightedRating += record.rating * Math.max(record.reviewCount, 1)
    bucket.ratingWeight += Math.max(record.reviewCount, 1)
    byBrand.set(key, bucket)
  }

  const rows = Array.from(byBrand.entries())
    .map(([, bucket]) => ({
      Brand: bucket.brand,
      "# of Listings": bucket.listings,
      "Monthly Rev": round2(bucket.revenue),
      "Monthly Units": round2(bucket.units),
      "Monthly Rev Market Share %": totalRevenue > 0 ? round4(bucket.revenue / totalRevenue) : 0,
      "Price Per Unit": bucket.units > 0 ? round2(bucket.revenue / bucket.units) : 0,
      "Avg Rating": bucket.ratingWeight > 0 ? round2(bucket.weightedRating / bucket.ratingWeight) : 0,
    }))
    .sort((a, b) => Number(b["Monthly Rev"]) - Number(a["Monthly Rev"]))

  const totalBrandLabel = rows.some((row) => normalizeBrandName(String(row.Brand)) === "total") ? "Grand Total" : "Total"
  rows.push({
    Brand: totalBrandLabel,
    "# of Listings": rows.reduce((sum, row) => sum + Number(row["# of Listings"]), 0),
    "Monthly Rev": round2(rows.reduce((sum, row) => sum + Number(row["Monthly Rev"]), 0)),
    "Monthly Units": round2(rows.reduce((sum, row) => sum + Number(row["Monthly Units"]), 0)),
    "Monthly Rev Market Share %": 1,
    "Price Per Unit": 0,
    "Avg Rating": 0,
  })

  return rows
}

function buildTopSheetRows(categoryId: NonCodeCategoryId, records: EnrichedRecord[]) {
  const rows = records.map((record) => ({
    ASIN: record.asin,
    Title: record.title,
    Brand: record.brand,
    Type: record.typeLabel,
    Price: round2(record.price),
    "Monthly Rev": round2(record.asinRevenue),
    "Monthly Units": round2(record.asinSales),
    "Avg Rating": round2(record.rating),
    "# of Reviews": round2(record.reviewCount),
    Link: record.url ?? "",
    ...orderedExtraColumns(categoryId, record.extraColumns),
  }))

  return rows
}

function orderedExtraColumns(categoryId: NonCodeCategoryId, values: Record<string, string>) {
  if (categoryId === "borescope") {
    return orderedColumns(values, BORESCOPE_DIMENSION_HEADERS)
  }
  if (categoryId === "thermal_imager") {
    return orderedColumns(values, THERMAL_DIMENSION_HEADERS)
  }
  if (categoryId === "smoke_machine") {
    return orderedColumns(values, SMOKE_MACHINE_FEATURE_HEADERS)
  }
  if (categoryId === "jump_starters") {
    return orderedColumns(values, JUMP_STARTERS_FEATURE_HEADERS)
  }
  if (categoryId === "mechanic_stool") {
    return orderedColumns(values, MECHANIC_STOOL_FEATURE_HEADERS)
  }
  if (categoryId === "backpack") {
    return orderedColumns(values, BACKPACK_FEATURE_HEADERS)
  }
  if (categoryId === "oil") {
    return orderedColumns(values, OIL_FEATURE_HEADERS)
  }
  if (categoryId === "stethoscope") {
    return orderedColumns(values, STETHOSCOPE_FEATURE_HEADERS)
  }
  return values
}

function orderedColumns(values: Record<string, string>, preferredOrder: readonly string[]) {
  const ordered: Record<string, string> = {}
  for (const key of preferredOrder) {
    if (key in values) ordered[key] = values[key]
  }
  for (const [key, value] of Object.entries(values)) {
    if (!(key in ordered)) ordered[key] = value
  }
  return ordered
}

function buildTop50SummarySections(categoryId: NonCodeCategoryId, records: EnrichedRecord[]): Section[] {
  if (categoryId === "borescope") {
    return [
      buildSummarySection("Type", records, (record) => record.typeLabel),
      buildSummarySection("2/4-way", records, (record) => record.extraColumns["2/4-way"] ?? "Unknown"),
      buildSummarySection("Display", records, (record) => record.extraColumns["Display"] ?? "Unknown"),
      buildSummarySection("Lens diameter", records, (record) => record.extraColumns["Lens Diameter"] ?? "Unknown"),
      buildSummarySection("Lens count", records, (record) => record.extraColumns["Lens Count"] ?? "Unknown"),
      buildSummarySection("Cable length", records, (record) => record.extraColumns["Cable Length"] ?? "Unknown"),
    ].filter((section) => section.rows.length > 0)
  }

  if (categoryId === "thermal_imager") {
    return [
      buildSummarySection("Type", records, (record) => record.typeLabel),
      buildSummarySection("Phone adapted", records, (record) => record.extraColumns["Phone adapted"] ?? "Unknown"),
      buildSummarySection("Basic Resolution", records, (record) => record.extraColumns["Basic Resolution"] ?? "-"),
      buildSummarySection("Super Resolution", records, (record) => record.extraColumns["Super Resolution"] ?? "-"),
      buildSummarySection("Laser", records, (record) => record.extraColumns["Laser"] ?? "No"),
      buildSummarySection("Wi-Fi", records, (record) => record.extraColumns["Wi-Fi"] ?? "No"),
      buildSummarySection("Visual Camera", records, (record) => record.extraColumns["Visual Camera"] ?? "No"),
      buildSummarySection("Display", records, (record) => record.extraColumns.Display ?? "Unknown"),
    ].filter((section) => section.rows.length > 0)
  }

  if (categoryId === "jump_starters") {
    return [
      buildSummarySection(
        "Type",
        records,
        (record) => record.typeLabel,
        (record, label) => record.excludeFromAvgPrice !== true || label === JUMP_STARTERS_ACCESSORY_TYPE_LABEL
      ),
      buildSummarySection("Has Inflator", records, (record) => record.extraColumns["Has Inflator"] ?? "Unknown"),
      buildSummarySection("Voltage Class", records, (record) => record.extraColumns["Voltage Class"] ?? "Unknown"),
      buildSummarySection(
        "Has Power Station",
        records,
        (record) => record.extraColumns["Has Power Station"] ?? "Unknown"
      ),
      buildSummarySection(
        "Accessory Type",
        records,
        (record) => record.extraColumns["Accessory Type"] ?? "Unknown",
        (record, label) => record.excludeFromAvgPrice !== true || label !== "Not accessory"
      ),
    ].filter((section) => section.rows.length > 0)
  }

  if (categoryId === "mechanic_stool") {
    return [
      buildSummarySection("Type", records, (record) => record.typeLabel),
      buildSummarySection(
        "Adjustable Height",
        records,
        (record) => record.extraColumns["Adjustable Height"] ?? "Unknown"
      ),
      buildSummarySection("Backrest", records, (record) => record.extraColumns.Backrest ?? "Unknown"),
      buildSummarySection("Storage Type", records, (record) => record.extraColumns["Storage Type"] ?? "Unknown"),
      buildSummarySection("Material", records, (record) => record.extraColumns.Material ?? "Unknown"),
    ].filter((section) => section.rows.length > 0)
  }

  if (categoryId === "backpack") {
    return [
      buildSummarySection("Type", records, (record) => record.typeLabel),
      buildSummarySection("Trade Focus", records, (record) => record.extraColumns["Trade Focus"] ?? "Unknown"),
      buildSummarySection("Is Rolling", records, (record) => record.extraColumns["Is Rolling"] ?? "Unknown"),
      buildSummarySection(
        "Has Laptop Compartment",
        records,
        (record) => record.extraColumns["Has Laptop Compartment"] ?? "Unknown"
      ),
      buildSummarySection("Base Style", records, (record) => record.extraColumns["Base Style"] ?? "Unknown"),
      buildSummarySection("Shipping Tier", records, (record) => record.extraColumns["Shipping Tier"] ?? "Unknown"),
      buildSummarySection("Height Band", records, (record) => classifyBackpackProduct(record).heightBand),
      buildSummarySection("Weight Band", records, (record) => classifyBackpackProduct(record).weightBand),
      buildSummarySection(
        "Best Sales Season",
        records,
        (record) => record.extraColumns["Best Sales Season"] ?? "Unknown"
      ),
      buildSummarySection("BSR Tier", records, (record) => classifyBackpackProduct(record).bsrTier),
    ].filter((section) => section.rows.length > 0)
  }

  if (categoryId === "oil") {
    return [
      buildSummarySection("Type", records, (record) => record.typeLabel),
      buildSummarySection("Product Family", records, (record) => record.extraColumns["Product Family"] ?? "Unknown"),
      buildSummarySection(
        "Fluid Application",
        records,
        (record) => record.extraColumns["Fluid Application"] ?? "Unknown"
      ),
      buildSummarySection(
        "Raw Subcategory",
        records,
        (record) => record.extraColumns["Raw Subcategory"] ?? "Unknown"
      ),
      buildSummarySection(
        "Seasonal Use",
        records,
        (record) => record.extraColumns["Seasonal Use"] ?? "Unknown"
      ),
    ].filter((section) => section.rows.length > 0)
  }

  if (categoryId === "stethoscope") {
    return [
      buildSummarySection("Type", records, (record) => record.typeLabel),
      buildSummarySection(
        "Diagnostic Type",
        records,
        (record) => record.extraColumns["Diagnostic Type"] ?? "Unknown"
      ),
      buildSummarySection("Electronic", records, (record) => record.extraColumns.Electronic ?? "Unknown"),
      buildSummarySection("Channel Count", records, (record) => record.extraColumns["Channel Count"] ?? "Unknown"),
      buildSummarySection("Vehicle Context", records, (record) => record.extraColumns["Vehicle Context"] ?? "Unknown"),
    ].filter((section) => section.rows.length > 0)
  }

  return [buildSummarySection("Type", records, (record) => record.typeLabel)].filter(
    (section) => section.rows.length > 0
  )
}

function buildSummarySection(
  title: string,
  records: EnrichedRecord[],
  getLabel: (record: EnrichedRecord) => string,
  includePrice: (record: EnrichedRecord, label: string) => boolean = (record) => record.excludeFromAvgPrice !== true
): Section {
  const buckets = new Map<string, { revenue: number; units: number; priceSum: number; priceCount: number }>()

  for (const record of records) {
    const label = (getLabel(record) || "Unknown").trim() || "Unknown"
    const bucket = buckets.get(label) ?? { revenue: 0, units: 0, priceSum: 0, priceCount: 0 }
    bucket.revenue += record.asinRevenue
    bucket.units += record.asinSales
    if (record.price > 0 && includePrice(record, label)) {
      bucket.priceSum += record.price
      bucket.priceCount += 1
    }
    buckets.set(label, bucket)
  }

  const totalRevenue = Array.from(buckets.values()).reduce((sum, bucket) => sum + bucket.revenue, 0)
  const totalUnits = Array.from(buckets.values()).reduce((sum, bucket) => sum + bucket.units, 0)

  const rows = Array.from(buckets.entries())
    .map(([label, bucket]) => ({
      label,
      avgPrice: bucket.priceCount ? round2(bucket.priceSum / bucket.priceCount) : 0,
      units: round2(bucket.units),
      unitsShare: totalUnits > 0 ? round4(bucket.units / totalUnits) : 0,
      revenue: round2(bucket.revenue),
      revenueShare: totalRevenue > 0 ? round4(bucket.revenue / totalRevenue) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return { title, rows }
}

function buildSummarySheetMatrix(sections: Section[]) {
  const rows: Array<Array<string | number>> = []

  sections.forEach((section, index) => {
    if (index > 0) rows.push([])
    rows.push([section.title, "Avg Price", "Quantity/Mo", "Qty By %", "Revenue/Mo", "Revenue By %"])
    for (const row of section.rows) {
      rows.push([
        row.label,
        round2(row.avgPrice),
        round2(row.units),
        round4(row.unitsShare),
        round2(row.revenue),
        round4(row.revenueShare),
      ])
    }
  })

  return rows
}

function buildDuplicateAuditSheetMatrix(audit: DuplicateAudit) {
  const rows: Array<Array<string | number>> = [
    ["Metric", "Value"],
    ["Total Raw ASIN Rows", audit.totalRawRows],
    ["Unique ASINs After Deduplication", audit.uniqueAsins],
    ["Duplicate ASIN Groups", audit.duplicateAsinGroups],
    ["Duplicate Extra Rows Removed", audit.duplicateExtraRows],
    [],
    ["Duplicate ASIN", "Duplicate Row Count", "Kept Revenue", "Files", "Sample Title"],
  ]

  for (const row of audit.duplicateRows) {
    rows.push([row.asin, row.duplicateRowCount, round2(row.keptRevenue), row.files, row.sampleTitle])
  }

  return rows
}

function buildPriceTierRows(categoryId: NonCodeCategoryId, records: EnrichedRecord[]) {
  const totalRevenue = records.reduce((sum, record) => sum + record.asinRevenue, 0)
  const totalUnits = records.reduce((sum, record) => sum + record.asinSales, 0)
  const tiers = categoryId === "oil" ? OIL_PRICE_TIERS : PRICE_TIERS

  return tiers.map((tier) => {
    const matched = records.filter((record) => record.price >= tier.min && record.price < tier.max)
    const revenue = matched.reduce((sum, record) => sum + record.asinRevenue, 0)
    const units = matched.reduce((sum, record) => sum + record.asinSales, 0)
    return {
      "Price Tier": tier.label,
      "Total Revenue": round2(revenue),
      "Total Sales": round2(units),
      "Rev Share %": totalRevenue > 0 ? round4(revenue / totalRevenue) : 0,
      "Unit Share %": totalUnits > 0 ? round4(units / totalUnits) : 0,
      "Avg Price": round2(averagePriceForCategory(categoryId, matched)),
    }
  })
}

function enrichRecord(categoryId: NonCodeCategoryId, record: RawRecord): EnrichedRecord {
  if (categoryId === "borescope") {
    const dimensions = inferBorescopeDimensions(record.title)
    return {
      ...record,
      typeLabel: dimensions.Type,
      extraColumns: {
        "2/4-way": dimensions["2/4-way"],
        Display: dimensions.Display,
        "Lens Diameter": dimensions["Lens Diameter"],
        "Lens Count": dimensions["Lens Count"],
        "Cable Length": dimensions["Cable Length"],
      },
    }
  }

  if (categoryId === "smoke_machine") {
    const smoke = inferSmokeMachineAttributes(record)
    return {
      ...record,
      typeLabel: smoke.typeLabel,
      extraColumns: {
        Subcategory: record.subcategory ?? "",
        "Size Tier": record.sizeTier ?? "",
        "Is Accessory": yesNo(smoke.isAccessory),
        "Is Built-in Pump": yesNo(smoke.hasBuiltInPump),
        "Is Includes Smoke Fluid": yesNo(smoke.includesSmokeFluid),
        "Is Pressure Gauge": yesNo(smoke.hasPressureGauge),
      },
    }
  }

  if (categoryId === "thermal_imager") {
    const thermal = inferThermalDimensions(record)
    return {
      ...record,
      typeLabel: thermal.Type,
      extraColumns: {
        "Phone adapted": thermal["Phone adapted"],
        "Basic Resolution": thermal["Basic Resolution"],
        "Super Resolution": thermal["Super Resolution"],
        Laser: thermal.Laser,
        "Wi-Fi": thermal["Wi-Fi"],
        "Visual Camera": thermal["Visual Camera"],
        Display: thermal.Display,
        Subcategory: record.subcategory ?? "",
        "Size Tier": record.sizeTier ?? "",
      },
    }
  }

  if (categoryId === "jump_starters") {
    const jumpStarter = classifyJumpStarterProduct(record)
    return {
      ...record,
      typeLabel: jumpStarter.typeLabel,
      extraColumns: {
        "Has Inflator": jumpStarter.isAccessory ? "N/A" : yesNo(jumpStarter.hasInflator),
        "Voltage Class": jumpStarter.voltageClass,
        "Has Power Station": jumpStarter.isAccessory ? "N/A" : yesNo(jumpStarter.hasPowerStation),
        "Is Accessory": yesNo(jumpStarter.isAccessory),
        "Accessory Type": jumpStarter.accessoryType,
        Subcategory: record.subcategory ?? "",
        "Size Tier": record.sizeTier ?? "",
      },
    }
  }

  if (categoryId === "mechanic_stool") {
    const mechanicStool = classifyMechanicStoolProduct(record)
    return {
      ...record,
      typeLabel: mechanicStool.typeLabel,
      extraColumns: {
        "Adjustable Height": yesNo(mechanicStool.isAdjustableHeight),
        Backrest: yesNo(mechanicStool.hasBackrest),
        "Storage Type": mechanicStool.storageType,
        Material: mechanicStool.materialLabel,
        Subcategory: record.subcategory ?? "",
        "Size Tier": record.sizeTier ?? "",
      },
    }
  }

  if (categoryId === "backpack") {
    const backpack = classifyBackpackProduct(record)
    return {
      ...record,
      typeLabel: backpack.typeLabel,
      extraColumns: {
        "Trade Focus": backpack.tradeFocus,
        "Is Rolling": yesNo(backpack.isRolling),
        "Has Laptop Compartment": yesNo(backpack.hasLaptopCompartment),
        "Base Style": backpack.baseStyle,
        "Shipping Tier": backpack.shippingTier,
        BSR: integerCell(record.bsr),
        "Subcategory BSR": integerCell(record.subcategoryBsr),
        Length: metricCell(record.length),
        Width: metricCell(record.width),
        Height: metricCell(record.height),
        Weight: metricCell(record.weight),
        "Best Sales Period": record.bestSalesPeriod ?? "Unknown",
        "Best Sales Season": backpack.bestSalesSeason,
        "Listing Age (Months)": integerCell(record.listingAgeMonths),
        "Variation Count": integerCell(record.variationCount),
        "Number of Images": integerCell(record.imageCount),
        "Sales YoY %": metricCell(record.salesYearOverYearPct),
        "Sales to Reviews": metricCell(record.salesToReviews),
      },
    }
  }

  if (categoryId === "oil") {
    const oil = classifyOilProduct(record)
    return {
      ...record,
      typeLabel: oil.typeLabel,
      extraColumns: {
        "Raw Subcategory": oil.rawSubcategory,
        "Product Family": oil.productFamily,
        "Fluid Application": oil.fluidApplication,
        "Viscosity / Grade": oil.viscosityGrade,
        "Pack Size": oil.packSize,
        "Seasonal Use": oil.seasonalUse,
      },
    }
  }

  if (categoryId === "stethoscope") {
    const stethoscope = classifyStethoscopeProduct(record)
    return {
      ...record,
      typeLabel: stethoscope.typeLabel,
      extraColumns: {
        "Diagnostic Type": stethoscope.diagnosticType,
        Electronic: yesNo(stethoscope.isElectronic),
        "Channel Count": stethoscope.channelCount,
        "Probe Count": stethoscope.probeCount,
        "Vehicle Context": stethoscope.vehicleContext,
        Subcategory: record.subcategory ?? "",
        "Size Tier": record.sizeTier ?? "",
      },
    }
  }

  return {
    ...record,
    typeLabel: record.subcategory ?? record.sizeTier ?? "Unknown",
    extraColumns: {
      Subcategory: record.subcategory ?? "",
      "Size Tier": record.sizeTier ?? "",
    },
  }
}

function inferBorescopeDimensions(title: string) {
  const normalized = `${title ?? ""}`.toLowerCase()
  return {
    Type: inferBorescopeType(normalized),
    "2/4-way": inferBorescopeArticulation(normalized),
    Display: inferDisplay(normalized),
    "Lens Diameter": inferLensDiameter(normalized),
    "Lens Count": inferLensCount(normalized),
    "Cable Length": inferCableLength(normalized),
  }
}

function inferThermalDimensions(record: RawRecord) {
  const normalized = `${record.title ?? ""}`.toLowerCase()
  return {
    Type: inferThermalTypeLabel({ asin: record.asin, title: record.title }),
    "Phone adapted": inferThermalPhoneAdaptedLabel({ asin: record.asin, title: record.title }),
    "Basic Resolution": inferResolution(normalized, BASIC_RESOLUTION_REGEX),
    "Super Resolution": inferResolution(normalized, SUPER_RESOLUTION_REGEX),
    Laser: inferThermalLaser(normalized),
    "Wi-Fi": inferThermalWifi(normalized),
    "Visual Camera": inferThermalVisualCamera(normalized),
    Display: inferDisplay(normalized),
  }
}

function inferSmokeMachineAttributes(record: RawRecord) {
  const normalized = `${record.title ?? ""}`.toLowerCase()
  const isAccessory = /\b(adapter|cone|plug|plugs|bladder|accessor|replacement|2-pack|pack|cap)\b/.test(normalized)
  const isFluid = /\b(fluid|solution)\b/.test(normalized)
  const hasBuiltInPump = /\b(built-?in air pump|built-?in air compressor|air pump|air compressor)\b/.test(normalized)
  const hasPressureGauge = /\b(pressure gauge|flow indicator)\b/.test(normalized)
  const includesSmokeFluid = /\b(smoke fluid|fluid x\d+|includes smoke fluid|starter size)\b/.test(normalized)

  let typeLabel = "Smoke Machine"
  if (isAccessory) {
    typeLabel = "Accessory"
  } else if (isFluid) {
    typeLabel = "Smoke Fluid"
  } else if (/\b(high volume|shop series)\b/.test(normalized)) {
    typeLabel = "High-volume Smoke Machine"
  } else if (/\b(evap|leak detector|vacuum diagnostic tester)\b/.test(normalized)) {
    typeLabel = "Leak Detector Kit"
  }

  return {
    typeLabel,
    isAccessory,
    hasBuiltInPump,
    includesSmokeFluid,
    hasPressureGauge,
  }
}

function inferBorescopeType(title: string) {
  if (title.includes("sewer")) return "Sewer camera"
  if (/\b(wireless|wi-?fi)\b/.test(title)) return "Wireless"
  if (/\b(usb|type-c|smartphone|iphone|android|ios)\b/.test(title)) return "USB"
  return "Articulation"
}

function inferBorescopeArticulation(title: string) {
  if (/\b(4-?way|four-?way|4 ways|4 way|joystick|360°|360 degree)\b/.test(title)) return "4-way"
  if (/\b(2-?way|two-?way|210°|220°|articulat)\b/.test(title)) return "2-way"
  return "2-way"
}

function inferResolution(title: string, regex: RegExp) {
  const match = title.match(regex)
  return match?.[1] ?? "-"
}

function inferDisplay(title: string) {
  const match = title.match(/(\d+(?:\.\d+)?)\s*(?:["″”]|-?\s*inch\b|in\b)/i)
  if (match) return `${Number(match[1]).toFixed(1)}"`
  if (/\b(android|iphone|ios|smartphone|app|wi-?fi|wireless)\b/i.test(title)) return "App"
  return "Unknown"
}

function inferThermalLaser(title: string) {
  if (/\blaser\b/i.test(title)) return "Yes"
  return "No"
}

function inferThermalWifi(title: string) {
  if (/\b(bt|bluetooth)\b/i.test(title)) return "BT"
  if (/\b(wi-?fi|wireless)\b/i.test(title)) return "Yes"
  return "No"
}

function inferThermalVisualCamera(title: string) {
  const mp = title.match(/\b(0\.3|1|2|5|8)\s*mp\b/i)
  if (mp) return `${mp[1]}MP`
  if (/\bwithout visual|no visual\b/i.test(title)) return "No"
  return "No"
}

function inferLensDiameter(title: string) {
  const match = title.match(/(\d+(?:\.\d+)?)\s*mm\b/i)
  if (!match) return "Unknown"
  const value = Number(match[1])
  return Number.isFinite(value) ? `${trimDecimal(value)}mm` : "Unknown"
}

function inferLensCount(title: string) {
  if (/\b(triple|3[-\s]?lens|three[-\s]?lens)\b/i.test(title)) return "Triple"
  if (/\b(dual|2[-\s]?lens|two[-\s]?lens|dual[-\s]?view)\b/i.test(title)) return "Dual"
  return "Single"
}

function inferCableLength(title: string) {
  const ftMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:ft|feet|foot)\b/i)
  if (ftMatch) {
    const value = Number(ftMatch[1])
    return Number.isFinite(value) ? `${trimDecimal(value)}ft` : "Unknown"
  }

  const meterMatch = title.match(/(\d+(?:\.\d+)?)\s*(?:meter|meters|m)\b/i)
  if (meterMatch) {
    const meters = Number(meterMatch[1])
    return Number.isFinite(meters) ? `${trimDecimal(meters * 3.28084)}ft` : "Unknown"
  }

  return "Unknown"
}

// Retained for the electric_air_blower category, which is temporarily backed
// out until its dashboard data is generated; re-wire the call in generateReport
// when that category is re-registered.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function buildDuplicateAudit(rawMonthDir: string, runDate: string): Promise<DuplicateAudit> {
  const entries = await readdir(rawMonthDir, { withFileTypes: true }).catch(() => [])
  const csvFiles = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name)
    .filter((name) => name.includes(runDate))
    .sort()

  const byAsin = new Map<string, Array<{ file: string; revenue: number; title: string }>>()
  let totalRawRows = 0

  for (const file of csvFiles) {
    const contents = await readFile(path.join(rawMonthDir, file), "utf8")
    const rows = parseCsvRows(contents)
    if (!rows.length) continue
    const headers = rows[0].map(normalizeCsvHeader)
    const columnIndex = new Map(headers.map((name, index) => [name, index]))
    const asinIndex = columnIndex.get("ASIN")
    if (asinIndex === undefined) continue

    const revenueIndex = columnIndex.get("ASIN Revenue")
    const titleIndex = columnIndex.get("Title")
    for (const row of rows.slice(1)) {
      const asin = `${row[asinIndex] ?? ""}`.trim().toUpperCase()
      if (!asin) continue
      totalRawRows += 1
      const revenue = revenueIndex === undefined ? 0 : parseNumericCell(row[revenueIndex] ?? "")
      const title = titleIndex === undefined ? "" : `${row[titleIndex] ?? ""}`.trim()
      const existing = byAsin.get(asin) ?? []
      existing.push({ file, revenue, title })
      byAsin.set(asin, existing)
    }
  }

  const duplicateGroups = Array.from(byAsin.entries()).filter(([, rows]) => rows.length > 1)
  const duplicateRows = duplicateGroups
    .map(([asin, rows]) => ({
      asin,
      duplicateRowCount: rows.length,
      keptRevenue: Math.max(...rows.map((row) => row.revenue)),
      files: Array.from(new Set(rows.map((row) => row.file))).join(" | "),
      sampleTitle: rows[0]?.title ?? "",
    }))
    .sort((left, right) => right.duplicateRowCount - left.duplicateRowCount || right.keptRevenue - left.keptRevenue)

  return {
    totalRawRows,
    uniqueAsins: byAsin.size,
    duplicateAsinGroups: duplicateGroups.length,
    duplicateExtraRows: totalRawRows - byAsin.size,
    duplicateRows,
  }
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ""
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (inQuotes) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
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
      rows.push(row)
      row = []
      field = ""
      continue
    }
    if (char !== "\r") {
      field += char
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

function normalizeCsvHeader(value: string) {
  return value.replace(/^\uFEFF/, "").trim()
}

function parseNumericCell(value: string) {
  const normalized = value.replace(/[$,%]/g, "").replace(/,/g, "").trim()
  if (!normalized || normalized === "N/A") return 0
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : 0
}

async function resolveLatestRunDate(monthDir: string, fallbackSnapshotDate: string) {
  const entries = await readdir(monthDir, { withFileTypes: true }).catch(() => [])
  const dates = entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".csv"))
    .map((entry) => entry.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] ?? null)
    .filter((value): value is string => Boolean(value))
    .sort()

  return dates.at(-1) ?? fallbackSnapshotDate
}

function inferColumnWidths(rows: Array<Array<string | number>>) {
  const widths: number[] = []
  for (const row of rows) {
    row.forEach((value, index) => {
      const length = `${value ?? ""}`.length
      widths[index] = Math.min(Math.max(widths[index] ?? 10, length + 2), 80)
    })
  }
  return widths.map((width) => ({ wch: width }))
}

function normalizeBrandName(value: string) {
  return value.trim().toLowerCase()
}

function normalizeBrandDisplayName(value: string) {
  const normalized = normalizeBrandName(value)
  if (normalized === "liqui moly") return "Liqui Moly"
  return value.trim() || "Unknown"
}

function analysisFileBase(label: string) {
  return `${label.replace(/[^\w]+/g, "_").replace(/^_+|_+$/g, "")}_Market_Analysis`
}

function resolveOutputPaths(input: {
  categoryId: NonCodeCategoryId
  label: string
  month: string
  runDate: string
  categoryDir: string
  outputsDir: string
}) {
  if (input.categoryId === "thermal_imager") {
    if (input.month === "202511") {
      return {
        analysisPath: path.join(input.categoryDir, "TI_Market_Analysis.xlsx"),
        formattedPath: path.join(input.categoryDir, "25-11-25 Thermal Imager V4.xlsx"),
      }
    }
    if (input.month === "202512") {
      return {
        analysisPath: path.join(input.categoryDir, "TI_Market_Analysis_260113.xlsx"),
        formattedPath: path.join(input.categoryDir, "26-01-14 Thermal Imager.xlsx"),
      }
    }

    return {
      analysisPath: path.join(input.categoryDir, `TI_Market_Analysis_${input.month}.xlsx`),
      formattedPath: path.join(input.categoryDir, `${formatRunDateLabel(input.runDate)} ${input.label}.xlsx`),
    }
  }

  const analysisPath = path.join(input.outputsDir, `${analysisFileBase(input.label)}_${input.month}.xlsx`)
  if (input.categoryId === "night_vision") {
    return {
      analysisPath,
      formattedPath: path.join(
        input.outputsDir,
        `Night_Vision_Monoculars_top50(${input.runDate.replace(/-/g, "")}).xlsx`
      ),
    }
  }

  return {
    analysisPath,
    formattedPath: path.join(input.outputsDir, `${formatRunDateLabel(input.runDate)} ${input.label}.xlsx`),
  }
}

function formatRunDateLabel(runDate: string) {
  const [year, month, day] = runDate.split("-")
  return `${year.slice(2)}-${month}-${day}`
}

function yesNo(value: boolean) {
  return value ? "Yes" : "No"
}

function round2(value: number) {
  return Number(value.toFixed(2))
}

function round4(value: number) {
  return Number(value.toFixed(4))
}

function trimDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function integerCell(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === undefined || value === null) return "Unknown"
  return `${Math.round(value)}`
}

function metricCell(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === undefined || value === null) return "Unknown"
  return `${round2(value)}`
}

function parseArgs(argv: string[]): CliArgs {
  const categories: string[] = []
  let month = ""
  let sourceRoot = path.resolve(appRoot, "..", "NewProductCategory")

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--month") {
      month = argv[index + 1] ?? ""
      index += 1
      continue
    }
    if (token === "--category") {
      categories.push(argv[index + 1] ?? "")
      index += 1
      continue
    }
    if (token === "--source-root") {
      sourceRoot = path.resolve(argv[index + 1] ?? sourceRoot)
      index += 1
      continue
    }
  }

  if (!/^\d{6}$/.test(month)) {
    throw new Error("Expected --month YYYYMM")
  }

  const resolvedCategories = (categories.length ? categories : listNonCodeCategoryIds())
    .filter((value): value is NonCodeCategoryId => isNonCodeCategoryId(value))

  if (!resolvedCategories.length) {
    throw new Error("Expected at least one valid --category value")
  }

  return {
    month,
    categories: resolvedCategories,
    sourceRoot,
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
