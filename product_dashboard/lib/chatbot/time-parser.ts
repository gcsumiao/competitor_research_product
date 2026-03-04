import type { HistoricalWindow, TimeIntent } from "@/lib/chatbot/types"

const MONTH_INDEX: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
}

export type ParsedTimeReference = {
  timeIntent: TimeIntent
  requestedMonth?: string
  requestedWindow?: HistoricalWindow
  compareToPreviousMonth: boolean
  compareToSameMonthLastYear: boolean
}

export function parseTimeReference(message: string): ParsedTimeReference {
  const normalized = message.toLowerCase()
  const explicitMonth = parseExplicitMonth(normalized)
  const requestedWindow = parseWindow(normalized)

  const thisMonth = /\b(this month|current month)\b/.test(normalized)
  const lastMonth = /\b(last month|previous month|prior month)\b/.test(normalized)
  const yoy = /\b(yoy|year over year|same month last year|vs last year|last year)\b/.test(normalized)
  const mom = /\b(mom|month over month|vs last|compared to last month)\b/.test(normalized)

  let timeIntent: TimeIntent = "none"
  if (explicitMonth) {
    timeIntent = "explicit_month"
  } else if (requestedWindow) {
    timeIntent = "window"
  } else if (lastMonth) {
    timeIntent = "last_month"
  } else if (thisMonth) {
    timeIntent = "this_month"
  }

  return {
    timeIntent,
    requestedMonth: explicitMonth ?? undefined,
    requestedWindow,
    compareToPreviousMonth: mom || lastMonth,
    compareToSameMonthLastYear: yoy,
  }
}

function parseWindow(normalized: string): HistoricalWindow | undefined {
  const match = normalized.match(/\blast\s*(3|6|12)\s*(m|mo|month|months)\b/)
  if (!match) return undefined
  const amount = Number(match[1])
  if (amount === 3) return "3m"
  if (amount === 6) return "6m"
  if (amount === 12) return "12m"
  return undefined
}

function parseExplicitMonth(normalized: string): string | null {
  // 202601
  const compact = normalized.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/)
  if (compact) return toMonthKey(Number(compact[1]), Number(compact[2]))

  // 2026-01 or 2026/01
  const iso = normalized.match(/\b(20\d{2})[-\/](0?[1-9]|1[0-2])\b/)
  if (iso) return toMonthKey(Number(iso[1]), Number(iso[2]))

  // Jan 2026 / January '26
  const monthYear = normalized.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+'?(\d{2}|\d{4})\b/
  )
  if (monthYear) {
    const month = MONTH_INDEX[monthYear[1]]
    const year = normalizeYear(monthYear[2])
    if (month && year) return toMonthKey(year, month)
  }

  // 2026 Jan
  const yearMonth = normalized.match(
    /\b(20\d{2})\s*(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/
  )
  if (yearMonth) {
    const month = MONTH_INDEX[yearMonth[2]]
    const year = Number(yearMonth[1])
    if (month) return toMonthKey(year, month)
  }

  return null
}

function normalizeYear(value: string) {
  if (value.length === 4) return Number(value)
  const short = Number(value)
  if (!Number.isFinite(short)) return null
  return short >= 70 ? 1900 + short : 2000 + short
}

function toMonthKey(year: number, month: number) {
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return null
  }
  return `${year}-${String(month).padStart(2, "0")}`
}
