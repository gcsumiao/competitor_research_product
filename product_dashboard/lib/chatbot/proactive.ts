import type { ProactiveSuggestion } from "@/lib/chatbot/types"
import type { ChatAnalysis } from "@/lib/chatbot/insights"
import type { NormalizedCategoryData } from "@/lib/chatbot/category-normalizers"
import type { SnapshotSummary } from "@/lib/competitor-data"

function severityForRisk(score: number): "info" | "watch" | "risk" {
  if (score >= 75) return "risk"
  if (score >= 45) return "watch"
  return "info"
}

export function buildProactiveSuggestions(analysis: ChatAnalysis): ProactiveSuggestion[] {
  const monthly: ProactiveSuggestion = {
    id: "monthly_performance_snapshot",
    title: "Monthly Performance Snapshot",
    severity: analysis.significantMoves.length ? "watch" : "info",
    summary:
      `${analysis.ownLabel} revenue ${analysis.ownRevenueLabel} (${analysis.ownRevenueMoMLabel} MoM), ` +
      `share ${analysis.ownShareLabel}. ${analysis.marketContextLine}`,
  }

  const competitiveSummary =
    analysis.competitiveAlerts.length > 0
      ? analysis.competitiveAlerts.slice(0, 2).join(" ")
      : "No major competitive disruption exceeded configured alert thresholds this month."

  const competitive: ProactiveSuggestion = {
    id: "competitive_alert",
    title: "Competitive Alert - Who Moved and Why",
    severity: analysis.competitiveAlerts.length ? "watch" : "info",
    summary: competitiveSummary,
  }

  const risk: ProactiveSuggestion = {
    id: "biggest_risk_now",
    title: "Your Biggest Risk Right Now",
    severity: severityForRisk(analysis.topRisk.score),
    summary: `${analysis.topRisk.title}: ${analysis.topRisk.summary}`,
  }

  return [monthly, competitive, risk]
}

type TrendSnapshot = {
  snapshot: SnapshotSummary
  previous?: SnapshotSummary
}

type Candidate = {
  id: string
  title: string
  summary: string
  severity: "info" | "watch" | "risk"
  confidence: number
  score: number
}

