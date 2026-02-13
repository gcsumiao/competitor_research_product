const DATE_YYYYMMDD = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_YYYYMM = /^(\d{4})-(\d{2})$/
const DATE_YYYYMM_COMPACT = /^(\d{4})(\d{2})$/

function toMonthEnd(year: number, month: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }
  const end = new Date(Date.UTC(year, month, 0))
  const yyyy = String(end.getUTCFullYear())
  const mm = String(end.getUTCMonth() + 1).padStart(2, "0")
  const dd = String(end.getUTCDate()).padStart(2, "0")
  return `${yyyy}-${mm}-${dd}`
}

export function normalizeSnapshotDate(input: string) {
  const value = input.trim()
  if (!value) return input

  const matchYmd = value.match(DATE_YYYYMMDD)
  if (matchYmd) {
    const year = Number(matchYmd[1])
    const month = Number(matchYmd[2])
    return toMonthEnd(year, month) ?? value
  }

  const matchYm = value.match(DATE_YYYYMM)
  if (matchYm) {
    const year = Number(matchYm[1])
    const month = Number(matchYm[2])
    return toMonthEnd(year, month) ?? value
  }

  const matchYmCompact = value.match(DATE_YYYYMM_COMPACT)
  if (matchYmCompact) {
    const year = Number(matchYmCompact[1])
    const month = Number(matchYmCompact[2])
    return toMonthEnd(year, month) ?? value
  }

  return value
}

export function formatSnapshotDateFull(input: string) {
  return normalizeSnapshotDate(input)
}

export function formatSnapshotLabelMonthEnd(input: string) {
  const normalized = normalizeSnapshotDate(input)
  const match = normalized.match(DATE_YYYYMMDD)
  if (!match) return normalized

  const date = new Date(`${normalized}T00:00:00Z`)
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(date)
}

