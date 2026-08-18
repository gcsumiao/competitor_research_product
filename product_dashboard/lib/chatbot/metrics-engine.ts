import {
  buildCodeReaderDataMart,
  type IndexedProduct,
} from "@/lib/chatbot/code-reader-index"
import { findBiggestCompetitors } from "@/lib/chatbot/competitor-engine"
import { resolveEntities } from "@/lib/chatbot/entity-resolver"
import { routeIntent, type AnalyzerId } from "@/lib/chatbot/intent-router"
import { parseQuery, type ParsedQuery } from "@/lib/chatbot/query-parser"
import { displayProductName, stripDisplayNameSuffix } from "@/lib/chatbot/product-name"
import { buildSynthesisSummary } from "@/lib/chatbot/synthesis-engine"
import { getBrandRolling12GrandTotals } from "@/lib/code-reader-brand-rolling12"
import type { TimeResolution } from "@/lib/chatbot/time-resolver"
import type {
  AnalysisTraceStep,
  ChatResponse,
  CitationItem,
  EvidenceItem,
  HistoricalWindow,
  ProductTypeScope,
  ResolvedEntities,
  ResolvedScope,
  SalesArchetype,
  TopContributor,
} from "@/lib/chatbot/types"
import type { CategorySummary, SnapshotSummary, TypeBreakdownMetric } from "@/lib/competitor-data"

type BuildParams = {
  message: string
  category: CategorySummary
  snapshot: SnapshotSummary
  snapshots: SnapshotSummary[]
  targetBrand?: string
  resolvedTime?: TimeResolution
}

type AnalyzerOutput = {
  answer: string
  bullets: string[]
  evidence: EvidenceItem[]
  confidence: number
  assumptions: string[]
  citations: CitationItem[]
  suggestedQuestions: string[]
  warnings: string[]
  historicalWindow?: HistoricalWindow
  salesArchetype?: SalesArchetype
  topContributors?: TopContributor[]
  factPack?: Record<string, unknown>
  wantsLlmSynthesis?: boolean
}

type AnalyzerParams = {
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>
  targetBrand?: string
  parsed: ParsedQuery
  scope: ResolvedScope
  entities: ResolvedEntities
  matchedProducts: NonNullable<ReturnType<typeof resolveEntities>["matchedProducts"]>
  message: string
}

const OWN_BRAND_KEYS = ["innova", "blcktec"] as const
const ASIN_HEADLINE_PRIOR_REVENUE_MAX = 10_000
const ASIN_HEADLINE_CATEGORY_REVENUE_SHARE = 0.001
const DENSITY_REVENUE_FLOOR_SHARE = 0.02
const DENSITY_PRICE_BANDS = [
  { label: "<$50", min: 0, max: 50 },
  { label: "$50-100", min: 50, max: 100 },
  { label: "$100-200", min: 100, max: 200 },
  { label: "$200-400", min: 200, max: 400 },
  { label: "$400+", min: 400, max: Number.POSITIVE_INFINITY },
] as const

export function buildCodeReaderBrainResponse({
  message,
  category,
  snapshot,
  targetBrand,
  resolvedTime,
}: BuildParams): ChatResponse | null {
  const trace: AnalysisTraceStep[] = []

  const mart = buildCodeReaderDataMart(category, snapshot.date)
  if (!mart) {
    return null
  }
  trace.push({ step: "Build Code Reader data mart", status: "ok" })

  const parsed = parseQuery(message, category.id, {
    requestedMonth: resolvedTime?.primarySnapshotDate?.slice(0, 7),
    resolvedPrimarySnapshot: mart.snapshot.date,
    resolvedCompareSnapshot: resolvedTime?.compareSnapshotDate,
    resolvedWindow: resolvedTime?.resolvedWindow,
  })
  trace.push({ step: `Parse query intent (${parsed.intent})`, status: parsed.confidence > 0 ? "ok" : "partial" })

  const resolved = resolveEntities(message, mart, {
    targetBrand,
    parsedQuery: parsed,
  })
  trace.push({
    step: "Resolve entities (brand/ASIN/product)",
    status: resolved.entities.asins.length || resolved.entities.brands.length ? "ok" : "partial",
  })
  trace.push({
    step: `Resolve scope (${resolved.scope.mode})`,
    status: resolved.scope.mode === "all_brands" ? "partial" : "ok",
  })

  const routed = routeIntent(parsed, resolved)
  trace.push({ step: `Route analyzer (${routed.analyzer})`, status: "ok" })

  if (routed.clarificationQuestion) {
    return {
      intent: "unknown",
      answer: routed.clarificationQuestion,
      bullets: ["I need one more detail to run a precise product-level analysis."],
      evidence: [{ label: "Snapshot", value: mart.snapshot.date }],
      proactive: [],
      suggestedQuestions: [
        "Who is Innova 5610's biggest competitor?",
        "How did Innova 5610 perform vs last month?",
        "Which competitor is threatening our top SKU?",
      ],
      warnings: mart.qualityWarnings,
      confidence: 0.42,
      assumptions: ["Question referenced product-level analysis without a unique product match."],
      citations: [citation("Entity resolver", "code_reader_snapshot", mart.snapshot.date)],
      analysisTrace: trace,
      entities: resolved.entities,
    }
  }

  const analyzerParams = {
    mart,
    targetBrand,
    parsed,
    scope: resolved.scope,
    entities: resolved.entities,
    matchedProducts: resolved.matchedProducts,
    message,
  }
  const output = finalizeAnalyzerOutput(
    routed.analyzer,
    runAnalyzer(routed.analyzer, analyzerParams),
    analyzerParams
  )
  trace.push({ step: "Execute deterministic analyzer", status: "ok" })

  const proactive = shouldBuildProactiveSynthesis(routed.analyzer, analyzerParams)
    ? buildSynthesisSummary(mart).proactive
    : []
  trace.push({ step: "Build proactive synthesis", status: proactive.length ? "ok" : "partial" })

  const explicitlyRequestsYoY = /\b(yoy|year over year|same month last year|vs last year)\b/.test(
    parsed.normalized
  )
  const explicitlyRequestsRolling12 = isExplicitRolling12Request(parsed.normalized)
  const compareSnapshotUsed =
    resolvedTime?.compareSnapshotDate ??
    (explicitlyRequestsYoY
      ? mart.yoy?.date
      : parsed.scope.compareToLastMonth
        ? mart.previous?.date
        : undefined)
  const windowUsed = resolvedTime?.resolvedWindow
    ? windowToLabel(resolvedTime.resolvedWindow)
    : explicitlyRequestsRolling12
      ? windowToLabel("12m")
      : parsed.scope.compareToLastMonth
        ? windowToLabel("1m")
        : explicitlyRequestsYoY
          ? windowToLabel("12m")
          : undefined
  const snapshotPrefix = buildSnapshotPrefix(mart.snapshot.date, compareSnapshotUsed, windowUsed)

  return {
    intent: routed.analyzer,
    answer: output.answer.startsWith("(Snapshot used:")
      ? output.answer
      : `${snapshotPrefix} ${output.answer}`,
    bullets: output.bullets,
    evidence: output.evidence,
    proactive,
    suggestedQuestions: output.suggestedQuestions,
    warnings: unique([...output.warnings, ...mart.qualityWarnings]).slice(0, 6),
    confidence: output.confidence,
    assumptions: output.assumptions,
    citations: output.citations,
    analysisTrace: trace,
    entities: resolved.entities,
    historicalWindow: output.historicalWindow,
    salesArchetype: output.salesArchetype,
    topContributors: output.topContributors,
    factPack: output.factPack,
    wantsLlmSynthesis: output.wantsLlmSynthesis,
    snapshotUsed: mart.snapshot.date,
    compareSnapshotUsed,
    windowUsed,
  }
}

function windowToLabel(value: HistoricalWindow) {
  if (value === "1m") return "Last 1 month"
  if (value === "3m") return "Last 3 months"
  if (value === "6m") return "Last 6 months"
  if (value === "12m") return "Last 12 months"
  return "Full history"
}

function buildSnapshotPrefix(
  snapshot: string,
  compareSnapshot?: string,
  window?: string
) {
  const context = [
    `Snapshot used: ${snapshot}`,
    compareSnapshot ? `compared with: ${compareSnapshot}` : "",
    window ? `window: ${window}` : "",
  ].filter(Boolean)
  return `(${context.join("; ")})`
}

function shouldBuildProactiveSynthesis(
  analyzer: AnalyzerId,
  params: AnalyzerParams
) {
  if (analyzer !== "brand_health") return false
  if (isExplicitRolling12Request(params.parsed.normalized)) {
    return params.scope.mode === "own_brands"
  }
  if (params.scope.mode === "own_brands") return true
  return (
    params.scope.brands.length > 0 &&
    params.scope.brands.every((brand) => OWN_BRAND_KEYS.includes(normalize(brand) as typeof OWN_BRAND_KEYS[number]))
  )
}

