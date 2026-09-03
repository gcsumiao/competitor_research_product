import { unstable_cache } from "next/cache"

import {
  listDashboardCategoryIds,
  loadDashboardDataForCategory,
  type CategoryId,
  type CategorySummary,
  type DashboardData,
  type SnapshotSummary,
  type TypeBreakdownSummary,
} from "@/lib/competitor-data"
import { DASHBOARD_DATA_TAG } from "@/lib/db/constants"

export type DashboardScope =
  | "overview"
  | "brands"
  | "top50"
  | "types"
  | "survey"
  | "reports"
  | "consult"

type SnapshotField = keyof SnapshotSummary

// Mirrors the legacy pruneSnapshotForPage() field sets exactly (the
// production-proven shapes): overview/top50 ship NO brandListings — their
// historical-month image fallbacks are fully covered by topProducts +
// top50ByUnits across snapshots — and consult additionally narrows to the
// code_reader category's latest snapshot (see loadScopedDashboardDataUnmemoized).
const SNAPSHOT_FIELDS_BY_SCOPE = {
  overview: [
    "date",
    "label",
    "totals",
    "topProducts",
    "top50ByUnits",
    "brandTotals",
    "priceTiers",
    "rolling12",
    "typeBreakdowns",
    "qualityIssues",
  ],
  brands: [
    "date",
    "label",
    "totals",
    "brandTotals",
    "brandListings",
    "rolling12",
    "typeBreakdowns",
    "summaryBrandRanks",
  ],
  top50: [
    "date",
    "label",
    "totals",
    "topProducts",
    "top50ByUnits",
    "qualityIssues",
  ],
  types: [
    "date",
    "label",
    "totals",
    "topProducts",
    "typeBreakdowns",
    "summaryBrandRanks",
    "tierAsinRanks",
    "metadata",
  ],
  survey: ["date", "label", "totals", "topProducts"],
  reports: ["date", "label", "totals", "topProducts"],
  consult: ["date", "label", "totals", "brandTotals", "rolling12"],
} as const satisfies Record<DashboardScope, readonly SnapshotField[]>

const CACHE_REVALIDATE_SECONDS = 86_400
const MAX_CACHE_ENTRY_BYTES = 1_900_000

type ScopedCategoryEntry = {
  category: Pick<CategorySummary, "id" | "label">
  snapshots: SnapshotSummary[]
} | null

type ScopedDashboardMemo = {
  at: number
  promise: Promise<DashboardData>
}

type EnvelopeProbe = {
  byteLength: number
  oversized: boolean
}

const scopedDashboardMemos = new Map<DashboardScope, ScopedDashboardMemo>()
const cachedCategoryLoaders = new Map<string, () => Promise<ScopedCategoryEntry>>()
const cachedEnvelopeProbeLoaders = new Map<string, () => Promise<EnvelopeProbe>>()
const probedEntries = new Map<string, ScopedCategoryEntry>()
const oversizedCategoryKeys = new Set<string>()
const warnedOversizedCategoryKeys = new Set<string>()

class OversizedScopedCategoryError extends Error {
  constructor(
    readonly cacheKey: string,
    readonly byteLength: number,
    readonly entry: ScopedCategoryEntry
  ) {
    super(`Scoped dashboard category exceeds cache size limit: ${cacheKey}`)
  }
}

export function projectSnapshotForScope(
  snapshot: SnapshotSummary,
  scope: DashboardScope
): SnapshotSummary {
  const projected = Object.fromEntries(
    SNAPSHOT_FIELDS_BY_SCOPE[scope].map((field) => [field, snapshot[field]])
  ) as SnapshotSummary

  if (projected.typeBreakdowns && scope === "overview") {
    projected.typeBreakdowns = {
      allAsins: projected.typeBreakdowns.allAsins,
    } as TypeBreakdownSummary
  } else if (projected.typeBreakdowns && scope === "brands") {
    // competitors-client renders categoryBrandMix for non-"all_asins" scopes.
    projected.typeBreakdowns = {
      allAsins: projected.typeBreakdowns.allAsins,
      categoryBrandMix: projected.typeBreakdowns.categoryBrandMix,
    } as TypeBreakdownSummary
  }

  if (projected.brandListings && (scope === "overview" || scope === "top50")) {
    // These pages read brandListings ONLY inside buildProductImageFallbacks
    // (asin -> imageUrl for historical-month product images). Shipping the
    // full listing rows put ~15MB back into their RSC payloads, so project
    // down to the two fields the fallback map consumes. The cast is safe for
    // these scopes precisely because no other consumer sees this data —
    // "brands" keeps the full rows for its listings tables.
    projected.brandListings = projected.brandListings.map((listing) => ({
      brand: listing.brand,
      products: (listing.products ?? []).map((product) => ({
        asin: product.asin,
        imageUrl: product.imageUrl,
      })),
    })) as unknown as SnapshotSummary["brandListings"]
  }

  return projected
}

