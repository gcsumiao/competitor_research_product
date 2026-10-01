type CheckResult = {
  errors: string[]
  warnings: string[]
}

type CheckTarget = "production" | "preview"

const REQUIRED_ENV_KEYS = [
  "DATABASE_URL",
  "DATABASE_URL_UNPOOLED",
  "DASHBOARD_DATA_SOURCE",
  "DASHBOARD_DEPLOYMENT_MODE",
  "DASHBOARD_REVALIDATE_SECRET",
  "DASHBOARD_REVALIDATE_URL",
] as const

const REQUIRED_ACCESS_ENV_KEYS = [
  "CF_ACCESS_TEAM_DOMAIN",
  "CF_ACCESS_AUDIENCES",
  "CF_ACCESS_USERS_GROUP_ID",
  "CF_ACCESS_ADMIN_GROUP_ID",
  "CF_ACCESS_AUTOMATION_CLIENT_ID",
] as const

// Preview deployments may omit the revalidate URL (ingest only revalidates Production).
const PREVIEW_OPTIONAL_ENV_KEYS: ReadonlySet<string> = new Set(["DASHBOARD_REVALIDATE_URL"])

const TRUTHY_ENV_VALUES = ["1", "true", "yes", "on"]

const NEON_OWNER_ROLE = "neondb_owner"
const PREVIEW_READ_ONLY_ROLE = "dashboard_preview_ro"

function main() {
  const target = parseTarget(process.argv.slice(2))
  if (!target) {
    console.error('ERROR: Unknown --target value. Use "--target preview", or omit --target for the production check.')
    process.exitCode = 1
    return
  }

  const result: CheckResult = { errors: [], warnings: [] }
  const env = process.env

  for (const key of REQUIRED_ENV_KEYS) {
    if (target === "preview" && PREVIEW_OPTIONAL_ENV_KEYS.has(key)) continue
    if (!env[key]?.trim()) {
      result.errors.push(`Missing ${key}.`)
    }
  }

  const accessEnabled = isTruthyEnv(env.CF_ACCESS_ENABLED)
  if (accessEnabled) {
    for (const key of REQUIRED_ACCESS_ENV_KEYS) {
      if (!env[key]?.trim()) result.errors.push(`Missing ${key} while CF_ACCESS_ENABLED is true.`)
    }
    validateAccessTeamDomain(env.CF_ACCESS_TEAM_DOMAIN, result)
  } else {
    result.warnings.push("CF_ACCESS_ENABLED is not true; the Vercel origin will accept direct traffic.")
  }

  if ((env.DASHBOARD_DATA_SOURCE ?? "").trim().toLowerCase() !== "postgres") {
    result.errors.push("DASHBOARD_DATA_SOURCE must be set to postgres for Neon/Vercel deployment.")
  }

  if (target === "production" && (env.DASHBOARD_DEPLOYMENT_MODE ?? "").trim().toLowerCase() !== "full") {
    result.errors.push("DASHBOARD_DEPLOYMENT_MODE must be set to full for production deployment.")
  }

  const readOnly = isTruthyEnv(env.DASHBOARD_DB_READ_ONLY)
  if (readOnly && env.VERCEL_ENV === "production") {
    result.errors.push("DASHBOARD_DB_READ_ONLY must be unset or false when VERCEL_ENV=production.")
  }

  if (target === "preview") {
    if (!readOnly) {
      result.errors.push("DASHBOARD_DB_READ_ONLY must be set to 1/true for preview deployments.")
    }
    // Exact match decides: any role other than the read-only one (not just the owner) fails.
    for (const name of ["DATABASE_URL", "DATABASE_URL_UNPOOLED"] as const) {
      if (!env[name]?.trim()) continue // already reported as missing
      const role = safeUsername(env[name] ?? "")
      if (role === PREVIEW_READ_ONLY_ROLE) continue
      const found = role === null ? "no parseable role" : `role ${role}`
      const hint = role === NEON_OWNER_ROLE ? " (the owner role can write to production)" : ""
      result.errors.push(`${name} uses ${found}${hint}; preview must use exactly ${PREVIEW_READ_ONLY_ROLE}.`)
    }
  }

  validateDatabaseUrl("DATABASE_URL", env.DATABASE_URL, result)
  validateDatabaseUrl("DATABASE_URL_UNPOOLED", env.DATABASE_URL_UNPOOLED, result)
  validateRevalidateUrl(env.DASHBOARD_REVALIDATE_URL, result)

  if (env.DATABASE_URL && env.DATABASE_URL_UNPOOLED && env.DATABASE_URL === env.DATABASE_URL_UNPOOLED) {
    result.errors.push("DATABASE_URL and DATABASE_URL_UNPOOLED must not be identical. Use pooled runtime and direct operational URLs.")
  }

  if (env.VERCEL_ENV && !["preview", "production", "development"].includes(env.VERCEL_ENV)) {
    result.warnings.push(`Unexpected VERCEL_ENV value: ${env.VERCEL_ENV}`)
  }

  if (env.VERCEL === "1" && !env.VERCEL_ENV) {
    result.warnings.push("VERCEL is set but VERCEL_ENV is missing. Confirm Vercel env injection is correct.")
  }

  if (env.VERCEL_URL && env.DASHBOARD_REVALIDATE_URL) {
    const host = safeHostname(env.DASHBOARD_REVALIDATE_URL)
    const isExpectedPagesProxy = accessEnabled && host?.endsWith(".pages.dev")
    if (host && host !== env.VERCEL_URL && !host.endsWith(env.VERCEL_URL) && !isExpectedPagesProxy) {
      result.warnings.push(
        `DASHBOARD_REVALIDATE_URL host (${host}) does not match VERCEL_URL (${env.VERCEL_URL}). Confirm you are targeting the intended deployment domain.`
      )
    }
  }

  printSummary(result, target)

  if (result.errors.length > 0) {
    process.exitCode = 1
  }
}

