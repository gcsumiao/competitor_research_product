import assert from "node:assert/strict"
import test from "node:test"

import {
  breakdownKeysForScope,
  PRICE_TIER_SCHEME_V1,
  PRICE_TIER_SCHEME_V2,
  PRICE_TIER_V2_START_MONTH,
  childrenOf,
  dashboardScopeOptions,
  finestPresentTierKeys,
  isPartitionScope,
  labelForKey,
  leafKeys,
  normalizeMonthKey,
  parentLevelKeys,
  parentOf,
  pieKeysForScope,
  priceInTier,
  priceTierColor,
  resolveSnapshotScheme,
  schemeForMonth,
  schemeVersionForMonth,
  scopeKeyForLabel,
  tierDefinition,
  typeTierOptions,
} from "../lib/price-tier-scheme.ts"

const V1_LABELS_TO_KEYS: Array<[string, string]> = [
  ["Tablet $800+", "tablet_800_plus"],
  ["Tablet $400-$800", "tablet_400_800"],
  ["Tablet $400-", "tablet_under_400"],
  ["Total Tablet", "total_tablet"],
  ["Handheld $75+", "handheld_75_plus"],
  ["Handheld $75-", "handheld_under_75"],
  ["Total Handheld", "total_handheld"],
  ["Total Dongle", "total_dongle"],
  ["Total Other Tools", "total_other_tools"],
  ["Total", "total"],
]

const V2_LABELS_TO_KEYS: Array<[string, string]> = [
  ["Tablet $800+", "tablet_800_plus"],
  ["Tablet $400-$800", "tablet_400_800"],
  ["Tablet $400-", "tablet_under_400"],
  ["Tablet $300+", "tablet_300_400"],
  ["Tablet $200-$300", "tablet_200_300"],
  ["Tablet $200-", "tablet_under_200"],
  ["Total Tablet", "total_tablet"],
  ["Handheld $100+", "handheld_100_plus"],
  ["Handheld $100-", "handheld_under_100"],
  ["Handheld $65+", "handheld_65_100"],
  ["Handheld $35-$65", "handheld_35_65"],
  ["Handheld $35-", "handheld_under_35"],
  ["Total Handheld", "total_handheld"],
  ["Total Dongle", "total_dongle"],
  ["Total Other Tools", "total_other_tools"],
  ["Total", "total"],
]

test("scheme label order and keys mirror price_tier_scheme.py", () => {
  assert.deepEqual(
    PRICE_TIER_SCHEME_V1.tiers.map((tier) => [tier.label, tier.key]),
    V1_LABELS_TO_KEYS
  )
  assert.deepEqual(
    PRICE_TIER_SCHEME_V2.tiers.map((tier) => [tier.label, tier.key]),
    V2_LABELS_TO_KEYS
  )
})

test("scopeKeyForLabel maps every V1 and V2 label to its exact key", () => {
  for (const [label, key] of [...V1_LABELS_TO_KEYS, ...V2_LABELS_TO_KEYS]) {
    assert.equal(scopeKeyForLabel(label), key, label)
    // Case and whitespace noise from hand-edited sheets.
    assert.equal(scopeKeyForLabel(`  ${label.toUpperCase()} `), key, `${label} (upper)`)
    // Keys are already canonical.
    assert.equal(scopeKeyForLabel(key), key, `${key} (key passthrough)`)
    assert.equal(labelForKey(key), label)
  }
})

test("scope keys are unique within and across schemes (no $ +/- collisions)", () => {
  for (const scheme of [PRICE_TIER_SCHEME_V1, PRICE_TIER_SCHEME_V2]) {
    const keys = scheme.tiers.map((tier) => scopeKeyForLabel(tier.label))
    assert.equal(new Set(keys).size, keys.length, `${scheme.version} keys collide`)
  }
  const labelByKey = new Map<string, string>()
  for (const [label, key] of [...V1_LABELS_TO_KEYS, ...V2_LABELS_TO_KEYS]) {
    const existing = labelByKey.get(key)
    assert.ok(existing === undefined || existing === label, `${key} maps to ${existing} and ${label}`)
    labelByKey.set(key, label)
  }
  // 10 V1 + 16 V2 labels, 10 shared -> 18 distinct keys. The old normalizer
  // folded these pairs together.
  assert.equal(labelByKey.size, 18)
  assert.notEqual(scopeKeyForLabel("Handheld $100+"), scopeKeyForLabel("Handheld $100-"))
  assert.notEqual(scopeKeyForLabel("Handheld $75+"), scopeKeyForLabel("Handheld $75-"))
  assert.notEqual(scopeKeyForLabel("Tablet $200-"), scopeKeyForLabel("Tablet $200-$300"))
  assert.notEqual(scopeKeyForLabel("Handheld $35-"), scopeKeyForLabel("Handheld $35-$65"))
})

