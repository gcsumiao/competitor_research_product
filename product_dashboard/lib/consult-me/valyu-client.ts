import type {
  CreateResearchRequest,
  DeliverableFile,
  DeliverableType,
  ResearchType,
  ResearchSource,
  ResearchStatusResponse,
  ResearchTaskStatus,
  ResearchUsage,
} from "@/lib/consult-me/types"

const DEFAULT_CREATE_ENDPOINT = "https://api.valyu.ai/v1/deepresearch/tasks"
const DEFAULT_STATUS_ENDPOINT = "https://api.valyu.ai/v1/deepresearch/tasks"
const DEFAULT_CANCEL_ENDPOINT = "https://api.valyu.ai/v1/deepresearch/tasks"
const DEFAULT_OUTPUT_FORMATS = ["markdown", "pdf"]
const DEFAULT_DELIVERABLE_TYPES: DeliverableType[] = ["csv", "docx", "pptx"]

type ValyuCreateResult = {
  externalTaskId: string
  status: ResearchTaskStatus
}

type ValyuStatusResult = {
  researchType: ResearchType
  researchSubject: string
  status: ResearchTaskStatus
  progress: number
  etaMinutes?: number
  stepsCompleted: number
  totalSteps: number
  sourcesFound: number
  activityFeed: string[]
  outputText?: string
  executiveSummaryExcerpt?: string
  csvPreview?: ResearchStatusResponse["csvPreview"]
  deliverables: DeliverableFile[]
  sources: ResearchSource[]
  usage?: ResearchUsage
  warning?: string
  error?: string
}

export async function createValyuResearch(request: CreateResearchRequest): Promise<ValyuCreateResult> {
  const endpoint = process.env.VALYU_CREATE_ENDPOINT ?? DEFAULT_CREATE_ENDPOINT
  const enhancedPayload = buildCreatePayload(request)
  let response: Response
  try {
    response = await valyuFetch(endpoint, {
      method: "POST",
      body: JSON.stringify(enhancedPayload),
    })
  } catch (error) {
    // If enhanced payload fields are rejected, retry once with a minimal payload.
    if (!isPayloadShapeError(error)) throw error
    response = await valyuFetch(endpoint, {
      method: "POST",
      body: JSON.stringify({
        query: buildValyuQuery(request),
        mode: "standard",
      }),
    })
  }

  const json = await parseJson(response)
  const result = asRecord(json?.result)
  const externalTaskId = pickString(
    getValue(json, "task_id"),
    getValue(json, "taskId"),
    getValue(json, "deepresearch_id"),
    getValue(json, "id"),
    getValue(result, "task_id"),
    getValue(result, "taskId"),
    getValue(result, "deepresearch_id"),
    getValue(result, "id")
  )
  if (!externalTaskId) {
    throw new Error("Valyu create response missing task id")
  }

  return {
    externalTaskId,
    status: normalizeStatus(pickString(getValue(json, "status"), getValue(result, "status")) ?? "queued"),
  }
}

