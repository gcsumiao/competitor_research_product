import { access, readFile, stat } from "fs/promises"
import path from "path"

import type {
  DeliverableFile,
  DeliverableType,
  ResearchSource,
} from "@/lib/consult-me/types"
import { resolveAppRoot } from "@/lib/dashboard-runtime"

// Deliverables ship with the app (product_dashboard/data/consult-me-reports/**) so the
// Consult Me routes work on a deployed instance, not just on the authoring machine.
const SEED_ROOT = path.join(resolveAppRoot(), "data", "consult-me-reports")

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
    const sources = await readSeedSources(seed.companyKey)
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

/**
 * Research sources are precomputed offline into <company>/sources.json instead of being
 * re-extracted from the report PDF on every request. Results are cached for the process;
 * a missing or malformed file degrades to an empty list rather than throwing.
 */
const seedSourcesCache = new Map<string, ResearchSource[]>()

async function readSeedSources(companyKey: string): Promise<ResearchSource[]> {
  const cached = seedSourcesCache.get(companyKey)
  if (cached) return cached

  let sources: ResearchSource[] = []
  try {
    const raw = await readFile(path.join(SEED_ROOT, companyKey, "sources.json"), "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      sources = parsed.filter(
        (item): item is ResearchSource =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as ResearchSource).url === "string" &&
          (item as ResearchSource).url.length > 0
      )
    }
  } catch {
    sources = []
  }

  seedSourcesCache.set(companyKey, sources)
  return sources
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