test("scopeKeyForLabel keeps legacy total aliases and rejects unknown labels", () => {
  assert.equal(scopeKeyForLabel("Tablet Total"), "total_tablet")
  assert.equal(scopeKeyForLabel("Tablet Overall"), "total_tablet")
  assert.equal(scopeKeyForLabel("Handheld"), "total_handheld")
  assert.equal(scopeKeyForLabel("Dongle"), "total_dongle")
  assert.equal(scopeKeyForLabel("Other Tools"), "total_other_tools")
  assert.equal(scopeKeyForLabel("Top 50"), null)
  assert.equal(scopeKeyForLabel("Autel"), null)
  assert.equal(scopeKeyForLabel("Handheld $50+"), null)
  assert.equal(scopeKeyForLabel(""), null)
})

test("month gate: 202609 -> V1, 202610 onward -> V2", () => {
  assert.equal(PRICE_TIER_V2_START_MONTH, "202610")
  assert.equal(schemeVersionForMonth("202609"), "v1")
  assert.equal(schemeVersionForMonth("202610"), "v2")
  assert.equal(schemeVersionForMonth("202701"), "v2")
  assert.equal(schemeVersionForMonth(202610), "v2")
  assert.equal(schemeVersionForMonth("2026-09-30"), "v1")
  assert.equal(schemeVersionForMonth("2026-10-31"), "v2")
  assert.equal(schemeVersionForMonth(null), "v1")
  assert.equal(schemeVersionForMonth("bogus"), "v1")
  assert.equal(schemeForMonth("202609"), PRICE_TIER_SCHEME_V1)
  assert.equal(schemeForMonth("202610"), PRICE_TIER_SCHEME_V2)
  assert.equal(normalizeMonthKey("2026-10"), "202610")
})

test("resolveSnapshotScheme trusts the keys present, then the month", () => {
  assert.equal(
    resolveSnapshotScheme({ snapshotDate: "2026-09-30", scopeKeys: ["handheld_100_plus"] }).version,
    "v2"
  )
  assert.equal(
    resolveSnapshotScheme({ snapshotDate: "2026-10-31", scopeKeys: ["handheld_75_plus"] }).version,
    "v1"
  )
  assert.equal(
    resolveSnapshotScheme({ snapshotDate: "2026-10-31", scopeKeys: ["tablet_800_plus", "total"] }).version,
    "v2"
  )
  assert.equal(resolveSnapshotScheme({ snapshotDate: "2026-09-30" }).version, "v1")
})

test("hierarchy helpers: parents, children, leaves and the 7 pie keys", () => {
  assert.deepEqual(childrenOf("tablet_under_400", "v2"), [
    "tablet_300_400",
    "tablet_200_300",
    "tablet_under_200",
  ])
  assert.deepEqual(childrenOf("handheld_under_100", "v2"), [
    "handheld_65_100",
    "handheld_35_65",
    "handheld_under_35",
  ])
  assert.deepEqual(childrenOf("tablet_under_400", "v1"), [])
  assert.equal(parentOf("tablet_200_300"), "tablet_under_400")
  assert.equal(parentOf("handheld_under_35"), "handheld_under_100")
  assert.equal(parentOf("tablet_under_400"), null)

  assert.deepEqual(leafKeys("v1"), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
    "handheld_75_plus",
    "handheld_under_75",
  ])
  assert.deepEqual(leafKeys("v2"), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_300_400",
    "tablet_200_300",
    "tablet_under_200",
    "handheld_100_plus",
    "handheld_65_100",
    "handheld_35_65",
    "handheld_under_35",
  ])

  assert.deepEqual(parentLevelKeys("v1"), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
    "handheld_75_plus",
    "handheld_under_75",
    "total_dongle",
    "total_other_tools",
  ])
  assert.deepEqual(parentLevelKeys("v2"), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
    "handheld_100_plus",
    "handheld_under_100",
    "total_dongle",
    "total_other_tools",
  ])
})