export async function loadScopedDashboardData(scope: DashboardScope): Promise<DashboardData> {
  const ttlMs = getDashboardMemoTtlMs()
  if (ttlMs <= 0) {
    return loadScopedDashboardDataUnmemoized(scope)
  }

  const now = Date.now()
  const memo = scopedDashboardMemos.get(scope)
  if (memo && now - memo.at < ttlMs) {
    return memo.promise
  }

  for (const [memoScope, entry] of scopedDashboardMemos) {
    if (now - entry.at >= ttlMs) {
      scopedDashboardMemos.delete(memoScope)
    }
  }

  const promise = loadScopedDashboardDataUnmemoized(scope)
  scopedDashboardMemos.set(scope, { at: now, promise })
  void promise.catch(() => {
    if (scopedDashboardMemos.get(scope)?.promise === promise) {
      scopedDashboardMemos.delete(scope)
    }
  })
  return promise
}

async function loadScopedDashboardDataUnmemoized(scope: DashboardScope): Promise<DashboardData> {
  const categoryIds = listDashboardCategoryIds()
  const entries = await Promise.all(
    categoryIds.map((categoryId) => loadScopedCategory(scope, categoryId))
  )

  return {
    categories: entries.flatMap((entry) =>
      entry
        ? [{ ...entry.category, snapshots: entry.snapshots }]
        : []
    ),
  }
}

async function loadScopedCategory(
  scope: DashboardScope,
  categoryId: CategoryId
): Promise<ScopedCategoryEntry> {
  if (!process.env.NEXT_RUNTIME) {
    return computeScopedCategoryEntry(scope, categoryId)
  }

  const cacheKey = scopedCategoryKey(scope, categoryId)
  if (oversizedCategoryKeys.has(cacheKey)) {
    return computeScopedCategoryEntry(scope, categoryId)
  }

  const probe = await getCachedEnvelopeProbeLoader(scope, categoryId)()
  if (probe.oversized) {
    oversizedCategoryKeys.add(cacheKey)
    warnForOversizedEntry(cacheKey, probe.byteLength)
    const probedEntry = takeProbedEntry(cacheKey)
    return probedEntry !== undefined
      ? probedEntry
      : computeScopedCategoryEntry(scope, categoryId)
  }

  try {
    return await getCachedCategoryLoader(scope, categoryId)()
  } catch (error) {
    if (!(error instanceof OversizedScopedCategoryError)) throw error
    oversizedCategoryKeys.add(error.cacheKey)
    warnForOversizedEntry(error.cacheKey, error.byteLength)
    return error.entry
  } finally {
    probedEntries.delete(cacheKey)
  }
}

function getCachedEnvelopeProbeLoader(scope: DashboardScope, categoryId: CategoryId) {
  const cacheKey = scopedCategoryKey(scope, categoryId)
  const existing = cachedEnvelopeProbeLoaders.get(cacheKey)
  if (existing) return existing

  const loader = unstable_cache(
    async () => {
      const entry = await computeScopedCategoryEntry(scope, categoryId)
      probedEntries.set(cacheKey, entry)
      const byteLength = getEntryByteLength(entry)
      return {
        byteLength,
        oversized: byteLength > MAX_CACHE_ENTRY_BYTES,
      }
    },
    // v4: cache-bust after the 2026-09-02 BLCKTEC-exactness re-ingest (v3 was
    // the rolling-label re-ingest) — prod's /api/revalidate sits behind
    // Cloudflare JWT until the service token lands, so data fixes flush by
    // bumping this version instead.
    ["dashboard-scope-envelope", "v4", scope, categoryId],
    {
      tags: [DASHBOARD_DATA_TAG],
      revalidate: CACHE_REVALIDATE_SECONDS,
    }
  )

  cachedEnvelopeProbeLoaders.set(cacheKey, loader)
  return loader
}

function getCachedCategoryLoader(scope: DashboardScope, categoryId: CategoryId) {
  const cacheKey = scopedCategoryKey(scope, categoryId)
  const existing = cachedCategoryLoaders.get(cacheKey)
  if (existing) return existing

  const loader = unstable_cache(
    async () => {
      const probedEntry = takeProbedEntry(cacheKey)
      const entry = probedEntry !== undefined
        ? probedEntry
        : await computeScopedCategoryEntry(scope, categoryId)
      const byteLength = getEntryByteLength(entry)
      if (byteLength > MAX_CACHE_ENTRY_BYTES) {
        throw new OversizedScopedCategoryError(cacheKey, byteLength, entry)
      }
      return entry
    },
    ["dashboard-scope", "v4", scope, categoryId],
    {
      tags: [DASHBOARD_DATA_TAG],
      revalidate: CACHE_REVALIDATE_SECONDS,
    }
  )

  cachedCategoryLoaders.set(cacheKey, loader)
  return loader
}

