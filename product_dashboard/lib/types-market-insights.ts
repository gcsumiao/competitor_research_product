import type { ProductSummary, SnapshotSummary } from "@/lib/competitor-data"
import {
  getTargetDimensionPreset,
  type NonCodeCategoryId,
  type TargetDimensionPreset,
} from "@/lib/non-code-category-config"
import {
  inferThermalPhoneAdaptedLabel,
  inferThermalTypeLabel,
  THERMAL_PHONE_ADAPTED_TYPE_LABEL,
} from "@/lib/thermal-imager-classification"
import type { CategoryTypeSummary } from "@/lib/type-summaries"

export type TargetCategoryId = TargetDimensionPreset
export type TrendMetric = "revenue" | "units"
export type DimensionSource = "snapshot" | "workbook"
export type ValidationStatus = "pass" | "fail" | "unavailable"

export type DimensionOption = {
  key: string
  label: string
}

export type DerivedDimensionRow = {
  valueKey: string
  label: string
  avgPrice: number
  units: number
  revenue: number
  unitsShare: number
  revenueShare: number
  typeShare: number
  listingCount: number
  source: DimensionSource
}

export type ProductWithDimensions = {
  product: ProductSummary
  dimensions: Record<string, string>
}

export type MarketEntryInsights = {
  pricingGap: string
  concentration: string
  whitespace: string
  entryAngles: string[]
}

type ParsedWorkbookSummary = {
  dimensionKey: string
  dimensionLabel: string
  rows: Omit<DerivedDimensionRow, "source" | "typeShare" | "listingCount">[]
}

export type DimensionValidationCheck = {
  key: string
  label: string
  status: ValidationStatus
  detail: string
}

export type DimensionValidationResult = {
  available: boolean
  source: DimensionSource
  workbookRowCount: number
  renderedRowCount: number
  checks: DimensionValidationCheck[]
}

const BORESCOPE_DIMENSIONS: DimensionOption[] = [
  { key: "type", label: "Type" },
  { key: "two_four_way", label: "2/4-way" },
  { key: "display", label: "Display" },
  { key: "lens_diameter", label: "Lens diameter" },
  { key: "lens_count", label: "Lens count" },
  { key: "cable_length", label: "Cable length" },
]

const THERMAL_DIMENSIONS: DimensionOption[] = [
  { key: "type", label: "Type" },
  { key: "phone_adapted", label: "Phone adapted" },
  { key: "basic_resolution", label: "Basic Resolution" },
  { key: "super_resolution", label: "Super Resolution" },
  { key: "laser", label: "Laser" },
  { key: "wifi", label: "Wi-Fi" },
  { key: "visual_camera", label: "Visual Camera" },
  { key: "display", label: "Display" },
]

const THERMAL_TYPE_SEQUENCE = [
  THERMAL_PHONE_ADAPTED_TYPE_LABEL,
  "Handheld",
  "Landscape",
  "Pocket size",
  "Wireless",
  "-",
] as const

const BASIC_RESOLUTION_REGEX = /\b(80x60|96x96|120x90|128x96|160x120|256x192|320x240)\b/i
const SUPER_RESOLUTION_REGEX =
  /\b(160x120|192x192|240x180|240x240|320x240|480x360|512x384)\b/i
const GENERIC_DIMENSIONS: DimensionOption[] = [{ key: "type", label: "Type" }]

export function getTargetCategoryPreset(
  categoryId: NonCodeCategoryId | undefined
): TargetCategoryId | null {
  return getTargetDimensionPreset(categoryId)
}

export function getDimensionOptions(
  categoryId: NonCodeCategoryId,
  summary?: CategoryTypeSummary | null
): DimensionOption[] {
  const parsed = summary ? parseWorkbookSummarySections(summary) : []
  if (parsed.length) {
    const seen = new Set<string>()
    return parsed
      .map((item) => ({
        key: item.dimensionKey,
        label: item.dimensionLabel,
      }))
      .filter((item) => {
        if (!item.key || seen.has(item.key)) return false
        seen.add(item.key)
        return true
      })
  }

  const preset = getTargetCategoryPreset(categoryId)
  if (preset === "borescope") return BORESCOPE_DIMENSIONS
  if (preset === "thermal_imager") return THERMAL_DIMENSIONS
  return GENERIC_DIMENSIONS
}

