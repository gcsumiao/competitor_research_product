"use client"

import { useId } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { TooltipProps } from "recharts"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type TrendLineDatum = {
  label: string
  value: number
  tooltipRows?: Array<{
    label: string
    value: string
  }>
}

export function TrendLineCard({
  title,
  subtitle,
  totalLabel,
  totalValue,
  changeLabel,
  changeValueLabel,
  data,
  color,
  formatter,
  axisFormatter,
  compactSummary = false,
}: {
  title: string
  subtitle: string
  totalLabel: string
  totalValue: string
  changeLabel: string
  changeValueLabel: string
  data: TrendLineDatum[]
  color: string
  formatter?: (value: number) => string
  axisFormatter?: (value: number) => string
  compactSummary?: boolean
}) {
  const chartId = useId().replace(/:/g, "")
  const formatValue = formatter ?? ((value: number) => value.toLocaleString())
  const formatAxisValue = axisFormatter ?? formatValue
  const renderTooltip = ({ active, label, payload }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null

    const datum = payload[0]?.payload as TrendLineDatum | undefined
    if (!datum) return null

    const tooltipRows =
      datum.tooltipRows?.length
        ? datum.tooltipRows
        : [{ label: title, value: formatValue(datum.value) }]

    return (
      <div className="rounded-lg border border-white/10 bg-[#1a1a1a] px-3 py-2 text-xs text-white shadow-lg">
        <p className="mb-2 font-medium text-white">{label ?? datum.label}</p>
        <div className="space-y-1">
          {tooltipRows.map((row) => (
            <div key={`${datum.label}-${row.label}`} className="flex items-center justify-between gap-3">
              <span className="text-white/70">{row.label}</span>
              <span className="font-medium text-white">{row.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <p className="text-xs text-muted-foreground">{totalLabel}</p>
          <p className={compactSummary ? "mt-1 text-base font-semibold" : "text-3xl font-semibold"}>
            {totalValue}
          </p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs bg-[var(--color-accent)]/30 text-foreground px-2 py-0.5 rounded-full">
              {changeLabel}
            </span>
            <span className="text-xs text-muted-foreground">{changeValueLabel}</span>
          </div>
        </div>
        <div className="h-[172px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <defs>
                <linearGradient id={`trend-fill-${chartId}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.24} />
                  <stop offset="65%" stopColor={color} stopOpacity={0.08} />
                  <stop offset="100%" stopColor={color} stopOpacity={0.01} />
                </linearGradient>
                <filter id={`trend-shadow-${chartId}`} x="-20%" y="-20%" width="140%" height="160%">
                  <feDropShadow dx="0" dy="4" stdDeviation="6" floodColor={color} floodOpacity="0.22" />
                </filter>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="rgba(120,120,120,0.18)" />
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#737373" }}
                dy={6}
              />
              <YAxis
                width={60}
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fill: "#737373" }}
                tickFormatter={formatAxisValue}
              />
              <Tooltip
                content={renderTooltip}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="none"
                fill={`url(#trend-fill-${chartId})`}
                fillOpacity={1}
                filter={`url(#trend-shadow-${chartId})`}
                tooltipType="none"
              />
              <Line
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={3.25}
                dot={{ r: 2.5, fill: color, strokeWidth: 0 }}
                activeDot={{ r: 4, fill: color, stroke: "#fff", strokeWidth: 1.5 }}
                filter={`url(#trend-shadow-${chartId})`}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
