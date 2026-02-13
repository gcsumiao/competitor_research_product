"use client"

import { useMemo, useState } from "react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SnapshotSummary } from "@/lib/competitor-data"
import { cn } from "@/lib/utils"

type RankMetric = "revenue" | "units"

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function brandColors(brand: string) {
  let hash = 0
  for (let i = 0; i < brand.length; i += 1) {
    hash = (hash * 31 + brand.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return {
    solid: `hsl(${hue} 70% 45%)`,
    soft: `hsla(${hue}, 70%, 45%, 0.14)`,
    soft2: `hsla(${hue}, 70%, 45%, 0.08)`,
  }
}

function getRank(snapshot: SnapshotSummary, metric: RankMetric, brand: string) {
  const pool =
    metric === "revenue"
      ? snapshot.rolling12?.revenue?.brands
      : snapshot.rolling12?.units?.brands
  const item = pool?.find((b) => b.brand.toLowerCase() === brand.toLowerCase())
  return item?.rank ?? null
}

export function AllBrandsRankChart({
  snapshots,
  title = "Rolling 12mon Rank (All Brands)",
  maxRank = 25,
  monthsToShow = 6,
}: {
  snapshots: SnapshotSummary[]
  title?: string
  maxRank?: number
  monthsToShow?: number
}) {
  const [metric, setMetric] = useState<RankMetric>("revenue")

  const windowedSnapshots = useMemo(() => {
    if (!snapshots.length) return []
    return snapshots.slice(Math.max(0, snapshots.length - monthsToShow))
  }, [monthsToShow, snapshots])

  const activeSnapshot = windowedSnapshots[windowedSnapshots.length - 1]
  const previousSnapshot =
    windowedSnapshots.length >= 2
      ? windowedSnapshots[windowedSnapshots.length - 2]
      : undefined

  const brands = useMemo(() => {
    const pool =
      metric === "revenue"
        ? activeSnapshot?.rolling12?.revenue?.brands
        : activeSnapshot?.rolling12?.units?.brands

    return (pool ?? [])
      .filter((b) => b.rank > 0)
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .slice(0, maxRank)
      .map((b) => b.brand)
  }, [activeSnapshot, maxRank, metric])

  const brandMeta = useMemo(() => {
    const meta = new Map<string, { key: string; solid: string; soft: string; soft2: string }>()
    for (const brand of brands) {
      const key = `b_${normalizeKey(brand)}`
      meta.set(brand, { key, ...brandColors(brand) })
    }
    return meta
  }, [brands])

  const rows = useMemo(() => {
    const out = brands.map((brand) => {
      const currentRank = activeSnapshot ? getRank(activeSnapshot, metric, brand) : null
      const priorRank =
        previousSnapshot && currentRank
          ? getRank(previousSnapshot, metric, brand)
          : null
      const delta =
        typeof currentRank === "number" && typeof priorRank === "number"
          ? priorRank - currentRank
          : null

      const ranks = windowedSnapshots.map((snapshot) => getRank(snapshot, metric, brand))
      return { brand, currentRank, delta, ranks }
    })

    // Keep visual order stable: sort by latest rank.
    return out
      .slice()
      .sort((a, b) => (a.currentRank ?? 999) - (b.currentRank ?? 999))
  }, [activeSnapshot, brands, metric, previousSnapshot, windowedSnapshots])

  if (!brands.length || !windowedSnapshots.length) return null

  return (
    <Card className="bg-card border border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Pill view of rank movement. Latest month is highlighted; earlier months are muted.
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
        <div className="overflow-x-auto rounded-lg border border-border bg-background/20">
          <div className="min-w-[860px]">
            <div
              className="grid border-b border-border"
              style={{
                gridTemplateColumns: `240px repeat(${windowedSnapshots.length}, minmax(86px, 1fr))`,
              }}
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground">Brand</div>
              {windowedSnapshots.map((snapshot) => (
                <div
                  key={snapshot.date}
                  className="px-2 py-2 text-center text-xs font-medium text-muted-foreground"
                >
                  {snapshot.label}
                </div>
              ))}
            </div>

            <div className="divide-y divide-border">
              {rows.map((row) => {
                const meta = brandMeta.get(row.brand)
                if (!meta) return null
                const latestIndex = row.ranks.length - 1
                const latestRank = row.ranks[latestIndex]
                return (
                  <div
                    key={row.brand}
                    className="grid items-center"
                    style={{
                      gridTemplateColumns: `240px repeat(${windowedSnapshots.length}, minmax(86px, 1fr))`,
                      backgroundColor: meta.soft2,
                    }}
                  >
                    <div className="px-3 py-2 flex items-center gap-2 min-w-0">
                      <div
                        className="h-6 w-1.5 rounded-full shrink-0"
                        style={{ backgroundColor: meta.solid }}
                      />
                      <div className="min-w-0">
                        <p className="text-xs font-medium truncate">{row.brand}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Latest {latestRank ? `#${latestRank}` : "n/a"}
                        </p>
                      </div>
                    </div>

                    {row.ranks.map((rank, idx) => {
                      const isLatest = idx === latestIndex
                      const pillBase =
                        "mx-auto inline-flex items-center justify-center rounded-full border px-2.5 py-1 text-xs font-medium tabular-nums"
                      if (!rank) {
                        return (
                          <div key={`${row.brand}-${idx}`} className="px-2 py-2 text-center">
                            <span className={cn(pillBase, "border-border text-muted-foreground bg-background/40")}>
                              -
                            </span>
                          </div>
                        )
                      }

                      const pillStyle = isLatest
                        ? { backgroundColor: meta.soft, borderColor: meta.solid }
                        : { backgroundColor: "transparent", borderColor: "rgba(0,0,0,0.12)" }

                      return (
                        <div key={`${row.brand}-${idx}`} className="px-2 py-2 text-center">
                          <span
                            className={cn(
                              pillBase,
                              isLatest
                                ? "text-foreground animate-in fade-in zoom-in-95 duration-300"
                                : "text-muted-foreground"
                            )}
                            style={pillStyle}
                          >
                            #{rank}
                            {isLatest && row.delta && row.delta !== 0 ? (
                              <span
                                className={cn(
                                  "ml-1 inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] border animate-in fade-in zoom-in-95 duration-300",
                                  row.delta > 0
                                    ? "border-green-200 bg-green-50 text-green-700"
                                    : "border-red-200 bg-red-50 text-red-700"
                                )}
                              >
                                {row.delta > 0 ? (
                                  <ArrowUpRight className="w-3 h-3" />
                                ) : (
                                  <ArrowDownRight className="w-3 h-3" />
                                )}
                                {row.delta > 0 ? `+${row.delta}` : `${row.delta}`}
                              </span>
                            ) : null}
                          </span>
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
