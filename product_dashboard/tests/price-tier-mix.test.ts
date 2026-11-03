import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import path from "node:path"
import test from "node:test"
import { fileURLToPath } from "node:url"

import type { SnapshotSummary, TypeBreakdownMetric } from "../lib/competitor-data.ts"
import {
  buildPriceScopeOptions,
  buildPriceTierItems,
  findPriceScopeMetric,
} from "../lib/price-tier-mix.ts"
import {
  PRICE_TIER_SCHEME_V1,
  PRICE_TIER_SCHEME_V2,
  parentOf,
} from "../lib/price-tier-scheme.ts"

type Snapshot = Pick<SnapshotSummary, "date" | "priceTiers" | "typeBreakdowns">

function metric(scopeKey: string, label: string, revenue: number, units: number): TypeBreakdownMetric {
  return {
    scopeKey,
    label,
    avgPrice: units ? revenue / units : 0,
    avgPriceMoM: null,
    avgPriceYoY: null,
    units,
    unitsShare: 0,
    unitsMoM: 0.02,
    unitsYoY: 0.03,
    revenue,
    revenueShare: 0,
    revenueMoM: scopeKey.length / 100,
    revenueYoY: -scopeKey.length / 100,
  }
}

// Revenue/units per label; sub-tiers sum exactly to their parent.
const V2_VALUES: Record<string, [number, number]> = {
  tablet_800_plus: [3_687_274, 2_492],
  tablet_400_800: [7_154_103, 12_672],
  tablet_under_400: [6_427_490, 29_864],
  tablet_300_400: [1_894_200, 5_463],
  tablet_200_300: [1_792_840, 7_692],
  tablet_under_200: [2_740_450, 16_709],
  total_tablet: [17_268_867, 45_028],
  handheld_100_plus: [3_185_876, 15_440],
  handheld_under_100: [3_879_200, 113_650],
  handheld_65_100: [746_990, 9_641],
  handheld_35_65: [1_239_310, 23_987],
  handheld_under_35: [1_892_900, 80_022],
  total_handheld: [7_065_076, 129_090],
  total_dongle: [5_323_870, 71_442],
  total_other_tools: [4_447_720, 66_848],
  total: [34_105_533, 312_408],
}

function v2Snapshot(): Snapshot {
  return {
    date: "2026-10-31",
    priceTiers: [],
    typeBreakdowns: {
      allAsins: PRICE_TIER_SCHEME_V2.tiers.map((tier) => {
        const [revenue, units] = V2_VALUES[tier.key]
        return metric(tier.key, tier.label, revenue, units)
      }),
      top50: [],
      categoryBrandMix: [],
      source: "summary",
    },
  }
}

function v1Snapshot(): Snapshot {
  return {
    date: "2026-09-30",
    priceTiers: [],
    typeBreakdowns: {
      allAsins: PRICE_TIER_SCHEME_V1.tiers.map((tier, index) =>
        metric(tier.key, tier.label, 1_000_000 + index, 1_000 + index)
      ),
      top50: [],
      categoryBrandMix: [],
      source: "analysis",
    },
  }
}

function keysOf(rows: Array<{ scopeKey: string }>) {
  return rows.map((row) => row.scopeKey)
}

test("V2 snapshot: card scopes add Tablet $400- and Handheld $100- after their totals", () => {
  assert.deepEqual(
    buildPriceScopeOptions(v2Snapshot()).map((option) => option.label),
    [
      "All ASINs",
      "Total Tablet",
      "Tablet $400-",
      "Total Handheld",
      "Handheld $100-",
      "Total Dongle",
      "Total Other Tools",
    ]
  )
})

test("V2 snapshot: All ASINs pie is the 7 parent-level slices", () => {
  const rows = buildPriceTierItems(v2Snapshot(), "all_asins")
  assert.deepEqual(keysOf(rows), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
    "handheld_100_plus",
    "handheld_under_100",
    "total_dongle",
    "total_other_tools",
  ])
  const pieRevenue = rows.reduce((sum, row) => sum + row.revenue, 0)
  assert.equal(pieRevenue, V2_VALUES.total[0])
})