test("sub-tiers partition their parent's [low, high) range", () => {
  for (const scheme of [PRICE_TIER_SCHEME_V1, PRICE_TIER_SCHEME_V2]) {
    for (const parent of scheme.tiers) {
      const children = childrenOf(parent.key, scheme).map((key) => tierDefinition(key)!)
      if (!children.length) continue
      const sorted = [...children].sort((a, b) => a.low - b.low)
      assert.equal(sorted[0].low, parent.low)
      assert.equal(sorted[sorted.length - 1].high, parent.high)
      for (let index = 1; index < sorted.length; index += 1) {
        assert.equal(sorted[index].low, sorted[index - 1].high)
      }
    }
  }
  // Boundary prices land in the upper bucket.
  assert.equal(priceInTier(tierDefinition("tablet_400_800")!, 400), true)
  assert.equal(priceInTier(tierDefinition("tablet_under_400")!, 400), false)
  assert.equal(priceInTier(tierDefinition("handheld_100_plus")!, 100), true)
  assert.equal(priceInTier(tierDefinition("handheld_65_100")!, 65), true)
  assert.equal(priceInTier(tierDefinition("handheld_35_65")!, 64.99), true)
  assert.equal(priceInTier(tierDefinition("handheld_under_35")!, 35), false)
})

test("pieKeysForScope never mixes a parent with its sub-tiers", () => {
  assert.deepEqual(pieKeysForScope("all_asins", "v2"), parentLevelKeys("v2"))
  assert.deepEqual(pieKeysForScope("total_tablet", "v2"), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
  ])
  assert.deepEqual(pieKeysForScope("total_handheld", "v2"), [
    "handheld_100_plus",
    "handheld_under_100",
  ])
  assert.deepEqual(pieKeysForScope("total_handheld", "v1"), [
    "handheld_75_plus",
    "handheld_under_75",
  ])
  assert.deepEqual(pieKeysForScope("tablet_under_400", "v2"), childrenOf("tablet_under_400", "v2"))
  assert.deepEqual(pieKeysForScope("handheld_under_100", "v2"), childrenOf("handheld_under_100", "v2"))
  assert.deepEqual(pieKeysForScope("tablet_under_400", "v1"), ["tablet_under_400"])
  assert.deepEqual(pieKeysForScope("total_dongle", "v2"), ["total_dongle"])

  for (const scope of ["all_asins", "total_tablet", "total_handheld", "tablet_under_400", "handheld_under_100"]) {
    const keys = pieKeysForScope(scope, "v2")
    for (const key of keys) {
      const parent = parentOf(key)
      assert.ok(!parent || !keys.includes(parent), `${scope} pie mixes ${key} with ${parent}`)
    }
  }
})

test("dashboard scope options: V1 has the 5 legacy scopes, V2 adds the two parent scopes", () => {
  assert.deepEqual(
    dashboardScopeOptions("v1").map((option) => option.label),
    ["All ASINs", "Total Tablet", "Total Handheld", "Total Dongle", "Total Other Tools"]
  )
  assert.deepEqual(
    dashboardScopeOptions("v2").map((option) => [option.value, option.label]),
    [
      ["all_asins", "All ASINs"],
      ["total_tablet", "Total Tablet"],
      ["tablet_under_400", "Tablet $400-"],
      ["total_handheld", "Total Handheld"],
      ["handheld_under_100", "Handheld $100-"],
      ["total_dongle", "Total Dongle"],
      ["total_other_tools", "Total Other Tools"],
    ]
  )
  // Parent scopes need their own row and EVERY sub-tier row.
  const withoutChildren = new Set(["total_tablet", "tablet_under_400", "total_handheld", "handheld_under_100"])
  assert.deepEqual(
    dashboardScopeOptions("v2", withoutChildren).map((option) => option.value),
    ["all_asins", "total_tablet", "total_handheld"]
  )
  const allV2 = PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.key)
  const missingOneChild = new Set(allV2.filter((key) => key !== "tablet_200_300"))
  assert.deepEqual(
    dashboardScopeOptions("v2", missingOneChild).map((option) => option.value),
    ["all_asins", "total_tablet", "total_handheld", "handheld_under_100", "total_dongle", "total_other_tools"]
  )
  const missingParent = new Set(allV2.filter((key) => key !== "handheld_under_100"))
  assert.ok(!dashboardScopeOptions("v2", missingParent).some((option) => option.value === "handheld_under_100"))
})

test("isPartitionScope: type totals with tiers and V2 parents only", () => {
  for (const scope of ["total_tablet", "total_handheld", "tablet_under_400", "handheld_under_100"]) {
    assert.equal(isPartitionScope(scope, "v2"), true, scope)
  }
  for (const scope of ["all_asins", "total_dongle", "total_other_tools", "tablet_300_400", "tablet_800_plus"]) {
    assert.equal(isPartitionScope(scope, "v2"), false, scope)
  }
  assert.equal(isPartitionScope("total_tablet", "v1"), true)
  // V1 Tablet $400- has no sub-tiers: its pie is just itself.
  assert.equal(isPartitionScope("tablet_under_400", "v1"), false)
})

