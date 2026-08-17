import { type NextRequest, NextResponse } from "next/server"

import {
  isAutomationAccessPayload,
  isAutomationRouteAllowed,
  isCloudflareAccessEnabled,
  isHumanAccessPayload,
  verifyCloudflareAccessToken,
} from "@/lib/cloudflare-access-core"

const UNTRUSTED_IDENTITY_HEADERS = [
  "cf-access-client-id",
  "cf-access-client-secret",
  "x-dashboard-user",
  "x-dashboard-user-email",
  "x-dashboard-user-name",
  "x-dashboard-role",
]

export async function proxy(request: NextRequest) {
  if (!isCloudflareAccessEnabled()) return continueWithSanitizedHeaders(request)

  const token = request.headers.get("cf-access-jwt-assertion")?.trim()
  if (!token) return forbidden(request)

  try {
    const payload = await verifyCloudflareAccessToken(token)
    if (isHumanAccessPayload(payload)) return continueWithSanitizedHeaders(request)

    if (
      isAutomationAccessPayload(payload) &&
      isAutomationRouteAllowed(request.nextUrl.pathname, request.method)
    ) {
      return continueWithSanitizedHeaders(request)
    }
  } catch {
    // Fail closed without exposing token or verification details.
  }

  return forbidden(request)
}

function continueWithSanitizedHeaders(request: NextRequest) {
  const requestHeaders = new Headers(request.headers)
  for (const header of UNTRUSTED_IDENTITY_HEADERS) requestHeaders.delete(header)
  return NextResponse.next({ request: { headers: requestHeaders } })
}

function forbidden(request: NextRequest) {
  const payload = { error: "Forbidden" }
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(payload, { status: 403 })
  }
  return new NextResponse("Forbidden", {
    status: 403,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
