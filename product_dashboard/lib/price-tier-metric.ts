export type PriceTierMetric = "revenue" | "units"

/**
 * The Revenue/Units tier toggle only exists for code reader; non-code price
 * tiers carry no units, so they always read revenue. The raw selection is kept
 * in state so it is restored when the user returns to code reader.
 */
export function resolvePriceTierMetric(
  isCodeReader: boolean,
  selected: PriceTierMetric
): PriceTierMetric {
  return isCodeReader ? selected : "revenue"
}
