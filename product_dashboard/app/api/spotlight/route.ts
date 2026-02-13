import { NextResponse } from "next/server"

import { loadDashboardData } from "@/lib/competitor-data"
import type { CategoryId, SnapshotSummary } from "@/lib/competitor-data"

type SpotlightSeverity = "info" | "watch" | "risk"

export type SpotlightAlert = {
  id: string
  severity: SpotlightSeverity
  title: string
  detail: string
}

type SpotlightResponse = {
  categoryId: string
  snapshotDate: string
  alerts: SpotlightAlert[]
}

let cachedDashboard:
  | { loadedAt: number; data: Awaited<ReturnType<typeof loadDashboardData>> }
  | null = null

async function loadDashboardDataCached() {
  const now = Date.now()
  if (cachedDashboard && now - cachedDashboard.loadedAt < 60_000) {
    return cachedDashboard.data
  }
  const data = await loadDashboardData()
  cachedDashboard = { loadedAt: now, data }
  return data
}

function pctChange(current: number, previous: number) {
  if (!previous) return null
  return ((current - previous) / previous) * 100
}

function pointChange(current: number, previous: number) {
  return (current - previous) * 100
}

function formatChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a"
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

function formatPoints(value: number) {
  if (!Number.isFinite(value)) return "n/a"
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}pt`
}

function findSnapshot(categorySnapshots: SnapshotSummary[], snapshotDate: string | null) {
  if (!categorySnapshots.length) return { active: undefined, previous: undefined }
  const active =
    (snapshotDate ? categorySnapshots.find((s) => s.date === snapshotDate) : undefined) ??
    categorySnapshots[categorySnapshots.length - 1]
  const activeIndex = categorySnapshots.findIndex((s) => s.date === active.date)
  const previous = activeIndex > 0 ? categorySnapshots[activeIndex - 1] : undefined
  return { active, previous }
}

function buildAlerts(categoryId: CategoryId, active: SnapshotSummary, previous?: SnapshotSummary) {
  const alerts: SpotlightAlert[] = []

  if (previous) {
    const marketRevMoM = pctChange(active.totals.revenue, previous.totals.revenue)
    const marketUnitsMoM = pctChange(active.totals.units, previous.totals.units)

    if (marketRevMoM !== null && Math.abs(marketRevMoM) >= 10) {
      alerts.push({
        id: "market_revenue",
        severity: marketRevMoM < -10 ? "risk" : "watch",
        title: "Market revenue moved sharply",
        detail: `Market 30D revenue ${formatChange(marketRevMoM)} vs last month.`,
      })
    }

    if (marketUnitsMoM !== null && Math.abs(marketUnitsMoM) >= 10) {
      alerts.push({
        id: "market_units",
        severity: marketUnitsMoM < -10 ? "risk" : "watch",
        title: "Market units moved sharply",
        detail: `Market 30D units ${formatChange(marketUnitsMoM)} vs last month.`,
      })
    }

    const prevShare = new Map(
      previous.brandTotals.map((b) => [b.brand.toLowerCase(), b.share])
    )
    let best: { brand: string; delta: number } | null = null
    for (const brand of active.brandTotals) {
      const prior = prevShare.get(brand.brand.toLowerCase()) ?? 0
      const delta = pointChange(brand.share, prior)
      if (!best || Math.abs(delta) > Math.abs(best.delta)) {
        best = { brand: brand.brand, delta }
      }
    }
    if (best && Number.isFinite(best.delta) && Math.abs(best.delta) >= 1) {
      alerts.push({
        id: "share_mover",
        severity: Math.abs(best.delta) >= 2 ? "watch" : "info",
        title: "Biggest share mover",
        detail: `${best.brand} share moved ${formatPoints(best.delta)} vs last month.`,
      })
    }

    if (categoryId === "code_reader_scanner") {
      const ownBrands = ["innova", "blcktec"]
      const currentBrands = active.rolling12?.revenue?.brands ?? []
      const previousBrands = previous.rolling12?.revenue?.brands ?? []
      const prevRank = new Map(previousBrands.map((b) => [b.brand.toLowerCase(), b.rank]))
      for (const brandKey of ownBrands) {
        const nowRank = currentBrands.find((b) => b.brand.toLowerCase() === brandKey)?.rank
        const wasRank = prevRank.get(brandKey)
        if (!nowRank || !wasRank) continue
        const delta = wasRank - nowRank
        if (delta !== 0) {
          alerts.push({
            id: `rank_${brandKey}`,
            severity: Math.abs(delta) >= 2 ? "watch" : "info",
            title: `${brandKey.toUpperCase()} rank moved`,
            detail: `Rolling 12 revenue rank ${delta > 0 ? "improved" : "declined"} by ${Math.abs(delta)} (from #${wasRank} to #${nowRank}).`,
          })
        }
      }
    }
  }

  if (active.qualityIssues?.some((issue) => issue.severity === "error")) {
    alerts.unshift({
      id: "data_quality",
      severity: "risk",
      title: "Data quality issues detected",
      detail: "Some snapshots have missing or partially parsed workbook sections. Treat metrics with caution.",
    })
  }

  return alerts.slice(0, 3)
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const category = url.searchParams.get("category")
  const snapshotDate = url.searchParams.get("snapshot")

  const dashboard = await loadDashboardDataCached()
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