function parseTarget(argv: string[]): CheckTarget | null {
  let value: string | undefined
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--target") {
      value = argv[index + 1] ?? ""
      index += 1
    } else if (arg.startsWith("--target=")) {
      value = arg.slice("--target=".length)
    }
  }
  if (value === undefined) return "production"
  const normalized = value.trim().toLowerCase()
  return normalized === "preview" || normalized === "production" ? normalized : null
}

function isTruthyEnv(value: string | undefined) {
  return TRUTHY_ENV_VALUES.includes((value ?? "").trim().toLowerCase())
}

function validateAccessTeamDomain(value: string | undefined, result: CheckResult) {
  if (!value?.trim()) return
  try {
    const parsed = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
    if (parsed.protocol !== "https:" || !parsed.hostname.endsWith(".cloudflareaccess.com")) {
      result.errors.push("CF_ACCESS_TEAM_DOMAIN must be an https://*.cloudflareaccess.com URL.")
    }
  } catch {
    result.errors.push("CF_ACCESS_TEAM_DOMAIN is not a valid URL.")
  }
}

function validateDatabaseUrl(name: string, value: string | undefined, result: CheckResult) {
  if (!value?.trim()) return
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      result.errors.push(`${name} must use postgres:// or postgresql://.`)
    }
  } catch {
    result.errors.push(`${name} is not a valid database URL.`)
  }
}

function validateRevalidateUrl(value: string | undefined, result: CheckResult) {
  if (!value?.trim()) return
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== "https:") {
      result.errors.push("DASHBOARD_REVALIDATE_URL must be an https URL for Preview/Production deployments.")
    }
  } catch {
    result.errors.push("DASHBOARD_REVALIDATE_URL is not a valid URL.")
  }
}

function safeHostname(value: string) {
  try {
    return new URL(value).hostname
  } catch {
    return null
  }
}

// Only the username is ever read from a connection string; never print passwords or full URLs.
function safeUsername(value: string) {
  try {
    const username = new URL(value).username
    return username ? decodeURIComponent(username) : null
  } catch {
    return null
  }
}

function printSummary(result: CheckResult, target: CheckTarget) {
  console.log(target === "preview" ? "Deployment env check (target: preview)" : "Deployment env check")
  console.log(`DATABASE_URL host: ${safeHostname(process.env.DATABASE_URL ?? "") ?? "n/a"}`)
  console.log(`DATABASE_URL role: ${safeUsername(process.env.DATABASE_URL ?? "") ?? "n/a"}`)
  console.log(`DATABASE_URL_UNPOOLED host: ${safeHostname(process.env.DATABASE_URL_UNPOOLED ?? "") ?? "n/a"}`)
  console.log(`DATABASE_URL_UNPOOLED role: ${safeUsername(process.env.DATABASE_URL_UNPOOLED ?? "") ?? "n/a"}`)
  console.log(`DASHBOARD_DATA_SOURCE: ${process.env.DASHBOARD_DATA_SOURCE ?? ""}`)
  console.log(`DASHBOARD_DEPLOYMENT_MODE: ${process.env.DASHBOARD_DEPLOYMENT_MODE ?? ""}`)
  console.log(`DASHBOARD_REVALIDATE_URL: ${process.env.DASHBOARD_REVALIDATE_URL ?? ""}`)
  console.log(`DASHBOARD_DB_READ_ONLY: ${process.env.DASHBOARD_DB_READ_ONLY ?? ""}`)
  console.log(`CF_ACCESS_ENABLED: ${process.env.CF_ACCESS_ENABLED ?? "false"}`)

  if (result.warnings.length > 0) {
    for (const warning of result.warnings) {
      console.warn(`WARNING: ${warning}`)
    }
  }

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      console.error(`ERROR: ${error}`)
    }
    return
  }

  console.log(
    target === "preview"
      ? "Environment contract looks valid for a read-only Neon + Vercel preview deployment."
      : "Environment contract looks valid for Neon + Vercel deployment."
  )
}

main()
