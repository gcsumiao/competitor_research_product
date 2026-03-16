import { spawn } from "node:child_process"
import { readdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { buildArtifactFromFile, toMonthKey, triggerRevalidate } from "./_db-ingest-utils.mts"
import {
  loadCsvCategorySnapshotRecords,
  loadDashboardDataFromFiles,
  type CategoryId,
} from "../lib/competitor-data.ts"
import { DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG } from "../lib/db/constants.ts"
import { closeDatabasePools } from "../lib/db/client.ts"
import { ingestSnapshotData, type SnapshotRowInput } from "../lib/db/ingest.ts"
import { deleteSourceArtifactsByPrefix, upsertSourceArtifact } from "../lib/db/source-artifacts.ts"
import { normalizeCategoryWorkbookData, normalizeSnapshotFallback } from "../lib/chatbot/category-normalizers.ts"
import { resolveCategorySourceWorkbook } from "../lib/chatbot/category-sources.ts"
import { loadTypeSummariesFromFiles } from "../lib/type-summaries.ts"
import { resolveNonCodeDataRoot } from "../lib/dashboard-runtime"
import {
  findNonCodeCategoryByFolder,
  listNonCodeCategoryConfigs,
  getNonCodeCategoryConfig,
  isConfiguredVisibleReport,
  isNonCodeCategoryId,
  type NonCodeCategoryId,
} from "../lib/non-code-category-config.ts"

type CliArgs = {
  writeFileCopy?: boolean
  revalidateUrl?: string
  revalidateSecret?: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")

export async function ingestNonCodeSnapshots(args: CliArgs) {
  if (args.writeFileCopy) {
    await runLegacyFileSync()
  }
  const dashboard = await loadDashboardDataFromFiles()
  const summaries = await loadTypeSummariesFromFiles()

  for (const category of dashboard.categories) {
    if (category.id === "code_reader_scanner") continue

    const rawDir = resolveCategoryRawDir(category.id)
    const rawSnapshots = await loadCsvCategorySnapshotRecords(rawDir)
    const rawRowsByDate = new Map(rawSnapshots.map((item) => [item.date, item.records]))
    const workbookSource = await resolveCategorySourceWorkbook(category.id)

    for (const snapshot of category.snapshots) {
      const normalizedCategoryData = workbookSource
        ? await normalizeCategoryWorkbookData(category, snapshot, workbookSource.filePath)
        : normalizeSnapshotFallback(
            category,
            snapshot,
            "No category workbook source found. Using dashboard snapshot fallback."
          )
      const rowRecords = (rawRowsByDate.get(snapshot.date) ?? []).map<SnapshotRowInput>((row) => ({
        rowSource: "raw_csv",
        asin: row.asin,
        title: row.title,
        brand: row.brand,
        typeLabel: row.subcategory ?? row.sizeTier,
        price: row.price,
        revenue: row.asinRevenue,
        units: row.asinSales,
        reviewCount: row.reviewCount,
        rating: row.rating,
        fulfillment: row.fulfillment,
        sizeTier: row.sizeTier,
        subcategory: row.subcategory,
        url: row.url,
        imageUrl: row.imageUrl,
        monthlyRevenue: row.asinRevenue,
        monthlyUnits: row.asinSales,
      }))

      await ingestSnapshotData({
        sourceName: "non_code_snapshot_ingest",
        categoryId: category.id,
        label: category.label,
        snapshotDate: snapshot.date,
        monthKey: toMonthKey(snapshot.date),
        sourceMode: "raw_csv_workbook",
        snapshotPayload: snapshot,
        metadata: {
          typeSummarySections: summaries[category.id]?.sections ?? [],
          typeSummaryFileName: summaries[category.id]?.fileName ?? "",
          normalizedCategoryData,
          sourceWorkbookPath: workbookSource?.filePath ?? null,
        },
        rowRecords,
      })

      console.log(`Ingested non-code snapshot ${category.id} ${snapshot.date}`)
    }
  }

  await ingestNonCodeArtifacts()
  await triggerRevalidate({
    baseUrl: args.revalidateUrl,
    secret: args.revalidateSecret,
    tags: [DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG],
  })
}

async function ingestNonCodeArtifacts() {
  const root = resolveNonCodeDataRoot()
  if (!root) return
  for (const category of listNonCodeCategoryConfigs()) {
    await deleteSourceArtifactsByPrefix(`${category.folderName}/`, { direct: true })
  }
  const files = await listXlsxFiles(root)
  for (const filePath of files) {
    const relativePath = path.relative(root, filePath).replace(/\\/g, "/")
    const categoryId = categoryIdFromRelativePath(relativePath)
    if (!categoryId) continue
    const config = getNonCodeCategoryConfig(categoryId)
    await upsertSourceArtifact(await buildArtifactFromFile({
      filePath,
      artifactPath: relativePath,
      categoryId,
      artifactKind: "non_code_report",
      metadata: {
        reportVisible: isConfiguredVisibleReport(categoryId, relativePath),
        categoryLabel: config?.label ?? categoryLabelFromRelativePath(relativePath),
        displayName: path.basename(filePath),
      },
    }), { direct: true })
  }
}

async function listXlsxFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "_archive" || entry.name === "__pycache__") continue
      files.push(...(await listXlsxFiles(fullPath)))
      continue
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith(".xlsx")) {
      files.push(fullPath)
    }
  }
  return files
}

function categoryIdFromRelativePath(relativePath: string): NonCodeCategoryId | undefined {
  return findNonCodeCategoryByFolder(relativePath)?.id
}

function categoryLabelFromRelativePath(relativePath: string) {
  return relativePath.split("/")[0] ?? "General"
}

function resolveCategoryRawDir(categoryId: Exclude<CategoryId, "code_reader_scanner">) {
  if (!isNonCodeCategoryId(categoryId)) return null
  const root = resolveNonCodeDataRoot()
  const config = getNonCodeCategoryConfig(categoryId)
  if (!root || !config) return null
  return path.join(root, config.folderName, "raw_data")
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {}
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--write-file-copy") args.writeFileCopy = true
    if (value === "--revalidate-url") args.revalidateUrl = argv[index + 1]
    if (value === "--revalidate-secret") args.revalidateSecret = argv[index + 1]
  }
  args.revalidateUrl ||= process.env.DASHBOARD_REVALIDATE_URL
  args.revalidateSecret ||= process.env.DASHBOARD_REVALIDATE_SECRET
  return args
}

async function runLegacyFileSync() {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("node", ["--import", "tsx", "scripts/sync-non-code-data.mts"], {
      cwd: appRoot,
      stdio: "inherit",
    })
    child.on("exit", (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`Legacy non-code file sync failed with exit code ${code ?? 1}.`))
    })
    child.on("error", reject)
  })
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isEntryPoint) {
  ingestNonCodeSnapshots(parseArgs(process.argv.slice(2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(async () => {
      await closeDatabasePools()
    })
}
