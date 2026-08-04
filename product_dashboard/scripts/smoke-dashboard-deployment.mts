import { execFile } from "node:child_process"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const DASHBOARD_PAGES = [
  "/",
  "/sales",
  "/customers",
  "/orders",
  "/reports",
  "/specs",
  "/consult-me",
] as const

type SpotlightPayload = {
  categoryId: string
  snapshotDate: string
  alerts: Array<{ id: string }>
}

type ChatPayload = {
  answer?: string
  snapshotUsed?: string
  evidence?: Array<{ label: string; value: string }>
}

type ExpectedSnapshot = {
  date: string
  totals: { revenue: number; units: number }
}

type DbContext = {
  expectedSnapshot: ExpectedSnapshot
  reportArtifact: { artifactPath: string; categoryId: string | null } | null
}

const COLD_CHAT_LIMIT_MS = 15_000
const WARM_CHAT_LIMIT_MS = 5_000

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = normalizeBaseUrl(args.baseUrl ?? process.env.DASHBOARD_REVALIDATE_URL)
  if (!baseUrl) {
    throw new Error("Missing --base-url or DASHBOARD_REVALIDATE_URL.")
  }

  const spotlightResponse = await fetch(
    new URL("/api/spotlight?category=code_reader_scanner", baseUrl),
    { headers: { Connection: "close" } }
  )
  const spotlight = (await expectOkJson(spotlightResponse, "spotlight")) as SpotlightPayload
  console.log(`Passed spotlight for ${spotlight.snapshotDate}`)
  if (!spotlight.snapshotDate) {
    throw new Error("Spotlight response did not include snapshotDate.")
  }

  const firstChat = await loadChat(baseUrl, spotlight.snapshotDate, "cold chat")
  console.log(`Passed cold chat in ${firstChat.elapsedMs}ms`)
  if (firstChat.elapsedMs >= COLD_CHAT_LIMIT_MS) {
    throw new Error(`Cold chat exceeded ${COLD_CHAT_LIMIT_MS}ms: ${firstChat.elapsedMs}ms`)
  }
  const secondChat = await loadChat(baseUrl, spotlight.snapshotDate, "warm chat")
  console.log(`Passed warm chat in ${secondChat.elapsedMs}ms`)
  if (secondChat.elapsedMs >= WARM_CHAT_LIMIT_MS) {
    throw new Error(`Warm chat exceeded ${WARM_CHAT_LIMIT_MS}ms: ${secondChat.elapsedMs}ms`)
  }

  const dbContext = args.expectedMonth ? await loadDbContext(args.expectedMonth) : null
  const expectedSnapshot = dbContext?.expectedSnapshot ?? null
  if (expectedSnapshot) {
    if (spotlight.snapshotDate !== expectedSnapshot.date) {
      throw new Error(
        `Spotlight snapshot mismatch: expected ${expectedSnapshot.date}, got ${spotlight.snapshotDate}`
      )
    }
    validateChatAgainstExpected(firstChat.payload, expectedSnapshot)
    validateChatAgainstExpected(secondChat.payload, expectedSnapshot)
  }

  const reportArtifact = dbContext?.reportArtifact ?? null
  if (reportArtifact) {
    const reportUrl = new URL("/api/report", baseUrl)
    reportUrl.searchParams.set("file", reportArtifact.artifactPath)
    reportUrl.searchParams.set("source", reportArtifact.categoryId ?? "code_reader_scanner")
    const reportResponse = await fetch(reportUrl, { headers: { Connection: "close" } })
    if (!reportResponse.ok) {
      throw new Error(`report download failed: ${reportResponse.status}`)
    }
    const contentType = reportResponse.headers.get("content-type") ?? ""
    if (!contentType.includes("spreadsheetml.sheet")) {
      throw new Error(`Unexpected report content type: ${contentType}`)
    }
    await reportResponse.arrayBuffer()
  } else {
    console.warn("WARNING: No visible report artifact found in database. Skipped /api/report smoke check.")
  }

  const historyResponse = await fetch(new URL("/api/consult-me/history", baseUrl), {
    headers: { Connection: "close" },
  })
  await expectOkJson(historyResponse, "consult-me history")
  console.log("Passed consult-me history")

  const revalidateSecret = args.revalidateSecret ?? process.env.DASHBOARD_REVALIDATE_SECRET
  if (revalidateSecret) {
    const revalidateUrl = new URL("/api/revalidate", baseUrl)
    revalidateUrl.searchParams.set("secret", revalidateSecret)
    revalidateUrl.searchParams.set("tag", "dashboard-data")
    const response = await fetch(revalidateUrl, {
      method: "POST",
      headers: { Connection: "close" },
    })
    await expectOkJson(response, "revalidate")
  } else {
    console.warn("WARNING: Missing revalidate secret. Skipped /api/revalidate smoke check.")
  }

  for (const pagePath of DASHBOARD_PAGES) {
    const startedAt = Date.now()
    await expectOkHtml(new URL(pagePath, baseUrl).toString(), `page ${pagePath}`)
    console.log(`Passed page ${pagePath} in ${Date.now() - startedAt}ms`)
  }

  console.log(`Smoke test passed for ${baseUrl}`)
  console.log(`Chat timings: cold=${firstChat.elapsedMs}ms warm=${secondChat.elapsedMs}ms`)
}

