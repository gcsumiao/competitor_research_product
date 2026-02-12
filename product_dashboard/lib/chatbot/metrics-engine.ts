import { buildCodeReaderDataMart } from "@/lib/chatbot/code-reader-index"
import { findClosestCompetitors } from "@/lib/chatbot/competitor-engine"
import { resolveEntities } from "@/lib/chatbot/entity-resolver"
import { routeIntent, type AnalyzerId } from "@/lib/chatbot/intent-router"
import { parseQuery, type ParsedQuery } from "@/lib/chatbot/query-parser"
import { buildSynthesisSummary } from "@/lib/chatbot/synthesis-engine"
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
import type { CategorySummary, SnapshotSummary } from "@/lib/competitor-data"

type BuildParams = {
  message: string
  category: CategorySummary
  snapshot: SnapshotSummary
  snapshots: SnapshotSummary[]
  targetBrand?: string
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

export function buildCodeReaderBrainResponse({
  message,
  category,
  snapshot,
  targetBrand,
}: BuildParams): ChatResponse | null {
  const trace: AnalysisTraceStep[] = []

  const mart = buildCodeReaderDataMart(category, snapshot.date)
  if (!mart) {
    return null
  }
  trace.push({ step: "Build Code Reader data mart", status: "ok" })

  const parsed = parseQuery(message, category.id)
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
      evidence: baseEvidence(mart.snapshot),
      proactive: buildSynthesisSummary(mart).proactive,
      suggestedQuestions: [
        "Which ASIN should we analyze?",
        "Compare Innova 5610 against closest competitors.",
        "Show product trend for Innova 5610.",
      ],
      warnings: mart.qualityWarnings,
      confidence: 0.42,
      assumptions: ["Question referenced product-level analysis without a unique product match."],
      citations: [citation("Entity resolver", "code_reader_snapshot", mart.snapshot.date)],
      analysisTrace: trace,
      entities: resolved.entities,
    }
  }

  const output = runAnalyzer(routed.analyzer, {
    mart,
    targetBrand,
    parsed,
    scope: resolved.scope,
    entities: resolved.entities,
    matchedProducts: resolved.matchedProducts,
    message,
  })
  trace.push({ step: "Execute deterministic analyzer", status: "ok" })

  const synthesis = buildSynthesisSummary(mart)
  trace.push({ step: "Build proactive synthesis", status: synthesis.proactive.length ? "ok" : "partial" })

  return {
    intent: routed.analyzer,
    answer: output.answer,
    bullets: output.bullets,
    evidence: output.evidence,
    proactive: synthesis.proactive,
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
  }
}

