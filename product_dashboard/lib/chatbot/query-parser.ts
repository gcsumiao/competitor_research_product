import { detectIntent } from "@/lib/chatbot/intents"
import type {
  ChatIntent,
  GrowthWindow,
  HistoricalWindow,
  ProductTypeScope,
  QueryPlan,
  RankingMetric,
  RankingTarget,
  TargetLevel,
} from "@/lib/chatbot/types"
import type { CategoryId } from "@/lib/competitor-data"

export type QueryScope = {
  compareToLastMonth: boolean
  compareToMarket: boolean
  requiresTypeScope: boolean
  requiresPriceScope: boolean
}

export type ParsedQuery = {
  raw: string
  normalized: string
  intent: ChatIntent
  confidence: number
  scope: QueryScope
  plan: QueryPlan
}

export function parseQuery(message: string, categoryId: CategoryId): ParsedQuery {
  const normalized = message.toLowerCase().trim()
  const detected = detectIntent(message, categoryId)

  const forced = forceIntentFromPattern(normalized)
  const intent = forced?.intent ?? detected.intent
  const confidence = forced?.confidence ?? detected.confidence

  const rankingMetric = inferRankingMetric(normalized)
  const rankingTarget = inferRankingTarget(normalized, rankingMetric)
  const historicalWindow = inferHistoricalWindow(normalized)
  const growthWindow = inferGrowthWindow(normalized)
  const typeScope = inferTypeScope(normalized)
  const scopeBrands = inferExplicitScopeBrands(normalized)
  const targetLevel = inferTargetLevel(normalized, {
    scopeBrands,
    typeScope,
  })
  const includeOwnBrands = /\b(our|ours|we|us)\b/.test(normalized)
  const mentionsAllBrands = /\b(all brands|overall market|across brands|entire market)\b/.test(normalized)

  return {
    raw: message,
    normalized,
    intent,
    confidence,
    scope: {
      compareToLastMonth: /\b(last month|mom|month over month|vs last)\b/.test(normalized),
      compareToMarket: /\b(vs market|market average|market share|market)\b/.test(normalized),
      requiresTypeScope: Boolean(typeScope) || /\b(type|segment)\b/.test(normalized),
      requiresPriceScope: /\b(price|tier|\$|budget|premium)\b/.test(normalized),
    },
    plan: {
      raw: message,
      normalized,
      intent,
      scopeMode: scopeBrands.length ? "explicit_brand" : undefined,
      scopeBrands,
      includeOwnBrands,
      mentionsAllBrands,
      rankingMetric,
      historicalWindow,
      growthWindow,
      rankingTarget,
      targetLevel,
      typeScope,
    },
  }
}

function forceIntentFromPattern(
  normalized: string
): { intent: ChatIntent; confidence: number } | null {
  if (
    /\b(price tier|price tiers|pricing tier|pricing tiers)\b/.test(normalized) &&
    /\b(fastest|grow|growth|rising|increase)\b/.test(normalized)
  ) {
    return { intent: "price_range", confidence: 0.93 }
  }
  if (/\b(product should we prioritize|prioritize in this segment|prioritise in this segment)\b/.test(normalized)) {
    return { intent: "opportunity_signal", confidence: 0.88 }
  }
  if (/\b(lower competitive density|competitive density|lower competition)\b/.test(normalized)) {
    return { intent: "competitive_gaps", confidence: 0.86 }
  }
  if (
    /\b(strongest competitors|top competitors|main competitors)\b/.test(normalized) &&
    /\b(segment|type|tier)\b/.test(normalized)
  ) {
    return { intent: "brand_comparison", confidence: 0.88 }
  }
  if (
    /\b(driving most of this growth|drivers? of growth|what is driving growth|what drives growth)\b/.test(
      normalized
    )
  ) {
    return { intent: "price_vs_volume_explainer", confidence: 0.9 }
  }
  if (
    /\b(rising stars?|rising fastest|strongest momentum|trend acceleration|trend reversal|rank shifts?)\b/.test(
      normalized
    )
  ) {
    return { intent: "trends_momentum", confidence: 0.86 }
  }
  if (
    /\b(biggest competitor|main competitor|closest competitor|compete against|alternative to)\b/.test(
      normalized
    )
  ) {
    return { intent: "product_competitor", confidence: 0.92 }
  }
  if (
    /\b(top sku|top\s*(1|one)\s*(sku|product|asin|scanner)|top product|best seller|#1 product)\b/.test(
      normalized
    )
  ) {
    return { intent: "top_products", confidence: 0.95 }
  }
  if (
    /\b(how did .* perform|how .* performed|performance of .* last month|how is .* performing)\b/.test(
      normalized
    ) &&
    !/\b(asin|sku|model|b0[a-z0-9]{8})\b/.test(normalized)
  ) {
    return { intent: "brand_health", confidence: 0.9 }
  }
  if (/\b(fastest mover|fast mover|moving fastest|biggest mover)\b/.test(normalized)) {
    return { intent: "fastest_mover", confidence: 0.9 }
  }
  if (
    /\b(fastest growth|growing fastest|grew fastest|grew the most|highest mom|highest yoy|fastest growing|growth leader)\b/.test(
      normalized
    )
  ) {
    return { intent: "fastest_mover", confidence: 0.9 }
  }
  if (
    /\b(fastest rank mover|rank moved most|biggest rank jump|rank improvement|rank mover|closing the gap fastest)\b/.test(
      normalized
    )
  ) {
    return { intent: "market_shift", confidence: 0.9 }
  }
  if (
    /\b(due to price|due to units|driven by price|driven by units|price or units|unit driven|price driven)\b/.test(
      normalized
    )
  ) {
    return { intent: "price_vs_volume_explainer", confidence: 0.92 }
  }
  if (
    /\b(top asins|asin history|past performance|historical performance|history of)\b/.test(normalized)
  ) {
    return { intent: "asin_history", confidence: 0.88 }
  }
  if (
    /\b(high price.*low units|low price.*high units|price led|volume led|price vs volume)\b/.test(
      normalized
    )
  ) {
    return { intent: "price_vs_volume_explainer", confidence: 0.9 }
  }
  if (/\b(why is .*performing|why .*performing well|how is .*performing)\b/.test(normalized)) {
    return { intent: "brand_archetype", confidence: 0.83 }
  }
  if (/\b(product trend|trend for|how .*perform|performance of|grew|declined)\b/.test(normalized)) {
    return { intent: "product_trend", confidence: 0.84 }
  }
  if (/\b(brand health|how did (innova|blcktec) do|our brand)\b/.test(normalized)) {
    return { intent: "brand_health", confidence: 0.88 }
  }
  if (/\b(shift|moving|moved|who moved|market changed)\b/.test(normalized)) {
    return { intent: "market_shift", confidence: 0.8 }
  }
  if (/\b(risk|worried|threat|alert)\b/.test(normalized)) {
    return { intent: "risk_signal", confidence: 0.82 }
  }
  if (/\b(opportunity|whitespace|where to grow|opening)\b/.test(normalized)) {
    return { intent: "opportunity_signal", confidence: 0.82 }
  }
  return null
}

