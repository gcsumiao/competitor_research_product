import path from "node:path"
import { fileURLToPath } from "node:url"

import { triggerRevalidate } from "./_db-ingest-utils.mts"
import { ingestCodeReaderSnapshots } from "./db-ingest-code-reader.mts"
import { ingestNonCodeSnapshots } from "./db-ingest-non-code.mts"
import { DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG } from "../lib/db/constants.ts"
import { closeDatabasePools } from "../lib/db/client.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  await ingestCodeReaderSnapshots({
    archiveDir: path.resolve(__dirname, "..", "data", "code_reader_scanner"),
    writeFileArchive: false,
    revalidateUrl: process.env.DASHBOARD_REVALIDATE_URL,
    revalidateSecret: process.env.DASHBOARD_REVALIDATE_SECRET,
    skipRevalidate: true,
  })
  await ingestNonCodeSnapshots({
    revalidateUrl: process.env.DASHBOARD_REVALIDATE_URL,
    revalidateSecret: process.env.DASHBOARD_REVALIDATE_SECRET,
    skipRevalidate: true,
  })
  await triggerRevalidate({
    baseUrl: process.env.DASHBOARD_REVALIDATE_URL,
    secret: process.env.DASHBOARD_REVALIDATE_SECRET,
    tags: [DASHBOARD_DATA_TAG, REPORT_FILES_TAG, TYPE_SUMMARIES_TAG],
  })
  console.log("Database backfill completed.")
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDatabasePools()
  })
