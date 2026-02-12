import { readdir, stat } from "fs/promises"
import path from "path"

import type { CategoryId } from "@/lib/competitor-data"

type CategorySource = {
  categoryId: CategoryId
  filePath: string
}

const DMM_SOURCE = path.resolve(
  process.cwd(),
  "..",
  "DMM_h10",
  "outputs",
  "DMM_market_research_summary.xlsx"
)

const SOURCE_DIRS = {
  borescope: path.resolve(process.cwd(), "..", "DMM_h10", "Borescope", "outputs"),
  thermal_imager: path.resolve(process.cwd(), "..", "DMM_h10", "Thermal Imager"),
  night_vision: path.resolve(process.cwd(), "..", "DMM_h10", "Night Vision Monoculars", "outputs"),
} as const

const SOURCE_PATTERNS = {
  borescope: /^Borescope_Market_Analysis.*\.xlsx$/i,
  thermal_imager: /^TI_Market_Analysis.*\.xlsx$/i,
  night_vision: /^Night_Vision_Monoculars_top50.*\.xlsx$/i,
} as const

export async function resolveCategorySourceWorkbook(
  categoryId: CategoryId
): Promise<CategorySource | null> {
  if (categoryId === "dmm") {
    return {
      categoryId,
      filePath: DMM_SOURCE,
    }
  }

  if (categoryId === "borescope") {
    const file = await findLatestWorkbook(
      SOURCE_DIRS.borescope,
      SOURCE_PATTERNS.borescope
    )
    return file ? { categoryId, filePath: file } : null
  }

  if (categoryId === "thermal_imager") {
    const file = await findLatestWorkbook(
      SOURCE_DIRS.thermal_imager,
      SOURCE_PATTERNS.thermal_imager
    )
    return file ? { categoryId, filePath: file } : null
  }

  if (categoryId === "night_vision") {
    const file = await findLatestWorkbook(
      SOURCE_DIRS.night_vision,
      SOURCE_PATTERNS.night_vision
    )
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
