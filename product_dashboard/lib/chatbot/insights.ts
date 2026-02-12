import { getClarification } from "@/lib/chatbot/clarifications"
import { detectIntent, suggestedQuestionsForIntent } from "@/lib/chatbot/intents"
import { buildCodeReaderBrainResponse } from "@/lib/chatbot/metrics-engine"
import {
  buildCategoryIntentResponse,
  detectCapabilities,
  mapLegacyIntent,
} from "@/lib/chatbot/intent-calculators"
import { categorySuggestedQuestions } from "@/lib/chatbot/question-bank"
import { buildFrameworkProactiveSuggestions, buildProactiveSuggestions } from "@/lib/chatbot/proactive"
import { resolveCategorySourceWorkbook } from "@/lib/chatbot/category-sources"
import {
  normalizeCategoryWorkbookData,
  normalizeSnapshotFallback,
  type NormalizedCategoryData,
} from "@/lib/chatbot/category-normalizers"
import type { ChatIntent, ChatResponse, EvidenceItem } from "@/lib/chatbot/types"
import type { CategorySummary, SnapshotSummary } from "@/lib/competitor-data"

const ALL_OWN_BRANDS = new Set(["innova", "blcktec"])
const TRACKED_COMPETITORS = ["autel", "topdon", "ancel"]

type RiskSignal = {
  key: "concentration" | "rating_erosion" | "competitive_convergence" | "segment_blindspot"
  title: string
  summary: string
  score: number
}

export type ChatAnalysis = {
  ownLabel: string
  ownRevenue: number
  ownUnits: number
  ownShare: number
  ownRevenueMoM: number | null
  ownUnitsMoM: number | null
  ownRevenueYoY: number | null
  ownShareYoY: number | null
  ownRevenueLabel: string
  ownRevenueMoMLabel: string
  ownShareLabel: string
  marketRevenueMoM: number | null
  marketContextLine: string
  topGrowingSku?: { title: string; change: number }
  topDecliningSku?: { title: string; change: number }
  top3SkuShare: number
  ownAsp: number | null
  marketAsp: number | null
  ownRating: number | null
  marketRating: number | null
  onePThreeP?: { onePRevenue: number; threePRevenue: number }
  competitiveAlerts: string[]
  topRisk: RiskSignal
  additionalRisks: RiskSignal[]
  warnings: string[]
  evidence: EvidenceItem[]
  significantMoves: string[]
  opportunityLines: string[]
}

type BuildParams = {
  message: string
  category: CategorySummary
  snapshot: SnapshotSummary
  snapshots: SnapshotSummary[]
  targetBrand?: string
}

const CATEGORY_DATA_CACHE_TTL_MS = 180_000

const categoryDataCache = new Map<
  string,
  {
    loadedAt: number
    value: NormalizedCategoryData
  }
>()