test("Types tier dropdowns list sub-tiers and follow the keys present", () => {
  assert.deepEqual(
    typeTierOptions("tablet", "v2").map((option) => [option.label, option.depth]),
    [
      ["All tablet tiers", 0],
      ["Tablet $800+", 0],
      ["Tablet $400-$800", 0],
      ["Tablet $400-", 0],
      ["Tablet $300+", 1],
      ["Tablet $200-$300", 1],
      ["Tablet $200-", 1],
    ]
  )
  assert.deepEqual(
    typeTierOptions("handheld", "v2").map((option) => option.label),
    ["All handheld tiers", "Handheld $100+", "Handheld $100-", "Handheld $65+", "Handheld $35-$65", "Handheld $35-"]
  )
  assert.deepEqual(
    typeTierOptions("handheld", "v1").map((option) => option.label),
    ["All handheld tiers", "Handheld $75+", "Handheld $75-"]
  )
  const present = new Set(["total_handheld", "handheld_100_plus", "handheld_under_100"])
  assert.deepEqual(
    typeTierOptions("handheld", "v2", present).map((option) => option.value),
    ["total_handheld", "handheld_100_plus", "handheld_under_100"]
  )
  // A missing sub-tier is simply not listed; its parent stays.
  const missingOneChild = new Set(
    PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.key).filter((key) => key !== "tablet_200_300")
  )
  assert.deepEqual(
    typeTierOptions("tablet", "v2", missingOneChild).map((option) => [option.value, option.depth]),
    [
      ["total_tablet", 0],
      ["tablet_800_plus", 0],
      ["tablet_400_800", 0],
      ["tablet_under_400", 0],
      ["tablet_300_400", 1],
      ["tablet_under_200", 1],
    ]
  )
})

test("every drawable tier has a colour token; sub-tiers share the parent's family", () => {
  for (const scheme of [PRICE_TIER_SCHEME_V1, PRICE_TIER_SCHEME_V2]) {
    for (const key of [...parentLevelKeys(scheme), ...leafKeys(scheme)]) {
      assert.match(priceTierColor(key) ?? "", /^var\(--color-tier-[a-z0-9-]+\)$/, key)
    }
  }
  assert.equal(priceTierColor("handheld_75_plus"), "var(--color-tier-handheld-75-plus)")
  assert.equal(priceTierColor("total_tablet"), undefined)
  assert.equal(priceTierColor("unknown_key"), undefined)
  const colours = new Set(PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.colorToken).filter(Boolean))
  assert.equal(colours.size, 13)
})

test("breakdownKeysForScope lists a type's tiers with sub-tiers under their parent", () => {
  assert.deepEqual(breakdownKeysForScope("all_asins", "v1"), PRICE_TIER_SCHEME_V1.tiers.map((tier) => tier.key))
  assert.deepEqual(breakdownKeysForScope("total_tablet", "v1"), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
    "total_tablet",
  ])
  assert.deepEqual(breakdownKeysForScope("total_handheld", "v2"), [
    "handheld_100_plus",
    "handheld_under_100",
    "handheld_65_100",
    "handheld_35_65",
    "handheld_under_35",
    "total_handheld",
  ])
  assert.deepEqual(breakdownKeysForScope("tablet_under_400", "v2"), [
    "tablet_under_400",
    "tablet_300_400",
    "tablet_200_300",
    "tablet_under_200",
  ])
  assert.deepEqual(breakdownKeysForScope("tablet_200_300", "v2"), ["tablet_200_300"])
  assert.deepEqual(breakdownKeysForScope("total_dongle", "v2"), ["total_dongle"])
})

test("finestPresentTierKeys drops a parent only when its own sub-tiers are present", () => {
  const v2All = PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.key)
  assert.deepEqual([...finestPresentTierKeys(v2All, "v2")].sort(), leafKeys("v2").sort())
  const v1All = PRICE_TIER_SCHEME_V1.tiers.map((tier) => tier.key)
  assert.deepEqual([...finestPresentTierKeys(v1All, "v1")].sort(), leafKeys("v1").sort())
  // Sub-tier rows missing (e.g. all-zero rows dropped by the parser): keep the parent.
  const partial = v2All.filter((key) => !["handheld_65_100", "handheld_35_65", "handheld_under_35"].includes(key))
  const finest = finestPresentTierKeys(partial, "v2")
  assert.ok(finest.has("handheld_under_100"))
  assert.ok(!finest.has("tablet_under_400"))
  assert.ok(!finest.has("total_tablet"))
})
