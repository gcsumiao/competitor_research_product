import { readdir, readFile, stat } from "fs/promises"
import path from "path"
import { unstable_cache } from "next/cache"

import type { CategoryId } from "@/lib/competitor-data"
import { DASHBOARD_DATA_TAG, DEFAULT_CACHE_REVALIDATE_SECONDS, REPORT_FILES_TAG } from "@/lib/db/constants"
import { queryDb } from "@/lib/db/client"
import { isFullDashboardEnabled, resolveCodeReaderDataDir, resolveNonCodeDataRoot } from "@/lib/dashboard-runtime"
import { isPostgresDashboardSource } from "@/lib/dashboard-runtime"
import {
  findNonCodeCategoryByFolder,
  getNonCodeCategoryConfig,
  isConfiguredVisibleReport,
  isNonCodeCategoryId,
} from "@/lib/non-code-category-config"

export type ReportSource = CategoryId

export type ReportFile = {
  name: string
  relativePath: string
  category: string
  modifiedAt: string
  source: ReportSource
  month?: string
}

const EXCLUDE_PREFIXES = ["~$", "._", ".__"]
const EXCLUDE_KEYWORDS = ["type_mapping", "mapping", "__zip"]
const CODE_READER_FILES = ["report.xlsx", "analysis.xlsx"] as const
const IGNORED_SOURCE_DIRS = new Set([".git", ".venv", "__pycache__", "_archive"])

export async function loadReportFiles(): Promise<ReportFile[]> {
  return isPostgresDashboardSource()
    ? loadReportFilesFromPostgresCached()
    : loadReportFilesFromFiles()
}

export async function loadReportFilesFromFiles(): Promise<ReportFile[]> {
  const [nonCodeReports, codeReaderReports] = await Promise.all([
    isFullDashboardEnabled() ? loadNonCodeReportFiles() : Promise.resolve([]),
    loadCodeReaderReportFiles(),
  ])

  return [...nonCodeReports, ...codeReaderReports].sort((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt)
  )
}

const loadReportFilesFromPostgresCached = unstable_cache(
  loadReportFilesFromPostgres,
  ["report-files", "postgres"],
  {
    tags: [DASHBOARD_DATA_TAG, REPORT_FILES_TAG],
    revalidate: DEFAULT_CACHE_REVALIDATE_SECONDS,
  }
)

async function loadNonCodeReportFiles(): Promise<ReportFile[]> {
  const baseDir = resolveNonCodeDataRoot()
  if (!baseDir) return []
  const files = await listFiles(baseDir)
  const reports: ReportFile[] = []
  for (const filePath of files) {
    const name = path.basename(filePath)
    if (!isReportFile(name)) continue

    const relativePath = path.relative(baseDir, filePath)
    const category = findNonCodeCategoryByFolder(relativePath)
    if (!category || !isConfiguredVisibleReport(category.id, relativePath)) continue
    const stats = await stat(filePath)

    reports.push({
      name,
      relativePath,
      category: category.label,
      modifiedAt: stats.mtime.toISOString(),
      source: category.id,
    })
  }

  return reports
}

async function loadCodeReaderReportFiles(): Promise<ReportFile[]> {
  const baseDir = resolveCodeReaderDataDir()
  const monthEntries = await readdir(baseDir, { withFileTypes: true }).catch(() => [])
  const reports: ReportFile[] = []

  for (const entry of monthEntries) {
    if (!entry.isDirectory() || !/^\d{6}$/.test(entry.name)) continue
    const month = entry.name
    const monthDir = path.join(baseDir, month)
    const manifest = await readManifest(path.join(monthDir, "manifest.json"))

    for (const fileName of CODE_READER_FILES) {
      const fullPath = path.join(monthDir, fileName)
      const stats = await safeStat(fullPath)
      if (!stats) continue

      const relativePath = path.relative(baseDir, fullPath)
      const readableName = getCodeReaderDisplayName({
        month,
        fileName,
        manifest,
      })

      reports.push({
        name: readableName,
        relativePath,
        category: "Code Reader & Scanner",
        modifiedAt: stats.mtime.toISOString(),
        source: "code_reader_scanner",
        month,
      })
    }
  }

  return reports
}

async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (IGNORED_SOURCE_DIRS.has(entry.name)) continue
      const nested = await listFiles(fullPath)
      files.push(...nested)
    } else if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files
}

function isReportFile(name: string): boolean {
  const lower = name.toLowerCase()
  if (!lower.endsWith(".xlsx")) return false
  if (EXCLUDE_PREFIXES.some((prefix) => lower.startsWith(prefix))) return false
  if (EXCLUDE_KEYWORDS.some((keyword) => lower.includes(keyword))) return false
  return true
}

async function safeStat(filePath: string) {
  try {
    return await stat(filePath)
  } catch {
    return null
  }
}

async function readManifest(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, "utf8")
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function getCodeReaderDisplayName({
  month,
  fileName,
  manifest,
}: {
  month: string
  fileName: (typeof CODE_READER_FILES)[number]
  manifest: Record<string, unknown> | null
}) {
  const providedName =
    fileName === "report.xlsx"
      ? manifest?.reportFileName
      : manifest?.analysisFileName

  if (typeof providedName === "string" && providedName.trim()) {
    return providedName
  }

  const year = month.slice(0, 4)
  const mm = month.slice(4, 6)
  const title = fileName === "report.xlsx" ? "Report" : "Analysis"
  return `${year}-${mm} Code Reader & Scanner ${title}.xlsx`
}

export async function loadReportFilesFromPostgres(): Promise<ReportFile[]> {
  const fullDashboardEnabled = isFullDashboardEnabled()
  const result = await queryDb<{
    artifact_path: string
    category_id: string | null
    month_key: string | null
    file_name: string
    modified_at: Date | string | null
    metadata: Record<string, unknown> | string | null
  }>(
    `
      SELECT artifact_path, category_id, month_key, file_name, modified_at, metadata
      FROM source_artifacts
      WHERE COALESCE((metadata->>'reportVisible')::boolean, false) = true
      ORDER BY modified_at DESC NULLS LAST, artifact_path ASC
    `
  )

  return result.rows
    .filter((row) => fullDashboardEnabled || row.category_id === "code_reader_scanner")
    .map((row) => {
      const metadata = parseMetadata(row.metadata)
      const configuredLabel =
        isNonCodeCategoryId(row.category_id)
          ? getNonCodeCategoryConfig(row.category_id)?.label
          : null
      const categoryLabel =
        typeof metadata.categoryLabel === "string"
          ? metadata.categoryLabel
          : row.category_id === "code_reader_scanner"
          ? "Code Reader & Scanner"
          : configuredLabel ?? "General"
    const displayName =
      typeof metadata.displayName === "string" && metadata.displayName.trim()
        ? metadata.displayName.trim()
        : row.file_name

      return {
        name: displayName,
        relativePath: row.artifact_path,
        category: categoryLabel,
        modifiedAt:
          row.modified_at instanceof Date
            ? row.modified_at.toISOString()
            : (row.modified_at ?? new Date(0).toISOString()),
        source: normalizeReportSource(row.category_id),
        month: row.month_key ?? undefined,
      } satisfies ReportFile
    })
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

function normalizeReportSource(categoryId: string | null): ReportSource {
  if (categoryId === "code_reader_scanner") return "code_reader_scanner"
  if (isNonCodeCategoryId(categoryId)) return categoryId
  return "code_reader_scanner"
}
