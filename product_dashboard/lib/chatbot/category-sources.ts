import { readdir, stat } from "fs/promises"
import path from "path"

import type { CategoryId } from "@/lib/competitor-data"
import { isFullDashboardEnabled, resolveNonCodeCategoryDir } from "@/lib/dashboard-runtime"

type CategorySource = {
  categoryId: CategoryId
  filePath: string
}

const SOURCE_PATTERNS = {
  borescope: /^Borescope_Market_Analysis.*\.xlsx$/i,
  thermal_imager: /^TI_Market_Analysis.*\.xlsx$/i,
  night_vision: /^Night_Vision_Monoculars_top50.*\.xlsx$/i,
} as const

export async function resolveCategorySourceWorkbook(
  categoryId: CategoryId
): Promise<CategorySource | null> {
  if (!isFullDashboardEnabled()) {
    return null
  }

  if (categoryId === "dmm") {
    const filePath = resolveNonCodeCategoryDir("dmm", "outputs", "DMM_market_research_summary.xlsx")
    if (!filePath) return null
    return {
      categoryId,
      filePath,
    }
  }

  if (categoryId === "borescope") {
    const dir = resolveNonCodeCategoryDir("borescope", "outputs")
    const file = dir ? await findLatestWorkbook(dir, SOURCE_PATTERNS.borescope) : null
    return file ? { categoryId, filePath: file } : null
  }

  if (categoryId === "thermal_imager") {
    const dir = resolveNonCodeCategoryDir("thermal_imager")
    const file = dir ? await findLatestWorkbook(dir, SOURCE_PATTERNS.thermal_imager) : null
    return file ? { categoryId, filePath: file } : null
  }

  if (categoryId === "night_vision") {
    const dir = resolveNonCodeCategoryDir("night_vision", "outputs")
    const file = dir ? await findLatestWorkbook(dir, SOURCE_PATTERNS.night_vision) : null
    return file ? { categoryId, filePath: file } : null
  }

  return null
}

async function findLatestWorkbook(dir: string, filePattern: RegExp) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const candidates = entries
    .filter((entry) => entry.isFile() && filePattern.test(entry.name))
    .map((entry) => path.join(dir, entry.name))

  if (!candidates.length) return null

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
