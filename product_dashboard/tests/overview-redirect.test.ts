import assert from "node:assert/strict"
import test from "node:test"

import { resolveOverviewRedirect } from "../lib/overview-redirect.ts"

const categories = [
  {
    id: "code_reader_scanner",
    snapshots: [{ date: "2026-07-31" }, { date: "2026-08-31" }],
  },
  {
    id: "dmm",
    snapshots: [{ date: "2026-06-30" }, { date: "2026-07-31" }],
  },
  { id: "oil", snapshots: [] },
]

const codeReaderLatest = "/?category=code_reader_scanner&snapshot=2026-08-31"

test("no params redirects to the code reader latest snapshot", () => {
  assert.equal(resolveOverviewRedirect(categories, {}), codeReaderLatest)
})

test("unknown category redirects to the code reader latest snapshot", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "nope", snapshot: "2026-07-31" }),
    codeReaderLatest
  )
})

test("valid non-code category without a snapshot redirects to its own latest", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "dmm" }),
    "/?category=dmm&snapshot=2026-07-31"
  )
})

test("valid non-code category with a valid snapshot does not redirect", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "dmm", snapshot: "2026-06-30" }),
    null
  )
})

test("valid code reader category with a valid snapshot does not redirect", () => {
  assert.equal(
    resolveOverviewRedirect(categories, {
      category: "code_reader_scanner",
      snapshot: "2026-07-31",
    }),
    null
  )
})

test("code reader without a snapshot redirects to its latest", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "code_reader_scanner" }),
    codeReaderLatest
  )
})

test("snapshot is compared after normalization to month end", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "dmm", snapshot: "2026-06" }),
    null
  )
  assert.equal(
    resolveOverviewRedirect(categories, { category: "dmm", snapshot: "202606" }),
    null
  )
})

test("valid category with a snapshot from another category redirects to its own latest", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "dmm", snapshot: "2026-08-31" }),
    "/?category=dmm&snapshot=2026-07-31"
  )
})

test("category present with zero snapshots redirects to the code reader latest", () => {
  assert.equal(
    resolveOverviewRedirect(categories, { category: "oil", snapshot: "2026-07-31" }),
    codeReaderLatest
  )
})

test("array-valued params use the first value", () => {
  assert.equal(
    resolveOverviewRedirect(categories, {
      category: ["dmm", "code_reader_scanner"],
      snapshot: ["2026-06-30", "2026-08-31"],
    }),
    null
  )
  assert.equal(
    resolveOverviewRedirect(categories, {
      category: ["dmm", "code_reader_scanner"],
      snapshot: ["2026-08-31", "2026-06-30"],
    }),
    "/?category=dmm&snapshot=2026-07-31"
  )
})

test("no code reader data and no valid category leaves the request alone", () => {
  assert.equal(
    resolveOverviewRedirect([{ id: "dmm", snapshots: [] }], { category: "dmm" }),
    null
  )
})
