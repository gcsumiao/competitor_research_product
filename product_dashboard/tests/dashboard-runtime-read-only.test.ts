import assert from "node:assert/strict"
import test, { afterEach, before } from "node:test"

import { isDashboardDbReadOnly } from "../lib/dashboard-runtime.ts"

const ENV_KEYS = ["DASHBOARD_DB_READ_ONLY", "VERCEL_ENV"] as const
// Snapshotted in before() so this file never reads process.env at module scope.
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) {
    const value = values[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

before(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const original = originalEnv[key]
    if (original === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = original
    }
  }
})

test("read-only is off when the flag and VERCEL_ENV are both unset", () => {
  setEnv({})
  assert.equal(isDashboardDbReadOnly(), false)
})

test("read-only defaults on for Vercel preview deployments when the flag is unset", () => {
  setEnv({ VERCEL_ENV: "preview" })
  assert.equal(isDashboardDbReadOnly(), true)
})

test("read-only defaults off for Vercel production deployments when the flag is unset", () => {
  setEnv({ VERCEL_ENV: "production" })
  assert.equal(isDashboardDbReadOnly(), false)
})

test("an empty flag falls back to the VERCEL_ENV default", () => {
  setEnv({ DASHBOARD_DB_READ_ONLY: "  ", VERCEL_ENV: "preview" })
  assert.equal(isDashboardDbReadOnly(), true)

  setEnv({ DASHBOARD_DB_READ_ONLY: "", VERCEL_ENV: "production" })
  assert.equal(isDashboardDbReadOnly(), false)
})

for (const value of ["1", "true", "YES", " on "]) {
  test(`explicit truthy flag ${JSON.stringify(value)} turns read-only on`, () => {
    setEnv({ DASHBOARD_DB_READ_ONLY: value })
    assert.equal(isDashboardDbReadOnly(), true)

    setEnv({ DASHBOARD_DB_READ_ONLY: value, VERCEL_ENV: "production" })
    assert.equal(isDashboardDbReadOnly(), true)
  })
}

for (const value of ["0", "false", "off"]) {
  test(`explicit falsy flag ${JSON.stringify(value)} wins over VERCEL_ENV=preview`, () => {
    setEnv({ DASHBOARD_DB_READ_ONLY: value, VERCEL_ENV: "preview" })
    assert.equal(isDashboardDbReadOnly(), false)
  })
}

test("the flag is read from process.env on every call", () => {
  setEnv({ DASHBOARD_DB_READ_ONLY: "1" })
  assert.equal(isDashboardDbReadOnly(), true)

  setEnv({ DASHBOARD_DB_READ_ONLY: "0" })
  assert.equal(isDashboardDbReadOnly(), false)
})