function runAnalyzer(
  analyzer: AnalyzerId,
  params: AnalyzerParams
): AnalyzerOutput {
  const { mart } = params
  const ownBrands = resolveOwnBrands(params.targetBrand, params.scope)

  if (analyzer === "sku_threat") {
    return analyzeSkuThreat(params)
  }

  if (analyzer === "competitive_density") {
    return analyzeCompetitiveDensity(params)
  }

  const brandArchetypes = computeBrandArchetypes(mart)

  if (analyzer === "fastest_growth" || analyzer === "fastest_mover") {
    return analyzeFastestGrowth(params, brandArchetypes)
  }

  if (analyzer === "fastest_rank_mover") {
    return analyzeFastestRankMover(params)
  }

  if (analyzer === "type_growth") {
    return analyzeTypeGrowth(params)
  }

  if (analyzer === "growth_driver") {
    return analyzeGrowthDriver(params, brandArchetypes)
  }

  if (analyzer === "price_range") {
    return analyzePriceTierGrowth(params)
  }

  if (analyzer === "brand_comparison") {
    return analyzeBrandComparison(params)
  }

  if (analyzer === "trends_momentum") {
    return analyzeTrendsMomentum(params)
  }

  if (analyzer === "rating_reviews") {
    return analyzeRatingReviews(params)
  }

  if (analyzer === "feature_analysis") {
    return analyzeFeatureAnalysis(params)
  }

  if (analyzer === "data_clarification") {
    return analyzeDataClarification(params)
  }

  if (analyzer === "asin_history") {
    const target = params.matchedProducts[0]
    if (target) {
      const history = mart.asinHistoryByAsin.get(normalize(target.asin))
      const window3 = history?.windows["3m"]
      const window12 = history?.windows["12m"]?.months ? history.windows["12m"] : history?.windows.all
      return {
        answer: `${productLabel(mart, target)}'s recent revenue trend is ${history?.windows["3m"].trend ?? "flat"}.`,
        bullets: [
          `Latest month: ${formatCurrency(target.revenue)} revenue, ${formatNumber(target.units)} units, ASP ${formatCurrency(target.price)}.`,
          window3
            ? `3M: ${formatCurrency(window3.revenue)} revenue, ${formatNumber(window3.units)} units, growth ${formatPercent(window3.revenueGrowthWindow)}.`
            : "3-month history is unavailable.",
          window12
            ? `12M/all: ${formatCurrency(window12.revenue)} revenue, ${formatNumber(window12.units)} units, growth ${formatPercent(window12.revenueGrowthWindow)}.`
            : "Longer-window history is unavailable.",
        ],
        evidence: [
          ...baseEvidence(mart.snapshot),
          { label: "ASIN", value: target.asin },
          { label: "3M Trend", value: window3?.trend ?? "n/a" },
          { label: "Revenue Rank", value: `#${target.rankRevenue}` },
        ],
        confidence: history ? 0.86 : 0.68,
        assumptions: ["History is computed from available dashboard snapshots up to current selected month."],
        citations: [citation("ASIN history windows", "asinHistoryByAsin", mart.snapshot.date)],
        suggestedQuestions: [
          `Who is the biggest competitor to ${productLabel(mart, target)}?`,
          `Show ${target.brand} top ASIN contributors.`,
          "Which brands are fastest movers this month?",
        ],
        warnings: [],
        historicalWindow: "12m",
      }
    }

    const brandKey =
      params.entities.brands[0] ??
      (params.message.match(/\botofix\b/i) ? "otofix" : "")
    if (!brandKey) {
      return unknownOutput(
        mart,
        "Tell me which brand or ASIN you want history for, for example: 'Show OTOFIX top ASINs and past performance.'"
      )
    }

    const topContributors = buildBrandTopContributors(mart, brandKey).slice(0, 3)
    if (!topContributors.length) {
      return unknownOutput(mart, `I couldn't find top ASIN history for ${brandKey.toUpperCase()}.`)
    }

    return {
      answer: `${brandKey.toUpperCase()}'s top revenue product is ${contributorLabel(mart, topContributors[0])}; the next contributors are ${topContributors.slice(1).map((item) => contributorLabel(mart, item)).join(", ") || "not available"}.`,
      bullets: topContributors.map(
        (item) =>
          `${contributorLabel(mart, item)} generated ${formatCurrency(item.revenue)} revenue from ${formatNumber(item.units)} units, with a ${item.trend} recent trend.`
      ),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Brand", value: brandKey.toUpperCase() },
        { label: "Top ASIN", value: topContributors[0]?.asin ?? "n/a" },
      ],
      confidence: 0.83,
      assumptions: ["Top ASIN history uses rolling monthly brand contributor snapshots."],
      citations: [citation("Brand top ASIN history", "brandTopAsinsByMonth", mart.snapshot.date)],
      suggestedQuestions: [
        `Why is ${brandKey.toUpperCase()} performing well?`,
        `Is ${brandKey.toUpperCase()} price-led or volume-led?`,
        "Who are the fastest movers this month?",
      ],
      warnings: [],
      historicalWindow: "12m",
      topContributors,
    }
  }

  if (analyzer === "brand_archetype" || analyzer === "price_vs_volume_explainer") {
    const requestedBrand =
      params.entities.brands[0] ??
      (params.message.match(/\botofix\b/i) ? "otofix" : undefined) ??
      (params.matchedProducts[0] ? normalize(params.matchedProducts[0].brand) : undefined)

    if (requestedBrand && analyzer === "brand_archetype") {
      const archetype = brandArchetypes.get(normalize(requestedBrand))
      const stats = summarizeBrandCurrent(mart, requestedBrand)
      const topContributors = buildBrandTopContributors(mart, requestedBrand).slice(0, 3)
      if (!stats || !archetype) {
        return unknownOutput(mart, `I couldn't classify ${requestedBrand.toUpperCase()} from current data coverage.`)
      }
      return {
        answer: `${stats.brand} is ${toArchetypeLabel(archetype)} this month.`,
        bullets: [
          `${stats.brand} revenue ${formatCurrency(stats.revenue)} with ${formatNumber(stats.units)} units (ASP ${formatCurrency(stats.asp)}).`,
          `Revenue share ${formatPercent(stats.revenueShare)} vs unit share ${formatPercent(stats.unitShare)}.`,
          ...topContributors.map(
            (item) =>
              `${contributorLabel(mart, item)} generated ${formatCurrency(item.revenue)} revenue from ${formatNumber(item.units)} units, with a ${item.trend} recent trend.`
          ),
        ],
        evidence: [
          ...baseEvidence(mart.snapshot),
          { label: "Brand", value: stats.brand },
          { label: "Archetype", value: toArchetypeLabel(archetype) },
          { label: "ASP", value: formatCurrency(stats.asp) },
        ],
        confidence: 0.84,
        assumptions: ["Archetype classification uses deterministic percentile thresholds on ASP and unit/revenue mix."],
        citations: [citation("Brand archetype scoring", "current snapshot brand metrics", mart.snapshot.date)],
        suggestedQuestions: [
          `Show ${stats.brand} top ASIN history.`,
          `Show the fastest-growing ${stats.brand} products.`,
          "Which brands are volume-led this month?",
        ],
        warnings: [],
        historicalWindow: "12m",
        salesArchetype: archetype,
        topContributors,
      }
    }

    const priceLed = listBrandsByArchetype(brandArchetypes, "price_led").slice(0, 3)
    const volumeLed = listBrandsByArchetype(brandArchetypes, "volume_led").slice(0, 3)
    return {
      answer: `Price-led winners: ${priceLed.join(", ") || "none"} | Volume-led winners: ${volumeLed.join(", ") || "none"}.`,
      bullets: [
        "Price-led = higher ASP with lower relative unit mix but strong revenue output.",
        "Volume-led = lower ASP with higher unit throughput and strong revenue conversion.",
        `Balanced brands: ${listBrandsByArchetype(brandArchetypes, "balanced").slice(0, 4).join(", ") || "none"}.`,
      ],
      evidence: baseEvidence(mart.snapshot),
      confidence: 0.82,
      assumptions: ["Classification uses top/bottom 30% ASP percentiles with unit-share and revenue-share constraints."],
      citations: [citation("Price-vs-volume classifier", "brand archetype engine", mart.snapshot.date)],
      suggestedQuestions: [
        "Why is OTOFIX performing well?",
        "Show fastest movers this month.",
        "Show top ASIN history for OTOFIX.",
      ],
      warnings: [],
      historicalWindow: "12m",
    }
  }

  if (analyzer === "product_competitor") {
    const scopedProducts = getScopedProducts(mart, params.scope)
    const target = params.matchedProducts[0] ?? scopedProducts[0] ?? mart.products.find((item) => ownBrands.has(normalize(item.brand)))
    if (!target) return unknownOutput(mart, "I couldn't identify a target product for competitor analysis.")

    const result = findBiggestCompetitors(mart, target)
    const top = result.candidates[0]
    if (!top) {
      return unknownOutput(mart, `I couldn't find a same-type competitor for ${productLabel(mart, target)} in the current snapshot.`)
    }

    const targetName = productLabel(mart, target)
    const competitorName = productLabel(mart, top.product)
    const runnerUp = result.candidates[1]?.product
    const priceDifference = target.price > 0
      ? (top.product.price - target.price) / target.price
      : null
    const priceBandLabel = `${formatCurrency(result.priceBand.min)}-${formatCurrency(result.priceBand.max)}`
    const criterion = result.widenedPriceBand
      ? `the largest same-type rival after widening beyond the empty ${priceBandLabel} price band`
      : `the largest same-type rival in the ${priceBandLabel} price band`

    return {
      answer: `${competitorName} is ${targetName}'s biggest competitor: it sold ${formatNumber(top.product.units)} units for ${formatCurrency(top.product.revenue)} this month — ${criterion} — and its revenue grew ${formatPercent(top.product.revenueMoM)} MoM versus ${targetName}'s ${formatPercent(target.revenueMoM)}.`,
      bullets: [
        runnerUp
          ? `${productLabel(mart, runnerUp)} is the runner-up rival with ${formatNumber(runnerUp.units)} units and ${formatCurrency(runnerUp.revenue)} revenue this month.`
          : `${competitorName} is the only qualifying rival in the comparison set this month.`,
        priceDifference === null
          ? `A meaningful price comparison is unavailable for ${competitorName} and ${targetName}.`
          : `${competitorName} sells at ${formatCurrency(top.product.price)} versus ${targetName}'s ${formatCurrency(target.price)} (${formatAbsolutePercent(priceDifference)} ${priceDifference < 0 ? "cheaper" : "more expensive"}).`,
        ...(top.product.rating > 0 && target.rating > 0
          ? [top.product.reviews > 0 && target.reviews > 0
              ? `${competitorName} is rated ${top.product.rating.toFixed(1)}★ versus ${targetName}'s ${target.rating.toFixed(1)}★, based on ${formatNumber(top.product.reviews)} versus ${formatNumber(target.reviews)} reviews.`
              : `${competitorName} is rated ${top.product.rating.toFixed(1)}★ versus ${targetName}'s ${target.rating.toFixed(1)}★; review counts are unavailable.`]
          : []),
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Target Product", value: productEvidenceValue(mart, target) },
        { label: "Biggest Competitor", value: productEvidenceValue(mart, top.product) },
        { label: "Selection Standard", value: criterion },
        { label: "Revenue MoM Pair", value: `${competitorName} ${formatPercent(top.product.revenueMoM)} vs ${targetName} ${formatPercent(target.revenueMoM)}` },
      ],
      confidence: result.confidence,
      assumptions: result.assumptions,
      citations: [
        citation("Current-month competitor revenue", "brandSheetListings/topProducts", mart.snapshot.date),
        citation("Same-type price-band rival selection", "deterministic competitor-engine", mart.snapshot.date),
      ],
      suggestedQuestions: [
        "Which competitor is threatening our top SKU?",
        `How did ${targetName} perform vs last month?`,
        "Where can we grow with lower competitive density?",
      ],
      warnings: [],
      historicalWindow: "12m",
    }
  }

  if (analyzer === "product_trend") {
    const scopedProducts = getScopedProducts(mart, params.scope)
    const target = params.matchedProducts[0] ?? scopedProducts[0] ?? mart.products.find((item) => ownBrands.has(normalize(item.brand)))
    if (!target) return unknownOutput(mart, "I couldn't identify which product trend to analyze.")

    const last = target.history.find((point) => point.date === mart.snapshot.date)
    const prev = mart.previous
      ? target.history.find((point) => point.date === mart.previous?.date)
      : undefined
    const revenueMoM = target.revenueMoM
    const unitsMoM = target.unitsMoM

    return {
      answer: `${productLabel(mart, target)} is ${describeTrend(revenueMoM)} in revenue (${formatPercent(revenueMoM)}) and ${describeTrend(unitsMoM)} in units (${formatPercent(unitsMoM)}) versus last month.`,
      bullets: [
        `Current monthly revenue: ${formatCurrency(target.revenue)} | units: ${formatNumber(target.units)}.`,
        `Current rank: #${target.rankRevenue} by revenue, #${target.rankUnits} by units.`,
        prev
          ? `Previous snapshot (${prev.date}) revenue: ${formatCurrency(prev.revenue)}, units: ${formatNumber(prev.units)}.`
          : "No previous snapshot record available for this ASIN.",
        last && last.rankRevenue !== null ? `Latest tracked revenue rank history point: #${last.rankRevenue}.` : "Rank history is partial.",
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Product", value: productEvidenceValue(mart, target) },
        { label: "Revenue MoM", value: formatPercent(revenueMoM) },
        { label: "Units MoM", value: formatPercent(unitsMoM) },
      ],
      confidence: target.history.length >= 2 ? 0.86 : 0.7,
      assumptions: ["Trend is based on dashboard snapshot history for available months."],
      citations: [
        citation("Product history series", "code_reader_index", mart.snapshot.date),
        citation("Monthly performance deltas", "topProducts/brandSheetListings", mart.snapshot.date),
      ],
      suggestedQuestions: [
        `Who is the biggest competitor to ${productLabel(mart, target)}?`,
        `How did ${productLabel(mart, target)}'s revenue and units change versus last month?`,
        "Show market shift for top competitors.",
      ],
      warnings: [],
    }
  }

  if (analyzer === "brand_health") {
    const brandKeys = resolveBrandScopeSet(params.scope, ownBrands)
    const currentRows = mart.snapshot.brandTotals.filter((row) => brandKeys.has(normalize(row.brand)))
    const previousRows = (mart.previous?.brandTotals ?? []).filter((row) => brandKeys.has(normalize(row.brand)))
    const currentRevenue = sum(currentRows.map((row) => row.revenue))
    const currentUnits = sum(currentRows.map((row) => row.units))
    const currentShare = mart.snapshot.totals.revenue > 0 ? currentRevenue / mart.snapshot.totals.revenue : 0
    const prevRevenue = sum(previousRows.map((row) => row.revenue))
    const prevUnits = sum(previousRows.map((row) => row.units))
    const currentAsp = currentUnits > 0 ? currentRevenue / currentUnits : 0
    const prevAsp = prevUnits > 0 ? prevRevenue / prevUnits : 0

    const singleBrand = currentRows.length === 1 ? currentRows[0] : undefined
    const singleBrandKey = singleBrand ? normalize(singleBrand.brand) : ""
    const revenueRank = singleBrand ? rankForBrandByMetric(mart.snapshot, singleBrand.brand, "revenue") : null
    const unitsRank = singleBrand ? rankForBrandByMetric(mart.snapshot, singleBrand.brand, "units") : null
    const brandArchetype = singleBrandKey ? brandArchetypes.get(singleBrandKey) : undefined
    const rolling12Current = singleBrand
      ? getBrandRolling12GrandTotals(mart.snapshot, singleBrand.brand)
      : null
    const rolling12Previous = singleBrand
      ? getBrandRolling12GrandTotals(mart.previous, singleBrand.brand)
      : null
    const requestedRolling12 = isExplicitRolling12Request(params.parsed.normalized)
    const requestedMultiMonthTrend =
      /\b(revenue|units|share)\b/.test(params.parsed.normalized) &&
      /\btrend\b/.test(params.parsed.normalized) &&
      /\b(3|6|12)[ -]?(month|months|m)\b/.test(params.parsed.normalized)

    if (requestedMultiMonthTrend) {
      const requestedMonths = params.parsed.plan.historicalWindow === "6m" ? 6 : 12
      const dates = unique(
        Array.from(brandKeys).flatMap((brandKey) =>
          (mart.brandSeries.get(brandKey) ?? []).map((point) => point.date)
        )
      ).sort((a, b) => a.localeCompare(b))
      const windowDates = dates.slice(-requestedMonths)
      const startDate = windowDates[0]
      const startPoints = Array.from(brandKeys)
        .map((brandKey) => (mart.brandSeries.get(brandKey) ?? []).find((point) => point.date === startDate))
        .filter((point): point is NonNullable<typeof point> => Boolean(point))
      const startRevenue = sum(startPoints.map((point) => point.revenue))
      const startUnits = sum(startPoints.map((point) => point.units))
      const startShare = sum(startPoints.map((point) => point.share))

      if (startDate && startPoints.length) {
        return {
          answer: `Over the available ${windowDates.length}-month window, ${labelForScope(params.scope)} revenue changed ${formatPercent(ratio(currentRevenue, startRevenue))}, units changed ${formatPercent(ratio(currentUnits, startUnits))}, and share moved from ${formatSharePercent(startShare)} to ${formatSharePercent(currentShare)}.`,
          bullets: [
            `${startDate}: ${formatCurrency(startRevenue)} revenue, ${formatNumber(startUnits)} units, ${formatSharePercent(startShare)} share.`,
            `${mart.snapshot.date}: ${formatCurrency(currentRevenue)} revenue, ${formatNumber(currentUnits)} units, ${formatSharePercent(currentShare)} share.`,
            `Net share movement: ${signedPoints(currentShare - startShare)}.`,
          ],
          evidence: [
            ...baseEvidence(mart.snapshot),
            { label: "Scope", value: labelForScope(params.scope) },
            { label: "Trend Window", value: `${startDate} to ${mart.snapshot.date}` },
            { label: "Revenue Change", value: formatPercent(ratio(currentRevenue, startRevenue)) },
            { label: "Units Change", value: formatPercent(ratio(currentUnits, startUnits)) },
            { label: "Share Pair", value: `${formatSharePercent(startShare)} to ${formatSharePercent(currentShare)}` },
          ],
          confidence: windowDates.length >= 6 ? 0.9 : 0.7,
          assumptions: ["Multi-month trend uses the available brand-series points ending at the selected snapshot."],
          citations: [citation("Brand trend", "brandSeries", mart.snapshot.date)],
          suggestedQuestions: [
            "Which of our products grew fastest this month?",
            "Which competitor is threatening our top SKU?",
            "Where can we grow with lower competitive density?",
          ],
          warnings: windowDates.length < requestedMonths
            ? [`Only ${windowDates.length} months were available for the requested ${requestedMonths}-month trend.`]
            : [],
          historicalWindow: params.parsed.plan.historicalWindow,
        }
      }
    }

    if (
      requestedRolling12 &&
      !singleBrand &&
      /\b(this|selected|the) brand\b/.test(params.parsed.normalized)
    ) {
      return {
        answer: "I need the brand name to return a brand-level Rolling 12 grand total; choose Innova or BLCKTEC.",
        bullets: [
          "The question does not carry a brand identity on its own.",
          "Market-level Rolling 12 totals are available when no brand is intended.",
        ],
        evidence: baseEvidence(mart.snapshot),
        confidence: 0.98,
        assumptions: ["No conversational brand context is inferred from a standalone preset."],
        citations: [],
        suggestedQuestions: [
          "What are Innova's Rolling 12 grand total revenue and units?",
          "What are BLCKTEC's Rolling 12 grand total revenue and units?",
          "What are the Rolling 12 month grand total revenue and units?",
        ],
        warnings: [],
      }
    }

    if (requestedRolling12 && !singleBrand) {
      const revenueSeries = mart.snapshot.rolling12?.revenue?.marketSeries ?? []
      const unitsSeries = mart.snapshot.rolling12?.units?.marketSeries ?? []
      const rolling12Revenue = sum(revenueSeries)
      const rolling12Units = sum(unitsSeries)
      const hasMarketRolling12 = revenueSeries.length > 0 && unitsSeries.length > 0
      return {
        answer: hasMarketRolling12
          ? `Total market Rolling 12 grand total is ${formatCurrency(rolling12Revenue)} revenue and ${formatNumber(rolling12Units)} units.`
          : "Rolling 12 market totals are unavailable for the selected snapshot.",
        bullets: hasMarketRolling12
          ? [
              `Window: ${mart.snapshot.rolling12?.revenue?.monthLabels[0]} through ${mart.snapshot.rolling12?.revenue?.currentMonthLabel}.`,
              `Current month contribution: ${formatCurrency(mart.snapshot.totals.revenue)} revenue and ${formatNumber(mart.snapshot.totals.units)} units.`,
            ]
          : ["The current snapshot does not include complete Rolling 12 market series."],
        evidence: [
          ...baseEvidence(mart.snapshot),
          ...(hasMarketRolling12
            ? [
                { label: "Rolling 12 Market Revenue", value: formatCurrency(rolling12Revenue) },
                { label: "Rolling 12 Market Units", value: formatNumber(rolling12Units) },
              ]
            : []),
        ],
        confidence: hasMarketRolling12 ? 0.96 : 0.58,
        assumptions: ["Market Rolling 12 totals sum the 12 monthly Total Market series."],
        citations: hasMarketRolling12
          ? [citation("Rolling 12 market totals", "snapshot.rolling12.marketSeries", mart.snapshot.date)]
          : [],
        suggestedQuestions: [
          "What are Innova's Rolling 12 grand total revenue and units?",
          "What changed in market ranking this month?",
          "Which brand gained the most share this month?",
        ],
        warnings: [],
      }
    }

    const deltaUnits = currentUnits - prevUnits
    const unitEffect = deltaUnits * prevAsp
    const priceEffect = currentUnits * (currentAsp - prevAsp)
    const primaryDriver =
      Math.abs(unitEffect) >= Math.abs(priceEffect) ? "units" : "price"
    const strategyLabel =
      brandArchetype === "price_led"
        ? "high average price strategy"
        : brandArchetype === "volume_led"
          ? "high unit volume strategy"
          : "balanced price and volume strategy"

    return {
      answer:
        requestedRolling12 && singleBrand && rolling12Current
          ? `${singleBrand.brand} Rolling 12 grand total is ${formatCurrency(rolling12Current.revenueGrandTotal)} revenue and ${formatNumber(rolling12Current.unitsGrandTotal)} units.`
          : `${labelForScope(params.scope)} delivered ${formatCurrency(currentRevenue)} monthly revenue and ${formatNumber(currentUnits)} units (${formatPercent(ratio(currentRevenue, prevRevenue))} revenue MoM).`,
      bullets: [
        ...(singleBrand && rolling12Current
          ? [
              `Rolling 12 grand total: ${formatCurrency(rolling12Current.revenueGrandTotal)} revenue and ${formatNumber(rolling12Current.unitsGrandTotal)} units (${formatPercent(ratio(rolling12Current.revenueGrandTotal, rolling12Previous?.revenueGrandTotal ?? 0))} revenue change vs previous snapshot).`,
            ]
          : requestedRolling12
            ? ["Rolling 12 grand total is unavailable for this scope."]
            : []),
        singleBrand
          ? `${singleBrand.brand} rank is #${revenueRank ?? "n/a"} by revenue and #${unitsRank ?? "n/a"} by units.`
          : `Current scope includes ${currentRows.length} brands in this snapshot.`,
        `Average price is ${formatCurrency(currentAsp)} (${formatPercent(ratio(currentAsp, prevAsp))} MoM). This scope is currently ${strategyLabel}.`,
        `Revenue movement is mainly driven by ${primaryDriver}: units effect ${formatCurrency(unitEffect)}, price effect ${formatCurrency(priceEffect)}.`,
        ...currentRows.slice(0, 2).map(
          (row) => `${row.brand}: ${formatCurrency(row.revenue)} revenue, ${formatNumber(row.units)} units, ${formatPercent(row.share)} share.`
        ),
        `Market total: ${formatCurrency(mart.snapshot.totals.revenue)} revenue, ${formatNumber(mart.snapshot.totals.units)} units.`,
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Scope", value: labelForScope(params.scope) },
        { label: "Revenue", value: formatCurrency(currentRevenue) },
        { label: "Units", value: formatNumber(currentUnits) },
        { label: "Avg Price", value: formatCurrency(currentAsp) },
        { label: "Share", value: formatPercent(currentShare) },
        ...(singleBrand && rolling12Current
          ? [
              { label: "Rolling 12 Revenue", value: formatCurrency(rolling12Current.revenueGrandTotal) },
              { label: "Rolling 12 Units", value: formatNumber(rolling12Current.unitsGrandTotal) },
            ]
          : []),
      ],
      confidence: currentRows.length ? 0.88 : 0.62,
      assumptions: ["Brand-health scope follows explicit brand > quick-action brand > own brands > market."],
      citations: [
        citation("Brand totals", "snapshot.brandTotals", mart.snapshot.date),
        ...(singleBrand && rolling12Current
          ? [citation("Rolling 12 brand totals", "snapshot.rolling12", mart.snapshot.date)]
          : []),
      ],
      suggestedQuestions: [
        singleBrand
          ? `How has ${singleBrand.brand}'s Rolling 12 grand total changed over recent months?`
          : "What are Innova's Rolling 12 grand total revenue and units?",
        "What are competitors doing this month?",
        "Which competitor is threatening our top SKU?",
      ],
      warnings: [],
    }
  }

  if (analyzer === "market_shift" || analyzer === "competitive_gaps") {
    const deltas = mart.snapshot.brandTotals
      .map((row) => {
        const prev = (mart.previous?.brandTotals ?? []).find((item) => normalize(item.brand) === normalize(row.brand))
        const shareDelta = row.share - safe(prev?.share)
        const revDelta = ratio(row.revenue, safe(prev?.revenue))
        return { row, shareDelta, revDelta }
      })
      .sort((a, b) => Math.abs(b.shareDelta) - Math.abs(a.shareDelta))

    const top = deltas[0]
    return {
      answer: top
        ? `${top.row.brand} shows the largest share movement this month (${signedPoints(top.shareDelta)}).`
        : "Market shift signal is unavailable for this snapshot.",
      bullets: deltas
        .slice(0, 4)
        .map((item) => `${item.row.brand}: share ${formatPercent(item.row.share)} (${signedPoints(item.shareDelta)}), revenue ${formatPercent(item.revDelta)} MoM.`),
      evidence: baseEvidence(mart.snapshot),
      confidence: mart.previous ? 0.84 : 0.65,
      assumptions: ["Comparisons use the immediately previous available snapshot."],
      citations: [citation("Brand movement", "snapshot.brandTotals + previous snapshot", mart.snapshot.date)],
      suggestedQuestions: [
        "Who is Innova 5610's biggest competitor?",
        "Where is the largest growth opportunity by type?",
        "Which products are rising stars this month?",
      ],
      warnings: [],
    }
  }

  if (analyzer === "risk_signal" || analyzer === "market_concentration") {
    const brandScope = resolveBrandScopeSet(params.scope, ownBrands)
    const own = mart.products.filter((item) => brandScope.has(normalize(item.brand)))
    const ownRevenue = sum(own.map((item) => item.revenue))
    const topOneShare = ownRevenue > 0 ? safe(own[0]?.revenue) / ownRevenue : 0
    const weakest = own
      .filter((item) => item.revenue > 100_000)
      .sort((a, b) => a.rating - b.rating)[0]

    const riskLine =
      topOneShare >= 0.55
        ? `Concentration risk: top SKU contributes ${formatPercent(topOneShare)} of ${labelForScope(params.scope).toLowerCase()} revenue.`
        : weakest
          ? `Quality risk: ${productLabel(mart, weakest)} has high revenue (${formatCurrency(weakest.revenue)}) but a lower rating (${weakest.rating.toFixed(1)}).`
          : "No severe risk crossed configured thresholds."

    return {
      answer: riskLine,
      bullets: [
        `Own revenue concentration (Top 1): ${formatPercent(topOneShare)}.`,
        weakest ? `${productLabel(mart, weakest)} is the rating-pressure candidate at ${weakest.rating.toFixed(1)}★.` : "No high-revenue low-rating product was found.",
        ...buildSynthesisSummary(mart).watchlist.slice(0, 2),
      ],
      evidence: baseEvidence(mart.snapshot),
      confidence: 0.8,
      assumptions: ["Risk thresholds use deterministic heuristic cutoffs (concentration and rating)."],
      citations: [citation("Risk scoring", "deterministic risk_signal analyzer", mart.snapshot.date)],
      suggestedQuestions: [
        "Which competitor is threatening our top SKU?",
        "Show competitor movements with largest share change.",
        "Where can we grow with lower competitive density?",
      ],
      warnings: [],
      wantsLlmSynthesis: true,
      factPack: {
        analysis: "risk_signal",
        topSkuRevenueConcentration: round(topOneShare),
        weakestHighRevenueProduct: weakest
          ? {
              brand: weakest.brand,
              asin: weakest.asin,
              revenue: round(weakest.revenue),
              rating: round(weakest.rating),
            }
          : null,
      },
    }
  }

  if (analyzer === "opportunity_signal" || analyzer === "product_type_mix" || analyzer === "price_volume_tradeoff") {
    const scopeRows = mart.typeMetrics
      .filter((row) => row.revenue > 0)
      .sort((a, b) => b.revenueShare - a.revenueShare)
    if (analyzer === "product_type_mix") {
      const totalRows = scopeRows.filter(
        (row) => row.scopeKey.startsWith("total_") && row.scopeKey !== "total"
      )
      const topType = totalRows[0]
      return {
        answer: topType
          ? `${topType.label} leads product types with ${formatCurrency(topType.revenue)} revenue (${formatSharePercent(topType.revenueShare)} share) and ${formatNumber(topType.units)} units.`
          : "Product type performance is unavailable for this snapshot.",
        bullets: totalRows.map(
          (row) =>
            `${row.label}: ${formatCurrency(row.revenue)} revenue (${formatPercent(row.revenueShare)}), ${formatNumber(row.units)} units (${formatPercent(row.unitsShare)}).`
        ),
        evidence: [
          ...baseEvidence(mart.snapshot),
          ...(topType
            ? [
                { label: "Leading Product Type", value: topType.label },
                { label: "Type Revenue", value: formatCurrency(topType.revenue) },
                { label: "Type Units", value: formatNumber(topType.units) },
              ]
            : []),
        ],
        confidence: totalRows.length ? 0.94 : 0.58,
        assumptions: ["Type performance uses all-ASIN total category rows for the selected snapshot."],
        citations: [citation("Type breakdowns", "snapshot.typeBreakdowns.allAsins", mart.snapshot.date)],
        suggestedQuestions: [
          "Which tablet price tier grew fastest?",
          "Which handheld brand is growing fastest by revenue?",
          "Where can we grow with lower competitive density?",
        ],
        warnings: [],
      }
    }
    const ownMix = mart.snapshot.typeBreakdowns?.categoryBrandMix ?? []
    const brandScope = resolveBrandScopeSet(params.scope, ownBrands)
    const candidate = scopeRows
      .map((row) => {
        const ownRevenue = ownMix
          .filter((mix) => normalize(mix.scopeKey) === normalize(row.scopeKey) && brandScope.has(normalize(mix.brand)))
          .reduce((sum, item) => sum + item.revenue, 0)
        const ownShare = row.revenue > 0 ? ownRevenue / row.revenue : 0
        return { row, ownShare }
      })
      .find((item) => item.row.revenueShare >= 0.2 && item.ownShare < 0.06)

    return {
      answer: candidate
        ? `Best opportunity: ${candidate.row.label} has ${formatPercent(candidate.row.revenueShare)} market revenue share while own share is ${formatPercent(candidate.ownShare)}.`
        : "No clear high-weight low-share opportunity exceeded threshold this month.",
      bullets: scopeRows.slice(0, 4).map((row) => `${row.label}: ${formatCurrency(row.revenue)} revenue, ${formatPercent(row.revenueShare)} share.`),
      evidence: baseEvidence(mart.snapshot),
      confidence: scopeRows.length ? 0.82 : 0.6,
      assumptions: ["Opportunity signal prioritizes large market-weight segments with low own participation."],
      citations: [citation("Type breakdowns", "snapshot.typeBreakdowns", mart.snapshot.date)],
      suggestedQuestions: [
        "Which segment is our best growth opportunity?",
        "Compare the top two brands on share, units, and pricing.",
        "What price tier is growing fastest?",
      ],
      warnings: [],
      wantsLlmSynthesis: true,
      factPack: {
        analysis: "opportunity_signal",
        candidate: candidate
          ? {
              segment: candidate.row.label,
              revenue: round(candidate.row.revenue),
              marketRevenueShare: round(candidate.row.revenueShare),
              ownShare: round(candidate.ownShare),
            }
          : null,
        leadingSegments: scopeRows.slice(0, 4).map((row) => ({
          segment: row.label,
          revenue: round(row.revenue),
          revenueShare: round(row.revenueShare),
        })),
      },
    }
  }

  if (analyzer === "market_size") {
    return {
      answer: `The ${mart.snapshot.label || mart.snapshot.date} market totaled ${formatCurrency(mart.snapshot.totals.revenue)} revenue and ${formatNumber(mart.snapshot.totals.units)} units across ${formatNumber(mart.snapshot.totals.asinCount)} ASINs.`,
      bullets: [
        `Average market price: ${formatCurrency(mart.snapshot.totals.avgPrice)}.`,
        `Top 3 brand share: ${formatPercent(mart.snapshot.totals.top3Share)}.`,
        `Tracked brands: ${formatNumber(mart.snapshot.totals.brandCount)}.`,
      ],
      evidence: baseEvidence(mart.snapshot),
      confidence: 0.98,
      assumptions: ["Market size uses the selected snapshot totals."],
      citations: [citation("Market totals", "snapshot.totals", mart.snapshot.date)],
      suggestedQuestions: [
        "Which brand ranked first by revenue?",
        "Which product ranked first by revenue?",
        "What changed in market ranking this month?",
      ],
      warnings: [],
    }
  }

  if (analyzer === "market_leader") {
    const metric = params.parsed.plan.rankingMetric
    const leaders = [...mart.snapshot.brandTotals].sort((a, b) =>
      metric === "units" ? b.units - a.units : b.revenue - a.revenue
    )
    const leader = leaders[0]
    return {
      answer: leader
        ? `${leader.brand} ranks first by ${metric} with ${metric === "units" ? `${formatNumber(leader.units)} units` : `${formatCurrency(leader.revenue)} revenue`} and ${formatSharePercent(leader.share)} revenue share.`
        : "Brand leader data is unavailable for this snapshot.",
      bullets: leaders.slice(0, 5).map(
        (row, index) =>
          `#${index + 1} ${row.brand}: ${formatCurrency(row.revenue)} revenue, ${formatNumber(row.units)} units, ${formatPercent(row.share)} share.`
      ),
      evidence: [
        ...baseEvidence(mart.snapshot),
        ...(leader
          ? [
              { label: "Leading Brand", value: leader.brand },
              { label: "Brand Revenue", value: formatCurrency(leader.revenue) },
              { label: "Brand Units", value: formatNumber(leader.units) },
              { label: "Brand Share", value: formatPercent(leader.share) },
            ]
          : []),
      ],
      confidence: leader ? 0.98 : 0.55,
      assumptions: ["Brand ranking uses current snapshot brand totals."],
      citations: [citation("Brand totals", "snapshot.brandTotals", mart.snapshot.date)],
      suggestedQuestions: [
        "Which product ranked first by revenue?",
        "What changed in market ranking this month?",
        "Which brand gained the most share?",
      ],
      warnings: [],
    }
  }

  if (analyzer === "top_products") {
    const sorted = [...getScopedProducts(mart, params.scope)].sort((a, b) =>
      params.parsed.plan.rankingMetric === "units" ? b.units - a.units : b.revenue - a.revenue
    )
    const top = sorted.slice(0, 5)
    const rankingLabel = params.parsed.plan.rankingMetric === "units" ? "units" : "revenue"
    const scopeLabel = labelForScope(params.scope)
    if ((params.scope.mode === "explicit_brand" || params.scope.mode === "target_brand") && !top.length) {
      return unknownOutput(mart, `I couldn't find products for ${scopeLabel}.`)
    }
    return {
      answer: top.length
        ? `${productLabel(mart, top[0])} is the top ${scopeLabel} product with ${params.parsed.plan.rankingMetric === "units" ? `${formatNumber(top[0].units)} units` : `${formatCurrency(top[0].revenue)} revenue`} this month.`
        : "No top-product data is available for this snapshot.",
      bullets: top.map((item, idx) => `${productLabel(mart, item)} ranks #${idx + 1} with ${formatCurrency(item.revenue)} revenue and ${formatNumber(item.units)} units.`),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Scope", value: scopeLabel },
        { label: "Ranked By", value: rankingLabel },
      ],
      confidence: top.length ? 0.9 : 0.55,
      assumptions: ["Top-product ranking uses deterministic scope resolution and current snapshot monthly metrics."],
      citations: [citation("Top products", "snapshot.topProducts + brandSheetListings", mart.snapshot.date)],
      suggestedQuestions: [
        top[0] ? `Who is the biggest competitor to ${productLabel(mart, top[0])}?` : "What are competitors doing this month?",
        top[0] ? `How did ${productLabel(mart, top[0])} perform versus last month?` : "Which products are rising fastest now?",
        "Which products are rising fastest now?",
      ],
      warnings: [],
    }
  }

  return unknownOutput(
    mart,
    "I can analyze product competitors, product trends, market shifts, risks, and opportunities. Tell me a product ASIN or brand to go deeper."
  )
}

