import type { CodeReaderDataMart, IndexedProduct } from "@/lib/chatbot/code-reader-index"
import type { ParsedQuery } from "@/lib/chatbot/query-parser"
import type {
  EntitySourceHit,
  ResolvedEntities,
  ResolvedScope,
} from "@/lib/chatbot/types"

export type EntityResolution = {
  entities: ResolvedEntities
  scope: ResolvedScope
  matchedProducts: IndexedProduct[]
  ambiguous: boolean
  clarificationQuestion?: string
  entitySource: EntitySourceHit[]
}

const BRAND_ALIASES: Record<string, string[]> = {
  innova: ["innova"],
  blcktec: ["blcktec", "blck tek", "blacktec"],
}

export function resolveEntities(
  message: string,
  mart: CodeReaderDataMart,
  options?: {
    targetBrand?: string
    parsedQuery?: ParsedQuery
  }
): EntityResolution {
  const normalized = message.toLowerCase()
  const compact = normalize(message)
  const tokens = normalized.split(/[^a-z0-9]+/g).filter(Boolean)
  const tokenSet = new Set(tokens)

  const entitySources: EntitySourceHit[] = []
  const asinMatches = extractAsins(message)
  const matchedByAsin = asinMatches
    .map((asin) => mart.productsByAsin.get(normalize(asin)))
    .filter((item): item is IndexedProduct => Boolean(item))
  for (const product of matchedByAsin) {
    entitySources.push({
      entity: "asin",
      value: product.asin,
      source: "asin_match",
    })
  }

  const aliasMatches = resolveByProductAliases(compact, tokenSet, mart)
  const matchedByAlias = aliasMatches.products
  entitySources.push(...aliasMatches.sources)
  const brandResolution = resolveBrands(normalized, tokenSet, mart)
  const brandMatches = brandResolution.brands
  entitySources.push(...brandResolution.sources)
  const titleMatches = resolveByTitle(normalized, mart)
  for (const product of titleMatches) {
    entitySources.push({
      entity: "product",
      value: `${product.brand} ${product.asin}`,
      source: "inferred_title",
    })
  }

  const productMap = new Map<string, IndexedProduct>()
  for (const product of [...matchedByAlias, ...matchedByAsin, ...titleMatches]) {
    productMap.set(normalize(product.asin), product)
  }
  const matchedProducts = Array.from(productMap.values()).slice(0, 8)

  const entities: ResolvedEntities = {
    brands: brandMatches,
    asins: matchedProducts.map((item) => item.asin),
    products: matchedProducts.map((item) => item.title),
    entitySources: dedupeEntitySources(entitySources),
  }

  const scope = resolveScope({
    normalizedMessage: normalized,
    matchedBrands: brandMatches,
    targetBrand: options?.targetBrand,
    parsedQuery: options?.parsedQuery,
  })
  if (scope.mode === "target_brand" && scope.brands[0]) {
    entitySources.push({
      entity: "brand",
      value: scope.brands[0],
      source: "quick_action_target",
    })
  }

  const ambiguous =
    matchedProducts.length > 1 &&
    isSpecificProductQuestion(normalized) &&
    !isBroadRankingQuestion(normalized)
  if (ambiguous) {
    const labels = matchedProducts.slice(0, 3).map((item) => `${item.brand} ${item.asin}`)
    return {
      entities,
      scope,
      matchedProducts,
      ambiguous: true,
      clarificationQuestion: `I found multiple products. Did you mean ${labels.join(", ")}?`,
      entitySource: dedupeEntitySources(entitySources),
    }
  }

  return {
    entities,
    scope,
    matchedProducts,
    ambiguous: false,
    entitySource: dedupeEntitySources(entitySources),
  }
}

