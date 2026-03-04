import { access, readFile, stat } from "fs/promises"
import path from "path"
import { URL } from "url"

import type {
  DeliverableFile,
  DeliverableType,
  ResearchSource,
} from "@/lib/consult-me/types"

const SEED_ROOT = "/Users/sumiaoc/competitor_research_product/market_deep_research"

type SeedReportConfig = {
  seedId: string
  companyKey: string
  companyLabel: string
  researchSubject: string
  sourcesFound: number
  deliverables: Partial<Record<DeliverableType, string>>
}

export type SeedReport = {
  taskId: string
  seedId: string
  companyKey: string
  companyLabel: string
  researchSubject: string
  sourcesFound: number
  sources: ResearchSource[]
  deliverables: DeliverableFile[]
  updatedAt: string
  createdAt: string
  completedAt: string
}

const SEED_REPORTS: SeedReportConfig[] = [
  {
    seedId: "seed:ancel",
    companyKey: "ancel",
    companyLabel: "Ancel",
    researchSubject: "Ancel vehicle diagnostic",
    sourcesFound: 19,
    deliverables: {
      pdf: "ancel/ancel_research-report.pdf",
      csv: "ancel/ancel - Competitor Comparison Matrix with key metr.csv",
      docx: "ancel/ancel - Executive Summary one-page due diligence o.docx",
      pptx: "ancel/ancel - Executive Presentation Deck with company o.pptx",
    },
  },
  {
    seedId: "seed:topdon",
    companyKey: "topdon",
    companyLabel: "Topdon",
    researchSubject: "Topdon vehicle diagnostic",
    sourcesFound: 51,
    deliverables: {
      pdf: "topdon/topdon_research-report.pdf",
      csv: "topdon/topdon - Competitor Comparison Matrix with key met.csv",
      docx: "topdon/topdon - Executive Summary one-page due diligence.docx",
    },
  },
]

export async function listSeedReports() {
  const outputs: SeedReport[] = []
  for (const seed of SEED_REPORTS) {
    const deliverables = await resolveSeedDeliverables(seed)
    if (!deliverables.length) continue
    const pdfFile = deliverables.find((item) => item.type === "pdf")
    const sources = pdfFile?.localPath
      ? await extractSourcesFromPdf(pdfFile.localPath, seed.sourcesFound)
      : []
    const latestModified =
      deliverables
        .map((item) => Date.parse(item.modifiedAt))
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => b - a)[0] ?? Date.now()
    const stamp = new Date(latestModified).toISOString()
    outputs.push({
      taskId: seed.seedId,
      seedId: seed.seedId,
      companyKey: seed.companyKey,
      companyLabel: seed.companyLabel,
      researchSubject: seed.researchSubject,
      sourcesFound: seed.sourcesFound,
      sources,
      deliverables,
      createdAt: stamp,
      updatedAt: stamp,
      completedAt: stamp,
    })
  }
  return outputs
}

export async function getSeedReportByTaskId(taskId: string) {
  const normalized = taskId.trim().toLowerCase()
  if (!normalized.startsWith("seed:")) return null
  const reports = await listSeedReports()
  return reports.find((item) => item.taskId === normalized) ?? null
}

export async function resolveSeedDeliverable(seedId: string, type: DeliverableType) {
  const normalized = seedId.trim().toLowerCase()
  const config = SEED_REPORTS.find((item) => item.seedId === normalized)
  if (!config) return null
  const relPath = config.deliverables[type]
  if (!relPath) return null
  const absolute = path.resolve(SEED_ROOT, relPath)
  const exists = await fileExists(absolute)
  if (!exists) return null

  const meta = await stat(absolute)
  return {
    type,
    source: "seed_local" as const,
    seedId: config.seedId,
    localPath: absolute,
    title: deliverableTitle(type),
    subtitle: `${type.toUpperCase()} File`,
    fileName: path.basename(absolute),
    relativePath: relPath,
    sizeBytes: meta.size,
    modifiedAt: meta.mtime.toISOString(),
  }
}

async function resolveSeedDeliverables(seed: SeedReportConfig) {
  const entries: DeliverableFile[] = []
  const order: DeliverableType[] = ["pdf", "csv", "docx", "pptx"]
  for (const type of order) {
    const file = await resolveSeedDeliverable(seed.seedId, type)
    if (file) entries.push(file)
  }
  return entries
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function deliverableTitle(type: DeliverableType) {
  if (type === "pdf") return "Full Research Report"
  if (type === "csv") return "Data & Comparisons"
  if (type === "docx") return "Executive Summary"
  return "Presentation"
}

async function extractSourcesFromPdf(filePath: string, limit: number): Promise<ResearchSource[]> {
  try {
    const raw = await readFile(filePath)
    const text = raw.toString("latin1")
    const urlPattern = /https?:\/\/[^\s<>"'`\\)]+/gi
    const unique: ResearchSource[] = []
    const seen = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = urlPattern.exec(text)) !== null) {
      const original = match[0]
      const cleaned = normalizeExtractedUrl(original)
      if (!cleaned) continue
      if (seen.has(cleaned)) continue
      seen.add(cleaned)
      const around = extractContextWindow(text, match.index, original.length)
      unique.push({
        title: sourceTitleFromUrl(cleaned, around),
        snippet: sourceSnippetFromContext(around, cleaned),
        url: cleaned,
      })
      if (unique.length >= Math.max(1, limit)) break
    }
    return unique
  } catch {
    return []
  }
}

function normalizeExtractedUrl(value: string) {
  const trimmed = value.trim().replace(/[)\],.;]+$/g, "")
  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") return null
    return url.toString()
  } catch {
    return null
  }
}

function sourceTitleFromUrl(value: string, context?: string) {
  const contextTitle = extractContextTitle(context)
  if (contextTitle) return contextTitle
  try {
    const parsed = new URL(value)
    const hostname = parsed.hostname.replace(/^www\./, "")
    const segments = parsed.pathname
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean)
    const last = segments[segments.length - 1]
    if (!last) return hostname
    const slug = decodeURIComponent(last)
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z0-9]+$/i, "")
      .trim()
    if (!slug) return hostname
    return `${hostname} - ${slug}`
  } catch {
    return value
  }
}

function extractContextWindow(text: string, index: number, size: number) {
  const start = Math.max(0, index - 220)
  const end = Math.min(text.length, index + size + 260)
  return text.slice(start, end)
}

function cleanText(value: string) {
  return value
    .replace(/https?:\/\/[^\s<>"'`\\)]+/gi, " ")
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function extractContextTitle(value?: string) {
  if (!value) return ""
  const cleaned = cleanText(value)
  if (!cleaned) return ""
  const chunks = cleaned
    .split(/[.!?;|]/)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
  const best = chunks.find((item) => item.length >= 24 && item.length <= 120)
  return best ?? ""
}

function sourceSnippetFromContext(value: string, url: string) {
  const cleaned = cleanText(value)
  if (!cleaned) return ""
  const withoutUrl = cleaned.replace(url, " ").replace(/\s+/g, " ").trim()
  if (!withoutUrl) return ""
  return withoutUrl.length > 220 ? `${withoutUrl.slice(0, 217)}...` : withoutUrl
}