type ThreatCandidate = {
  product: IndexedProduct
  score: number
  coverage: number
  rankStart: number | null
  rankCurrent: number | null
  rankGain: number | null
  rankMonths: number
  ownRankGain: number | null
  revenueGrowthGap: number | null
  priceUndercut: number | null
  reviewGain: number | null
  ownReviewGain: number | null
}

function analyzeSkuThreat(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const ownBrandSet = new Set<string>(OWN_BRAND_KEYS)
  const ownTopSku = mart.products
    .filter((product) => ownBrandSet.has(normalize(product.brand)))
    .sort((a, b) => b.revenue - a.revenue)[0]

  if (!ownTopSku) {
    return {
      ...unknownOutput(mart, "No Innova or BLCKTEC product is present in the current snapshot, so a top-SKU threat cannot be scored."),
      wantsLlmSynthesis: true,
      factPack: {
        analysis: "sku_threat",
        ownBrands: OWN_BRAND_KEYS,
        ownTopSku: null,
        competitorProductCount: mart.products.filter(
          (product) => !ownBrandSet.has(normalize(product.brand))
        ).length,
      },
    }
  }

  const competitorProducts = mart.products.filter(
    (product) => !ownBrandSet.has(normalize(product.brand))
  )
  if (!competitorProducts.length) {
    return {
      answer: `${productLabel(mart, ownTopSku)} is the top own product, but this snapshot contains no competitor products to score against it.`,
      bullets: [
        `Defended SKU: ${formatCurrency(ownTopSku.revenue)} revenue, rank #${ownTopSku.rankRevenue}, price ${formatCurrency(ownTopSku.price)}.`,
        "Recommendation: restore competitor-ASIN coverage before making a product-defense decision.",
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Defended SKU", value: productEvidenceValue(mart, ownTopSku) },
        { label: "Competitor ASINs", value: "0" },
      ],
      confidence: 0.45,
      assumptions: ["Own brands are Innova and BLCKTEC."],
      citations: [citation("SKU threat universe", "current snapshot products", mart.snapshot.date)],
      suggestedQuestions: [
        `How did ${productLabel(mart, ownTopSku)} perform versus last month?`,
        "What are competitors doing this month?",
        "Where can we grow with lower competitive density?",
      ],
      warnings: ["Competitor ASIN coverage is missing from the selected snapshot."],
      wantsLlmSynthesis: true,
      factPack: {
        analysis: "sku_threat",
        ownTopSku: threatProductFact(ownTopSku),
        competitorProductCount: 0,
      },
    }
  }

  const normalizedOwnType = normalize(ownTopSku.type)
  const hasUsableOwnType = Boolean(normalizedOwnType && normalizedOwnType !== "unknown")
  const sameTypeProducts = hasUsableOwnType
    ? competitorProducts.filter((product) => normalize(product.type) === normalizedOwnType)
    : competitorProducts
  const isPriceComparable = (product: IndexedProduct) =>
    ownTopSku.price <= 0 ||
    (product.price >= ownTopSku.price * 0.5 && product.price <= ownTopSku.price * 1.5)
  const strictCandidates = sameTypeProducts.filter(isPriceComparable)

  // If the exact type has no comparable competitor, retain the closest available
  // adjacent evidence instead of returning an empty ranking.
  const widenedBeyondType = hasUsableOwnType && sameTypeProducts.length === 0
  const widenedBeyondPrice = !widenedBeyondType && strictCandidates.length === 0
  const widenedTypeCandidates = widenedBeyondType
    ? competitorProducts.filter(isPriceComparable)
    : []
  const analysisUniverse = strictCandidates.length
    ? strictCandidates
    : widenedBeyondType
      ? widenedTypeCandidates.length
        ? widenedTypeCandidates
        : competitorProducts
      : sameTypeProducts.length
        ? sameTypeProducts
        : competitorProducts

  const threats = analysisUniverse
    .map((product) => scoreThreatCandidate(product, ownTopSku))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.priceUndercut ?? Number.NEGATIVE_INFINITY) -
          (a.priceUndercut ?? Number.NEGATIVE_INFINITY) ||
        (a.rankCurrent ?? Number.MAX_SAFE_INTEGER) -
          (b.rankCurrent ?? Number.MAX_SAFE_INTEGER) ||
        b.product.revenue - a.product.revenue
    )
    .slice(0, 3)
  const topThreat = threats[0]

  if (!topThreat) {
    return unknownOutput(
      mart,
      `No competitor product could be scored against ${productLabel(mart, ownTopSku)}; adjacent competitor coverage is also empty.`
    )
  }

  const wideningSentence = widenedBeyondType
    ? `No same-type competitor is present for ${ownTopSku.type}, so this uses the strongest adjacent-type evidence.`
    : widenedBeyondPrice
      ? `No same-type product met the normal price-comparability rule, so this uses the closest same-type evidence.`
      : ""
  const why = describeThreatWhy(topThreat, ownTopSku)
  const threatCoverageWarnings = threats
    .map((threat, index) => formatThreatCoverageWarning(threat, index + 1))
    .filter((warning): warning is string => Boolean(warning))
  return {
    answer: `${productLabel(mart, topThreat.product)} is the most threatening competitor to ${productLabel(mart, ownTopSku)} because ${why}.${wideningSentence ? ` ${wideningSentence}` : ""}`,
    bullets: [
      ...threats.map((threat, index) => formatThreatBullet(threat, ownTopSku, index + 1)),
      `Defend ${productLabel(mart, ownTopSku)} against ${productLabel(mart, topThreat.product)} with a focused price/value test and weekly rank, revenue-growth, and review monitoring.`,
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Defended SKU", value: productEvidenceValue(mart, ownTopSku) },
      { label: "Primary Threat", value: productEvidenceValue(mart, topThreat.product) },
      { label: "Threat Score", value: formatThreatScore(topThreat) },
      { label: "Threat Score Coverage", value: topThreat.coverage.toFixed(2) },
      {
        label: "Revenue MoM Pair",
        value: `${topThreat.product.brand} ${formatPercent(topThreat.product.revenueMoM)} vs ${ownTopSku.brand} ${formatPercent(ownTopSku.revenueMoM)}`,
      },
      {
        label: "Price Pair",
        value: `${formatCurrency(topThreat.product.price)} vs ${formatCurrency(ownTopSku.price)}`,
      },
      ...(topThreat.rankStart !== null
        ? [
            {
              label: "Threat Rank Movement",
              value: `#${topThreat.rankStart} to #${topThreat.rankCurrent}`,
            },
          ]
        : []),
    ],
    confidence:
      topThreat.rankGain === null && topThreat.revenueGrowthGap === null
        ? 0.62
        : widenedBeyondType || widenedBeyondPrice
          ? 0.76
          : 0.91,
    assumptions: [
      "Own brands are Innova and BLCKTEC; the defended SKU is their highest-revenue current ASIN.",
      "Comparable products use the defended SKU's exact type and prices from 0.5x to 1.5x its price; adjacent evidence is used only when that set is empty.",
      "Threat score weights rank convergence 35%, revenue-growth gap 35%, price undercut 20%, and review velocity 10%; missing factors contribute zero and available weights are not renormalized.",
    ],
    citations: [
      citation("SKU threat scoring", "products + product history", mart.snapshot.date),
      citation("Competitor universe", "current snapshot all brands", mart.snapshot.date),
    ],
    suggestedQuestions: [
      `How did ${productLabel(mart, ownTopSku)} perform versus last month?`,
      `Who are the closest competitors to ${productLabel(mart, ownTopSku)}?`,
      "Where can we grow with lower competitive density?",
    ],
    warnings: threatCoverageWarnings,
    wantsLlmSynthesis: true,
    factPack: {
      analysis: "sku_threat",
      snapshot: mart.snapshot.date,
      comparisonRule: {
        type: hasUsableOwnType ? ownTopSku.type : "all types because defended type is missing",
        minPriceMultiple: 0.5,
        maxPriceMultiple: 1.5,
        widenedBeyondType,
        widenedBeyondPrice,
      },
      formulaWeights: {
        rankConvergence: 0.35,
        revenueGrowthGap: 0.35,
        priceUndercut: 0.2,
        reviewVelocityWhenAvailable: 0.1,
        missingFactorTreatment: "zero contribution; no renormalization",
      },
      ownTopSku: threatProductFact(ownTopSku),
      threats: threats.map((threat) => ({
        ...threatProductFact(threat.product),
        threatScore: round(threat.score),
        threatScoreLabel: formatThreatScore(threat),
        coverage: round(threat.coverage),
        rankStart: threat.rankStart,
        rankCurrent: threat.rankCurrent,
        rankGain: threat.rankGain,
        ownRankGain: threat.ownRankGain,
        revenueGrowthGap: nullableRound(threat.revenueGrowthGap),
        priceUndercut: nullableRound(threat.priceUndercut),
        reviewGain: threat.reviewGain,
        ownReviewGain: threat.ownReviewGain,
      })),
    },
  }
}

