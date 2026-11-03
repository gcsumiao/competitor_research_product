import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"

import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import * as XLSX from "xlsx"

import {
  BRAND_CATEGORY_MIX_UNAVAILABLE,
  BrandCategoryMixCard,
  brandCategoryMixNoRowsMessage,
} from "../components/dashboard/brand-category-mix-card.tsx"
import { buildBrandCategoryMixView, findBrandCategoryMix } from "../lib/brand-category-mix.ts"
import { loadCodeReaderScannerSnapshotFromFiles } from "../lib/code-reader-scanner-data.ts"
import type { SnapshotSummary } from "../lib/competitor-data.ts"
import { projectSnapshotForScope } from "../lib/dashboard-scope.ts"
import { PRICE_TIER_SCHEME_V1, PRICE_TIER_SCHEME_V2 } from "../lib/price-tier-scheme.ts"

const SUMMARY_HEADER = [
  "Brand",
  "Category",
  "Avg Price",
  "Avg Price MoM",
  "Avg Price YoY",
  "Quantity/Mo",
  "Qty by %",
  "Qty MoM",
  "Qty YoY",
  "Revenue/Mo",
  "Revenue by %",
  "Revenue MoM",
  "Revenue YoY",
]

type Cell = string | number | null

function metricRow(brand: string, label: string, index: number): Cell[] {
  const units = 100 + index
  return [brand, label, 50, 0.01, -0.02, units, 0.05, 0.03, -0.04, units * 50, 0.05, 0.1, -0.2]
}

// The raw pandas shape of an empty slice: blank price/MoM/YoY, zero volume.
function zeroRow(brand: string, label: string): Cell[] {
  return [brand, label, null, null, null, 0, 0, null, null, 0, 0, null, null]
}

async function loadFixture(
  t: TestContext,
  options: { month: string; sheet1: Cell[][]; withAnalysis?: boolean }
) {
  const dir = await mkdtemp(path.join(tmpdir(), "brand-category-mix-"))
  t.after(() => rm(dir, { recursive: true, force: true }))

  const report = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    report,
    XLSX.utils.aoa_to_sheet([
      ["Brand", "Monthly Revenue", "Grand Total Revenue"],
      ["Autel", "1", "1"],
      [],
      ["Brand", "Monthly Sales", "Grand Total Units"],
      ["Autel", "1", "1"],
    ]),
    "Rolling 12 mo"
  )
  const reportPath = path.join(dir, "report.xlsx")
  XLSX.writeFile(report, reportPath)

  const summary = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(summary, XLSX.utils.aoa_to_sheet([SUMMARY_HEADER, ...options.sheet1]), "Sheet1")
  const summaryPath = path.join(dir, "summary.xlsx")
  XLSX.writeFile(summary, summaryPath)

  let analysisPath: string | undefined
  if (options.withAnalysis) {
    const analysis = XLSX.utils.book_new()
    const totals = options.sheet1.filter((row) => row[0] === "Total").map((row) => row.slice(1))
    XLSX.utils.book_append_sheet(
      analysis,
      XLSX.utils.aoa_to_sheet([SUMMARY_HEADER.slice(1), ...totals]),
      "Summary"
    )
    analysisPath = path.join(dir, "analysis.xlsx")
    XLSX.writeFile(analysis, analysisPath)
  }

  const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
    month: options.month,
    ingestMonth: options.month,
    reportPath,
    analysisPath,
    summaryPath,
  })
  assert.ok(snapshot)
  return snapshot
}

const V1_LABELS = PRICE_TIER_SCHEME_V1.tiers.map((tier) => tier.label)
const V2_LABELS = PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.label)
const V1_KEYS = PRICE_TIER_SCHEME_V1.tiers.map((tier) => tier.key)
const V2_KEYS = PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.key)

function v2Sheet1(): Cell[][] {
  return [
    ...V2_LABELS.map((label, index) => metricRow("Total", label, index)),
    ...V2_LABELS.map((label, index) => metricRow("Top 50", label, index)),
    ...V2_LABELS.map((label, index) => metricRow("autel", label, index)),
    // A brand with only "Other Tools" sales: every other row is all-zero, and
    // its change cells carry a raw spike (55.5 = +5550%) and "N/A".
    ...V2_LABELS.map((label) => {
      if (label === "Total Other Tools" || label === "Total") {
        return ["edge products", label, 433.4, -0.38, "N/A", 725, 1, 144, 361.5, 314220.49, 1, 55.5, "N/A"]
      }
      return zeroRow("edge products", label)
    }),
  ]
}

