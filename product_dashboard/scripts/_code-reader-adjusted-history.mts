import path from "node:path"
import { fileURLToPath } from "node:url"

export type CodeReaderAdjustedHistoryEntry = {
  month: string
  reportRelativePath: string
  analysisRelativePath?: string
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const CODE_READER_ADJUSTED_HISTORY: CodeReaderAdjustedHistoryEntry[] = [
  {
    month: "202505",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/25-06-08 Amazon Competitor Report May Innova Adjusted.xlsx",
  },
  {
    month: "202508",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-09-08 Amazon Competitor Report August Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-09-08 Amazon Competitor Analysis August.xlsx",
  },
  {
    month: "202509",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-10-06 Amazon Competitor Report September Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-10-06 Amazon Competitor Analysis September.xlsx",
  },
  {
    month: "202510",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-11-04 Amazon Competitor Report October Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-11-04 Amazon Competitor Analysis October.xlsx",
  },
  {
    month: "202511",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-12-05 Amazon Competitor Report November Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/25-12-05 Amazon Competitor Analysis November.xlsx",
  },
  {
    month: "202512",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/26-01-09 Amazon Competitor Report December Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/26-01-09 Amazon Competitor Analysis December.xlsx",
  },
  {
    month: "202601",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/26-02-05 Amazon Competitor Report January Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-01-reports/26-02-05 Amazon Competitor Analysis January.xlsx",
  },
  {
    month: "202602",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-02-reports/26-03-04 Amazon Competitor Report February Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-02-reports/26-03-04 Amazon Competitor Analysis February.xlsx",
  },
  {
    month: "202603",
    reportRelativePath: "Amazon_Monthly_Competitor_Report copy/26-03-reports/26-04-02 Amazon Competitor Report March Innova Adjusted.xlsx",
    analysisRelativePath: "Amazon_Monthly_Competitor_Report copy/26-03-reports/26-04-02 Amazon Competitor Analysis March.xlsx",
  },
]

export function resolveCodeReaderAdjustedHistoryPaths(workspaceRoot?: string) {
  const resolvedWorkspaceRoot = workspaceRoot ?? path.resolve(__dirname, "..", "..")
  return CODE_READER_ADJUSTED_HISTORY.map((entry) => ({
    ...entry,
    reportPath: path.join(resolvedWorkspaceRoot, entry.reportRelativePath),
    analysisPath: entry.analysisRelativePath
      ? path.join(resolvedWorkspaceRoot, entry.analysisRelativePath)
      : undefined,
  }))
}
