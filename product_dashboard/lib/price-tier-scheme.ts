/**
 * Code-reader price-tier schemes (single source of truth for the dashboard).
 *
 * Mirrors `Amazon_Monthly_Competitor_Report copy/script/price_tier_scheme.py`:
 * each tier is a product-type filter plus a half-open price range [low, high)
 * (a boundary price lands in the UPPER bucket; high=null is open-ended).
 *
 * Scheme V1 (report months before 202610; payloads keep these keys forever):
 *   Tablet $800+ | Tablet $400-$800 | Tablet $400- | Total Tablet |
 *   Handheld $75+ | Handheld $75- | Total Handheld |
 *   Total Dongle | Total Other Tools | Total
 *
 * Scheme V2 (report month 202610 onward, analyst decision 2026-11-03):
 *   Tablet $800+ | Tablet $400-$800 | Tablet $400- |
 *       Tablet $300+ ($300-$400) | Tablet $200-$300 | Tablet $200- |
 *   Total Tablet |
 *   Handheld $100+ | Handheld $100- |
 *       Handheld $65+ ($65-$100) | Handheld $35-$65 | Handheld $35- |
 *   Total Handheld | Total Dongle | Total Other Tools | Total
 *
 * Labels are verbatim analyst wording ("Tablet $300+" means $300-$400). Every
 * label maps to exactly one scope key; keys never collide across schemes, and
 * a key shared by both schemes (e.g. tablet_under_400) means the same range.
 * New-scheme tiers get NEW keys — history is never spliced across the switch.
 *
 * Pure module (no React, no Node APIs) so server parsers, client components,
 * scripts and node:test can all import it.
 */

export const PRICE_TIER_V2_START_MONTH = "202610"

export type PriceTierSchemeVersion = "v1" | "v2"
export type PriceTierKind = "tier" | "subtier" | "total" | "grand_total"
export type PriceTierTypeGroup = "tablet" | "handheld" | "dongle" | "other_tools" | "all"

export type PriceTierDefinition = {
  readonly key: string
  readonly label: string
  /** Parent tier key for a sub-tier; null for tiers and totals. */
  readonly parentKey: string | null
  readonly kind: PriceTierKind
  readonly typeGroup: PriceTierTypeGroup
  /** Inclusive lower bound (USD). */
  readonly low: number
  /** Exclusive upper bound (USD); null = open-ended. */
  readonly high: number | null
  /** CSS custom property holding the slice colour (null = never drawn as a slice). */
  readonly colorToken: string | null
}

export type PriceTierScheme = {
  readonly version: PriceTierSchemeVersion
  readonly tiers: readonly PriceTierDefinition[]
}

export type SchemeLike = PriceTierScheme | PriceTierSchemeVersion

export type PriceTierScopeOption = {
  value: string
  label: string
  /** 0 = scope/tier, 1 = sub-tier (rendered indented under its parent). */
  depth: 0 | 1
}

function tier(
  key: string,
  label: string,
  typeGroup: PriceTierTypeGroup,
  low: number,
  high: number | null,
  colorToken: string
): PriceTierDefinition {
  return { key, label, parentKey: null, kind: "tier", typeGroup, low, high, colorToken }
}

function subtier(
  key: string,
  label: string,
  parentKey: string,
  typeGroup: PriceTierTypeGroup,
  low: number,
  high: number,
  colorToken: string
): PriceTierDefinition {
  return { key, label, parentKey, kind: "subtier", typeGroup, low, high, colorToken }
}

function total(
  key: string,
  label: string,
  typeGroup: PriceTierTypeGroup,
  colorToken: string | null
): PriceTierDefinition {
  return {
    key,
    label,
    parentKey: null,
    kind: typeGroup === "all" ? "grand_total" : "total",
    typeGroup,
    low: 0,
    high: null,
    colorToken,
  }
}

