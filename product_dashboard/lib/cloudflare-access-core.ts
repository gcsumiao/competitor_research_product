import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from "jose"

export type DashboardUserRole = "admin" | "user"

export type DashboardUser = {
  id: string
  email: string
  displayName: string
  firstName?: string
  lastName?: string
  role: DashboardUserRole
}

export type CloudflareAccessPayload = JWTPayload & {
  common_name?: unknown
  custom?: unknown
  email?: unknown
  type?: unknown
}

export type CloudflareAccessConfig = {
  audiences: string[]
  teamDomain: string
}

type TokenVerifier = (token: string) => Promise<CloudflareAccessPayload>

const AUTOMATION_GET_PATHS = new Set([
  "/",
  "/consult-me",
  "/customers",
  "/orders",
  "/reports",
  "/sales",
  "/specs",
  "/api/consult-me/history",
  "/api/report",
  "/api/spotlight",
])

const AUTOMATION_POST_PATHS = new Set(["/api/chat", "/api/revalidate"])

let cachedVerifierKey = ""
let cachedVerifier: TokenVerifier | null = null

export class CloudflareAccessConfigurationError extends Error {}

export function isCloudflareAccessEnabled(env: NodeJS.ProcessEnv = process.env) {
  return ["1", "true", "yes", "on"].includes((env.CF_ACCESS_ENABLED ?? "").trim().toLowerCase())
}

export function readCloudflareAccessConfig(
  env: NodeJS.ProcessEnv = process.env
): CloudflareAccessConfig {
  const rawTeamDomain = (env.CF_ACCESS_TEAM_DOMAIN ?? "").trim()
  const audiences = (env.CF_ACCESS_AUDIENCES ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)

  if (!rawTeamDomain) {
    throw new CloudflareAccessConfigurationError("Missing CF_ACCESS_TEAM_DOMAIN.")
  }
  if (audiences.length === 0) {
    throw new CloudflareAccessConfigurationError("Missing CF_ACCESS_AUDIENCES.")
  }

  const teamDomain = normalizeTeamDomain(rawTeamDomain)
  return { audiences, teamDomain }
}

export function createCloudflareAccessVerifier(
  config: CloudflareAccessConfig,
  keyResolver?: JWTVerifyGetKey
): TokenVerifier {
  const jwks =
    keyResolver ?? createRemoteJWKSet(new URL(`${config.teamDomain}/cdn-cgi/access/certs`))

  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      audience: config.audiences,
      issuer: config.teamDomain,
    })
    return payload as CloudflareAccessPayload
  }
}

export async function verifyCloudflareAccessToken(token: string) {
  const config = readCloudflareAccessConfig()
  const cacheKey = `${config.teamDomain}|${config.audiences.join(",")}`
  if (!cachedVerifier || cachedVerifierKey !== cacheKey) {
    cachedVerifier = createCloudflareAccessVerifier(config)
    cachedVerifierKey = cacheKey
  }
  return cachedVerifier(token)
}

export function readPayloadString(payload: CloudflareAccessPayload, key: string) {
  const direct = firstString(payload[key])
  if (direct) return direct
  if (!isRecord(payload.custom)) return undefined
  return firstString(payload.custom[key])
}

export function isHumanAccessPayload(payload: CloudflareAccessPayload) {
  return payload.type === "app" && Boolean(readPayloadString(payload, "email"))
}

export function isAutomationAccessPayload(
  payload: CloudflareAccessPayload,
  expectedClientId = process.env.CF_ACCESS_AUTOMATION_CLIENT_ID
) {
  if (payload.type !== "app" || !expectedClientId?.trim()) return false
  return readPayloadString(payload, "common_name") === expectedClientId.trim()
}

export function isAutomationRouteAllowed(pathname: string, method: string) {
  const normalizedMethod = method.toUpperCase()
  if (normalizedMethod === "GET" || normalizedMethod === "HEAD") {
    return AUTOMATION_GET_PATHS.has(pathname)
  }
  if (normalizedMethod === "POST") {
    return AUTOMATION_POST_PATHS.has(pathname)
  }
  return false
}

export function isDashboardAdmin(
  email: string,
  groups: ReadonlySet<string>,
  env: Record<string, string | undefined> = process.env
) {
  const normalizedEmail = email.trim().toLowerCase()
  const configuredEmails = (env.CF_ACCESS_ADMIN_EMAILS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
  if (configuredEmails.includes(normalizedEmail)) return true

  const adminGroupId = env.CF_ACCESS_ADMIN_GROUP_ID?.trim()
  return Boolean(adminGroupId && groups.has(adminGroupId))
}

export function extractGroupValues(identity: unknown) {
  const groups = new Set<string>()
  collectGroupValues(identity, false, groups)
  return groups
}

export function findIdentityString(identity: unknown, keys: string[]) {
  const normalizedKeys = new Set(keys.map((key) => normalizeKey(key)))
  return findStringByKey(identity, normalizedKeys, new Set<object>())
}

function normalizeTeamDomain(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`
  const parsed = new URL(withProtocol)
  return parsed.origin
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim()
    return trimmed || undefined
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = firstString(item)
      if (candidate) return candidate
    }
  }
  return undefined
}

function collectGroupValues(value: unknown, groupContext: boolean, output: Set<string>) {
  if (typeof value === "string") {
    if (groupContext && value.trim()) output.add(value.trim())
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectGroupValues(item, groupContext, output)
    return
  }
  if (!isRecord(value)) return

  for (const [key, child] of Object.entries(value)) {
    const childGroupContext = groupContext || normalizeKey(key).includes("group")
    if (childGroupContext && ["id", "name", "objectid", "value"].includes(normalizeKey(key))) {
      const candidate = firstString(child)
      if (candidate) output.add(candidate)
    }
    collectGroupValues(child, childGroupContext, output)
  }
}

function findStringByKey(
  value: unknown,
  keys: Set<string>,
  visited: Set<object>
): string | undefined {
  if (!isRecord(value) || visited.has(value)) return undefined
  visited.add(value)

  for (const [key, child] of Object.entries(value)) {
    if (keys.has(normalizeKey(key))) {
      const candidate = firstString(child)
      if (candidate) return candidate
    }
  }

  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      for (const item of child) {
        const candidate = findStringByKey(item, keys, visited)
        if (candidate) return candidate
      }
      continue
    }
    const candidate = findStringByKey(child, keys, visited)
    if (candidate) return candidate
  }
  return undefined
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
