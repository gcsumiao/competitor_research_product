"use client"

import { useMemo, useState } from "react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { SnapshotSummary } from "@/lib/competitor-data"
import { cn } from "@/lib/utils"

type RankMetric = "revenue" | "units"

type ChartRow = Record<string, number | string | null> & { label: string }

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function colorForBrand(brand: string) {
  // Simple stable hash -> hue. Keeps colors consistent across refreshes.
  let hash = 0
  for (let i = 0; i < brand.length; i += 1) {
    hash = (hash * 31 + brand.charCodeAt(i)) >>> 0
  }
  const hue = hash % 360
  return `hsl(${hue} 70% 45%)`
}

export function AllBrandsRankChart({
  snapshots,
  title = "Rolling 12 Rank (All Brands)",
  maxRank = 25,
}: {
  snapshots: SnapshotSummary[]
  title?: string
  maxRank?: number
}) {
  const [metric, setMetric] = useState<RankMetric>("revenue")

  const activeSnapshot = snapshots[snapshots.length - 1]
  const activeBrands = useMemo(() => {
    const brands = metric === "revenue"
      ? activeSnapshot?.rolling12?.revenue?.brands
      : activeSnapshot?.rolling12?.units?.brands
    return (brands ?? [])
      .filter((b) => b.rank > 0)
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .slice(0, maxRank)
      .map((b) => b.brand)
  }, [activeSnapshot, metric, maxRank])

  const brandKeyMap = useMemo(() => {
    const map = new Map<string, { brand: string; key: string; color: string }>()
    for (const brand of activeBrands) {
      const key = `b_${normalizeKey(brand)}`
      map.set(brand, { brand, key, color: colorForBrand(brand) })
    }
    return map
  }, [activeBrands])

  const data: ChartRow[] = useMemo(() => {
    if (!activeBrands.length) return []
    const rows: ChartRow[] = snapshots.map((snapshot) => {
      const pool = metric === "revenue"
        ? snapshot.rolling12?.revenue?.brands
        : snapshot.rolling12?.units?.brands
      const rankByBrand = new Map((pool ?? []).map((b) => [b.brand.toLowerCase(), b.rank]))
      const row: ChartRow = { label: snapshot.label }
      for (const brand of activeBrands) {
        const meta = brandKeyMap.get(brand)
        if (!meta) continue
        row[meta.key] = rankByBrand.get(brand.toLowerCase()) ?? null
      }
      return row
    })
    return rows
  }, [activeBrands, brandKeyMap, metric, snapshots])

  const legendItems = useMemo(() => {
    const pool = metric === "revenue"
      ? activeSnapshot?.rolling12?.revenue?.brands
      : activeSnapshot?.rolling12?.units?.brands
    const rankByBrand = new Map((pool ?? []).map((b) => [b.brand.toLowerCase(), b.rank]))
    return activeBrands.map((brand) => {
      const meta = brandKeyMap.get(brand)!
      return {
        brand,
        key: meta.key,
        color: meta.color,
        rank: rankByBrand.get(brand.toLowerCase()) ?? null,
      }
    })
  }, [activeBrands, activeSnapshot, brandKeyMap, metric])

  if (!activeBrands.length) return null

  return (
    <Card className="bg-card border border-border">
      <CardHeader className="flex flex-row items-start justify-between gap-3 pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">
            Toggle between revenue and units rank to see who is moving.
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
      <CardContent className="grid grid-cols-1 lg:grid-cols-[1fr_260px] gap-4">
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#737373" }}
              />
              <YAxis
                reversed
                domain={[1, maxRank]}
                allowDecimals={false}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 11, fill: "#737373" }}
                tickFormatter={(value) => `#${value}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "#1a1a1a",
                  border: "none",
                  borderRadius: "8px",
                  color: "#fff",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "#fff" }}
                itemStyle={{ color: "#fff" }}
                formatter={(value: unknown, name: string) => {
                  const numeric = typeof value === "number" ? value : Number(value)
                  if (!Number.isFinite(numeric)) return ["n/a", "Rank"]
                  const brand = legendItems.find((item) => item.key === name)?.brand ?? "Brand"
                  return [`Rank #${Math.round(numeric)}`, brand]
                }}
              />

              {legendItems.map((item, index) => (
                <Line
                  key={item.key}
                  type="monotone"
                  dataKey={item.key}
                  stroke={item.color}
                  strokeWidth={index < 5 ? 2.2 : 1.4}
                  strokeOpacity={index < 5 ? 0.95 : 0.55}
                  dot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="max-h-[260px] overflow-auto rounded-lg border border-border bg-background/30 p-3">
          <p className="text-xs font-medium mb-2 text-muted-foreground">
            Current ranks (top {maxRank})
          </p>
          <div className="space-y-2">
            {legendItems.map((item) => (
              <div key={item.brand} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-xs font-medium truncate">{item.brand}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {item.rank ? `#${item.rank}` : "n/a"}
                </span>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