export async function buildDeterministicChatResponse({
  message,
  category,
  snapshot,
  snapshots,
  targetBrand,
}: BuildParams): Promise<ChatResponse> {
  const detection = detectIntent(message, category.id)
  const isCodeReader = category.id === "code_reader_scanner"
  const ownBrandScope = resolveOwnBrandScope(targetBrand)
  const ownLabel = ownBrandLabel(ownBrandScope)

  if (!isCodeReader) {
    return await buildNonCodeReaderResponse({
      detectionIntent: detection.intent,
      message,
      category,
      snapshot,
      snapshots,
    })
  }

  if (isCodeReaderBrainV2Enabled()) {
    const v2 = buildCodeReaderBrainResponse({
      message,
      category,
      snapshot,
      snapshots,
      targetBrand,
    })
    if (v2) {
      return v2
    }
  }

  const clarification = getClarification(message)
  if (clarification && (detection.intent === "data_clarification" || detection.confidence < 0.65)) {
    const analysis = analyzeCodeReader(snapshot, snapshots, ownBrandScope, ownLabel)
    return {
      intent: "data_clarification",
      answer: clarification.answer,
      bullets: clarification.bullets,
      evidence: analysis.evidence,
      proactive: buildProactiveSuggestions(analysis),
      suggestedQuestions: suggestedQuestionsForIntent("data_clarification"),
      warnings: analysis.warnings,
    }
  }

  const analysis = analyzeCodeReader(snapshot, snapshots, ownBrandScope, ownLabel)
  const suggestedQuestions = suggestedQuestionsForIntent(detection.intent)
  const proactive = buildProactiveSuggestions(analysis)

  if (detection.intent === "self_assessment") {
    return {
      intent: detection.intent,
      answer:
        `${analysis.ownLabel} generated ${currencyCompact(analysis.ownRevenue)} ` +
        `(${formatPercentChange(analysis.ownRevenueMoM)} MoM, ${formatPercentChange(analysis.ownRevenueYoY)} YoY) ` +
        `with ${numberCompact(analysis.ownUnits)} units and ${percent(analysis.ownShare)} market share.`,
      bullets: [
        analysis.marketContextLine,
        analysis.topGrowingSku
          ? `Top gainer: ${analysis.topGrowingSku.title} (${formatSignedCurrency(analysis.topGrowingSku.change)} vs last month).`
          : "No clear own-brand growth leader could be computed from the prior snapshot.",
        analysis.topDecliningSku
          ? `Top decliner: ${analysis.topDecliningSku.title} (${formatSignedCurrency(analysis.topDecliningSku.change)} vs last month).`
          : "No clear own-brand decliner could be computed from the prior snapshot.",
        `Top 3 own SKUs contribute ${percent(analysis.top3SkuShare)} of own-brand revenue.`,
        analysis.ownAsp && analysis.marketAsp
          ? `ASP comparison: own ${currency(analysis.ownAsp)} vs market ${currency(analysis.marketAsp)}.`
          : "ASP comparison is unavailable in this snapshot.",
        analysis.onePThreeP
          ? `1P/3P split: 1P ${currencyCompact(analysis.onePThreeP.onePRevenue)} | 3P ${currencyCompact(analysis.onePThreeP.threePRevenue)}.`
          : "1P vs 3P split is not available in the current snapshot.",
      ],
      evidence: analysis.evidence,
      proactive,
      suggestedQuestions,
      warnings: analysis.warnings,
    }
  }

  if (detection.intent === "competitive_benchmarking") {
    return {
      intent: detection.intent,
      answer:
        analysis.competitiveAlerts.length > 0
          ? `Key competitive shifts were detected this month: ${analysis.competitiveAlerts[0]}`
          : "No competitor crossed the configured major-move thresholds this month, but ranking and share positions should still be monitored.",
      bullets: [
        ...analysis.competitiveAlerts.slice(0, 4),
        `Own-share context: ${analysis.ownLabel} share is ${percent(analysis.ownShare)} (${formatPercentChange(analysis.ownShareYoY)} YoY).`,
      ],
      evidence: analysis.evidence,
      proactive,
      suggestedQuestions,
      warnings: analysis.warnings,
    }
  }

  if (detection.intent === "risk_threat") {
    return {
      intent: detection.intent,
      answer: `${analysis.topRisk.title}: ${analysis.topRisk.summary}`,
      bullets: [
        `Risk score: ${Math.round(analysis.topRisk.score)} / 100.`,
        ...analysis.additionalRisks.slice(0, 2).map((risk) => `${risk.title}: ${risk.summary}`),
      ],
      evidence: analysis.evidence,
      proactive,
      suggestedQuestions,
      warnings: analysis.warnings,
    }
  }

  if (detection.intent === "growth_opportunity") {
    return {
      intent: detection.intent,
      answer:
        analysis.opportunityLines[0] ??
        "Highest upside appears in segments where market revenue share is high and own-brand participation is currently low.",
      bullets: analysis.opportunityLines.slice(1, 5),
      evidence: analysis.evidence,
      proactive,
      suggestedQuestions,
      warnings: analysis.warnings,
    }
  }

  if (detection.intent === "data_clarification") {
    return {
      intent: detection.intent,
      answer:
        "I can explain metric definitions and month-over-month movements. Ask about any specific number and I will trace likely drivers from the current snapshot.",
      bullets: [
        "Share changes are relative to total market movement, not just brand movement.",
        "Adjusted and standard reports can differ for Innova/BLCKTEC due to applied corrections.",
        "If channel fields are missing, 1P/3P splits are reported as unavailable.",
      ],
      evidence: analysis.evidence,
      proactive,
      suggestedQuestions,
      warnings: analysis.warnings,
    }
  }

  // Route newer category-wide intents through the generic intent engine instead of
  // falling back to the static "unknown" response.
  if (detection.intent !== "unknown") {
    const normalized = normalizeSnapshotFallback(
      category,
      snapshot,
      "Using code-reader snapshot fallback for this intent."
    )
    const capabilities = detectCapabilities(normalized)
    const previousSnapshot = getPreviousSnapshot(snapshot, snapshots)
    const frameworkProactive = buildFrameworkProactiveSuggestions(normalized, {
      snapshot,
      previous: previousSnapshot,
    })
    const frameworkSuggestedQuestions = categorySuggestedQuestions(
      category.id,
      capabilities,
      detection.intent
    )
    const frameworkResponse = buildCategoryIntentResponse({
      message,
      intent: detection.intent,
      category,
      snapshot,
      snapshots,
      data: normalized,
      proactive: frameworkProactive,
      suggestedQuestions: frameworkSuggestedQuestions,
    })

    return {
      ...frameworkResponse,
      warnings: [...frameworkResponse.warnings, ...analysis.warnings].slice(0, 6),
    }
  }

  return {
    intent: "unknown",
    answer:
      "I can help with monthly performance, competitor movement, risk detection, and data clarifications. Use a quick action or ask a direct question.",
    bullets: [
      "Try: How did we do this month?",
      "Try: What are competitors doing?",
      "Try: What should I be worried about?",
    ],
    evidence: analysis.evidence,
    proactive,
    suggestedQuestions: suggestedQuestionsForIntent("unknown"),
    warnings: analysis.warnings,
  }
}

