import assert from "node:assert/strict"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import test, { after, afterEach, before } from "node:test"

const ENV_KEYS = [
  "DASHBOARD_DATA_SOURCE",
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DASHBOARD_DB_READ_ONLY",
  "VERCEL_ENV",
] as const
// Snapshotted in before() so this file never reads process.env at module scope.
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}
const UNREACHABLE_DATABASE_URL = "postgresql://x:y@127.0.0.1:1/x"

const ORIGINAL_CWD = process.cwd()
const TEMP_CWD = mkdtempSync(path.join(tmpdir(), "consult-me-history-read-only-"))
const TEMP_DATA_DIR = path.join(TEMP_CWD, "data")
const TEMP_HISTORY_FILE = path.join(TEMP_DATA_DIR, "consult-me-history.json")

// history-store.ts resolves HISTORY_FILE from process.cwd() at import time, so the
// working directory must point at the temp dir before the module is first imported.
process.chdir(TEMP_CWD)
const historyStore = await import("../lib/consult-me/history-store.ts")
const dbClient = await import("../lib/db/client.ts")
const historyRoute = await import("../app/api/consult-me/history/route.ts")

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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
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

after(async () => {
  await dbClient.closeDatabasePools()
  process.chdir(ORIGINAL_CWD)
  rmSync(TEMP_CWD, { recursive: true, force: true })
})

test("postgres + read-only: upsert returns the patch-derived record without touching the database", async () => {
  setEnv({ DASHBOARD_DATA_SOURCE: "postgres", DATABASE_URL: UNREACHABLE_DATABASE_URL, DASHBOARD_DB_READ_ONLY: "1" })

  const before = Date.now()
  const record = await withTimeout(
    historyStore.upsertConsultMeHistoryRecord({
      taskId: "task-preview-1",
      companyKey: "innova",
      companyLabel: "Innova",
      researchType: "company",
      researchSubject: "Innova",
    }),
    1_000,
    "read-only upsert"
  )
  const afterCall = Date.now()

  assert.equal(record.taskId, "task-preview-1")
  assert.equal(record.companyKey, "innova")
  assert.equal(record.companyLabel, "Innova")
  assert.equal(record.researchType, "company")
  assert.equal(record.researchSubject, "Innova")
  assert.equal(record.status, "queued")
  assert.equal(record.hasReport, false)
  assert.deepEqual(record.deliverables, [])
  assert.equal(record.completedAt, undefined)
  for (const stamp of [record.createdAt, record.updatedAt]) {
    const parsed = Date.parse(stamp)
    assert.ok(parsed >= before - 1 && parsed <= afterCall + 1, `timestamp ${stamp} should be "now"`)
  }
  assert.equal(globalThis.__dashboardPgPool, undefined, "no pg pool should have been created")
})

test("postgres + read-only: upsert applies the same defaults as a new record on the normal path", async () => {
  setEnv({ DASHBOARD_DATA_SOURCE: "postgres", DATABASE_URL: UNREACHABLE_DATABASE_URL, DASHBOARD_DB_READ_ONLY: "1" })

  const record = await withTimeout(
    historyStore.upsertConsultMeHistoryRecord({ taskId: "task-preview-defaults" }),
    1_000,
    "read-only upsert"
  )

  assert.equal(record.taskId, "task-preview-defaults")
  assert.equal(record.companyKey, "")
  assert.equal(record.companyLabel, "")
  assert.equal(record.researchType, "custom")
  assert.equal(record.researchSubject, "")
  assert.equal(record.status, "queued")
  assert.equal(record.hasReport, false)
  assert.deepEqual(record.deliverables, [])
  assert.equal(globalThis.__dashboardPgPool, undefined, "no pg pool should have been created")
})

