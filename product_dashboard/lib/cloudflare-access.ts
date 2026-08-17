import "server-only"

import { cache } from "react"
import { headers } from "next/headers"

import {
  extractGroupValues,
  findIdentityString,
  isDashboardAdmin,
  isCloudflareAccessEnabled,
  readCloudflareAccessConfig,
  readPayloadString,
  type DashboardUser,
  verifyCloudflareAccessToken,
} from "@/lib/cloudflare-access-core"

export class DashboardAuthorizationError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message)
  }
}

async function loadDashboardUser(): Promise<DashboardUser> {
  if (!isCloudflareAccessEnabled()) return localDevelopmentUser()

  const requestHeaders = await headers()
  const token = requestHeaders.get("cf-access-jwt-assertion")?.trim()
  if (!token) throw new DashboardAuthorizationError("Authentication required.", 401)

  let payload
  try {
    payload = await verifyCloudflareAccessToken(token)
  } catch {
    throw new DashboardAuthorizationError("Invalid authentication token.", 401)
  }

  const email = readPayloadString(payload, "email")
  if (!email) throw new DashboardAuthorizationError("User identity is unavailable.", 401)

  const identity = await loadFullIdentity(token)
  const firstName =
    readPayloadString(payload, "given_name") ??
    findIdentityString(identity, ["given_name", "givenName", "first_name", "firstName"])
  const lastName =
    readPayloadString(payload, "family_name") ??
    findIdentityString(identity, ["family_name", "familyName", "last_name", "lastName", "surname"])
  const resolvedDisplayName =
    readPayloadString(payload, "name") ??
    findIdentityString(identity, ["display_name", "displayName", "name"]) ??
    [firstName, lastName].filter(Boolean).join(" ")
  const displayName = resolvedDisplayName || displayNameFromEmail(email)
  const id =
    readPayloadString(payload, "oid") ??
    findIdentityString(identity, ["oid", "object_id", "objectId", "user_uuid"]) ??
    payload.sub ??
    email

  const groups = extractGroupValues(identity)
  const role = isDashboardAdmin(email, groups) ? "admin" : "user"

  return {
    id,
    email,
    displayName,
    firstName,
    lastName,
    role,
  }
}

export const getDashboardUser = cache(loadDashboardUser)

export async function requireAdmin() {
  const user = await getDashboardUser()
  if (user.role !== "admin") {
    throw new DashboardAuthorizationError("Administrator access required.", 403)
  }
  return user
}

async function loadFullIdentity(token: string) {
  const { teamDomain } = readCloudflareAccessConfig()
  try {
    const response = await fetch(`${teamDomain}/cdn-cgi/access/get-identity`, {
      cache: "no-store",
      headers: { Cookie: `CF_Authorization=${token}` },
      signal: AbortSignal.timeout(4_000),
    })
    if (!response.ok) return null
    return (await response.json()) as unknown
  } catch {
    return null
  }
}

function localDevelopmentUser(): DashboardUser {
  const email = process.env.DASHBOARD_DEV_USER_EMAIL?.trim() || "local@dashboard.invalid"
  const role = process.env.DASHBOARD_DEV_USER_ROLE?.trim().toLowerCase() === "admin" ? "admin" : "user"
  return {
    id: "local-development",
    email,
    displayName: process.env.DASHBOARD_DEV_USER_NAME?.trim() || "Local Developer",
    role,
  }
}

function displayNameFromEmail(email: string) {
  return email
    .split("@", 1)[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ")
}
