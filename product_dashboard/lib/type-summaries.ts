import path from "path"
import { constants as fsConstants } from "fs"
import { access, readFile, readdir, stat } from "fs/promises"
import { unstable_cache } from "next/cache"
import * as XLSX from "xlsx"

import { DASHBOARD_DATA_TAG, DEFAULT_CACHE_REVALIDATE_SECONDS, TYPE_SUMMARIES_TAG } from "@/lib/db/constants"
import { queryDb } from "@/lib/db/client"
import type { CategoryId } from "@/lib/competitor-data"
import {
  getDashboardDeploymentMode,
  isPostgresDashboardSource,
  resolveNonCodeCategoryDir,
} from "@/lib/dashboard-runtime"
import {
  getNonCodeCategoryConfig,
  isNonCodeCategoryId,
  listNonCodeCategoryIds,
  type FileLocator,
} from "@/lib/non-code-category-config"

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

const SUMMARY_SHEET_REGEX = /^Top\s?50.*Summary/i

export async function loadTypeSummaries(): Promise<Record<CategoryId, CategoryTypeSummary | null>> {
  return isPostgresDashboardSource()
    ? loadTypeSummariesFromPostgresCached()
    : loadTypeSummariesFromFiles()
}

export async function loadTypeSummariesFromFiles(): Promise<Record<CategoryId, CategoryTypeSummary | null>> {
  const result = {} as Record<CategoryId, CategoryTypeSummary | null>
  const deploymentMode = getDashboardDeploymentMode()

  for (const categoryId of ["code_reader_scanner", ...listNonCodeCategoryIds()] as CategoryId[]) {
    if (categoryId !== "code_reader_scanner" && deploymentMode !== "full") {
      result[categoryId] = null
      continue
    }

    const filePath = await resolveTypeSummaryPath(categoryId)

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

      sections.push({
        title: trimmedName,
        columns,
        rows: dataRows,
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

const loadTypeSummariesFromPostgresCached = unstable_cache(
  loadTypeSummariesFromPostgres,
  ["type-summaries", "postgres"],
  {
    tags: [DASHBOARD_DATA_TAG, TYPE_SUMMARIES_TAG],
    revalidate: DEFAULT_CACHE_REVALIDATE_SECONDS,
  }
)

export async function loadTypeSummariesFromPostgres(): Promise<Record<CategoryId, CategoryTypeSummary | null>> {
  const result = {} as Record<CategoryId, CategoryTypeSummary | null>
  const deploymentMode = getDashboardDeploymentMode()
  const rows = await queryDb<{
    category_id: CategoryId
    metadata: Record<string, unknown> | string | null
  }>(
    `
      SELECT DISTINCT ON (category_id) category_id, metadata
      FROM category_snapshots
      ORDER BY category_id, snapshot_date DESC
    `
  )

  const metadataByCategory = new Map(rows.rows.map((row) => [row.category_id, parseMetadata(row.metadata)]))

  for (const categoryId of ["code_reader_scanner", ...listNonCodeCategoryIds()] as CategoryId[]) {
    if (categoryId !== "code_reader_scanner" && deploymentMode !== "full") {
      result[categoryId] = null
      continue
    }

    const metadata = metadataByCategory.get(categoryId) ?? {}
    const sections = Array.isArray(metadata.typeSummarySections)
      ? (metadata.typeSummarySections as TypeSummarySection[])
      : []
    const fileName = typeof metadata.typeSummaryFileName === "string"
      ? metadata.typeSummaryFileName
      : ""

    result[categoryId] = sections.length || fileName
      ? {
          categoryId,
          fileName,
          sections,
        }
      : null
  }

  return result
}

function parseMetadata(value: Record<string, unknown> | string | null) {
  if (!value) return {}
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {}
    } catch {
      return {}
    }
  }
  return value
}

async function resolveTypeSummaryPath(categoryId: CategoryId) {
  if (!isNonCodeCategoryId(categoryId)) return null
  const locators = getNonCodeCategoryConfig(categoryId)?.typeSummarySources ?? []
  for (const locator of locators) {
    const resolved = await resolveCategoryFile(categoryId, locator)
    if (resolved) return resolved
  }
  return null
}

async function resolveCategoryFile(categoryId: string, locator: FileLocator) {
  if (!isNonCodeCategoryId(categoryId)) return null

  if (locator.mode === "exact") {
    const candidate = resolveNonCodeCategoryDir(categoryId, ...splitRelativePath(locator.relativePath))
    if (!candidate) return null
    try {
      await access(candidate, fsConstants.R_OK)
      return candidate
    } catch {
      return null
    }
  }

  const relativeDir = ("relativeDir" in locator ? locator.relativeDir : "") ?? ""
  const dir = resolveNonCodeCategoryDir(categoryId, ...splitRelativePath(relativeDir))
  if (!dir) return null
  return findMatchedWorkbook(dir, locator.filePattern, locator.mode === "latest_match")
}

async function findMatchedWorkbook(dir: string, filePattern: RegExp, latestOnly: boolean) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => path.join(dir, entry.name))

  if (!candidates.length) return null
  if (!latestOnly) {
    candidates.sort()
    return candidates[0]
  }

  const withStats = await Promise.all(
    candidates.map(async (candidate) => {
      const fileStat = await stat(candidate).catch(() => null)
      return fileStat
        ? {
            file: candidate,
            mtimeMs: fileStat.mtimeMs,
          }
        : null
    })
  )

  const valid = withStats.filter((item): item is { file: string; mtimeMs: number } => Boolean(item))
  if (!valid.length) return null

  valid.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return valid[0].file
}

function splitRelativePath(value: string) {
  return value
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
}