function scoreThreatCandidate(product: IndexedProduct, ownTopSku: IndexedProduct): ThreatCandidate {
  const candidateRank = recentRankMovement(product)
  const ownRank = recentRankMovement(ownTopSku)
  const revenueGrowthGap =
    product.revenueMoM !== null && ownTopSku.revenueMoM !== null
      ? product.revenueMoM - ownTopSku.revenueMoM
      : null
  const priceUndercut =
    ownTopSku.price > 0 && product.price > 0
      ? (ownTopSku.price - product.price) / ownTopSku.price
      : null
  const reviewGain = recentReviewGain(product)
  const ownReviewGain = recentReviewGain(ownTopSku)

  // Each component is normalized to 0-100. Rank compares competitor improvement
  // against the defended SKU; growth is the MoM gap closure; price rewards an
  // undercut up to 30%; reviews compare recent review-count gains. Missing factors
  // contribute zero, and available component weights are never renormalized.
  const components: Array<{ weight: number; value: number }> = []
  if (candidateRank.gain !== null && ownRank.gain !== null) {
    components.push({
      weight: 0.35,
      value: clamp(50 + (candidateRank.gain - ownRank.gain) * 5, 0, 100),
    })
  }
  if (revenueGrowthGap !== null) {
    components.push({
      weight: 0.35,
      value: clamp(50 + revenueGrowthGap * 100, 0, 100),
    })
  }
  if (priceUndercut !== null) {
    components.push({
      weight: 0.2,
      value: clamp((priceUndercut / 0.3) * 100, 0, 100),
    })
  }
  if (reviewGain !== null && ownReviewGain !== null) {
    components.push({
      weight: 0.1,
      value: clamp(50 + (reviewGain - ownReviewGain) * 2, 0, 100),
    })
  }
  const weightTotal = sum(components.map((component) => component.weight))
  const score = sum(components.map((component) => component.weight * component.value))

  return {
    product,
    score,
    coverage: weightTotal,
    rankStart: candidateRank.start,
    rankCurrent: product.rankRevenue,
    rankGain: candidateRank.gain,
    rankMonths: candidateRank.months,
    ownRankGain: ownRank.gain,
    revenueGrowthGap,
    priceUndercut,
    reviewGain,
    ownReviewGain,
  }
}

function recentRankMovement(product: IndexedProduct) {
  const recent = product.history.slice(-3)
  const currentPoint = recent.at(-1)
  const startPoint = recent.find(
    (point) => point.date !== currentPoint?.date && point.rankRevenue !== null
  )
  if (!startPoint?.rankRevenue || !currentPoint?.rankRevenue) {
    return { start: null, gain: null, months: 0 }
  }
  return {
    start: startPoint.rankRevenue,
    gain: startPoint.rankRevenue - currentPoint.rankRevenue,
    months: monthSpan(startPoint.date, currentPoint.date),
  }
}

function monthSpan(startDate: string, endDate: string) {
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 1
  return Math.max(
    1,
    (end.getUTCFullYear() - start.getUTCFullYear()) * 12 +
      end.getUTCMonth() -
      start.getUTCMonth()
  )
}

function recentReviewGain(product: IndexedProduct) {
  const recent = product.history.slice(-3)
  const current = recent.at(-1)
  const start = recent[0]
  if (!current || !start || current.date === start.date || current.reviews <= 0 || start.reviews <= 0) {
    return null
  }
  return current.reviews - start.reviews
}

function describeThreatWhy(threat: ThreatCandidate, ownTopSku: IndexedProduct) {
  const reasons: string[] = []
  if (threat.rankStart !== null) {
    const verb = safe(threat.rankGain) > 0 ? "climbed" : safe(threat.rankGain) < 0 ? "moved down" : "held"
    reasons.push(
      `it ${verb} from #${threat.rankStart} to #${threat.rankCurrent} over ${threat.rankMonths === 1 ? "one month" : `${threat.rankMonths} months`}`
    )
  }
  if (threat.priceUndercut !== null) {
    reasons.push(
      threat.priceUndercut >= 0
        ? `it is priced ${(threat.priceUndercut * 100).toFixed(0)}% below our SKU`
        : `it is priced ${Math.abs(threat.priceUndercut * 100).toFixed(0)}% above our SKU`
    )
  }
  if (threat.revenueGrowthGap !== null) {
    reasons.push(
      `its revenue is ${formatPercent(threat.product.revenueMoM)} MoM while ours is ${formatPercent(ownTopSku.revenueMoM)}`
    )
  }
  if (threat.reviewGain !== null && threat.ownReviewGain !== null) {
    reasons.push(`it added ${formatNumber(threat.reviewGain)} reviews versus our ${formatNumber(threat.ownReviewGain)}`)
  }
  return reasons.slice(0, 3).join(", ") || "it has the strongest current revenue among comparable competitor products"
}

function formatThreatBullet(threat: ThreatCandidate, ownTopSku: IndexedProduct, rank: number) {
  const rankText = threat.rankStart !== null
    ? `rank #${threat.rankStart} to #${threat.rankCurrent}`
    : `current rank #${threat.rankCurrent}`
  const priceText = threat.priceUndercut !== null
    ? `${Math.abs(threat.priceUndercut * 100).toFixed(0)}% ${threat.priceUndercut >= 0 ? "below" : "above"} our ${formatCurrency(ownTopSku.price)} price`
    : "price comparison unavailable"
  return `${threat.product.displayName} ranks #${rank} for threat at ${formatThreatScore(threat)}, with ${rankText}, a price ${priceText}, and revenue growth of ${formatPercent(threat.product.revenueMoM)} MoM versus ${formatPercent(ownTopSku.revenueMoM)} for ${ownTopSku.displayName}.`
}

function formatThreatScore(threat: ThreatCandidate) {
  const score = `${threat.score.toFixed(0)}/100`
  if (threat.coverage >= 1) return score
  const priceOnly =
    threat.priceUndercut !== null &&
    threat.rankGain === null &&
    threat.revenueGrowthGap === null &&
    (threat.reviewGain === null || threat.ownReviewGain === null)
  return priceOnly
    ? `${score} (price-only)`
    : `${score} (degraded; ${(threat.coverage * 100).toFixed(0)}% coverage)`
}

function formatThreatCoverageWarning(threat: ThreatCandidate, rank: number) {
  if (threat.coverage >= 1) return null
  const missingFactors: string[] = []
  if (threat.rankGain === null || threat.ownRankGain === null) {
    missingFactors.push("rank convergence")
  }
  if (threat.revenueGrowthGap === null) {
    missingFactors.push("revenue MoM gap")
  }
  if (threat.priceUndercut === null) {
    missingFactors.push("price undercut")
  }
  if (threat.reviewGain === null || threat.ownReviewGain === null) {
    missingFactors.push("review velocity")
  }
  return `Threat #${rank}, ${threat.product.displayName}, scores ${formatThreatScore(threat)} because ${missingFactors.join(", ")} evidence was unavailable; missing factors contribute zero.`
}

function threatProductFact(product: IndexedProduct) {
  return {
    brand: product.brand,
    title: product.displayName,
    asin: product.asin,
    type: product.type,
    price: round(product.price),
    revenue: round(product.revenue),
    revenueMoM: nullableRound(product.revenueMoM),
    rankRevenue: product.rankRevenue,
    reviews: product.reviews,
  }
}

type DensitySegment = {
  label: string
  type: string
  priceBand: string
  revenue: number
  revenueShare: number
  revenueMoM: number | null
  previousCoverage: number
  brandCount: number
  hhi: number
  effectiveBrandCount: number
  ownShare: number
  score: number
}

