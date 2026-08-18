export function buildRange(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value) && value > 0)
  if (!filtered.length) {
    return { min: 0, max: 0, median: 0 }
  }
  const sorted = [...filtered].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid]
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    median,
  }
}

export function median(values: number[]) {
  const filtered = values.filter((value) => Number.isFinite(value))
  if (!filtered.length) return 0
  const sorted = [...filtered].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid]
}

export function percentChange(current: number, previous: number) {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

export function pointChange(current: number, previous: number) {
  return (current - previous) * 100
}

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCurrencyCompact(value: number) {
  return `${value < 0 ? "-" : ""}$${formatCompactMagnitude(Math.abs(value))}`
}

export function formatNumberCompact(value: number) {
  return `${value < 0 ? "-" : ""}${formatCompactMagnitude(Math.abs(value))}`
}

export function formatInteger(value: number) {
  if (!Number.isFinite(value)) return "0"
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatCodeReaderCurrencyCompact(value: number) {
  return formatCurrencyCompact(value)
}

export function formatCodeReaderUnitsCompact(value: number) {
  return formatNumberCompact(value)
}

export function formatPercent(value: number) {
  if (!Number.isFinite(value)) return "0%"
  const rounded = Math.round(value * 100)
  return `${rounded === 0 ? 0 : rounded}%`
}

export function formatSigned(value: number, decimals: number) {
  const rounded = Number(value.toFixed(decimals))
  const normalized = rounded === 0 ? 0 : rounded
  const sign = normalized > 0 ? "+" : ""
  return `${sign}${normalized.toFixed(decimals)}`
}

export function formatChangeLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a"
  }
  const rounded = Math.round(value)
  const normalized = rounded === 0 ? 0 : rounded
  return `${normalized > 0 ? "+" : ""}${normalized}%`
}

export function formatRating(value: number) {
  if (!Number.isFinite(value)) return "n/a"
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatDeltaLabel(current: number, previous?: number) {
  if (!previous) return ""
  const delta = current - previous
  return `${delta >= 0 ? "+" : ""}${formatNumberCompact(delta)}`
}

export function truncateLabel(label: string, maxLength: number) {
  if (label.length <= maxLength) return label
  return `${label.slice(0, maxLength - 3)}...`
}

function formatCompactMagnitude(value: number) {
  if (!Number.isFinite(value)) return "0"
  if (value >= 1_000_000_000) return `${formatCompactDecimal(value / 1_000_000_000)}B`
  if (value >= 1_000_000) return `${formatCompactDecimal(value / 1_000_000)}M`
  if (value >= 1_000) return `${formatCompactDecimal(value / 1_000)}K`
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 0,
  }).format(value)
}

function formatCompactDecimal(value: number) {
  return value.toFixed(1)
}
