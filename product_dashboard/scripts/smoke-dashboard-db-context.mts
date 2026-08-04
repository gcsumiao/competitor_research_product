import { closeDatabasePools, queryDb } from "../lib/db/client.ts"

const EXCLUDED_INNOVA_3P_ASINS = ["B000EVYGZA", "B000KIMHRQ", "B082JCSB4Z", "B0FDLVW4G8"]
const RETAINED_INNOVA_5420_ASIN = "B09ZQ3ZQV2"

async function main() {
  const expectedMonth = process.argv[process.argv.indexOf("--expected-month") + 1]
  if (!/^\d{6}$/.test(expectedMonth ?? "")) {
    throw new Error("smoke database context requires --expected-month YYYYMM")
  }

  const snapshotResult = await queryDb<{
    snapshot_date: string | Date
    snapshot_payload: unknown
  }>(
    `
      SELECT snapshot_date, snapshot_payload
      FROM category_snapshots
      WHERE category_id = 'code_reader_scanner'
        AND to_char(snapshot_date, 'YYYYMM') = $1
      ORDER BY snapshot_date DESC
      LIMIT 1
    `,
    [expectedMonth],
    { direct: true }
  )
  const row = snapshotResult.rows[0]
  if (!row) {
    throw new Error(`No code_reader_scanner database snapshot found for ${expectedMonth}.`)
  }
  const payload =
    typeof row.snapshot_payload === "string"
      ? (JSON.parse(row.snapshot_payload) as Record<string, unknown>)
      : (row.snapshot_payload as Record<string, unknown>)
  const totals = payload?.totals as { revenue?: unknown; units?: unknown } | undefined
  const revenue = Number(totals?.revenue)
  const units = Number(totals?.units)
  if (!Number.isFinite(revenue) || !Number.isFinite(units)) {
    throw new Error(`Database snapshot ${expectedMonth} is missing numeric revenue/units totals.`)
  }
  const serialized = JSON.stringify(payload)
  for (const asin of EXCLUDED_INNOVA_3P_ASINS) {
    if (serialized.includes(asin)) {
      throw new Error(`Database snapshot ${expectedMonth} still contains excluded ASIN ${asin}.`)
    }
  }
  if (!serialized.includes(RETAINED_INNOVA_5420_ASIN)) {
    throw new Error(`Database snapshot ${expectedMonth} is missing retained ASIN ${RETAINED_INNOVA_5420_ASIN}.`)
  }

  const artifactResult = await queryDb<{
    artifact_path: string
    category_id: string | null
  }>(
    `
      SELECT artifact_path, category_id
      FROM source_artifacts
      WHERE COALESCE((metadata->>'reportVisible')::boolean, false) = true
        AND category_id = 'code_reader_scanner'
        AND artifact_path LIKE '%' || $1::text || '%'
      ORDER BY updated_at DESC NULLS LAST, artifact_path ASC
      LIMIT 1
    `,
    [expectedMonth],
    { direct: true }
  )
  const artifact = artifactResult.rows[0]
  const date =
    row.snapshot_date instanceof Date
      ? row.snapshot_date.toISOString().slice(0, 10)
      : String(row.snapshot_date).slice(0, 10)

  console.log(
    JSON.stringify({
      expectedSnapshot: { date, totals: { revenue, units } },
      reportArtifact: artifact
        ? { artifactPath: artifact.artifact_path, categoryId: artifact.category_id }
        : null,
    })
  )
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDatabasePools()
  })
