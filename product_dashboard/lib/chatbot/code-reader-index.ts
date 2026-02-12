import type {
  CategorySummary,
  ProductSummary,
  SnapshotSummary,
  TypeBreakdownMetric,
} from "@/lib/competitor-data"

export type ProductHistoryPoint = {
  date: string
  revenue: number
  units: number
  price: number
  rating: number
  reviews: number
  rankRevenue: number | null
  rankUnits: number | null
}

export type IndexedProduct = {
  asin: string
  title: string
  brand: string
  type: string
  price: number
  revenue: number
  units: number
  rating: number
  reviews: number
  url?: string
  estimatedRevenue12mo?: number
  estimatedUnits12mo?: number
  monthlyRevenue?: number
  monthlyUnits?: number
  rankRevenue: number
  rankUnits: number
  revenueMoM: number | null
  unitsMoM: number | null
  priceMoM: number | null
  ratingMoM: number | null
  history: ProductHistoryPoint[]
}

export type BrandHistoryPoint = {
  date: string
  revenue: number
  units: number
  share: number
  rankRevenue: number | null
  rankUnits: number | null
  rolling12Revenue: number | null
  rolling12Units: number | null
}

export type HistoryWindowKey = "1m" | "3m" | "6m" | "12m" | "all"

export type HistoryWindowSummary = {
  months: number
  revenue: number
  units: number
  asp: number
  avgRating: number
  revenueGrowthMoM: number | null
  revenueGrowthWindow: number | null
  trend: "up" | "down" | "flat"
}

export type AsinHistorySummary = {
  asin: string
  title: string
  brand: string
  windows: Record<HistoryWindowKey, HistoryWindowSummary>
  fastestGrowthScore: number
}

export type BrandHistorySummary = {
  brand: string
  windows: Record<HistoryWindowKey, HistoryWindowSummary>
  currentShare: number
  currentRevenueRank: number | null
  currentUnitsRank: number | null
}

export type BrandTopAsinPoint = {
  date: string
  topAsins: Array<{
    asin: string
    title: string
    revenue: number
    units: number
  }>
}

export type CodeReaderDataMart = {
  category: CategorySummary
  snapshot: SnapshotSummary
  previous?: SnapshotSummary
  yoy?: SnapshotSummary
  products: IndexedProduct[]
  productsByAsin: Map<string, IndexedProduct>
  productsByBrand: Map<string, IndexedProduct[]>
  brandSeries: Map<string, BrandHistoryPoint[]>
  asinHistoryByAsin: Map<string, AsinHistorySummary>
  brandHistoryByBrand: Map<string, BrandHistorySummary>
  brandTopAsinsByMonth: Map<string, BrandTopAsinPoint[]>
  brandLookup: Map<string, string>
  brandDisplayByKey: Map<string, string>
  productAliasToAsins: Map<string, string[]>
  typeMetrics: TypeBreakdownMetric[]
  priceScopeMetrics: TypeBreakdownMetric[]
  qualityWarnings: string[]
}

const CACHE_TTL_MS = 180_000

const martCache = new Map<
  string,
  {
    loadedAt: number
    value: CodeReaderDataMart | null
  }
>()

