import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import type { SnapshotSummary } from "../lib/competitor-data.ts"
import type { SnapshotRowInput } from "../lib/db/ingest.ts"
import type { SourceArtifactInput } from "../lib/db/source-artifacts.ts"

export function detectMediaType(fileName: string) {
  const lower = fileName.toLowerCase()
  if (lower.endsWith(".xlsx")) {
    return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }
  if (lower.endsWith(".json")) {
    return "application/json"
  }
  if (lower.endsWith(".csv")) {
    return "text/csv; charset=utf-8"
  }
  return "application/octet-stream"
}

export async function buildArtifactFromFile(input: {
  filePath: string
  artifactPath: string
  categoryId?: string
  monthKey?: string
  snapshotDate?: string
  artifactKind: string
  metadata?: Record<string, unknown>
}) {
  const [content, fileStat] = await Promise.all([readFile(input.filePath), stat(input.filePath)])
  return {
    artifactPath: input.artifactPath,
    categoryId: input.categoryId,
    monthKey: input.monthKey,
    snapshotDate: input.snapshotDate,
    artifactKind: input.artifactKind,
    fileName: path.basename(input.filePath),
    mediaType: detectMediaType(input.filePath),
    modifiedAt: fileStat.mtime.toISOString(),
    content,
    metadata: input.metadata,
  } satisfies SourceArtifactInput
}

export async function ensureCopiedFile(sourcePath: string, targetPath: string) {
  await mkdir(path.dirname(targetPath), { recursive: true })
  await copyFile(sourcePath, targetPath)
}

export async function writeJsonFile(filePath: string, payload: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
}

export function toMonthKey(snapshotDate: string) {
  return snapshotDate.replace(/-/g, "").slice(0, 6)
}

export function applySnapshotRowImageUrls(
  snapshot: SnapshotSummary,
  rowRecords: SnapshotRowInput[]
) {
  const imageUrlsByAsin = new Map<string, string>()
  for (const row of rowRecords) {
    const asin = row.asin?.trim().toUpperCase()
    const imageUrl = row.imageUrl
    if (!asin || !imageUrl?.trim() || imageUrlsByAsin.has(asin)) continue
    imageUrlsByAsin.set(asin, imageUrl.trim())
  }

  if (imageUrlsByAsin.size === 0) return { enriched: 0 }

  let enriched = 0
  const enrichProducts = (products: SnapshotSummary["topProducts"] | undefined) => {
    products?.forEach((product) => {
      if (product.imageUrl) return
      const asin = product.asin?.trim().toUpperCase()
      if (!asin) return
      const imageUrl = imageUrlsByAsin.get(asin)
      if (!imageUrl) return
      product.imageUrl = imageUrl
      enriched += 1
    })
  }

  enrichProducts(snapshot.topProducts)
  enrichProducts(snapshot.top50ByUnits)
  snapshot.brandListings?.forEach((listing) => enrichProducts(listing.products))
  snapshot.brandSheetListings?.forEach((listing) => enrichProducts(listing.products))

  return { enriched }
}

export async function parseStructuredSnapshotRows(filePath: string | undefined) {
  if (!filePath) return [] as SnapshotRowInput[]
  const raw = JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>
  const rows = Array.isArray(raw.snapshotRows)
    ? raw.snapshotRows
    : Array.isArray(raw.rows)
      ? raw.rows
      : []

  return rows
    .map((row) => toSnapshotRowInput(row))
    .filter((row): row is SnapshotRowInput => Boolean(row))
}

export async function parseStructuredSnapshotSidecar(filePath: string) {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as unknown
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a top-level JSON object.")
  }

  const raw = parsed as Record<string, unknown>
  const sourceRows = Array.isArray(raw.snapshotRows)
    ? raw.snapshotRows
    : Array.isArray(raw.rows)
      ? raw.rows
      : null
  if (!sourceRows) {
    throw new Error('Expected a "snapshotRows" or "rows" array.')
  }

  return {
    month: raw.month,
    rows: sourceRows
      .map((row) => toSnapshotRowInput(row))
      .filter((row): row is SnapshotRowInput => Boolean(row)),
  }
}

function toSnapshotRowInput(row: unknown): SnapshotRowInput | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null
  const value = row as Record<string, unknown>
  return {
    rowSource: stringValue(value.rowSource) || "structured_export",
    asin: stringValue(value.asin ?? value.ASIN),
    title: stringValue(value.title ?? value.Title),
    brand: stringValue(value.brand ?? value.Brand),
    typeLabel: stringValue(value.typeLabel ?? value.type ?? value.Type),
    price: numberValue(value.price ?? value.Price),
    revenue: numberValue(value.revenue ?? value.monthlyRevenue ?? value["Monthly Revenue"]),
    units: numberValue(value.units ?? value.monthlyUnits ?? value["Monthly Sales"]),
    reviewCount: numberValue(value.reviewCount ?? value["Review Count"]),
    rating: numberValue(value.rating ?? value["Reviews Rating"]),
    fulfillment: stringValue(value.fulfillment ?? value.Fulfillment),
    sizeTier: stringValue(value.sizeTier ?? value["Size Tier"]),
    subcategory: stringValue(value.subcategory ?? value.Subcategory),
    url: stringValue(value.url ?? value.URL),
    imageUrl: stringValue(value.imageUrl ?? value["Image URL"]),
    monthlyRevenue: numberValue(value.monthlyRevenue ?? value["Monthly Revenue"]),
    monthlyUnits: numberValue(value.monthlyUnits ?? value["Monthly Sales"]),
    estimatedRevenue12mo: numberValue(value.estimatedRevenue12mo ?? value["12mo Revenue"]),
    estimatedUnits12mo: numberValue(value.estimatedUnits12mo ?? value["12mo Units"]),
    rankRevenue: numberValue(value.rankRevenue),
    rankUnits: numberValue(value.rankUnits),
    metadata: {},
  } satisfies SnapshotRowInput
}

function stringValue(value: unknown) {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed || undefined
}

function numberValue(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined
  const numeric = typeof value === "number" ? value : Number(String(value).replace(/[^0-9.-]/g, ""))
  return Number.isFinite(numeric) ? numeric : undefined
}

export async function triggerRevalidate(input: {
  baseUrl?: string
  secret?: string
  tags?: string[]
}) {
  if (!input.baseUrl || !input.secret) return
  const tags = input.tags?.length ? input.tags : ["dashboard-data"]
  for (const tag of tags) {
    const url = new URL("/api/revalidate", input.baseUrl)
    url.searchParams.set("secret", input.secret)
    url.searchParams.set("tag", tag)
    try {
      const response = await fetch(url, { method: "POST", headers: cloudflareAccessHeaders() })
      if (!response.ok) {
        console.warn(
          `Failed to revalidate ${tag}: HTTP ${response.status} from ${url.origin}${url.pathname} ` +
            "(Cloudflare Access likely blocked it; bump the dashboard-scope cache version or use a CF service token)"
        )
      }
    } catch (error) {
      console.warn(`Failed to revalidate ${tag}: ${error instanceof Error ? error.message : error}`)
    }
  }
}

function cloudflareAccessHeaders(): Record<string, string> {
  const clientId = process.env.CF_ACCESS_CLIENT_ID?.trim()
  const clientSecret = process.env.CF_ACCESS_CLIENT_SECRET?.trim()
  if (!clientId && !clientSecret) return {}
  if (!clientId || !clientSecret) {
    throw new Error("CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET must be provided together.")
  }
  return {
    "CF-Access-Client-Id": clientId,
    "CF-Access-Client-Secret": clientSecret,
  }
}
