import path from "node:path"
import { fileURLToPath } from "node:url"

import { ingestCodeReaderSnapshots } from "./db-ingest-code-reader.mts"
import { ingestNonCodeSnapshots } from "./db-ingest-non-code.mts"
import { closeDatabasePools } from "../lib/db/client.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

async function main() {
  await ingestCodeReaderSnapshots({
    archiveDir: path.resolve(__dirname, "..", "data", "code_reader_scanner"),
    writeFileArchive: false,
    revalidateUrl: process.env.DASHBOARD_REVALIDATE_URL,
    revalidateSecret: process.env.DASHBOARD_REVALIDATE_SECRET,
  })
  await ingestNonCodeSnapshots({
    revalidateUrl: process.env.DASHBOARD_REVALIDATE_URL,
    revalidateSecret: process.env.DASHBOARD_REVALIDATE_SECRET,
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