type NonCodeReaderParams = {
  detectionIntent: ChatIntent
  message: string
  category: CategorySummary
  snapshot: SnapshotSummary
  snapshots: SnapshotSummary[]
}

async function buildNonCodeReaderResponse({
  detectionIntent,
  message,
  category,
  snapshot,
  snapshots,
}: NonCodeReaderParams): Promise<ChatResponse> {
  const normalized = await loadNonCodeCategoryData(category, snapshot)
  const mappedIntent = mapLegacyIntent(detectionIntent)
  const capabilities = detectCapabilities(normalized)
  const suggestedQuestions = categorySuggestedQuestions(category.id, capabilities, mappedIntent)
  const previousSnapshot = getPreviousSnapshot(snapshot, snapshots)
  const proactive = buildFrameworkProactiveSuggestions(normalized, {
    snapshot,
    previous: previousSnapshot,
  })

  const response = buildCategoryIntentResponse({
    message,
    intent: mappedIntent,
    category,
    snapshot,
    snapshots,
    data: normalized,
    proactive,
    suggestedQuestions,
  })

  return response
}

function analyzeCodeReader(
  snapshot: SnapshotSummary,
  snapshots: SnapshotSummary[],
  ownBrands: Set<string>,
  ownLabel: string
): ChatAnalysis {
  const previous = getPreviousSnapshot(snapshot, snapshots)
  const yoy = getYoYSnapshot(snapshot, snapshots)
  const warnings = (snapshot.qualityIssues ?? []).map((issue) => issue.message).slice(0, 4)

  const ownCurrent = summarizeOwnBrands(snapshot, ownBrands)
  const ownPrev = previous ? summarizeOwnBrands(previous, ownBrands) : null
  const ownYoY = yoy ? summarizeOwnBrands(yoy, ownBrands) : null

  const ownRevenueMoM = changeRatio(ownCurrent.revenue, ownPrev?.revenue ?? null)
  const ownUnitsMoM = changeRatio(ownCurrent.units, ownPrev?.units ?? null)
  const ownRevenueYoY = changeRatio(ownCurrent.revenue, ownYoY?.revenue ?? null)
  const ownShareYoY = changeRatio(ownCurrent.share, ownYoY?.share ?? null)
  const marketRevenueMoM = changeRatio(snapshot.totals.revenue, previous?.totals.revenue ?? null)

  const productMoves = summarizeOwnProductMovement(snapshot, previous, ownBrands)
  const top3SkuShare = summarizeTop3OwnSkuShare(snapshot, ownCurrent.revenue, ownBrands)
  const ownAsp = ownCurrent.units > 0 ? ownCurrent.revenue / ownCurrent.units : null
  const marketAsp = snapshot.totals.units > 0 ? snapshot.totals.revenue / snapshot.totals.units : null
  const ownRating = summarizeOwnRating(snapshot, ownBrands)
  const marketRating = snapshot.totals.ratingAvg || null
  const onePThreeP = summarizeOnePThreeP(snapshot, ownBrands)

  const competitiveAlerts = buildCompetitiveAlerts(snapshot, previous)
  const risks = buildRiskSignals(snapshot, previous, ownCurrent, ownBrands)
  const [topRisk, ...additionalRisks] = risks

  const significantMoves = [
    ownRevenueMoM !== null && Math.abs(ownRevenueMoM) >= 0.1 ? "Own revenue moved more than 10% MoM." : "",
    ownUnitsMoM !== null && Math.abs(ownUnitsMoM) >= 0.1 ? "Own units moved more than 10% MoM." : "",
    marketRevenueMoM !== null && Math.abs(marketRevenueMoM) >= 0.1 ? "Total market revenue moved more than 10% MoM." : "",
  ].filter(Boolean)

  const opportunityLines = buildOpportunities(snapshot, risks[0], ownBrands)
  const selectedLabelPrefix = ownBrands.size === 1 ? "Selected Brand" : "Own"

  return {
    ownLabel,
    ownRevenue: ownCurrent.revenue,
    ownUnits: ownCurrent.units,
    ownShare: ownCurrent.share,
    ownRevenueMoM,
    ownUnitsMoM,
    ownRevenueYoY,
    ownShareYoY,
    ownRevenueLabel: currencyCompact(ownCurrent.revenue),
    ownRevenueMoMLabel: formatPercentChange(ownRevenueMoM),
    ownShareLabel: percent(ownCurrent.share),
    marketRevenueMoM,
    marketContextLine:
      marketRevenueMoM === null
        ? "Market MoM context is unavailable for this snapshot."
        : `Total market revenue moved ${formatPercentChange(marketRevenueMoM)} MoM.`,
    topGrowingSku: productMoves.topGrowing,
    topDecliningSku: productMoves.topDeclining,
    top3SkuShare,
    ownAsp,
    marketAsp,
    ownRating,
    marketRating,
    onePThreeP,
    competitiveAlerts,
    topRisk,
    additionalRisks,
    warnings,
    significantMoves,
    opportunityLines,
    evidence: [
      { label: "Snapshot", value: snapshot.date },
      { label: `${selectedLabelPrefix} Revenue`, value: currencyCompact(ownCurrent.revenue) },
      { label: `${selectedLabelPrefix} Units`, value: numberCompact(ownCurrent.units) },
      { label: `${selectedLabelPrefix} Share`, value: percent(ownCurrent.share) },
      { label: "Market Revenue", value: currencyCompact(snapshot.totals.revenue) },
      { label: "Market Units", value: numberCompact(snapshot.totals.units) },
    ],
  }
}

