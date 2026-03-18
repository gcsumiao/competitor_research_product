import { permanentRedirect } from "next/navigation"
import { connection } from "next/server"

import { getLegacyCodeReaderRedirectBaseUrl } from "@/lib/dashboard-runtime"

export type DashboardPageSearchParams = Record<string, string | string[] | undefined>

export async function prepareDashboardPageRequest(input: {
  pathname: string
  searchParams?: DashboardPageSearchParams | Promise<DashboardPageSearchParams>
  forceCodeReaderCategory?: boolean
}) {
  await connection()

  const redirectBaseUrl = getLegacyCodeReaderRedirectBaseUrl()
  if (!redirectBaseUrl) return

  const params = await Promise.resolve(input.searchParams ?? {})
  const target = new URL(input.pathname, redirectBaseUrl)

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "string" && item.length > 0) {
          target.searchParams.append(key, item)
        }
      }
      continue
    }

    if (typeof value === "string" && value.length > 0) {
      target.searchParams.set(key, value)
    }
  }

  if (input.forceCodeReaderCategory) {
    target.searchParams.set("category", "code_reader_scanner")
  }

  permanentRedirect(target.toString())
}
