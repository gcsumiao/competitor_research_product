import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildArtifactFromFile,
  ensureCopiedFile,
  parseStructuredSnapshotRows,
  toMonthKey,
  triggerRevalidate,
  writeJsonFile,
} from "./_db-ingest-utils.mts"
import {
  loadCodeReaderScannerSnapshotFromFiles,
} from "../lib/code-reader-scanner-data.ts"
import { DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG } from "../lib/db/constants.ts"
import { closeDatabasePools } from "../lib/db/client.ts"
import { ingestSnapshotData } from "../lib/db/ingest.ts"
import { deleteSourceArtifactsByPrefix } from "../lib/db/source-artifacts.ts"

type CliArgs = {
  month?: string
  archiveDir: string
  reportPath?: string
  summaryPath?: string
  analysisPath?: string
  formattedReportPath?: string
  formattedAnalysisPath?: string
  structuredJsonPath?: string
  sourceMode?: string
  writeFileArchive: boolean
  revalidateUrl?: string
  revalidateSecret?: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")

type CodeReaderManifest = {
  month?: string
  snapshotDate?: string
  sourceMode?: string
  reportFileName?: string
  analysisFileName?: string
  summaryFileName?: string
}

export async function ingestCodeReaderSnapshots(args: CliArgs) {
  if (args.reportPath) {
    if (!args.month) {
      throw new Error("--month is required when ingesting explicit report paths.")
    }
    await ingestExplicitCodeReaderMonth(args)
    return
  }

  const entries = await readdir(args.archiveDir, { withFileTypes: true }).catch(() => [])
  const months = entries
    .filter((entry) => entry.isDirectory() && /^\d{6}$/.test(entry.name))
    .map((entry) => entry.name)
    .filter((month) => !args.month || args.month === month)
    .sort()

  for (const month of months) {
    const monthDir = path.join(args.archiveDir, month)
    const manifest = await readManifest(path.join(monthDir, "manifest.json"))
    const reportPath = path.join(monthDir, "report.xlsx")
    const analysisPath = await resolveOptionalFile(monthDir, ["analysis.xlsx"])
    const summaryPath = await resolveOptionalFile(monthDir, ["summary.xlsx"])
    const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
      month,
      reportPath,
      analysisPath,
      summaryPath,
      manifest,
    })
    if (!snapshot) continue

    await deleteSourceArtifactsByPrefix(`${month}/`, { direct: true })

    const artifacts = []
    artifacts.push(await buildArtifactFromFile({
      filePath: reportPath,
      artifactPath: `${month}/report.xlsx`,
      categoryId: "code_reader_scanner",
      monthKey: month,
      snapshotDate: snapshot.date,
      artifactKind: "code_reader_report",
      metadata: {
        reportVisible: true,
        categoryLabel: "Code Reader & Scanner",
        displayName: typeof manifest?.reportFileName === "string" ? manifest.reportFileName : path.basename(reportPath),
      },
    }))
    if (analysisPath) {
      artifacts.push(await buildArtifactFromFile({
        filePath: analysisPath,
        artifactPath: `${month}/analysis.xlsx`,
        categoryId: "code_reader_scanner",
        monthKey: month,
        snapshotDate: snapshot.date,
        artifactKind: "code_reader_analysis",
        metadata: {
          reportVisible: true,
          categoryLabel: "Code Reader & Scanner",
          displayName: typeof manifest?.analysisFileName === "string" ? manifest.analysisFileName : path.basename(analysisPath),
        },
      }))
    }
    if (summaryPath) {
      artifacts.push(await buildArtifactFromFile({
        filePath: summaryPath,
        artifactPath: `${month}/summary.xlsx`,
        categoryId: "code_reader_scanner",
        monthKey: month,
        snapshotDate: snapshot.date,
        artifactKind: "code_reader_summary",
        metadata: {
          reportVisible: false,
          categoryLabel: "Code Reader & Scanner",
          displayName: typeof manifest?.summaryFileName === "string" ? manifest.summaryFileName : path.basename(summaryPath),
        },
      }))
    }

    await ingestSnapshotData({
      sourceName: "code_reader_archive_backfill",
      categoryId: "code_reader_scanner",
      label: "Code Reader & Scanner",
      snapshotDate: snapshot.date,
      monthKey: month,
      sourceMode: typeof manifest?.sourceMode === "string" ? manifest.sourceMode : "historical_archive",
      snapshotPayload: snapshot,
      metadata: {
        reportFileName: manifest?.reportFileName ?? path.basename(reportPath),
        analysisFileName: manifest?.analysisFileName ?? null,
        summaryFileName: manifest?.summaryFileName ?? null,
      },
      artifacts,
    })

    console.log(`Ingested code-reader snapshot ${month}`)
  }

  await triggerRevalidate({
    baseUrl: args.revalidateUrl,
    secret: args.revalidateSecret,
    tags: [DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG],
  })
}