function summarizeOwnBrands(snapshot: SnapshotSummary, ownBrands: Set<string>) {
  const ownRows = snapshot.brandTotals.filter((row) => ownBrands.has(normalize(row.brand)))
  const revenue = ownRows.reduce((sum, row) => sum + row.revenue, 0)
  const units = ownRows.reduce((sum, row) => sum + row.units, 0)
  const share = snapshot.totals.revenue > 0 ? revenue / snapshot.totals.revenue : 0
  return { revenue, units, share }
}

function summarizeOwnProductMovement(
  snapshot: SnapshotSummary,
  previous: SnapshotSummary | undefined,
  ownBrands: Set<string>
) {
  const currentProducts = snapshot.topProducts.filter((item) => ownBrands.has(normalize(item.brand)))
  const previousMap = new Map(
    (previous?.topProducts ?? [])
      .filter((item) => ownBrands.has(normalize(item.brand)))
      .map((item) => [item.asin, item.revenue] as const)
  )

  const deltas = currentProducts.map((product) => ({
    title: product.title,
    change: product.revenue - (previousMap.get(product.asin) ?? 0),
  }))

  const sorted = [...deltas].sort((a, b) => b.change - a.change)
  const topGrowing = sorted.find((item) => item.change > 0)
  const topDeclining = [...sorted].reverse().find((item) => item.change < 0)

  return { topGrowing, topDeclining }
}

