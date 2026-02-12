import { getTableSchema, listTableSchemas, type LlmTableName } from "@/lib/chatbot/llm-data-catalog"
import type { LlmDataStore, LlmRow } from "@/lib/chatbot/llm-data-store"

export type SqlToolResult = {
  ok: boolean
  error?: string
  rows: LlmRow[]
  rowCount: number
}

const DISALLOWED_SQL = /\b(insert|update|delete|drop|alter|create|truncate|attach|pragma)\b/i

export function listTablesTool(store: LlmDataStore) {
  return listTableSchemas().map((schema) => ({
    table: schema.name,
    description: schema.description,
    row_count: store.tables[schema.name].length,
  }))
}

export function describeTableTool(table: string) {
  const schema = getTableSchema(table)
  if (!schema) {
    return { ok: false, error: `Unknown table: ${table}` }
  }
  return {
    ok: true,
    table: schema.name,
    description: schema.description,
    columns: schema.columns,
  }
}

export function runSqlTool(
  store: LlmDataStore,
  query: string,
  requestedLimit?: number
): SqlToolResult {
  const trimmed = query.trim().replace(/\s+/g, " ")
  if (!trimmed.toLowerCase().startsWith("select ")) {
    return { ok: false, error: "Only SELECT queries are allowed.", rows: [], rowCount: 0 }
  }
  if (DISALLOWED_SQL.test(trimmed)) {
    return { ok: false, error: "Mutation SQL is not allowed.", rows: [], rowCount: 0 }
  }

  const parsed = parseSql(trimmed)
  if (!parsed) {
    return {
      ok: false,
      error: "Unsupported SQL syntax. Use SELECT ... FROM ... WHERE ... ORDER BY ... LIMIT ...",
      rows: [],
      rowCount: 0,
    }
  }

  const schema = getTableSchema(parsed.table)
  if (!schema) {
    return { ok: false, error: `Unknown table: ${parsed.table}`, rows: [], rowCount: 0 }
  }

  const baseRows = store.tables[parsed.table]
  let rows = baseRows.slice()

  rows = applyWhere(rows, parsed.where)
  rows = applyOrderBy(rows, parsed.orderBy)
  const projected = applySelect(rows, parsed.select)
  const limit = Math.max(1, Math.min(500, requestedLimit ?? parsed.limit ?? 50))
  const limited = projected.slice(0, limit)

  return {
    ok: true,
    rows: limited,
    rowCount: projected.length,
  }
}

type ParsedSql = {
  table: LlmTableName
  select: string
  where: string
  orderBy: string
  limit: number | null
}

function parseSql(query: string): ParsedSql | null {
  const normalized = query.replace(/;+\s*$/, "")
  const re =
    /^select\s+(.+?)\s+from\s+([a-z_][a-z0-9_]*)\s*(?:where\s+(.+?))?\s*(?:order\s+by\s+(.+?))?\s*(?:limit\s+(\d+))?\s*$/i
  const match = normalized.match(re)
  if (!match) return null
  const table = match[2].toLowerCase() as LlmTableName
  return {
    select: match[1].trim(),
    table,
    where: (match[3] ?? "").trim(),
    orderBy: (match[4] ?? "").trim(),
    limit: match[5] ? Number(match[5]) : null,
  }
}

function applyWhere(rows: LlmRow[], whereClause: string) {
  if (!whereClause) return rows
  const conditions = whereClause
    .split(/\s+and\s+/i)
    .map((item) => item.trim())
    .filter(Boolean)
  return rows.filter((row) => conditions.every((condition) => evaluateCondition(row, condition)))
}

function evaluateCondition(row: LlmRow, condition: string) {
  const isNull = condition.match(/^([a-z_][a-z0-9_]*)\s+is\s+null$/i)
  if (isNull) {
    const key = isNull[1]
    return row[key] === null || row[key] === ""
  }
  const isNotNull = condition.match(/^([a-z_][a-z0-9_]*)\s+is\s+not\s+null$/i)
  if (isNotNull) {
    const key = isNotNull[1]
    return row[key] !== null && row[key] !== ""
  }
  const inMatch = condition.match(/^([a-z_][a-z0-9_]*)\s+in\s+\((.+)\)$/i)
  if (inMatch) {
    const key = inMatch[1]
    const values = inMatch[2]
      .split(",")
      .map((token) => stripQuotes(token.trim()).toLowerCase())
    return values.includes(String(row[key] ?? "").toLowerCase())
  }
  const likeMatch = condition.match(/^([a-z_][a-z0-9_]*)\s+like\s+(.+)$/i)
  if (likeMatch) {
    const key = likeMatch[1]
    const pattern = stripQuotes(likeMatch[2].trim()).toLowerCase().replace(/%/g, "")
    return String(row[key] ?? "").toLowerCase().includes(pattern)
  }
  const cmpMatch = condition.match(
    /^([a-z_][a-z0-9_]*)\s*(=|!=|>=|<=|>|<)\s*(.+)$/i
  )
  if (!cmpMatch) return false
  const key = cmpMatch[1]
  const op = cmpMatch[2]
  const rightRaw = stripQuotes(cmpMatch[3].trim())
  const left = row[key]
  const rightNumber = Number(rightRaw)
  const leftNumber = typeof left === "number" ? left : Number(left)
  const bothNumeric = Number.isFinite(rightNumber) && Number.isFinite(leftNumber)

  if (bothNumeric) {
    if (op === "=") return leftNumber === rightNumber
    if (op === "!=") return leftNumber !== rightNumber
    if (op === ">") return leftNumber > rightNumber
    if (op === "<") return leftNumber < rightNumber
    if (op === ">=") return leftNumber >= rightNumber
    if (op === "<=") return leftNumber <= rightNumber
    return false
  }

  const leftStr = String(left ?? "").toLowerCase()
  const rightStr = rightRaw.toLowerCase()
  if (op === "=") return leftStr === rightStr
  if (op === "!=") return leftStr !== rightStr
  if (op === ">") return leftStr > rightStr
  if (op === "<") return leftStr < rightStr
  if (op === ">=") return leftStr >= rightStr
  if (op === "<=") return leftStr <= rightStr
  return false
}

function applyOrderBy(rows: LlmRow[], orderByClause: string) {
  if (!orderByClause) return rows
  const [columnRaw, directionRaw] = orderByClause.split(/\s+/)
  const column = columnRaw?.trim()
  if (!column) return rows
  const direction = directionRaw?.toLowerCase() === "asc" ? 1 : -1
  return rows.slice().sort((a, b) => compareValues(a[column], b[column]) * direction)
}

function compareValues(a: unknown, b: unknown) {
  const aNum = typeof a === "number" ? a : Number(a)
  const bNum = typeof b === "number" ? b : Number(b)
  const numeric = Number.isFinite(aNum) && Number.isFinite(bNum)
  if (numeric) return aNum - bNum
  return String(a ?? "").localeCompare(String(b ?? ""))
}

function applySelect(rows: LlmRow[], selectClause: string) {
  const select = selectClause.trim()
  if (select === "*") return rows
  const columns = select
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((token) => {
      const asMatch = token.match(/^(.+?)\s+as\s+([a-z_][a-z0-9_]*)$/i)
      if (asMatch) return { expr: asMatch[1].trim(), alias: asMatch[2].trim() }
      return { expr: token, alias: token }
    })
  return rows.map((row) => {
    const out: LlmRow = {}
    for (const col of columns) {
      out[col.alias] = row[col.expr] ?? null
    }
    return out
  })
}

function stripQuotes(value: string) {
  return value.replace(/^['"]|['"]$/g, "")
}
