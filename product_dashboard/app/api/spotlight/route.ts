import { NextResponse } from "next/server"

import { loadDashboardData } from "@/lib/competitor-data"
import { buildAlerts, findSnapshot } from "@/lib/spotlight-alerts"
import type { SpotlightAlert } from "@/lib/spotlight-alerts"

type SpotlightResponse = {
  categoryId: string
  snapshotDate: string
  alerts: SpotlightAlert[]
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const category = url.searchParams.get("category")
  const snapshotDate = url.searchParams.get("snapshot")

  const dashboard = await loadDashboardData()
  const categories = dashboard.categories.filter((c) => c.snapshots.length > 0)
  const defaultCategory = [...categories].sort((a, b) => a.label.localeCompare(b.label))[0]
  const selectedCategory =
    categories.find((c) => c.id === category) ?? defaultCategory

  if (!selectedCategory) {
    return NextResponse.json(
      { categoryId: "", snapshotDate: "", alerts: [] } satisfies SpotlightResponse,
      { status: 200 }
    )
  }

  const { active, previous } = findSnapshot(selectedCategory.snapshots, snapshotDate)
  if (!active) {
    return NextResponse.json(
      { categoryId: selectedCategory.id, snapshotDate: "", alerts: [] } satisfies SpotlightResponse,
      { status: 200 }
    )
  }

  const alerts = buildAlerts(selectedCategory.id, active, previous)

  return NextResponse.json(
    { categoryId: selectedCategory.id, snapshotDate: active.date, alerts } satisfies SpotlightResponse,
    { status: 200 }
  )
}
