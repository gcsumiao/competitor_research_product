import { NextResponse } from "next/server"

import { buildBrandExportPayload } from "@/lib/brand-export"
import { listDashboardCategoryIds, loadDashboardDataForCategory } from "@/lib/competitor-data"
import { normalizeSnapshotDate } from "@/lib/snapshot-date"

/**
 * Machine-readable brand export for the auto-intel pipeline.
 *
 *   GET /api/export/brands?category=<id>[&snapshot=YYYY-MM-DD]
 *
 * The payload shape is frozen by the pipeline's fixtures — see `lib/brand-export.ts`.
 * `snapshot` is optional and falls back to the latest snapshot; the response always
 * states which snapshot it actually served in `snapshotDate`. Errors are JSON too:
 * this route never returns HTML, so a collector can parse every response it gets.
 *
 * Reached by the pipeline's Cloudflare Access service token, which is why the path is
 * listed in `AUTOMATION_GET_PATHS` (`lib/cloudflare-access-core.ts`).
 */

const CACHE_CONTROL = "private, max-age=300"

export async function GET(request: Request) {
  const url = new URL(request.url)
  const category = (url.searchParams.get("category") ?? "").trim()
  const rawSnapshot = (url.searchParams.get("snapshot") ?? "").trim()
  const snapshotDate = rawSnapshot ? normalizeSnapshotDate(rawSnapshot) : null

  const availableCategories = listDashboardCategoryIds()
  if (!availableCategories.some((id) => id === category)) {
    return jsonError(404, `Unknown category: ${category || "(missing)"}`, {
      categoryId: category,
      availableCategories,
    })
  }

  const dashboard = await loadDashboardDataForCategory(category)
  const selected = dashboard.categories.find((entry) => entry.id === category)
  if (!selected) {
    return jsonError(404, `Unknown category: ${category}`, { categoryId: category })
  }

  const payload = buildBrandExportPayload(selected.id, selected.snapshots, snapshotDate)
  if (!payload) {
    return jsonError(404, `No snapshots available for category: ${category}`, {
      categoryId: category,
    })
  }

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": CACHE_CONTROL },
  })
}

function jsonError(status: number, error: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error, ...extra }, { status, headers: { "Cache-Control": "no-store" } })
}
