import assert from "node:assert/strict"
import test, { after, before } from "node:test"

// Seed files resolve from <cwd>/data (or <cwd>/product_dashboard/data), so run from the app root.
// Force the file-backed history store: this test only reads seeds, never the database.
const ENV_KEYS = ["DASHBOARD_DATA_SOURCE", "DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {}

before(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
  for (const key of ENV_KEYS) delete process.env[key]
})

after(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key]
    else process.env[key] = originalEnv[key]
  }
})

const seedReports = await import("../lib/consult-me/seed-reports.ts")
const historyStore = await import("../lib/consult-me/history-store.ts")
const downloadRoute = await import("../app/api/consult-me/download/route.ts")
const { isNewerMonth } = await import("../components/consult-me/brief-hero-card.tsx")

function download(query: string) {
  return downloadRoute.GET(new Request(`http://localhost/api/consult-me/download?${query}`))
}

test("XTOOL seed carries a brief with both assets; Topdon and Ancel carry none", async () => {
  const reports = await seedReports.listSeedReports()
  const byKey = new Map(reports.map((report) => [report.companyKey, report]))

  const xtool = byKey.get("xtool")
  assert.ok(xtool?.brief, "xtool brief missing")
  assert.equal(xtool.brief.seedId, "seed:xtool")
  assert.deepEqual(xtool.brief.assets, ["html", "pdf"])
  assert.equal(xtool.brief.threatLevel, "high")
  assert.equal(xtool.brief.highlights.length, 3)
  assert.equal(byKey.get("topdon")?.brief, undefined)
  assert.equal(byKey.get("ancel")?.brief, undefined)
})

test("history flags the brief on the XTOOL record and company summary", async () => {
  const history = await historyStore.listConsultMeHistory()
  const company = history.companies.find((item) => item.companyKey === "xtool")
  const record = history.recent.find((item) => item.taskId === "seed:xtool")
  assert.equal(company?.hasBrief, true)
  assert.equal(record?.hasBrief, true)
  assert.notEqual(history.companies.find((item) => item.companyKey === "topdon")?.hasBrief, true)
})

test("brief HTML is served inline under a CSP sandbox", async () => {
  const response = await download("seedId=seed:xtool&brief=html&disposition=inline")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8")
  assert.match(response.headers.get("content-security-policy") ?? "", /^sandbox allow-scripts\b/)
  assert.equal(response.headers.get("x-content-type-options"), "nosniff")
  assert.match(response.headers.get("content-disposition") ?? "", /^inline; filename="xtool_innova_threat_brief\.html"$/)
  assert.match(await response.text(), /<title>XTOOL Threat Assessment<\/title>/)
})

test("brief PDF downloads as an attachment", async () => {
  const response = await download("seedId=seed:xtool&brief=pdf")
  assert.equal(response.status, 200)
  assert.equal(response.headers.get("content-type"), "application/pdf")
  assert.match(response.headers.get("content-disposition") ?? "", /^attachment; /)
  const bytes = new Uint8Array(await response.arrayBuffer())
  assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-")
})

test("brief requests are validated", async () => {
  assert.equal((await download("seedId=seed:xtool&brief=docx")).status, 400)
  assert.equal((await download("seedId=seed:topdon&brief=html")).status, 404)
  assert.equal((await download("seedId=seed:unknown&brief=pdf")).status, 404)
})

test("newer-data hint compares calendar months only", () => {
  assert.equal(isNewerMonth("2026-11-30", "2026-10-31"), true)
  assert.equal(isNewerMonth("2026-10-31", "2026-10-31"), false)
  assert.equal(isNewerMonth("2026-10-15", "2026-10-31"), false)
  assert.equal(isNewerMonth(undefined, "2026-10-31"), false)
})
