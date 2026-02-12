import { readdir, readFile, stat } from "fs/promises"
import path from "path"

export type ReportSource = "dmm" | "code_reader_scanner"

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

export async function loadReportFiles(): Promise<ReportFile[]> {
  const [dmmReports, codeReaderReports] = await Promise.all([
    loadDmmReportFiles(),
    loadCodeReaderReportFiles(),
  ])

  return [...dmmReports, ...codeReaderReports].sort((a, b) =>
    b.modifiedAt.localeCompare(a.modifiedAt)
  )
}

async function loadDmmReportFiles(): Promise<ReportFile[]> {
  const baseDir = path.resolve(process.cwd(), "..", "DMM_h10")
  const files = await listFiles(baseDir)
  const reports: ReportFile[] = []
  for (const filePath of files) {
    const name = path.basename(filePath)
    if (!isReportFile(name)) continue

    const relativePath = path.relative(baseDir, filePath)
    const parts = relativePath.split(path.sep)
    const category = parts.length > 1 ? parts[0] : "General"
    const stats = await stat(filePath)

    reports.push({
      name,
      relativePath,
      category,
      modifiedAt: stats.mtime.toISOString(),
      source: "dmm",
    })
  }

  return reports
}

async function loadCodeReaderReportFiles(): Promise<ReportFile[]> {
  const baseDir = path.resolve(process.cwd(), "data", "code_reader_scanner")
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
