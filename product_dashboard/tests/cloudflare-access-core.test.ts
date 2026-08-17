import assert from "node:assert/strict"
import test from "node:test"

import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose"

import {
  createCloudflareAccessVerifier,
  extractGroupValues,
  findIdentityString,
  isAutomationAccessPayload,
  isAutomationRouteAllowed,
  isDashboardAdmin,
  isHumanAccessPayload,
  readPayloadString,
} from "../lib/cloudflare-access-core.ts"

test("verifies Cloudflare Access issuer, audience, and signature", async () => {
  const { privateKey, publicKey } = await generateKeyPair("RS256")
  const publicJwk = await exportJWK(publicKey)
  publicJwk.kid = "test-key"

  const issuer = "https://test-team.cloudflareaccess.com"
  const verifier = createCloudflareAccessVerifier(
    { audiences: ["dashboard-aud"], teamDomain: issuer },
    createLocalJWKSet({ keys: [publicJwk] })
  )
  const token = await new SignJWT({ email: "ginny@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience("dashboard-aud")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey)

  const payload = await verifier(token)
  assert.equal(payload.email, "ginny@example.com")

  const wrongAudienceToken = await new SignJWT({ email: "ginny@example.com", type: "app" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(issuer)
    .setAudience("different-aud")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(privateKey)
  await assert.rejects(() => verifier(wrongAudienceToken))
})

test("reads human and automation identities without trusting arbitrary role claims", () => {
  const human = { email: "user@example.com", type: "app", custom: { name: "Alex User" } }
  assert.equal(isHumanAccessPayload(human), true)
  assert.equal(readPayloadString(human, "name"), "Alex User")

  const automation = { common_name: "service-id.access", type: "app" }
  assert.equal(isAutomationAccessPayload(automation, "service-id.access"), true)
  assert.equal(isAutomationAccessPayload(automation, "other.access"), false)
})

test("limits automation to the explicit smoke and revalidation surface", () => {
  assert.equal(isAutomationRouteAllowed("/", "GET"), true)
  assert.equal(isAutomationRouteAllowed("/api/chat", "POST"), true)
  assert.equal(isAutomationRouteAllowed("/api/revalidate", "POST"), true)
  assert.equal(isAutomationRouteAllowed("/profile", "GET"), false)
  assert.equal(isAutomationRouteAllowed("/api/consult-me/research", "POST"), false)
})

test("extracts Entra group ids and profile values from nested identity data", () => {
  const identity = {
    idp: {
      displayName: "Ginny Chen",
      groups: [
        { id: "users-group", name: "Dashboard-Users" },
        { id: "admins-group", name: "Dashboard-Admins" },
      ],
    },
  }
  const groups = extractGroupValues(identity)
  assert.equal(groups.has("admins-group"), true)
  assert.equal(groups.has("Dashboard-Users"), true)
  assert.equal(findIdentityString(identity, ["displayName"]), "Ginny Chen")
})

test("supports OTP admin email allowlists before Entra groups are available", () => {
  const groups = new Set<string>()
  const env = { CF_ACCESS_ADMIN_EMAILS: "ginny.chen@innova.com, other@innova.com" }
  assert.equal(isDashboardAdmin("Ginny.Chen@innova.com", groups, env), true)
  assert.equal(isDashboardAdmin("employee@innova.com", groups, env), false)

  const groupEnv = { CF_ACCESS_ADMIN_GROUP_ID: "admins-group" }
  assert.equal(isDashboardAdmin("employee@innova.com", new Set(["admins-group"]), groupEnv), true)
})
