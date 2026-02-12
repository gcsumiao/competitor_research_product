import type { CategoryId } from "@/lib/competitor-data"

export type ChatIntent =
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
  | "market_size"
  | "market_leader"
  | "price_range"
  | "top_products"
  | "product_type_mix"
  | "price_volume_tradeoff"
  | "brand_comparison"
  | "feature_analysis"
  | "competitive_gaps"
  | "trends_momentum"
  | "rating_reviews"
  | "market_concentration"
  | "self_assessment"
  | "competitive_benchmarking"
  | "risk_threat"
  | "growth_opportunity"
  | "data_clarification"
  | "unknown"

export type ProactiveSeverity = "info" | "watch" | "risk"

export type EvidenceItem = {
  label: string
  value: string
}

export type ProactiveSuggestion = {
  id: string
  title: string
  summary: string
  severity: ProactiveSeverity
  confidence?: number
}

export type ChatRequest = {
  message: string
  categoryId: CategoryId | string
  snapshotDate: string
  pathname: string
  targetBrand?: string
}

export type ChatResponse = {
  intent: ChatIntent | string
  answer: string
  bullets: string[]
  evidence: EvidenceItem[]
  proactive: ProactiveSuggestion[]
  suggestedQuestions: string[]
  warnings: string[]
  confidence?: number
  assumptions?: string[]
  citations?: CitationItem[]
  analysisTrace?: AnalysisTraceStep[]
  entities?: ResolvedEntities
  historicalWindow?: HistoricalWindow
  salesArchetype?: SalesArchetype
  topContributors?: TopContributor[]
  dataCoverage?: DataCoverage
  capabilities?: ChatIntent[]
  sourcesUsed?: string[]
  windowUsed?: string
}

export type IntentDetection = {
  intent: ChatIntent
  confidence: number
}

export type DataCoverage = {
  source: "code_reader_snapshot" | "category_workbook" | "dashboard_snapshot_fallback"
  sourceLabel: string
  sheets: string[]
  signals: string[]
  notes: string[]
}

export type CitationItem = {
  metric: string
  source: string
  snapshot: string
}

export type AnalysisTraceStep = {
  step: string
  status: "ok" | "partial" | "missing"
}

export type ResolvedEntities = {
  brands: string[]
  asins: string[]
  products: string[]
  entitySources?: EntitySourceHit[]
}

export type HistoricalWindow = "1m" | "3m" | "6m" | "12m" | "all"

export type SalesArchetype = "price_led" | "volume_led" | "balanced"

export type TopContributor = {
  asin: string
  title: string
  revenue: number
  units: number
  trend: string
}

export type RankingMetric = "revenue" | "units"
export type GrowthWindow = "mom" | "yoy" | "both"
export type RankingTarget = "revenue_rank" | "units_rank" | "overall_rank"
export type TargetLevel = "brand" | "type" | "asin" | "market"
export type ProductTypeScope = "tablet" | "dongle" | "handheld" | "other_tools"

export type ScopeMode = "explicit_brand" | "target_brand" | "own_brands" | "all_brands"

export type ResolvedScope = {
  mode: ScopeMode
  brands: string[]
  source: string
}

export type EntitySourceKind =
  | "exact_token"
  | "alias"
  | "inferred_title"
  | "asin_match"
  | "quick_action_target"

export type EntitySourceHit = {
  entity: "brand" | "asin" | "product"
  value: string
  source: EntitySourceKind
}

export type QueryPlan = {
  raw: string
  normalized: string
  intent: ChatIntent
  scopeMode?: ScopeMode
  scopeBrands?: string[]
  includeOwnBrands: boolean
  mentionsAllBrands: boolean
  rankingMetric: RankingMetric
  historicalWindow: HistoricalWindow
  targetLevel: TargetLevel
  growthWindow: GrowthWindow
  rankingTarget: RankingTarget
  typeScope?: ProductTypeScope
}

export type AnalyzerInput = {
  message: string
  intent: ChatIntent
  scope: ResolvedScope
  rankingMetric: RankingMetric
  historicalWindow: HistoricalWindow
  targetLevel: TargetLevel
  growthWindow: GrowthWindow
  rankingTarget: RankingTarget
  typeScope?: ProductTypeScope
}