function analyzeCompetitiveDensity(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const ownBrandSet = new Set<string>(OWN_BRAND_KEYS)
  const typeScope = params.parsed.plan.typeScope
  const scopedProducts = typeScope
    ? mart.products.filter((product) => matchesTypeScope(product.type, typeScope))
    : mart.products
  const analyzedRevenue = sum(scopedProducts.map((product) => product.revenue))
  const categoryRevenue = mart.snapshot.totals.revenue
  const overallOwnRevenue = sum(
    scopedProducts
      .filter((product) => ownBrandSet.has(normalize(product.brand)))
      .map((product) => product.revenue)
  )
  const overallOwnShare = analyzedRevenue > 0 ? overallOwnRevenue / analyzedRevenue : 0
  const grouped = new Map<
    string,
    {
      type: string
      priceBand: string
      revenue: number
      previousRevenue: number
      matchedCurrentRevenue: number
      ownRevenue: number
      brandRevenue: Map<string, number>
    }
  >()

  for (const product of scopedProducts) {
    if (product.revenue <= 0) continue
    const type = product.type.trim() || "Unknown"
    const priceBand = densityPriceBand(product.price)
    const key = `${normalize(type)}|${priceBand}`
    const bucket = grouped.get(key) ?? {
      type,
      priceBand,
      revenue: 0,
      previousRevenue: 0,
      matchedCurrentRevenue: 0,
      ownRevenue: 0,
      brandRevenue: new Map<string, number>(),
    }
    bucket.revenue += product.revenue
    const previous = mart.previous
      ? product.history.find((point) => point.date === mart.previous?.date)
      : undefined
    if (previous) {
      bucket.previousRevenue += previous.revenue
      bucket.matchedCurrentRevenue += product.revenue
    }
    if (ownBrandSet.has(normalize(product.brand))) {
      bucket.ownRevenue += product.revenue
    }
    const brandKey = normalize(product.brand) || "unknown"
    bucket.brandRevenue.set(brandKey, (bucket.brandRevenue.get(brandKey) ?? 0) + product.revenue)
    grouped.set(key, bucket)
  }

  const segments = Array.from(grouped.values())
    .map((bucket): DensitySegment => {
      const revenueShare = categoryRevenue > 0 ? bucket.revenue / categoryRevenue : 0
      const hhi = sum(
        Array.from(bucket.brandRevenue.values()).map((revenue) => {
          const share = bucket.revenue > 0 ? revenue / bucket.revenue : 0
          return share * share
        })
      )
      const previousCoverage =
        bucket.revenue > 0 ? bucket.matchedCurrentRevenue / bucket.revenue : 0
      const revenueMoM =
        previousCoverage >= 0.8 && bucket.previousRevenue > 0
          ? ratio(bucket.matchedCurrentRevenue, bucket.previousRevenue)
          : null
      const ownShare = bucket.revenue > 0 ? bucket.ownRevenue / bucket.revenue : 0
      const brandCount = bucket.brandRevenue.size
      const effectiveBrandCount = hhi > 0 ? 1 / hhi : 0
      const brandEase = clamp((effectiveBrandCount - 1) / 11, 0, 1)
      const hhiEase = 1 - clamp(hhi, 0, 1)
      const growthQuality = revenueMoM === null ? 0.35 : clamp((revenueMoM + 0.05) / 0.2, 0, 1)
      const underweight = overallOwnShare > 0
        ? clamp((overallOwnShare - ownShare) / overallOwnShare, 0, 1)
        : 0

      // Opportunity score: 30% effective brand breadth, 25% low HHI, 25% stable/
      // positive matched-ASIN MoM growth, and 20% own-share underweight.
      const score = brandEase * 30 + hhiEase * 25 + growthQuality * 25 + underweight * 20
      return {
        label: `${bucket.type} ${bucket.priceBand}`,
        type: bucket.type,
        priceBand: bucket.priceBand,
        revenue: bucket.revenue,
        revenueShare,
        revenueMoM,
        previousCoverage,
        brandCount,
        hhi,
        effectiveBrandCount,
        ownShare,
        score,
      }
    })
    .filter((segment) => segment.revenueShare >= DENSITY_REVENUE_FLOOR_SHARE)

  const strictOpportunities = segments
    .filter(
      (segment) =>
        segment.revenueMoM !== null &&
        segment.revenueMoM >= -0.05 &&
        segment.ownShare < overallOwnShare
    )
    .sort((a, b) => b.score - a.score || b.revenue - a.revenue)
  const ranked = (strictOpportunities.length ? strictOpportunities : segments)
    .sort((a, b) => b.score - a.score || b.revenue - a.revenue)
    .slice(0, 3)
  const top = ranked[0]

  if (!top) {
    return {
      ...unknownOutput(
        mart,
        "No type-by-price segment cleared the 2% category-revenue floor, so there is no reliable lower-density growth segment to recommend."
      ),
      wantsLlmSynthesis: true,
      factPack: {
        analysis: "competitive_density",
        analyzedRevenue,
        revenueFloorShare: DENSITY_REVENUE_FLOOR_SHARE,
        qualifyingSegments: 0,
      },
    }
  }

  const next = ranked[1]
  const strictConditionsMet = strictOpportunities.length > 0
  const topDescription = densitySegmentDescription(top, overallOwnShare)
  const nextDescription = next ? densitySegmentDescription(next, overallOwnShare) : ""

  return {
    answer: strictConditionsMet
      ? `The best lower-density growth segment is ${topDescription}.${next ? ` The next-best option is ${nextDescription}.` : ""}`
      : `No segment met every density, growth, and own-share condition; the closest option is ${topDescription}.${next ? ` The next closest is ${nextDescription}.` : ""}`,
    bullets: [
      ...ranked.map(
        (segment, index) =>
          `#${index + 1} ${densitySegmentDescription(segment, overallOwnShare)}; ${formatCurrency(segment.revenue)} segment revenue (${formatSharePercent(segment.revenueShare)} of category).`
      ),
      `Recommendation: validate demand and assortment fit in ${top.label}, then test one focused offer before expanding into the next-ranked segment.`,
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Top Segment", value: top.label },
      { label: "Brand Count", value: `${top.brandCount}` },
      { label: "HHI", value: top.hhi.toFixed(2) },
      { label: "Segment Revenue MoM", value: densityGrowthDescription(top) },
      { label: "Previous Revenue Coverage", value: formatSharePercent(top.previousCoverage) },
      {
        label: "Own Share Pair",
        value: `${formatSharePercent(top.ownShare)} segment vs ${formatSharePercent(overallOwnShare)} overall`,
      },
    ],
    confidence: strictConditionsMet ? 0.9 : 0.72,
    assumptions: [
      typeScope
        ? `Analysis is restricted to products matching the parsed ${typeScopeLabel(typeScope)} type scope.`
        : "No explicit product type was requested, so all product types are analyzed.",
      "Segments are current-snapshot product type crossed with fixed price bands: <$50, $50-100, $100-200, $200-400, and $400+.",
      "Segments below 2% of total category revenue are excluded to avoid tiny-cluster false positives.",
      "Segment MoM growth compares matched ASIN revenue on the actual previous snapshot date and requires at least 80% current-revenue coverage.",
    ],
    citations: [
      citation("Competitive density", "current products grouped by type, price, and brand", mart.snapshot.date),
      citation("Segment growth", "ASIN product history", mart.snapshot.date),
    ],
    suggestedQuestions: [
      "Which price tier is growing fastest?",
      "Which segment is our best growth opportunity?",
      "Which competitor is threatening our top SKU?",
    ],
    warnings: [
      ...(strictConditionsMet
        ? []
        : ["No segment met every strict opportunity condition; the answer reports the closest qualifying segment above the revenue floor."]),
      ...(ranked.some((segment) => segment.previousCoverage < 0.8)
        ? ["At least one ranked segment has low-confidence MoM because matched-ASIN revenue coverage is below 80%."]
        : []),
    ],
    wantsLlmSynthesis: true,
    factPack: {
      analysis: "competitive_density",
      snapshot: mart.snapshot.date,
      method: {
        dimensions: ["product type", "price band"],
        revenueFloorShare: DENSITY_REVENUE_FLOOR_SHARE,
        stableGrowthFloor: -0.05,
        scoreWeights: {
          effectiveBrandBreadth: 0.3,
          lowHhi: 0.25,
          stableOrPositiveGrowth: 0.25,
          ownShareUnderweight: 0.2,
        },
      },
      overallOwnShare: round(overallOwnShare),
      strictConditionsMet,
      segments: ranked.map((segment) => ({
        label: segment.label,
        type: segment.type,
        priceBand: segment.priceBand,
        revenue: round(segment.revenue),
        revenueShare: round(segment.revenueShare),
        revenueMoM: nullableRound(segment.revenueMoM),
        previousCoverage: round(segment.previousCoverage),
        growthConfidence: segment.previousCoverage >= 0.8 ? "high" : "low",
        brandCount: segment.brandCount,
        hhi: round(segment.hhi),
        effectiveBrandCount: round(segment.effectiveBrandCount),
        ownShare: round(segment.ownShare),
        opportunityScore: round(segment.score),
      })),
    },
  }
}

function densitySegmentDescription(segment: DensitySegment, overallOwnShare: number) {
  return `${segment.label}: ${segment.brandCount} brands, HHI ${segment.hhi.toFixed(2)}, ${densityGrowthDescription(segment)}, our share ${formatSharePercent(segment.ownShare)} vs ${formatSharePercent(overallOwnShare)} overall`
}

function densityGrowthDescription(segment: DensitySegment) {
  return segment.revenueMoM === null
    ? `revenue MoM low-confidence (${formatSharePercent(segment.previousCoverage)} matched-revenue coverage)`
    : `${formatPercent(segment.revenueMoM)} revenue MoM`
}

function densityPriceBand(price: number) {
  const normalizedPrice = Math.max(0, safe(price))
  return DENSITY_PRICE_BANDS.find(
    (band) => normalizedPrice >= band.min && normalizedPrice < band.max
  )?.label ?? "$400+"
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round(value: number, decimals = 4) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

function nullableRound(value: number | null) {
  return value === null ? null : round(value)
}

function listRolling12Brands(snapshot: SnapshotSummary) {
  const ordered = [
    ...(snapshot.rolling12?.revenue?.brands ?? []).map((row) => row.brand),
    ...(snapshot.rolling12?.units?.brands ?? []).map((row) => row.brand),
  ]

  const seen = new Set<string>()
  const brands: string[] = []
  for (const brand of ordered) {
    const trimmed = brand.trim()
    if (!trimmed) continue
    const key = normalize(trimmed)
    if (seen.has(key)) continue
    seen.add(key)
    brands.push(trimmed)
  }
  return brands
}

function analyzeFastestGrowth(
  params: AnalyzerParams,
  brandArchetypes: Map<string, SalesArchetype>
): AnalyzerOutput {
  const { mart } = params
  const metric = params.parsed.plan.rankingMetric
  const window = params.parsed.plan.growthWindow
  const level = params.parsed.plan.targetLevel

  if (level === "type" || params.parsed.plan.typeScope) {
    return analyzeTypeGrowth(params)
  }

  if (level === "asin") {
    const headlineRevenueGate = asinHeadlinePriorRevenueGate(mart)
    const growthRows = getScopedProducts(mart, params.scope)
      .map((product) => {
        const yoyPoint = findHistoryPoint(product.history, mart.yoy?.date)
        const previousPoint = findHistoryPoint(product.history, mart.previous?.date)
        const mom = metric === "units" ? safe(product.unitsMoM) : safe(product.revenueMoM)
        const yoy =
          metric === "units"
            ? ratio(product.units, safe(yoyPoint?.units))
            : ratio(product.revenue, safe(yoyPoint?.revenue))
        const growth = growthForWindow(window, mom, yoy)
        const priorRevenue = previousPoint?.revenue ?? null
        const revenueDelta = priorRevenue === null ? null : product.revenue - priorRevenue
        return { product, mom, yoy, growth, priorRevenue, revenueDelta }
      })
      .filter((row) => row.growth !== null)
      .sort((a, b) => safe(b.growth) - safe(a.growth))
    const ranked = growthRows.slice(0, 5)
    const eligibleHeadline = growthRows.find(
      (row) => row.priorRevenue !== null && row.priorRevenue >= headlineRevenueGate
    )
    const fallbackHeadline = [...growthRows]
      .filter((row) => row.revenueDelta !== null)
      .sort((a, b) => safe(b.revenueDelta) - safe(a.revenueDelta))[0]
    const top = eligibleHeadline ?? fallbackHeadline
    const usedAbsoluteDeltaFallback = !eligibleHeadline && Boolean(fallbackHeadline)

    if (!top) {
      return unknownOutput(mart, "I couldn't find ASIN growth results for the requested scope.")
    }

    return {
      answer: usedAbsoluteDeltaFallback
        ? `No ASIN met the prior-month revenue headline gate of ${formatCurrency(headlineRevenueGate)}; using absolute revenue delta instead, ${productLabel(mart, top.product)} had the largest revenue delta at ${formatCurrency(safe(top.revenueDelta))}.`
        : `Fastest ${metric} growth ASIN (${windowLabel(window)}): ${productLabel(mart, top.product)}.`,
      bullets: ranked.map(
        (row, index) =>
          `#${index + 1} ${productLabel(mart, row.product)}: ${formatPercent(row.growth)} (${windowLabel(window)}), ${formatCurrency(row.product.revenue)} revenue, ${formatNumber(row.product.units)} units.`
      ),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Target Level", value: "ASIN" },
        { label: "Window", value: windowLabel(window) },
        { label: "Metric", value: metric.toUpperCase() },
        { label: "Headline Prior Revenue", value: formatCurrency(top.priorRevenue ?? 0) },
        { label: "Headline Revenue Gate", value: formatCurrency(headlineRevenueGate) },
      ],
      confidence: 0.86,
      assumptions: [
        "ASIN growth compares current month against previous month and prior-year month when available.",
        "Percentage-growth headlines require prior-month revenue of at least $10,000 or 0.1% of category revenue, whichever is smaller.",
      ],
      citations: [citation("ASIN growth", "products + history windows", mart.snapshot.date)],
      suggestedQuestions: [
        `Who is the biggest competitor to ${productLabel(mart, top.product)}?`,
        `Is ${top.product.brand} growth driven by price or units?`,
        "Which brands grew fastest in handheld tools?",
      ],
      warnings: usedAbsoluteDeltaFallback
        ? ["No ASIN met the percentage-growth headline revenue gate; the headline uses absolute revenue delta."]
        : [],
      historicalWindow: "12m",
    }
  }

  const scopedRows =
    params.scope.mode === "all_brands"
      ? mart.snapshot.brandTotals
      : mart.snapshot.brandTotals.filter((row) =>
          params.scope.brands.map((brand) => normalize(brand)).includes(normalize(row.brand))
        )
  const ranked = scopedRows
    .map((row) => {
      const key = normalize(row.brand)
      const prevRow = (mart.previous?.brandTotals ?? []).find((item) => normalize(item.brand) === key)
      const yoyRow = (mart.yoy?.brandTotals ?? []).find((item) => normalize(item.brand) === key)
      const mom = metric === "units" ? ratio(row.units, safe(prevRow?.units)) : ratio(row.revenue, safe(prevRow?.revenue))
      const yoy = metric === "units" ? ratio(row.units, safe(yoyRow?.units)) : ratio(row.revenue, safe(yoyRow?.revenue))
      const growth = growthForWindow(window, mom, yoy)
      return { row, mom, yoy, growth }
    })
    .filter((item) => item.growth !== null)
    .sort((a, b) => safe(b.growth) - safe(a.growth))
    .slice(0, 5)

  const top = ranked[0]
  if (!top) {
    return unknownOutput(mart, "I couldn't find brand growth results for the requested scope.")
  }
  const topContributors = buildBrandTopContributors(mart, top.row.brand).slice(0, 3)
  const topArchetype = brandArchetypes.get(normalize(top.row.brand)) ?? "balanced"

  return {
    answer: `Fastest ${metric} growth brand (${windowLabel(window)}): ${top.row.brand}.`,
    bullets: [
      ...ranked.map(
        (item, index) =>
          `#${index + 1} ${item.row.brand}: ${formatPercent(item.growth)} (${windowLabel(window)}), ${formatCurrency(item.row.revenue)} revenue, ${formatNumber(item.row.units)} units.`
      ),
      `Current growth profile for ${top.row.brand}: ${toArchetypeLabel(topArchetype)}.`,
      ...topContributors.map(
        (item) =>
          `${contributorLabel(mart, item)}: ${formatCurrency(item.revenue)} revenue, ${formatNumber(item.units)} units, trend ${item.trend}.`
      ),
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Target Level", value: "Brand" },
      { label: "Window", value: windowLabel(window) },
      { label: "Metric", value: metric.toUpperCase() },
      { label: "Top Growth", value: top.row.brand },
    ],
    confidence: 0.88,
    assumptions: ["Brand growth compares current month versus previous month and prior-year month when available."],
    citations: [citation("Brand growth", "snapshot.brandTotals + historical snapshots", mart.snapshot.date)],
    suggestedQuestions: [
      `Show top ASIN contributors for ${top.row.brand}.`,
      `Is ${top.row.brand} growth driven by units or price?`,
      "Who is the fastest rank mover by units this month?",
    ],
    warnings: [],
    historicalWindow: "12m",
    salesArchetype: topArchetype,
    topContributors,
  }
}