export function buildCodeReaderDataMart(
  category: CategorySummary,
  snapshotDate: string
): CodeReaderDataMart | null {
  const cacheKey = `${category.id}:${snapshotDate}`
  const now = Date.now()
  const cached = martCache.get(cacheKey)
  if (cached && now - cached.loadedAt <= CACHE_TTL_MS) {
    return cached.value
  }

  const sorted = [...category.snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const snapshot = sorted.find((item) => item.date === snapshotDate)
  if (!snapshot) {
    martCache.set(cacheKey, { loadedAt: now, value: null })
    return null
  }

  const previous = getPreviousSnapshot(sorted, snapshotDate)
  const yoy = getYoYSnapshot(sorted, snapshotDate)

  const currentProducts = extractSnapshotProducts(snapshot)
  const previousProducts = previous ? extractSnapshotProducts(previous) : new Map<string, ProductSummary>()

  const products = Array.from(currentProducts.values())
    .map((raw) => {
      const previousRaw = previousProducts.get(raw.asin)
      return {
        asin: raw.asin,
        title: raw.title,
        brand: raw.brand,
        type: raw.toolType || raw.subcategory || "Unknown",
        price: safeNumber(raw.avgPrice ?? raw.price),
        revenue: safeNumber(raw.monthlyRevenue ?? raw.revenue),
        units: safeNumber(raw.monthlyUnits ?? raw.units),
        rating: safeNumber(raw.toolRating ?? raw.rating),
        reviews: safeNumber(raw.reviewCount),
        url: raw.url,
        estimatedRevenue12mo: safeOptionalNumber(raw.estimatedRevenue12mo),
        estimatedUnits12mo: safeOptionalNumber(raw.estimatedUnits12mo),
        monthlyRevenue: safeOptionalNumber(raw.monthlyRevenue ?? raw.revenue),
        monthlyUnits: safeOptionalNumber(raw.monthlyUnits ?? raw.units),
        rankRevenue: 0,
        rankUnits: 0,
        revenueMoM: ratioDelta(
          safeNumber(raw.monthlyRevenue ?? raw.revenue),
          safeNumber(previousRaw?.monthlyRevenue ?? previousRaw?.revenue)
        ),
        unitsMoM: ratioDelta(
          safeNumber(raw.monthlyUnits ?? raw.units),
          safeNumber(previousRaw?.monthlyUnits ?? previousRaw?.units)
        ),
        priceMoM: ratioDelta(
          safeNumber(raw.avgPrice ?? raw.price),
          safeNumber(previousRaw?.avgPrice ?? previousRaw?.price)
        ),
        ratingMoM: safeNumber(raw.toolRating ?? raw.rating) - safeNumber(previousRaw?.toolRating ?? previousRaw?.rating),
        history: buildProductHistory(sorted, raw.asin),
      }
    })
    .sort((a, b) => b.revenue - a.revenue)

  products.forEach((item, index) => {
    item.rankRevenue = index + 1
  })
  ;[...products]
    .sort((a, b) => b.units - a.units)
    .forEach((item, index) => {
      const target = products.find((product) => product.asin === item.asin)
      if (target) target.rankUnits = index + 1
    })

  const productsByAsin = new Map(products.map((item) => [normalize(item.asin), item]))
  const productsByBrand = new Map<string, IndexedProduct[]>()
  for (const product of products) {
    const key = normalize(product.brand)
    const bucket = productsByBrand.get(key)
    if (bucket) {
      bucket.push(product)
    } else {
      productsByBrand.set(key, [product])
    }
  }
  for (const bucket of productsByBrand.values()) {
    bucket.sort((a, b) => b.revenue - a.revenue)
  }

  const brandSeries = buildBrandSeries(sorted)
  const asinHistoryByAsin = buildAsinHistoryByAsin(products)
  const brandHistoryByBrand = buildBrandHistoryByBrand(brandSeries)
  const brandTopAsinsByMonth = buildBrandTopAsinsByMonth(sorted)
  const { brandLookup, brandDisplayByKey } = buildBrandLookups(snapshot, products)
  const productAliasToAsins = buildProductAliasLookup(products)
  const typeMetrics = snapshot.typeBreakdowns?.allAsins ?? []
  const priceScopeMetrics = typeMetrics.filter((item) => isPriceScope(item.scopeKey))
  const qualityWarnings = (snapshot.qualityIssues ?? []).map((issue) => issue.message).slice(0, 8)

  const mart: CodeReaderDataMart = {
    category,
    snapshot,
    previous,
    yoy,
    products,
    productsByAsin,
    productsByBrand,
    brandSeries,
    asinHistoryByAsin,
    brandHistoryByBrand,
    brandTopAsinsByMonth,
    brandLookup,
    brandDisplayByKey,
    productAliasToAsins,
    typeMetrics,
    priceScopeMetrics,
    qualityWarnings,
  }

  martCache.set(cacheKey, {
    loadedAt: now,
    value: mart,
  })

  return mart
}

function extractSnapshotProducts(snapshot: SnapshotSummary) {
  const merged = new Map<string, ProductSummary>()

  for (const product of snapshot.top50ByUnits ?? []) {
    mergeProduct(merged, product)
  }
  for (const product of snapshot.topProducts ?? []) {
    mergeProduct(merged, product)
  }
  for (const listing of snapshot.brandSheetListings ?? []) {
    for (const product of listing.products) {
      mergeProduct(merged, product)
    }
  }

  return merged
}

function mergeProduct(map: Map<string, ProductSummary>, next: ProductSummary) {
  const key = normalize(next.asin)
  if (!key) return

  const existing = map.get(key)
  if (!existing) {
    map.set(key, { ...next })
    return
  }

  map.set(key, {
    ...existing,
    asin: pickRequiredString(existing.asin, next.asin),
    title: pickRequiredString(existing.title, next.title),
    brand: pickRequiredString(existing.brand, next.brand),
    toolType: pickString(existing.toolType, next.toolType),
    subcategory: pickString(existing.subcategory, next.subcategory),
    avgPrice: pickOptionalNumber(existing.avgPrice, next.avgPrice),
    price: pickNumber(existing.price, next.price),
    monthlyRevenue: pickOptionalNumber(existing.monthlyRevenue, next.monthlyRevenue),
    revenue: pickNumber(existing.revenue, next.revenue),
    monthlyUnits: pickOptionalNumber(existing.monthlyUnits, next.monthlyUnits),
    units: pickNumber(existing.units, next.units),
    estimatedRevenue12mo: pickOptionalNumber(existing.estimatedRevenue12mo, next.estimatedRevenue12mo),
    estimatedUnits12mo: pickOptionalNumber(existing.estimatedUnits12mo, next.estimatedUnits12mo),
    toolRating: pickOptionalNumber(existing.toolRating, next.toolRating),
    rating: pickNumber(existing.rating, next.rating),
    reviewCount: pickNumber(existing.reviewCount, next.reviewCount),
    url: pickString(existing.url, next.url),
  })
}

function buildProductHistory(sortedSnapshots: SnapshotSummary[], asin: string): ProductHistoryPoint[] {
  const key = normalize(asin)
  const history: ProductHistoryPoint[] = []

  for (const snapshot of sortedSnapshots) {
    const productMap = extractSnapshotProducts(snapshot)
    const product = productMap.get(key)
    if (!product) continue

    const rankRevenue = indexOfRank(snapshot.topProducts ?? [], product.asin)
    const rankUnits = indexOfRank(snapshot.top50ByUnits ?? [], product.asin)

    history.push({
      date: snapshot.date,
      revenue: safeNumber(product.monthlyRevenue ?? product.revenue),
      units: safeNumber(product.monthlyUnits ?? product.units),
      price: safeNumber(product.avgPrice ?? product.price),
      rating: safeNumber(product.toolRating ?? product.rating),
      reviews: safeNumber(product.reviewCount),
      rankRevenue,
      rankUnits,
    })
  }

  return history
}

function buildBrandSeries(sortedSnapshots: SnapshotSummary[]) {
  const output = new Map<string, BrandHistoryPoint[]>()

  for (const snapshot of sortedSnapshots) {
    const revenueRankMap = new Map<string, number>()
    const unitsRankMap = new Map<string, number>()

    snapshot.brandTotals
      .slice()
      .sort((a, b) => b.revenue - a.revenue)
      .forEach((row, index) => {
        revenueRankMap.set(normalize(row.brand), index + 1)
      })
    snapshot.brandTotals
      .slice()
      .sort((a, b) => b.units - a.units)
      .forEach((row, index) => {
        unitsRankMap.set(normalize(row.brand), index + 1)
      })

    const rollingRevenueMap = new Map(
      (snapshot.rolling12?.revenue?.brands ?? []).map((row) => [normalize(row.brand), row.grandTotal] as const)
    )
    const rollingUnitsMap = new Map(
      (snapshot.rolling12?.units?.brands ?? []).map((row) => [normalize(row.brand), row.grandTotal] as const)
    )

    for (const brand of snapshot.brandTotals) {
      const key = normalize(brand.brand)
      const item: BrandHistoryPoint = {
        date: snapshot.date,
        revenue: safeNumber(brand.revenue),
        units: safeNumber(brand.units),
        share: safeNumber(brand.share),
        rankRevenue: revenueRankMap.get(key) ?? null,
        rankUnits: unitsRankMap.get(key) ?? null,
        rolling12Revenue: rollingRevenueMap.get(key) ?? null,
        rolling12Units: rollingUnitsMap.get(key) ?? null,
      }
      const bucket = output.get(key)
      if (bucket) {
        bucket.push(item)
      } else {
        output.set(key, [item])
      }
    }
  }

  for (const series of output.values()) {
    series.sort((a, b) => a.date.localeCompare(b.date))
  }

  return output
}

function buildAsinHistoryByAsin(products: IndexedProduct[]) {
  const map = new Map<string, AsinHistorySummary>()
  for (const product of products) {
    const windows = buildWindows(product.history)
    const growthMoM = windows["1m"].revenueGrowthMoM ?? 0
    const growth3m = windows["3m"].revenueGrowthWindow ?? 0
    const growth6m = windows["6m"].revenueGrowthWindow ?? 0
    const fastestGrowthScore = clamp(growthMoM * 35 + growth3m * 40 + growth6m * 25, -100, 200)
    map.set(normalize(product.asin), {
      asin: product.asin,
      title: product.title,
      brand: product.brand,
      windows,
      fastestGrowthScore,
    })
  }
  return map
}

function buildBrandHistoryByBrand(seriesMap: Map<string, BrandHistoryPoint[]>) {
  const map = new Map<string, BrandHistorySummary>()
  for (const [brandKey, series] of seriesMap.entries()) {
    const windows = buildWindows(
      series.map((point) => ({
        date: point.date,
        revenue: point.revenue,
        units: point.units,
        price: point.units > 0 ? point.revenue / point.units : 0,
        rating: 0,
        reviews: 0,
        rankRevenue: point.rankRevenue,
        rankUnits: point.rankUnits,
      }))
    )
    const latest = series[series.length - 1]
    map.set(brandKey, {
      brand: brandKey,
      windows,
      currentShare: latest?.share ?? 0,
      currentRevenueRank: latest?.rankRevenue ?? null,
      currentUnitsRank: latest?.rankUnits ?? null,
    })
  }
  return map
}

function buildBrandTopAsinsByMonth(sortedSnapshots: SnapshotSummary[]) {
  const map = new Map<string, BrandTopAsinPoint[]>()

  for (const snapshot of sortedSnapshots) {
    const products = Array.from(extractSnapshotProducts(snapshot).values())
    const byBrand = new Map<string, ProductSummary[]>()
    for (const product of products) {
      const key = normalize(product.brand)
      const bucket = byBrand.get(key)
      if (bucket) {
        bucket.push(product)
      } else {
        byBrand.set(key, [product])
      }
    }

    for (const [brandKey, rows] of byBrand.entries()) {
      const topAsins = rows
        .sort((a, b) => safeNumber(b.monthlyRevenue ?? b.revenue) - safeNumber(a.monthlyRevenue ?? a.revenue))
        .slice(0, 3)
        .map((row) => ({
          asin: row.asin,
          title: row.title,
          revenue: safeNumber(row.monthlyRevenue ?? row.revenue),
          units: safeNumber(row.monthlyUnits ?? row.units),
        }))

      const point: BrandTopAsinPoint = {
        date: snapshot.date,
        topAsins,
      }
      const bucket = map.get(brandKey)
      if (bucket) {
        bucket.push(point)
      } else {
        map.set(brandKey, [point])
      }
    }
  }

  for (const points of map.values()) {
    points.sort((a, b) => a.date.localeCompare(b.date))
  }
  return map
}

function buildBrandLookups(snapshot: SnapshotSummary, products: IndexedProduct[]) {
  const brandDisplayByKey = new Map<string, string>()
  for (const row of snapshot.brandTotals) {
    const key = normalize(row.brand)
    if (!key || brandDisplayByKey.has(key)) continue
    brandDisplayByKey.set(key, row.brand)
  }
  for (const product of products) {
    const key = normalize(product.brand)
    if (!key || brandDisplayByKey.has(key)) continue
    brandDisplayByKey.set(key, product.brand)
  }

  const brandLookup = new Map<string, string>()
  for (const [brandKey, display] of brandDisplayByKey.entries()) {
    const aliases = buildBrandAliases(display, brandKey)
    for (const alias of aliases) {
      const existing = brandLookup.get(alias)
      if (!existing) {
        brandLookup.set(alias, brandKey)
        continue
      }
      // Protect Innova from being hijacked by similarly prefixed brand names.
      if (alias === "innova" && brandKey === "innova") {
        brandLookup.set(alias, brandKey)
      }
    }
  }

  return { brandLookup, brandDisplayByKey }
}

function buildBrandAliases(display: string, brandKey: string) {
  const aliases = new Set<string>()
  aliases.add(brandKey)
  aliases.add(normalize(display))
  for (const token of display.toLowerCase().split(/[^a-z0-9]+/g)) {
    if (token.length >= 4 && !BRAND_ALIAS_STOPWORDS.has(token)) aliases.add(token)
  }
  if (brandKey === "innova") aliases.add("innova")
  if (brandKey === "blcktec") {
    aliases.add("blcktec")
    aliases.add("blacktec")
    aliases.add("blcktek")
  }
  return aliases
}

const PINNED_PRODUCT_ALIASES: Record<string, string> = {
  innova5610: "B07Z481NJM",
  "5610innova": "B07Z481NJM",
}

const BRAND_ALIAS_STOPWORDS = new Set([
  "product",
  "products",
  "tool",
  "tools",
  "scanner",
  "scanners",
  "diagnostic",
  "solutions",
  "america",
  "global",
  "system",
  "systems",
])

function buildProductAliasLookup(products: IndexedProduct[]) {
  const aliasToAsins = new Map<string, Set<string>>()

  const addAlias = (alias: string, asin: string) => {
    const key = normalize(alias)
    if (!key || key.length < 4) return
    const asinCode = asin.toUpperCase()
    const bucket = aliasToAsins.get(key)
    if (bucket) bucket.add(asinCode)
    else aliasToAsins.set(key, new Set([asinCode]))
  }

  for (const product of products) {
    const asin = product.asin.toUpperCase()
    addAlias(product.asin, asin)

    const compactBrand = normalize(product.brand)
    const titleTokens = `${product.brand} ${product.title}`
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter(Boolean)

    for (const token of titleTokens) {
      if (token.length >= 3 && /[0-9]/.test(token)) {
        addAlias(`${compactBrand}${token}`, asin)
        addAlias(`${token}${compactBrand}`, asin)
      }
    }
  }

  for (const [alias, pinnedAsin] of Object.entries(PINNED_PRODUCT_ALIASES)) {
    addAlias(alias, pinnedAsin)
  }

  return new Map(Array.from(aliasToAsins.entries()).map(([alias, set]) => [alias, Array.from(set)] as const))
}

function buildWindows(points: ProductHistoryPoint[]): Record<HistoryWindowKey, HistoryWindowSummary> {
  return {
    "1m": summarizeWindow(points, 1),
    "3m": summarizeWindow(points, 3),
    "6m": summarizeWindow(points, 6),
    "12m": summarizeWindow(points, 12),
    all: summarizeWindow(points, Number.POSITIVE_INFINITY),
  }
}

function summarizeWindow(points: ProductHistoryPoint[], windowSize: number): HistoryWindowSummary {
  const source = Number.isFinite(windowSize)
    ? points.slice(-windowSize)
    : points.slice()
  const months = source.length
  if (!months) {
    return {
      months: 0,
      revenue: 0,
      units: 0,
      asp: 0,
      avgRating: 0,
      revenueGrowthMoM: null,
      revenueGrowthWindow: null,
      trend: "flat",
    }
  }

  const revenue = source.reduce((sum, point) => sum + safeNumber(point.revenue), 0)
  const units = source.reduce((sum, point) => sum + safeNumber(point.units), 0)
  const asp = units > 0 ? revenue / units : average(source.map((point) => safeNumber(point.price)))
  const avgRating = average(source.map((point) => safeNumber(point.rating)).filter((value) => value > 0))

  const latest = source[source.length - 1]
  const prev = source[source.length - 2]
  const first = source[0]

  const revenueGrowthMoM = prev && prev.revenue > 0
    ? (latest.revenue - prev.revenue) / prev.revenue
    : null
  const revenueGrowthWindow = first && first.revenue > 0
    ? (latest.revenue - first.revenue) / first.revenue
    : null

  const trend = trendFromGrowth(revenueGrowthWindow)

  return {
    months,
    revenue,
    units,
    asp,
    avgRating: Number.isFinite(avgRating) ? avgRating : 0,
    revenueGrowthMoM,
    revenueGrowthWindow,
    trend,
  }
}

function getPreviousSnapshot(sortedSnapshots: SnapshotSummary[], snapshotDate: string) {
  const index = sortedSnapshots.findIndex((item) => item.date === snapshotDate)
  if (index <= 0) return undefined
  return sortedSnapshots[index - 1]
}

function getYoYSnapshot(sortedSnapshots: SnapshotSummary[], snapshotDate: string) {
  const date = new Date(`${snapshotDate}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return undefined
  date.setUTCFullYear(date.getUTCFullYear() - 1)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0")
  const yoyKey = `${date.getUTCFullYear()}-${month}-01`
  return sortedSnapshots.find((item) => item.date === yoyKey)
}

function indexOfRank(source: ProductSummary[], asin: string) {
  if (!source.length || !asin) return null
  const idx = source.findIndex((item) => normalize(item.asin) === normalize(asin))
  return idx < 0 ? null : idx + 1
}

function pickString(current?: string, next?: string) {
  if (next && next.trim()) return next
  return current
}

function pickRequiredString(current?: string, next?: string) {
  return pickString(current, next) ?? ""
}

function pickNumber(current: number, next: number) {
  return safeNumber(next) > 0 ? safeNumber(next) : safeNumber(current)
}

function pickOptionalNumber(current?: number, next?: number) {
  if (typeof next === "number" && Number.isFinite(next) && next > 0) return next
  if (typeof current === "number" && Number.isFinite(current)) return current
  return undefined
}

function safeNumber(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function safeOptionalNumber(value: unknown) {
  const numeric = Number(value ?? Number.NaN)
  return Number.isFinite(numeric) ? numeric : undefined
}

function ratioDelta(current: number, previous: number) {
  if (!previous) return null
  return (current - previous) / previous
}

function isPriceScope(scopeKey: string) {
  return /(tablet|handheld|dongle|other)/.test(normalize(scopeKey))
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + safeNumber(value), 0) / values.length
}

function trendFromGrowth(value: number | null): "up" | "down" | "flat" {
  if (value === null) return "flat"
  if (value >= 0.08) return "up"
  if (value <= -0.08) return "down"
  return "flat"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