test("V2 summary: every brand keeps all 16 Sheet1 rows, zero rows included, keys unique", async (t) => {
  const snapshot = await loadFixture(t, { month: "202610", sheet1: v2Sheet1() })
  const mix = snapshot.typeBreakdowns?.brandCategoryMix ?? []

  assert.deepEqual(mix.map((entry) => entry.brandKey), ["autel", "edgeproducts"])
  for (const entry of mix) {
    assert.equal(entry.rows.length, 16, entry.brand)
    assert.deepEqual(entry.rows.map((row) => row.scopeKey), V2_KEYS)
    assert.equal(new Set(entry.rows.map((row) => row.scopeKey)).size, 16)
  }

  const edge = findBrandCategoryMix(snapshot, "Edge Products")
  assert.ok(edge)
  const edgeByKey = new Map(edge.rows.map((row) => [row.scopeKey, row]))
  // Type-total zero rows (skipped for the market rows) stay for a brand.
  assert.equal(edgeByKey.get("total_tablet")?.revenue, 0)
  assert.equal(edgeByKey.get("total_tablet")?.revenueMoM, null)
  assert.equal(edgeByKey.get("tablet_200_300")?.units, 0)
  // Raw ratio scale: 55.5 is +5550%, not 55.5%; "N/A" is null; share 1 = 100%.
  assert.equal(edgeByKey.get("total")?.revenueMoM, 55.5)
  assert.equal(edgeByKey.get("total")?.revenueYoY, null)
  assert.equal(edgeByKey.get("total")?.revenueShare, 1)
  assert.equal(edgeByKey.get("total")?.unitsMoM, 144)

  // Market rows are unchanged: "Total"/"Top 50" are never brands.
  assert.equal(snapshot.typeBreakdowns?.allAsins.length, 16)
  assert.equal(snapshot.typeBreakdowns?.top50.length, 16)

  const view = buildBrandCategoryMixView(snapshot, "AUTEL")
  assert.equal(view.status, "ok")
  if (view.status !== "ok") return
  assert.equal(view.schemeVersion, "v2")
  assert.deepEqual(view.rows.map((row) => row.key), V2_KEYS)
  assert.deepEqual(
    view.rows.filter((row) => row.depth === 1).map((row) => row.key),
    ["tablet_300_400", "tablet_200_300", "tablet_under_200", "handheld_65_100", "handheld_35_65", "handheld_under_35"]
  )
  assert.deepEqual(
    view.rows.filter((row) => row.isTotal).map((row) => row.key),
    ["total_tablet", "total_handheld", "total_dongle", "total_other_tools", "total"]
  )

  const html = renderToStaticMarkup(createElement(BrandCategoryMixCard, { snapshot, brand: "autel" }))
  assert.equal((html.match(/data-row-key=/g) ?? []).length, 16)
  assert.ok(html.includes("Category mix"))
  assert.ok(html.includes("Oct 2026"))
  assert.ok(!html.includes("not available"))
})

test("V1 summary: 10 rows per brand", async (t) => {
  const sheet1 = [
    ...V1_LABELS.map((label, index) => metricRow("Total", label, index)),
    ...V1_LABELS.map((label, index) => metricRow("Top 50", label, index)),
    ...V1_LABELS.map((label, index) => metricRow("innova", label, index)),
  ]
  const snapshot = await loadFixture(t, { month: "202609", sheet1 })
  const innova = findBrandCategoryMix(snapshot, "Innova")
  assert.ok(innova)
  assert.deepEqual(innova.rows.map((row) => row.scopeKey), V1_KEYS)

  const view = buildBrandCategoryMixView(snapshot, "innova")
  assert.equal(view.status, "ok")
  if (view.status !== "ok") return
  assert.equal(view.schemeVersion, "v1")
  assert.equal(view.rows.length, 10)
  assert.ok(view.rows.every((row) => row.depth === 0))
})

test("an analysis-sourced month still takes the brand mix from its summary.xlsx", async (t) => {
  const sheet1 = [
    ...V1_LABELS.map((label, index) => metricRow("Total", label, index)),
    ...V1_LABELS.map((label, index) => metricRow("autel", label, index)),
  ]
  const snapshot = await loadFixture(t, { month: "202606", sheet1, withAnalysis: true })
  assert.equal(snapshot.typeBreakdowns?.source, "analysis")
  assert.equal(findBrandCategoryMix(snapshot, "autel")?.rows.length, 10)
})

