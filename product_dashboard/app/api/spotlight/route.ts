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

function formatChange(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "n/a"
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`
}

type RevenueMoMCandidate = {
  label: string
  mom: number
  kind: "brand" | "type"
}

function selectTopRevenueMoMMovers(active: SnapshotSummary, previous: SnapshotSummary) {
  const candidates: RevenueMoMCandidate[] = []

  const prevRevenueByBrand = new Map(
    previous.brandTotals.map((brand) => [brand.brand.toLowerCase(), brand.revenue])
  )
  for (const brand of active.brandTotals) {
    const prior = prevRevenueByBrand.get(brand.brand.toLowerCase())
    if (typeof prior !== "number" || prior <= 0) continue
    const mom = pctChange(brand.revenue, prior)
    if (mom === null || !Number.isFinite(mom)) continue
    candidates.push({
      label: brand.brand,
      mom,
      kind: "brand",
    })
  }

  const scopeRows = active.typeBreakdowns?.allAsins ?? []
  const typeScopeKeys = new Set([
    "total_tablet",
    "total_handheld",
    "total_dongle",
    "total_other_tools",
  ])
  for (const row of scopeRows) {
    if (!typeScopeKeys.has(row.scopeKey)) continue
    if (typeof row.revenueMoM !== "number" || !Number.isFinite(row.revenueMoM)) continue
    candidates.push({
      label: row.label,
      mom: row.revenueMoM * 100,
      kind: "type",
    })
  }

  const topOverall = [...candidates].sort((a, b) => b.mom - a.mom)[0]
  const topBrand = [...candidates]
    .filter((candidate) => candidate.kind === "brand")
    .sort((a, b) => b.mom - a.mom)[0]
  const topType = [...candidates]
    .filter((candidate) => candidate.kind === "type")
    .sort((a, b) => b.mom - a.mom)[0]

  return { topOverall, topBrand, topType }
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

    if (marketRevMoM !== null) {
      const abs = Math.abs(marketRevMoM)
      alerts.push({
        id: "market_revenue",
        severity: abs >= 10 ? (marketRevMoM < 0 ? "risk" : "watch") : "info",
        title: "Market revenue (MoM)",
        detail: `Market 30D revenue ${formatChange(marketRevMoM)} vs last month.`,
      })
    }

    if (marketUnitsMoM !== null) {
      const abs = Math.abs(marketUnitsMoM)
      alerts.push({
        id: "market_units",
        severity: abs >= 10 ? (marketUnitsMoM < 0 ? "risk" : "watch") : "info",
        title: "Market units (MoM)",
        detail: `Market 30D units ${formatChange(marketUnitsMoM)} vs last month.`,
      })
    }

    const mover = selectTopRevenueMoMMovers(active, previous)
    if (mover.topOverall) {
      const top = mover.topOverall
      const topBrandLine = mover.topBrand
        ? `Top brand: ${mover.topBrand.label} ${formatChange(mover.topBrand.mom)} MoM.`
        : null
      const topTypeLine = mover.topType
        ? `Top type: ${mover.topType.label} ${formatChange(mover.topType.mom)} MoM.`
        : null

      const detailLines = [
        `Highest revenue MoM mover: ${top.label} (${top.kind}) ${formatChange(top.mom)}.`,
        topBrandLine,
        topTypeLine,
      ].filter(Boolean) as string[]

      const severity: SpotlightSeverity =
        Math.abs(top.mom) >= 10 ? (top.mom < 0 ? "risk" : "watch") : "info"

      alerts.push({
        id: "share_mover",
        severity,
        title: "Biggest share mover",
        detail: detailLines.join(" "),
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
