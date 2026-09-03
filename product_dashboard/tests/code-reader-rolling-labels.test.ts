import assert from "node:assert/strict"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { type TestContext } from "node:test"

import * as XLSX from "xlsx"

import { loadCodeReaderScannerSnapshotFromFiles } from "../lib/code-reader-scanner-data.ts"

const RAW_REVENUE_LABELS = [
  "Monthly Revenue-11",
  "Monthly Revenue-10",
  "Monthly Revenue-9",
  "Monthly Revenue-8",
  "Monthly Revenue-7",
  "Monthly Revenue-6",
  "Monthly Revenue-5",
  "Monthly Revenue-4",
  "Monthly Revenue-3",
  "Monthly Revenue-2",
  "Monthly Revenue-1",
  "Monthly Revenue",
]

const RAW_UNITS_LABELS = [
  "Monthly Sales-11",
  "Monthly Sales-10",
  "Monthly Sales-9",
  "Monthly Sales-8",
  "Monthly Sales-7",
  "Monthly Sales-6",
  "Monthly Sales-5",
  "Monthly Sales-4",
  "Monthly Sales-3",
  "Monthly Sales-2",
  "Monthly Sales-1",
  "Monthly Sales",
]

const SEPTEMBER_2025_TO_AUGUST_2026 = [
  "September '25",
  "October '25",
  "November '25",
  "December '25",
  "January '26",
  "February '26",
  "March '26",
  "April '26",
  "May '26",
  "June '26",
  "July '26",
  "August '26",
]

function relativeLabels(metric: "Revenue" | "Sales", count: number) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = count - 1 - index
    return `Monthly ${metric}${suffix === 0 ? "" : `-${suffix}`}`
  })
}

type FixtureOptions = {
  month: string
  revenueLabels: string[]
  unitsLabels?: string[]
  ingestMonth?: string
}

async function parseRollingFixture(t: TestContext, options: FixtureOptions) {
  const fixtureDir = await mkdtemp(path.join(tmpdir(), "code-reader-rolling-labels-"))
  t.after(() => rm(fixtureDir, { recursive: true, force: true }))

  const unitsLabels = options.unitsLabels ?? options.revenueLabels
  const rows = [
    ["Brand", ...options.revenueLabels, "Grand Total Revenue"],
    ["Autel", ...options.revenueLabels.map(() => "1"), String(options.revenueLabels.length)],
    [],
    ["Brand", ...unitsLabels, "Grand Total Units"],
    ["Autel", ...unitsLabels.map(() => "1"), String(unitsLabels.length)],
  ]

  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Rolling 12 mo")
  const reportPath = path.join(fixtureDir, "Amazon Competitor Report.xlsx")
  XLSX.writeFile(workbook, reportPath)

  const snapshot = await loadCodeReaderScannerSnapshotFromFiles({
    month: options.month,
    ingestMonth: options.ingestMonth,
    reportPath,
  })
  assert.ok(snapshot)
  assert.ok(snapshot.rolling12?.revenue)
  assert.ok(snapshot.rolling12?.units)
  return snapshot
}

function issueCodes(snapshot: Awaited<ReturnType<typeof parseRollingFixture>>) {
  return snapshot.qualityIssues?.map((issue) => issue.code) ?? []
}

test("normalizes the exact raw revenue and units headers to aligned calendar labels", async (t) => {
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: RAW_REVENUE_LABELS,
    unitsLabels: RAW_UNITS_LABELS,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(
    snapshot.rolling12?.revenue?.monthLabels,
    snapshot.rolling12?.units?.monthLabels
  )
  assert.equal(snapshot.rolling12?.revenue?.currentMonthLabel, "August '26")
  assert.equal(snapshot.rolling12?.units?.currentMonthLabel, "August '26")
})

test("leaves formatted month labels unchanged with and without an ingest month", async (t) => {
  const withoutMonth = await parseRollingFixture(t, {
    month: "202608",
    revenueLabels: SEPTEMBER_2025_TO_AUGUST_2026,
  })
  const withMonth = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: SEPTEMBER_2025_TO_AUGUST_2026,
  })

  assert.deepEqual(withoutMonth.rolling12?.revenue?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(withoutMonth.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(withMonth.rolling12?.revenue?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(withMonth.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.equal(issueCodes(withoutMonth).includes("rolling_relative_labels"), false)
  assert.equal(issueCodes(withMonth).includes("rolling_relative_labels"), false)
})

test("keeps relative labels and reports them when no ingest month is provided", async (t) => {
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    revenueLabels: RAW_REVENUE_LABELS,
    unitsLabels: RAW_UNITS_LABELS,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, RAW_REVENUE_LABELS)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, RAW_UNITS_LABELS)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_labels"), true)
})

test("keeps a relative section unchanged and reports a suffix mismatch", async (t) => {
  const mismatchedRevenueLabels = [...RAW_REVENUE_LABELS]
  mismatchedRevenueLabels[0] = "Monthly Revenue-10"
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: mismatchedRevenueLabels,
    unitsLabels: RAW_UNITS_LABELS,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, mismatchedRevenueLabels)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_label_mismatch"), true)
})