test("postgres + read-only: both delete functions reject with HistoryStoreReadOnlyError", async () => {
  setEnv({ DASHBOARD_DATA_SOURCE: "postgres", DATABASE_URL: UNREACHABLE_DATABASE_URL, DASHBOARD_DB_READ_ONLY: "1" })

  await assert.rejects(
    withTimeout(historyStore.deleteConsultMeHistoryByTask("task-preview-1"), 1_000, "delete by task"),
    (error: unknown) => {
      assert.ok(error instanceof historyStore.HistoryStoreReadOnlyError)
      assert.equal(error.name, "HistoryStoreReadOnlyError")
      assert.equal(error.message, "Consult Me history is read-only in preview deployments.")
      return true
    }
  )
  await assert.rejects(
    withTimeout(historyStore.deleteConsultMeHistoryByTask("seed:innova"), 1_000, "delete seed by task"),
    historyStore.HistoryStoreReadOnlyError
  )
  await assert.rejects(
    withTimeout(historyStore.deleteConsultMeHistoryByCompany("innova"), 1_000, "delete by company"),
    historyStore.HistoryStoreReadOnlyError
  )
  assert.equal(globalThis.__dashboardPgPool, undefined, "no pg pool should have been created")
})

test("DELETE /api/consult-me/history maps the read-only error to 409", async () => {
  setEnv({ DASHBOARD_DATA_SOURCE: "postgres", DATABASE_URL: UNREACHABLE_DATABASE_URL, DASHBOARD_DB_READ_ONLY: "1" })

  for (const query of ["taskId=task-preview-1", "companyKey=innova"]) {
    const response = await historyRoute.DELETE(new Request(`http://localhost/api/consult-me/history?${query}`))
    assert.equal(response.status, 409)
    assert.deepEqual(await response.json(), {
      error: "Consult Me history is read-only in preview deployments.",
      readOnly: true,
    })
  }

  const missingTarget = await historyRoute.DELETE(new Request("http://localhost/api/consult-me/history"))
  assert.equal(missingTarget.status, 400)
  assert.equal(globalThis.__dashboardPgPool, undefined, "no pg pool should have been created")
})

test("file + read-only: upsert does not create the history file", async () => {
  setEnv({ DASHBOARD_DATA_SOURCE: "file", DASHBOARD_DB_READ_ONLY: "1" })

  const record = await historyStore.upsertConsultMeHistoryRecord({ taskId: "task-file-ro" })

  assert.equal(record.taskId, "task-file-ro")
  assert.equal(existsSync(TEMP_HISTORY_FILE), false)
  assert.equal(existsSync(TEMP_DATA_DIR), false)
})

test("file + read-only: delete functions reject and leave an existing history file untouched", async () => {
  // Control: with the flag off, the file store writes under the temp cwd, which proves
  // HISTORY_FILE resolved there (so the read-only "file absent" assertion is meaningful).
  setEnv({ DASHBOARD_DATA_SOURCE: "file", DASHBOARD_DB_READ_ONLY: "0" })
  await historyStore.upsertConsultMeHistoryRecord({ taskId: "task-file-rw", companyKey: "innova" })
  assert.equal(existsSync(TEMP_HISTORY_FILE), true)
  const written = readFileSync(TEMP_HISTORY_FILE, "utf8")

  setEnv({ DASHBOARD_DATA_SOURCE: "file", DASHBOARD_DB_READ_ONLY: "1" })
  await assert.rejects(
    historyStore.deleteConsultMeHistoryByTask("task-file-rw"),
    historyStore.HistoryStoreReadOnlyError
  )
  await assert.rejects(
    historyStore.deleteConsultMeHistoryByCompany("innova"),
    historyStore.HistoryStoreReadOnlyError
  )
  await historyStore.upsertConsultMeHistoryRecord({ taskId: "task-file-rw", status: "completed" })

  assert.equal(readFileSync(TEMP_HISTORY_FILE, "utf8"), written)
})

test("negative control: flag off + unreachable postgres takes the DB path and rejects", async () => {
  setEnv({ DASHBOARD_DATA_SOURCE: "postgres", DATABASE_URL: UNREACHABLE_DATABASE_URL, DASHBOARD_DB_READ_ONLY: "0" })

  await assert.rejects(
    withTimeout(
      historyStore.upsertConsultMeHistoryRecord({ taskId: "task-db-path" }),
      15_000,
      "flag-off upsert"
    ),
    (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.doesNotMatch(error.message, /did not settle/)
      return true
    }
  )
})
