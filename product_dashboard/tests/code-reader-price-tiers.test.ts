import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"

import * as XLSX from "xlsx"

import { loadCodeReaderScannerSnapshotFromFiles } from "../lib/code-reader-scanner-data.ts"
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

const CATEGORY_HEADER = ["Category", ...SUMMARY_HEADER.filter((cell) => cell !== "Category")]

function summaryRow(brand: string, label: string, index: number) {
  const units = 1000 + index * 10
  const revenue = units * 50
  return [brand, label, 50, 0.01, -0.02, units, 0.1, 0.03, -0.04, revenue, 0.1, 0.05, -0.06]
}

async function loadFixture(
  t: TestContext,
  options: { month: string; labels: string[] }
) {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "code-reader-price-tiers-"))
  t.after(() => rm(fixtureDir, { recursive: true, force: true }))

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
  const reportPath = path.join(fixtureDir, "Amazon Competitor Report.xlsx")
  XLSX.writeFile(report, reportPath)

  const summary = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    summary,
    XLSX.utils.aoa_to_sheet([
      SUMMARY_HEADER,
      ...options.labels.map((label, index) => summaryRow("Total", label, index)),
      ...options.labels.map((label, index) => summaryRow("Top 50", label, index)),
    ]),
    "Sheet1"
  )
  XLSX.utils.book_append_sheet(
    summary,
    XLSX.utils.aoa_to_sheet([
      CATEGORY_HEADER,
      ...options.labels.flatMap((label, index) => {
        const [, , ...metrics] = summaryRow("x", label, index)
        return [
          [label, "autel", ...metrics],
          [label, "launch", ...metrics.map((value) => (typeof value === "number" ? value / 2 : value))],
        ]
      }),
    ]),
    "Category"
  )
  const summaryPath = path.join(fixtureDir, "summary.xlsx")
  XLSX.writeFile(summary, summaryPath)

  const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
    month: options.month,
    ingestMonth: options.month,
    reportPath,
    summaryPath,
  })
  assert.ok(snapshot)
  return snapshot
}

const V1_LABELS = PRICE_TIER_SCHEME_V1.tiers.map((tier) => tier.label)
const V2_LABELS = PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.label)

test("a 202610 V2 summary keeps all 16 rows under unique scope keys", async (t) => {
  const snapshot = await loadFixture(t, { month: "202610", labels: V2_LABELS })
  const allAsins = snapshot.typeBreakdowns?.allAsins ?? []

  assert.deepEqual(
    allAsins.map((row) => row.scopeKey),
    PRICE_TIER_SCHEME_V2.tiers.map((tier) => tier.key)
  )
  assert.deepEqual(allAsins.map((row) => row.label), V2_LABELS)
  assert.equal(new Set(allAsins.map((row) => row.scopeKey)).size, 16)
  assert.equal(new Set(snapshot.typeBreakdowns?.top50.map((row) => row.scopeKey)).size, 16)

  // Additive hierarchy annotations.
  const byKey = new Map(allAsins.map((row) => [row.scopeKey, row as typeof row & { parentKey?: string | null; kind?: string }]))
  assert.equal(byKey.get("tablet_200_300")?.parentKey, "tablet_under_400")
  assert.equal(byKey.get("tablet_200_300")?.kind, "subtier")
  assert.equal(byKey.get("handheld_under_100")?.parentKey, null)
  assert.equal(byKey.get("handheld_under_100")?.kind, "tier")
  assert.equal(byKey.get("total")?.kind, "grand_total")

  // Brand mix: "Handheld $100+" and "Handheld $100-" no longer share a key.
  const mixKeys = new Set(snapshot.typeBreakdowns?.categoryBrandMix.map((row) => row.scopeKey))
  assert.equal(mixKeys.size, 16)
  assert.ok(mixKeys.has("handheld_100_plus"))
  assert.ok(mixKeys.has("handheld_under_100"))

  // Snapshot-level priceTiers = the 7 V2 parent-level slices (no sub-tiers).
  assert.deepEqual(snapshot.priceTiers.map((tier) => tier.label), [
    "Tablet $800+",
    "Tablet $400-$800",
    "Tablet $400-",
    "Handheld $100+",
    "Handheld $100-",
    "Total Dongle",
    "Total Other Tools",
  ])
})

test("a 202609 V1 summary is unchanged: 10 rows, $75 handheld tiers in priceTiers", async (t) => {
  const snapshot = await loadFixture(t, { month: "202609", labels: V1_LABELS })
  const allAsins = snapshot.typeBreakdowns?.allAsins ?? []

  assert.deepEqual(
    allAsins.map((row) => row.scopeKey),
    [
      "tablet_800_plus",
      "tablet_400_800",
      "tablet_under_400",
      "total_tablet",
      "handheld_75_plus",
      "handheld_under_75",
      "total_handheld",
      "total_dongle",
      "total_other_tools",
      "total",
    ]
  )
  assert.deepEqual(snapshot.priceTiers.map((tier) => tier.label), [
    "Tablet $800+",
    "Tablet $400-$800",
    "Tablet $400-",
    "Handheld $75+",
    "Handheld $75-",
    "Total Dongle",
    "Total Other Tools",
  ])
})

test("a forced V2 preview of an older month still keeps its handheld tiers", async (t) => {
  const snapshot = await loadFixture(t, { month: "202609", labels: V2_LABELS })
  assert.deepEqual(
    snapshot.priceTiers.map((tier) => tier.label),
    ["Tablet $800+", "Tablet $400-$800", "Tablet $400-", "Handheld $100+", "Handheld $100-", "Total Dongle", "Total Other Tools"]
  )
})
