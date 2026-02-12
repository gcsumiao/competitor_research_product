#!/usr/bin/env node

import { chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

function parseArgs(argv) {
  const args = {
    month: "",
    overwrite: false,
    sourceDir: "",
    outDir: "",
  }

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i]
    if (value === "--month") {
      args.month = argv[i + 1] ?? ""
      i += 1
      continue
    }
    if (value === "--overwrite") {
      args.overwrite = true
      continue
    }
    if (value === "--source-dir") {
      args.sourceDir = argv[i + 1] ?? ""
      i += 1
      continue
    }
    if (value === "--out-dir") {
      args.outDir = argv[i + 1] ?? ""
      i += 1
    }
  }

  return args
}

async function exists(filePath) {
  try {
    await readFile(filePath)
    return true
  } catch {
    return false
  }
}

async function readManifest(filePath) {
  try {
    const content = await readFile(filePath, "utf8")
    return JSON.parse(content)
  } catch {
    return null
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (!/^\d{6}$/.test(args.month)) {
    throw new Error("Usage: node scripts/archive-code-reader-monthly.mjs --month YYYYMM [--overwrite]")
  }

  const appRoot = process.cwd()
  const workspaceRoot = path.resolve(appRoot, "..")
  const sourceDir =
    args.sourceDir ||
    path.join(
      workspaceRoot,
      "Amazon_Monthly_Competitor_Report copy",
      "script output reports"
    )
  const outRoot =
    args.outDir || path.join(appRoot, "data", "code_reader_scanner")
  const monthDir = path.join(outRoot, args.month)

  const sourceReport = path.join(sourceDir, "Amazon Competitor Report.xlsx")
  const sourceSummary = path.join(sourceDir, "summary.xlsx")
  const targetReport = path.join(monthDir, "report.xlsx")
  const targetSummary = path.join(monthDir, "summary.xlsx")
  const manifestPath = path.join(monthDir, "manifest.json")

  if (!args.overwrite) {
    const reportExists = await exists(targetReport)
    const summaryExists = await exists(targetSummary)
    if (reportExists || summaryExists) {
      throw new Error(
        `Monthly archive already exists for ${args.month}. Re-run with --overwrite to replace report/summary.`
      )
    }
  }

  await mkdir(monthDir, { recursive: true })
  await copyFile(sourceReport, targetReport)
  await copyFile(sourceSummary, targetSummary)
  await chmod(targetReport, 0o644)
  await chmod(targetSummary, 0o644)

  const existingManifest = await readManifest(manifestPath)
  const nextManifest = {
    ...(existingManifest ?? {}),
    month: args.month,
    snapshotDate: `${args.month.slice(0, 4)}-${args.month.slice(4, 6)}-01`,
    sourceMode: "raw_unformatted",
    reportFileName: "Amazon Competitor Report.xlsx",
    summaryFileName: "summary.xlsx",
  }

  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8")
  console.log(`Archived raw monthly files for ${args.month} into ${monthDir}`)
}

main().catch((error) => {
  console.error(error.message || error)
  process.exit(1)
})