async function ingestExplicitCodeReaderMonth(args: CliArgs) {
  const month = args.month!
  const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
    month,
    reportPath: args.reportPath ?? null,
    analysisPath: args.formattedAnalysisPath ?? args.analysisPath ?? null,
    summaryPath: args.summaryPath ?? null,
    manifest: {
      month,
      snapshotDate: `${month.slice(0, 4)}-${month.slice(4, 6)}-01`,
      sourceMode: args.sourceMode ?? "raw_unformatted",
      reportFileName: args.formattedReportPath ? path.basename(args.formattedReportPath) : args.reportPath ? path.basename(args.reportPath) : undefined,
      analysisFileName: args.formattedAnalysisPath ? path.basename(args.formattedAnalysisPath) : args.analysisPath ? path.basename(args.analysisPath) : undefined,
      summaryFileName: args.summaryPath ? path.basename(args.summaryPath) : undefined,
    },
  })
  if (!snapshot) {
    throw new Error(`Unable to parse code-reader snapshot for ${month}.`)
  }

  await deleteSourceArtifactsByPrefix(`${month}/`, { direct: true })

  const archiveDir = path.join(args.archiveDir, month)
  if (args.writeFileArchive) {
    await ensureCopiedFile(args.reportPath!, path.join(archiveDir, "report.xlsx"))
    if (args.summaryPath) {
      await ensureCopiedFile(args.summaryPath, path.join(archiveDir, "summary.xlsx"))
    }
    if (args.formattedAnalysisPath ?? args.analysisPath) {
      await ensureCopiedFile(
        args.formattedAnalysisPath ?? args.analysisPath!,
        path.join(archiveDir, "analysis.xlsx")
      )
    }
    await writeJsonFile(path.join(archiveDir, "manifest.json"), {
      month,
      snapshotDate: snapshot.date,
      sourceMode: args.sourceMode ?? "raw_unformatted",
      reportFileName: args.formattedReportPath ? path.basename(args.formattedReportPath) : path.basename(args.reportPath!),
      analysisFileName: args.formattedAnalysisPath
        ? path.basename(args.formattedAnalysisPath)
        : args.analysisPath
          ? path.basename(args.analysisPath)
          : undefined,
      summaryFileName: args.summaryPath ? path.basename(args.summaryPath) : undefined,
    })
  }

  const artifacts = [
    await buildArtifactFromFile({
      filePath: args.reportPath!,
      artifactPath: `${month}/report.xlsx`,
      categoryId: "code_reader_scanner",
      monthKey: month,
      snapshotDate: snapshot.date,
      artifactKind: "code_reader_report",
      metadata: {
        reportVisible: true,
        categoryLabel: "Code Reader & Scanner",
        displayName: args.formattedReportPath ? path.basename(args.formattedReportPath) : path.basename(args.reportPath!),
      },
    }),
  ]

  if (args.formattedAnalysisPath ?? args.analysisPath) {
    artifacts.push(await buildArtifactFromFile({
      filePath: args.formattedAnalysisPath ?? args.analysisPath!,
      artifactPath: `${month}/analysis.xlsx`,
      categoryId: "code_reader_scanner",
      monthKey: month,
      snapshotDate: snapshot.date,
      artifactKind: "code_reader_analysis",
      metadata: {
        reportVisible: true,
        categoryLabel: "Code Reader & Scanner",
        displayName: path.basename(args.formattedAnalysisPath ?? args.analysisPath!),
      },
    }))
  }

  if (args.summaryPath) {
    artifacts.push(await buildArtifactFromFile({
      filePath: args.summaryPath,
      artifactPath: `${month}/summary.xlsx`,
      categoryId: "code_reader_scanner",
      monthKey: month,
      snapshotDate: snapshot.date,
      artifactKind: "code_reader_summary",
      metadata: {
        reportVisible: false,
        categoryLabel: "Code Reader & Scanner",
        displayName: path.basename(args.summaryPath),
      },
    }))
  }

  const rowRecords = await parseStructuredSnapshotRows(args.structuredJsonPath)

  await ingestSnapshotData({
    sourceName: "code_reader_monthly_pipeline",
    categoryId: "code_reader_scanner",
    label: "Code Reader & Scanner",
    snapshotDate: snapshot.date,
    monthKey: toMonthKey(snapshot.date),
    sourceMode: args.sourceMode ?? "raw_unformatted",
    snapshotPayload: snapshot,
    metadata: {
      reportFileName: args.formattedReportPath ? path.basename(args.formattedReportPath) : path.basename(args.reportPath!),
      analysisFileName: args.formattedAnalysisPath
        ? path.basename(args.formattedAnalysisPath)
        : args.analysisPath
          ? path.basename(args.analysisPath)
          : null,
      summaryFileName: args.summaryPath ? path.basename(args.summaryPath) : null,
    },
    rowRecords,
    artifacts,
  })

  console.log(`Ingested code-reader month ${month}`)

  await triggerRevalidate({
    baseUrl: args.revalidateUrl,
    secret: args.revalidateSecret,
    tags: [DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG],
  })
}

