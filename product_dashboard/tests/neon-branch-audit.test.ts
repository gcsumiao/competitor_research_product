import assert from "node:assert/strict"
import test from "node:test"

import {
  collectCursorPages,
  evaluateBranches,
  hasCompleteProtectionMetadata,
  isProtectedNeonBranch,
  selectPrunableBranches,
  type CursorPage,
  type NeonBranchSummary,
} from "../lib/neon-branch-audit.ts"

const production: NeonBranchSummary = { id: "br-prod", name: "production", default: true }

// A branch the API explicitly reports as non-default and unprotected (the only prunable shape).
function unprotected(id: string, name: string): NeonBranchSummary {
  return { id, name, default: false, protected: false }
}

test("selectPrunableBranches never returns default, primary or protected branches even when the name matches", () => {
  const branches: NeonBranchSummary[] = [
    { id: "br-default", name: "preview/default-match", default: true, protected: false },
    { id: "br-primary", name: "preview/primary-match", default: false, protected: false, primary: true },
    { id: "br-protected", name: "preview/protected-match", default: false, protected: true },
    { id: "br-named-default", name: "vercel-dev", default: true, protected: false },
    unprotected("br-ok", "preview/feature-a"),
  ]

  const selected = selectPrunableBranches(branches, { prefixes: ["preview/"], names: ["vercel-dev"] })

  assert.deepEqual(
    selected.map((branch) => branch.id),
    ["br-ok"]
  )
})

test("selectPrunableBranches filters by name prefix", () => {
  const branches: NeonBranchSummary[] = [
    production,
    unprotected("br-1", "preview/feat-1"),
    unprotected("br-2", "preview/feat-2"),
    unprotected("br-3", "previewish"),
    unprotected("br-4", "dev/preview/x"),
  ]

  const selected = selectPrunableBranches(branches, { prefixes: ["preview/"], names: [] })

  assert.deepEqual(
    selected.map((branch) => branch.id),
    ["br-1", "br-2"]
  )
})

test("selectPrunableBranches selects explicit names exactly", () => {
  const branches: NeonBranchSummary[] = [
    production,
    unprotected("br-dev", "vercel-dev"),
    unprotected("br-dev2", "vercel-dev-2"),
    unprotected("br-old", "scratch"),
  ]

  const selected = selectPrunableBranches(branches, { prefixes: [], names: ["vercel-dev", "scratch"] })

  assert.deepEqual(
    selected.map((branch) => branch.id),
    ["br-dev", "br-old"]
  )
})

test("selectPrunableBranches never returns a branch whose protection flags are missing or non-boolean", () => {
  const branches: NeonBranchSummary[] = [
    { id: "br-no-flags", name: "preview/no-flags" },
    { id: "br-no-default", name: "preview/no-default", protected: false },
    { id: "br-no-protected", name: "preview/no-protected", default: false },
    { id: "br-string-flags", name: "preview/string-flags", default: "false", protected: "false" } as unknown as NeonBranchSummary,
    { id: "br-named-no-flags", name: "vercel-dev" },
    unprotected("br-ok", "preview/explicit-false"),
  ]

  const selected = selectPrunableBranches(branches, { prefixes: ["preview/"], names: ["vercel-dev"] })

  assert.deepEqual(
    selected.map((branch) => branch.id),
    ["br-ok"]
  )
})

test("isProtectedNeonBranch is false only when default and protected are explicitly false and primary is not true", () => {
  assert.equal(isProtectedNeonBranch(unprotected("br-a", "a")), false)
  assert.equal(isProtectedNeonBranch({ ...unprotected("br-b", "b"), primary: false }), false)
  assert.equal(isProtectedNeonBranch({ ...unprotected("br-c", "c"), primary: true }), true)
  assert.equal(isProtectedNeonBranch({ id: "br-d", name: "d", default: true, protected: false }), true)
  assert.equal(isProtectedNeonBranch({ id: "br-e", name: "e", default: false, protected: true }), true)
  assert.equal(isProtectedNeonBranch({ id: "br-f", name: "f" }), true)
  assert.equal(isProtectedNeonBranch({ id: "br-g", name: "g", default: false }), true)
  assert.equal(isProtectedNeonBranch({ id: "br-h", name: "h", protected: false }), true)
})

