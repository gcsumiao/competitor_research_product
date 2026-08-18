"use client"

import { useId, type ReactNode } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts"

import { formatNumberCompact } from "@/lib/dashboard-format"

export type CustomerOrdersDatum = {
  label: string
  value: number
}

interface CustomerOrdersProps {
  title: string
  subtitle: string
  totalLabel: string
  totalValue: string
  changeLabel: string
  changeValueLabel: string
  data: CustomerOrdersDatum[]
  headerRight?: ReactNode
  isRankChart?: boolean
  yMin?: number
  yMax?: number
  valueFormatter?: (value: number) => string
  color?: string
}

export function CustomerOrders({
  title,
  subtitle,
  totalLabel,
  totalValue,
  changeLabel,
  changeValueLabel,
  data,
  headerRight,
  isRankChart = false,
  yMin,
  yMax,
  valueFormatter,
  color = "#6366f1",
}: CustomerOrdersProps) {
  const gradientId = `market-trend-${useId().replace(/:/g, "")}`
  const formatValue = valueFormatter ?? formatNumberCompact

  return (
    <Card className="bg-card border-border h-full">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium">{title}</CardTitle>
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        </div>
        {headerRight ? <div className="flex items-center gap-2">{headerRight}</div> : null}
      </CardHeader>
      <CardContent>
        <div className="mb-4">
          <p className="text-xs text-muted-foreground">{totalLabel}</p>
          <p className="text-3xl font-semibold">{totalValue}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs bg-[var(--color-accent)]/30 text-foreground px-2 py-0.5 rounded-full">
              {changeLabel === "n/a"
                ? changeLabel
                : `${changeLabel} ${changeLabel.trim().startsWith("-") ? "down" : "up"}`}
            </span>
            <span className="text-xs text-muted-foreground">{changeValueLabel}</span>
          </div>
        </div>
        <div className="h-[120px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "#737373" }} />
              <YAxis
                hide
                reversed={isRankChart}
                domain={
                  typeof yMin === "number" && typeof yMax === "number"
                    ? [yMin, yMax]
                    : ["auto", "auto"]
                }
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
                formatter={(value: number) => [
                  isRankChart ? `Rank #${Math.round(value)}` : formatValue(value),
                  totalLabel,
                ]}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