function inferRankingMetric(normalized: string): RankingMetric {
  if (/\b(unit|units|volume)\b/.test(normalized)) {
    return "units"
  }
  return "revenue"
}

function inferRankingTarget(
  normalized: string,
  rankingMetric: RankingMetric
): RankingTarget {
  if (/\b(units rank|rank by units|unit rank)\b/.test(normalized)) {
    return "units_rank"
  }
  if (/\b(revenue rank|rank by revenue|sales rank)\b/.test(normalized)) {
    return "revenue_rank"
  }
  if (/\b(overall rank|overall ranking)\b/.test(normalized)) {
    return "overall_rank"
  }
  return rankingMetric === "units" ? "units_rank" : "revenue_rank"
}

function inferGrowthWindow(normalized: string): GrowthWindow {
  if (/\b(mom.*yoy|yoy.*mom|month over month.*year over year|both)\b/.test(normalized)) {
    return "both"
  }
  if (/\b(yoy|year over year|same month last year)\b/.test(normalized)) {
    return "yoy"
  }
  if (/\b(mom|month over month|last month|vs last)\b/.test(normalized)) {
    return "mom"
  }
  return "mom"
}

function inferHistoricalWindow(normalized: string): HistoricalWindow {
  if (/\b(all time|full history|entire history)\b/.test(normalized)) return "all"
  if (/\b12\s*(m|mo|month)|12-month|12 month|1 year|one year|yoy\b/.test(normalized)) return "12m"
  if (/\b6\s*(m|mo|month)|6-month|6 month\b/.test(normalized)) return "6m"
  if (/\b3\s*(m|mo|month)|3-month|3 month|quarter\b/.test(normalized)) return "3m"
  if (/\b(last month|mom|month over month|vs last)\b/.test(normalized)) return "1m"
  return "12m"
}

function inferTypeScope(normalized: string): ProductTypeScope | undefined {
  if (/\btablet(s)?\b/.test(normalized)) return "tablet"
  if (/\bhandheld(s)?\b/.test(normalized)) return "handheld"
  if (/\bdongle(s)?\b/.test(normalized)) return "dongle"
  if (/\bother tools?\b|\bother tool\b/.test(normalized)) return "other_tools"
  return undefined
}

function inferTargetLevel(
  normalized: string,
  params: { scopeBrands: string[]; typeScope?: ProductTypeScope }
): TargetLevel {
  if (params.typeScope) return "type"
  if (/\bmarket|overall|across all brands|entire market\b/.test(normalized)) return "market"
  if (/\b[A-Z0-9]{8,10}\b/i.test(normalized) || /\b(asin|sku|model|product)\b/.test(normalized)) {
    return "asin"
  }
  if (params.scopeBrands.length > 0) return "brand"
  if (/\bbrand|company|competitor\b/.test(normalized)) return "brand"
  return "brand"
}

function inferExplicitScopeBrands(normalized: string): string[] {
  const brands = new Set<string>()
  if (/\binnova\b/.test(normalized)) brands.add("innova")
  if (/\bblcktec\b|\bblck\s*tek\b|\bblacktec\b/.test(normalized)) brands.add("blcktec")
  if (/\btopdon\b/.test(normalized)) brands.add("topdon")
  if (/\bxtool\b/.test(normalized)) brands.add("xtool")
  if (/\botofix\b/.test(normalized)) brands.add("otofix")
  if (/\bautel\b/.test(normalized)) brands.add("autel")
  if (/\bancel\b/.test(normalized)) brands.add("ancel")
  if (/\bfoxwell\b/.test(normalized)) brands.add("foxwell")
  if (/\bicarsoft\b/.test(normalized)) brands.add("icarsoft")
  if (/\bobdlink\b/.test(normalized)) brands.add("obdlink")
  if (/\bbluedriver\b|\bblue driver\b/.test(normalized)) brands.add("bluedriver")
  return Array.from(brands)
}