export function deriveDimensionRowsWithFallback(params: {
  categoryId: NonCodeCategoryId
  snapshot: SnapshotSummary | undefined
  summary: CategoryTypeSummary | null
  dimensionKey: string
}): { rows: DerivedDimensionRow[]; source: DimensionSource } {
  if (getTargetCategoryPreset(params.categoryId) === "thermal_imager") {
    const snapshotRows = deriveSnapshotRowsForDimension(
      params.snapshot,
      params.categoryId,
      params.dimensionKey
    )
    const normalizedSnapshotRows =
      params.dimensionKey === "type"
        ? normalizeThermalTypeRows(snapshotRows)
        : snapshotRows

    if (hasUsableSnapshotRows(normalizedSnapshotRows)) {
      return { rows: normalizedSnapshotRows, source: "snapshot" }
    }
  }

  const workbookRows = deriveDimensionRowsFromWorkbookSummary(
    params.summary,
    params.dimensionKey
  )
  if (workbookRows.length) {
    return { rows: workbookRows, source: "workbook" }
  }

  const rawSnapshotRows = deriveSnapshotRowsForDimension(
    params.snapshot,
    params.categoryId,
    params.dimensionKey
  )
  const snapshotRows =
    getTargetCategoryPreset(params.categoryId) === "thermal_imager" && params.dimensionKey === "type"
      ? normalizeThermalTypeRows(rawSnapshotRows)
      : rawSnapshotRows

  const useSnapshot = hasUsableSnapshotRows(snapshotRows)
  if (useSnapshot) {
    return { rows: snapshotRows, source: "snapshot" }
  }

  return { rows: workbookRows, source: "workbook" }
}

function deriveSnapshotRowsForDimension(
  snapshot: SnapshotSummary | undefined,
  categoryId: NonCodeCategoryId,
  dimensionKey: string
) {
  const top50Rows = deriveDimensionRowsFromSnapshotTop50Type(snapshot, dimensionKey)
  if (top50Rows.length) return top50Rows
  return deriveDimensionRowsFromSnapshotProducts(snapshot?.topProducts ?? [], categoryId, dimensionKey)
}

function deriveDimensionRowsFromSnapshotTop50Type(
  snapshot: SnapshotSummary | undefined,
  dimensionKey: string
) {
  if (!snapshot?.typeBreakdowns?.top50?.length) return [] as DerivedDimensionRow[]
  if (dimensionKey !== "type") return [] as DerivedDimensionRow[]

  const rows = snapshot.typeBreakdowns.top50
    .filter((row) => {
      const key = normalizeText(row.scopeKey || "")
      const label = normalizeText(row.label || "")
      if (!label || label === "total") return false
      if (key.startsWith("total")) return false
      return true
    })
    .map((row) => ({
      valueKey: normalizeValueKey(row.label || "Unknown"),
      label: row.label || "Unknown",
      avgPrice: safeNumber(row.avgPrice),
      units: safeNumber(row.units),
      revenue: safeNumber(row.revenue),
      unitsShare: safeNumber(row.unitsShare),
      revenueShare: safeNumber(row.revenueShare),
      typeShare: 0,
      listingCount: 0,
      source: "snapshot" as const,
    }))
    .sort((a, b) => b.revenue - a.revenue)

  return rows
}

