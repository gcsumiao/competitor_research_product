import { revalidateTag } from "next/cache"
import { NextResponse } from "next/server"

import { getDashboardRevalidateSecret } from "@/lib/dashboard-runtime"

export async function POST(request: Request) {
  const url = new URL(request.url)
  const secret = url.searchParams.get("secret") ?? request.headers.get("x-revalidate-secret") ?? ""
  const tag = url.searchParams.get("tag") ?? "dashboard-data"
  const expected = getDashboardRevalidateSecret()

  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  revalidateTag(tag, "max")
  return NextResponse.json({ ok: true, tag, pagePathsInvalidated: 0 })
}