function runAnalyzer(
  analyzer: AnalyzerId,
  params: AnalyzerParams
): AnalyzerOutput {
  const { mart } = params
  const ownBrands = resolveOwnBrands(params.targetBrand, params.scope)
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

  if (analyzer === "asin_history") {
    const target = params.matchedProducts[0]
    if (target) {
      const history = mart.asinHistoryByAsin.get(normalize(target.asin))
      const window3 = history?.windows["3m"]
      const window12 = history?.windows["12m"]?.months ? history.windows["12m"] : history?.windows.all
      return {
        answer: `ASIN History: ${target.brand} ${target.asin} is ${history?.windows["3m"].trend ?? "flat"} over the recent period.`,
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
          `Who is the biggest competitor to ${target.asin}?`,
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
      answer: `${brandKey.toUpperCase()} top ASINs are ${topContributors.map((item) => item.asin).join(", ")} with historical trend support.`,
      bullets: topContributors.map(
        (item) =>
          `${item.asin}: ${formatCurrency(item.revenue)} revenue, ${formatNumber(item.units)} units, trend ${item.trend}.`
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
              `${item.asin}: ${formatCurrency(item.revenue)} revenue, ${formatNumber(item.units)} units, trend ${item.trend}.`
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
          `Who is ${stats.brand}'s fastest-moving ASIN?`,
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

    const result = findClosestCompetitors(mart, target)
    const top = result.candidates[0]
    if (!top) {
      return unknownOutput(mart, `I couldn't find comparable competitors for ${target.brand} ${target.asin} in the current snapshot.`)
    }

    return {
      answer: `Closest Competitor: ${top.product.brand} ${top.product.asin}`,
      bullets: [
        `Target ${target.brand} ${target.asin}: ${formatCurrency(target.revenue)} revenue, ${formatNumber(target.units)} units, ASP ${formatCurrency(target.price)}.`,
        ...top.evidence.slice(0, 4),
        ...result.candidates.slice(1).map((item, index) => `Alternative #${index + 2}: ${item.product.brand} ${item.product.asin} (${item.score.toFixed(1)}/100).`),
      ],
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Target Product", value: `${target.brand} ${target.asin}` },
        { label: "Closest Competitor", value: `${top.product.brand} ${top.product.asin}` },
      ],
      confidence: result.confidence,
      assumptions: result.assumptions,
      citations: [
        citation("Product matching", "brandSheetListings/topProducts", mart.snapshot.date),
        citation("Competitor scoring model", "deterministic competitor-engine", mart.snapshot.date),
      ],
      suggestedQuestions: [
        `What trend does ${top.product.asin} show vs ${target.asin}?`,
        `Are there faster-growing alternatives in ${target.type}?`,
        "Show competitor movement this month.",
      ],
      warnings: [],
      historicalWindow: "12m",
    }
  }

  if (analyzer === "product_trend") {
    const scopedProducts = getScopedProducts(mart, params.scope)
    const target = params.matchedProducts[0] ?? scopedProducts[0] ?? mart.products.find((item) => ownBrands.has(normalize(item.brand)))
    if (!target) return unknownOutput(mart, "I couldn't identify which product trend to analyze.")

    const last = target.history[target.history.length - 1]
    const prev = target.history[target.history.length - 2]
    const revenueMoM = target.revenueMoM
    const unitsMoM = target.unitsMoM

    return {
      answer: `${target.brand} ${target.asin} is ${describeTrend(revenueMoM)} in revenue (${formatPercent(revenueMoM)}) and ${describeTrend(unitsMoM)} in units (${formatPercent(unitsMoM)}) vs last month.`,
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
        { label: "Product", value: `${target.brand} ${target.asin}` },
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
        `Who is the biggest competitor to ${target.asin}?`,
        `Is ${target.asin} losing share in its price band?`,
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
      answer: `${labelForScope(params.scope)} delivered ${formatCurrency(currentRevenue)} monthly revenue and ${formatNumber(currentUnits)} units (${formatPercent(ratio(currentRevenue, prevRevenue))} revenue MoM).`,
      bullets: [
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
      ],
      confidence: currentRows.length ? 0.88 : 0.62,
      assumptions: ["Brand-health scope follows explicit brand > quick-action brand > own brands > market."],
      citations: [citation("Brand totals", "snapshot.brandTotals", mart.snapshot.date)],
      suggestedQuestions: [
        "What are competitors doing this month?",
        "What is our biggest risk right now?",
        "Which own product has the strongest momentum?",
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
        "Which competitor is closest to Innova 5610?",
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
          ? `Quality risk: ${weakest.asin} has high revenue (${formatCurrency(weakest.revenue)}) but lower rating (${weakest.rating.toFixed(1)}).`
          : "No severe risk crossed configured thresholds."

    return {
      answer: riskLine,
      bullets: [
        `Own revenue concentration (Top 1): ${formatPercent(topOneShare)}.`,
        weakest ? `Rating pressure candidate: ${weakest.brand} ${weakest.asin} (${weakest.rating.toFixed(1)}★).` : "No high-revenue low-rating SKU found.",
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
    }
  }

  if (analyzer === "opportunity_signal" || analyzer === "product_type_mix" || analyzer === "price_volume_tradeoff") {
    const scopeRows = mart.typeMetrics
      .filter((row) => row.revenue > 0)
      .sort((a, b) => b.revenueShare - a.revenueShare)
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
        "Which product should we prioritize in this segment?",
        "Who are the strongest competitors in this segment?",
        "What price tier is growing fastest?",
      ],
      warnings: [],
    }
  }

  if (analyzer === "top_products" || analyzer === "market_leader" || analyzer === "market_size") {
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
        ? `Top ${scopeLabel} SKU: ${top[0].brand} ${top[0].asin} (${params.parsed.plan.rankingMetric === "units" ? `${formatNumber(top[0].units)} units` : `${formatCurrency(top[0].revenue)} revenue`}).`
        : "No top-product data is available for this snapshot.",
      bullets: top.map((item, idx) => `#${idx + 1} ${item.brand} ${item.asin}: ${formatCurrency(item.revenue)} / ${formatNumber(item.units)} units.`),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Scope", value: scopeLabel },
        { label: "Ranked By", value: rankingLabel },
      ],
      confidence: top.length ? 0.9 : 0.55,
      assumptions: ["Top-product ranking uses deterministic scope resolution and current snapshot monthly metrics."],
      citations: [citation("Top products", "snapshot.topProducts + brandSheetListings", mart.snapshot.date)],
      suggestedQuestions: [
        "Who is the biggest competitor to the top product?",
        "How has the top product trended vs last month?",
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
    const ranked = mart.products
      .map((product) => {
        const yoyPoint = findHistoryPoint(product.history, mart.yoy?.date)
        const mom = metric === "units" ? safe(product.unitsMoM) : safe(product.revenueMoM)
        const yoy =
          metric === "units"
            ? ratio(product.units, safe(yoyPoint?.units))
            : ratio(product.revenue, safe(yoyPoint?.revenue))
        const growth = growthForWindow(window, mom, yoy)
        return { product, mom, yoy, growth }
      })
      .filter((row) => row.growth !== null)
      .sort((a, b) => safe(b.growth) - safe(a.growth))
      .slice(0, 5)

    const top = ranked[0]
    if (!top) {
      return unknownOutput(mart, "I couldn't find ASIN growth results for the requested scope.")
    }

    return {
      answer: `Fastest ${metric} growth ASIN (${windowLabel(window)}): ${top.product.brand} ${top.product.asin}.`,
      bullets: ranked.map(
        (row, index) =>
          `#${index + 1} ${row.product.brand} ${row.product.asin}: ${formatPercent(row.growth)} (${windowLabel(window)}), ${formatCurrency(row.product.revenue)} revenue, ${formatNumber(row.product.units)} units.`
      ),
      evidence: [
        ...baseEvidence(mart.snapshot),
        { label: "Target Level", value: "ASIN" },
        { label: "Window", value: windowLabel(window) },
        { label: "Metric", value: metric.toUpperCase() },
      ],
      confidence: 0.86,
      assumptions: ["ASIN growth compares current month against previous month and prior-year month when available."],
      citations: [citation("ASIN growth", "products + history windows", mart.snapshot.date)],
      suggestedQuestions: [
        `Who is the biggest competitor to ${top.product.asin}?`,
        `Is ${top.product.brand} growth driven by price or units?`,
        "Which brands grew fastest in handheld tools?",
      ],
      warnings: [],
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
          `${item.asin}: ${formatCurrency(item.revenue)} revenue, ${formatNumber(item.units)} units, trend ${item.trend}.`
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
      `Is ${top.row.brand} growth driven more by units or ASP?`,
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
    const ranked = mart.products
      .map((product) => {
        const prev = product.history[product.history.length - 2]
        const currentRank = metric === "units" ? product.rankUnits : product.rankRevenue
        const prevRank = metric === "units" ? prev?.rankUnits ?? null : prev?.rankRevenue ?? null
        const delta = prevRank !== null && currentRank > 0 ? prevRank - currentRank : null
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
      answer: `Fastest ASIN rank mover (${metric} rank): ${top.product.brand} ${top.product.asin} (${signedRankDelta(top.delta)}).`,
      bullets: ranked.map(
        (row, index) =>
          `#${index + 1} ${row.product.brand} ${row.product.asin}: ${formatRank(row.prevRank)} -> ${formatRank(row.currentRank)} (${signedRankDelta(row.delta)}).`
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
        `How did ${top.product.asin} perform by revenue and units?`,
        `Who competes closest with ${top.product.asin}?`,
        "Which brand gained rank fastest this month?",
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
      "Which type segment has the fastest rank shifts?",
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
        `Who is the fastest rank mover within ${typeScopeLabel(typeScope)}?`,
        `Show ${top.brand} top ${typeScopeLabel(typeScope)} ASINs.`,
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
      "Which brands grew fastest inside this type?",
      "Is growth in this type driven by units or ASP?",
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
        `Which brands are driving ${typeScopeLabel(typeScope)} growth?`,
        `Who is the fastest rank mover in ${typeScopeLabel(typeScope)}?`,
        "Show top ASIN contributors in this type.",
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
        `How did ${stats.brand} rank move vs last month?`,
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
      "Which brands are driving most of this growth?",
      "Who is the fastest growth brand by units?",
      "Who is the fastest rank mover this month?",
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
  return new Set(["innova", "blcktec"])
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
    allowed.add("innova")
    allowed.add("blcktec")
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

function signedPoints(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}pt`
}

function describeTrend(value: number | null) {
  if (value === null) return "flat"
  if (value >= 0.08) return "growing"
  if (value <= -0.08) return "declining"
  return "stable"
}

function unique(values: string[]) {
  return Array.from(new Set(values))
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