export function deriveDimensionRowsFromSnapshotProducts(
  products: ProductSummary[],
  categoryId: NonCodeCategoryId,
  dimensionKey: string
): DerivedDimensionRow[] {
  if (!products.length) return []

  const byValue = new Map<
    string,
    {
      label: string
      revenue: number
      units: number
      listingCount: number
      priceSum: number
      priceCount: number
    }
  >()

  for (const product of products) {
    const dimensions = inferProductDimensions(product, categoryId)
    const value = (dimensions[dimensionKey] || "Unknown").trim() || "Unknown"
    const valueKey = normalizeValueKey(value)
    const current = byValue.get(valueKey) ?? {
      label: value,
      revenue: 0,
      units: 0,
      listingCount: 0,
      priceSum: 0,
      priceCount: 0,
    }

    current.revenue += safeNumber(product.revenue)
    current.units += safeNumber(product.units)
    current.listingCount += 1
    const price = safeNumber(product.price)
    if (price > 0) {
      current.priceSum += price
      current.priceCount += 1
    }
    byValue.set(valueKey, current)
  }

  const totalRevenue = Array.from(byValue.values()).reduce((sum, row) => sum + row.revenue, 0)
  const totalUnits = Array.from(byValue.values()).reduce((sum, row) => sum + row.units, 0)
  const totalListings = Array.from(byValue.values()).reduce((sum, row) => sum + row.listingCount, 0)

  return Array.from(byValue.entries())
    .map(([valueKey, row]) => ({
      valueKey,
      label: row.label,
      avgPrice: row.priceCount ? row.priceSum / row.priceCount : 0,
      units: row.units,
      revenue: row.revenue,
      unitsShare: totalUnits ? row.units / totalUnits : 0,
      revenueShare: totalRevenue ? row.revenue / totalRevenue : 0,
      typeShare: totalListings ? row.listingCount / totalListings : 0,
      listingCount: row.listingCount,
      source: "snapshot" as const,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export function deriveDimensionRowsFromWorkbookSummary(
  summary: CategoryTypeSummary | null,
  dimensionKey: string
): DerivedDimensionRow[] {
  if (!summary?.sections?.length) return []

  const parsed = parseWorkbookSummarySections(summary)
  const matched = parsed.find((item) => item.dimensionKey === dimensionKey)
  if (!matched) return []

  return matched.rows
    .map((row) => ({
      ...row,
      typeShare: 0,
      listingCount: 0,
      source: "workbook" as const,
    }))
    .sort((a, b) => b.revenue - a.revenue)
}

export function deriveTrendSeriesByValue(params: {
  snapshots: SnapshotSummary[]
  categoryId: NonCodeCategoryId
  dimensionKey: string
  valueKey: string
  metric: TrendMetric
  summariesByDate?: Map<string, CategoryTypeSummary | null>
}): Array<{ label: string; value: number }> {
  return params.snapshots.map((snapshot) => {
    const summary = params.summariesByDate?.get(snapshot.date) ?? null
    const workbookRows = deriveDimensionRowsFromWorkbookSummary(summary, params.dimensionKey)
    const rows = workbookRows.length
      ? workbookRows
      : deriveSnapshotRowsForDimension(snapshot, params.categoryId, params.dimensionKey)
    const match = rows.find((row) => row.valueKey === params.valueKey)
    const value = params.metric === "revenue" ? match?.revenue ?? 0 : match?.units ?? 0
    return {
      label: snapshot.label,
      value,
    }
  })
}

export function deriveProductsWithDimensions(
  products: ProductSummary[],
  categoryId: NonCodeCategoryId
): ProductWithDimensions[] {
  return products.map((product) => ({
    product,
    dimensions: inferProductDimensions(product, categoryId),
  }))
}

export function filterProductsByDimensionValue(
  products: ProductSummary[],
  categoryId: NonCodeCategoryId,
  dimensionKey: string,
  valueKey: string
) {
  const enriched = deriveProductsWithDimensions(products, categoryId)
  return enriched.filter((item) => normalizeValueKey(item.dimensions[dimensionKey] || "Unknown") === valueKey)
}

export function validateDimensionRowsAgainstWorkbook(params: {
  summary: CategoryTypeSummary | null
  renderedRows: DerivedDimensionRow[]
  dimensionKey: string
  source: DimensionSource
}): DimensionValidationResult {
  const workbookRows = deriveDimensionRowsFromWorkbookSummary(params.summary, params.dimensionKey)
  if (!workbookRows.length || params.source !== "workbook") {
    return {
      available: false,
      source: params.source,
      workbookRowCount: workbookRows.length,
      renderedRowCount: params.renderedRows.length,
      checks: buildUnavailableValidationChecks(params.source, workbookRows.length),
    }
  }

  const workbookByKey = new Map(workbookRows.map((row) => [row.valueKey, row]))
  const renderedByKey = new Map(params.renderedRows.map((row) => [row.valueKey, row]))
  const sharedKeys = [...workbookByKey.keys()].filter((key) => renderedByKey.has(key))
  const presencePass =
    workbookRows.length === params.renderedRows.length &&
    sharedKeys.length === workbookRows.length

  return {
    available: true,
    source: params.source,
    workbookRowCount: workbookRows.length,
    renderedRowCount: params.renderedRows.length,
    checks: [
      {
        key: "row_presence",
        label: "Row/value presence match",
        status: presencePass ? "pass" : "fail",
        detail: presencePass
          ? `Matched ${sharedKeys.length} workbook rows.`
          : `Displayed ${params.renderedRows.length} rows vs workbook ${workbookRows.length}.`,
      },
      buildMetricValidationCheck("avg_price", "Avg Price", workbookRows, params.renderedRows, (row) => row.avgPrice),
      buildMetricValidationCheck("quantity", "Quantity/Mo", workbookRows, params.renderedRows, (row) => row.units),
      buildMetricValidationCheck("quantity_share", "Qty by %", workbookRows, params.renderedRows, (row) => row.unitsShare),
      buildMetricValidationCheck("revenue", "Revenue/Mo", workbookRows, params.renderedRows, (row) => row.revenue),
      buildMetricValidationCheck("revenue_share", "Revenue by %", workbookRows, params.renderedRows, (row) => row.revenueShare),
    ],
  }
}

function buildMetricValidationCheck(
  key: string,
  label: string,
  workbookRows: DerivedDimensionRow[],
  renderedRows: DerivedDimensionRow[],
  selector: (row: DerivedDimensionRow) => number
): DimensionValidationCheck {
  const renderedByKey = new Map(renderedRows.map((row) => [row.valueKey, row]))

  for (const workbookRow of workbookRows) {
    const renderedRow = renderedByKey.get(workbookRow.valueKey)
    if (!renderedRow) {
      return {
        key,
        label,
        status: "fail",
        detail: `${workbookRow.label} is missing from the rendered matrix.`,
      }
    }

    const workbookValue = selector(workbookRow)
    const renderedValue = selector(renderedRow)
    if (!numbersClose(workbookValue, renderedValue)) {
      return {
        key,
        label,
        status: "fail",
        detail: `${workbookRow.label}: shown ${formatValidationValue(renderedValue, key)} vs workbook ${formatValidationValue(workbookValue, key)}.`,
      }
    }
  }

  return {
    key,
    label,
    status: "pass",
    detail: `All ${workbookRows.length} rows matched the workbook.`,
  }
}

function buildUnavailableValidationChecks(
  source: DimensionSource,
  workbookRowCount: number
): DimensionValidationCheck[] {
  const detail =
    workbookRowCount === 0
      ? "Workbook rows are not available for this snapshot and dimension."
      : source === "snapshot"
        ? "Rendered values are using snapshot fallback because workbook-aligned rows were unavailable."
        : "Validation is unavailable."

  return [
    { key: "row_presence", label: "Row/value presence match", status: "unavailable", detail },
    { key: "avg_price", label: "Avg Price", status: "unavailable", detail },
    { key: "quantity", label: "Quantity/Mo", status: "unavailable", detail },
    { key: "quantity_share", label: "Qty by %", status: "unavailable", detail },
    { key: "revenue", label: "Revenue/Mo", status: "unavailable", detail },
    { key: "revenue_share", label: "Revenue by %", status: "unavailable", detail },
  ]
}

function numbersClose(left: number, right: number) {
  return Math.abs(left - right) <= 0.01
}

function formatValidationValue(value: number, key: string) {
  if (key.includes("share")) return `${(value * 100).toFixed(1)}%`
  if (key === "quantity") return value.toLocaleString(undefined, { maximumFractionDigits: 0 })
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: key === "avg_price" ? 2 : 0 })}`
}

export function buildMarketEntryInsights(params: {
  rows: DerivedDimensionRow[]
  filteredProducts: ProductWithDimensions[]
  selectedValueLabel: string
  selectedDimensionLabel: string
}): MarketEntryInsights {
  return {
    pricingGap: buildPricingGapInsight(params.filteredProducts, params.selectedValueLabel),
    concentration: buildConcentrationInsight(params.rows),
    whitespace: buildWhitespaceInsight(params.rows),
    entryAngles: buildEntryAngles(params.rows, params.filteredProducts, params.selectedDimensionLabel),
  }
}

function parseWorkbookSummarySections(summary: CategoryTypeSummary): ParsedWorkbookSummary[] {
  const parsed: ParsedWorkbookSummary[] = []

  for (const section of summary.sections) {
    const matrix = [section.columns, ...section.rows]
      .map((row) => row.map((cell) => `${cell ?? ""}`.trim()))
      .filter((row) => row.some((cell) => cell !== ""))

    if (!matrix.length) continue

    for (let rowIndex = 0; rowIndex < matrix.length; rowIndex += 1) {
      if (!isSummaryHeaderRow(matrix[rowIndex])) continue
      const block = parseWorkbookSummaryBlock(matrix, rowIndex, section.title)
      if (block) parsed.push(block)
    }
  }

  return parsed
}

function inferProductDimensions(
  product: ProductSummary,
  categoryId: NonCodeCategoryId
): Record<string, string> {
  const title = `${product.title ?? ""}`.toLowerCase()
  const preset = getTargetCategoryPreset(categoryId)
  if (preset === "borescope") {
    return {
      type: inferBorescopeType(title),
      two_four_way: inferBorescopeArticulation(title),
      display: inferDisplay(title),
      lens_diameter: inferLensDiameter(title),
      lens_count: inferLensCount(title),
      cable_length: inferCableLength(title),
    }
  }

  if (preset === "thermal_imager") {
    return {
      type: inferThermalTypeLabel({ asin: product.asin, title: product.title }),
      phone_adapted: inferThermalPhoneAdaptedLabel({ asin: product.asin, title: product.title }),
      basic_resolution: inferResolution(title, BASIC_RESOLUTION_REGEX),
      super_resolution: inferResolution(title, SUPER_RESOLUTION_REGEX),
      laser: inferThermalLaser(title),
      wifi: inferThermalWifi(title),
      visual_camera: inferThermalVisualCamera(title),
      display: inferDisplay(title),
    }
  }

  return {
    type: inferGenericType(product),
  }
}

function parseWorkbookSummaryBlock(
  matrix: string[][],
  headerIndex: number,
  sectionTitle: string
): ParsedWorkbookSummary | null {
  const header = matrix[headerIndex]
  const { dimensionKey, dimensionLabel } = resolveDimensionIdentity(header[0] || "", sectionTitle)
  if (!dimensionKey) return null

  const avgPriceIdx = findColumnIndex(header, ["avg price"])
  const unitsIdx = findColumnIndex(header, ["quantity/mo", "quantity mo"])
  const unitsShareIdx = findColumnIndex(header, ["qty by %", "qty by pct"])
  const revenueIdx = findColumnIndex(header, ["revenue/mo", "revenue mo"])
  const revenueShareIdx = findColumnIndex(header, ["revenue by %", "revenue by pct"])
  if (avgPriceIdx < 0 || unitsIdx < 0 || revenueIdx < 0) return null

  const rows: Omit<DerivedDimensionRow, "source" | "typeShare" | "listingCount">[] = []
  for (let i = headerIndex + 1; i < matrix.length; i += 1) {
    const row = matrix[i]
    if (isSummaryHeaderRow(row)) break

    const firstCell = (row[0] || "").trim()
    if (!firstCell) continue
    if (/^top\s*50\s*by/i.test(firstCell)) break
    if (/^total$/i.test(firstCell)) break

    const units = parseLooseNumber(row[unitsIdx])
    const revenue = parseLooseNumber(row[revenueIdx])
    const avgPrice = parseLooseNumber(row[avgPriceIdx])
    const parsedUnitsShare =
      unitsShareIdx >= 0 ? parseLooseShare(row[unitsShareIdx]) : NaN
    const parsedRevenueShare =
      revenueShareIdx >= 0 ? parseLooseShare(row[revenueShareIdx]) : NaN

    rows.push({
      valueKey: normalizeValueKey(firstCell),
      label: firstCell,
      avgPrice,
      units,
      revenue,
      unitsShare: Number.isFinite(parsedUnitsShare) ? parsedUnitsShare : 0,
      revenueShare: Number.isFinite(parsedRevenueShare) ? parsedRevenueShare : 0,
    })
  }

  if (!rows.length) return null

  const totalUnits = rows.reduce((sum, row) => sum + row.units, 0)
  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  return {
    dimensionKey,
    dimensionLabel,
    rows: rows.map((row) => ({
      ...row,
      unitsShare: row.unitsShare || (totalUnits ? row.units / totalUnits : 0),
      revenueShare: row.revenueShare || (totalRevenue ? row.revenue / totalRevenue : 0),
    })),
  }
}

function isSummaryHeaderRow(row: string[]) {
  const normalized = row.map(normalizeText)
  return (
    normalized.some((cell) => cell === "avg price") &&
    normalized.some((cell) => cell === "quantity/mo" || cell === "quantity mo") &&
    normalized.some((cell) => cell === "revenue/mo" || cell === "revenue mo")
  )
}

function resolveDimensionIdentity(headerLabel: string, sectionTitle: string) {
  const fallbackLabel = inferDimensionLabelFromTitle(sectionTitle)
  const rawLabel = headerLabel.trim() || fallbackLabel
  const key =
    mapDimensionLabelToKey(rawLabel) ||
    mapDimensionLabelToKey(sectionTitle) ||
    normalizeValueKey(rawLabel || fallbackLabel || "type")

  return {
    dimensionKey: key,
    dimensionLabel: rawLabel || fallbackLabel || "Type",
  }
}

function inferDimensionLabelFromTitle(title: string) {
  const cleaned = title
    .replace(/^top\s*50/i, "")
    .replace(/summary$/i, "")
    .replace(/^[\s_-]+|[\s_-]+$/g, "")
    .trim()
  return cleaned || "Type"
}

function inferGenericType(product: ProductSummary) {
  const value = `${product.toolType ?? product.subcategory ?? ""}`.trim()
  return value || "Unknown"
}

function inferBorescopeType(title: string) {
  if (title.includes("sewer")) return "Sewer camera"
  if (/\b(wireless|wi-?fi)\b/i.test(title)) return "Wireless"
  if (/\b(usb|type-c|smartphone|iphone|android|ios)\b/i.test(title)) return "USB"
  return "Articulation"
}

function inferBorescopeArticulation(title: string) {
  if (/\b(4-?way|four-?way|4 ways|4 way|joystick|360°|360 degree)\b/i.test(title)) {
    return "4-way"
  }
  if (/\b(2-?way|two-?way|210°|220°|articulat)\b/i.test(title)) {
    return "2-way"
  }
  return "2-way"
}

function inferDisplay(title: string) {
  const match = title.match(/(\d+(?:\.\d+)?)\s*(?:["″”]|-?\s*inch\b|in\b)/i)
  if (match) return `${Number(match[1]).toFixed(1)}"`
  if (/\b(android|iphone|ios|smartphone|app|wi-?fi|wireless)\b/i.test(title)) return "App"
  return "Unknown"
}

function inferLensDiameter(title: string) {
  const mmMatch = title.match(/(\d+(?:\.\d+)?)\s*mm\b/i)
  if (mmMatch) {
    const mm = Number(mmMatch[1])
    return Number.isFinite(mm) ? `${trimDecimal(mm)}mm` : "Unknown"
  }
  return "Unknown"
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
    if (Number.isFinite(meters)) {
      return `${trimDecimal(meters * 3.28084)}ft`
    }
  }
  return "Unknown"
}

