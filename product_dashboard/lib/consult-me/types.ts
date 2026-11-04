export type DeliverableType = "pdf" | "docx" | "csv" | "pptx"
export type ResearchType = "company" | "market" | "competitive" | "industry" | "custom"
export type ConsultMeMode = "self_hosted"
export type ResearchTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export type DeliverableSource = "remote" | "seed_local"

export type DeliverableFile = {
  type: DeliverableType
  source?: DeliverableSource
  seedId?: string
  localPath?: string
  title?: string
  subtitle?: string
  fileName: string
  relativePath: string
  remoteUrl?: string
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

export type ResearchUsage = {
  searchUnits?: number
  aiUnits?: number
  computeUnits?: number
  totalCost?: number
}

export type ResearchSource = {
  title?: string
  url: string
  snippet?: string
}

export type CreateResearchRequest = {
  researchType: ResearchType
  researchSubject: string
  researchFocus?: string
  clientContext?: string
  specificQuestions?: string
  brandKey?: string
  snapshotDate?: string
}

export type CreateResearchResponse = {
  taskId: string
  status: ResearchTaskStatus
  mode: "self_hosted"
  warning?: string
}

/**
 * An analyst brief: Innova's own synthesis on top of a seed's source research
 * (e.g. the XTOOL threat brief). Shown as the lead item ahead of the deliverables.
 */
export type BriefAssetKind = "html" | "pdf"
export type BriefThreatLevel = "high" | "medium" | "low"

export type ResearchBriefHighlight = {
  label: string
  value: string
  note: string
}

export type ResearchBrief = {
  seedId: string
  title: string
  summary: string
  threatLevel: BriefThreatLevel
  /** Last Amazon snapshot the brief's numbers come from (YYYY-MM-DD). */
  dataThrough: string
  publishedAt: string
  highlights: ResearchBriefHighlight[]
  /** Brief files that exist on disk; the UI only offers these. */
  assets: BriefAssetKind[]
}

export type ResearchStatusResponse = {
  taskId: string
  status: ResearchTaskStatus
  mode: "self_hosted"
  researchType: ResearchType
  researchSubject: string
  progress: number
  etaMinutes?: number
  stepsCompleted: number
  totalSteps: number
  sourcesFound: number
  activityFeed: string[]
  outputText?: string
  executiveSummaryExcerpt?: string
  csvPreview?: CsvPreview
  deliverables: DeliverableFile[]
  sources: ResearchSource[]
  brief?: ResearchBrief
  usage?: ResearchUsage
  warning?: string
  error?: string
}

export type ConsultMeHistoryRecord = {
  taskId: string
  companyKey: string
  companyLabel: string
  researchType: ResearchType
  researchSubject: string
  status: ResearchTaskStatus
  hasReport: boolean
  hasBrief?: boolean
  deliverables: DeliverableFile[]
  createdAt: string
  updatedAt: string
  completedAt?: string
}

export type ConsultMeCompanyHistory = {
  companyKey: string
  companyLabel: string
  latestTaskId: string
  latestStatus: ResearchTaskStatus
  latestUpdatedAt: string
  hasReportAvailable: boolean
  availableTaskId?: string
  availableUpdatedAt?: string
  reportCount: number
  availableDeliverableTypes: DeliverableType[]
  hasBrief?: boolean
}

export type ConsultMeHistoryResponse = {
  companies: ConsultMeCompanyHistory[]
  recent: ConsultMeHistoryRecord[]
}