const TABLET_800_PLUS = tier("tablet_800_plus", "Tablet $800+", "tablet", 800, null, "--color-tier-tablet-800-plus")
const TABLET_400_800 = tier("tablet_400_800", "Tablet $400-$800", "tablet", 400, 800, "--color-tier-tablet-400-800")
const TABLET_UNDER_400 = tier("tablet_under_400", "Tablet $400-", "tablet", 0, 400, "--color-tier-tablet-under-400")
const TABLET_300_400 = subtier("tablet_300_400", "Tablet $300+", "tablet_under_400", "tablet", 300, 400, "--color-tier-tablet-300-400")
const TABLET_200_300 = subtier("tablet_200_300", "Tablet $200-$300", "tablet_under_400", "tablet", 200, 300, "--color-tier-tablet-200-300")
const TABLET_UNDER_200 = subtier("tablet_under_200", "Tablet $200-", "tablet_under_400", "tablet", 0, 200, "--color-tier-tablet-under-200")
const TOTAL_TABLET = total("total_tablet", "Total Tablet", "tablet", null)

const HANDHELD_75_PLUS = tier("handheld_75_plus", "Handheld $75+", "handheld", 75, null, "--color-tier-handheld-75-plus")
const HANDHELD_UNDER_75 = tier("handheld_under_75", "Handheld $75-", "handheld", 0, 75, "--color-tier-handheld-under-75")
const HANDHELD_100_PLUS = tier("handheld_100_plus", "Handheld $100+", "handheld", 100, null, "--color-tier-handheld-100-plus")
const HANDHELD_UNDER_100 = tier("handheld_under_100", "Handheld $100-", "handheld", 0, 100, "--color-tier-handheld-under-100")
const HANDHELD_65_100 = subtier("handheld_65_100", "Handheld $65+", "handheld_under_100", "handheld", 65, 100, "--color-tier-handheld-65-100")
const HANDHELD_35_65 = subtier("handheld_35_65", "Handheld $35-$65", "handheld_under_100", "handheld", 35, 65, "--color-tier-handheld-35-65")
const HANDHELD_UNDER_35 = subtier("handheld_under_35", "Handheld $35-", "handheld_under_100", "handheld", 0, 35, "--color-tier-handheld-under-35")
const TOTAL_HANDHELD = total("total_handheld", "Total Handheld", "handheld", null)

const TOTAL_DONGLE = total("total_dongle", "Total Dongle", "dongle", "--color-tier-total-dongle")
const TOTAL_OTHER_TOOLS = total("total_other_tools", "Total Other Tools", "other_tools", "--color-tier-total-other-tools")
const GRAND_TOTAL = total("total", "Total", "all", null)

export const PRICE_TIER_SCHEME_V1: PriceTierScheme = {
  version: "v1",
  tiers: [
    TABLET_800_PLUS,
    TABLET_400_800,
    TABLET_UNDER_400,
    TOTAL_TABLET,
    HANDHELD_75_PLUS,
    HANDHELD_UNDER_75,
    TOTAL_HANDHELD,
    TOTAL_DONGLE,
    TOTAL_OTHER_TOOLS,
    GRAND_TOTAL,
  ],
}

export const PRICE_TIER_SCHEME_V2: PriceTierScheme = {
  version: "v2",
  tiers: [
    TABLET_800_PLUS,
    TABLET_400_800,
    TABLET_UNDER_400,
    TABLET_300_400,
    TABLET_200_300,
    TABLET_UNDER_200,
    TOTAL_TABLET,
    HANDHELD_100_PLUS,
    HANDHELD_UNDER_100,
    HANDHELD_65_100,
    HANDHELD_35_65,
    HANDHELD_UNDER_35,
    TOTAL_HANDHELD,
    TOTAL_DONGLE,
    TOTAL_OTHER_TOOLS,
    GRAND_TOTAL,
  ],
}

export const PRICE_TIER_SCHEMES: Record<PriceTierSchemeVersion, PriceTierScheme> = {
  v1: PRICE_TIER_SCHEME_V1,
  v2: PRICE_TIER_SCHEME_V2,
}

/** Every known definition (V1 then V2-only), unique by key. */
const ALL_DEFINITIONS: readonly PriceTierDefinition[] = (() => {
  const byKey = new Map<string, PriceTierDefinition>()
  for (const scheme of [PRICE_TIER_SCHEME_V1, PRICE_TIER_SCHEME_V2]) {
    for (const definition of scheme.tiers) {
      if (!byKey.has(definition.key)) byKey.set(definition.key, definition)
    }
  }
  return Array.from(byKey.values())
})()

