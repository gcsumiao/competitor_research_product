import type { CodeReaderDataMart, IndexedProduct } from "@/lib/chatbot/code-reader-index"

export type CompetitorCandidate = {
  product: IndexedProduct
  score: number
  evidence: string[]
}

export type CompetitorResult = {
  target: IndexedProduct
  candidates: CompetitorCandidate[]
  assumptions: string[]
  confidence: number
}

const WEIGHTS = {
  price: 25,
  type: 25,
  revenue: 20,
  units: 10,
  rating: 10,
  momentum: 10,
}

export function findClosestCompetitors(
  mart: CodeReaderDataMart,
  target: IndexedProduct,
  options?: { includeSameBrand?: boolean }
): CompetitorResult {
  const includeSameBrand = Boolean(options?.includeSameBrand)
  const sameType = mart.products.filter((item) => normalize(item.type) === normalize(target.type))
  const fallbackPool = sameType.length >= 4 ? sameType : mart.products

  const candidatePool = fallbackPool.filter((item) => {
    if (normalize(item.asin) === normalize(target.asin)) return false
    if (!includeSameBrand && normalize(item.brand) === normalize(target.brand)) return false
    if (item.revenue <= 0 || item.price <= 0) return false

    const priceDelta = Math.abs(item.price - target.price)
    const relDelta = target.price > 0 ? priceDelta / target.price : 1
    return relDelta <= 0.2 || priceDelta <= 120
  })

  const minRevenue = Math.max(10_000, target.revenue * 0.05)
  const filtered = candidatePool.filter((item) => item.revenue >= minRevenue)

  const scored = filtered.map((item) => scoreCandidate(target, item))
  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((item) => {
      const risingBoost = risingStarBoost(item.product)
      const total = clamp(item.score + risingBoost, 0, 100)
      const evidence = [...item.evidence]
      if (risingBoost > 0) {
        evidence.push(`Rising-star boost: +${risingBoost.toFixed(1)} (strong MoM growth and improving rank).`)
      }
      return {
        ...item,
        score: total,
        evidence,
      }
    })
    .sort((a, b) => b.score - a.score)

  const assumptions = [
    "Candidates are restricted to nearby price range (±20% or ±$120).",
    "Type match is prioritized; when type coverage is sparse, fallback pool expands to all products.",
    "Scores combine similarity and momentum, not absolute market leadership.",
  ]

  const confidence = computeConfidence(target, filtered.length, top.length)
  return {
    target,
    candidates: top,
    assumptions,
    confidence,
  }
}

function scoreCandidate(target: IndexedProduct, candidate: IndexedProduct): CompetitorCandidate {
  const priceSimilarity = similarityRatio(target.price, candidate.price)
  const typeSimilarity = normalize(target.type) === normalize(candidate.type) ? 1 : partialTypeOverlap(target.type, candidate.type)
  const revenueSimilarity = similarityRatio(target.revenue, candidate.revenue)
  const unitSimilarity = similarityRatio(target.units, candidate.units)
  const ratingFavorability = ratingScore(target.rating, candidate.rating)
  const momentumSimilarity = momentumScore(target.revenueMoM, candidate.revenueMoM)

  const score =
    priceSimilarity * WEIGHTS.price +
    typeSimilarity * WEIGHTS.type +
    revenueSimilarity * WEIGHTS.revenue +
    unitSimilarity * WEIGHTS.units +
    ratingFavorability * WEIGHTS.rating +
    momentumSimilarity * WEIGHTS.momentum

  const evidence = [
    `Price: ${formatSigned(candidate.price - target.price)} vs target (${candidate.price.toFixed(0)} vs ${target.price.toFixed(0)}).`,
    `Revenue: ${formatSigned(candidate.revenue - target.revenue)} monthly delta.`,
    `Units: ${formatSigned(candidate.units - target.units)} monthly delta.`,
    `Rating: ${(candidate.rating || 0).toFixed(1)} vs ${(target.rating || 0).toFixed(1)}.`,
  ]

  return {
    product: candidate,
    score: clamp(score, 0, 100),
    evidence,
  }
}

function risingStarBoost(product: IndexedProduct) {
  const growth = product.revenueMoM ?? 0
  const rankImproving = isRankImproving(product)
  if (growth < 0.2 || !rankImproving) return 0
  return clamp(growth * 20, 0, 8)
}

function isRankImproving(product: IndexedProduct) {
  if (product.history.length < 2) return false
  const current = product.history[product.history.length - 1]
  const previous = product.history[product.history.length - 2]
  if (current.rankRevenue === null || previous.rankRevenue === null) return false
  return current.rankRevenue < previous.rankRevenue
}

function computeConfidence(target: IndexedProduct, candidateCount: number, topCount: number) {
  let score = 0.45
  if (target.type && normalize(target.type) !== "unknown") score += 0.15
  if (target.price > 0 && target.revenue > 0 && target.units > 0) score += 0.15
  if (candidateCount >= 5) score += 0.15
  if (topCount >= 3) score += 0.1
  return clamp(score, 0, 1)
}

function similarityRatio(a: number, b: number) {
  if (a <= 0 || b <= 0) return 0
  const gap = Math.abs(a - b) / Math.max(a, b)
  return clamp(1 - gap, 0, 1)
}

function ratingScore(targetRating: number, candidateRating: number) {
  if (targetRating <= 0 || candidateRating <= 0) return 0.5
  const diff = candidateRating - targetRating
  return clamp(0.6 + diff / 2, 0, 1)
}

function momentumScore(target: number | null, candidate: number | null) {
  if (target === null || candidate === null) return 0.5
  const diff = Math.abs(target - candidate)
  return clamp(1 - diff, 0, 1)
}

function partialTypeOverlap(a: string, b: string) {
  const left = normalize(a)
  const right = normalize(b)
  if (!left || !right) return 0
  if (left.includes(right) || right.includes(left)) return 0.65
  return 0.2
}

function formatSigned(value: number) {
  if (!Number.isFinite(value)) return "0"
  const rounded = Math.round(value)
  return `${rounded >= 0 ? "+" : ""}${rounded.toLocaleString("en-US")}`
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