function summarizeTop3OwnSkuShare(
  snapshot: SnapshotSummary,
  ownRevenue: number,
  ownBrands: Set<string>
) {
  if (ownRevenue <= 0) return 0
  const top3 = snapshot.topProducts
    .filter((item) => ownBrands.has(normalize(item.brand)))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 3)
  return top3.reduce((sum, item) => sum + item.revenue, 0) / ownRevenue
}

function summarizeOwnRating(snapshot: SnapshotSummary, ownBrands: Set<string>) {
  const ownRows = snapshot.topProducts.filter((item) => ownBrands.has(normalize(item.brand)))
  const reviewTotal = ownRows.reduce((sum, row) => sum + row.reviewCount, 0)
  if (reviewTotal <= 0) return null
  const weighted = ownRows.reduce((sum, row) => sum + row.rating * row.reviewCount, 0)
  return weighted / reviewTotal
}

function summarizeOnePThreeP(snapshot: SnapshotSummary, ownBrands: Set<string>) {
  const ownRows = snapshot.topProducts.filter((item) => ownBrands.has(normalize(item.brand)))
  const hasFulfillment = ownRows.some((row) => Boolean(row.fulfillment))
  if (!hasFulfillment) return undefined

  const onePRevenue = ownRows
    .filter((row) => normalize(row.fulfillment ?? "") === "1p")
    .reduce((sum, row) => sum + row.revenue, 0)
  const threePRevenue = ownRows
    .filter((row) => normalize(row.fulfillment ?? "") === "3p")
    .reduce((sum, row) => sum + row.revenue, 0)

  return { onePRevenue, threePRevenue }
}

function buildCompetitiveAlerts(snapshot: SnapshotSummary, previous?: SnapshotSummary) {
  if (!previous) return []

  const alerts: Array<{ key: string; text: string; score: number }> = []
  const prevShareMap = new Map(previous.brandTotals.map((row) => [normalize(row.brand), row.share] as const))
  const prevRevenueMap = new Map(previous.brandTotals.map((row) => [normalize(row.brand), row.revenue] as const))

  for (const brand of snapshot.brandTotals) {
    const key = normalize(brand.brand)
    const prevShare = prevShareMap.get(key)
    const prevRevenue = prevRevenueMap.get(key)

    if (prevShare !== undefined) {
      const shareDelta = brand.share - prevShare
      if (Math.abs(shareDelta) >= 0.02) {
        alerts.push({
          key: `${key}-share`,
          text: `${brand.brand} market share moved ${signedPercentPoints(shareDelta)} this month.`,
          score: Math.abs(shareDelta) * 100,
        })
      }
    }

    if (prevRevenue !== undefined && prevRevenue > 0) {
      const growth = (brand.revenue - prevRevenue) / prevRevenue
      if (growth >= 0.5) {
        alerts.push({
          key: `${key}-growth`,
          text: `${brand.brand} revenue grew ${formatPercentChange(growth)} MoM.`,
          score: growth * 100,
        })
      }
    }
  }

  const currentTop15 = new Set(snapshot.brandTotals.slice(0, 15).map((row) => normalize(row.brand)))
  const prevTop15 = new Set(previous.brandTotals.slice(0, 15).map((row) => normalize(row.brand)))
  for (const brand of snapshot.brandTotals.slice(0, 15)) {
    const key = normalize(brand.brand)
    if (currentTop15.has(key) && !prevTop15.has(key)) {
      alerts.push({
        key: `${key}-new-entrant`,
        text: `${brand.brand} entered the top 15 for the first time vs last month.`,
        score: 30,
      })
    }
  }

  for (const brand of TRACKED_COMPETITORS) {
    const currentAvg = averagePriceForBrand(snapshot, brand)
    const prevAvg = averagePriceForBrand(previous, brand)
    if (prevAvg > 0) {
      const drop = (currentAvg - prevAvg) / prevAvg
      if (drop <= -0.15) {
        alerts.push({
          key: `${brand}-price-cut`,
          text: `${capitalize(brand)} average price dropped ${formatPercentChange(drop)} MoM.`,
          score: Math.abs(drop) * 100,
        })
      }
    }
  }

  return dedupeAlerts(alerts)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((alert) => alert.text)
}