export function buildFrameworkProactiveSuggestions(
  data: NormalizedCategoryData,
  trend?: TrendSnapshot
): ProactiveSuggestion[] {
  const candidates: Candidate[] = []

  const typeImbalance = data.typeMix
    .map((row) => ({
      row,
      gap: row.unitShare - row.revenueShare,
    }))
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0]
  if (typeImbalance && Math.abs(typeImbalance.gap) >= 0.08) {
    candidates.push({
      id: "price_volume_arbitrage",
      title: "Price-Volume Arbitrage Mismatch",
      summary:
        `${typeImbalance.row.type} has ${signedPercent(typeImbalance.row.unitShare)} unit share ` +
        `vs ${signedPercent(typeImbalance.row.revenueShare)} revenue share.`,
      severity: Math.abs(typeImbalance.gap) >= 0.18 ? "risk" : "watch",
      confidence: clamp(Math.abs(typeImbalance.gap) / 0.25, 0.45, 0.95),
      score: Math.abs(typeImbalance.gap) * 100,
    })
  }

  const top3Share = data.brands.slice(0, 3).reduce((sum, row) => sum + row.share, 0)
  if (data.brands.length >= 3) {
    const fragmented = top3Share < 0.5
    candidates.push({
      id: "leader_vulnerability",
      title: "Market Leader Vulnerability",
      summary: fragmented
        ? `Top-3 brands hold only ${signedPercent(top3Share)} share, indicating a fragmented field.`
        : `Top-3 brands hold ${signedPercent(top3Share)} share; leader concentration should still be monitored.`,
      severity: fragmented ? "watch" : "info",
      confidence: fragmented ? 0.82 : 0.55,
      score: fragmented ? 58 : 30,
    })
  }

  const feature = data.featurePremiums[0]
  if (feature) {
    candidates.push({
      id: "feature_premium",
      title: "Feature Premium Signal",
      summary:
        `${feature.feature} shows ${signedPercent(feature.premiumPct)} price premium with ` +
        `${signedPercent(feature.withFeatureRevenueShare)} revenue share.`,
      severity: Math.abs(feature.premiumPct) >= 0.2 ? "watch" : "info",
      confidence: clamp(Math.abs(feature.premiumPct) / 0.35, 0.4, 0.92),
      score: Math.abs(feature.premiumPct) * 100,
    })
  }

  const clusterGap = findCompetitiveClusterGap(data)
  if (clusterGap) {
    candidates.push({
      id: "cluster_gap",
      title: "Competitive Cluster Gap",
      summary:
        `${clusterGap.label} contributes ${signedPercent(clusterGap.share)} revenue with only ` +
        `${clusterGap.brandCount} active brands in sampled listings.`,
      severity: clusterGap.share >= 0.12 ? "watch" : "info",
      confidence: clamp(clusterGap.share / 0.2, 0.42, 0.85),
      score: clusterGap.share * 100,
    })
  }

  if (trend?.previous) {
    const prevRevenue = trend.previous.totals.revenue
    const currRevenue = trend.snapshot.totals.revenue
    if (prevRevenue > 0) {
      const delta = (currRevenue - prevRevenue) / prevRevenue
      if (Math.abs(delta) >= 0.12) {
        candidates.push({
          id: "trend_reversal",
          title: "Trend Reversal Alert",
          summary:
            `Revenue moved ${signedPercent(delta)} vs prior snapshot (${currencyCompact(currRevenue)} current).`,
          severity: Math.abs(delta) >= 0.2 ? "risk" : "watch",
          confidence: clamp(Math.abs(delta) / 0.3, 0.5, 0.9),
          score: Math.abs(delta) * 100,
        })
      }
    }
  }

  const priceAvg = average(
    data.topByRevenue.map((row) => row.price).filter((value) => value > 0)
  )
  const ratingAvg = average(
    data.topByRevenue.map((row) => row.rating).filter((value) => value > 0)
  )
  const misaligned = data.brands.find((brand) => brand.avgPrice > priceAvg * 1.15 && brand.avgRating > 0 && brand.avgRating < ratingAvg)
  if (misaligned) {
    candidates.push({
      id: "price_quality_misalignment",
      title: "Brand Price-Quality Misalignment",
      summary:
        `${misaligned.brand} is priced above category average but trails rating average (${fixed(misaligned.avgRating, 2)} vs ${fixed(ratingAvg, 2)}).`,
      severity: "watch",
      confidence: 0.74,
      score: 54,
    })
  }

  return candidates
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => ({
      id: item.id,
      title: item.title,
      summary: item.summary,
      severity: item.severity,
      confidence: Number(item.confidence.toFixed(2)),
    }))
}

function findCompetitiveClusterGap(data: NormalizedCategoryData) {
  const clusters = new Map<string, { revenue: number; brands: Set<string> }>()
  for (const row of data.topByRevenue) {
    const key = `${normalize(row.type)}|${priceBucket(row.price)}`
    const entry = clusters.get(key) ?? { revenue: 0, brands: new Set<string>() }
    entry.revenue += row.revenue
    entry.brands.add(normalize(row.brand))
    clusters.set(key, entry)
  }
  const ranked = Array.from(clusters.entries())
    .map(([key, values]) => {
      const [type, bucket] = key.split("|")
      const share = data.marketRevenue > 0 ? values.revenue / data.marketRevenue : 0
      return {
        key,
        share,
        revenue: values.revenue,
        brandCount: values.brands.size,
        label: `${restore(type)} @ ${bucket}`,
      }
    })
    .filter((entry) => entry.share >= 0.08)
    .sort((a, b) => {
      if (a.brandCount !== b.brandCount) return a.brandCount - b.brandCount
      return b.share - a.share
    })

  return ranked[0]
}

function priceBucket(price: number) {
  if (price < 75) return "<$75"
  if (price < 200) return "$75-$199"
  if (price < 400) return "$200-$399"
  return "$400+"
}

function currencyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function signedPercent(value: number) {
  const sign = value > 0 ? "+" : ""
  return `${sign}${(value * 100).toFixed(1)}%`
}

function fixed(value: number, digits: number) {
  return value.toFixed(digits)
}

function average(values: number[]) {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function restore(value: string) {
  if (!value) return "Unknown"
  return value.replace(/(^\w|_\w)/g, (chunk) => chunk.replace("_", " ").toUpperCase())
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
