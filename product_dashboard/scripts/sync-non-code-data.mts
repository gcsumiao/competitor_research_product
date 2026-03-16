import { cp, mkdir, stat } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { listNonCodeCategoryConfigs } from "../lib/non-code-category-config.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const sourceRoot = path.resolve(appRoot, "..", "NewProductCategory")
const targetRoot = path.join(appRoot, "data", "non_code_categories")

const IGNORED_BASENAMES = new Set([".DS_Store", "._.DS_Store", "__pycache__", "_archive"])

await mkdir(targetRoot, { recursive: true })

for (const category of listNonCodeCategoryConfigs()) {
  const sourcePath = path.join(sourceRoot, category.folderName)
  const targetPath = path.join(targetRoot, category.folderName)
  const sourceStats = await stat(sourcePath).catch(() => null)
  if (!sourceStats?.isDirectory()) {
    console.warn(`Skipping missing non-code category source: ${sourcePath}`)
    continue
  }

  await cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    filter: (entry) => !IGNORED_BASENAMES.has(path.basename(entry)),
  })
  console.log(`Synced ${category.folderName}`)
}

console.log(`Synced deployable non-code data to ${targetRoot}`)