const DEFINITION_BY_KEY = new Map(ALL_DEFINITIONS.map((definition) => [definition.key, definition]))

const V1_KEYS = new Set(PRICE_TIER_SCHEME_V1.tiers.map((definition) => definition.key))
const V2_KEYS = new Set(PRICE_TIER_SCHEME_V2.tiers.map((definition) => definition.key))
const V1_ONLY_KEYS = new Set([...V1_KEYS].filter((key) => !V2_KEYS.has(key)))
const V2_ONLY_KEYS = new Set([...V2_KEYS].filter((key) => !V1_KEYS.has(key)))

/**
 * Price-bucket labels matched by substring, longest first so "Tablet $400-$800"
 * wins over "Tablet $400-" and "Handheld $35-$65" over "Handheld $35-".
 * Whitespace is ignored on both sides.
 */
const PRICED_LABEL_MATCHERS = ALL_DEFINITIONS
  .filter((definition) => definition.kind === "tier" || definition.kind === "subtier")
  .map((definition) => ({ key: definition.key, needle: compactLabel(definition.label) }))
  .sort((a, b) => b.needle.length - a.needle.length)

/** Alphanumeric-only aliases for the type totals (tab names, block labels, legacy rows). */
const TOTAL_ALIASES: Record<string, string> = {
  totaltablet: "total_tablet",
  tablettotal: "total_tablet",
  tabletoverall: "total_tablet",
  tablets: "total_tablet",
  totalhandheld: "total_handheld",
  handheldtotal: "total_handheld",
  handheldoverall: "total_handheld",
  handheld: "total_handheld",
  totaldongle: "total_dongle",
  dongleoverall: "total_dongle",
  dongle: "total_dongle",
  dongles: "total_dongle",
  totalothertools: "total_other_tools",
  othertoolsoverall: "total_other_tools",
  othertools: "total_other_tools",
  total: "total",
}

function compactLabel(value: string) {
  return value.toLowerCase().replace(/\s+/g, "")
}

