import assert from "node:assert/strict"
import test from "node:test"

import { buildBrandExportPayload } from "../lib/brand-export.ts"
import type { Rolling12Metric, SnapshotSummary } from "../lib/competitor-data.ts"

/**
 * Fixture-driven: no filesystem, no Postgres, no network. The pipeline pins the
 * payload's member set with its own fixtures, so this test asserts the exact keys
 * rather than a subset.
 */

function rolling12Metric(overrides: Partial<Rolling12Metric> = {}): Rolling12Metric {
  return {
    monthLabels: ["Aug 2025", "Sep 2025"],
    currentMonthLabel: "Sep 2025",
    marketSeries: [100, 120],
    marketTotalMonthly: 120,
    overallTotalMonthly: 130,
    brands: [
      { brand: "Innova", monthly: 40, grandTotal: 400, rank: 1, monthlySeries: [30, 40] },
      // `monthlySeries` is optional upstream; the export must still emit an array.
      { brand: "Autel", monthly: 20, grandTotal: 200, rank: 2 },
    ],
    ...overrides,
  }
}

function snapshot(date: string, overrides: Partial<SnapshotSummary> = {}): SnapshotSummary {
  return {
    date,
    label: date,
    totals: {
      revenue: 1000,
      units: 50,
      asinCount: 12,
      avgPrice: 20,
      ratingAvg: 4.5,
      reviewCount: 900,
      top3Share: 0.6,
      meaningfulCompetitors: 4,
      brandCount: 6,
    },
    topProducts: [],
    brandTotals: [
      { brand: "Innova", revenue: 600, units: 30, share: 0.6 },
      { brand: "Autel", revenue: 400, units: 20, share: 0.4 },
    ],
    brandListings: [],
    priceTiers: [],
    rolling12: { revenue: rolling12Metric(), units: rolling12Metric() },
    ...overrides,
  }
}

test("the export payload carries exactly the frozen member set", () => {
  const payload = buildBrandExportPayload(
    "code_reader_scanner",
    [snapshot("2026-07-31"), snapshot("2026-08-31")],
    null
  )
  assert.ok(payload)

  assert.deepEqual(Object.keys(payload), [
    "categoryId",
    "snapshotDate",
    "previousSnapshotDate",
    "totals",
    "brandTotals",
    "rolling12",
    "previous",
    "alerts",
  ])
  assert.deepEqual(Object.keys(payload.totals), [
    "revenue",
    "units",
    "asinCount",
    "avgPrice",
    "ratingAvg",
    "reviewCount",
    "top3Share",
    "brandCount",
  ])
  assert.equal(
    "meaningfulCompetitors" in payload.totals,
    false,
    "the dashboard-only total is not exported"
  )
  assert.deepEqual(Object.keys(payload.brandTotals[0]), ["brand", "revenue", "units", "share"])
  assert.deepEqual(Object.keys(payload.rolling12.revenue!), [
    "monthLabels",
    "currentMonthLabel",
    "marketSeries",
    "marketTotalMonthly",
    "overallTotalMonthly",
    "brands",
  ])
  assert.deepEqual(Object.keys(payload.rolling12.revenue!.brands[0]), [
    "brand",
    "monthly",
    "grandTotal",
    "rank",
    "monthlySeries",
  ])
  assert.deepEqual(Object.keys(payload.previous!), ["totals", "brandTotals", "rolling12"])
  for (const alert of payload.alerts) {
    assert.deepEqual(Object.keys(alert), ["id", "severity", "title", "detail"])
  }
})

test("no snapshot argument selects the latest snapshot and the one before it", () => {
  const payload = buildBrandExportPayload(
    "code_reader_scanner",
    [snapshot("2026-06-30"), snapshot("2026-07-31"), snapshot("2026-08-31")],
    null
  )

  assert.equal(payload?.snapshotDate, "2026-08-31")
  assert.equal(payload?.previousSnapshotDate, "2026-07-31")
})

test("an explicit snapshot selects that snapshot and its predecessor", () => {
  const payload = buildBrandExportPayload(
    "code_reader_scanner",
    [snapshot("2026-06-30"), snapshot("2026-07-31"), snapshot("2026-08-31")],
    "2026-07-31"
  )

  assert.equal(payload?.snapshotDate, "2026-07-31")
  assert.equal(payload?.previousSnapshotDate, "2026-06-30")
})

test("the oldest snapshot has no previous side", () => {
  const payload = buildBrandExportPayload(
    "code_reader_scanner",
    [snapshot("2026-06-30"), snapshot("2026-07-31")],
    "2026-06-30"
  )

  assert.equal(payload?.previousSnapshotDate, null)
  assert.equal(payload?.previous, null)
})

test("shares are 0-1 fractions and values pass through unrounded", () => {
  const payload = buildBrandExportPayload(
    "code_reader_scanner",
    [
      snapshot("2026-08-31", {
        totals: {
          revenue: 1234.56,
          units: 78,
          asinCount: 9,
          avgPrice: 15.826,
          ratingAvg: 4.4321,
          reviewCount: 1234,
          top3Share: 0.8123456,
          meaningfulCompetitors: 3,
          brandCount: 5,
        },
        brandTotals: [{ brand: "Innova", revenue: 1000.5, units: 60, share: 0.8103 }],
      }),
    ],
    null
  )

  assert.equal(payload?.totals.revenue, 1234.56)
  assert.equal(payload?.totals.top3Share, 0.8123456)
  assert.equal(payload?.brandTotals[0].share, 0.8103)
  assert.ok(payload!.brandTotals.every((brand) => brand.share >= 0 && brand.share <= 1))
})

test("an absent rolling-12 metric is omitted rather than nulled", () => {
  const payload = buildBrandExportPayload(
    "code_reader_scanner",
    [snapshot("2026-08-31", { rolling12: { revenue: rolling12Metric() } })],
    null
  )

  assert.deepEqual(Object.keys(payload!.rolling12), ["revenue"])

  const none = buildBrandExportPayload(
    "code_reader_scanner",
    [snapshot("2026-08-31", { rolling12: undefined })],
    null
  )
  assert.deepEqual(none!.rolling12, {})
})

test("a brand with no monthlySeries upstream still exports an array", () => {
  const payload = buildBrandExportPayload("code_reader_scanner", [snapshot("2026-08-31")], null)

  assert.deepEqual(payload!.rolling12.revenue!.brands[1].monthlySeries, [])
})

test("alerts come from the shared spotlight builder and stay capped at three", () => {
  const previous = snapshot("2026-07-31")
  const active = snapshot("2026-08-31", {
    totals: { ...previous.totals, revenue: 2000, units: 100 },
    brandTotals: [
      { brand: "Innova", revenue: 1400, units: 70, share: 0.7 },
      { brand: "Autel", revenue: 600, units: 30, share: 0.3 },
    ],
    qualityIssues: [{ code: "missing_sheet", message: "missing", severity: "error" }],
  })

  const payload = buildBrandExportPayload("code_reader_scanner", [previous, active], null)

  assert.ok(payload!.alerts.length > 0)
  assert.ok(payload!.alerts.length <= 3)
  assert.equal(payload!.alerts[0].id, "data_quality", "quality issues are surfaced first")
  assert.equal(payload!.alerts[0].severity, "risk")
})

test("an empty snapshot list yields no payload so the route can answer 404", () => {
  assert.equal(buildBrandExportPayload("code_reader_scanner", [], null), null)
})
