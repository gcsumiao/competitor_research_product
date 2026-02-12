import * as XLSX from "xlsx"

export type WorkbookSchema = {
  sheetNames: string[]
  sheetColumns: Record<string, string[]>
  signals: string[]
}

const HEADER_SCAN_LIMIT = 18

export function detectWorkbookSchema(workbook: XLSX.WorkBook): WorkbookSchema {
  const sheetColumns: Record<string, string[]> = {}

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = sheetRows(sheet)
    const headers = detectHeaderRow(rows)
    sheetColumns[sheetName] = headers
  }

  const signals = detectSignals(workbook.SheetNames, sheetColumns)

  return {
    sheetNames: workbook.SheetNames,
    sheetColumns,
    signals,
  }
}

function detectSignals(sheetNames: string[], columns: Record<string, string[]>) {
  const names = sheetNames.map((name) => normalize(name))
  const allColumns = Object.values(columns).flat().map((col) => normalize(col))
  const hasColumn = (needle: string) => allColumns.some((col) => col.includes(needle))

  const signals: string[] = []

  if (names.some((name) => name.includes("top50") || name.includes("topasins"))) {
    signals.push("top_products")
  }
  if (names.some((name) => name.includes("summary") || name.includes("brandsummary"))) {
    signals.push("brand_summary")
  }
  if (names.some((name) => name.includes("type")) || hasColumn("producttype")) {
    signals.push("type_mix")
  }
  if (names.some((name) => name.includes("price") || name.includes("tier")) || hasColumn("pricetier")) {
    signals.push("price_tiers")
  }
  if (
    hasColumn("laser") ||
    hasColumn("wifi") ||
    hasColumn("visualcamera") ||
    hasColumn("isrechargeable") ||
    hasColumn("isautomotive")
  ) {
    signals.push("features")
  }
  if (hasColumn("reviewsrating") || hasColumn("avgrating") || hasColumn("toolrating")) {
    signals.push("ratings")
  }

  return signals
}

function detectHeaderRow(rows: string[][]): string[] {
  let best: string[] = []
  let bestScore = 0

  for (let index = 0; index < Math.min(HEADER_SCAN_LIMIT, rows.length); index += 1) {
    const row = rows[index]
    const score = headerScore(row)
    if (score > bestScore) {
      best = row.filter(Boolean)
      bestScore = score
    }
  }

  return best
}

function headerScore(row: string[]) {
  let score = 0
  for (const cell of row) {
    const normalized = normalize(cell)
    if (!normalized) continue
    if (
      normalized.includes("asin") ||
      normalized.includes("brand") ||
      normalized.includes("revenue") ||
      normalized.includes("sales") ||
      normalized.includes("unit") ||
      normalized.includes("price") ||
      normalized.includes("rating") ||
      normalized.includes("review")
    ) {
      score += 2
    } else if (normalized.length >= 4) {
      score += 1
    }
  }
  return score
}

function sheetRows(sheet: XLSX.WorkSheet) {
  const rows = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    blankrows: false,
  }) as unknown[][]

  return rows.map((row) => row.map((cell) => `${cell ?? ""}`.trim()))
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}
