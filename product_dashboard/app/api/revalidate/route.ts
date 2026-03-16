import { revalidatePath, revalidateTag } from "next/cache"
import { NextResponse } from "next/server"

import { getDashboardRevalidateSecret } from "@/lib/dashboard-runtime"

const DASHBOARD_PATHS = [
  "/",
  "/sales",
  "/customers",
  "/orders",
  "/reports",
  "/specs",
  "/consult-me",
]

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get("secret") ?? request.headers.get("x-revalidate-secret") ?? ""
  const tag = url.searchParams.get("tag") ?? "dashboard-data"
  const expected = getDashboardRevalidateSecret()

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  revalidateTag(tag, "max")
  for (const dashboardPath of DASHBOARD_PATHS) {
    revalidatePath(dashboardPath)
  }
  return NextResponse.json({ ok: true, tag })
}