function buildRiskSignals(
  snapshot: SnapshotSummary,
  previous: SnapshotSummary | undefined,
  ownCurrent: { revenue: number; units: number; share: number },
  ownBrands: Set<string>
): RiskSignal[] {
  const ownProducts = snapshot.topProducts
    .filter((item) => ownBrands.has(normalize(item.brand)))
    .sort((a, b) => b.revenue - a.revenue)
  const ownTopSkuRevenue = ownProducts[0]?.revenue ?? 0
  const concentrationShare = ownCurrent.revenue > 0 ? ownTopSkuRevenue / ownCurrent.revenue : 0
  const concentrationScore = clamp((concentrationShare - 0.35) * 220, 0, 100)

  const ownRating = summarizeOwnRating(snapshot, ownBrands)
  const prevRating = previous ? summarizeOwnRating(previous, ownBrands) : null
  const marketRating = snapshot.totals.ratingAvg || null
  const ratingGap = ownRating !== null && marketRating !== null ? marketRating - ownRating : 0
  const ratingDecline = ownRating !== null && prevRating !== null ? prevRating - ownRating : 0
  const ratingScore = clamp((ratingGap > 0 ? ratingGap * 22 : 0) + (ratingDecline > 0 ? ratingDecline * 45 : 0), 0, 100)

  const ownLead = ownProducts[0]
  const convergenceCount = ownLead
    ? snapshot.topProducts.filter((item) => {
        if (ownBrands.has(normalize(item.brand))) return false
        if (item.price <= 0 || ownLead.price <= 0) return false
        return Math.abs(item.price - ownLead.price) <= 20 && item.rating >= ownLead.rating + 0.2
      }).length
    : 0
  const convergenceScore = clamp(convergenceCount * 26, 0, 100)

  const segmentRisk = computeSegmentBlindspot(snapshot, ownBrands)

  const risks: RiskSignal[] = [
    {
      key: "concentration",
      title: "Revenue Concentration Risk",
      summary:
        ownCurrent.revenue > 0
          ? `Top own SKU contributes ${percent(concentrationShare)} of own-brand revenue.`
          : "Own-brand revenue was too low to assess concentration.",
      score: concentrationScore,
    },
    {
      key: "rating_erosion",
      title: "Rating Erosion Risk",
      summary:
        ownRating !== null && marketRating !== null
          ? `Own rating ${fixed(ownRating, 2)} vs market ${fixed(marketRating, 2)}; gap ${fixed(ratingGap, 2)}.`
          : "Insufficient rating coverage for robust erosion scoring.",
      score: ratingScore,
    },
    {
      key: "competitive_convergence",
      title: "Competitive Convergence Risk",
      summary:
        ownLead
          ? `${convergenceCount} rival products sit within $20 of ${ownLead.asin} with higher ratings.`
          : "No own lead SKU available for convergence scoring.",
      score: convergenceScore,
    },
    segmentRisk,
  ]

  return risks.sort((a, b) => b.score - a.score)
}

