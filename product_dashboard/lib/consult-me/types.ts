export type DeliverableType = "pdf" | "docx" | "csv" | "pptx"

export type DeliverableFile = {
  type: DeliverableType
  fileName: string
  relativePath: string
  sizeBytes: number
  modifiedAt: string
}

export type CsvOverview = {
  rowCount: number
  columnCount: number
  columns: string[]
}

export type CsvPreview = {
  columns: string[]
  rows: string[][]
}

export type BrandResearchStatus = "available" | "partial" | "missing"

export type BrandResearchAsset = {
  brandKey: string
  brandLabel: string
  status: BrandResearchStatus
  available: DeliverableFile[]
  missing: DeliverableType[]
  csvOverview?: CsvOverview
  csvPreview?: CsvPreview
  executiveSummaryExcerpt?: string
  fullReportText?: string
  activityTemplate?: string[]
  defaultSteps?: number
  defaultSources?: number
}

export type BrandResearchAssetMap = Record<string, BrandResearchAsset>
