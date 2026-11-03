import type { SnapshotSummary, TypeBreakdownMetric, TypeBreakdownSummary } from "@/lib/competitor-data"
import { resolveSnapshotScheme, tierDefinition, type PriceTierSchemeVersion } from "@/lib/price-tier-scheme"
import { normalizeSnapshotDate } from "@/lib/snapshot-date"

export type BrandCategoryMixEntry = NonNullable<TypeBreakdownSummary["brandCategoryMix"]>[number]

export type BrandCategoryMixRow = {
  key: string
  label: string
  /** 1 = sub-tier (rendered indented under its parent tier). */
  depth: 0 | 1
  /** Family totals ("Total Tablet", ...) and the grand "Total" render bold. */
  isTotal: boolean
  metric: TypeBreakdownMetric
}

export type BrandCategoryMixView =
  /** "snapshot": the payload has no per-brand rows at all (ingested before the
   *  breakdown existed); "brand": the month has them, this brand has none. */
  | { status: "unavailable"; reason: "snapshot" | "brand" }
  | { status: "ok"; brand: string; schemeVersion: PriceTierSchemeVersion; rows: BrandCategoryMixRow[] }

const BRAND_KEY_PATTERN = /[^a-z0-9]/g

function brandKeyOf(value: string) {
  return value.trim().toLowerCase().replace(BRAND_KEY_PATTERN, "")
}

/**
 * The brand's Sheet1 rows in this snapshot; null for old payloads (no field)
 * or a brand not in Sheet1. The exact brand text wins (case/whitespace
 * insensitive); the normalised key ("Bully Dog" -> "bullydog") is used only
 * when it resolves to exactly one entry, so brands that normalise alike
 * ("ACME-A" / "ACMEA") never answer for each other.
 */
export function findBrandCategoryMix(
  snapshot: Pick<SnapshotSummary, "typeBreakdowns"> | undefined,
  brand: string
): BrandCategoryMixEntry | null {
  const wanted = brand.trim().toLowerCase()
  if (!wanted) return null
  const entries = snapshot?.typeBreakdowns?.brandCategoryMix ?? []
  const exact = entries.find((entry) => entry.brand.trim().toLowerCase() === wanted)
  if (exact) return exact
  const key = brandKeyOf(brand)
  if (!key) return null
  const loose = entries.filter((entry) => (entry.brandKey || brandKeyOf(entry.brand)) === key)
  return loose.length === 1 ? loose[0] : null
}

/**
 * Rows of the brand's category mix in scheme order (V2: 16 rows, V1: 10),
 * for the scheme the snapshot's own rows resolve to. Keys outside that
 * scheme are dropped; a scheme key the brand lacks is simply not shown.
 */
export function buildBrandCategoryMixView(
  snapshot: Pick<SnapshotSummary, "date" | "typeBreakdowns"> | undefined,
  brand: string
): BrandCategoryMixView {
  if (!snapshot?.typeBreakdowns?.brandCategoryMix?.length) return { status: "unavailable", reason: "snapshot" }
  const entry = findBrandCategoryMix(snapshot, brand)
  if (!entry?.rows.length) return { status: "unavailable", reason: "brand" }

  const byKey = new Map<string, TypeBreakdownMetric>()
  for (const row of entry.rows) {
    if (!byKey.has(row.scopeKey)) byKey.set(row.scopeKey, row)
  }
  const scheme = resolveSnapshotScheme({ snapshotDate: snapshot.date, scopeKeys: byKey.keys() })

  const rows: BrandCategoryMixRow[] = []
  for (const definition of scheme.tiers) {
    const metric = byKey.get(definition.key)
    if (!metric) continue
    rows.push({
      key: definition.key,
      label: tierDefinition(definition.key)?.label ?? metric.label,
      depth: definition.kind === "subtier" ? 1 : 0,
      isTotal: definition.kind === "total" || definition.kind === "grand_total",
      metric,
    })
  }
  if (!rows.length) return { status: "unavailable", reason: "brand" }

  return { status: "ok", brand: entry.brand, schemeVersion: scheme.version, rows }
}

/** "Oct 2026" for a snapshot date ("2026-10-31", "202610", ...). */
export function formatMixMonthLabel(date: string) {
  const normalized = normalizeSnapshotDate(date)
  const match = normalized.match(/^(\d{4})-(\d{2})/)
  if (!match) return normalized
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 15))
  )
}

/** Within-brand share (ratio) with one decimal: 0.0034 -> "0.3%". */
export function formatMixShare(value: number) {
  if (!Number.isFinite(value)) return "n/a"
  const percent = value * 100
  const rounded = Number(percent.toFixed(1))
  return `${rounded === 0 ? "0.0" : rounded.toFixed(1)}%`
}

/** MoM/YoY ratio as a signed whole percent; null/non-finite -> "n/a". */
export function formatMixChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a"
  const rounded = Math.round(value * 100)
  const normalized = rounded === 0 ? 0 : rounded
  return `${normalized > 0 ? "+" : ""}${normalized}%`
}
