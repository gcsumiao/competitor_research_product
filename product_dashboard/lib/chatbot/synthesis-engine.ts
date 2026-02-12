import type { CodeReaderDataMart } from "@/lib/chatbot/code-reader-index"
import type { ProactiveSuggestion } from "@/lib/chatbot/types"

const OWN_BRANDS = new Set(["innova", "blcktec"])

export type SynthesisSummary = {
  proactive: ProactiveSuggestion[]
  watchlist: string[]
}

export function buildSynthesisSummary(mart: CodeReaderDataMart): SynthesisSummary {
  const proactive: ProactiveSuggestion[] = []
  const watchlist: string[] = []

  const ownProducts = mart.products.filter((item) => OWN_BRANDS.has(normalize(item.brand)))
  const nonOwnProducts = mart.products.filter((item) => !OWN_BRANDS.has(normalize(item.brand)))

  if (ownProducts.length) {
    const concentrationShare = ownProducts
      .slice(0, 1)
      .reduce((sum, item) => sum + item.revenue, 0) /
      Math.max(1, ownProducts.reduce((sum, item) => sum + item.revenue, 0))

    proactive.push({
      id: "monthly-performance",
      title: "Monthly Performance Snapshot",
      summary:
        `Own brands generated ${formatCurrency(
          ownProducts.reduce((sum, item) => sum + item.revenue, 0)
        )} from ${ownProducts.length} tracked products. Top-SKU concentration is ${formatPercent(
          concentrationShare
        )}.`,
      severity: concentrationShare >= 0.55 ? "watch" : "info",
      confidence: 0.86,
    })
  }

  const movers = nonOwnProducts
    .filter((item) => (item.revenueMoM ?? 0) >= 0.5)
    .sort((a, b) => (b.revenueMoM ?? 0) - (a.revenueMoM ?? 0))
    .slice(0, 2)
  if (movers.length) {
    proactive.push({
      id: "competitive-alert",
      title: "Competitive Alert — Who Moved",
      summary: movers
        .map((item) => `${item.brand} ${item.asin} grew ${formatPercent(item.revenueMoM ?? 0)} MoM`)
        .join("; "),
      severity: "watch",
      confidence: 0.82,
    })
  }

  const riskCandidate = ownProducts
    .filter((item) => item.rating > 0 && item.rating < 4.1 && item.revenue > 100_000)
    .sort((a, b) => b.revenue - a.revenue)[0]
  if (riskCandidate) {
    proactive.push({
      id: "risk-of-month",
      title: "Biggest Risk Right Now",
      summary: `${riskCandidate.brand} ${riskCandidate.asin} has strong revenue (${formatCurrency(
        riskCandidate.revenue
      )}) but weak rating (${riskCandidate.rating.toFixed(1)}).`,
      severity: "risk",
      confidence: 0.78,
    })
  }

  const rising = mart.products
    .filter((item) => (item.revenueMoM ?? 0) >= 0.25 && item.rankRevenue <= 20)
    .slice(0, 3)
  watchlist.push(
    ...rising.map(
      (item) =>
        `${item.brand} ${item.asin} is rising (+${((item.revenueMoM ?? 0) * 100).toFixed(1)}% MoM, rank #${item.rankRevenue}).`
    )
  )

  if (!watchlist.length) {
    watchlist.push("No high-velocity product exceeded the rising-star threshold this month.")
  }

  return {
    proactive: proactive.slice(0, 3),
    watchlist: watchlist.slice(0, 4),
  }
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function formatPercent(value: number) {
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