function analyzeFastestRankMover(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const rankTarget = params.parsed.plan.rankingTarget
  const metric = rankMetricFromTarget(rankTarget)
  const targetLevel = params.parsed.plan.targetLevel
  const previousLabel = mart.previous?.label ?? "previous snapshot"

  if (targetLevel === "asin") {
    const ranked = getScopedProducts(mart, params.scope)
      .map((product) => {
        const prev = product.history[product.history.length - 2]
        const currentRank = metric === "units" ? product.rankUnits : product.rankRevenue
        const prevRank = metric === "units" ? prev?.rankUnits ?? null : prev?.rankRevenue ?? null
        const delta =
          prevRank !== null && currentRank !== null && currentRank > 0
            ? prevRank - currentRank
            : null
        return { product, currentRank, prevRank, delta }
      })
      .filter((row) => row.delta !== null)
      .sort((a, b) => safe(b.delta) - safe(a.delta))
      .slice(0, 5)

    const top = ranked[0]
    if (!top || top.delta === null) {
      return unknownOutput(mart, "I couldn't compute ASIN rank movement from available snapshots.")
    }
    return {
      answer: `Fastest ASIN rank mover (${metric} rank): ${productLabel(mart, top.product)} (${signedRankDelta(top.delta)}).`,
      bullets: ranked.map(
        (row, index) =>
          `#${index + 1} ${productLabel(mart, row.product)}: ${formatRank(row.prevRank)} -> ${formatRank(row.currentRank)} (${signedRankDelta(row.delta)}).`
      ),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Target Level", value: "ASIN" },
        { label: "Rank Target", value: rankTarget },
        { label: "Baseline", value: previousLabel },
      ],
      confidence: 0.84,
      assumptions: ["Rank mover compares current rank versus immediately previous snapshot rank."],
      citations: [citation("ASIN rank movement", "product history ranks", mart.snapshot.date)],
      suggestedQuestions: [
        `How did ${productLabel(mart, top.product)} perform by revenue and units?`,
        `Who competes closest with ${productLabel(mart, top.product)}?`,
        "Who is the fastest rank mover by revenue this month?",
      ],
      warnings: [],
    }
  }

  const ranked = mart.snapshot.brandTotals
    .map((row) => {
      const currentRank = rankForBrandByMetric(mart.snapshot, row.brand, metric)
      const prevRank = mart.previous ? rankForBrandByMetric(mart.previous, row.brand, metric) : null
      const delta = prevRank !== null && currentRank !== null ? prevRank - currentRank : null
      return { brand: row.brand, currentRank, prevRank, delta, revenue: row.revenue, units: row.units }
    })
    .filter((row) => row.delta !== null)
    .sort((a, b) => safe(b.delta) - safe(a.delta))
    .slice(0, 5)

  const top = ranked[0]
  if (!top || top.delta === null) {
    return unknownOutput(mart, "I couldn't compute brand rank movement from available snapshots.")
  }

  return {
    answer: `Fastest brand rank mover (${metric} rank): ${top.brand} (${signedRankDelta(top.delta)} vs ${previousLabel}).`,
    bullets: ranked.map(
      (row, index) =>
        `#${index + 1} ${row.brand}: ${formatRank(row.prevRank)} -> ${formatRank(row.currentRank)} (${signedRankDelta(row.delta)}), ${formatCurrency(row.revenue)} revenue, ${formatNumber(row.units)} units.`
    ),
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Target Level", value: "Brand" },
      { label: "Rank Target", value: rankTarget },
      { label: "Baseline", value: previousLabel },
    ],
    confidence: 0.87,
    assumptions: ["Rank mover compares current rank versus immediately previous snapshot rank."],
    citations: [citation("Brand rank movement", "snapshot.brandTotals rankings", mart.snapshot.date)],
    suggestedQuestions: [
      `Show top ASIN contributors for ${top.brand}.`,
      `Is ${top.brand} growth driven by units or ASP?`,
      "Which handheld/tablet/dongle segment is growing fastest MoM and YoY?",
    ],
    warnings: [],
  }
}

function analyzeTypeGrowth(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const metric = params.parsed.plan.rankingMetric
  const window = params.parsed.plan.growthWindow
  const typeScope = params.parsed.plan.typeScope

  if (typeScope) {
    const brandRows = aggregateTypeBrandGrowth(mart, typeScope)
      .map((row) => ({
        ...row,
        growth: growthForWindow(
          window,
          metric === "units" ? row.momUnits : row.momRevenue,
          metric === "units" ? row.yoyUnits : row.yoyRevenue
        ),
      }))
      .filter((row) => row.growth !== null)
      .sort((a, b) => safe(b.growth) - safe(a.growth))
      .slice(0, 5)

    const top = brandRows[0]
    if (!top) {
      return unknownOutput(mart, `I couldn't find ${typeScopeLabel(typeScope)} growth results from the current snapshot.`)
    }

    return {
      answer: `Fastest ${typeScopeLabel(typeScope)} growth brand (${windowLabel(window)}, ${metric}): ${top.brand}.`,
      bullets: brandRows.map(
        (row, index) =>
          `#${index + 1} ${row.brand}: ${formatPercent(row.growth)} (${windowLabel(window)}), ${formatCurrency(row.revenue)} revenue, ${formatNumber(row.units)} units.`
      ),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Target Level", value: "Type > Brand" },
        { label: "Type Scope", value: typeScopeLabel(typeScope) },
        { label: "Window", value: windowLabel(window) },
      ],
      confidence: 0.84,
      assumptions: ["Type growth is aggregated from ASIN-level monthly metrics within the selected type scope."],
      citations: [citation("Type scoped growth", "product history grouped by type and brand", mart.snapshot.date)],
      suggestedQuestions: [
        `Is ${top.brand} in ${typeScopeLabel(typeScope)} growth driven by units or ASP?`,
        `Which products grew revenue fastest in ${typeScopeLabel(typeScope)} this month?`,
        `Show ${top.brand} top ASINs and past performance.`,
      ],
      warnings: [],
    }
  }

  const typeRows = (mart.snapshot.typeBreakdowns?.allAsins ?? [])
    .filter((row) => isCanonicalTypeScope(row.scopeKey))
    .map((row) => {
      const mom = metric === "units" ? row.unitsMoM : row.revenueMoM
      const yoy = metric === "units" ? row.unitsYoY : row.revenueYoY
      const growth = growthForWindow(window, mom, yoy)
      return { row, growth }
    })
    .filter((item) => item.growth !== null)
    .sort((a, b) => safe(b.growth) - safe(a.growth))
    .slice(0, 5)

  const top = typeRows[0]
  if (!top) {
    return unknownOutput(mart, "I couldn't find type-level growth metrics for this snapshot.")
  }

  return {
    answer: `Fastest growth product type (${windowLabel(window)}, ${metric}): ${top.row.label}.`,
    bullets: typeRows.map(
      (item, index) =>
        `#${index + 1} ${item.row.label}: ${formatPercent(item.growth)} (${windowLabel(window)}), ${formatCurrency(item.row.revenue)} revenue, ${formatNumber(item.row.units)} units.`
    ),
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Target Level", value: "Type" },
      { label: "Window", value: windowLabel(window) },
      { label: "Metric", value: metric.toUpperCase() },
    ],
    confidence: 0.82,
    assumptions: ["Type-level growth uses parsed Summary/Analysis type scopes when available."],
    citations: [citation("Type growth", "snapshot.typeBreakdowns.allAsins", mart.snapshot.date)],
    suggestedQuestions: [
      `Which brand has the fastest revenue growth in ${top.row.label}?`,
      `Is ${top.row.label} growth driven by units or price?`,
      "Who is the fastest rank mover by units this month?",
    ],
    warnings: [],
  }
}

function analyzeGrowthDriver(
  params: AnalyzerParams,
  brandArchetypes: Map<string, SalesArchetype>
): AnalyzerOutput {
  const { mart } = params
  const typeScope = params.parsed.plan.typeScope
  const explicitBrand = params.scope.mode !== "all_brands" ? params.scope.brands[0] : undefined

  if (typeScope) {
    const current = aggregateTypeTotals(mart, typeScope, "current")
    const previous = aggregateTypeTotals(mart, typeScope, "previous")
    const driver = computeDriverBreakdown(current.revenue, current.units, previous.revenue, previous.units)
    return {
      answer: `${typeScopeLabel(typeScope)} growth is primarily ${driver.primaryDriver}-driven (${windowLabel(params.parsed.plan.growthWindow)} context).`,
      bullets: [
        `${typeScopeLabel(typeScope)} monthly revenue ${formatCurrency(current.revenue)} (${formatPercent(ratio(current.revenue, previous.revenue))} MoM).`,
        `${typeScopeLabel(typeScope)} monthly units ${formatNumber(current.units)} (${formatPercent(ratio(current.units, previous.units))} MoM).`,
        `Driver split: unit effect ${formatCurrency(driver.unitEffect)}, price effect ${formatCurrency(driver.priceEffect)}.`,
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Scope", value: typeScopeLabel(typeScope) },
        { label: "Primary Driver", value: driver.primaryDriver.toUpperCase() },
      ],
      confidence: 0.83,
      assumptions: ["Growth driver decomposition uses ASP bridge between current and previous month."],
      citations: [citation("Type growth driver", "type-scoped product aggregation", mart.snapshot.date)],
      suggestedQuestions: [
        `Which ${typeScopeLabel(typeScope)} brand has the fastest revenue growth?`,
        `Which products grew revenue fastest in ${typeScopeLabel(typeScope)} this month?`,
        "Which products grew revenue fastest this month?",
      ],
      warnings: [],
    }
  }

  if (explicitBrand) {
    const stats = summarizeBrandCurrent(mart, explicitBrand)
    if (!stats) {
      return unknownOutput(mart, `I couldn't find growth-driver details for ${explicitBrand.toUpperCase()}.`)
    }
    const prevRow = (mart.previous?.brandTotals ?? []).find(
      (item) => normalize(item.brand) === normalize(stats.brand)
    )
    const driver = computeDriverBreakdown(
      stats.revenue,
      stats.units,
      safe(prevRow?.revenue),
      safe(prevRow?.units)
    )
    const revenueRank = rankForBrandByMetric(mart.snapshot, stats.brand, "revenue")
    const unitsRank = rankForBrandByMetric(mart.snapshot, stats.brand, "units")
    const archetype = brandArchetypes.get(normalize(stats.brand)) ?? "balanced"
    return {
      answer: `${stats.brand} performance is mainly ${driver.primaryDriver}-driven this month.`,
      bullets: [
        `${stats.brand} monthly revenue ${formatCurrency(stats.revenue)}, monthly units ${formatNumber(stats.units)}.`,
        `${stats.brand} rank: #${revenueRank ?? "n/a"} by revenue, #${unitsRank ?? "n/a"} by units.`,
        `ASP ${formatCurrency(stats.asp)} and profile is ${toArchetypeLabel(archetype)}.`,
        `Driver split: unit effect ${formatCurrency(driver.unitEffect)}, price effect ${formatCurrency(driver.priceEffect)}.`,
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Scope", value: stats.brand },
        { label: "Primary Driver", value: driver.primaryDriver.toUpperCase() },
        { label: "Revenue Rank", value: `#${revenueRank ?? "n/a"}` },
        { label: "Units Rank", value: `#${unitsRank ?? "n/a"}` },
      ],
      confidence: 0.9,
      assumptions: ["Brand driver decomposition uses monthly revenue/units and ASP bridge vs prior month."],
      citations: [citation("Brand growth driver", "snapshot.brandTotals + prior snapshot", mart.snapshot.date)],
      suggestedQuestions: [
        `Show top ASIN contributors for ${stats.brand}.`,
        `Where does ${stats.brand} rank in revenue and units this month?`,
        `Which ${stats.brand} products are growing fastest?`,
      ],
      warnings: [],
      salesArchetype: archetype,
      topContributors: buildBrandTopContributors(mart, stats.brand).slice(0, 3),
    }
  }

  const driver = computeDriverBreakdown(
    mart.snapshot.totals.revenue,
    mart.snapshot.totals.units,
    safe(mart.previous?.totals.revenue),
    safe(mart.previous?.totals.units)
  )
  return {
    answer: `Market growth is currently ${driver.primaryDriver}-driven.`,
    bullets: [
      `Market monthly revenue ${formatCurrency(mart.snapshot.totals.revenue)} (${formatPercent(ratio(mart.snapshot.totals.revenue, safe(mart.previous?.totals.revenue)))} MoM).`,
      `Market monthly units ${formatNumber(mart.snapshot.totals.units)} (${formatPercent(ratio(mart.snapshot.totals.units, safe(mart.previous?.totals.units)))} MoM).`,
      `Driver split: unit effect ${formatCurrency(driver.unitEffect)}, price effect ${formatCurrency(driver.priceEffect)}.`,
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Scope", value: "MARKET" },
      { label: "Primary Driver", value: driver.primaryDriver.toUpperCase() },
    ],
    confidence: 0.8,
    assumptions: ["Market driver decomposition uses total monthly revenue/units and ASP bridge vs prior month."],
    citations: [citation("Market growth driver", "snapshot totals vs prior month", mart.snapshot.date)],
    suggestedQuestions: [
      "Is market growth driven by price or units?",
      "Who is the fastest growth brand by units?",
      "Who is the fastest rank mover this month?",
    ],
    warnings: [],
  }
}

function analyzePriceTierGrowth(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const metric = params.parsed.plan.rankingMetric
  const window = params.parsed.plan.growthWindow

  const rankedTiers = mart.priceScopeMetrics
    .filter(isDetailedPriceTierMetric)
    .map((row) => {
      const mom = metric === "units" ? row.unitsMoM : row.revenueMoM
      const yoy = metric === "units" ? row.unitsYoY : row.revenueYoY
      const growth = growthForWindow(window, mom, yoy)
      return { row, growth }
    })
    .filter((item) => item.growth !== null)
    .sort((a, b) => safe(b.growth) - safe(a.growth))
    .slice(0, 5)

  const topTier = rankedTiers[0]
  if (!topTier) {
    const fallbackTier = [...mart.snapshot.priceTiers].sort((a, b) => b.revenue - a.revenue)[0]
    if (!fallbackTier) {
      return unknownOutput(mart, "I couldn't find price-tier metrics in this snapshot.")
    }
    return {
      answer: `Price-tier growth data is limited in this snapshot. Largest tier by revenue is ${fallbackTier.label}.`,
      bullets: mart.snapshot.priceTiers
        .slice()
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 4)
        .map((tier) => `${tier.label}: ${formatCurrency(tier.revenue)} revenue (${formatPercent(tier.share)} share).`),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Scope", value: "Price Tiers" },
        { label: "Top Tier", value: fallbackTier.label },
      ],
      confidence: 0.7,
      assumptions: ["Detailed tier growth was missing; fallback uses current-tier revenue mix only."],
      citations: [citation("Price tiers fallback", "snapshot.priceTiers", mart.snapshot.date)],
      suggestedQuestions: [
        "Which handheld/tablet/dongle segment is growing fastest MoM and YoY?",
        "Who is the fastest growth brand by revenue?",
        "Who is the fastest growth brand by units?",
      ],
      warnings: ["Detailed price-tier MoM/YoY metrics are not fully available for this month."],
    }
  }

  return {
    answer: `Fastest growing price tier (${windowLabel(window)}, ${metric}): ${topTier.row.label}.`,
    bullets: rankedTiers.map(
      (item, index) =>
        `#${index + 1} ${item.row.label}: ${formatPercent(item.growth)} (${windowLabel(window)}), ${formatCurrency(item.row.revenue)} revenue, ${formatNumber(item.row.units)} units.`
    ),
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Scope", value: "Price Tiers" },
      { label: "Window", value: windowLabel(window) },
      { label: "Metric", value: metric.toUpperCase() },
    ],
    confidence: 0.85,
    assumptions: ["Price-tier growth uses parsed type/price-scope metrics from analysis/summary tables."],
    citations: [citation("Price-tier growth", "snapshot.typeBreakdowns.allAsins", mart.snapshot.date)],
    suggestedQuestions: [
      "Which handheld/tablet/dongle segment is growing fastest MoM and YoY?",
      "Who is the fastest growth brand by revenue?",
      "Who is the fastest growth brand by units?",
    ],
    warnings: [],
  }
}