function computeSegmentBlindspot(snapshot: SnapshotSummary, ownBrands: Set<string>): RiskSignal {
  const scopeRows = snapshot.typeBreakdowns?.allAsins ?? []
  const mixRows = snapshot.typeBreakdowns?.categoryBrandMix ?? []
  const candidateScopes = ["total_tablet", "total_handheld", "total_dongle", "total_other_tools"]

  let best = {
    key: "segment_blindspot" as const,
    title: "Segment Blindspot Risk",
    summary: "No segment blindspot signal exceeded threshold.",
    score: 0,
  }

  for (const scope of candidateScopes) {
    const scopeRow = scopeRows.find((row) => row.scopeKey === scope)
    if (!scopeRow || scopeRow.revenue <= 0) continue

    const ownRevenue = mixRows
      .filter((row) => row.scopeKey === scope && ownBrands.has(normalize(row.brand)))
      .reduce((sum, row) => sum + row.revenue, 0)

    const ownShare = ownRevenue / scopeRow.revenue
    const marketWeight = scopeRow.revenueShare
    const score =
      marketWeight > 0.2 && ownShare < 0.05
        ? clamp(marketWeight * 120 + (0.05 - ownShare) * 700, 0, 100)
        : 0

    if (score > best.score) {
      best = {
        key: "segment_blindspot",
        title: "Segment Blindspot Risk",
        summary: `${scopeRow.label} is ${percent(marketWeight)} of market revenue while own share is ${percent(ownShare)}.`,
        score,
      }
    }
  }

  return best
}

function buildOpportunities(
  snapshot: SnapshotSummary,
  topRisk: RiskSignal,
  ownBrands: Set<string>
): string[] {
  const lines: string[] = []
  const scopeRows = snapshot.typeBreakdowns?.allAsins ?? []
  const mixRows = snapshot.typeBreakdowns?.categoryBrandMix ?? []

  const candidate = scopeRows
    .filter((row) => ["total_tablet", "total_handheld", "total_dongle", "total_other_tools"].includes(row.scopeKey))
    .map((row) => {
      const ownRevenue = mixRows
        .filter((mix) => mix.scopeKey === row.scopeKey && ownBrands.has(normalize(mix.brand)))
        .reduce((sum, mix) => sum + mix.revenue, 0)
      const ownShare = row.revenue > 0 ? ownRevenue / row.revenue : 0
      return { row, ownShare }
    })
    .sort((a, b) => b.row.revenueShare - a.row.revenueShare)
    .find((entry) => entry.row.revenueShare >= 0.2 && entry.ownShare < 0.05)

  if (candidate) {
    lines.push(
      `Largest whitespace opportunity: ${candidate.row.label} holds ${percent(candidate.row.revenueShare)} of market revenue while own share is ${percent(candidate.ownShare)}.`
    )
  }

  const weakRatedHighRevenue = snapshot.topProducts
    .filter((item) => !ownBrands.has(normalize(item.brand)) && item.revenue > 0 && item.rating > 0 && item.rating < 4.1)
    .sort((a, b) => b.revenue - a.revenue)[0]

  if (weakRatedHighRevenue) {
    lines.push(
      `Potential opening: ${weakRatedHighRevenue.brand} ${weakRatedHighRevenue.asin} has ${currencyCompact(weakRatedHighRevenue.revenue)} revenue but low rating (${fixed(weakRatedHighRevenue.rating, 1)}).`
    )
  }

  if (topRisk.key === "concentration") {
    lines.push("Diversifying own top-SKU dependence can reduce downside while preserving rank stability.")
  }
  if (topRisk.key === "segment_blindspot") {
    lines.push("Closing the highest-value segment gap is likely to produce the fastest rank upside.")
  }

  if (!lines.length) {
    lines.push("No single breakout opportunity exceeded configured thresholds; monitor segment growth and competitor rating gaps.")
  }

  return lines
}

