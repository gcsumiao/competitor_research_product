import { access, readFile, stat } from "fs/promises"
import path from "path"

import type {
  BriefAssetKind,
  DeliverableFile,
  DeliverableType,
  ResearchBrief,
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
  // Original research completion time on the authoring machine. File mtimes are
  // rewritten by git checkout on deploy, so the stamp must be pinned here.
  createdAt: string
  deliverables: Partial<Record<DeliverableType, string>>
  brief?: SeedBriefConfig
}

type SeedBriefConfig = Omit<ResearchBrief, "seedId" | "assets"> & {
  files: Partial<Record<BriefAssetKind, string>>
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
  brief?: ResearchBrief
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
    createdAt: "2026-02-10T23:34:47.000Z",
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
    createdAt: "2026-02-10T23:35:00.000Z",
    deliverables: {
      pdf: "topdon/topdon_research-report.pdf",
      csv: "topdon/topdon - Competitor Comparison Matrix with key met.csv",
      docx: "topdon/topdon - Executive Summary one-page due diligence.docx",
    },
  },
  {
    seedId: "seed:xtool",
    companyKey: "xtool",
    companyLabel: "XTOOL",
    researchSubject: "XTOOL vehicle diagnostic",
    sourcesFound: 31,
    createdAt: "2026-11-04T18:39:06.000Z",
    // Renamed from Valyu's "Shenzhen Xtooltech Intelligent Co Ltd XTOOL - …" exports:
    // the U+2026 ellipsis is not a valid ByteString in the Content-Disposition header.
    deliverables: {
      pdf: "xtool/xtool_research-report.pdf",
      csv: "xtool/xtool - Competitor Comparison Matrix.csv",
      docx: "xtool/xtool - Executive Summary.docx",
      pptx: "xtool/xtool - Executive Presentation Deck.pptx",
    },
    // Innova's own synthesis (Valyu report + NA brief + monthly Amazon reports + web review).
    // Highlights are pinned to the brief's October 2026 numbers; refresh them with the files.
    brief: {
      title: "XTOOL: how big a threat, and what Innova should learn",
      summary:
        "Out-sold Innova in 6 of the last 12 months; its growth comes from sub-$200 bidirectional tools, not AI.",
      threatLevel: "high",
      dataThrough: "2026-10-31",
      publishedAt: "2026-11-04T22:00:00.000Z",
      highlights: [
        { label: "October revenue", value: "$1.93M", note: "Innova $1.41M" },
        { label: "Rolling 12 gap", value: "−$596K", note: "flips around the Dec report" },
        { label: "Sub-$200 share", value: "42%", note: "from 28% a year earlier" },
      ],
      files: {
        html: "xtool/xtool_innova_threat_brief.html",
        pdf: "xtool/xtool_innova_threat_brief.pdf",
      },
    },
  },
]

export async function listSeedReports() {
  const outputs: SeedReport[] = []
  for (const seed of SEED_REPORTS) {
    const deliverables = await resolveSeedDeliverables(seed)
    if (!deliverables.length) continue
    const sources = await readSeedSources(seed.companyKey)
    const brief = await resolveSeedBrief(seed)
    const stamp = seed.createdAt
    outputs.push({
      taskId: seed.seedId,
      seedId: seed.seedId,
      companyKey: seed.companyKey,
      companyLabel: seed.companyLabel,
      researchSubject: seed.researchSubject,
      sourcesFound: seed.sourcesFound,
      sources,
      deliverables,
      brief,
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

async function resolveSeedBrief(seed: SeedReportConfig): Promise<ResearchBrief | undefined> {
  if (!seed.brief) return undefined
  const { files, ...meta } = seed.brief
  const assets: BriefAssetKind[] = []
  for (const kind of ["html", "pdf"] as const) {
    const relPath = files[kind]
    if (relPath && (await fileExists(path.resolve(SEED_ROOT, relPath)))) assets.push(kind)
  }
  if (!assets.length) return undefined
  return { ...meta, seedId: seed.seedId, assets }
}

/** Local file for one of a seed's brief assets, or null when unknown / missing. */
export async function resolveSeedBriefAsset(seedId: string, kind: BriefAssetKind) {
  const normalized = seedId.trim().toLowerCase()
  const config = SEED_REPORTS.find((item) => item.seedId === normalized)
  const relPath = config?.brief?.files[kind]
  if (!relPath) return null
  const absolute = path.resolve(SEED_ROOT, relPath)
  if (!(await fileExists(absolute))) return null
  return { kind, localPath: absolute, fileName: path.basename(absolute) }
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
