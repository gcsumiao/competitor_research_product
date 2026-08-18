import type { CodeReaderDataMart, IndexedProduct } from "@/lib/chatbot/code-reader-index"

export type CompetitorCandidate = {
  product: IndexedProduct
}

export type CompetitorResult = {
  target: IndexedProduct
  candidates: CompetitorCandidate[]
  assumptions: string[]
  confidence: number
  widenedPriceBand: boolean
  priceBand: { min: number; max: number }
}

const OWN_BRANDS = new Set(["innova", "blcktec"])

export function findBiggestCompetitors(
  mart: CodeReaderDataMart,
  target: IndexedProduct
): CompetitorResult {
  const targetIsOwnBrand = OWN_BRANDS.has(normalize(target.brand))
  const priceBand = {
    min: Math.max(0, target.price * 0.5),
    max: Math.max(0, target.price * 1.5),
  }
  const sameType = mart.products.filter((item) => {
    if (normalize(item.asin) === normalize(target.asin)) return false
    if (normalize(item.brand) === normalize(target.brand)) return false
    if (targetIsOwnBrand && OWN_BRANDS.has(normalize(item.brand))) return false
    return normalize(item.type) === normalize(target.type) && item.revenue > 0
  })
  const inPriceBand = sameType.filter(
    (item) => target.price <= 0 || (item.price >= priceBand.min && item.price <= priceBand.max)
  )
  const widenedPriceBand = inPriceBand.length === 0 && sameType.length > 0
  const candidates = (widenedPriceBand ? sameType : inPriceBand)
    .sort((left, right) => right.revenue - left.revenue || right.units - left.units)
    .slice(0, 3)
    .map((product) => ({ product }))

  return {
    target,
    candidates,
    widenedPriceBand,
    priceBand,
    confidence: candidates.length >= 3 ? 0.94 : candidates.length > 0 ? 0.86 : 0.5,
    assumptions: [
      "Competitors share the target product type and normally fall between 0.5x and 1.5x the target price.",
      targetIsOwnBrand
        ? "Innova and BLCKTEC products are excluded from the rival set."
        : "Because the target is a competitor product, Innova and BLCKTEC products remain eligible rivals.",
      widenedPriceBand
        ? "No same-type rival fell inside the normal price band, so the comparison widened to all prices within the same type."
        : "The biggest competitor is the highest-current-month-revenue rival in the same-type price band.",
    ],
  }
}

function normalize(value: string | null | undefined) {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
