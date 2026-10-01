import assert from "node:assert/strict"
import test from "node:test"

import {
  evaluateBranches,
  selectPrunableBranches,
  type NeonBranchSummary,
} from "../lib/neon-branch-audit.ts"

const production: NeonBranchSummary = { id: "br-prod", name: "production", default: true }

test("selectPrunableBranches never returns default, primary or protected branches even when the name matches", () => {
  const branches: NeonBranchSummary[] = [
    { id: "br-default", name: "preview/default-match", default: true },
    { id: "br-primary", name: "preview/primary-match", primary: true },
    { id: "br-protected", name: "preview/protected-match", protected: true },
    { id: "br-named-default", name: "vercel-dev", default: true },
    { id: "br-ok", name: "preview/feature-a" },
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
    { id: "br-1", name: "preview/feat-1" },
    { id: "br-2", name: "preview/feat-2" },
    { id: "br-3", name: "previewish" },
    { id: "br-4", name: "dev/preview/x" },
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
    { id: "br-dev", name: "vercel-dev" },
    { id: "br-dev2", name: "vercel-dev-2" },
    { id: "br-old", name: "scratch" },
  ]

  const selected = selectPrunableBranches(branches, { prefixes: [], names: ["vercel-dev", "scratch"] })

  assert.deepEqual(
    selected.map((branch) => branch.id),
    ["br-dev", "br-old"]
  )
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
