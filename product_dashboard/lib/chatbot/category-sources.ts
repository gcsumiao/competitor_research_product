import { readdir, stat } from "fs/promises"
import path from "path"

import type { CategoryId } from "@/lib/competitor-data"
import { isFullDashboardEnabled, resolveNonCodeCategoryDir } from "@/lib/dashboard-runtime"
import {
  getNonCodeCategoryConfig,
  isNonCodeCategoryId,
  type FileLocator,
} from "@/lib/non-code-category-config"

type CategorySource = {
  categoryId: CategoryId
  filePath: string
}

export async function resolveCategorySourceWorkbook(
  categoryId: CategoryId
): Promise<CategorySource | null> {
  if (!isFullDashboardEnabled() || !isNonCodeCategoryId(categoryId)) {
    return null
  }

  const config = getNonCodeCategoryConfig(categoryId)
  if (!config?.sourceWorkbook) return null
  const filePath = await resolveCategoryFile(categoryId, config.sourceWorkbook)
  return filePath ? { categoryId, filePath } : null
}

async function resolveCategoryFile(categoryId: string, locator: FileLocator) {
  if (!isNonCodeCategoryId(categoryId)) return null

  if (locator.mode === "exact") {
    return resolveNonCodeCategoryDir(categoryId, ...splitRelativePath(locator.relativePath))
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
