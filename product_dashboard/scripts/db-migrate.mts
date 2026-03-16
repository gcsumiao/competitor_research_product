import { readdir, readFile } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { closeDatabasePools, queryDb, withDbTransaction } from "../lib/db/client.ts"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const appRoot = path.resolve(__dirname, "..")
const migrationsDir = path.join(appRoot, "db", "migrations")

async function main() {
  const files = (await readdir(migrationsDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b))

  await queryDb(
    `
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `,
    [],
    { direct: true }
  )

  const appliedResult = await queryDb<{ version: string }>(
    `SELECT version FROM schema_migrations`,
    [],
    { direct: true }
  )
  const applied = new Set(appliedResult.rows.map((row) => row.version))

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`Skipping ${file} (already applied)`)
      continue
    }

    const fullPath = path.join(migrationsDir, file)
    const sql = await readFile(fullPath, "utf8")
    console.log(`Applying ${file}`)
    await withDbTransaction(async (client) => {
      await client.query(sql)
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [file])
    }, { direct: true })
  }

  console.log("Database migrations are up to date.")
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(async () => {
    await closeDatabasePools()
  })
