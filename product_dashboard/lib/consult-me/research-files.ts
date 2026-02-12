import { readdir, readFile, stat } from "fs/promises"
import path from "path"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

import type {
  BrandResearchAsset,
  BrandResearchAssetMap,
  CsvPreview,
  CsvOverview,
  DeliverableFile,
  DeliverableType,
} from "@/lib/consult-me/types"

const BASE_DIR = path.resolve(process.cwd(), "..", "market_deep_research")
const DELIVERABLE_TYPES: DeliverableType[] = ["pdf", "docx", "csv", "pptx"]
const execFileAsync = promisify(execFile)

export async function loadConsultMeResearchAssets(): Promise<BrandResearchAssetMap> {
  const entries = await readdir(BASE_DIR, { withFileTypes: true }).catch(() => [])
  const brandDirs = entries.filter((entry) => entry.isDirectory())
  const assets = await Promise.all(
    brandDirs.map(async (brandDir) => {
      const asset = await loadBrandResearchAsset(brandDir.name)
      return asset
    })
  )

  return assets.reduce<BrandResearchAssetMap>((acc, asset) => {
    if (!asset) return acc
    acc[asset.brandKey] = asset
    return acc
  }, {})
}

async function loadBrandResearchAsset(brandFolder: string): Promise<BrandResearchAsset | null> {
  const brandDir = path.join(BASE_DIR, brandFolder)
  const entries = await readdir(brandDir, { withFileTypes: true }).catch(() => [])
  const files = entries.filter((entry) => entry.isFile())
  if (!files.length) return null

  const deliverablesByType = new Map<DeliverableType, DeliverableFile>()

  for (const entry of files) {
    const extension = path.extname(entry.name).slice(1).toLowerCase() as DeliverableType
    if (!DELIVERABLE_TYPES.includes(extension)) continue
    if (deliverablesByType.has(extension)) continue

    const fullPath = path.join(brandDir, entry.name)
    const fileStat = await stat(fullPath).catch(() => null)
    if (!fileStat) continue

    deliverablesByType.set(extension, {
      type: extension,
      fileName: entry.name,
      relativePath: path.join(brandFolder, entry.name),
      sizeBytes: fileStat.size,
      modifiedAt: fileStat.mtime.toISOString(),
    })
  }

  const available = DELIVERABLE_TYPES.flatMap((type) => {
    const hit = deliverablesByType.get(type)
    return hit ? [hit] : []
  })
  const missing = DELIVERABLE_TYPES.filter((type) => !deliverablesByType.has(type))

  const csvFile = deliverablesByType.get("csv")
  const docxFile = deliverablesByType.get("docx")
  const csvParsed = csvFile
    ? await parseCsvArtifact(path.join(brandDir, csvFile.fileName))
    : null
  const docParsed = docxFile
    ? await extractDocxText(path.join(brandDir, docxFile.fileName))
    : null

  const defaultSteps = 5
  const defaultSources = 42 + (stringHash(normalizeBrandKey(brandFolder)) % 40)

  return {
    brandKey: normalizeBrandKey(brandFolder),
    brandLabel: toBrandLabel(brandFolder),
    status: available.length === DELIVERABLE_TYPES.length
      ? "available"
      : available.length > 0
        ? "partial"
        : "missing",
    available,
    missing,
    csvOverview: csvParsed?.overview,
    csvPreview: csvParsed?.preview,
    executiveSummaryExcerpt: docParsed?.excerpt,
    fullReportText: docParsed?.fullText,
    activityTemplate: buildActivityTemplate(toBrandLabel(brandFolder)),
    defaultSteps,
    defaultSources,
  }
}

async function parseCsvArtifact(
  filePath: string
): Promise<{ overview: CsvOverview; preview: CsvPreview } | null> {
  try {
    const content = await readFile(filePath, "utf8")
    const lines = content
      .split(/\r?\n/)
      .filter(Boolean)
    if (!lines.length) return null

    const header = splitCsvLine(lines[0])
    const previewRows = lines.slice(1, 13).map((line) => splitCsvLine(line))
    return {
      overview: {
        rowCount: Math.max(0, lines.length - 1),
        columnCount: header.length,
        columns: header.slice(0, 12),
      },
      preview: {
        columns: header,
        rows: previewRows,
      },
    }
  } catch {
    return null
  }
}

async function extractDocxText(
  filePath: string
): Promise<{ excerpt: string; fullText: string } | null> {
  try {
    const xml = await readDocxXml(filePath)
    if (!xml) return null
    const matches = xml.match(/<w:t[^>]*>[\s\S]*?<\/w:t>/g) ?? []
    const rawText = matches
      .map((entry) => entry.replace(/<[^>]+>/g, ""))
      .map((entry) => decodeXml(entry))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()

    if (!rawText) return null
    return {
      excerpt: rawText.slice(0, 900),
      fullText: rawText.slice(0, 30_000),
    }
  } catch {
    return null
  }
}

async function readDocxXml(filePath: string) {
  try {
    const { stdout } = await execFileAsync("unzip", ["-p", filePath, "word/document.xml"], {
      maxBuffer: 4 * 1024 * 1024,
      encoding: "utf8",
    })
    return stdout || ""
  } catch {
    return ""
  }
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let current = ""
  let inQuote = false

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (char === '"') {
      const next = line[i + 1]
      if (inQuote && next === '"') {
        current += '"'
        i += 1
        continue
      }
      inQuote = !inQuote
      continue
    }
    if (char === "," && !inQuote) {
      cells.push(current.trim())
      current = ""
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function normalizeBrandKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function toBrandLabel(value: string) {
  if (!value) return "Unknown"
  return value
    .split(/[\s_-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}

function buildActivityTemplate(brandLabel: string) {
  return [
    `Initiated deep market research for ${brandLabel}.`,
    "Defined scope alignment and key benchmark questions.",
    "Expanded source discovery across market reports and public references.",
    "Compiled competitor comparison matrix and strategic deltas.",
    "Generated executive-ready deliverables and report package.",
  ]
}

function stringHash(value: string) {
  let hash = 0
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0
  }
  return hash
}