export async function getValyuResearchStatus(externalTaskId: string): Promise<ValyuStatusResult> {
  const endpointTemplate = process.env.VALYU_STATUS_ENDPOINT ?? DEFAULT_STATUS_ENDPOINT
  const response = await valyuFetchWithFallback(
    buildTaskEndpoints(endpointTemplate, externalTaskId, "status"),
    { method: "GET" }
  )
  const json = await parseJson(response)
  const result = asRecord(getValue(json, "result"))
  const status = pickString(getValue(json, "status"), getValue(result, "status")) ?? "queued"
  const explicitType = pickString(
    getValue(json, "researchType"),
    getValue(json, "research_type"),
    getValue(result, "researchType"),
    getValue(result, "research_type")
  )
  const explicitSubject = pickString(
    getValue(json, "researchSubject"),
    getValue(json, "research_subject"),
    getValue(result, "researchSubject"),
    getValue(result, "research_subject")
  )
  const rawQuery = pickString(getValue(json, "query"), getValue(result, "query"))
  const parsedQuery = parseStructuredQuery(rawQuery)
  const researchType = normalizeResearchType(explicitType ?? parsedQuery.researchType)
  const researchSubject = explicitSubject ?? parsedQuery.researchSubject ?? "Deep research task"
  const estimatedProgress = estimateProgressFromStatus(status)
  const progressObject = asRecord(getValue(json, "progress") ?? getValue(result, "progress"))
  const progressCurrentStep = pickNumber(
    getValue(progressObject, "current_step"),
    getValue(progressObject, "currentStep"),
    getValue(progressObject, "step"),
    getValue(progressObject, "steps_completed")
  )
  const progressTotalSteps = pickNumber(
    getValue(progressObject, "total_steps"),
    getValue(progressObject, "totalSteps"),
    getValue(progressObject, "steps_total")
  )
  const progressSourcesFound = pickNumber(
    getValue(progressObject, "sources_found"),
    getValue(progressObject, "sourcesFound"),
    getValue(progressObject, "source_count")
  )
  const progressFromSteps =
    progressCurrentStep !== undefined &&
    progressTotalSteps !== undefined
      ? safeProgressFromSteps(
          progressCurrentStep,
          progressTotalSteps
        )
      : undefined
  const progressValue = pickNumber(
    getValue(json, "progress"),
    getValue(result, "progress"),
    progressFromSteps,
    estimatedProgress
  )

  const outputText = pickString(
    getValue(json, "output"),
    getValue(json, "report"),
    getValue(json, "markdown"),
    getValue(result, "output"),
    getValue(result, "report"),
    getValue(result, "markdown")
  )
  const sources = normalizeSources(
    getValue(json, "sources") ??
      getValue(result, "sources") ??
      getValue(json, "source_list") ??
      getValue(result, "source_list")
  )
  const deliverables = normalizeDeliverables(json)
  const usage = normalizeUsage(getValue(json, "usage") ?? getValue(result, "usage"))
  const etaMinutes = toNonNegativeInt(
    pickNumber(
      getValue(json, "eta_minutes"),
      getValue(json, "etaMinutes"),
      getValue(result, "eta_minutes"),
      getValue(result, "etaMinutes")
    )
  )

  return {
    researchType,
    researchSubject,
    status: normalizeStatus(status),
    progress: clamp01(progressValue),
    etaMinutes: etaMinutes > 0 ? etaMinutes : undefined,
    stepsCompleted: toNonNegativeInt(
      pickNumber(
        getValue(json, "steps_completed"),
        getValue(json, "stepsCompleted"),
        getValue(result, "steps_completed"),
        getValue(result, "stepsCompleted"),
        progressCurrentStep,
        0
      )
    ),
    totalSteps: Math.max(
      1,
      toNonNegativeInt(
        pickNumber(
          getValue(json, "total_steps"),
          getValue(json, "totalSteps"),
          getValue(result, "total_steps"),
          getValue(result, "totalSteps"),
          progressTotalSteps,
          5
        )
      )
    ),
    sourcesFound: toNonNegativeInt(
      pickNumber(
        getValue(json, "source_count"),
        getValue(json, "sourcesFound"),
        getValue(result, "source_count"),
        getValue(result, "sourcesFound"),
        progressSourcesFound,
        sources.length
      )
    ),
    activityFeed: normalizeActivityFeed(json),
    outputText,
    executiveSummaryExcerpt: outputText ? outputText.slice(0, 1000) : undefined,
    deliverables,
    sources,
    usage,
    warning:
      pickString(getValue(json, "warning"), getValue(result, "warning")) ??
      (normalizeStatus(status) === "completed" && deliverables.length === 0
        ? "Task completed without file deliverables. This usually means output formats/deliverables were not requested for that run."
        : undefined),
    error: pickString(
      getValue(json, "error"),
      getValue(json, "message"),
      getValue(result, "error"),
      getValue(result, "message")
    ),
  }
}

export async function cancelValyuResearch(externalTaskId: string) {
  const endpointTemplate = process.env.VALYU_CANCEL_ENDPOINT ?? DEFAULT_CANCEL_ENDPOINT
  const response = await valyuFetchWithFallback(
    buildTaskEndpoints(endpointTemplate, externalTaskId, "cancel"),
    {
    method: "POST",
    }
  )
  const json = await parseJson(response)
  const result = asRecord(getValue(json, "result"))
  return {
    status: normalizeStatus(
      pickString(getValue(json, "status"), getValue(result, "status")) ?? "cancelled"
    ),
    message: pickString(
      getValue(json, "message"),
      getValue(json, "detail"),
      getValue(result, "message"),
      getValue(result, "detail")
    ),
  }
}

async function valyuFetch(input: string, init: RequestInit) {
  const apiKey = sanitizeApiKey(process.env.VALYU_API_KEY)
  if (!apiKey) {
    throw new Error("VALYU_API_KEY is missing")
  }

  const response = await fetch(input, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw new Error(`Valyu API error ${response.status}: ${body || response.statusText}`)
  }
  return response
}

