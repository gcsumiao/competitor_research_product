import type { ParsedQuery } from "@/lib/chatbot/query-parser"
import type { EntityResolution } from "@/lib/chatbot/entity-resolver"
import type { ChatIntent } from "@/lib/chatbot/types"

export type AnalyzerId =
  | "fastest_growth"
  | "fastest_rank_mover"
  | "type_growth"
  | "growth_driver"
  | "fastest_mover"
  | "asin_history"
  | "brand_archetype"
  | "price_vs_volume_explainer"
  | "product_competitor"
  | "product_trend"
  | "brand_health"
  | "market_shift"
  | "risk_signal"
  | "opportunity_signal"
  | "top_products"
  | "market_size"
  | "market_leader"
  | "price_range"
  | "product_type_mix"
  | "price_volume_tradeoff"
  | "brand_comparison"
  | "feature_analysis"
  | "competitive_gaps"
  | "trends_momentum"
  | "rating_reviews"
  | "market_concentration"
  | "data_clarification"
  | "unknown"

export type IntentRoute = {
  analyzer: AnalyzerId
  clarificationQuestion?: string
}

export function routeIntent(parsed: ParsedQuery, resolution: EntityResolution): IntentRoute {
  if (parsed.plan.intent === "top_products") {
    return { analyzer: "top_products" }
  }

  if (isPriceTierGrowthQuestion(parsed.normalized)) {
    return { analyzer: "price_range" }
  }

  if (isGrowthDriverQuestion(parsed.normalized)) {
    return { analyzer: "growth_driver" }
  }

  if (isFastestRankMoverQuestion(parsed.normalized)) {
    return { analyzer: "fastest_rank_mover" }
  }

  if (isFastestGrowthQuestion(parsed.normalized)) {
    if (parsed.plan.targetLevel === "type" || parsed.plan.typeScope) {
      return { analyzer: "type_growth" }
    }
    return { analyzer: "fastest_growth" }
  }

  const forced = forceAnalyzer(parsed.intent, parsed.normalized)
  if (forced) {
    if (forced === "product_competitor" && !resolution.matchedProducts.length) {
      return {
        analyzer: "unknown",
        clarificationQuestion:
          "Which product should I compare? You can provide ASIN, for example: 'Compare B08XYZ1234 competitors'.",
      }
    }
    return { analyzer: forced }
  }

  if (resolution.ambiguous && resolution.clarificationQuestion) {
    return {
      analyzer: "unknown",
      clarificationQuestion: resolution.clarificationQuestion,
    }
  }

  return {
    analyzer: mapIntentToAnalyzer(parsed.intent),
  }
}

