#!/usr/bin/env node

import { chmod, copyFile, mkdir, writeFile } from "node:fs/promises"
import path from "node:path"

const MONTHLY_FILES = [
  {
    month: "202505",
    report: "25-06-08 Amazon Competitor Report May Innova Adjusted.xlsx",
  },
  {
    month: "202508",
    report: "25-08-reports/25-09-08 Amazon Competitor Report August Innova Adjusted.xlsx",
    analysis: "25-08-reports/25-09-08 Amazon Competitor Analysis August.xlsx",
  },
  {
    month: "202509",
    report: "25-09-reports/25-10-06 Amazon Competitor Report September Innova Adjusted.xlsx",
    analysis: "25-09-reports/25-10-06 Amazon Competitor Analysis September.xlsx",
  },
  {
    month: "202510",
    report: "25-10-reports/25-11-04 Amazon Competitor Report October Innova Adjusted.xlsx",
    analysis: "25-10-reports/25-11-04 Amazon Competitor Analysis October.xlsx",
  },
  {
    month: "202511",
    report: "25-11-reports/25-12-05 Amazon Competitor Report November Innova Adjusted.xlsx",
    analysis: "25-11-reports/25-12-05 Amazon Competitor Analysis November.xlsx",
  },
  {
    month: "202512",
    report: "25-12-reports/26-01-09 Amazon Competitor Report December Innova Adjusted.xlsx",
    analysis: "25-12-reports/26-01-09 Amazon Competitor Analysis December.xlsx",
  },
  {
    month: "202601",
    report: "26-01-reports/26-02-05 Amazon Competitor Report January Innova Adjusted.xlsx",
    analysis: "26-01-reports/26-02-05 Amazon Competitor Analysis January.xlsx",
  },
]

async function main() {
  const appRoot = process.cwd()
  const workspaceRoot = path.resolve(appRoot, "..")
  const sourceRoot = path.join(
    workspaceRoot,
    "Amazon_Monthly_Competitor_Report copy"
  )
  const outRoot = path.join(appRoot, "data", "code_reader_scanner")

  for (const item of MONTHLY_FILES) {
    const sourceReport = path.join(sourceRoot, item.report)
    const sourceAnalysis = item.analysis
      ? path.join(sourceRoot, item.analysis)
      : null
    const targetDir = path.join(outRoot, item.month)

    await mkdir(targetDir, { recursive: true })
    const targetReport = path.join(targetDir, "report.xlsx")
    await copyFile(sourceReport, targetReport)
    await chmod(targetReport, 0o644)
    if (sourceAnalysis) {
      const targetAnalysis = path.join(targetDir, "analysis.xlsx")
      await copyFile(sourceAnalysis, targetAnalysis)
      await chmod(targetAnalysis, 0o644)
    }

    const manifest = {
      month: item.month,
      snapshotDate: `${item.month.slice(0, 4)}-${item.month.slice(4, 6)}-01`,
      sourceMode: "historical_official",
      reportFileName: path.basename(item.report),
      ...(item.analysis
        ? { analysisFileName: path.basename(item.analysis) }
        : {}),
    }

    await writeFile(
      path.join(targetDir, "manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
      "utf8"
    )

    console.log(`Backfilled ${item.month}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