test("hasCompleteProtectionMetadata requires boolean default and protected flags", () => {
  assert.equal(hasCompleteProtectionMetadata(unprotected("br-a", "a")), true)
  assert.equal(hasCompleteProtectionMetadata({ id: "br-b", name: "b", default: true, protected: true }), true)
  assert.equal(hasCompleteProtectionMetadata({ id: "br-c", name: "c", default: false }), false)
  assert.equal(hasCompleteProtectionMetadata({ id: "br-d", name: "d", protected: false }), false)
  assert.equal(hasCompleteProtectionMetadata({ id: "br-e", name: "e", primary: true }), false)
})

const auditOpts = { max: 2, forbiddenPrefixes: ["preview/"], forbiddenNames: ["vercel-dev"] }

test("evaluateBranches flags count above max", () => {
  const branches: NeonBranchSummary[] = [
    production,
    { id: "br-a", name: "a" },
    { id: "br-b", name: "b" },
  ]

  const result = evaluateBranches(branches, auditOpts)

  assert.equal(result.ok, false)
  assert.equal(result.count, 3)
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /3/)
  assert.match(result.violations[0], /2/)
})

test("evaluateBranches flags forbidden prefixes", () => {
  const result = evaluateBranches([production, { id: "br-p", name: "preview/feature-x" }], auditOpts)

  assert.equal(result.ok, false)
  assert.equal(result.count, 2)
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /preview\/feature-x/)
})

test("evaluateBranches flags forbidden names", () => {
  const result = evaluateBranches([production, { id: "br-v", name: "vercel-dev" }], auditOpts)

  assert.equal(result.ok, false)
  assert.equal(result.violations.length, 1)
  assert.match(result.violations[0], /vercel-dev/)
})

test("evaluateBranches is ok with only the production branch", () => {
  const result = evaluateBranches([production], auditOpts)

  assert.deepEqual(result, { ok: true, count: 1, violations: [] })
})

function fakePages<T>(pages: Record<string, CursorPage<T>>) {
  const requested: Array<string | undefined> = []
  const fetchPage = async (cursor: string | undefined) => {
    requested.push(cursor)
    const page = pages[cursor ?? "<first>"]
    if (!page) throw new Error(`unexpected cursor ${String(cursor)}`)
    return page
  }
  return { fetchPage, requested }
}

test("collectCursorPages concatenates every page until next is absent", async () => {
  const { fetchPage, requested } = fakePages({
    "<first>": { items: ["br-1", "br-2"], next: "c1" },
    c1: { items: ["br-3"], next: "c2" },
    c2: { items: ["br-4", "br-5"] },
  })

  const items = await collectCursorPages(fetchPage)

  assert.deepEqual(items, ["br-1", "br-2", "br-3", "br-4", "br-5"])
  assert.deepEqual(requested, [undefined, "c1", "c2"])
})

test("collectCursorPages stops on an empty page even if it carries a next cursor", async () => {
  const { fetchPage, requested } = fakePages({
    "<first>": { items: ["br-1"], next: "c1" },
    c1: { items: [], next: "c2" },
  })

  assert.deepEqual(await collectCursorPages(fetchPage), ["br-1"])
  assert.deepEqual(requested, [undefined, "c1"])
})

test("collectCursorPages treats a null or empty next cursor as the last page", async () => {
  for (const next of [null, ""]) {
    const { fetchPage, requested } = fakePages({ "<first>": { items: ["br-1"], next } })
    assert.deepEqual(await collectCursorPages(fetchPage), ["br-1"])
    assert.deepEqual(requested, [undefined])
  }
})

test("collectCursorPages stops with an error when a cursor repeats", async () => {
  const { fetchPage, requested } = fakePages({
    "<first>": { items: ["br-1"], next: "c1" },
    c1: { items: ["br-2"], next: "c2" },
    c2: { items: ["br-3"], next: "c1" },
  })

  await assert.rejects(collectCursorPages(fetchPage), /cursor "c1" repeated/)
  assert.deepEqual(requested, [undefined, "c1", "c2"])
})

test("collectCursorPages stops with an error at the page cap", async () => {
  let calls = 0
  const fetchPage = async () => {
    calls += 1
    return { items: [calls], next: `c${calls}` }
  }

  await assert.rejects(collectCursorPages(fetchPage, { maxPages: 3 }), /within 3 pages/)
  assert.equal(calls, 3)
})
