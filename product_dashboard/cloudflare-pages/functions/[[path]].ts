const DEFAULT_ORIGIN = "https://product-market-research.vercel.app"
const PUBLIC_HOSTNAME = "product-market-research.pages.dev"

const SPOOFABLE_IDENTITY_HEADERS = [
  "cf-access-client-id",
  "cf-access-client-secret",
  "x-dashboard-user",
  "x-dashboard-user-email",
  "x-dashboard-user-name",
  "x-dashboard-role",
]

type PagesEnvironment = {
  VERCEL_ORIGIN?: string
}

type PagesContext = {
  env: PagesEnvironment
  request: Request
}

export async function onRequest(context: PagesContext) {
  return proxyDashboardRequest(context.request, context.env)
}

export async function proxyDashboardRequest(
  request: Request,
  env: PagesEnvironment = {},
  fetchOrigin: typeof fetch = fetch
) {
  try {
    const origin = normalizeOrigin(env.VERCEL_ORIGIN || DEFAULT_ORIGIN)
    const originRequest = createOriginRequest(request, origin)
    const originResponse = await fetchOrigin(originRequest)
    return createProxyResponse(originResponse, request.url, origin)
  } catch {
    return Response.json({ error: "Dashboard origin unavailable" }, { status: 502 })
  }
}

export function createOriginRequest(request: Request, origin = DEFAULT_ORIGIN) {
  const incomingUrl = new URL(request.url)
  const originUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, normalizeOrigin(origin))
  const headers = new Headers(request.headers)

  for (const header of SPOOFABLE_IDENTITY_HEADERS) headers.delete(header)
  headers.delete("host")
  headers.set("x-forwarded-host", incomingUrl.host)
  headers.set("x-forwarded-proto", "https")
  headers.set("x-forwarded-port", "443")

  const method = request.method.toUpperCase()
  const init: RequestInit & { duplex?: "half" } = {
    body: method === "GET" || method === "HEAD" ? undefined : request.body,
    headers,
    method,
    redirect: "manual",
  }
  if (init.body) init.duplex = "half"
  return new Request(originUrl, init)
}

export function createProxyResponse(
  originResponse: Response,
  publicRequestUrl: string,
  origin = DEFAULT_ORIGIN
) {
  const headers = new Headers(originResponse.headers)
  const location = headers.get("location")
  if (location) {
    headers.set("location", rewriteOriginLocation(location, publicRequestUrl, origin))
  }

  headers.set("cache-control", "private, no-store, max-age=0")
  headers.set("x-robots-tag", "noindex, nofollow")
  headers.delete("server")
  headers.delete("x-powered-by")

  return new Response(originResponse.body, {
    headers,
    status: originResponse.status,
    statusText: originResponse.statusText,
  })
}

export function rewriteOriginLocation(
  location: string,
  publicRequestUrl: string,
  origin = DEFAULT_ORIGIN
) {
  try {
    const originUrl = new URL(normalizeOrigin(origin))
    const resolvedLocation = new URL(location, originUrl)
    if (resolvedLocation.origin !== originUrl.origin) return location

    const publicUrl = new URL(publicRequestUrl)
    resolvedLocation.protocol = publicUrl.protocol
    resolvedLocation.host = publicUrl.host || PUBLIC_HOSTNAME
    return resolvedLocation.toString()
  } catch {
    return location
  }
}

function normalizeOrigin(value: string) {
  return new URL(value).origin
}