function averagePriceForBrand(snapshot: SnapshotSummary, brandKey: string) {
  const listing = snapshot.brandListings.find((entry) => normalize(entry.brand) === normalize(brandKey))
  const source = listing?.products.length ? listing.products : snapshot.topProducts
  const rows = source.filter((item) => normalize(item.brand) === normalize(brandKey) && item.price > 0)
  if (!rows.length) return 0
  return rows.reduce((sum, row) => sum + row.price, 0) / rows.length
}

function dedupeAlerts(alerts: Array<{ key: string; text: string; score: number }>) {
  const map = new Map<string, { key: string; text: string; score: number }>()
  for (const alert of alerts) {
    const existing = map.get(alert.key)
    if (!existing || alert.score > existing.score) {
      map.set(alert.key, alert)
    }
  }
  return Array.from(map.values())
}

function getPreviousSnapshot(snapshot: SnapshotSummary, snapshots: SnapshotSummary[]) {
  const sorted = [...snapshots].sort((a, b) => a.date.localeCompare(b.date))
  const index = sorted.findIndex((item) => item.date === snapshot.date)
  if (index <= 0) return undefined
  return sorted[index - 1]
}

function getYoYSnapshot(snapshot: SnapshotSummary, snapshots: SnapshotSummary[]) {
  const date = new Date(`${snapshot.date}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return undefined
  date.setUTCFullYear(date.getUTCFullYear() - 1)
  const month = `${date.getUTCMonth() + 1}`.padStart(2, "0")
  const yoyDate = `${date.getUTCFullYear()}-${month}-01`
  return snapshots.find((item) => item.date === yoyDate)
}

async function loadNonCodeCategoryData(category: CategorySummary, snapshot: SnapshotSummary) {
  const key = `${category.id}:${snapshot.date}`
  const cached = categoryDataCache.get(key)
  const now = Date.now()
  if (cached && now - cached.loadedAt <= CATEGORY_DATA_CACHE_TTL_MS) {
    return cached.value
  }

  const resolved = await resolveCategorySourceWorkbook(category.id)
  if (!resolved) {
    const fallback = normalizeSnapshotFallback(
      category,
      snapshot,
      "No category workbook source found. Using dashboard snapshot fallback."
    )
    categoryDataCache.set(key, { loadedAt: now, value: fallback })
    return fallback
  }

  const parsed = await normalizeCategoryWorkbookData(category, snapshot, resolved.filePath)
  if (!parsed) {
    const fallback = normalizeSnapshotFallback(
      category,
      snapshot,
      `Failed to parse category workbook ${resolved.filePath}. Using dashboard snapshot fallback.`
    )
    categoryDataCache.set(key, { loadedAt: now, value: fallback })
    return fallback
  }

  categoryDataCache.set(key, { loadedAt: now, value: parsed })
  return parsed
}

function changeRatio(current: number, previous: number | null) {
  if (previous === null || previous === 0) return null
  return (current - previous) / previous
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function resolveOwnBrandScope(targetBrand?: string) {
  const normalized = normalize(targetBrand)
  if (normalized === "innova" || normalized === "blcktec") {
    return new Set([normalized])
  }
  return new Set(ALL_OWN_BRANDS)
}

function ownBrandLabel(scope: Set<string>) {
  if (scope.size === 1) {
    const only = Array.from(scope)[0]
    return only === "innova" ? "Innova" : "BLCKTEC"
  }
  return "Innova + BLCKTEC"
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function fixed(value: number, digits: number) {
  return value.toFixed(digits)
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

function formatPercentChange(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a"
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`
}

function signedPercentPoints(delta: number) {
  const points = delta * 100
  return `${points >= 0 ? "+" : ""}${points.toFixed(1)}pt`
}

function formatSignedCurrency(value: number) {
  const absValue = currency(Math.abs(value))
  return `${value >= 0 ? "+" : "-"}${absValue}`
}

function isCodeReaderBrainV2Enabled() {
  const raw = (process.env.CHAT_BRAIN_V2_CODE_READER ?? "true").toLowerCase()
  return raw !== "0" && raw !== "false" && raw !== "off"
}
