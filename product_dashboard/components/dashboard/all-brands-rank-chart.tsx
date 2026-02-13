"use client"

import { useMemo, useState } from "react"
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SnapshotSummary } from "@/lib/competitor-data"
import { formatSnapshotLabelMonthEnd } from "@/lib/snapshot-date"
import { cn } from "@/lib/utils"

type RankMetric = "revenue" | "units"

type MonthRankMaps = {
  date: string
  label: string
  byRank: Map<number, string>
  byBrand: Map<string, number>
}

const FIXED_BRAND_COLORS: Record<string, string> = {
  autel: "#16a34a",
  ancel: "#f97316",
  topdon: "#3b82f6",
  xtool: "#eab308",
  foxwell: "#ef4444",
  launch: "#0ea5e9",
  innova: "#8b5cf6",
  blcktec: "#14b8a6",
  thinkcar: "#ec4899",
  obdlink: "#22c55e",
}

function normalizeBrand(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function fallbackColor(brand: string) {
  let hash = 0
  for (let i = 0; i < brand.length; i += 1) {
    hash = (hash * 31 + brand.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue} 70% 42%)`
}

function colorForBrand(brand: string) {
  const key = normalizeBrand(brand)
  return FIXED_BRAND_COLORS[key] ?? fallbackColor(brand)
}

function toSoftColor(hexOrHsl: string, alpha: number) {
  if (hexOrHsl.startsWith("#")) {
    const hex = hexOrHsl.replace("#", "")
    const normalized = hex.length === 3
      ? hex.split("").map((v) => `${v}${v}`).join("")
      : hex
    const r = Number.parseInt(normalized.slice(0, 2), 16)
    const g = Number.parseInt(normalized.slice(2, 4), 16)
    const b = Number.parseInt(normalized.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
  }
  const hslMatch = hexOrHsl.match(/^hsl\((.+)\)$/)
  if (hslMatch) {
    return `hsla(${hslMatch[1]} / ${alpha})`
  }
  return hexOrHsl
}

function buildMonthRankMaps(snapshot: SnapshotSummary, metric: RankMetric): MonthRankMaps {
  const source =
    metric === "revenue"
      ? snapshot.rolling12?.revenue?.brands ?? []
      : snapshot.rolling12?.units?.brands ?? []

  const byRank = new Map<number, string>()
  const byBrand = new Map<string, number>()

  for (const row of source) {
    if (!row.brand || !Number.isFinite(row.rank) || row.rank <= 0) continue
    byRank.set(row.rank, row.brand)
    byBrand.set(normalizeBrand(row.brand), row.rank)
  }

  return {
    date: snapshot.date,
    label: formatSnapshotLabelMonthEnd(snapshot.date),
    byRank,
    byBrand,
  }
}

export function AllBrandsRankChart({
  snapshots,
  selectedSnapshotDate,
  title = "Rolling 12mon Rank (All Brands)",
  maxRank = 25,
  monthsToShow = 6,
}: {
  snapshots: SnapshotSummary[]
  selectedSnapshotDate?: string
  title?: string
  maxRank?: number
  monthsToShow?: number
}) {
  const [metric, setMetric] = useState<RankMetric>("revenue")

  const windowedSnapshots = useMemo(() => {
    if (!snapshots.length) return [] as SnapshotSummary[]
    const anchorIndex = selectedSnapshotDate
      ? snapshots.findIndex((row) => row.date === selectedSnapshotDate)
      : snapshots.length - 1
    const safeAnchor = anchorIndex >= 0 ? anchorIndex : snapshots.length - 1
    const start = Math.max(0, safeAnchor - (monthsToShow - 1))
    return snapshots.slice(start, safeAnchor + 1)
  }, [monthsToShow, selectedSnapshotDate, snapshots])

  const months = useMemo(
    () => windowedSnapshots.map((snapshot) => buildMonthRankMaps(snapshot, metric)),
    [metric, windowedSnapshots]
  )

  const latestIndex = months.length - 1
  const previousIndex = latestIndex - 1
  const gridColumns = `100px repeat(${months.length}, minmax(130px, 1fr))`

  if (!months.length) return null

  return (
    <Card className="bg-card border border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Excel-style rank matrix by month. Latest month is highlighted with movement badges.
          </p>
        </div>
        <div className="flex items-center rounded-full border border-border bg-background/40 p-0.5">
          <button
            type="button"
            onClick={() => setMetric("revenue")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
              metric === "revenue"
                ? "bg-[var(--color-accent)] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Revenue
          </button>
          <button
            type="button"
            onClick={() => setMetric("units")}
            className={cn(
              "px-2.5 py-1 text-[11px] font-medium rounded-full transition-colors",
              metric === "units"
                ? "bg-[var(--color-accent)] text-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Units
          </button>
        </div>
      </CardHeader>

      <CardContent>
        <div className="overflow-x-auto rounded-lg bg-background/20">
          <div className="min-w-[820px]">
            <div
              className="grid sticky top-0 z-10 bg-card/95 backdrop-blur-sm"
              style={{ gridTemplateColumns: gridColumns }}
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground sticky left-0 bg-card/95">
                Rank #
              </div>
              {months.map((month, index) => (
                <div
                  key={month.date}
                  className={cn(
                    "px-2 py-2 text-center text-xs font-medium",
                    index === latestIndex ? "text-foreground bg-[var(--color-accent)]/20" : "text-muted-foreground"
                  )}
                >
                  {month.label}
                </div>
              ))}
            </div>

            <div className="space-y-1 pt-1">
              {Array.from({ length: maxRank }, (_, idx) => idx + 1).map((rank) => {
                const isTop5 = rank <= 5
                return (
                  <div
                    key={`rank-row-${rank}`}
                    className={cn("grid items-center rounded-md", isTop5 ? "bg-muted/35" : "bg-transparent")}
                    style={{ gridTemplateColumns: gridColumns }}
                  >
                    <div className="px-3 py-2 text-xs font-semibold sticky left-0 bg-card rounded-l-md">
                      #{rank}
                    </div>

                    {months.map((month, monthIndex) => {
                      const brand = month.byRank.get(rank)
                      const isLatest = monthIndex === latestIndex
                      const previousMonth = previousIndex >= 0 ? months[previousIndex] : undefined
                      const previousRank = brand ? previousMonth?.byBrand.get(normalizeBrand(brand)) : undefined
                      const delta = typeof previousRank === "number" && isLatest ? previousRank - rank : null

                      return (
                        <div
                          key={`${month.date}-${rank}`}
                          className={cn(
                            "px-2 py-2 min-h-[40px] flex items-center justify-center",
                            isLatest ? "bg-[var(--color-accent)]/10" : ""
                          )}
                        >
                          {brand ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold max-w-full",
                                isLatest ? "animate-in fade-in zoom-in-95 duration-300" : ""
                              )}
                              style={{
                                borderColor: colorForBrand(brand),
                                backgroundColor: toSoftColor(colorForBrand(brand), isLatest ? 0.22 : 0.12),
                                color: colorForBrand(brand),
                              }}
                              title={brand}
                            >
                              <span className="truncate max-w-[88px]">{brand}</span>
                              {isLatest && delta !== null ? (
                                <span
                                  className={cn(
                                    "inline-flex items-center gap-0.5 rounded-full border px-1 py-0.5 text-[10px]",
                                    delta > 0
                                      ? "border-green-200 bg-green-50 text-green-700"
                                      : delta < 0
                                        ? "border-red-200 bg-red-50 text-red-700"
                                        : "border-slate-200 bg-slate-50 text-slate-600"
                                  )}
                                >
                                  {delta > 0 ? (
                                    <ArrowUpRight className="w-3 h-3" />
                                  ) : delta < 0 ? (
                                    <ArrowDownRight className="w-3 h-3" />
                                  ) : (
                                    <ArrowRight className="w-3 h-3" />
                                  )}
                                  {delta > 0 ? `+${delta}` : `${delta}`}
                                </span>
                              ) : null}
                            </span>
                          ) : null}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