function alphanumeric(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function resolveScheme(scheme: SchemeLike): PriceTierScheme {
  return typeof scheme === "string" ? PRICE_TIER_SCHEMES[scheme] : scheme
}

/**
 * "202610" | 202610 | "2026-10" | "2026-10-31" -> "202610"; anything else -> null.
 */
export function normalizeMonthKey(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const text = String(value).trim()
  const compact = text.match(/^(\d{4})(\d{2})$/)
  if (compact) return `${compact[1]}${compact[2]}`
  const dashed = text.match(/^(\d{4})-(\d{2})(?:-\d{2})?(?:T.*)?$/)
  if (dashed) return `${dashed[1]}${dashed[2]}`
  return null
}

/** "v2" from PRICE_TIER_V2_START_MONTH onward, else "v1" (unknown month -> "v1"). */
export function schemeVersionForMonth(month: string | number | null | undefined): PriceTierSchemeVersion {
  const key = normalizeMonthKey(month)
  return key !== null && key >= PRICE_TIER_V2_START_MONTH ? "v2" : "v1"
}

export function schemeForMonth(month: string | number | null | undefined): PriceTierScheme {
  return PRICE_TIER_SCHEMES[schemeVersionForMonth(month)]
}

/**
 * Scheme for a parsed snapshot. The keys actually present win (a V2-only key
 * means V2, a V1-only key means V1 — e.g. a forced `--tier-scheme v2` preview
 * of an older month); with neither, the month gate decides.
 */
export function resolveSnapshotScheme(input: {
  snapshotDate?: string | null
  monthKey?: string | null
  scopeKeys?: Iterable<string>
}): PriceTierScheme {
  if (input.scopeKeys) {
    let hasV1Only = false
    for (const key of input.scopeKeys) {
      if (V2_ONLY_KEYS.has(key)) return PRICE_TIER_SCHEME_V2
      if (V1_ONLY_KEYS.has(key)) hasV1Only = true
    }
    if (hasV1Only) return PRICE_TIER_SCHEME_V1
  }
  return schemeForMonth(input.monthKey ?? input.snapshotDate ?? null)
}

/**
 * Exact scope key for a known tier/total label (or an already-canonical key);
 * null for anything else so callers can keep their own fallback.
 */
export function scopeKeyForLabel(label: string): string | null {
  const trimmed = label.trim()
  if (!trimmed) return null
  const lower = trimmed.toLowerCase()
  if (DEFINITION_BY_KEY.has(lower)) return lower

  const compact = compactLabel(trimmed)
  if (compact.includes("$")) {
    for (const matcher of PRICED_LABEL_MATCHERS) {
      if (compact.includes(matcher.needle)) return matcher.key
    }
    return null
  }

  return TOTAL_ALIASES[alphanumeric(trimmed)] ?? null
}

export function tierDefinition(key: string): PriceTierDefinition | undefined {
  return DEFINITION_BY_KEY.get(key)
}

export function isKnownPriceTierKey(key: string) {
  return DEFINITION_BY_KEY.has(key)
}

export function labelForKey(key: string): string | undefined {
  return DEFINITION_BY_KEY.get(key)?.label
}

export function parentOf(key: string): string | null {
  return DEFINITION_BY_KEY.get(key)?.parentKey ?? null
}

export function childrenOf(key: string, scheme: SchemeLike): string[] {
  return resolveScheme(scheme)
    .tiers.filter((definition) => definition.parentKey === key)
    .map((definition) => definition.key)
}

/** Every key of the scheme in scheme (= summary sheet) order. */
export function schemeKeys(scheme: SchemeLike): string[] {
  return resolveScheme(scheme).tiers.map((definition) => definition.key)
}

/** Every tier/sub-tier label any scheme has ever used (sheet names included). */
export function allPricedTierLabels(): string[] {
  return ALL_DEFINITIONS
    .filter((definition) => definition.kind === "tier" || definition.kind === "subtier")
    .map((definition) => definition.label)
}

/** Every total label any scheme has used ("Total Tablet", ..., "Total"). */
export function allTotalLabels(): string[] {
  return ALL_DEFINITIONS
    .filter((definition) => definition.kind === "total" || definition.kind === "grand_total")
    .map((definition) => definition.label)
}

/**
 * Finest non-overlapping price buckets (tiers/sub-tiers that are not a parent).
 * V1: 5 keys. V2: Tablet $800+, $400-$800, $300+, $200-$300, $200-,
 * Handheld $100+, $65+, $35-$65, $35-.
 */
export function leafKeys(scheme: SchemeLike): string[] {
  const tiers = resolveScheme(scheme).tiers
  const parents = new Set(tiers.flatMap((definition) => (definition.parentKey ? [definition.parentKey] : [])))
  return tiers
    .filter((definition) => (definition.kind === "tier" || definition.kind === "subtier") && !parents.has(definition.key))
    .map((definition) => definition.key)
}

/**
 * The finest tier buckets among the keys present: known tiers/sub-tiers,
 * minus any parent whose own sub-tiers are present. Rankings built on this
 * never list "Tablet $400-" beside "Tablet $300+"; V1 snapshots keep their
 * five tiers; a V2 parent whose sub-tier rows are missing stays in.
 */
export function finestPresentTierKeys(presentKeys: Iterable<string>, scheme: SchemeLike): Set<string> {
  const present = new Set(presentKeys)
  const resolved = resolveScheme(scheme)
  const output = new Set<string>()
  for (const key of present) {
    const definition = DEFINITION_BY_KEY.get(key)
    if (!definition) continue
    if (definition.kind !== "tier" && definition.kind !== "subtier") continue
    if (childrenOf(key, resolved).some((child) => present.has(child))) continue
    output.add(key)
  }
  return output
}

/**
 * The 7 mutually exclusive slices of the "All ASINs" pie: top-level price tiers
 * plus the type totals that have no price tiers (Dongle, Other Tools). Never
 * includes a sub-tier, so parents and children never share a pie.
 */
export function parentLevelKeys(scheme: SchemeLike): string[] {
  const tiers = resolveScheme(scheme).tiers
  const pricedGroups = new Set(tiers.filter((definition) => definition.kind === "tier").map((definition) => definition.typeGroup))
  return tiers
    .filter(
      (definition) =>
        definition.kind === "tier" ||
        (definition.kind === "total" && !pricedGroups.has(definition.typeGroup))
    )
    .map((definition) => definition.key)
}

const TYPE_TOTAL_KEYS: Partial<Record<PriceTierTypeGroup, string>> = {
  tablet: "total_tablet",
  handheld: "total_handheld",
  dongle: "total_dongle",
  other_tools: "total_other_tools",
}

export function typeTotalKey(typeGroup: PriceTierTypeGroup): string | undefined {
  return TYPE_TOTAL_KEYS[typeGroup]
}

/**
 * Keys whose rows make up the price-tier pie for a scope, never mixing a
 * parent with its own sub-tiers:
 *   all_asins            -> parentLevelKeys (7)
 *   total_<type>         -> that type's top-level tiers (or the total itself for Dongle/Other)
 *   a tier with children -> its sub-tiers (e.g. Tablet $400- -> $300+, $200-$300, $200-)
 *   any other key        -> itself
 */
export function pieKeysForScope(scope: string, scheme: SchemeLike): string[] {
  const resolved = resolveScheme(scheme)
  if (scope === "all_asins") return parentLevelKeys(resolved)

  const definition = DEFINITION_BY_KEY.get(scope)
  if (definition?.kind === "total") {
    const tiers = resolved.tiers
      .filter((item) => item.kind === "tier" && item.typeGroup === definition.typeGroup)
      .map((item) => item.key)
    return tiers.length ? tiers : [scope]
  }

  const children = childrenOf(scope, resolved)
  return children.length ? children : [scope]
}

/**
 * True when a scope's pie keys partition the scope's own row — a type total
 * with price tiers (Total Tablet, Total Handheld) or a V2 parent tier
 * (Tablet $400-, Handheld $100-). Its slices read as 100% of that row, so a
 * missing slice row must blank the pie instead of drawing a partial one.
 * All ASINs and single-row scopes (Total Dongle, a leaf tier) are not.
 */
export function isPartitionScope(scope: string, scheme: SchemeLike): boolean {
  if (scope === "all_asins") return false
  const keys = pieKeysForScope(scope, scheme)
  return !(keys.length === 1 && keys[0] === scope)
}

/**
 * Rows for a "type scope breakdown" table in scheme order: all keys for
 * all_asins, a type's tiers + sub-tiers + total for total_<type>, a parent and
 * its sub-tiers for a parent tier, otherwise just the key.
 */
export function breakdownKeysForScope(scope: string, scheme: SchemeLike): string[] {
  const resolved = resolveScheme(scheme)
  if (scope === "all_asins") return schemeKeys(resolved)

  const definition = DEFINITION_BY_KEY.get(scope)
  if (definition?.kind === "total") {
    return resolved.tiers
      .filter((item) => item.typeGroup === definition.typeGroup)
      .map((item) => item.key)
  }

  const children = childrenOf(scope, resolved)
  return children.length ? [scope, ...children] : [scope]
}

function hasKey(presentKeys: ReadonlySet<string> | undefined, key: string) {
  return !presentKeys || presentKeys.has(key)
}

/**
 * Dashboard "Price tier mix" scope options (Option A): All ASINs, each type
 * total, and — directly after its type total — every tier that has sub-tiers
 * (V2: "Tablet $400-", "Handheld $100-"). With presentKeys, options whose rows
 * are missing from the snapshot are dropped; a parent tier is offered only
 * when its own row AND every sub-tier row are present (zero-revenue rows
 * count as present), so its pie always adds up to the parent.
 */
export function dashboardScopeOptions(
  scheme: SchemeLike,
  presentKeys?: ReadonlySet<string>
): PriceTierScopeOption[] {
  const resolved = resolveScheme(scheme)
  const options: PriceTierScopeOption[] = [{ value: "all_asins", label: "All ASINs", depth: 0 }]

  for (const definition of resolved.tiers) {
    if (definition.kind === "total") {
      if (hasKey(presentKeys, definition.key)) {
        options.push({ value: definition.key, label: definition.label, depth: 0 })
      }
      continue
    }
    if (definition.kind !== "tier") continue
    const children = childrenOf(definition.key, resolved)
    if (!children.length) continue
    if (!hasKey(presentKeys, definition.key)) continue
    if (presentKeys && !children.every((child) => presentKeys.has(child))) continue
    options.push({ value: definition.key, label: definition.label, depth: 1 })
  }

  // Parent scopes are emitted before their type total in scheme order; move
  // each one to sit right after its total.
  const ordered: PriceTierScopeOption[] = []
  for (const option of options) {
    if (option.depth === 1) continue
    ordered.push(option)
    const definition = DEFINITION_BY_KEY.get(option.value)
    if (definition?.kind !== "total") continue
    for (const child of options) {
      if (child.depth !== 1) continue
      if (DEFINITION_BY_KEY.get(child.value)?.typeGroup === definition.typeGroup) ordered.push(child)
    }
  }
  return ordered
}

const TYPE_TIER_ALL_LABELS: Partial<Record<PriceTierTypeGroup, string>> = {
  tablet: "All tablet tiers",
  handheld: "All handheld tiers",
}

/**
 * Types page tier dropdown for Total Tablet / Total Handheld: "All <type>
 * tiers" (the type total) followed by every tier and sub-tier of the scheme
 * in scheme order. With presentKeys, tiers missing from the snapshot are
 * dropped so each month shows only the tiers it actually has: a missing
 * sub-tier is simply not listed while its parent stays (the parent's pie
 * then blanks — see isPartitionScope — rather than drawing a partial pie).
 */
export function typeTierOptions(
  typeGroup: "tablet" | "handheld",
  scheme: SchemeLike,
  presentKeys?: ReadonlySet<string>
): PriceTierScopeOption[] {
  const totalKey = TYPE_TOTAL_KEYS[typeGroup]!
  const options: PriceTierScopeOption[] = [
    { value: totalKey, label: TYPE_TIER_ALL_LABELS[typeGroup]!, depth: 0 },
  ]
  for (const definition of resolveScheme(scheme).tiers) {
    if (definition.typeGroup !== typeGroup) continue
    if (definition.kind !== "tier" && definition.kind !== "subtier") continue
    if (!hasKey(presentKeys, definition.key)) continue
    options.push({
      value: definition.key,
      label: definition.label,
      depth: definition.kind === "subtier" ? 1 : 0,
    })
  }
  return options
}

/** Both option sets for a scheme (card scopes + Types page tier dropdowns). */
export function scopeOptions(scheme: SchemeLike, presentKeys?: ReadonlySet<string>) {
  return {
    dashboard: dashboardScopeOptions(scheme, presentKeys),
    tablet: typeTierOptions("tablet", scheme, presentKeys),
    handheld: typeTierOptions("handheld", scheme, presentKeys),
  }
}

/**
 * Slice colour for a key: `var(--color-tier-*)`. Sub-tiers use shades of
 * their parent's hue (Tablet $400- amber, Handheld $100- yellow), and the V2
 * Handheld $100+/$100- keep the V1 Handheld $75+/$75- green/yellow roles.
 */
export function priceTierColor(key: string): string | undefined {
  const token = DEFINITION_BY_KEY.get(key)?.colorToken
  return token ? `var(${token})` : undefined
}

/** True when the price falls in the tier's [low, high) range. */
export function priceInTier(definition: PriceTierDefinition, price: number) {
  if (!Number.isFinite(price)) return false
  if (price < definition.low) return false
  return definition.high === null || price < definition.high
}

/**
 * Additive payload annotation for a parsed metric row (known keys only), so
 * stored snapshots carry the hierarchy without consumers re-deriving it.
 */
export function priceTierAnnotation(key: string): { parentKey: string | null; kind: PriceTierKind } | null {
  const definition = DEFINITION_BY_KEY.get(key)
  if (!definition) return null
  return { parentKey: definition.parentKey, kind: definition.kind }
}