function resolveBrands(
  normalizedMessage: string,
  tokenSet: Set<string>,
  mart: CodeReaderDataMart
) {
  const hits = new Set<string>()
  const sources: EntitySourceHit[] = []
  for (const [alias, canonical] of mart.brandLookup.entries()) {
    if (tokenSet.has(alias)) {
      hits.add(canonical)
      sources.push({
        entity: "brand",
        value: canonical,
        source: alias === canonical ? "exact_token" : "alias",
      })
      continue
    }
    if (alias.includes(" ") && normalizedMessage.includes(alias)) {
      hits.add(canonical)
      sources.push({
        entity: "brand",
        value: canonical,
        source: "alias",
      })
    }
  }

  for (const [canonical, aliases] of Object.entries(BRAND_ALIASES)) {
    for (const alias of aliases) {
      if (tokenSet.has(alias) || normalizedMessage.includes(alias)) {
        hits.add(canonical)
        sources.push({
          entity: "brand",
          value: canonical,
          source: alias === canonical ? "exact_token" : "alias",
        })
      }
    }
  }

  return { brands: Array.from(hits), sources }
}

function resolveByTitle(normalizedMessage: string, mart: CodeReaderDataMart) {
  const tokens = normalizedMessage
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3)
    .slice(0, 24)

  if (!tokens.length) return []
  const scored: Array<{ product: IndexedProduct; score: number }> = []

  for (const product of mart.products) {
    const titleTokens = `${product.brand} ${product.asin} ${product.title}`
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 2)
    const titleTokenSet = new Set(titleTokens)
    let score = 0
    for (const token of tokens) {
      if (titleTokenSet.has(token)) {
        score += token.length >= 5 ? 2 : 1
      }
    }
    if (score >= 2) {
      scored.push({ product, score })
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || b.product.revenue - a.product.revenue)
    .slice(0, 8)
    .map((item) => item.product)
}

function resolveByProductAliases(
  compactMessage: string,
  tokenSet: Set<string>,
  mart: CodeReaderDataMart
) {
  const matched = new Map<string, IndexedProduct>()
  const sources: EntitySourceHit[] = []
  for (const [alias, asins] of mart.productAliasToAsins.entries()) {
    const aliasHit =
      tokenSet.has(alias) ||
      (alias.length >= 7 && /[0-9]/.test(alias) && compactMessage.includes(alias))
    if (!aliasHit) continue
    for (const asin of asins) {
      const product = mart.productsByAsin.get(normalize(asin))
      if (product) {
        matched.set(normalize(product.asin), product)
        sources.push({
          entity: "asin",
          value: product.asin,
          source: "alias",
        })
      }
    }
  }
  return { products: Array.from(matched.values()), sources }
}

function extractAsins(message: string) {
  const matches = message.match(/\b[A-Z0-9]{8,10}\b/gi) ?? []
  return Array.from(new Set(matches.map((item) => item.toUpperCase())))
}

function isSpecificProductQuestion(normalized: string) {
  return /\b(product|asin|scanner|model|competitor|trend)\b/.test(normalized)
}

function isBroadRankingQuestion(normalized: string) {
  return /\b(top\s*(1|one)?\s*(sku|product|asin|scanner)|fastest mover|competitors doing|worried about|market leader)\b/.test(
    normalized
  )
}

function resolveScope(params: {
  normalizedMessage: string
  matchedBrands: string[]
  targetBrand?: string
  parsedQuery?: ParsedQuery
}): ResolvedScope {
  const explicit = unique(params.parsedQuery?.plan.scopeBrands ?? params.matchedBrands)
  if (explicit.length) {
    return {
      mode: "explicit_brand",
      brands: explicit,
      source: "Question contains explicit brand reference.",
    }
  }

  const normalizedTarget = normalize(params.targetBrand ?? "")
  if (normalizedTarget) {
    return {
      mode: "target_brand",
      brands: [normalizedTarget],
      source: "Quick-action target brand context.",
    }
  }

  if (params.parsedQuery?.plan.includeOwnBrands || /\b(our|ours|we|us)\b/.test(params.normalizedMessage)) {
    return {
      mode: "own_brands",
      brands: ["innova", "blcktec"],
      source: "Own-brand language in question.",
    }
  }

  return {
    mode: "all_brands",
    brands: [],
    source: "No brand scope specified; using market-wide scope.",
  }
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function dedupeEntitySources(sources: EntitySourceHit[]) {
  const deduped = new Map<string, EntitySourceHit>()
  for (const source of sources) {
    const key = `${source.entity}:${normalize(source.value)}:${source.source}`
    if (!deduped.has(key)) {
      deduped.set(key, source)
    }
  }
  return Array.from(deduped.values())
}
