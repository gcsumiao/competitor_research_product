import type { HistoricalWindow } from "@/lib/chatbot/types"
import { normalizeSnapshotDate } from "@/lib/snapshot-date"
import { parseTimeReference } from "@/lib/chatbot/time-parser"

export type TimeResolution = {
  primarySnapshotDate: string
  compareSnapshotDate?: string
  warnings: string[]
  resolvedWindow?: HistoricalWindow
  fallbackApplied: boolean
}

export function resolveSnapshotTimeRange(params: {
  message: string
  availableSnapshotDates: string[]
  fallbackSnapshotDate: string
}): TimeResolution {
  const parsed = parseTimeReference(params.message)
  const warnings: string[] = []
  const normalized = normalizeAvailableSnapshots(params.availableSnapshotDates)

  if (!normalized.length) {
    const fallback = normalizeSnapshotDate(params.fallbackSnapshotDate)
    return {
      primarySnapshotDate: fallback,
      warnings: ["No available snapshot list was provided; using fallback snapshot."],
      fallbackApplied: true,
      resolvedWindow: parsed.requestedWindow,
    }
  }

  const fallbackSnapshot = findSnapshotByDate(normalized, params.fallbackSnapshotDate)
    ?? findSnapshotByDate(normalized, normalizeSnapshotDate(params.fallbackSnapshotDate))
    ?? normalized[normalized.length - 1]

  let primary = fallbackSnapshot
  let fallbackApplied = false

  if (parsed.requestedMonth) {
    const exact = findSnapshotByMonth(normalized, parsed.requestedMonth)
    if (exact) {
      primary = exact
    } else {
      const nearestEarlier = findNearestEarlierMonth(normalized, parsed.requestedMonth)
      primary = nearestEarlier ?? normalized[0]
      warnings.push(
        `Requested month ${parsed.requestedMonth} was unavailable; using ${primary.monthKey}.`
      )
      fallbackApplied = true
    }
  } else if (parsed.timeIntent === "this_month") {
    primary = normalized[normalized.length - 1]
  } else if (parsed.timeIntent === "last_month") {
    const previous = previousSnapshot(normalized, fallbackSnapshot.date)
    if (previous) {
      primary = previous
    } else {
      primary = fallbackSnapshot
      warnings.push(`No prior month was found before ${fallbackSnapshot.monthKey}; using current snapshot.`)
      fallbackApplied = true
    }
  }

  let compareSnapshotDate: string | undefined
  if (parsed.compareToSameMonthLastYear) {
    const yoyMonth = shiftMonth(primary.monthKey, -12)
    if (yoyMonth) {
      const yoy = findSnapshotByMonth(normalized, yoyMonth) ?? findNearestEarlierMonth(normalized, yoyMonth)
      if (yoy) {
        compareSnapshotDate = yoy.date
        if (yoy.monthKey !== yoyMonth) {
          warnings.push(`Exact YoY month ${yoyMonth} unavailable; using ${yoy.monthKey} instead.`)
          fallbackApplied = true
        }
      } else {
        warnings.push("No comparable YoY snapshot found in available history.")
      }
    }
  } else if (parsed.compareToPreviousMonth) {
    const previous = previousSnapshot(normalized, primary.date)
    if (previous) {
      compareSnapshotDate = previous.date
    } else {
      warnings.push(`No previous-month snapshot exists before ${primary.monthKey}.`)
    }
  }

  return {
    primarySnapshotDate: primary.date,
    compareSnapshotDate,
    warnings,
    resolvedWindow: parsed.requestedWindow,
    fallbackApplied,
  }
}

type SnapshotPoint = {
  date: string
  monthKey: string
}

function normalizeAvailableSnapshots(dates: string[]) {
  const points = dates
    .map((value) => normalizeSnapshotDate(value))
    .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .map((date) => ({
      date,
      monthKey: date.slice(0, 7),
    }))

  const uniqueByDate = new Map(points.map((point) => [point.date, point]))
  return Array.from(uniqueByDate.values()).sort((a, b) => a.date.localeCompare(b.date))
}

function findSnapshotByDate(points: SnapshotPoint[], date: string) {
  const normalized = normalizeSnapshotDate(date)
  return points.find((point) => point.date === normalized)
}

function findSnapshotByMonth(points: SnapshotPoint[], monthKey: string) {
  return points.find((point) => point.monthKey === monthKey)
}

function findNearestEarlierMonth(points: SnapshotPoint[], monthKey: string) {
  const candidates = points.filter((point) => point.monthKey <= monthKey)
  return candidates[candidates.length - 1]
}

function previousSnapshot(points: SnapshotPoint[], date: string) {
  const index = points.findIndex((point) => point.date === date)
  if (index <= 0) return undefined
  return points[index - 1]
}

function shiftMonth(monthKey: string, delta: number) {
  const match = monthKey.match(/^(\d{4})-(\d{2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  if (Number.isNaN(date.getTime())) return null
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`
}
