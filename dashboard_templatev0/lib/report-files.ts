import { readdir, stat } from "fs/promises"
import path from "path"

export type ReportFile = {
  name: string
  relativePath: string
  category: string
  modifiedAt: string
}

const EXCLUDE_PREFIXES = ["~$", "._", ".__"]
const EXCLUDE_KEYWORDS = ["type_mapping", "mapping", "__zip"]

export async function loadReportFiles(): Promise<ReportFile[]> {
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
    })
  }

  return reports.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
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