test("V2 snapshot: a parent scope pie shows only its three sub-tiers, summing to the parent", () => {
  const snapshot = v2Snapshot()
  for (const [scope, children] of [
    ["tablet_under_400", ["tablet_300_400", "tablet_200_300", "tablet_under_200"]],
    ["handheld_under_100", ["handheld_65_100", "handheld_35_65", "handheld_under_35"]],
  ] as const) {
    const rows = buildPriceTierItems(snapshot, scope)
    assert.deepEqual(keysOf(rows), children)
    assert.equal(rows.reduce((sum, row) => sum + row.revenue, 0), V2_VALUES[scope][0])
    assert.equal(rows.reduce((sum, row) => sum + row.units, 0), V2_VALUES[scope][1])

    // The headline (total, MoM, YoY) comes from the parent's own sheet row.
    const headline = findPriceScopeMetric(snapshot, scope, rows)
    assert.equal(headline?.scopeKey, scope)
    assert.equal(headline?.revenue, V2_VALUES[scope][0])
    assert.equal(headline?.revenueMoM, scope.length / 100)
  }
})

test("V2 snapshot: type totals keep their parent-level tiers, never a parent beside its children", () => {
  const snapshot = v2Snapshot()
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "total_tablet")), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
  ])
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "total_handheld")), [
    "handheld_100_plus",
    "handheld_under_100",
  ])
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "total_dongle")), ["total_dongle"])

  for (const option of buildPriceScopeOptions(snapshot)) {
    const keys = keysOf(buildPriceTierItems(snapshot, option.value))
    assert.ok(keys.length > 0, option.value)
    for (const key of keys) {
      const parent = parentOf(key)
      assert.ok(!parent || !keys.includes(parent), `${option.value} mixes ${key} with ${parent}`)
    }
  }
  assert.equal(findPriceScopeMetric(snapshot, "all_asins", [])?.scopeKey, "total")
})

test("V1 snapshot: unchanged 5 scopes and the $75 handheld split", () => {
  const snapshot = v1Snapshot()
  assert.deepEqual(
    buildPriceScopeOptions(snapshot).map((option) => option.value),
    ["all_asins", "total_tablet", "total_handheld", "total_dongle", "total_other_tools"]
  )
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "all_asins")), [
    "tablet_800_plus",
    "tablet_400_800",
    "tablet_under_400",
    "handheld_75_plus",
    "handheld_under_75",
    "total_dongle",
    "total_other_tools",
  ])
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "total_handheld")), [
    "handheld_75_plus",
    "handheld_under_75",
  ])
  // A stale V2-only scope yields no rows (and is not offered, so the card
  // falls back to options[0]); Tablet $400- has no sub-tiers in V1.
  assert.deepEqual(buildPriceTierItems(snapshot, "handheld_under_100"), [])
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "tablet_under_400")), ["tablet_under_400"])
})

test("snapshots without type breakdowns keep the label-based priceTiers", () => {
  const snapshot: Snapshot = {
    date: "2026-10-31",
    priceTiers: [
      { label: "$0-40", revenue: 10, share: 0.5 },
      { label: "$40-60", revenue: 10, share: 0.5 },
    ],
    typeBreakdowns: undefined,
  }
  assert.deepEqual(buildPriceScopeOptions(snapshot).map((option) => option.value), ["all_asins"])
  assert.deepEqual(keysOf(buildPriceTierItems(snapshot, "all_asins")), ["_0_40", "_40_60"])
  assert.equal(findPriceScopeMetric(snapshot, "all_asins", []), undefined)
})

test("globals.css defines every tier colour token in light and dark", async () => {
  const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css")
  const css = await readFile(cssPath, "utf8")
  const lightStart = css.indexOf(":root {")
  const darkStart = css.indexOf(".dark {")
  assert.ok(lightStart >= 0 && darkStart > lightStart)
  const lightBlock = css.slice(lightStart, darkStart)
  const darkBlock = css.slice(darkStart, css.indexOf("}", darkStart))
  const tokens = new Set(
    [...PRICE_TIER_SCHEME_V1.tiers, ...PRICE_TIER_SCHEME_V2.tiers]
      .map((tier) => tier.colorToken)
      .filter((token): token is string => Boolean(token))
  )
  assert.equal(tokens.size, 15)
  for (const token of tokens) {
    assert.match(lightBlock, new RegExp(`${token}:\\s*#[0-9a-f]{6};`), `${token} (light)`)
    assert.match(darkBlock, new RegExp(`${token}:\\s*#[0-9a-f]{6};`), `${token} (dark)`)
  }
})
