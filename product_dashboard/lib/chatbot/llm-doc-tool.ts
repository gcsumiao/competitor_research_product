import { readFile } from "fs/promises"
import path from "path"
import * as XLSX from "xlsx"

import type { LlmDataStore } from "@/lib/chatbot/llm-data-store"

export type DocExcerptResult = {
  ok: boolean
  error?: string
  excerpt?: string
  sourceFile?: string
}

export async function getSourceExcerptTool(
  store: LlmDataStore,
  sourceFile: string,
  section?: string
): Promise<DocExcerptResult> {
  const target = resolveSourceFile(store, sourceFile)
  if (!target) {
    return { ok: false, error: "Unknown source file reference." }
  }

  try {
    const lower = target.toLowerCase()
    if (lower.endsWith(".csv")) {
      const raw = await readFile(target, "utf8")
      const lines = raw.split(/\r?\n/).filter(Boolean)
      const preview = lines.slice(0, 16).join("\n")
      return {
        ok: true,
        sourceFile: target,
        excerpt: preview,
      }
    }

    if (lower.endsWith(".xlsx")) {
      const workbook = XLSX.readFile(target, { cellDates: false })
      const sheetName =
        section && workbook.SheetNames.includes(section)
          ? section
          : workbook.SheetNames[0]
      if (!sheetName) {
        return { ok: false, error: "Workbook has no sheets." }
      }
      const sheet = workbook.Sheets[sheetName]
      const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        blankrows: false,
        raw: false,
      })
      const preview = rows
        .slice(0, 25)
        .map((row) => row.join(" | "))
        .join("\n")
      return {
        ok: true,
        sourceFile: target,
        excerpt: `Sheet: ${sheetName}\n${preview}`,
      }
    }

    const text = await readFile(target, "utf8")
    return {
      ok: true,
      sourceFile: target,
      excerpt: text.slice(0, 6000),
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to read source file.",
    }
  }
}

function resolveSourceFile(store: LlmDataStore, sourceFile: string) {
  if (!sourceFile) return null
  const normalizedRequested = normalizePath(sourceFile)
  const fromStore = store.sourceFiles.find(
    (file) => normalizePath(file) === normalizedRequested
  )
  if (fromStore) return fromStore

  const basename = path.basename(sourceFile).toLowerCase()
  return store.sourceFiles.find((file) => path.basename(file).toLowerCase() === basename) ?? null
}

function normalizePath(value: string) {
  return value.replace(/\\/g, "/").toLowerCase()
}
