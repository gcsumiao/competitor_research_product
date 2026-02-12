import type { CategorySummary, SnapshotSummary } from "@/lib/competitor-data"

import type {
  ChatIntent,
  EvidenceItem,
  ProactiveSuggestion,
  ChatResponse,
} from "@/lib/chatbot/types"
import type {
  NormalizedCategoryData,
  NormalizedBrandSummary,
  NormalizedProduct,
  NormalizedTypeMix,
} from "@/lib/chatbot/category-normalizers"

type BuildIntentParams = {
  message: string
  intent: ChatIntent
  category: CategorySummary
  snapshot: SnapshotSummary
  snapshots: SnapshotSummary[]
  data: NormalizedCategoryData
  proactive: ProactiveSuggestion[]
  suggestedQuestions: string[]
}

type TrendContext = {
  prevRevenueDelta: number | null
  prevUnitDelta: number | null
  yoyRevenueDelta: number | null
}

const CLARIFICATION_HINTS: Array<{ pattern: RegExp; answer: string; bullets: string[] }> = [
  {
    pattern: /(revenue.*estimate|estimated|actual sales|helium)/i,
    answer:
      "These dashboard values are modeled/estimated market metrics from report workbooks, not direct seller-account transaction exports.",
    bullets: [
      "Use trend direction and relative share for decisions, not accounting-grade exact totals.",
      "Compare numbers within the same report pipeline for consistency.",
    ],
  },
  {
    pattern: /(other.*include|other category|other type)/i,
    answer:
      "\"Other\" aggregates long-tail products or types that are outside explicitly broken-out buckets in the source workbook.",
    bullets: [
      "The exact composition can change month to month with listing mix.",
      "Use type and price filters to narrow into named segments.",
    ],
  },
  {
    pattern: /(1p|3p|first party|third party)/i,
    answer:
      "1P/3P split needs fulfillment-channel data. This category dataset currently does not include a reliable monthly channel breakout.",
    bullets: [
      "If fulfillment fields are added upstream, the chatbot can include this split in the response.",
    ],
  },
]

export function detectCapabilities(data: NormalizedCategoryData): ChatIntent[] {
  const capabilities: ChatIntent[] = []

  if (data.marketRevenue > 0 || data.marketUnits > 0) {
    capabilities.push("market_size", "market_leader")
  }
  if (data.topByRevenue.length > 0) {
    capabilities.push("top_products", "price_range")
  }
  if (data.typeMix.length > 0) {
    capabilities.push("product_type_mix", "price_volume_tradeoff", "competitive_gaps")
  }
  if (data.brands.length >= 2) {
    capabilities.push("brand_comparison", "market_concentration")
  }
  if (data.topByRevenue.some((row) => row.rating > 0) || data.brands.some((row) => row.avgRating > 0)) {
    capabilities.push("rating_reviews")
  }
  if (data.featurePremiums.length > 0) {
    capabilities.push("feature_analysis")
  }

  capabilities.push("trends_momentum", "data_clarification")
  return unique(capabilities)
}

export function mapLegacyIntent(intent: ChatIntent): ChatIntent {
  if (intent === "self_assessment") return "market_size"
  if (intent === "competitive_benchmarking") return "brand_comparison"
  if (intent === "risk_threat") return "market_concentration"
  if (intent === "growth_opportunity") return "competitive_gaps"
  return intent
}