function inferResolution(title: string, regex: RegExp) {
  const match = title.match(regex)
  return match?.[1] ?? "-"
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

function hasUsableSnapshotRows(rows: DerivedDimensionRow[]) {
  if (rows.length < 2) return false
  return rows.some((row) => row.label.toLowerCase() !== "unknown")
}

function normalizeThermalTypeRows(rows: DerivedDimensionRow[]) {
  if (!rows.length) return []

  const source = rows[0]?.source ?? "snapshot"
  const buckets = new Map<
    string,
    {
      label: string
      revenue: number
      units: number
      listingCount: number
      typeShareSum: number
      typeShareCount: number
      weightedPrice: number
      weightDenominator: number
    }
  >()
  const totals = { revenue: 0, units: 0, listings: 0 }

  for (const row of rows) {
    const label = canonicalThermalTypeLabel(row.label)
    const key = normalizeValueKey(label)
    const current = buckets.get(key) ?? {
      label,
      revenue: 0,
      units: 0,
      listingCount: 0,
      typeShareSum: 0,
      typeShareCount: 0,
      weightedPrice: 0,
      weightDenominator: 0,
    }

    current.revenue += safeNumber(row.revenue)
    current.units += safeNumber(row.units)
    current.listingCount += safeNumber(row.listingCount)

    if (safeNumber(row.typeShare) > 0) {
      current.typeShareSum += safeNumber(row.typeShare)
      current.typeShareCount += 1
    }

    const priceWeight = safeNumber(row.units) > 0 ? safeNumber(row.units) : safeNumber(row.listingCount)
    const normalizedWeight = priceWeight > 0 ? priceWeight : 1
    current.weightedPrice += safeNumber(row.avgPrice) * normalizedWeight
    current.weightDenominator += normalizedWeight

    buckets.set(key, current)
    totals.revenue += safeNumber(row.revenue)
    totals.units += safeNumber(row.units)
    totals.listings += safeNumber(row.listingCount)
  }

  return THERMAL_TYPE_SEQUENCE.map((label) => {
    const key = normalizeValueKey(label)
    const bucket = buckets.get(key)
    const revenue = bucket?.revenue ?? 0
    const units = bucket?.units ?? 0
    const listingCount = bucket?.listingCount ?? 0

    return {
      valueKey: key,
      label,
      avgPrice:
        bucket && bucket.weightDenominator > 0
          ? bucket.weightedPrice / bucket.weightDenominator
          : 0,
      units,
      revenue,
      unitsShare: totals.units ? units / totals.units : 0,
      revenueShare: totals.revenue ? revenue / totals.revenue : 0,
      typeShare:
        totals.listings > 0
          ? listingCount / totals.listings
          : bucket && bucket.typeShareCount > 0
            ? bucket.typeShareSum / bucket.typeShareCount
            : 0,
      listingCount,
      source,
    }
  })
}

function buildPricingGapInsight(
  products: ProductWithDimensions[],
  selectedValueLabel: string
) {
  if (!products.length) {
    return `No product-level evidence for ${selectedValueLabel}. Use this as a watchlist segment before entry.`
  }

  const bands = [
    { label: "<$100", min: 0, max: 100 },
    { label: "$100-$200", min: 100, max: 200 },
    { label: "$200-$400", min: 200, max: 400 },
    { label: "$400+", min: 400, max: Number.POSITIVE_INFINITY },
  ]

  const totals = bands.map((band) => {
    const inBand = products.filter((item) => {
      const price = safeNumber(item.product.price)
      return price >= band.min && price < band.max
    })
    const revenue = inBand.reduce((sum, item) => sum + safeNumber(item.product.revenue), 0)
    return {
      band: band.label,
      count: inBand.length,
      revenue,
    }
  })

  const totalCount = totals.reduce((sum, item) => sum + item.count, 0) || 1
  const totalRevenue = totals.reduce((sum, item) => sum + item.revenue, 0) || 1

  const candidate = totals
    .map((item) => ({
      ...item,
      countShare: item.count / totalCount,
      revenueShare: item.revenue / totalRevenue,
      gap: item.revenue / totalRevenue - item.count / totalCount,
    }))
    .sort((a, b) => b.gap - a.gap)[0]

  if (candidate && candidate.revenueShare >= 0.12 && candidate.gap >= 0.08) {
    return `${candidate.band} is under-represented by listings but over-indexes in revenue for ${selectedValueLabel}.`
  }
  return `Pricing is relatively balanced for ${selectedValueLabel}; entry should differentiate on specs rather than pure price.`
}

function buildConcentrationInsight(rows: DerivedDimensionRow[]) {
  if (!rows.length) return "Concentration unavailable due to missing type rows."
  const top3Share = rows
    .slice()
    .sort((a, b) => b.revenueShare - a.revenueShare)
    .slice(0, 3)
    .reduce((sum, row) => sum + row.revenueShare, 0)

  if (top3Share >= 0.8) {
    return `High concentration: top 3 values control ${(top3Share * 100).toFixed(1)}% of revenue. Entry risk is high without focused differentiation.`
  }
  if (top3Share >= 0.65) {
    return `Moderate concentration: top 3 values control ${(top3Share * 100).toFixed(1)}% of revenue. Entry is viable with targeted positioning.`
  }
  return `Low concentration: top 3 values control ${(top3Share * 100).toFixed(1)}% of revenue. Market is fragmented and open to new offers.`
}

function buildWhitespaceInsight(rows: DerivedDimensionRow[]) {
  if (!rows.length) return "Whitespace unavailable due to missing type rows."
  const candidate = rows
    .filter((row) => row.revenueShare >= 0.06 && row.typeShare > 0 && row.typeShare <= 0.12)
    .sort((a, b) => b.revenueShare - a.revenueShare)[0]

  if (candidate) {
    return `${candidate.label} shows whitespace: ${(candidate.revenueShare * 100).toFixed(1)}% revenue share with only ${(candidate.typeShare * 100).toFixed(1)}% listing share.`
  }

  return "No obvious whitespace segment; consider feature bundling within leading values."
}

function buildEntryAngles(
  rows: DerivedDimensionRow[],
  products: ProductWithDimensions[],
  dimensionLabel: string
) {
  const ranked = rows.slice().sort((a, b) => b.revenueShare - a.revenueShare)
  const top = ranked[0]
  const second = ranked[1]
  const avgPrice =
    products.reduce((sum, item) => sum + safeNumber(item.product.price), 0) / Math.max(products.length, 1)

  const angles: string[] = []
  if (top) {
    angles.push(
      `Anchor on ${dimensionLabel} = ${top.label} where demand is concentrated (${(top.revenueShare * 100).toFixed(1)}% rev share).`
    )
  }
  if (second && second.revenueShare >= 0.1) {
    angles.push(
      `Use ${second.label} as secondary expansion lane to avoid head-to-head concentration pressure.`
    )
  }
  if (Number.isFinite(avgPrice) && avgPrice > 0) {
    angles.push(`Target launch MSRP near ${formatUsd(avgPrice)} with differentiated specs and proof points.`)
  }
  return angles.slice(0, 3)
}

function mapDimensionLabelToKey(label: string) {
  const normalized = normalizeText(label)
  if (
    normalized === "type" ||
    normalized === "product type" ||
    normalized.endsWith(" type") ||
    normalized.includes("top 50 summary")
  ) {
    return "type"
  }
  if (
    normalized === "2/4-way" ||
    normalized === "2/4 way" ||
    normalized.includes("articulation")
  ) return "two_four_way"
  if (normalized.includes("display")) return "display"
  if (normalized.includes("lens diameter")) return "lens_diameter"
  if (normalized.includes("lens count")) return "lens_count"
  if (normalized.includes("cable length")) return "cable_length"
  if (normalized.includes("basic resolution")) return "basic_resolution"
  if (normalized.includes("super resolution")) return "super_resolution"
  if (normalized.includes("phone adapted")) return "phone_adapted"
  if (normalized === "laser" || normalized.includes("laser ")) return "laser"
  if (normalized === "wi-fi" || normalized === "wifi" || normalized.includes("wi-fi")) return "wifi"
  if (normalized.includes("visual camera")) return "visual_camera"
  return ""
}

function canonicalThermalTypeLabel(label: string) {
  const normalized = normalizeText(label)
  if (
    normalized.includes("dongle") ||
    normalized.includes("phone adapted") ||
    (normalized.includes("usb") && normalized.includes("thermal"))
  ) {
    return THERMAL_PHONE_ADAPTED_TYPE_LABEL
  }
  if (normalized.includes("handheld")) return "Handheld"
  if (normalized.includes("landscape")) return "Landscape"
  if (normalized.includes("pocket")) return "Pocket size"
  if (normalized.includes("wireless") || normalized.includes("wrieless")) return "Wireless"
  if (!normalized || normalized === "-" || normalized === "unknown" || normalized === "n/a" || normalized === "na") {
    return "-"
  }
  return "-"
}

function findColumnIndex(header: string[], aliases: string[]) {
  const aliasSet = new Set(aliases.map((item) => normalizeText(item)))
  return header.findIndex((cell) => aliasSet.has(normalizeText(cell)))
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase()
}

function parseLooseNumber(value: string | undefined) {
  const cleaned = `${value ?? ""}`.replace(/[$,%\s,]/g, "")
  if (!cleaned) return 0
  const parsed = Number(cleaned)
  return Number.isFinite(parsed) ? parsed : 0
}

function parseLooseShare(value: string | undefined) {
  const cleaned = `${value ?? ""}`.trim()
  if (!cleaned) return NaN
  if (cleaned.includes("%")) {
    const pct = parseLooseNumber(cleaned)
    return Number.isFinite(pct) ? pct / 100 : NaN
  }
  const parsed = parseLooseNumber(cleaned)
  if (!Number.isFinite(parsed)) return NaN
  return parsed > 1 ? parsed / 100 : parsed
}

function normalizeValueKey(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^\w.-]/g, "")
}

function trimDecimal(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function safeNumber(value: number | undefined | null) {
  return Number.isFinite(value as number) ? (value as number) : 0
}

function formatUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}