function analyzeBrandComparison(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const explicitBrands = unique([
    ...params.entities.brands,
    ...(params.scope.mode === "explicit_brand" || params.scope.mode === "target_brand" ? params.scope.brands : []),
  ])

  const selectedBrands =
    explicitBrands.length >= 2
      ? explicitBrands.slice(0, 2)
      : mart.snapshot.brandTotals
          .slice()
          .sort((a, b) => b.revenue - a.revenue)
          .slice(0, 2)
          .map((row) => row.brand)

  const [firstBrand, secondBrand] = selectedBrands
  if (!firstBrand || !secondBrand) {
    return unknownOutput(mart, "I couldn't find two brands to compare in this snapshot.")
  }

  const left = summarizeBrandCurrent(mart, firstBrand)
  const right = summarizeBrandCurrent(mart, secondBrand)
  if (!left || !right) {
    return unknownOutput(mart, `I couldn't compare ${firstBrand} and ${secondBrand} from current data.`)
  }

  const leftRank = rankForBrandByMetric(mart.snapshot, left.brand, "revenue")
  const rightRank = rankForBrandByMetric(mart.snapshot, right.brand, "revenue")
  const aspGap = left.asp - right.asp
  const revenueGap = left.revenue - right.revenue
  const unitsGap = left.units - right.units
  const leftRolling12 = getBrandRolling12GrandTotals(mart.snapshot, left.brand)
  const rightRolling12 = getBrandRolling12GrandTotals(mart.snapshot, right.brand)
  const rolling12Requested = isExplicitRolling12Request(params.parsed.normalized)

  return {
    answer:
      rolling12Requested && leftRolling12 && rightRolling12
        ? leftRolling12.revenueGrandTotal >= rightRolling12.revenueGrandTotal
          ? `${left.brand} is ahead of ${right.brand} on Rolling 12 grand total revenue by ${formatCurrency(leftRolling12.revenueGrandTotal - rightRolling12.revenueGrandTotal)}.`
          : `${right.brand} is ahead of ${left.brand} on Rolling 12 grand total revenue by ${formatCurrency(rightRolling12.revenueGrandTotal - leftRolling12.revenueGrandTotal)}.`
        : revenueGap >= 0
          ? `${left.brand} is ahead of ${right.brand} by ${formatCurrency(revenueGap)} monthly revenue.`
          : `${right.brand} is ahead of ${left.brand} by ${formatCurrency(Math.abs(revenueGap))} monthly revenue.`,
    bullets: [
      leftRolling12 && rightRolling12
        ? `Rolling 12 totals: ${left.brand} ${formatCurrency(leftRolling12.revenueGrandTotal)} / ${formatNumber(leftRolling12.unitsGrandTotal)} units vs ${right.brand} ${formatCurrency(rightRolling12.revenueGrandTotal)} / ${formatNumber(rightRolling12.unitsGrandTotal)} units.`
        : "Rolling 12 grand totals are unavailable for one or both brands.",
      `${left.brand}: rank #${leftRank ?? "n/a"}, ${formatCurrency(left.revenue)} revenue, ${formatNumber(left.units)} units, ASP ${formatCurrency(left.asp)}.`,
      `${right.brand}: rank #${rightRank ?? "n/a"}, ${formatCurrency(right.revenue)} revenue, ${formatNumber(right.units)} units, ASP ${formatCurrency(right.asp)}.`,
      `Gap summary: units ${formatSignedNumber(unitsGap)}, ASP ${formatSignedCurrencyRaw(aspGap)}.`,
      `${left.brand} share ${formatPercent(left.revenueShare)} vs ${right.brand} share ${formatPercent(right.revenueShare)}.`,
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Brand A", value: left.brand },
      { label: "Brand B", value: right.brand },
      { label: "Revenue Gap", value: formatSignedCurrencyRaw(revenueGap) },
      ...(leftRolling12 && rightRolling12
        ? [
            { label: `${left.brand} Rolling 12`, value: formatCurrency(leftRolling12.revenueGrandTotal) },
            { label: `${right.brand} Rolling 12`, value: formatCurrency(rightRolling12.revenueGrandTotal) },
          ]
        : []),
    ],
    confidence: 0.87,
    assumptions: ["Brand comparison uses current-month brand totals and revenue-rank ordering."],
    citations: [
      citation("Brand comparison", "snapshot.brandTotals", mart.snapshot.date),
      ...(leftRolling12 && rightRolling12
        ? [citation("Rolling 12 brand totals", "snapshot.rolling12", mart.snapshot.date)]
        : []),
    ],
    suggestedQuestions: [
      "Which brand is closing the gap fastest?",
      "Who is the fastest rank mover this month?",
      `What are ${left.brand}'s Rolling 12 grand total revenue and units?`,
    ],
    warnings: [],
  }
}

function analyzeTrendsMomentum(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const scopedProducts = getScopedProducts(mart, params.scope)
  const headlineRevenueGate = asinHeadlinePriorRevenueGate(mart)
  const products = scopedProducts
    .map((product) => {
      const previousPoint = findHistoryPoint(product.history, mart.previous?.date)
      const priorRevenue = previousPoint?.revenue ?? null
      return {
        product,
        momentum: safe(product.revenueMoM),
        priorRevenue,
        revenueDelta: priorRevenue === null ? null : product.revenue - priorRevenue,
      }
    })
    .sort((a, b) => b.momentum - a.momentum)

  const scopedBrandKeys = new Set(scopedProducts.map((product) => normalize(product.brand)))
  const brandMovers = mart.snapshot.brandTotals
    .filter((row) => params.scope.mode === "all_brands" || scopedBrandKeys.has(normalize(row.brand)))
    .map((row) => {
      const prev = (mart.previous?.brandTotals ?? []).find((item) => normalize(item.brand) === normalize(row.brand))
      return { brand: row.brand, delta: ratio(row.revenue, safe(prev?.revenue)) }
    })
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3)

  const isHeadlineEligible = (item: (typeof products)[number]) =>
    item.priorRevenue !== null && item.priorRevenue >= headlineRevenueGate
  const gatedProducts = products.filter(isHeadlineEligible)
  const eligibleHeadline = gatedProducts[0]
  const fallbackHeadline = [...products]
    .filter((item) => item.revenueDelta !== null)
    .sort((a, b) => safe(b.revenueDelta) - safe(a.revenueDelta))[0]
  const topRise = eligibleHeadline ?? fallbackHeadline
  const usedAbsoluteDeltaFallback = !eligibleHeadline && Boolean(fallbackHeadline)
  if (!topRise) {
    return unknownOutput(mart, "I couldn't compute momentum signals from this snapshot.")
  }
  const rising = usedAbsoluteDeltaFallback ? [topRise] : gatedProducts.slice(0, 3)
  const decliningPool = gatedProducts.length ? gatedProducts : products
  const declining = [...decliningPool].reverse().slice(0, 2)
  const smallBaseLabel = (item: (typeof products)[number]) =>
    isHeadlineEligible(item) ? "" : " (small base)"

  return {
    answer: usedAbsoluteDeltaFallback
      ? `No product met the prior-month revenue headline gate of ${formatCurrency(headlineRevenueGate)}; using absolute revenue delta instead, ${productLabel(mart, topRise.product)} had the largest revenue delta at ${formatCurrency(safe(topRise.revenueDelta))}${declining[0] ? `; ${productLabel(mart, declining[0].product)} declined most at ${formatPercent(declining[0].product.revenueMoM)}` : ""}.`
      : `${productLabel(mart, topRise.product)} grew fastest in the requested scope at ${formatPercent(topRise.product.revenueMoM)} revenue MoM${declining[0] ? `; ${productLabel(mart, declining[0].product)} declined most at ${formatPercent(declining[0].product.revenueMoM)}` : ""}.`,
    bullets: [
      ...rising.map(
        (item, index) =>
          `Rising #${index + 1}: ${productLabel(mart, item.product)}${smallBaseLabel(item)} (${formatPercent(item.product.revenueMoM)} revenue MoM, ${formatPercent(item.product.unitsMoM)} units MoM).`
      ),
      ...declining.map(
        (item, index) =>
          `Declining #${index + 1}: ${productLabel(mart, item.product)}${smallBaseLabel(item)} (${formatPercent(item.product.revenueMoM)} revenue MoM).`
      ),
      ...brandMovers.map((item) => `Brand momentum: ${item.brand} ${formatPercent(item.delta)} revenue MoM.`),
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Top Momentum Product", value: productEvidenceValue(mart, topRise.product) },
      { label: "Revenue MoM", value: formatPercent(topRise.product.revenueMoM) },
      { label: "Headline Prior Revenue", value: formatCurrency(topRise.priorRevenue ?? 0) },
      { label: "Headline Revenue Gate", value: formatCurrency(headlineRevenueGate) },
    ],
    confidence: 0.86,
    assumptions: [
      "Momentum uses month-over-month change in product and brand revenue within the resolved brand scope.",
      "Percentage-growth headlines require prior-month revenue of at least $10,000 or 0.1% of category revenue, whichever is smaller.",
    ],
    citations: [citation("Momentum signals", "products + brandTotals vs prior snapshot", mart.snapshot.date)],
    suggestedQuestions: [
      params.scope.mode === "own_brands" ? "Which of our products grew fastest this month?" : "Which products are rising fastest now?",
      "Who is the fastest growth brand this month (MoM)?",
      "Who is the fastest rank mover this month?",
    ],
    warnings: usedAbsoluteDeltaFallback
      ? ["No product met the percentage-growth headline revenue gate; the headline uses absolute revenue delta."]
      : [],
  }
}

function asinHeadlinePriorRevenueGate(mart: AnalyzerParams["mart"]) {
  return Math.min(
    ASIN_HEADLINE_PRIOR_REVENUE_MAX,
    Math.max(0, mart.snapshot.totals.revenue) * ASIN_HEADLINE_CATEGORY_REVENUE_SHARE
  )
}

function analyzeRatingReviews(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const strongQuality = mart.products
    .filter((item) => item.rating >= 4.0 && item.revenue >= 100_000)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4)
  const mismatches = mart.products
    .filter((item) => item.revenue >= 200_000)
    .sort((a, b) => a.rating - b.rating)
    .slice(0, 3)

  if (!strongQuality.length && !mismatches.length) {
    return unknownOutput(mart, "I couldn't find rating/review signals with enough coverage in this snapshot.")
  }

  const top = strongQuality[0] ?? mismatches[0]
  return {
    answer: top
      ? `Rating-performance signal: ${productLabel(mart, top)} combines ${top.rating.toFixed(1)}★ with ${formatCurrency(top.revenue)} monthly revenue.`
      : "Rating-performance signal is limited in this snapshot.",
    bullets: [
      ...strongQuality.map(
        (item) =>
          `High-quality leader: ${productLabel(mart, item)} (${item.rating.toFixed(1)}★, ${formatNumber(item.reviews)} reviews, ${formatCurrency(item.revenue)} revenue).`
      ),
      ...mismatches.map(
        (item) =>
          `Price-quality risk: ${productLabel(mart, item)} has ${formatCurrency(item.revenue)} revenue but rating ${item.rating.toFixed(1)}★.`
      ),
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "High-Quality Leaders", value: `${strongQuality.length}` },
      { label: "Mismatch Signals", value: `${mismatches.length}` },
    ],
    confidence: 0.81,
    assumptions: ["Rating and review analysis uses current-month product ratings/reviews with revenue thresholds."],
    citations: [citation("Rating/review analysis", "products (rating, reviews, revenue)", mart.snapshot.date)],
    suggestedQuestions: [
      "Any price-quality mismatch by brand?",
      "Which products are rising stars this month?",
      "What should I be worried about?",
    ],
    warnings: [],
  }
}

function analyzeFeatureAnalysis(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const tierRows = mart.priceScopeMetrics.filter(isDetailedPriceTierMetric)
  const topTier = tierRows
    .slice()
    .sort((a, b) => safe(b.revenueShare) - safe(a.revenueShare))[0]

  return {
    answer:
      "An exact feature premium cannot be measured from this snapshot because feature columns are inconsistent; the best available directional proxy is type and price tier.",
    bullets: [
      topTier
        ? `Highest-weight proxy tier: ${topTier.label} (${formatPercent(topTier.revenueShare)} revenue share, avg price ${formatCurrency(topTier.avgPrice)}).`
        : "No detailed tier-level proxy was available this month.",
      "For exact feature premium (for example Wi-Fi, true RMS, articulation), we need explicit feature columns in the source workbook.",
      "You can still compare premium vs volume posture through ASP, units, and revenue movement by type scope.",
    ],
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Feature Columns", value: "Partial / not standardized" },
      { label: "Proxy Source", value: "Type + Price Tier metrics" },
    ],
    confidence: topTier ? 0.72 : 0.62,
    assumptions: ["Feature analysis falls back to price-tier/type proxies when structured feature fields are missing."],
    citations: [citation("Feature proxy analysis", "snapshot.typeBreakdowns", mart.snapshot.date)],
    suggestedQuestions: [
      "What price tier is growing fastest?",
      "Which handheld/tablet/dongle segment is growing fastest MoM and YoY?",
      "Which brand is closing the gap fastest?",
    ],
    warnings: topTier ? [] : ["Feature-level premium requires workbook fields that are missing in this snapshot."],
  }
}

function analyzeDataClarification(params: AnalyzerParams): AnalyzerOutput {
  const { mart } = params
  const normalized = params.parsed.normalized

  let answer =
    "Revenue and unit metrics in this dashboard are estimated market outputs from the monthly report pipeline, then normalized into snapshot tables."
  const bullets: string[] = [
    "MoM and YoY are computed using the nearest previous month and prior-year month snapshots when available.",
    "Market share is brand revenue divided by total market revenue for the same snapshot month.",
  ]

  if (/\b(other|other brand|other category)\b/.test(normalized)) {
    answer = "The 'Other' bucket represents brands/listings not broken out as named primary rows in the same scope table."
    bullets.push("It is a residual grouping, not a single company.")
  }
  if (/\b(estimated|actual|helium|source|revenue estimated)\b/.test(normalized)) {
    bullets.push("These values are treated as estimated market analytics, not direct confirmed POS transactions.")
  }
  if (/\b(share|jump|drop|flat|moved)\b/.test(normalized)) {
    bullets.push("Share can rise when your revenue is flat if total market revenue falls faster.")
  }

  return {
    answer,
    bullets,
    evidence: [
      ...baseEvidence(mart.snapshot),
      { label: "Source Mode", value: "Monthly snapshot normalization" },
      { label: "Window", value: "Current month vs prior month / prior year" },
    ],
    confidence: 0.78,
    assumptions: ["Clarification answers explain definitions used by the current dashboard data model."],
    citations: [citation("Definitions", "competitor-data snapshot model", mart.snapshot.date)],
    suggestedQuestions: [
      "How is revenue estimated in this report?",
      "Why did market share move while revenue stayed flat?",
      "What is included in Other brand category?",
    ],
    warnings: [],
  }
}