function forceAnalyzer(intent: ChatIntent, normalized: string): AnalyzerId | null {
  if (
    /\b(price tier|price tiers|pricing tier|pricing tiers)\b/.test(normalized) &&
    /\b(fastest|grow|growth|rising|increase)\b/.test(normalized)
  ) {
    return "price_range"
  }
  if (/\b(product should we prioritize|prioritize in this segment|prioritise in this segment)\b/.test(normalized)) {
    return "opportunity_signal"
  }
  if (/\b(lower competitive density|competitive density|lower competition)\b/.test(normalized)) {
    return "competitive_gaps"
  }
  if (
    /\b(strongest competitors|top competitors|main competitors)\b/.test(normalized) &&
    /\b(segment|type|tier)\b/.test(normalized)
  ) {
    return "brand_comparison"
  }
  if (
    /\b(rising stars?|rising fastest|strongest momentum|trend acceleration|trend reversal|rank shifts?)\b/.test(
      normalized
    )
  ) {
    return "trends_momentum"
  }
  if (/\b(driving most of this growth|drivers? of growth|what drives growth)\b/.test(normalized)) {
    return "growth_driver"
  }
  if (
    /\b(fastest growth|growing fastest|grew fastest|grew the most|highest mom|highest yoy|fastest growing|growth leader|who grew)\b/.test(
      normalized
    )
  ) {
    return "fastest_growth"
  }
  if (/\b(fastest rank mover|rank moved most|biggest rank jump|rank improvement|rank mover|closing the gap fastest)\b/.test(normalized)) {
    return "fastest_rank_mover"
  }
  if (
    /\b(due to price|due to units|driven by price|driven by units|price or units|unit driven|price driven)\b/.test(
      normalized
    )
  ) {
    return "growth_driver"
  }
  if (
    intent === "top_products" ||
    /\b(top sku|top\s*(1|one)\s*(sku|product|asin|scanner)|top product|best seller)\b/.test(normalized)
  ) {
    return "top_products"
  }
  if (intent === "fastest_mover" || /\b(fastest mover|moving fastest|biggest mover)\b/.test(normalized)) {
    return "fastest_growth"
  }
  if (intent === "asin_history" || /\b(top asins|past performance|asin history|history)\b/.test(normalized)) {
    return "asin_history"
  }
  if (
    intent === "price_vs_volume_explainer" ||
    /\b(high price.*low units|low price.*high units|price led|volume led|price vs volume)\b/.test(
      normalized
    )
  ) {
    return "price_vs_volume_explainer"
  }
  if (intent === "brand_archetype" || /\b(why is .*performing|brand archetype)\b/.test(normalized)) {
    return "brand_archetype"
  }
  if (intent === "product_competitor" || /\b(biggest competitor|closest competitor|competes with)\b/.test(normalized)) {
    return "product_competitor"
  }
  if (intent === "product_trend" || /\b(product trend|trend for|performance of)\b/.test(normalized)) {
    return "product_trend"
  }
  if (intent === "brand_health") return "brand_health"
  if (intent === "market_shift") return "market_shift"
  if (intent === "risk_signal") return "risk_signal"
  if (intent === "opportunity_signal") return "opportunity_signal"
  if (intent === "trends_momentum") return "trends_momentum"
  if (intent === "rating_reviews") return "rating_reviews"
  if (intent === "brand_comparison") return "brand_comparison"
  if (intent === "feature_analysis") return "feature_analysis"
  if (intent === "data_clarification") return "data_clarification"
  if (intent === "price_range") return "price_range"
  return null
}

function mapIntentToAnalyzer(intent: ChatIntent): AnalyzerId {
  if (intent === "fastest_mover") return "fastest_growth"
  if (intent === "asin_history") return "asin_history"
  if (intent === "brand_archetype") return "brand_archetype"
  if (intent === "price_vs_volume_explainer") return "price_vs_volume_explainer"
  if (intent === "self_assessment") return "brand_health"
  if (intent === "competitive_benchmarking") return "market_shift"
  if (intent === "risk_threat") return "risk_signal"
  if (intent === "growth_opportunity") return "opportunity_signal"
  if (intent === "trends_momentum") return "trends_momentum"
  if (intent === "rating_reviews") return "rating_reviews"
  if (intent === "brand_comparison") return "brand_comparison"
  if (intent === "feature_analysis") return "feature_analysis"
  if (intent === "data_clarification") return "data_clarification"
  if (intent === "price_range") return "price_range"
  if (intent === "unknown") return "unknown"
  return intent as AnalyzerId
}

function isFastestGrowthQuestion(normalized: string) {
  return /\b(fastest growth|growing fastest|grew fastest|grew the most|highest mom|highest yoy|fastest growing|growth leader|who grew)\b/.test(
    normalized
  )
}

function isFastestRankMoverQuestion(normalized: string) {
  return /\b(fastest rank mover|rank moved most|biggest rank jump|rank improvement|rank mover|closing the gap fastest|rank shifts?)\b/.test(
    normalized
  )
}

function isGrowthDriverQuestion(normalized: string) {
  return /\b(due to price|due to units|driven by price|driven by units|price or units|unit driven|price driven)\b/.test(
    normalized
  )
}

function isPriceTierGrowthQuestion(normalized: string) {
  return /\b(price tier|price tiers|pricing tier|pricing tiers)\b/.test(normalized) && /\b(fastest|grow|growth|rising|increase)\b/.test(normalized)
}