async function computeScopedCategoryEntry(
  scope: DashboardScope,
  categoryId: CategoryId
): Promise<ScopedCategoryEntry> {
  const data = await loadDashboardDataForCategory(categoryId)
  const category = data.categories.find((item) => item.id === categoryId)
  if (!category) return null

  const imageUrlByAsin = buildCategoryImageIndex(category.snapshots)
  // One clone per source object across the whole category: topProducts and
  // top50ByUnits share row objects within a month, and React's Flight
  // serializer dedupes by reference — private clones would double those rows
  // in every page payload.
  const filledClones = new Map<object, object>()

  return {
    category: { id: category.id, label: category.label },
    snapshots: category.snapshots.map((snapshot) =>
      fillMissingProductImages(projectSnapshotForScope(snapshot, scope), imageUrlByAsin, filledClones)
    ),
  }
}

// Product images only exist in months whose ingest had an image sidecar
// (202607 onward for code readers); earlier months' rows have empty
// imageUrls. Fill the gaps at assembly time from every month's known
// images so historical snapshots render product photos on all pages —
// including ones (like Types leaders) that never had a client-side
// fallback map.
function buildCategoryImageIndex(snapshots: SnapshotSummary[]) {
  const imageUrlByAsin = new Map<string, string>()
  for (let index = snapshots.length - 1; index >= 0; index -= 1) {
    const snapshot = snapshots[index]
    if (!snapshot) continue
    const groups = [
      snapshot.topProducts ?? [],
      snapshot.top50ByUnits ?? [],
      ...(snapshot.brandListings ?? []).map((listing) => listing.products ?? []),
    ]
    for (const products of groups) {
      for (const product of products) {
        const asin = product.asin?.trim().toUpperCase()
        const imageUrl = product.imageUrl?.trim()
        if (asin && imageUrl && !imageUrlByAsin.has(asin)) {
          imageUrlByAsin.set(asin, imageUrl)
        }
      }
    }
  }
  return imageUrlByAsin
}

function fillMissingProductImages(
  snapshot: SnapshotSummary,
  imageUrlByAsin: Map<string, string>,
  filledClones: Map<object, object>
): SnapshotSummary {
  if (!imageUrlByAsin.size) return snapshot

  const fillProducts = <T extends { asin?: string | null; imageUrl?: string | null }>(
    products: T[] | undefined
  ): T[] | undefined => {
    if (!products?.length) return products
    let changed = false
    const filled = products.map((product) => {
      if (product.imageUrl?.trim()) return product
      const asin = product.asin?.trim().toUpperCase()
      const imageUrl = asin ? imageUrlByAsin.get(asin) : undefined
      if (!imageUrl) return product
      changed = true
      const existing = filledClones.get(product) as T | undefined
      if (existing) return existing
      const clone = { ...product, imageUrl }
      filledClones.set(product, clone)
      return clone
    })
    return changed ? filled : products
  }

  // brandListings are intentionally NOT filled: no page renders listing-row
  // images; their URLs would be dead weight in the brands payload.
  const topProducts = fillProducts(snapshot.topProducts)
  const top50ByUnits = fillProducts(snapshot.top50ByUnits)

  if (topProducts === snapshot.topProducts && top50ByUnits === snapshot.top50ByUnits) {
    return snapshot
  }

  return {
    ...snapshot,
    ...(topProducts !== undefined ? { topProducts } : {}),
    ...(top50ByUnits !== undefined ? { top50ByUnits } : {}),
  }
}

function takeProbedEntry(cacheKey: string) {
  if (!probedEntries.has(cacheKey)) return undefined
  const entry = probedEntries.get(cacheKey)
  probedEntries.delete(cacheKey)
  return entry
}

function getEntryByteLength(entry: ScopedCategoryEntry) {
  return Buffer.byteLength(JSON.stringify(entry), "utf8")
}

function scopedCategoryKey(scope: DashboardScope, categoryId: CategoryId) {
  return `${scope}|${categoryId}`
}

function warnForOversizedEntry(cacheKey: string, byteLength: number) {
  if (warnedOversizedCategoryKeys.has(cacheKey)) return
  warnedOversizedCategoryKeys.add(cacheKey)
  console.warn(
    `Bypassing unstable_cache for oversized scoped dashboard category ${cacheKey} (${byteLength} bytes)`
  )
}

function getDashboardMemoTtlMs() {
  const raw = (process.env.DASHBOARD_MEMO_TTL_MS ?? "").trim()
  if (!raw) return 60_000
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 60_000
}