type TypeBrandGrowthRow = {
  brand: string
  revenue: number
  units: number
  momRevenue: number | null
  yoyRevenue: number | null
  momUnits: number | null
  yoyUnits: number | null
}

function aggregateTypeBrandGrowth(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  typeScope: ProductTypeScope
) {
  const rows = new Map<string, { brand: string; revenue: number; units: number; prevRevenue: number; prevUnits: number; yoyRevenue: number; yoyUnits: number }>()
  for (const product of mart.products) {
    if (!matchesTypeScope(product.type, typeScope)) continue
    const key = normalize(product.brand)
    const bucket = rows.get(key) ?? {
      brand: product.brand,
      revenue: 0,
      units: 0,
      prevRevenue: 0,
      prevUnits: 0,
      yoyRevenue: 0,
      yoyUnits: 0,
    }
    bucket.revenue += product.revenue
    bucket.units += product.units
    const prevPoint = product.history[product.history.length - 2]
    const yoyPoint = findHistoryPoint(product.history, mart.yoy?.date)
    bucket.prevRevenue += safe(prevPoint?.revenue)
    bucket.prevUnits += safe(prevPoint?.units)
    bucket.yoyRevenue += safe(yoyPoint?.revenue)
    bucket.yoyUnits += safe(yoyPoint?.units)
    rows.set(key, bucket)
  }
  return Array.from(rows.values()).map((row): TypeBrandGrowthRow => ({
    brand: row.brand,
    revenue: row.revenue,
    units: row.units,
    momRevenue: ratio(row.revenue, row.prevRevenue),
    yoyRevenue: ratio(row.revenue, row.yoyRevenue),
    momUnits: ratio(row.units, row.prevUnits),
    yoyUnits: ratio(row.units, row.yoyUnits),
  }))
}

function aggregateTypeTotals(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  typeScope: ProductTypeScope,
  frame: "current" | "previous"
) {
  if (frame === "previous") {
    const products = mart.products
      .filter((product) => matchesTypeScope(product.type, typeScope))
      .map((product) => product.history[product.history.length - 2])
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    return {
      revenue: sum(products.map((item) => item.revenue)),
      units: sum(products.map((item) => item.units)),
    }
  }
  const products = mart.products.filter((product) => matchesTypeScope(product.type, typeScope))
  return {
    revenue: sum(products.map((item) => item.revenue)),
    units: sum(products.map((item) => item.units)),
  }
}

function computeDriverBreakdown(currentRevenue: number, currentUnits: number, previousRevenue: number, previousUnits: number) {
  const currentAsp = currentUnits > 0 ? currentRevenue / currentUnits : 0
  const prevAsp = previousUnits > 0 ? previousRevenue / previousUnits : 0
  const deltaUnits = currentUnits - previousUnits
  const unitEffect = deltaUnits * prevAsp
  const priceEffect = currentUnits * (currentAsp - prevAsp)
  const primaryDriver = Math.abs(unitEffect) >= Math.abs(priceEffect) ? "units" : "price"
  return { unitEffect, priceEffect, primaryDriver }
}

function growthForWindow(window: "mom" | "yoy" | "both", mom: number | null, yoy: number | null) {
  if (window === "mom") return mom
  if (window === "yoy") return yoy
  if (mom === null && yoy === null) return null
  if (mom === null) return yoy
  if (yoy === null) return mom
  return (mom + yoy) / 2
}

function windowLabel(window: "mom" | "yoy" | "both") {
  if (window === "mom") return "MoM"
  if (window === "yoy") return "YoY"
  return "MoM + YoY"
}

function rankMetricFromTarget(target: "revenue_rank" | "units_rank" | "overall_rank"): "revenue" | "units" {
  if (target === "units_rank") return "units"
  return "revenue"
}

function signedRankDelta(value: number | null) {
  if (value === null) return "n/a"
  if (value === 0) return "0"
  return `${value > 0 ? "+" : ""}${Math.round(value)}`
}

function formatRank(value: number | null) {
  if (value === null) return "n/a"
  return `#${value}`
}

function findHistoryPoint(
  history: Array<{ date: string; revenue: number; units: number; rankRevenue: number | null; rankUnits: number | null }>,
  date?: string
) {
  if (!date) return undefined
  return history.find((point) => point.date === date)
}

function typeScopeLabel(scope: ProductTypeScope) {
  if (scope === "other_tools") return "Other Tools"
  return scope.charAt(0).toUpperCase() + scope.slice(1)
}

function matchesTypeScope(typeName: string, scope: ProductTypeScope) {
  const normalized = normalize(typeName)
  if (scope === "other_tools") return normalized.includes("other")
  if (scope === "handheld") return normalized.includes("handheld")
  if (scope === "dongle") return normalized.includes("dongle")
  return normalized.includes("tablet")
}

function finalizeAnalyzerOutput(
  analyzer: AnalyzerId,
  output: AnalyzerOutput,
  params: AnalyzerParams
): AnalyzerOutput {
  const marketLevel = isMarketLevelAnalyzer(analyzer, output, params)
  const evidence = output.evidence
    .filter(
      (item) =>
        marketLevel || (item.label !== "Market Revenue" && item.label !== "Market Units")
    )
    .slice(0, 5)

  return {
    ...output,
    bullets: output.bullets.map(ensureSentence).slice(0, 4),
    evidence,
    suggestedQuestions: finalizeSuggestedQuestions(output.suggestedQuestions),
  }
}

function isMarketLevelAnalyzer(
  analyzer: AnalyzerId,
  output: AnalyzerOutput,
  params: AnalyzerParams
) {
  if (
    analyzer === "market_size" ||
    analyzer === "market_shift" ||
    analyzer === "market_leader" ||
    analyzer === "market_concentration"
  ) {
    return true
  }
  return (
    analyzer === "brand_health" &&
    (params.scope.mode === "all_brands" || /^Total market\b/i.test(output.answer))
  )
}

function finalizeSuggestedQuestions(questions: string[]) {
  const fallbacks = [
    "Which competitor is threatening our top SKU?",
    "Which products are rising fastest this month?",
    "Where can we grow with lower competitive density?",
  ]
  const finalized: string[] = []
  for (const question of [...questions, ...fallbacks]) {
    if (!question || finalized.includes(question)) continue
    finalized.push(question)
    if (finalized.length === 3) break
  }
  return finalized
}

function productLabel(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  product: Pick<IndexedProduct, "asin" | "title" | "brand">
) {
  return mart.displayNameByAsin.get(normalize(product.asin)) ?? displayProductName(product)
}

// Evidence values pair the human name with the full ASIN, so the collision
// suffix would duplicate the ASIN — strip it before appending.
function productEvidenceValue(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  product: Pick<IndexedProduct, "asin" | "title" | "brand">
) {
  return `${stripDisplayNameSuffix(productLabel(mart, product))} (${product.asin})`
}

function contributorLabel(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  contributor: TopContributor
) {
  const product = mart.productsByAsin.get(normalize(contributor.asin))
  return product ? productLabel(mart, product) : displayProductName(contributor)
}

function ensureSentence(value: string) {
  const trimmed = value.trim()
  if (!trimmed || /[.!?]$/.test(trimmed)) return trimmed
  return `${trimmed}.`
}

function isCanonicalTypeScope(scopeKey: string) {
  const normalized = normalize(scopeKey)
  return (
    normalized.includes("totaltablet") ||
    normalized.includes("totalhandheld") ||
    normalized.includes("totaldongle") ||
    normalized.includes("totalothertools")
  )
}

function unknownOutput(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  answer: string
): AnalyzerOutput {
  return {
    answer,
    bullets: [
      "Try: Who is Innova 5610's biggest competitor?",
      "Try: What are competitors doing this month?",
      "Try: What should I be worried about?",
    ],
    evidence: baseEvidence(mart.snapshot),
    confidence: 0.5,
    assumptions: ["No strong analyzer route matched this question."],
    citations: [citation("Fallback", "metrics-engine", mart.snapshot.date)],
    suggestedQuestions: [
      "Who is Innova 5610's biggest competitor?",
      "What are competitors doing this month?",
      "What should I be worried about?",
    ],
    warnings: [],
  }
}

function buildBrandTopContributors(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  brandKeyOrName: string
): TopContributor[] {
  const brandKey = normalize(brandKeyOrName)
  const current = mart.products
    .filter((item) => normalize(item.brand) === brandKey)
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)

  return current.map((item) => {
    const history = mart.asinHistoryByAsin.get(normalize(item.asin))
    const trend = history?.windows["3m"]?.trend ?? "flat"
    return {
      asin: item.asin,
      title: item.title,
      revenue: item.revenue,
      units: item.units,
      trend,
    }
  })
}

function rankForBrandByMetric(
  snapshot: SnapshotSummary,
  brandName: string,
  metric: "revenue" | "units"
) {
  const sorted = snapshot.brandTotals
    .slice()
    .sort((a, b) =>
      metric === "revenue" ? b.revenue - a.revenue : b.units - a.units
    )
  const index = sorted.findIndex((item) => normalize(item.brand) === normalize(brandName))
  return index >= 0 ? index + 1 : null
}

function computeBrandArchetypes(mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>) {
  const map = new Map<string, SalesArchetype>()
  const brandRows = mart.snapshot.brandTotals.map((row) => {
    const asp = row.units > 0 ? row.revenue / row.units : 0
    const unitShare = mart.snapshot.totals.units > 0 ? row.units / mart.snapshot.totals.units : 0
    const revenueShare = mart.snapshot.totals.revenue > 0 ? row.revenue / mart.snapshot.totals.revenue : 0
    return {
      brand: row.brand,
      key: normalize(row.brand),
      asp,
      unitShare,
      revenueShare,
    }
  })

  const aspValues = brandRows.map((row) => row.asp).filter((value) => value > 0).sort((a, b) => a - b)
  const unitShares = brandRows.map((row) => row.unitShare).sort((a, b) => a - b)
  const revenueShares = brandRows.map((row) => row.revenueShare).sort((a, b) => a - b)

  const aspLow = percentile(aspValues, 0.3)
  const aspHigh = percentile(aspValues, 0.7)
  const unitLow = percentile(unitShares, 0.4)
  const unitHigh = percentile(unitShares, 0.6)
  const revenueMid = percentile(revenueShares, 0.5)

  for (const row of brandRows) {
    let archetype: SalesArchetype = "balanced"
    if (row.asp >= aspHigh && row.unitShare <= unitLow && row.revenueShare >= revenueMid * 0.7) {
      archetype = "price_led"
    } else if (row.asp <= aspLow && row.unitShare >= unitHigh && row.revenueShare >= revenueMid * 0.7) {
      archetype = "volume_led"
    }
    map.set(row.key, archetype)
  }

  return map
}

function summarizeBrandCurrent(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  brandKeyOrName: string
) {
  const key = normalize(brandKeyOrName)
  const row = mart.snapshot.brandTotals.find((item) => normalize(item.brand) === key)
  if (!row) return null
  const unitShare = mart.snapshot.totals.units > 0 ? row.units / mart.snapshot.totals.units : 0
  return {
    brand: row.brand,
    revenue: row.revenue,
    units: row.units,
    asp: row.units > 0 ? row.revenue / row.units : 0,
    revenueShare: row.share,
    unitShare,
  }
}

function listBrandsByArchetype(
  archetypes: Map<string, SalesArchetype>,
  target: SalesArchetype
) {
  return Array.from(archetypes.entries())
    .filter(([, value]) => value === target)
    .map(([key]) => key.toUpperCase())
}

function percentile(values: number[], p: number) {
  if (!values.length) return 0
  const idx = Math.min(values.length - 1, Math.max(0, Math.floor((values.length - 1) * p)))
  return values[idx]
}

function toArchetypeLabel(value: SalesArchetype) {
  if (value === "price_led") return "price-led"
  if (value === "volume_led") return "volume-led"
  return "balanced"
}


function resolveOwnBrands(targetBrand?: string, scope?: ResolvedScope) {
  const normalized = normalize(targetBrand ?? "")
  if (normalized === "innova" || normalized === "blcktec") {
    return new Set([normalized])
  }
  if (scope?.mode === "target_brand" && scope.brands.length) {
    return new Set(scope.brands.map((brand) => normalize(brand)))
  }
  return new Set<string>(OWN_BRAND_KEYS)
}

function resolveBrandScopeSet(scope: ResolvedScope, ownBrands: Set<string>) {
  if (scope.mode === "explicit_brand" || scope.mode === "target_brand") {
    const scoped = new Set(scope.brands.map((brand) => normalize(brand)).filter(Boolean))
    return scoped.size ? scoped : ownBrands
  }
  if (scope.mode === "own_brands") {
    return ownBrands
  }
  return ownBrands
}

function getScopedProducts(
  mart: NonNullable<ReturnType<typeof buildCodeReaderDataMart>>,
  scope: ResolvedScope
) {
  if (scope.mode === "all_brands") {
    return mart.products
  }
  const allowed = new Set(scope.brands.map((brand) => normalize(brand)).filter(Boolean))
  if (!allowed.size && scope.mode === "own_brands") {
    for (const brand of OWN_BRAND_KEYS) allowed.add(brand)
  }
  return mart.products.filter((item) => allowed.has(normalize(item.brand)))
}

function labelForScope(scope: ResolvedScope) {
  if (scope.mode === "explicit_brand" || scope.mode === "target_brand") {
    return scope.brands.length === 1 ? scope.brands[0].toUpperCase() : scope.brands.map((brand) => brand.toUpperCase()).join(" + ")
  }
  if (scope.mode === "own_brands") {
    return "OWN BRANDS"
  }
  return "MARKET"
}

function baseEvidence(snapshot: SnapshotSummary): EvidenceItem[] {
  return [
    { label: "Snapshot", value: snapshot.date },
    { label: "Market Revenue", value: formatCurrency(snapshot.totals.revenue) },
    { label: "Market Units", value: formatNumber(snapshot.totals.units) },
  ]
}

function citation(metric: string, source: string, snapshot: string): CitationItem {
  return { metric, source, snapshot }
}

function ratio(current: number, previous: number) {
  if (!previous) return 0
  return (current - previous) / previous
}

function sum(values: number[]) {
  return values.reduce((acc, value) => acc + safe(value), 0)
}

function safe(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) ? numeric : 0
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(safe(value))
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(safe(value))
}

function formatPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a"
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`
}

function formatAbsolutePercent(value: number) {
  return `${Math.abs(value * 100).toFixed(0)}%`
}

function formatSharePercent(value: number) {
  return `${(safe(value) * 100).toFixed(1)}%`
}

function signedPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`
}

function formatSignedCurrencyRaw(value: number) {
  const abs = formatCurrency(Math.abs(value))
  return `${value >= 0 ? "+" : "-"}${abs}`
}

function formatSignedNumber(value: number) {
  const abs = formatNumber(Math.abs(value))
  return `${value >= 0 ? "+" : "-"}${abs}`
}

function isDetailedPriceTierMetric(metric: TypeBreakdownMetric) {
  const key = normalize(metric.scopeKey)
  const label = metric.label.toLowerCase()
  if (/\$/.test(label)) return true
  if (/(tablet|handheld)/.test(key) && /\d/.test(key)) return true
  if (/(plus|minus)/.test(key)) return true
  return false
}

function describeTrend(value: number | null) {
  if (value === null) return "flat"
  if (value >= 0.08) return "growing"
  if (value <= -0.08) return "declining"
  return "stable"
}

function isExplicitRolling12Request(normalized: string) {
  return /\b(rolling 12|rolling12|12 month|12-month|grand total)\b/.test(normalized)
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
