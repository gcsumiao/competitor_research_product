import assert from "node:assert/strict"
import test from "node:test"

import {
  createOriginRequest,
  proxyDashboardRequest,
  rewriteOriginLocation,
} from "../cloudflare-pages/functions/[[path]].ts"

test("preserves path, query, method, body, and Access JWT while stripping service secrets", async () => {
  const incoming = new Request(
    "https://product-market-research.pages.dev/api/chat?category=code_reader_scanner",
    {
      body: JSON.stringify({ message: "hello" }),
      headers: {
        "cf-access-client-secret": "must-not-reach-origin",
        "cf-access-jwt-assertion": "signed-access-token",
        "content-type": "application/json",
        "x-dashboard-role": "admin",
      },
      method: "POST",
    }
  )

  const proxied = createOriginRequest(incoming)
  assert.equal(
    proxied.url,
    "https://product-market-research.vercel.app/api/chat?category=code_reader_scanner"
  )
  assert.equal(proxied.method, "POST")
  assert.equal(await proxied.text(), JSON.stringify({ message: "hello" }))
  assert.equal(proxied.headers.get("cf-access-jwt-assertion"), "signed-access-token")
  assert.equal(proxied.headers.has("cf-access-client-secret"), false)
  assert.equal(proxied.headers.has("x-dashboard-role"), false)
  assert.equal(proxied.headers.get("x-forwarded-host"), "product-market-research.pages.dev")
})

test("streams the origin body and rewrites only Vercel-origin redirects", async () => {
  const encoder = new TextEncoder()
  const originBody = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("first "))
      controller.enqueue(encoder.encode("second"))
      controller.close()
    },
  })
  const response = await proxyDashboardRequest(
    new Request("https://product-market-research.pages.dev/customers?brand=Innova"),
    {},
    async () =>
      new Response(originBody, {
        headers: { location: "https://product-market-research.vercel.app/profile?from=test" },
        status: 307,
      })
  )

  assert.equal(await response.text(), "first second")
  assert.equal(
    response.headers.get("location"),
    "https://product-market-research.pages.dev/profile?from=test"
  )
  assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0")
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow")
})

test("does not rewrite redirects to third-party identity providers", () => {
  assert.equal(
    rewriteOriginLocation(
      "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize",
      "https://product-market-research.pages.dev/"
    ),
    "https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize"
  )
})