test("treats an unsuffixed relative label in the middle as suffix zero", async (t) => {
  const middleUnsuffixed = [...RAW_REVENUE_LABELS]
  middleUnsuffixed[5] = "Monthly Revenue"
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: middleUnsuffixed,
    unitsLabels: RAW_UNITS_LABELS,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, middleUnsuffixed)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_label_mismatch"), true)
})

test("does not invent a rolling window from twelve bare relative labels", async (t) => {
  const bareRevenueLabels = Array(12).fill("Monthly Revenue")
  const bareUnitsLabels = Array(12).fill("Monthly Sales")
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: bareRevenueLabels,
    unitsLabels: bareUnitsLabels,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, bareRevenueLabels)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, bareUnitsLabels)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_label_mismatch"), true)
})

test("accepts an explicit suffix zero at the last index", async (t) => {
  const revenueLabels = [...RAW_REVENUE_LABELS]
  const unitsLabels = [...RAW_UNITS_LABELS]
  revenueLabels[revenueLabels.length - 1] = "Monthly Revenue-0"
  unitsLabels[unitsLabels.length - 1] = "Monthly Sales-0"
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels,
    unitsLabels,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_label_mismatch"), false)
})

test("reports independently normalized revenue and units sections that are misaligned", async (t) => {
  const elevenMonthUnits = relativeLabels("Sales", 11)
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: RAW_REVENUE_LABELS,
    unitsLabels: elevenMonthUnits,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026.slice(1))
  const issue = snapshot.qualityIssues?.find(
    (candidate) => candidate.code === "rolling_label_sections_misaligned"
  )
  assert.ok(issue)
  assert.match(issue.message, /revenue length 12, units length 11; first divergent index 0/)
})

for (const invalidIngestMonth of ["2026", "abc", "202613", "", "000001"]) {
  test(`keeps relative labels unchanged for invalid ingest month ${JSON.stringify(invalidIngestMonth)}`, async (t) => {
    const snapshot = await parseRollingFixture(t, {
      month: "202608",
      ingestMonth: invalidIngestMonth,
      revenueLabels: RAW_REVENUE_LABELS,
      unitsLabels: RAW_UNITS_LABELS,
    })

    assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, RAW_REVENUE_LABELS)
    assert.deepEqual(snapshot.rolling12?.units?.monthLabels, RAW_UNITS_LABELS)
    assert.equal(issueCodes(snapshot).includes("rolling_relative_labels"), true)
  })
}

test("trims a valid ingest month before normalization", async (t) => {
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: " 202608 ",
    revenueLabels: RAW_REVENUE_LABELS,
    unitsLabels: RAW_UNITS_LABELS,
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, SEPTEMBER_2025_TO_AUGUST_2026)
})

test("normalizes a three-month relative window", async (t) => {
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: relativeLabels("Revenue", 3),
    unitsLabels: relativeLabels("Sales", 3),
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, ["June '26", "July '26", "August '26"])
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, ["June '26", "July '26", "August '26"])
})

test("normalizes a thirteen-month relative window", async (t) => {
  const snapshot = await parseRollingFixture(t, {
    month: "202608",
    ingestMonth: "202608",
    revenueLabels: relativeLabels("Revenue", 13),
    unitsLabels: relativeLabels("Sales", 13),
  })

  const expected = ["August '25", ...SEPTEMBER_2025_TO_AUGUST_2026]
  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, expected)
  assert.deepEqual(snapshot.rolling12?.units?.monthLabels, expected)
})

test("normalizes across a year boundary without local-time date math", async (t) => {
  // Future tripwire: the implementation is Date-free today, but keep this guard if that changes.
  const originalTimezone = process.env.TZ
  t.after(() => {
    if (originalTimezone === undefined) delete process.env.TZ
    else process.env.TZ = originalTimezone
  })

  const expected = [
    "February '25",
    "March '25",
    "April '25",
    "May '25",
    "June '25",
    "July '25",
    "August '25",
    "September '25",
    "October '25",
    "November '25",
    "December '25",
    "January '26",
  ]

  process.env.TZ = "Pacific/Kiritimati"
  const utcPlus14 = await parseRollingFixture(t, {
    month: "202601",
    ingestMonth: "202601",
    revenueLabels: RAW_REVENUE_LABELS,
    unitsLabels: RAW_UNITS_LABELS,
  })
  process.env.TZ = "America/Adak"
  const utcMinus10 = await parseRollingFixture(t, {
    month: "202601",
    ingestMonth: "202601",
    revenueLabels: RAW_REVENUE_LABELS,
    unitsLabels: RAW_UNITS_LABELS,
  })

  assert.deepEqual(utcPlus14.rolling12?.revenue?.monthLabels, expected)
  assert.deepEqual(utcMinus10.rolling12?.revenue?.monthLabels, expected)
})

test("does not rewrite mixed relative and formatted labels", async (t) => {
  const mixedLabels = ["Monthly Revenue-2", "December '25", "Monthly Revenue"]
  const snapshot = await parseRollingFixture(t, {
    month: "202601",
    ingestMonth: "202601",
    revenueLabels: mixedLabels,
    unitsLabels: ["Monthly Sales-2", "December '25", "Monthly Sales"],
  })

  assert.deepEqual(snapshot.rolling12?.revenue?.monthLabels, mixedLabels)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_labels_mixed"), true)
  assert.equal(issueCodes(snapshot).includes("rolling_relative_labels"), false)
})
