const INTEGER_PRICE_FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
})

const COMPACT_CURRENCY_FORMATTERS = createCompactFormatters({
  style: "currency",
  currency: "USD",
})
const COMPACT_NUMBER_FORMATTERS = createCompactFormatters()

export function formatIntegerPrice(value: number) {
  return INTEGER_PRICE_FORMATTER.format(finiteOrZero(value))
}

export function formatSignedIntegerPrice(value: number) {
  const rounded = roundHalfAwayFromZero(finiteOrZero(value))
  const sign = rounded > 0 ? "+" : rounded < 0 ? "-" : ""
  return `${sign}${formatIntegerPrice(Math.abs(rounded))}`
}

export function formatCompactCurrency(value: number) {
  return compactFormatterFor(value, COMPACT_CURRENCY_FORMATTERS).format(finiteOrZero(value))
}

export function formatCompactNumber(value: number) {
  return compactFormatterFor(value, COMPACT_NUMBER_FORMATTERS).format(finiteOrZero(value))
}

export function formatSignedPercent(value: number | null) {
  if (value === null || Number.isNaN(value)) return "n/a"
  const rounded = roundedPercentage(value)
  return `${rounded > 0 ? "+" : ""}${rounded}%`
}

export function formatUnsignedPercent(value: number) {
  return `${roundedPercentage(value)}%`
}

export function formatSignedPercentagePoints(value: number) {
  const rounded = roundedPercentage(value)
  return `${rounded > 0 ? "+" : ""}${rounded}pt`
}

function roundedPercentage(value: number) {
  const priorDisplayPrecision = Number((finiteOrZero(value) * 100).toFixed(1))
  return roundHalfAwayFromZero(priorDisplayPrecision)
}

function roundHalfAwayFromZero(value: number) {
  const rounded = Math.sign(value) * Math.round(Math.abs(value))
  return Object.is(rounded, -0) ? 0 : rounded
}

function finiteOrZero(value: number) {
  return Number.isFinite(value) ? value : 0
}

function createCompactFormatters(options: Intl.NumberFormatOptions = {}) {
  return {
    underOneThousand: new Intl.NumberFormat("en-US", {
      ...options,
      notation: "compact",
      maximumFractionDigits: 0,
    }),
    compact: new Intl.NumberFormat("en-US", {
      ...options,
      notation: "compact",
      maximumFractionDigits: 1,
    }),
  }
}

function compactFormatterFor(
  value: number,
  formatters: ReturnType<typeof createCompactFormatters>
) {
  return Math.abs(finiteOrZero(value)) < 1_000
    ? formatters.underOneThousand
    : formatters.compact
}
