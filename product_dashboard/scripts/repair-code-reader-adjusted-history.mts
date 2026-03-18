import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { closeDatabasePools } from "../lib/db/client.ts"
import { ingestCodeReaderSnapshots } from "./db-ingest-code-reader.mts"
import { resolveCodeReaderAdjustedHistoryPaths } from "./_code-reader-adjusted-history.mts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const workspaceRoot = path.resolve(appRoot, "..")

async function syncAdjustedReportsIntoArchive() {
  const outRoot = path.join(appRoot, "data", "code_reader_scanner")

  for (const entry of resolveCodeReaderAdjustedHistoryPaths(workspaceRoot)) {
    const targetDir = path.join(outRoot, entry.month)
    await mkdir(targetDir, { recursive: true })

    const targetReport = path.join(targetDir, "report.xlsx")
    await copyFile(entry.reportPath, targetReport)
    await chmod(targetReport, 0o644)

    if (entry.analysisPath) {
      const targetAnalysis = path.join(targetDir, "analysis.xlsx")
      await copyFile(entry.analysisPath, targetAnalysis)
      await chmod(targetAnalysis, 0o644)
    }

    const manifest = {
      month: entry.month,
      snapshotDate: `${entry.month.slice(0, 4)}-${entry.month.slice(4, 6)}-01`,
      sourceMode: "historical_adjusted_report",
      reportFileName: path.basename(entry.reportPath),
      ...(entry.analysisPath
        ? { analysisFileName: path.basename(entry.analysisPath) }
        : {}),
    }

    await writeFile(
      path.join(targetDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    )

    console.log(`Synced adjusted report ${entry.month}`)
  }
}

async function main() {
  await syncAdjustedReportsIntoArchive()
  await ingestCodeReaderSnapshots({
    archiveDir: path.join(appRoot, "data", "code_reader_scanner"),
    writeFileArchive: false,
    skipRevalidate: true,
  })
  console.log("Code-reader adjusted history repair completed.")
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    try {
      await closeDatabasePools()
    } catch (error) {
      console.error("Failed to close database pools after repair:", error)
      process.exitCode = 1
    }
  })
