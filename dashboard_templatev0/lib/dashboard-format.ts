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

export function formatCurrency(value: number, decimals = 1) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatCurrencyCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatNumberCompact(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

export function formatPercent(value: number, decimals = 1) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: decimals,
  }).format(value)
}

export function formatSigned(value: number, decimals: number) {
  const sign = value > 0 ? "+" : value < 0 ? "" : ""
  return `${sign}${value.toFixed(decimals)}`
}

export function formatChangeLabel(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a"
  }
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
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
