import path from "path"
import { constants as fsConstants } from "fs"
import { access, readFile } from "fs/promises"
import * as XLSX from "xlsx"

import type { CategoryId } from "@/lib/competitor-data"
import { getDashboardDeploymentMode, resolveNonCodeDataRoot } from "@/lib/dashboard-runtime"

export type TypeSummarySection = {
  title: string
  columns: string[]
  rows: string[][]
}

export type CategoryTypeSummary = {
  categoryId: CategoryId
  fileName: string
  sections: TypeSummarySection[]
}

const CATEGORY_FILES: Record<CategoryId, string[]> = {
  dmm: ["DMM/outputs/DMM_market_research_summary.xlsx"],
  borescope: [
    "Borescope/outputs/26-02-19 Borescope.xlsx",
    "Borescope/outputs/26-01-14 Borescope.xlsx",
    "Borescope/25-11-25 Borescope V4.xlsx",
  ],
  thermal_imager: [
    "Thermal Imager/26-01-14 Thermal Imager.xlsx",
    "Thermal Imager/25-11-25 Thermal Imager V4.xlsx",
  ],
  night_vision: ["Night Vision Monoculars/outputs/Night_Vision_Monoculars_top50(20260115).xlsx"],
  code_reader_scanner: [],
}

const SUMMARY_SHEET_REGEX = /^Top\s?50.*Summary/i

export async function loadTypeSummaries(): Promise<Record<CategoryId, CategoryTypeSummary | null>> {
  const result = {} as Record<CategoryId, CategoryTypeSummary | null>
  const deploymentMode = getDashboardDeploymentMode()
  const baseDir = deploymentMode === "full" ? resolveNonCodeDataRoot() : null

  for (const categoryId of Object.keys(CATEGORY_FILES) as CategoryId[]) {
    if (categoryId !== "code_reader_scanner" && deploymentMode !== "full") {
      result[categoryId] = null
      continue
    }

    const files = CATEGORY_FILES[categoryId]
    const filePath = baseDir ? await resolveWorkbookPath(baseDir, files) : null

    if (!filePath) {
      result[categoryId] = null
      continue
    }

    let workbook: XLSX.WorkBook
    try {
      const fileData = await readFile(filePath)
      workbook = XLSX.read(fileData, { type: "buffer" })
    } catch {
      result[categoryId] = null
      continue
    }
    const sections: TypeSummarySection[] = []

    for (const sheetName of workbook.SheetNames) {
      const trimmedName = sheetName.trim()
      if (!SUMMARY_SHEET_REGEX.test(trimmedName)) continue
      const worksheet = workbook.Sheets[sheetName]
      if (!worksheet) continue

      const rows = XLSX.utils.sheet_to_json<string[]>(worksheet, {
        header: 1,
        raw: false,
      })

      const filtered = rows
        .map((row) => row.map((cell) => `${cell ?? ""}`.trim()))
        .filter((row) => row.some((cell) => cell !== ""))

      if (!filtered.length) continue

      const [columns, ...dataRows] = filtered
      const trimmedRows = dataRows.slice(0, 12)

      sections.push({
        title: trimmedName,
        columns,
        rows: trimmedRows,
      })
    }

    result[categoryId] = {
      categoryId,
      fileName: path.basename(filePath),
      sections,
    }
  }

  return result
}

async function resolveWorkbookPath(baseDir: string, files: string[]) {
  for (const relativePath of files) {
    const candidate = path.join(baseDir, relativePath)
    try {
      await access(candidate, fsConstants.R_OK)
      return candidate
    } catch {
      continue
    }
  }
  return null
}