export function buildCategoryIntentResponse({
  message,
  intent,
  category,
  snapshot,
  snapshots,
  data,
  proactive,
  suggestedQuestions,
}: BuildIntentParams): ChatResponse {
  const mappedIntent = mapLegacyIntent(intent)
  const capabilities = detectCapabilities(data)
  const resolvedIntent = capabilities.includes(mappedIntent) ? mappedIntent : fallbackIntent(capabilities)
  const trends = computeTrendContext(snapshot, snapshots)
  const evidenceBase = buildBaseEvidence(data, snapshot)

  if (resolvedIntent === "data_clarification") {
    const clarification = findClarification(message)
    return {
      intent: resolvedIntent,
      answer:
        clarification?.answer ??
        "I can clarify how each metric is computed and why month-to-month changes can diverge from absolute revenue movement.",
      bullets:
        clarification?.bullets ?? [
          "Market share can move up when the total market shrinks faster than your brand.",
          "Different source workbooks can include different listing coverage and segmentation.",
        ],
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "market_size") {
    return {
      intent: resolvedIntent,
      answer:
        `Current market size for ${category.label}: ${currencyCompact(data.marketRevenue)} revenue and ` +
        `${numberCompact(data.marketUnits)} units.`,
      bullets: [
        `Annualized run-rate from current month: ${currencyCompact(data.marketRevenue * 12)}.`,
        trendLine(trends.prevRevenueDelta, "Revenue vs prior snapshot"),
        trendLine(trends.prevUnitDelta, "Units vs prior snapshot"),
      ],
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "market_leader") {
    const leader = data.brands[0]
    return {
      intent: resolvedIntent,
      answer: leader
        ? `${leader.brand} leads this month with ${currencyCompact(leader.revenue)} revenue and ${percent(leader.share)} share.`
        : "No brand leaderboard could be computed from the current data coverage.",
      bullets: data.brands.slice(0, 5).map((brand, index) => {
        const rank = index + 1
        return `#${rank} ${brand.brand}: ${currencyCompact(brand.revenue)} (${percent(brand.share)} share)`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "price_range") {
    const priceStats = summarizePrices(data.topByRevenue)
    return {
      intent: resolvedIntent,
      answer:
        `Observed price range is ${currency(priceStats.min)} to ${currency(priceStats.max)} ` +
        `with median ${currency(priceStats.median)} and average ${currency(priceStats.avg)}.`,
      bullets: data.priceTiers.slice(0, 4).map((tier) => {
        return `${tier.tier}: ${percent(tier.revenueShare)} revenue share (${currencyCompact(tier.revenue)}).`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "top_products") {
    const prefersUnits = /(units|volume|sold)/i.test(message)
    const source = prefersUnits ? data.topByUnits : data.topByRevenue
    return {
      intent: resolvedIntent,
      answer: prefersUnits
        ? "Top products by monthly units are listed below."
        : "Top products by monthly revenue are listed below.",
      bullets: source.slice(0, 6).map((item, index) => {
        return `#${index + 1} ${item.brand} ${truncate(item.title, 80)} - ${currencyCompact(item.revenue)} / ${numberCompact(item.units)} units`
      }),
      evidence: [
        ...evidenceBase,
        { label: "Top SKU", value: source[0] ? truncate(source[0].title, 42) : "n/a" },
      ],
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "product_type_mix") {
    return {
      intent: resolvedIntent,
      answer: "Type-level market mix is shown from the highest-coverage summary available in this category workbook.",
      bullets: data.typeMix.slice(0, 6).map((row) => {
        return `${row.type}: ${percent(row.revenueShare)} revenue share and ${percent(row.unitShare)} unit share.`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "price_volume_tradeoff") {
    const strongest = strongestPriceVolumeTradeoff(data.typeMix)
    return {
      intent: resolvedIntent,
      answer: strongest
        ? `${strongest.type} shows the largest price-volume tradeoff signal.`
        : "No strong price-volume imbalance signal was detected.",
      bullets: data.typeMix.slice(0, 6).map((row) => {
        const score = row.unitShare - row.revenueShare
        return `${row.type}: unit-share minus revenue-share = ${signedPercent(score)}.`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "brand_comparison") {
    const compared = selectComparedBrands(message, data.brands)
    return {
      intent: resolvedIntent,
      answer:
        compared.length >= 2
          ? `Brand comparison: ${compared[0].brand} vs ${compared[1].brand}.`
          : "Brand comparison requires at least two brands with measurable coverage.",
      bullets: compared.slice(0, 4).map((brand) => {
        return `${brand.brand}: ${currencyCompact(brand.revenue)} revenue, ${numberCompact(brand.units)} units, ${percent(brand.share)} share.`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "feature_analysis") {
    const topFeature = data.featurePremiums[0]
    return {
      intent: resolvedIntent,
      answer: topFeature
        ? `${topFeature.feature} has a ${signedPercent(topFeature.premiumPct)} price premium in this dataset.`
        : "Feature premium analysis is unavailable for this snapshot.",
      bullets: data.featurePremiums.slice(0, 5).map((feature) => {
        return `${feature.feature}: with-feature avg ${currency(feature.withFeatureAvgPrice)} vs without-feature avg ${currency(feature.withoutFeatureAvgPrice)} (${signedPercent(feature.premiumPct)}).`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "competitive_gaps") {
    const gaps = buildCompetitiveGapSignals(data.topByRevenue, data.marketRevenue)
    return {
      intent: resolvedIntent,
      answer: gaps[0] ?? "No high-confidence gap signal was detected with the current data coverage.",
      bullets: gaps.slice(1, 6),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "trends_momentum") {
    return {
      intent: resolvedIntent,
      answer:
        `Momentum snapshot: revenue ${formatPercentChange(trends.prevRevenueDelta)} vs prior month, ` +
        `units ${formatPercentChange(trends.prevUnitDelta)} vs prior month.`,
      bullets: [
        trendLine(trends.prevRevenueDelta, "MoM revenue change"),
        trendLine(trends.prevUnitDelta, "MoM unit change"),
        trendLine(trends.yoyRevenueDelta, "YoY revenue change"),
      ],
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "rating_reviews") {
    const topRated = data.topByRevenue
      .filter((row) => row.rating > 0)
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 5)
    return {
      intent: resolvedIntent,
      answer:
        "Rating/review quality snapshot highlights products and brands combining strong ratings with meaningful revenue.",
      bullets: topRated.map((row) => {
        return `${row.brand} ${truncate(row.title, 64)}: ${row.rating.toFixed(1)}★, ${numberCompact(row.reviews)} reviews, ${currencyCompact(row.revenue)} revenue.`
      }),
      evidence: evidenceBase,
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  if (resolvedIntent === "market_concentration") {
    const top3Revenue = data.brands.slice(0, 3).reduce((sum, row) => sum + row.revenue, 0)
    const top3Share = data.marketRevenue > 0 ? top3Revenue / data.marketRevenue : 0
    const concentrationLabel =
      top3Share >= 0.7 ? "highly concentrated" : top3Share >= 0.45 ? "moderately concentrated" : "fragmented"
    return {
      intent: resolvedIntent,
      answer: `Top-3 brands hold ${percent(top3Share)} of revenue, indicating a ${concentrationLabel} market.`,
      bullets: data.brands.slice(0, 5).map((row, index) => {
        return `#${index + 1} ${row.brand}: ${percent(row.share)} share`
      }),
      evidence: [
        ...evidenceBase,
        { label: "Top 3 Share", value: percent(top3Share) },
      ],
      proactive,
      suggestedQuestions,
      warnings: data.warnings,
      capabilities,
      dataCoverage: data.dataCoverage,
    }
  }

  return {
    intent: "unknown",
    answer:
      "I can answer market size, leader, product mix, top-product, pricing, feature, and concentration questions for this category.",
    bullets: [
      "Try asking for market size, brand leader, or top products.",
      "You can also ask for feature premiums or competitive gaps when supported by the workbook schema.",
    ],
    evidence: evidenceBase,
    proactive,
    suggestedQuestions,
    warnings: data.warnings,
    capabilities,
    dataCoverage: data.dataCoverage,
  }
}

function fallbackIntent(capabilities: ChatIntent[]): ChatIntent {
  if (capabilities.includes("market_size")) return "market_size"
  return "unknown"
}

function computeTrendContext(snapshot: SnapshotSummary, snapshots: SnapshotSummary[]): TrendContext {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const index = sorted.findIndex((row) => row.date === snapshot.date)
  const previous = index > 0 ? sorted[index - 1] : null
  const yoy = sorted.find((row) => shiftYear(row.date, 1) === snapshot.date)

  return {
    prevRevenueDelta: ratio(snapshot.totals.revenue, previous?.totals.revenue),
    prevUnitDelta: ratio(snapshot.totals.units, previous?.totals.units),
    yoyRevenueDelta: ratio(snapshot.totals.revenue, yoy?.totals.revenue),
  }
}

function buildBaseEvidence(data: NormalizedCategoryData, snapshot: SnapshotSummary): EvidenceItem[] {
  return [
    { label: "Category", value: data.categoryLabel },
    { label: "Snapshot", value: snapshot.date },
    { label: "Revenue", value: currencyCompact(data.marketRevenue) },
    { label: "Units", value: numberCompact(data.marketUnits) },
    { label: "Source", value: data.dataCoverage.sourceLabel },
  ]
}

function summarizePrices(products: NormalizedProduct[]) {
  const prices = products.map((row) => row.price).filter((value) => value > 0).sort((a, b) => a - b)
  if (!prices.length) {
    return { min: 0, max: 0, avg: 0, median: 0 }
  }
  const min = prices[0]
  const max = prices[prices.length - 1]
  const avg = prices.reduce((sum, value) => sum + value, 0) / prices.length
  const middle = Math.floor(prices.length / 2)
  const median =
    prices.length % 2 === 0 ? (prices[middle - 1] + prices[middle]) / 2 : prices[middle]
  return { min, max, avg, median }
}

function strongestPriceVolumeTradeoff(typeMix: NormalizedTypeMix[]) {
  return [...typeMix]
    .sort(
      (a, b) =>
        Math.abs(b.unitShare - b.revenueShare) - Math.abs(a.unitShare - a.revenueShare)
    )[0]
}

function selectComparedBrands(message: string, brands: NormalizedBrandSummary[]) {
  const normalized = normalize(message)
  const explicit = brands.filter((brand) =>
    normalized.includes(normalize(brand.brand))
  )
  if (explicit.length >= 2) return explicit.slice(0, 2)
  return brands.slice(0, 2)
}

function buildCompetitiveGapSignals(products: NormalizedProduct[], marketRevenue: number) {
  const byCluster = new Map<string, { revenue: number; units: number; brands: Set<string> }>()
  for (const row of products) {
    const typeKey = normalize(row.type || "unknown")
    const bucket = priceBucket(row.price)
    const key = `${typeKey}|${bucket}`
    const entry = byCluster.get(key) ?? { revenue: 0, units: 0, brands: new Set<string>() }
    entry.revenue += row.revenue
    entry.units += row.units
    entry.brands.add(row.brand)
    byCluster.set(key, entry)
  }

  const ranked = Array.from(byCluster.entries())
    .map(([key, value]) => {
      const [typeKey, bucket] = key.split("|")
      const share = marketRevenue > 0 ? value.revenue / marketRevenue : 0
      return {
        key,
        label: `${restoreLabel(typeKey)} @ ${bucket}`,
        share,
        brands: value.brands.size,
        revenue: value.revenue,
      }
    })
    .sort((a, b) => b.share - a.share)

  return ranked
    .filter((item) => item.share >= 0.08)
    .slice(0, 5)
    .map((item) => {
      return `${item.label}: ${percent(item.share)} of revenue across ${item.brands} brands (${currencyCompact(item.revenue)}).`
    })
}

function findClarification(message: string) {
  for (const item of CLARIFICATION_HINTS) {
    if (item.pattern.test(message)) {
      return item
    }
  }
  return null
}

function shiftYear(dateText: string, deltaYears: number) {
  const date = new Date(`${dateText}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ""
  date.setUTCFullYear(date.getUTCFullYear() + deltaYears)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0")
  const day = `${date.getUTCDate()}`.padStart(2, "0")
  return `${date.getUTCFullYear()}-${month}-${day}`
}

function ratio(current: number, previous?: number | null) {
  if (!previous || previous === 0) return null
  return (current - previous) / previous
}

function trendLine(value: number | null, label: string) {
  return `${label}: ${formatPercentChange(value)}`
}

function formatPercentChange(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a"
  const sign = value > 0 ? "+" : ""
  return `${sign}${(value * 100).toFixed(1)}%`
}

function signedPercent(value: number) {
  const sign = value > 0 ? "+" : ""
  return `${sign}${(value * 100).toFixed(1)}%`
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(value)
}

function currencyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function numberCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function percent(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value)
}

function truncate(value: string, length: number) {
  if (value.length <= length) return value
  return `${value.slice(0, Math.max(0, length - 1))}…`
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function restoreLabel(value: string) {
  if (!value) return "Unknown"
  return value.replace(/(^\w|_\w)/g, (chunk) => chunk.replace("_", " ").toUpperCase())
}

function priceBucket(price: number) {
  if (price < 75) return "<$75"
  if (price < 200) return "$75-$199"
  if (price < 400) return "$200-$399"
  return "$400+"
}

function unique(values: ChatIntent[]) {
  return Array.from(new Set(values))
}