test("old payloads without brandCategoryMix (or without the brand) render the not-available state", () => {
  const oldPayload = {
    date: "2026-09-30",
    typeBreakdowns: { allAsins: [], top50: [], categoryBrandMix: [], source: "summary" as const },
  }
  for (const snapshot of [oldPayload, { date: "2026-09-30" }, undefined]) {
    assert.deepEqual(buildBrandCategoryMixView(snapshot, "autel"), { status: "unavailable", reason: "snapshot" })
    const html = renderToStaticMarkup(createElement(BrandCategoryMixCard, { snapshot, brand: "autel" }))
    assert.ok(html.includes(BRAND_CATEGORY_MIX_UNAVAILABLE))
    assert.ok(!html.includes("<table"))
  }

  // The month has per-brand rows, the selected brand has none (Innova 1P / 3P
  // in October: the summary reports them under "innova"): a different message.
  const otherBrand = {
    date: "2026-10-31",
    typeBreakdowns: {
      ...oldPayload.typeBreakdowns,
      brandCategoryMix: [{ brand: "launch", brandKey: "launch", rows: [] }],
    },
  }
  assert.deepEqual(buildBrandCategoryMixView(otherBrand, "Innova 1P"), { status: "unavailable", reason: "brand" })
  const html = renderToStaticMarkup(createElement(BrandCategoryMixCard, { snapshot: otherBrand, brand: "Innova 1P" }))
  assert.ok(html.includes("No category rows for Innova 1P"))
  assert.ok(!html.includes(BRAND_CATEGORY_MIX_UNAVAILABLE))
  assert.ok(!html.includes("<table"))
  assert.equal(brandCategoryMixNoRowsMessage("Innova 1P").startsWith("No category rows for Innova 1P"), true)
})

test("brands that normalise alike stay separate and never answer for each other", async (t) => {
  const sheet1 = [
    ...V2_LABELS.map((label, index) => metricRow("Total", label, index)),
    ...V2_LABELS.map((label, index) => metricRow("ACME-A", label, index)),
    ...V2_LABELS.map((label, index) => metricRow("ACMEA", label, index + 100)),
  ]
  const snapshot = await loadFixture(t, { month: "202610", sheet1 })
  const mix = snapshot.typeBreakdowns?.brandCategoryMix ?? []
  // Both brands survive the parse with their own rows (one normalised key).
  assert.deepEqual(mix.map((entry) => entry.brand), ["ACME-A", "ACMEA"])
  assert.deepEqual(mix.map((entry) => entry.brandKey), ["acmea", "acmea"])
  assert.equal(mix[0].rows.length, 16)
  assert.equal(mix[1].rows.length, 16)
  // Exact (case-insensitive) text wins ...
  assert.equal(findBrandCategoryMix(snapshot, "acme-a")?.brand, "ACME-A")
  assert.equal(findBrandCategoryMix(snapshot, "ACME-A")?.rows[0].units, 100)
  assert.equal(findBrandCategoryMix(snapshot, " Acmea ")?.brand, "ACMEA")
  assert.equal(findBrandCategoryMix(snapshot, "ACMEA")?.rows[0].units, 200)
  // ... and a normalised-only match that is ambiguous answers for nobody.
  assert.equal(findBrandCategoryMix(snapshot, "acme a"), null)
  assert.equal(findBrandCategoryMix(snapshot, "ACME_A"), null)
  assert.deepEqual(buildBrandCategoryMixView(snapshot, "acme a"), { status: "unavailable", reason: "brand" })

  // A normalised match still resolves when it is unique ("BullyDog" <-> "bully dog").
  const unique = await loadFixture(t, {
    month: "202610",
    sheet1: [
      ...V2_LABELS.map((label, index) => metricRow("Total", label, index)),
      ...V2_LABELS.map((label, index) => metricRow("bully dog", label, index)),
    ],
  })
  assert.equal(findBrandCategoryMix(unique, "BullyDog")?.brand, "bully dog")
  assert.equal(buildBrandCategoryMixView(unique, "Bully-Dog").status, "ok")
})

test("scope projection: brands keeps brandCategoryMix, types and overview drop it", () => {
  const brandCategoryMix = [{ brand: "autel", brandKey: "autel", rows: [] }]
  const snapshot = {
    date: "2026-10-31",
    label: "Oct 31",
    typeBreakdowns: { allAsins: [], top50: [], categoryBrandMix: [], brandCategoryMix, source: "summary" },
  } as unknown as SnapshotSummary
  assert.deepEqual(projectSnapshotForScope(snapshot, "brands").typeBreakdowns?.brandCategoryMix, brandCategoryMix)
  assert.equal(projectSnapshotForScope(snapshot, "types").typeBreakdowns?.brandCategoryMix, undefined)
  assert.equal(projectSnapshotForScope(snapshot, "overview").typeBreakdowns?.brandCategoryMix, undefined)
  // The source payload is not mutated.
  assert.equal(snapshot.typeBreakdowns?.brandCategoryMix, brandCategoryMix)
})