async function valyuFetchWithFallback(endpoints: string[], init: RequestInit) {
  let lastError: unknown = null
  for (const endpoint of endpoints) {
    try {
      return await valyuFetch(endpoint, init)
    } catch (error) {
      lastError = error
      if (!isNotFoundValyuError(error)) {
        throw error
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Valyu request failed.")
}

async function parseJson(response: Response) {
  try {
    return (await response.json()) as Record<string, unknown> | null
  } catch {
    return null
  }
}

function buildValyuQuery(request: CreateResearchRequest) {
  const lines: string[] = []
  lines.push(`Research Type: ${request.researchType}`)
  lines.push(`Research Subject: ${request.researchSubject}`)

  if (request.researchFocus?.trim()) {
    lines.push("")
    lines.push(`Research Focus:`)
    lines.push(request.researchFocus.trim())
  }
  if (request.clientContext?.trim()) {
    lines.push("")
    lines.push(`Client Context:`)
    lines.push(request.clientContext.trim())
  }
  if (request.specificQuestions?.trim()) {
    lines.push("")
    lines.push(`Specific Questions:`)
    lines.push(request.specificQuestions.trim())
  }
  return lines.join("\n")
}

function buildCreatePayload(request: CreateResearchRequest) {
  const outputFormats = parseOutputFormats()
  const deliverables = buildRequestedDeliverables(request)
  return {
    query: buildValyuQuery(request),
    mode: "standard",
    output_formats: outputFormats,
    ...(deliverables.length ? { deliverables } : {}),
  }
}

function buildRequestedDeliverables(request: CreateResearchRequest) {
  const configured = parseDeliverableTypes()
  return configured.map((type) => ({
    type,
    description: `Generate ${type.toUpperCase()} deliverable for ${request.researchType} research on ${request.researchSubject}.`,
  }))
}

function parseOutputFormats() {
  const configured = (process.env.VALYU_OUTPUT_FORMATS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)

  const normalized = Array.from(new Set(configured.length ? configured : DEFAULT_OUTPUT_FORMATS))
  return normalized
}

function parseDeliverableTypes(): DeliverableType[] {
  const configured = (process.env.VALYU_DELIVERABLES ?? "")
    .split(",")
    .map((item) => normalizeDeliverableType(item))
    .filter((item): item is DeliverableType => item !== null)
  const normalized = configured.length ? configured : DEFAULT_DELIVERABLE_TYPES
  return Array.from(new Set(normalized))
}

function buildTaskEndpoints(template: string, taskId: string, action: "status" | "cancel") {
  const encoded = encodeURIComponent(taskId)
  const clean = template.trim().replace(/\/+$/, "")
  const endpoints: string[] = []

  if (clean.includes("{taskId}")) {
    endpoints.push(clean.replace("{taskId}", encoded))
  } else if (/\/tasks$/.test(clean)) {
    endpoints.push(`${clean}/${encoded}/${action}`)
    endpoints.push(`${clean}/${encoded}`)
    if (action === "status") {
      endpoints.push(`${clean.replace(/\/tasks$/, "/status")}/${encoded}`)
    }
    if (action === "cancel") {
      endpoints.push(`${clean.replace(/\/tasks$/, "/cancel")}/${encoded}`)
    }
  } else if (action === "status" && /\/status$/.test(clean)) {
    endpoints.push(`${clean}${clean.includes("?") ? "&" : "?"}taskId=${encoded}`)
    endpoints.push(`${clean}/${encoded}`)
  } else if (action === "cancel" && /\/cancel$/.test(clean)) {
    endpoints.push(`${clean}/${encoded}`)
    endpoints.push(clean)
  } else {
    endpoints.push(`${clean}/${encoded}/${action}`)
    endpoints.push(`${clean}/${action}/${encoded}`)
  }

  return Array.from(new Set(endpoints))
}

function sanitizeApiKey(value: string | undefined) {
  if (!value) return ""
  return value.trim().replace(/^['"]|['"]$/g, "")
}

function safeProgressFromSteps(current: number | undefined, total: number | undefined) {
  if (current === undefined || total === undefined || total <= 0) return undefined
  return Math.max(0, Math.min(1, current / total))
}

function normalizeStatus(raw: string): ResearchTaskStatus {
  const value = (raw ?? "").toLowerCase()
  if (value.includes("complete") || value === "done") return "completed"
  if (value.includes("run") || value.includes("progress")) return "running"
  if (value.includes("queue") || value.includes("pending")) return "queued"
  if (value.includes("cancel")) return "cancelled"
  if (value.includes("fail") || value.includes("error")) return "failed"
  return "queued"
}

function normalizeDeliverables(payload: Record<string, unknown> | null): DeliverableFile[] {
  if (!payload) return []
  const unique = new Map<string, DeliverableFile>()
  const records = [payload, asRecord(getValue(payload, "result"))].filter(
    (record): record is Record<string, unknown> => Boolean(record)
  )

  for (const record of records) {
    const direct = getValue(record, "deliverables")
    if (Array.isArray(direct)) {
      for (const item of direct) {
        const parsed = normalizeDeliverableItem(item)
        if (!parsed) continue
        const key = `${parsed.type}:${parsed.remoteUrl ?? parsed.fileName}`
        unique.set(key, parsed)
      }
    }

    const urlCandidates: Array<{ type: DeliverableType; key: string }> = [
      { type: "pdf", key: "pdf_url" },
      { type: "csv", key: "csv_url" },
      { type: "docx", key: "docx_url" },
      { type: "pptx", key: "pptx_url" },
    ]

    for (const { type, key } of urlCandidates) {
      const url = pickString(getValue(record, key))
      if (!url) continue
      const parsed = makeDeliverableFromUrl(type, url)
      const dedupeKey = `${parsed.type}:${parsed.remoteUrl ?? parsed.fileName}`
      unique.set(dedupeKey, parsed)
    }

    const nestedMaps = [
      asRecord(getValue(record, "output_urls")),
      asRecord(getValue(record, "files")),
      asRecord(getValue(record, "artifacts")),
      asRecord(getValue(record, "deliverable_urls")),
    ]
    for (const map of nestedMaps) {
      if (!map) continue
      for (const [rawKey, rawValue] of Object.entries(map)) {
        const url = typeof rawValue === "string" ? rawValue : undefined
        if (!url) continue
        const type = normalizeDeliverableType(rawKey)
        if (!type) continue
        const parsed = makeDeliverableFromUrl(type, url)
        const dedupeKey = `${parsed.type}:${parsed.remoteUrl ?? parsed.fileName}`
        unique.set(dedupeKey, parsed)
      }
    }
  }

  return Array.from(unique.values())
}

function normalizeDeliverableItem(value: unknown): DeliverableFile | null {
  if (!value || typeof value !== "object") return null
  const item = value as Record<string, unknown>
  const type = normalizeDeliverableType(pickString(item.type, item.format, item.file_type))
  if (!type) return null

  const remoteUrl = pickString(item.url, item.download_url, item.remoteUrl)
  const fileName =
    pickString(item.fileName, item.filename, item.name) ??
    deriveFileNameFromUrl(remoteUrl) ??
    `${type}.${type}`

  return {
    type,
    source: "remote",
    title: pickString(item.title) ?? deliverableTitle(type),
    subtitle: pickString(item.subtitle) ?? `${type.toUpperCase()} File`,
    fileName,
    relativePath: pickString(item.relativePath, item.path) ?? "",
    remoteUrl: remoteUrl ?? undefined,
    sizeBytes: toNonNegativeInt(pickNumber(item.sizeBytes, item.size, 0)),
    modifiedAt: pickString(item.modifiedAt, item.updated_at) ?? new Date().toISOString(),
  }
}

function normalizeResearchType(value: string | undefined): ResearchType {
  const normalized = (value ?? "").trim().toLowerCase()
  if (
    normalized === "company" ||
    normalized === "market" ||
    normalized === "competitive" ||
    normalized === "industry" ||
    normalized === "custom"
  ) {
    return normalized
  }
  return "custom"
}

function normalizeSources(value: unknown): ResearchSource[] {
  if (!Array.isArray(value)) return []
  const normalized: ResearchSource[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const url = pickString(row.url, row.link)
    if (!url) continue
    normalized.push({
      title: pickString(row.title),
      url,
      snippet: pickString(row.snippet, row.description),
    })
  }
  return normalized
}

function normalizeUsage(value: unknown): ResearchUsage | undefined {
  if (!value || typeof value !== "object") return undefined
  const row = value as Record<string, unknown>
  const searchUnits = pickNumber(row.search_units, row.searchUnits)
  const aiUnits = pickNumber(row.ai_units, row.aiUnits)
  const computeUnits = pickNumber(row.compute_units, row.computeUnits)
  const totalCost = pickNumber(row.total_cost, row.totalCost)
  if (
    searchUnits === undefined &&
    aiUnits === undefined &&
    computeUnits === undefined &&
    totalCost === undefined
  ) {
    return undefined
  }
  return { searchUnits, aiUnits, computeUnits, totalCost }
}

function normalizeActivityFeed(payload: Record<string, unknown> | null) {
  const direct = getValue(payload, "activity_feed")
  if (Array.isArray(direct)) {
    return direct.filter((item): item is string => typeof item === "string").slice(0, 20)
  }
  const steps = getValue(payload, "steps")
  if (Array.isArray(steps)) {
    const normalized: string[] = []
    for (const item of steps) {
      if (typeof item === "string" && item.trim()) {
        normalized.push(item)
        continue
      }
      if (item && typeof item === "object") {
        const row = item as Record<string, unknown>
        const message = pickString(row.message, row.title, row.step)
        if (message) normalized.push(message)
      }
      if (normalized.length >= 20) break
    }
    return normalized
  }
  const status = pickString(getValue(payload, "status")) ?? "queued"
  return [`Research task ${status}.`]
}

function deliverableTitle(type: DeliverableType) {
  if (type === "pdf") return "Full Research Report"
  if (type === "csv") return "Data & Comparisons"
  if (type === "docx") return "Executive Summary"
  return "Presentation"
}

function normalizeDeliverableType(value: string | undefined): DeliverableType | null {
  if (!value) return null
  const normalized = value.toLowerCase().replace(/^\./, "")
  if (normalized === "xlsx" || normalized === "xls" || normalized === "excel") return "csv"
  if (normalized === "word") return "docx"
  if (normalized === "powerpoint" || normalized === "ppt") return "pptx"
  if (normalized === "pdf" || normalized === "csv" || normalized === "docx" || normalized === "pptx") {
    return normalized
  }
  return null
}

function makeDeliverableFromUrl(type: DeliverableType, url: string): DeliverableFile {
  return {
    type,
    source: "remote",
    title: deliverableTitle(type),
    subtitle: `${type.toUpperCase()} File`,
    fileName: deriveFileNameFromUrl(url) ?? `${type}.${type}`,
    relativePath: "",
    remoteUrl: url,
    sizeBytes: 0,
    modifiedAt: new Date().toISOString(),
  }
}

function deriveFileNameFromUrl(url: string | undefined) {
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    const raw = parsed.pathname.split("/").filter(Boolean).pop()
    return raw || undefined
  } catch {
    return undefined
  }
}

function pickString(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function pickNumber(...values: unknown[]) {
  for (const value of values) {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return undefined
}

function toNonNegativeInt(value: number | undefined) {
  return Math.max(0, Math.round(value ?? 0))
}

function clamp01(value: number | undefined) {
  if (!Number.isFinite(value)) return 0
  const normalized = value ?? 0
  if (normalized > 1 && normalized <= 100) return Math.max(0, Math.min(1, normalized / 100))
  return Math.max(0, Math.min(1, normalized))
}

function estimateProgressFromStatus(status: unknown) {
  const normalized = String(status ?? "").toLowerCase()
  if (normalized.includes("complete")) return 1
  if (normalized.includes("run")) return 0.5
  return 0.05
}

function parseStructuredQuery(query: string | undefined) {
  if (!query) return { researchType: undefined, researchSubject: undefined }
  const lines = query.split(/\r?\n/).map((line) => line.trim())
  let researchType: string | undefined
  let researchSubject: string | undefined

  for (const line of lines) {
    if (!researchType) {
      const typeMatch = line.match(/^Research\s*Type:\s*(.+)$/i)
      if (typeMatch?.[1]) {
        researchType = typeMatch[1].trim().toLowerCase()
      }
    }
    if (!researchSubject) {
      const subjectMatch = line.match(/^Research\s*Subject:\s*(.+)$/i)
      if (subjectMatch?.[1]) {
        researchSubject = subjectMatch[1].trim()
      }
    }
    if (researchType && researchSubject) break
  }

  return { researchType, researchSubject }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null
  return value as Record<string, unknown>
}

function getValue(record: Record<string, unknown> | null, key: string): unknown {
  if (!record) return undefined
  return record[key]
}

function isNotFoundValyuError(error: unknown) {
  if (!(error instanceof Error)) return false
  return /Valyu API error 404/i.test(error.message) || /not found/i.test(error.message)
}

function isPayloadShapeError(error: unknown) {
  if (!(error instanceof Error)) return false
  return /400/.test(error.message) && /(payload|format|deliverable|output)/i.test(error.message)
}
