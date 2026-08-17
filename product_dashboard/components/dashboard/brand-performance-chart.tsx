"use client"

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  formatChangeLabel,
  formatCodeReaderCurrencyCompact,
  formatCodeReaderUnitsCompact,
} from "@/lib/dashboard-format"
import { cn } from "@/lib/utils"

export type BrandPerformanceDatum = {
  label: string
  revenue: number
  units: number
}

export type BrandPerformanceBrand = "innova" | "blcktec"

const BRAND_PALETTES = {
  innova: {
    label: "Innova",
    line: "#B91C1C",
    bar: "#FCA5A5",
  },
  blcktec: {
    label: "BLCKTEC",
    line: "#1D4ED8",
    bar: "#93C5FD",
  },
} as const

export function BrandPerformanceChart({
  brand,
  onBrandChange,
  data,
  revenueChange,
  unitsChange,
}: {
  brand: BrandPerformanceBrand
  onBrandChange: (brand: BrandPerformanceBrand) => void
  data: BrandPerformanceDatum[]
  revenueChange: number | null
  unitsChange: number | null
}) {
  const palette = BRAND_PALETTES[brand]
  const latest = data[data.length - 1]

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="text-base font-medium">Brand performance</CardTitle>
          <p className="text-xs text-muted-foreground">Rolling 12 monthly revenue and units</p>
        </div>
        <div
          className="flex w-fit items-center rounded-full border border-border bg-background/40 p-0.5"
          aria-label="Brand performance selector"
        >
          {(Object.keys(BRAND_PALETTES) as BrandPerformanceBrand[]).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={brand === option}
              onClick={() => onBrandChange(option)}
              className={cn(
                "rounded-full px-3 py-1 text-[11px] font-medium transition-colors",
                brand === option
                  ? "bg-[var(--color-accent)] text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {BRAND_PALETTES[option].label}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {latest ? (
          <>
            <div className="mb-3 grid grid-cols-2 gap-4">
              <BrandMetric
                label="Current month revenue"
                value={formatCodeReaderCurrencyCompact(latest.revenue)}
                change={revenueChange}
                color={palette.line}
              />
              <BrandMetric
                label="Current month units"
                value={formatCodeReaderUnitsCompact(latest.units)}
                change={unitsChange}
                color={palette.bar}
              />
            </div>
            <div
              className="h-[226px]"
              role="img"
              aria-label={`${palette.label} Rolling 12 monthly revenue line and units bars`}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barGap={4}>
                  <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(120,120,120,0.18)" />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#737373" }}
                    interval="preserveStartEnd"
                    minTickGap={12}
                  />
                  <YAxis
                    yAxisId="revenue"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#737373" }}
                    tickFormatter={formatCodeReaderCurrencyCompact}
                    width={58}
                  />
                  <YAxis
                    yAxisId="units"
                    orientation="right"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "#737373" }}
                    tickFormatter={formatCodeReaderUnitsCompact}
                    width={44}
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
                    formatter={(value: number, name: string) => [
                      name === "Revenue"
                        ? formatCodeReaderCurrencyCompact(value)
                        : formatCodeReaderUnitsCompact(value),
                      name,
                    ]}
                  />
                  <Legend
                    verticalAlign="top"
                    align="right"
                    height={28}
                    wrapperStyle={{ fontSize: "11px" }}
                  />
                  <Bar
                    yAxisId="units"
                    dataKey="units"
                    name="Units"
                    fill={palette.bar}
                    radius={[4, 4, 0, 0]}
                    maxBarSize={24}
                  />
                  <Line
                    yAxisId="revenue"
                    type="monotone"
                    dataKey="revenue"
                    name="Revenue"
                    stroke={palette.line}
                    strokeWidth={3}
                    dot={{ r: 2.5, fill: palette.line, strokeWidth: 0 }}
                    activeDot={{ r: 4, fill: palette.line, stroke: "#fff", strokeWidth: 1.5 }}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <div className="flex h-[294px] items-center justify-center text-sm text-muted-foreground">
            Rolling 12 brand data is unavailable for this snapshot.
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function BrandMetric({
  label,
  value,
  change,
  color,
}: {
  label: string
  value: string
  change: number | null
  color: string
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-1 flex flex-wrap items-baseline gap-2">
        <p className="text-2xl font-semibold" style={{ color }}>{value}</p>
        <span className="text-xs text-muted-foreground">
          {change === null ? "n/a" : `${formatChangeLabel(change)} MoM`}
        </span>
      </div>
    </div>
  )
}
