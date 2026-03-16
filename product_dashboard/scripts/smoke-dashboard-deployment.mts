import { closeDatabasePools, queryDb } from "../lib/db/client.ts"

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

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const baseUrl = normalizeBaseUrl(args.baseUrl ?? process.env.DASHBOARD_REVALIDATE_URL)
  if (!baseUrl) {
    throw new Error("Missing --base-url or DASHBOARD_REVALIDATE_URL.")
  }

  for (const pagePath of DASHBOARD_PAGES) {
    await expectOkHtml(new URL(pagePath, baseUrl).toString(), `page ${pagePath}`)
  }

  const historyResponse = await fetch(new URL("/api/consult-me/history", baseUrl))
  await expectOkJson(historyResponse, "consult-me history")

  const spotlightResponse = await fetch(
    new URL("/api/spotlight?category=code_reader_scanner", baseUrl)
  )
  const spotlight = (await expectOkJson(spotlightResponse, "spotlight")) as SpotlightPayload
  if (!spotlight.snapshotDate) {
    throw new Error("Spotlight response did not include snapshotDate.")
  }

  const chatResponse = await fetch(new URL("/api/chat", baseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "How did we do this month?",
      categoryId: "code_reader_scanner",
      snapshotDate: spotlight.snapshotDate,
      pathname: "/",
    }),
  })
  const chatPayload = (await expectOkJson(chatResponse, "chat")) as { answer?: string }
  if (!chatPayload.answer?.trim()) {
    throw new Error("Chat response did not include an answer.")
  }

  const reportArtifact = await loadLatestVisibleArtifact()
  if (reportArtifact) {
    const reportUrl = new URL("/api/report", baseUrl)
    reportUrl.searchParams.set("file", reportArtifact.artifactPath)
    reportUrl.searchParams.set("source", reportArtifact.categoryId ?? "code_reader_scanner")
    const reportResponse = await fetch(reportUrl)
    if (!reportResponse.ok) {
      throw new Error(`report download failed: ${reportResponse.status}`)
    }
    const contentType = reportResponse.headers.get("content-type") ?? ""
    if (!contentType.includes("spreadsheetml.sheet")) {
      throw new Error(`Unexpected report content type: ${contentType}`)
    }
  } else {
    console.warn("WARNING: No visible report artifact found in database. Skipped /api/report smoke check.")
  }

  const revalidateSecret = args.revalidateSecret ?? process.env.DASHBOARD_REVALIDATE_SECRET
  if (revalidateSecret) {
    const revalidateUrl = new URL("/api/revalidate", baseUrl)
    revalidateUrl.searchParams.set("secret", revalidateSecret)
    revalidateUrl.searchParams.set("tag", "dashboard-data")
    const response = await fetch(revalidateUrl, { method: "POST" })
    await expectOkJson(response, "revalidate")
  } else {
    console.warn("WARNING: Missing revalidate secret. Skipped /api/revalidate smoke check.")
  }

  console.log(`Smoke test passed for ${baseUrl}`)
}

async function loadLatestVisibleArtifact() {
  if (!process.env.DATABASE_URL_UNPOOLED && !process.env.DATABASE_URL) {
    return null
  }

  const result = await queryDb<{
    artifact_path: string
    category_id: string | null
  }>(
    `
      SELECT artifact_path, category_id
      FROM source_artifacts
      WHERE COALESCE((metadata->>'reportVisible')::boolean, false) = true
      ORDER BY updated_at DESC NULLS LAST, artifact_path ASC
      LIMIT 1
    `,
    [],
    { direct: true }
  )

  const row = result.rows[0]
  if (!row) return null
  return {
    artifactPath: row.artifact_path,
    categoryId: row.category_id,
  }
}

async function expectOkHtml(url: string, label: string) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status}`)
  }
  const contentType = response.headers.get("content-type") ?? ""
  if (!contentType.includes("text/html")) {
    throw new Error(`${label} returned unexpected content type: ${contentType}`)
  }
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
  } = {}

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === "--base-url") args.baseUrl = argv[index + 1]
    if (value === "--revalidate-secret") args.revalidateSecret = argv[index + 1]
  }

  return args
}

function normalizeBaseUrl(value: string | undefined) {
  if (!value?.trim()) return null
  const parsed = new URL(value)
  return parsed.toString().endsWith("/") ? parsed.toString() : `${parsed.toString()}/`
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDatabasePools()
  })