async function loadDbContext(expectedMonth: string): Promise<DbContext> {
  if (!/^\d{6}$/.test(expectedMonth)) {
    throw new Error(`Invalid --expected-month ${expectedMonth}; expected YYYYMM.`)
  }
  if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
    throw new Error("--expected-month requires DATABASE_URL_UNPOOLED or DATABASE_URL.")
  }

  const helperPath = fileURLToPath(new URL("./smoke-dashboard-db-context.mts", import.meta.url))
  const { stdout } = await execFileAsync(
    process.execPath,
    ["--import", "tsx", helperPath, "--expected-month", expectedMonth],
    { env: process.env, maxBuffer: 1024 * 1024 }
  )
  const payload = JSON.parse(stdout.trim()) as DbContext
  if (!payload.expectedSnapshot?.date) {
    throw new Error(`Database smoke context did not return a snapshot for ${expectedMonth}.`)
  }
  return payload
}

async function loadChat(baseUrl: string, snapshotDate: string, label: string) {
  const startedAt = Date.now()
  let response: Response
  try {
    response = await fetch(new URL("/api/chat", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json", Connection: "close" },
      body: JSON.stringify({
        message: "How did we do this month?",
        categoryId: "code_reader_scanner",
        snapshotDate,
        pathname: "/",
      }),
      signal: AbortSignal.timeout(COLD_CHAT_LIMIT_MS),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${label} request failed after ${Date.now() - startedAt}ms: ${message}`)
  }
  const payload = (await expectOkJson(response, label)) as ChatPayload
  if (!payload.answer?.trim()) {
    throw new Error(`${label} response did not include an answer.`)
  }
  return { payload, elapsedMs: Date.now() - startedAt }
}

function validateChatAgainstExpected(payload: ChatPayload, expected: ExpectedSnapshot) {
  if (payload.snapshotUsed !== expected.date) {
    throw new Error(`Chat snapshotUsed mismatch: expected ${expected.date}, got ${payload.snapshotUsed}`)
  }
  const evidence = new Map((payload.evidence ?? []).map((item) => [item.label, item.value]))
  const expectedRevenue = compactCurrency(expected.totals.revenue)
  const expectedUnits = compactNumber(expected.totals.units)
  if (evidence.get("Market Revenue") !== expectedRevenue) {
    throw new Error(
      `Chat Market Revenue mismatch: expected ${expectedRevenue}, got ${evidence.get("Market Revenue")}`
    )
  }
  if (evidence.get("Market Units") !== expectedUnits) {
    throw new Error(
      `Chat Market Units mismatch: expected ${expectedUnits}, got ${evidence.get("Market Units")}`
    )
  }
}

function compactCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}

async function expectOkHtml(url: string, label: string) {
  const response = await fetch(url, {
    headers: { Connection: "close" },
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status}`)
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html")) {
    throw new Error(`${label} returned unexpected content type: ${contentType}`)
  }
  await response.arrayBuffer()
}

async function expectOkJson(response: Response, label: string) {
  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${label} failed: ${response.status} ${body}`)
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("application/json")) {
    throw new Error(`${label} returned unexpected content type: ${contentType}`)
  }
  return response.json()
}

function parseArgs(argv: string[]) {
  const args: {
    baseUrl?: string
    revalidateSecret?: string
    expectedMonth?: string
  } = {}

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--base-url") args.baseUrl = argv[index + 1]
    if (value === "--revalidate-secret") args.revalidateSecret = argv[index + 1]
    if (value === "--expected-month") args.expectedMonth = argv[index + 1]
  }

  return args
}

function normalizeBaseUrl(value: string | undefined) {
  if (!value?.trim()) return null
  const parsed = new URL(value)
  return parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