async function resolveOptionalFile(dir: string, names: string[]) {
  for (const name of names) {
    const filePath = path.join(dir, name)
    try {
      await readFile(filePath)
      return filePath
    } catch {
      continue
    }
  }
  return null
}

async function readManifest(filePath: string): Promise<CodeReaderManifest | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as CodeReaderManifest
  } catch {
    return null
  }
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    archiveDir: path.join(appRoot, "data", "code_reader_scanner"),
    writeFileArchive: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--month") args.month = argv[index + 1]
    if (value === "--archive-dir") args.archiveDir = argv[index + 1] ?? args.archiveDir
    if (value === "--report") args.reportPath = argv[index + 1]
    if (value === "--summary") args.summaryPath = argv[index + 1]
    if (value === "--analysis") args.analysisPath = argv[index + 1]
    if (value === "--formatted-report") args.formattedReportPath = argv[index + 1]
    if (value === "--formatted-analysis") args.formattedAnalysisPath = argv[index + 1]
    if (value === "--structured-json") args.structuredJsonPath = argv[index + 1]
    if (value === "--source-mode") args.sourceMode = argv[index + 1]
    if (value === "--revalidate-url") args.revalidateUrl = argv[index + 1]
    if (value === "--revalidate-secret") args.revalidateSecret = argv[index + 1]
    if (value === "--write-file-archive") args.writeFileArchive = true
  }

  args.revalidateUrl ||= process.env.DASHBOARD_REVALIDATE_URL
  args.revalidateSecret ||= process.env.DASHBOARD_REVALIDATE_SECRET
  return args
}

const isEntryPoint = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])

if (isEntryPoint) {
  ingestCodeReaderSnapshots(parseArgs(process.argv.slice(2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error)
      process.exitCode = 1
    })
    .finally(async () => {
      await closeDatabasePools()
    })
}
