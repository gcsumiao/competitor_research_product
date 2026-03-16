import { Pool, type PoolClient, type QueryResultRow, types } from "pg"

const NUMERIC_OID = 1700
const INT8_OID = 20

let parsersRegistered = false

declare global {
  var __dashboardPgPool: Pool | undefined
  var __dashboardPgPoolDirect: Pool | undefined
}

function registerTypeParsers() {
  if (parsersRegistered) return
  types.setTypeParser(NUMERIC_OID, (value) => (value === null ? null : Number(value)))
  types.setTypeParser(INT8_OID, (value) => (value === null ? null : Number(value)))
  parsersRegistered = true
}

function resolveDatabaseUrl(useDirectConnection = false) {
  const direct = (process.env.DATABASE_URL_UNPOOLED ?? "").trim()
  const pooled = (process.env.DATABASE_URL ?? "").trim()
  const value = useDirectConnection ? direct || pooled : pooled || direct
  return value
}

function createPool(connectionString: string) {
  registerTypeParsers()
  return new Pool({
    connectionString,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    allowExitOnIdle: false,
  })
}

export function hasDatabaseConnection(useDirectConnection = false) {
  return Boolean(resolveDatabaseUrl(useDirectConnection))
}

export function getDatabasePool(options?: { direct?: boolean }) {
  const direct = options?.direct ?? false
  const connectionString = resolveDatabaseUrl(direct)
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.")
  }

  if (direct) {
    if (!globalThis.__dashboardPgPoolDirect) {
      globalThis.__dashboardPgPoolDirect = createPool(connectionString)
    }
    return globalThis.__dashboardPgPoolDirect
  }

  if (!globalThis.__dashboardPgPool) {
    globalThis.__dashboardPgPool = createPool(connectionString)
  }
  return globalThis.__dashboardPgPool
}

export async function queryDb<T extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
  options?: { direct?: boolean }
) {
  const pool = getDatabasePool({ direct: options?.direct })
  return pool.query<T>(text, values)
}

export async function withDbTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options?: { direct?: boolean }
) {
  const pool = getDatabasePool({ direct: options?.direct })
  const client = await pool.connect()
  try {
    await client.query("BEGIN")
    const result = await fn(client)
    await client.query("COMMIT")
    return result
  } catch (error) {
    await client.query("ROLLBACK")
    throw error
  } finally {
    client.release()
  }
}

export async function closeDatabasePools() {
  await Promise.all([
    globalThis.__dashboardPgPool?.end(),
    globalThis.__dashboardPgPoolDirect?.end(),
  ])
  globalThis.__dashboardPgPool = undefined
  globalThis.__dashboardPgPoolDirect = undefined
}
